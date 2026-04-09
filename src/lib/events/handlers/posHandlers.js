import { supabase } from '../../supabase.js'

/**
 * POS event handlers.
 * Subscribes to events that affect POS operations and reporting.
 */
export function registerPOSHandlers(bus) {
  // ── POS transaction completed → create finance record (AR + JE) ──
  bus.subscribe('pos.transaction.completed', async function onPOSTransactionCreateAR(event) {
    const { transaction_id, transaction_number, total, payment_method, store, cashier } = event.payload

    // Cash and card payments are immediate — create AR as paid
    const status = (payment_method === '現金' || payment_method === '信用卡') ? '已收款' : '未收款'
    const paidAmount = status === '已收款' ? total : 0
    const invoiceNumber = `POS-${transaction_number}`

    const { data: ar, error } = await supabase.from('accounts_receivable').insert({
      invoice_number: invoiceNumber,
      customer: '門市顧客',
      order_ref: transaction_number,
      amount: total,
      paid_amount: paidAmount,
      due_date: new Date().toISOString().slice(0, 10),
      status,
    }).select().single()

    if (error) throw new Error(`POS AR creation failed: ${error.message}`)

    await bus.publish('finance.ar.created', {
      ar_id: ar.id,
      invoice_number: invoiceNumber,
      customer: '門市顧客',
      amount: total,
      source: 'POS',
      source_id: transaction_id,
    }, {
      causation_id: event.id,
      correlation_id: event.metadata.correlation_id,
    })
  })

  // ── POS shift closed → generate shift summary for analytics ──
  bus.subscribe('pos.shift.closed', async function onShiftClosedSummary(event) {
    const { shift_id, store, cashier, closing_cash, cash_difference } = event.payload

    // Log significant cash variances
    if (Math.abs(cash_difference || 0) > 100) {
      console.warn(
        `[POS] Cash variance NT$${cash_difference} on shift ${shift_id} (${store}/${cashier})`
      )
    }
  })
}
