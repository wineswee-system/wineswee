import { supabase } from '../../supabase.js'
import { calculatePointsEarned, calculateTier, refundPoints, computePointsEarned, computeTierFromLevels } from '../../crmEngine.js'

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

  // ── POS transaction completed → update loyalty points (DB-driven tiers) ──
  bus.subscribe('pos.transaction.completed', async function onPOSTransactionUpdateLoyalty(event) {
    const { customer_id, total, store, points_used } = event.payload
    if (!customer_id) return

    const { data: member } = await supabase
      .from('members')
      .select('*')
      .eq('id', customer_id)
      .maybeSingle()

    if (!member) return

    // Fetch DB-driven tiers for this org (fallback to legacy calculation if none configured)
    const { data: levels } = member.organization_id
      ? await supabase.from('member_levels').select('*').eq('organization_id', member.organization_id).order('rank', { ascending: true })
      : { data: null }

    let pointsEarned, newLifetimeSpend, newLifetimePoints, newLevel

    if (levels?.length) {
      const currentLevel = levels.find(l => l.id === member.level_id) || levels[0]
      pointsEarned    = computePointsEarned(total, currentLevel)
      newLifetimeSpend  = (member.lifetime_spend  || member.total_spent  || 0) + total
      newLifetimePoints = (member.lifetime_points || member.total_points || 0) + pointsEarned
      newLevel = computeTierFromLevels(newLifetimeSpend, newLifetimePoints, levels) || currentLevel
    } else {
      // Fallback: legacy hard-coded tiers
      pointsEarned    = calculatePointsEarned(total, member.level)
      newLifetimeSpend  = (member.total_spent  || 0) + total
      newLifetimePoints = (member.total_points || 0) + pointsEarned
      const legacyTier = calculateTier(newLifetimeSpend, newLifetimePoints)
      newLevel = { id: null, name: legacyTier.level }
    }

    const pointsRedeemed = Number(points_used) || 0
    const newAvailablePoints = (member.available_points || 0) + pointsEarned - pointsRedeemed
    const tierChanged = levels?.length
      ? newLevel.id !== (member.level_id ?? null)
      : newLevel.name !== member.level

    const earnBalance = (member.available_points || 0) + pointsEarned
    const dbOps = [
      supabase.from('members').update({
        total_points:     newLifetimePoints,
        available_points: newAvailablePoints,
        total_spent:      newLifetimeSpend,
        level:            newLevel.name,
        lifetime_spend:   newLifetimeSpend,
        lifetime_points:  newLifetimePoints,
        ...(newLevel.id ? { level_id: newLevel.id } : {}),
        visit_count: (member.visit_count || 0) + 1,
        last_visit: new Date().toISOString().slice(0, 10),
      }).eq('id', member.id),

      supabase.from('point_transactions').insert({
        member_id:       member.id,
        organization_id: member.organization_id || null,
        type:            'earn',
        points:          pointsEarned,
        balance:         earnBalance,
        reference:       `POS-${event.id || Date.now()}`,
        description:     `POS消費累點 ($${total.toLocaleString()})`,
      }),
    ]

    if (pointsRedeemed > 0) {
      dbOps.push(
        supabase.from('point_transactions').insert({
          member_id:       member.id,
          organization_id: member.organization_id || null,
          type:            'redeem',
          points:          -pointsRedeemed,
          balance:         newAvailablePoints,
          reference:       `POS-REDEEM-${event.id || Date.now()}`,
          description:     `POS點數折抵（${pointsRedeemed}點，折抵NT$${Math.floor(pointsRedeemed * 0.5)}）`,
        })
      )
    }

    await Promise.all(dbOps)

    if (tierChanged && newLevel.id) {
      await supabase.from('member_level_history').insert({
        member_id:       member.id,
        organization_id: member.organization_id || null,
        from_level_id:   member.level_id || null,
        to_level_id:     newLevel.id,
        from_level_name: member.level || null,
        to_level_name:   newLevel.name,
        reason:          'upgrade',
      })

      await bus.publish('crm.member.tier_upgraded', {
        member_id:    String(member.id),
        member_name:  member.name,
        old_tier:     member.level,
        new_tier:     newLevel.name,
        new_level_id: newLevel.id || null,
      }, {
        causation_id:    event.id,
        correlation_id:  event.metadata?.correlation_id,
      })
    }

    await bus.publish('crm.points.earned', {
      member_id:   String(member.id),
      member_name: member.name,
      points:      pointsEarned,
      balance:     newAvailablePoints,
      source:      'pos_transaction',
    }, {
      causation_id:   event.id,
      correlation_id: event.metadata?.correlation_id,
    })

    if (pointsRedeemed > 0) {
      await bus.publish('crm.points.redeemed', {
        member_id:       String(member.id),
        member_name:     member.name,
        points:          pointsRedeemed,
        balance:         newAvailablePoints,
        discount_amount: Math.floor(pointsRedeemed * 0.5),
        source:          'pos_transaction',
      }, {
        causation_id:   event.id,
        correlation_id: event.metadata?.correlation_id,
      })
    }
  })

  // ── POS transaction completed → record member_purchase + lines ──
  bus.subscribe('pos.transaction.completed', async function onPOSTransactionRecordPurchase(event) {
    const { customer_id, total, store_id, transaction_id, payment_method, items } = event.payload
    if (!customer_id || !items?.length) return

    // Fetch member to get organization_id (NOT NULL in schema)
    const { data: member } = await supabase
      .from('members')
      .select('id, organization_id')
      .eq('id', customer_id)
      .maybeSingle()
    if (!member?.organization_id) return

    // Normalize zh-TW display labels → DB enum values
    const PM_MAP = {
      '現金': 'cash',      'cash': 'cash',
      '信用卡': 'card',    '刷卡': 'card',     'card': 'card',
      '行動支付': 'line_pay', 'LINE Pay': 'line_pay', 'line_pay': 'line_pay',
      'Apple Pay': 'apple_pay', 'apple_pay': 'apple_pay',
      '銀行轉帳': 'transfer', 'transfer': 'transfer',
      '兌換券': 'voucher',  'voucher': 'voucher',
    }
    const pmNorm = PM_MAP[payment_method] ?? null

    // Safely coerce transaction_id to integer (rejects non-numeric strings like "POS-123456")
    const txnIdInt = transaction_id && /^\d+$/.test(String(transaction_id))
      ? Number(transaction_id) : null

    const { data: purchase, error } = await supabase.from('member_purchases').insert({
      member_id:       customer_id,
      organization_id: member.organization_id,
      store_id:        store_id || null,
      transaction_id:  txnIdInt,
      total_amount:    total,
      payment_method:  pmNorm,
    }).select().single()

    if (error || !purchase) {
      if (error) console.warn('[CRM] member_purchases insert failed:', error.message)
      return
    }

    // POS item categories are zh-TW free-text; DB enum is wine/beer/… — store null to avoid CHECK violation
    const lines = items.map(item => ({
      purchase_id:      purchase.id,
      product_id:       item.product_id || item.sku_id || null,
      product_name:     item.product_name || item.name || '',
      product_category: null,
      product_type:     item.product_type || null,
      qty:              item.qty ?? item.quantity ?? 1,
      unit_price:       item.unit_price ?? item.price ?? 0,
      subtotal:         item.subtotal ?? (item.qty ?? 1) * (item.unit_price ?? item.price ?? 0),
    }))

    await supabase.from('member_purchase_lines').insert(lines).then(({ error: le }) => {
      if (le) console.warn('[CRM] member_purchase_lines insert failed:', le.message)
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

  // ── POS transaction completed → queue survey invitations ──
  bus.subscribe('pos.transaction.completed', async function onPurchaseRecordedQueueSurvey(event) {
    const { customer_id, total, store_id, transaction_id } = event.payload
    if (!customer_id) return

    const { data: member } = await supabase.from('members').select('id, level_id, lifetime_spend, organization_id').eq('id', customer_id).maybeSingle()
    if (!member) return

    const orgId = member.organization_id
    if (!orgId) return

    const { data: activeSurveys } = await supabase
      .from('surveys')
      .select('id, trigger_delay_hours, expires_in_days, min_purchase_amount, target_level_id')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .eq('trigger_type', 'post_purchase')

    if (!activeSurveys?.length) return

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    for (const survey of activeSurveys) {
      // Check eligibility
      if (survey.min_purchase_amount != null && total < survey.min_purchase_amount) continue
      if (survey.target_level_id && member.level_id !== survey.target_level_id) continue

      // 30-day dedup: skip if member already has a non-pilot invitation for this survey in last 30 days
      const { data: existing } = await supabase
        .from('survey_invitations')
        .select('id')
        .eq('survey_id', survey.id)
        .eq('member_id', customer_id)
        .is('pilot_run_id', null)
        .gte('created_at', thirtyDaysAgo)
        .limit(1)

      if (existing?.length) continue

      const sendAfter = new Date(Date.now() + (survey.trigger_delay_hours || 24) * 60 * 60 * 1000).toISOString()
      const expiresAt = new Date(Date.now() + ((survey.trigger_delay_hours || 24) + (survey.expires_in_days || 7) * 24) * 60 * 60 * 1000).toISOString()

      await supabase.from('survey_invitations').insert({
        survey_id:       survey.id,
        member_id:       customer_id,
        organization_id: orgId,
        purchase_id:     null,
        status:          'pending',
        send_after:      sendAfter,
        expires_at:      expiresAt,
        pilot_run_id:    null,
      })
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
