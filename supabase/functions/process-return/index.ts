import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ReturnItem {
  name:      string
  qty:       number
  unitPrice: number
  skuId?:    number
}

interface RequestBody {
  orderId:       string
  storeId:       number
  orgId:         number
  employeeId?:   string
  returnedItems: ReturnItem[]
  refundAmount:  number
  refundMethod:  'cash' | 'card' | 'store_credit'
  reason?:       string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body: RequestBody = await req.json()
    const { orderId, storeId, orgId, employeeId, returnedItems, refundAmount, refundMethod, reason } = body

    if (!orderId || !returnedItems?.length || refundAmount == null || !refundMethod) {
      return json({ error: '缺少必要欄位' }, 400)
    }

    // Validate order
    const { data: order } = await supabase
      .from('pos_orders')
      .select('id, status, order_number')
      .eq('id', orderId)
      .single()

    if (!order) return json({ error: '找不到訂單' }, 404)
    if (order.status !== 'paid') return json({ error: '只能對已結帳訂單退貨' }, 400)

    // Placeholder credit note number — replaced by real 文中 response once B1-B5 resolved
    const now  = new Date()
    const ym   = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
    const creditNoteNumber = `CN-${ym}-${rand}`

    // Insert return record
    const { data: returnRec, error: retErr } = await supabase
      .from('pos_returns')
      .insert({
        organization_id:    orgId,
        store_id:           storeId,
        order_id:           orderId,
        employee_id:        employeeId ?? null,
        return_items:       returnedItems.map(i => ({
          name:       i.name,
          qty:        i.qty,
          unit_price: i.unitPrice,
          sku_id:     i.skuId ?? null,
        })),
        refund_amount:      refundAmount,
        refund_method:      refundMethod,
        credit_note_number: creditNoteNumber,
        note:               reason ?? null,
      })
      .select('id')
      .single()

    if (retErr) throw retErr

    // Restore inventory (best-effort) for items that have a linked SKU
    const itemsWithSku = returnedItems.filter(i => i.skuId)
    for (const item of itemsWithSku) {
      const { data: sku } = await supabase
        .from('skus')
        .select('stock_qty')
        .eq('id', item.skuId)
        .single()

      if (sku) {
        await supabase
          .from('skus')
          .update({ stock_qty: sku.stock_qty + item.qty })
          .eq('id', item.skuId)
      }
    }

    // TODO: When 文中 CERP credentials are available (Blockers B1-B5):
    // - POST 文中 API to issue 折讓 against original invoice
    // - Replace creditNoteNumber with real 文中 credit-note number
    // - Update pos_returns.credit_note_number with the real value

    return json({ ok: true, creditNoteNumber, returnId: returnRec.id })
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
