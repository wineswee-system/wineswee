import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GuestItem {
  itemType:     'menu' | 'product'
  menuItemId:   string | null
  posProductId: string | null
  name:         string
  unitPrice:    number
  taxRate:      number
  quantity:     number
  note:         string
}

interface RequestBody {
  token:    string
  storeId:  string
  tableId:  string
  orderId:  string
  items:    GuestItem[]
  note?:    string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body: RequestBody = await req.json()
    const { token, storeId, tableId, orderId, items, note } = body

    if (!token || !storeId || !tableId || !orderId || !items?.length) {
      return json({ error: '缺少必要欄位' }, 400)
    }

    // Validate QR session
    const { data: session } = await supabase
      .from('qr_order_sessions')
      .select('id, order_id, expires_at, revoked_at')
      .eq('token', token)
      .eq('store_id', storeId)
      .eq('table_id', tableId)
      .maybeSingle()

    if (!session)           return json({ error: 'QR 碼無效' }, 403)
    if (session.revoked_at) return json({ error: 'QR 碼已失效' }, 403)
    if (new Date(session.expires_at) < new Date()) return json({ error: 'QR 碼已過期' }, 403)
    if (session.order_id !== orderId) return json({ error: '訂單不符' }, 403)

    // Rate limit: max 3 submission batches per token per 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { data: recentItems } = await supabase
      .from('pos_order_items')
      .select('created_at')
      .eq('order_id', orderId)
      .eq('source', 'guest')
      .gte('created_at', fiveMinAgo)
      .order('created_at')

    if (recentItems) {
      let batches = 0
      let lastTs  = 0
      for (const row of recentItems) {
        const ts = new Date(row.created_at).getTime()
        if (ts - lastTs > 2000) { batches++; lastTs = ts }
      }
      if (batches >= 3) return json({ error: '點餐太頻繁，請稍後再試' }, 429)
    }

    // Read store approval mode — determines whether items go straight to kitchen
    const { data: storeSettings } = await supabase
      .from('pos_store_settings')
      .select('qr_approval_mode')
      .eq('store_id', storeId)
      .maybeSingle()

    const autoApprove = storeSettings?.qr_approval_mode === 'auto'

    // Insert items with source='guest'; item_status reflects approval mode
    const rows = items.map(item => ({
      order_id:        orderId,
      item_type:       item.itemType,
      menu_item_id:    item.menuItemId ?? null,
      pos_product_id:  item.posProductId ?? null,
      name:            item.name,
      unit_price:      item.unitPrice,
      tax_rate:        item.taxRate ?? 0.05,
      quantity:        item.quantity,
      note:            item.note || note || '',
      source:          'guest',
      sent_to_kitchen: autoApprove,
      item_status:     autoApprove ? 'confirmed' : 'pending',
    }))

    const { error: insertError } = await supabase.from('pos_order_items').insert(rows)
    if (insertError) throw insertError

    // Advance order to 'submitted' so POS terminal knows there are pending items
    await supabase
      .from('pos_orders')
      .update({ status: 'submitted', order_source: 'qr' })
      .eq('id', orderId)
      .eq('status', 'open')

    return json({ ok: true, count: rows.length, autoApproved: autoApprove })
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
