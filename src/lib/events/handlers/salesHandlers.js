import { supabase } from '../../supabase.js'

/**
 * Sales event handlers.
 * Subscribes to sales events that trigger downstream workflows.
 */
export function registerSalesHandlers(bus) {
  // ── Sales order created → create notification for fulfillment team ──
  bus.subscribe('sales.order.created', async function onSalesOrderCreatedNotify(event) {
    const { order_id, order_number, customer, total_amount } = event.payload

    await supabase.from('notifications').insert({
      type: '新銷售訂單',
      title: `新訂單 ${order_number} — 客戶：${customer}，金額：NT$ ${(total_amount || 0).toLocaleString()}`,
      read: false,
    }).then(() => {}).catch(err => console.warn('[salesHandlers] notify failed:', err.message))
  })

  // ── Sales order confirmed → update order status to processing ──
  bus.subscribe('sales.order.confirmed', async function onSalesOrderConfirmedUpdateStatus(event) {
    const { order_id, order_number, customer, shipment_number } = event.payload

    if (!order_id) return

    await supabase.from('notifications').insert({
      type: '訂單出貨',
      title: `訂單 ${order_number} 已確認出貨，出貨單 ${shipment_number || ''}，客戶：${customer}`,
      read: false,
    }).then(() => {}).catch(err => console.warn('[salesHandlers] notify failed:', err.message))
  })

  // ── Quote converted → archive the quotation ──
  bus.subscribe('sales.quote.converted', async function onQuoteConvertedArchive(event) {
    const { quote_id, order_id, order_number } = event.payload
    if (!quote_id) return

    await supabase.from('quotations')
      .update({
        status: '已轉換',
        converted_order_id: order_id || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', quote_id)
      .then(() => {})
      .catch(err => console.warn('[salesHandlers] quote archive failed:', err.message))
  })
}
