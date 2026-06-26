import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  paymentId: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body: RequestBody = await req.json()
    const { paymentId } = body

    if (!paymentId) return json({ error: '缺少 paymentId' }, 400)

    // ── 1. Load payment — idempotency gate ────────────────────────────────────
    const { data: payment, error: payErr } = await supabase
      .from('pos_payments')
      .select('id, order_id, store_id, organization_id, amount, payment_method, carrier_type, carrier_number, invoice_status, split_index, split_total')
      .eq('id', paymentId)
      .single()

    if (payErr || !payment) return json({ error: '找不到付款記錄' }, 404)

    // Already processed — idempotent return
    if (payment.invoice_status !== 'pending') {
      const { data: existing } = await supabase
        .from('pos_payments')
        .select('invoice_number')
        .eq('id', paymentId)
        .single()
      return json({ ok: true, invoiceNumber: existing?.invoice_number, alreadyProcessed: true })
    }

    // ── 2. Load order + items ─────────────────────────────────────────────────
    const { data: order } = await supabase
      .from('pos_orders')
      .select('id, order_number, table_id')
      .eq('id', payment.order_id)
      .single()

    const { data: items } = await supabase
      .from('pos_order_items')
      .select('id, item_type, menu_item_id, pos_product_id, name, unit_price, tax_rate, quantity')
      .eq('order_id', payment.order_id)

    if (!items) return json({ error: '找不到訂單明細' }, 404)

    // ── 3. Generate placeholder invoice number ────────────────────────────────
    // Format: PL-YYYYMM-XXXXXX  (PL = placeholder; 文中 integration replaces this in Phase 8)
    const now = new Date()
    const ym  = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
    const invoiceNumber = `PL-${ym}-${rand}`

    const subtotal = payment.amount
    const taxAmt   = Math.round(subtotal * 0.05 / 1.05)

    // ── 4. Insert into invoices table ─────────────────────────────────────────
    const invoiceItems = items.map(i => ({
      name:       i.name,
      qty:        i.quantity,
      unit_price: i.unit_price,
      amount:     Math.round(i.unit_price * i.quantity * 100) / 100,
      tax_rate:   i.tax_rate,
    }))

    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .insert({
        invoice_number: invoiceNumber,
        invoice_date:   now.toISOString().slice(0, 10),
        items:          invoiceItems,
        subtotal:       subtotal - taxAmt,
        tax:            taxAmt,
        total:          subtotal,
        carrier_type:   payment.carrier_type   ?? null,
        carrier_id:     payment.carrier_number ?? null,
        status:         '待上傳',
        order_ref:      order?.order_number ?? '',
      })
      .select('id')
      .single()

    if (invErr) throw invErr

    // ── 5. Update pos_payments ────────────────────────────────────────────────
    await supabase
      .from('pos_payments')
      .update({ invoice_number: invoiceNumber, invoice_status: 'issued' })
      .eq('id', paymentId)

    // ── 6. Deduct inventory (best-effort) ─────────────────────────────────────
    // product items: pos_products.sku_id → skus.stock_qty
    const productItems = items.filter(i => i.item_type === 'product' && i.pos_product_id)
    // menu items: pos_menu_item_skus mapping → skus.stock_qty
    const menuItems    = items.filter(i => i.item_type === 'menu' && i.menu_item_id)

    const skuDeductions: { skuId: number; qty: number }[] = []

    if (productItems.length > 0) {
      const { data: products } = await supabase
        .from('pos_products')
        .select('id, sku_id')
        .in('id', productItems.map(i => i.pos_product_id))

      for (const item of productItems) {
        const prod = products?.find(p => p.id === item.pos_product_id)
        if (prod?.sku_id) {
          skuDeductions.push({ skuId: prod.sku_id, qty: item.quantity })
        }
      }
    }

    if (menuItems.length > 0) {
      const { data: mappings } = await supabase
        .from('pos_menu_item_skus')
        .select('menu_item_id, sku_id, quantity')
        .in('menu_item_id', menuItems.map(i => i.menu_item_id))

      for (const item of menuItems) {
        const itemMaps = mappings?.filter(m => m.menu_item_id === item.menu_item_id) ?? []
        for (const m of itemMaps) {
          skuDeductions.push({ skuId: m.sku_id, qty: item.quantity * m.quantity })
        }
      }
    }

    // Deduct stock. Service role bypasses RLS.
    // Read-then-write is acceptable here: one call per payment, no concurrent same-SKU deductions.
    for (const { skuId, qty } of skuDeductions) {
      const { data: sku } = await supabase
        .from('skus')
        .select('stock_qty')
        .eq('id', skuId)
        .single()

      if (sku) {
        await supabase
          .from('skus')
          .update({ stock_qty: Math.max(0, sku.stock_qty - qty) })
          .eq('id', skuId)
      }
    }

    // ── 7. Mark order as paid + revoke QR session ────────────────────────────
    const paidAt = now.toISOString()

    // Only finalize on the last split payment (or if no split)
    const isFinalSplit = !payment.split_total || payment.split_index === payment.split_total
    if (isFinalSplit && order) {
      await supabase
        .from('pos_orders')
        .update({ status: 'paid', paid_at: paidAt })
        .eq('id', order.id)
        .in('status', ['open', 'submitted', 'confirmed'])

      // Revoke active QR sessions for the same table so the token can't be reused
      if (order.table_id) {
        await supabase
          .from('qr_order_sessions')
          .update({ revoked_at: paidAt })
          .eq('table_id', order.table_id)
          .is('revoked_at', null)
      }
    }

    return json({ ok: true, invoiceNumber, invoiceId: invoice.id })

  } catch (e) {
    const msg = e instanceof Error ? e.message : '伺服器錯誤'
    return json({ error: msg }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
