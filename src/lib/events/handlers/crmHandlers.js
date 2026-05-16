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

  // ── Lead scored → notify sales if high score ──
  bus.subscribe('crm.lead.scored', async function onLeadScoredNotify(event) {
    const { customer_name, new_score } = event.payload
    if (new_score < 80) return

    await supabase.from('notifications').insert({
      type: 'CRM',
      title: `高分潛客：${customer_name}（評分 ${new_score}）`,
      target_role: '業務',
      priority: 'high',
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[CRM] Lead scored notification failed:', error.message)
    })
  })

  // ── Segment changed → update customer record ──
  bus.subscribe('crm.segment.changed', async function onSegmentChangedUpdate(event) {
    const { customer_id, new_segment } = event.payload

    await supabase.from('customers')
      .update({ segment: new_segment })
      .eq('id', customer_id)
      .then(({ error }) => {
        if (error) console.warn('[CRM] Segment update failed:', error.message)
      })
  })

  // ── Campaign triggered → notify marketing team ──
  bus.subscribe('crm.campaign.triggered', async function onCampaignTriggeredNotify(event) {
    const { campaign_name, target_count } = event.payload

    await supabase.from('notifications').insert({
      type: '行銷活動',
      title: `活動「${campaign_name}」已觸發，目標對象 ${target_count || 0} 人`,
      target_role: '行銷',
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[CRM] Campaign notification failed:', error.message)
    })
  })

  // ── Lead created → notify sales team ──
  bus.subscribe('crm.lead.created', async function onLeadCreatedNotify(event) {
    const { name, source } = event.payload

    await supabase.from('notifications').insert({
      type: '新線索',
      title: `新線索：${name}${source ? `（來源：${source}）` : ''}`,
      target_role: '業務',
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[CRM] Lead created notification failed:', error.message)
    })
  })

  // ── Lead converted → notify sales manager ──
  bus.subscribe('crm.lead.converted', async function onLeadConvertedNotify(event) {
    const { lead_id, customer_id } = event.payload

    await supabase.from('notifications').insert({
      type: '線索轉換',
      title: `線索已轉換為客戶（線索 #${lead_id} → 客戶 #${customer_id}）`,
      target_role: '業務主管',
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[CRM] Lead converted notification failed:', error.message)
    })
  })

  // ── Activity created → notify assignee ──
  bus.subscribe('crm.activity.created', async function onActivityCreatedNotify(event) {
    const { type, subject, assignee } = event.payload
    if (!assignee) return

    await supabase.from('notifications').insert({
      type: 'CRM活動',
      title: `新${type}任務指派給您：${subject}`,
      target_role: assignee,
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[CRM] Activity notification failed:', error.message)
    })
  })

  // ── Activity overdue → alert assignee ──
  bus.subscribe('crm.activity.overdue', async function onActivityOverdueAlert(event) {
    const { subject, assignee, due_date } = event.payload

    await supabase.from('notifications').insert({
      type: 'CRM逾期',
      title: `活動逾期：${subject}（截止 ${due_date}）`,
      target_role: assignee || '業務',
      priority: 'high',
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[CRM] Activity overdue notification failed:', error.message)
    })
  })

  // ── Quote generated → notify sales ──
  bus.subscribe('crm.quote.generated', async function onQuoteGeneratedNotify(event) {
    const { quotation_id, amount } = event.payload

    await supabase.from('notifications').insert({
      type: '報價單',
      title: `報價單 #${quotation_id} 已產生，金額 NT$ ${(amount || 0).toLocaleString()}`,
      target_role: '業務',
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[CRM] Quote generated notification failed:', error.message)
    })
  })

  // ── Member joined → send welcome notification ──
  bus.subscribe('crm.member.joined', async function onMemberJoinedWelcome(event) {
    const { member_name, member_number, level } = event.payload

    await supabase.from('notifications').insert({
      type: '新會員',
      title: `新會員加入：${member_name}（編號 ${member_number}，等級 ${level}）`,
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[CRM] Member joined notification failed:', error.message)
    })
  })

  // ── Member tier upgraded → send upgrade notification ──
  bus.subscribe('crm.member.tier_upgraded', async function onMemberTierUpgradedNotify(event) {
    const { member_name, old_tier, new_tier } = event.payload

    await supabase.from('notifications').insert({
      type: '會員升級',
      title: `${member_name} 會員等級升級：${old_tier} → ${new_tier}`,
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[CRM] Tier upgrade notification failed:', error.message)
    })
  })

  // ── Points earned → notify member ──
  bus.subscribe('crm.points.earned', async function onPointsEarnedNotify(event) {
    const { member_name, points, balance } = event.payload

    await supabase.from('notifications').insert({
      type: '點數累積',
      title: `${member_name} 累積 ${points} 點，餘額 ${balance} 點`,
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[CRM] Points earned notification failed:', error.message)
    })
  })

  // ── Points redeemed → notify member ──
  bus.subscribe('crm.points.redeemed', async function onPointsRedeemedNotify(event) {
    const { member_name, points, balance, discount_amount } = event.payload

    await supabase.from('notifications').insert({
      type: '點數兌換',
      title: `${member_name} 兌換 ${points} 點，折抵 NT$ ${discount_amount}，餘額 ${balance} 點`,
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[CRM] Points redeemed notification failed:', error.message)
    })
  })

  // ── Points reversed → notify member of deduction ──
  bus.subscribe('crm.points.reversed', async function onPointsReversedNotify(event) {
    const { member_name, points, balance, reason } = event.payload

    await supabase.from('notifications').insert({
      type: '點數扣回',
      title: `${member_name} 扣回 ${points} 點（${reason || '退款'}），餘額 ${balance} 點`,
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[CRM] Points reversed notification failed:', error.message)
    })
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
