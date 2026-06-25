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

  // ── POS shift opened → write HR attendance clock-in ──
  bus.subscribe('pos.shift.opened', async function onShiftOpenedSyncAttendance(event) {
    const { shift_id, store, cashier, opening_cash } = event.payload
    const today = new Date().toISOString().slice(0, 10)
    const clockIn = new Date().toISOString()

    await supabase.from('attendance_records').insert({
      employee: cashier,
      date: today,
      clock_in: clockIn,
      status: '上班',
      source: 'pos_shift',
      pos_shift_id: String(shift_id),
    }).then(({ error }) => {
      if (error) console.warn(`[POS] attendance clock-in failed for ${cashier}:`, error.message)
    })
  })

  // ── POS shift closed → write HR attendance clock-out + hours ──
  bus.subscribe('pos.shift.closed', async function onShiftClosedSyncAttendance(event) {
    const { shift_id, store, cashier, closing_cash, cash_difference } = event.payload
    const today = new Date().toISOString().slice(0, 10)
    const clockOut = new Date().toISOString()

    // Find the clock-in record written when shift opened
    const { data: existing } = await supabase
      .from('attendance_records')
      .select('id, clock_in')
      .eq('employee', cashier)
      .eq('date', today)
      .eq('pos_shift_id', String(shift_id))
      .maybeSingle()

    if (existing) {
      const hours = existing.clock_in
        ? Math.round((Date.parse(clockOut) - Date.parse(existing.clock_in)) / 36000) / 100
        : null
      await supabase.from('attendance_records').update({
        clock_out: clockOut,
        status: '正常',
        hours,
      }).eq('id', existing.id).then(({ error }) => {
        if (error) console.warn(`[POS] attendance clock-out failed for ${cashier}:`, error.message)
      })
    }

    if (Math.abs(cash_difference || 0) > 100) {
      console.warn(`[POS] Cash variance NT$${cash_difference} on shift ${shift_id} (${store}/${cashier})`)
    }
  })
}
