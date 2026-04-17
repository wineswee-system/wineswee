import { supabase } from '../../supabase.js'
import { calculatePointsEarned, calculateTier, refundPoints } from '../../crmEngine.js'

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

    const { data: member } = await supabase
      .from('members')
      .select('*')
      .eq('id', customer_id)
      .maybeSingle()

    if (!member) return

    const pointsEarned = calculatePointsEarned(total, member.level)
    const newTotalPoints = (member.total_points || 0) + pointsEarned
    const newAvailablePoints = (member.available_points || 0) + pointsEarned
    const newTotalSpent = (member.total_spent || 0) + total
    const newTier = calculateTier(newTotalSpent, newTotalPoints)

    await Promise.all([
      supabase.from('members').update({
        total_points: newTotalPoints,
        available_points: newAvailablePoints,
        total_spent: newTotalSpent,
        level: newTier.level,
        visit_count: (member.visit_count || 0) + 1,
        last_visit: new Date().toISOString().slice(0, 10),
      }).eq('id', member.id),

      supabase.from('point_transactions').insert({
        member_id: member.id,
        type: 'earn',
        points: pointsEarned,
        balance: newAvailablePoints,
        reference: `POS-${event.id || Date.now()}`,
        description: `POS消費累點 ($${total.toLocaleString()})`,
      }),
    ])

    if (newTier.level !== member.level) {
      await bus.publish('crm.member.tier_upgraded', {
        member_id: String(member.id),
        member_name: member.name,
        old_tier: member.level,
        new_tier: newTier.level,
      }, {
        causation_id: event.id,
        correlation_id: event.metadata?.correlation_id,
      })
    }

    await bus.publish('crm.points.earned', {
      member_id: String(member.id),
      member_name: member.name,
      points: pointsEarned,
      balance: newAvailablePoints,
      source: 'pos_transaction',
    }, {
      causation_id: event.id,
      correlation_id: event.metadata?.correlation_id,
    })
  })

  // ── POS transaction refunded → reverse loyalty points ──
  bus.subscribe('pos.transaction.refunded', async function onPOSRefundReverseLoyalty(event) {
    const { customer_id, refund_amount, original_total, refund_id, reason } = event.payload
    if (!customer_id) return

    const { data: member } = await supabase
      .from('members')
      .select('*')
      .eq('id', customer_id)
      .maybeSingle()

    if (!member) return

    const result = refundPoints(member, refund_amount, original_total, reason || '退款扣回')

    await Promise.all([
      supabase.from('members').update({
        total_points: result.newTotalPoints,
        available_points: result.newAvailablePoints,
        total_spent: result.newTotalSpent,
        level: result.newTier,
      }).eq('id', member.id),

      supabase.from('point_transactions').insert({
        member_id: member.id,
        type: 'refund',
        points: -result.pointsReversed,
        balance: result.newAvailablePoints,
        reference: `REFUND-${refund_id || Date.now()}`,
        description: result.transaction.description,
      }),
    ])

    await bus.publish('crm.points.reversed', {
      member_id: String(member.id),
      member_name: member.name,
      points: result.pointsReversed,
      balance: result.newAvailablePoints,
      refund_id: refund_id || '',
      reason: reason || '退款扣回',
    }, {
      causation_id: event.id,
      correlation_id: event.metadata?.correlation_id,
    })
  })

  // ── Form submitted → optionally create customer + deal ──
  bus.subscribe('crm.form.submitted', async function onFormSubmittedCreateLead(event) {
    const { form_id, data } = event.payload

    const { data: form } = await supabase
      .from('crm_forms')
      .select('settings')
      .eq('id', form_id)
      .maybeSingle()

    if (!form) return
    const settings = form.settings || {}

    // Create customer from form data if name or email present
    const name = data['姓名'] || data['name'] || ''
    const email = data['Email'] || data['email'] || ''
    const phone = data['電話'] || data['phone'] || ''
    const company = data['公司名稱'] || data['company'] || ''

    if (name) {
      const { data: customer } = await supabase.from('customers').insert({
        name,
        email,
        phone,
        company,
        source: '表單',
        status: '潛在',
        assigned_to: settings.assignTo || null,
      }).select().single()

      // Auto-create deal if configured
      if (settings.createDeal && customer) {
        await supabase.from('opportunities').insert({
          customer_name: name,
          title: `表單來源 - ${name}`,
          stage: '初步接觸',
          amount: 0,
          pipeline_id: settings.dealPipeline || 'default',
          assignee: settings.assignTo || null,
        })
      }
    }
  })

  // ── Finance payment recorded → update customer payment history ──
  bus.subscribe('finance.payment.recorded', async function onPaymentRecordedUpdateCustomer(event) {
    const { customer, amount, invoice_number } = event.payload
    if (!customer) return

    // TODO: migrate to customer_id FK when customers table gets proper IDs
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
