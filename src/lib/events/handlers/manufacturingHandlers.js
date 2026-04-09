import { supabase } from '../../supabase.js'

/**
 * Manufacturing event handlers.
 * Subscribes to events that affect production planning and execution.
 */
export function registerManufacturingHandlers(bus) {
  // ── Sales order created → check if MO needed for made-to-order items ──
  bus.subscribe('sales.order.created', async function onSalesOrderCheckMO(event) {
    const { order_id, order_number, items } = event.payload
    if (!items || items.length === 0) return

    for (const item of items) {
      // Check if item has a BOM (is manufactured, not purchased)
      const { data: bom } = await supabase
        .from('bom')
        .select('*')
        .eq('product_name', item.name)
        .maybeSingle()

      if (!bom) continue // Not a manufactured item

      // Check stock — if insufficient, suggest MO
      const { data: stock } = await supabase
        .from('stock_levels')
        .select('quantity')
        .eq('sku_name', item.name)
        .maybeSingle()

      const available = stock?.quantity || 0
      const needed = item.qty || 0

      if (available < needed) {
        const moNumber = `MO-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-4)}`
        const produceQty = needed - available

        const { data: mo, error } = await supabase.from('manufacturing_orders').insert({
          mo_number: moNumber,
          product_name: item.name,
          bom_id: bom.id,
          quantity: produceQty,
          status: '計劃中',
          source: '銷售訂單',
          source_id: order_id,
          priority: '中',
        }).select().single()

        if (error) throw new Error(`Auto MO creation failed: ${error.message}`)

        await bus.publish('manufacturing.mo.state_changed', {
          mo_id: String(mo.id),
          mo_number: moNumber,
          from_state: '',
          to_state: '計劃中',
          product_name: item.name,
          quantity: produceQty,
        }, {
          causation_id: event.id,
          correlation_id: event.metadata.correlation_id,
        })
      }
    }
  })

  // ── Quality inspection completed → update MO status ──
  bus.subscribe('manufacturing.inspection.completed', async function onInspectionCompletedUpdateMO(event) {
    const { inspection_id, type, result, mo_id, pass_rate } = event.payload

    if (type === '成品檢驗' && mo_id) {
      const newStatus = result === '合格' ? '已完成' : '品質異常'

      const { data: mo } = await supabase
        .from('manufacturing_orders')
        .select('status, mo_number, product_name, quantity')
        .eq('id', mo_id)
        .maybeSingle()

      if (mo) {
        await supabase
          .from('manufacturing_orders')
          .update({ status: newStatus })
          .eq('id', mo_id)

        if (newStatus === '已完成') {
          await bus.publish('manufacturing.mo.state_changed', {
            mo_id: String(mo_id),
            mo_number: mo.mo_number,
            from_state: mo.status,
            to_state: '已完成',
            product_name: mo.product_name,
            quantity: mo.quantity,
          }, {
            causation_id: event.id,
            correlation_id: event.metadata.correlation_id,
          })
        }
      }
    }
  })
}
