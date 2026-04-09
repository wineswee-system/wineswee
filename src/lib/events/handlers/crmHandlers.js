import { supabase } from '../../supabase.js'

/**
 * CRM event handlers.
 * Subscribes to cross-module events that affect customer relationships and sales pipeline.
 */
export function registerCRMHandlers(bus) {
  // ── Opportunity won → create sales order draft ──
  bus.subscribe('crm.opportunity.won', async function onOpportunityWonCreateSO(event) {
    const { opportunity_id, customer, amount } = event.payload

    const soNumber = `SO-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-4)}`

    const { data: so, error } = await supabase.from('sales_orders').insert({
      order_number: soNumber,
      customer,
      total_amount: amount,
      status: '草稿',
      source: '商機轉換',
      source_id: opportunity_id,
    }).select().single()

    if (error) throw new Error(`SO from opportunity failed: ${error.message}`)

    await bus.publish('sales.order.created', {
      order_id: String(so.id),
      order_number: soNumber,
      customer,
      items: [],
      total_amount: amount,
      source: 'crm_opportunity',
    }, {
      causation_id: event.id,
      correlation_id: event.metadata.correlation_id,
    })
  })

  // ── POS transaction completed → update loyalty points ──
  bus.subscribe('pos.transaction.completed', async function onPOSTransactionUpdateLoyalty(event) {
    const { customer_id, total, store } = event.payload
    if (!customer_id) return

    const pointsEarned = Math.floor(total / 100) // 1 point per NT$100

    const { data: member } = await supabase
      .from('members')
      .select('*')
      .eq('customer_id', customer_id)
      .maybeSingle()

    if (member) {
      await supabase
        .from('members')
        .update({ points: (member.points || 0) + pointsEarned })
        .eq('id', member.id)
    }
  })

  // ── Finance payment recorded → update customer payment history ──
  bus.subscribe('finance.payment.recorded', async function onPaymentRecordedUpdateCustomer(event) {
    const { customer, amount, invoice_number } = event.payload
    if (!customer) return

    const { data: cust } = await supabase
      .from('customers')
      .select('*')
      .eq('name', customer)
      .maybeSingle()

    if (cust) {
      await supabase
        .from('customers')
        .update({
          total_paid: (cust.total_paid || 0) + amount,
          last_payment_date: new Date().toISOString().slice(0, 10),
        })
        .eq('id', cust.id)
    }
  })
}
