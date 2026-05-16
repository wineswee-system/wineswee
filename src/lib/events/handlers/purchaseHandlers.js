import { supabase } from '../../supabase.js'

/**
 * Purchase event handlers.
 * Subscribes to sales events that trigger stock checks and PR creation.
 */
export function registerPurchaseHandlers(bus) {
  // ── Sales order created → check stock → auto-create PR if insufficient ──
  bus.subscribe('sales.order.created', async function onSalesOrderCreated(event) {
    const { items, customer } = event.payload
    if (!items || items.length === 0) return

    const shortages = []

    for (const item of items) {
      // stock_levels 只有 sku_code，先用品名查 skus 取 code
      const { data: sku } = await supabase.from('skus').select('code, unit, unit_cost').eq('name', item.name).maybeSingle()
      const { data: stock } = sku?.code
        ? await supabase.from('stock_levels').select('*').eq('sku_code', sku.code).maybeSingle()
        : { data: null }

      const available = stock?.quantity || 0
      const needed = item.qty || 0

      if (available < needed) {
        shortages.push({
          name: item.name,
          current_stock: available,
          needed,
          shortage: needed - available,
          suggested_qty: Math.ceil((needed - available) * 1.5),
          unit: sku?.unit || item.unit || '個',
          price: sku?.unit_cost || item.price || 0,
        })
      }
    }

    if (shortages.length === 0) return

    // Auto-create purchase request
    const prItems = shortages.map(s => ({
      name: s.name,
      qty: s.suggested_qty,
      unit: s.unit,
      price: s.price,
    }))
    const totalAmount = prItems.reduce((sum, i) => sum + i.qty * i.price, 0)
    const prNumber = `PR-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-3)}`

    const { data: pr, error } = await supabase.from('purchase_requests').insert({
      pr_number: prNumber,
      requester: '系統',
      department: '系統自動',
      items: prItems,
      total_amount: totalAmount,
      reason: `庫存不足自動產生（${shortages.map(s => s.name).join('、')}）`,
      status: '待審核',
    }).select().single()

    if (error) throw new Error(`Auto PR creation failed: ${error.message}`)

    // Emit PR created event
    await bus.publish('purchase.pr.created', {
      pr_id: pr.id,
      pr_number: prNumber,
      requester: '系統',
      items: prItems,
      total_amount: totalAmount,
      trigger: 'stock_shortage',
      original_order_customer: customer,
    }, {
      causation_id: event.id,
      correlation_id: event.metadata.correlation_id,
    })
  })

  // ── PO approved → notify procurement team + update order status ──
  bus.subscribe('purchase.po.approved', async function onPOApprovedNotify(event) {
    const { po_id, po_number, supplier, total_amount } = event.payload

    await supabase.from('notifications').insert({
      type: '採購單核准',
      title: `採購單 ${po_number} 已核准 — 供應商：${supplier}，金額：NT$ ${(total_amount || 0).toLocaleString()}`,
      read: false,
    }).then(() => {}).catch(err => console.warn('[purchaseHandlers] notify failed:', err.message))

    await supabase.from('purchase_orders')
      .update({ status: '已核准', approved_at: new Date().toISOString() })
      .eq('id', po_id)
      .then(({ error }) => { if (error) console.warn('[purchaseHandlers] PO status update failed:', error.message) })
  })
}
