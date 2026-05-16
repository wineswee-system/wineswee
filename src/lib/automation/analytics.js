import { supabase } from '../supabase'

// ── 7. 產品利潤分析 (Sales + WMS → Profitability) ──
export async function analyzeProductProfitability(dateRange) {
  const startDate = dateRange?.startDate || new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString().slice(0, 10)
  const endDate = dateRange?.endDate || new Date().toISOString().slice(0, 10)

  // Get sales order lines with SKU info
  const { data: orders } = await supabase
    .from('sales_orders')
    .select('id, customer, total, payment_status, created_at')
    .gte('created_at', startDate)
    .lte('created_at', endDate + 'T23:59:59')

  const orderIds = (orders || []).map(o => o.id)
  let lines = []
  if (orderIds.length > 0) {
    const { data: soLines } = await supabase
      .from('sales_order_lines')
      .select('*, skus(id, code, name, cost)')
      .in('order_id', orderIds)
    lines = soLines || []
  }

  // Get POS transactions for retail channel
  const { data: posData } = await supabase
    .from('pos_transactions')
    .select('*')
    .gte('created_at', startDate)
    .lte('created_at', endDate + 'T23:59:59')

  // Get cost layers for COGS
  const { data: costLayers } = await supabase
    .from('inventory_cost_layers')
    .select('*, skus(code, name)')

  // Build cost map: sku_code -> weighted avg cost
  const costMap = {}
  for (const layer of (costLayers || [])) {
    const code = layer.skus?.code
    if (!code) continue
    if (!costMap[code]) costMap[code] = { totalCost: 0, totalQty: 0 }
    costMap[code].totalCost += (layer.unit_cost || 0) * (layer.quantity_remaining || 0)
    costMap[code].totalQty += (layer.quantity_remaining || 0)
  }

  // Get stock levels for current inventory value
  const { data: stockLevels } = await supabase.from('stock_levels').select('*')

  // Get AR collection rates
  const { data: arData } = await supabase
    .from('accounts_receivable')
    .select('customer, amount, paid_amount, status')
    .gte('created_at', startDate)

  // Build profitability by SKU
  const skuProfit = {}
  for (const line of lines) {
    const sku = line.skus || {}
    const code = sku.code || line.sku_code || 'UNKNOWN'
    const revenue = (line.quantity || 0) * (line.unit_price || 0)
    const avgCost = costMap[code]?.totalQty > 0
      ? costMap[code].totalCost / costMap[code].totalQty
      : (sku.cost || 0)
    const cogs = (line.quantity || 0) * avgCost

    if (!skuProfit[code]) {
      skuProfit[code] = { code, name: sku.name || code, revenue: 0, cogs: 0, qty: 0, orders: 0 }
    }
    skuProfit[code].revenue += revenue
    skuProfit[code].cogs += cogs
    skuProfit[code].qty += (line.quantity || 0)
    skuProfit[code].orders += 1
  }

  // Build profitability by customer
  const customerProfit = {}
  for (const order of (orders || [])) {
    const name = order.customer || '未知客戶'
    if (!customerProfit[name]) {
      customerProfit[name] = { name, revenue: 0, orders: 0, avgOrderValue: 0 }
    }
    customerProfit[name].revenue += (order.total_amount || order.total || 0)
    customerProfit[name].orders += 1
  }

  // Add AR collection rate to customer profitability
  for (const ar of (arData || [])) {
    const name = ar.customer || '未知客戶'
    if (customerProfit[name]) {
      if (!customerProfit[name].arTotal) customerProfit[name].arTotal = 0
      if (!customerProfit[name].arPaid) customerProfit[name].arPaid = 0
      customerProfit[name].arTotal += (ar.amount || 0)
      customerProfit[name].arPaid += (ar.paid_amount || 0)
    }
  }

  for (const c of Object.values(customerProfit)) {
    c.avgOrderValue = c.orders > 0 ? Math.round(c.revenue / c.orders) : 0
    c.collectionRate = c.arTotal > 0 ? Math.round((c.arPaid / c.arTotal) * 100) : 100
  }

  // Calculate SKU margins
  const skuResults = Object.values(skuProfit).map(s => ({
    ...s,
    grossProfit: s.revenue - s.cogs,
    margin: s.revenue > 0 ? Math.round(((s.revenue - s.cogs) / s.revenue) * 100) : 0,
  })).sort((a, b) => b.grossProfit - a.grossProfit)

  const customerResults = Object.values(customerProfit).sort((a, b) => b.revenue - a.revenue)

  // POS channel summary
  const posRevenue = (posData || []).reduce((s, t) => s + (t.total || t.amount || 0), 0)
  const posCount = (posData || []).length

  const totalRevenue = skuResults.reduce((s, r) => s + r.revenue, 0) + posRevenue
  const totalCogs = skuResults.reduce((s, r) => s + r.cogs, 0)
  const totalMargin = totalRevenue > 0 ? Math.round(((totalRevenue - totalCogs) / totalRevenue) * 100) : 0

  return {
    byProduct: skuResults,
    byCustomer: customerResults,
    summary: { totalRevenue, totalCogs, grossProfit: totalRevenue - totalCogs, margin: totalMargin, posRevenue, posCount },
    period: { startDate, endDate },
  }
}

// ── 8. POS + CRM 統一客戶 360 ──
export async function getCustomer360(customerName) {
  // CRM data
  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('name', customerName)
    .maybeSingle()

  // Sales orders
  const { data: salesOrders } = await supabase
    .from('sales_orders')
    .select('*')
    .eq('customer', customerName)
    .order('created_at', { ascending: false })

  // POS transactions — pos_transactions 沒有 customer 欄位（只有 member_id）
  // 先用會員姓名比對；未來可補 member_id → customer 關聯
  const { data: memberForCustomer } = await supabase
    .from('members')
    .select('id')
    .eq('name', customerName)
    .maybeSingle()
  const { data: posTransactions } = memberForCustomer?.id
    ? await supabase
        .from('pos_transactions')
        .select('*')
        .eq('member_id', String(memberForCustomer.id))
        .order('created_at', { ascending: false })
    : { data: [] }

  // AR history
  const { data: arRecords } = await supabase
    .from('accounts_receivable')
    .select('*')
    .eq('customer', customerName)
    .order('created_at', { ascending: false })

  // Service tickets
  const { data: tickets } = await supabase
    .from('service_tickets')
    .select('*')
    .eq('customer', customerName)
    .order('created_at', { ascending: false })

  // Opportunities
  const { data: opportunities } = await supabase
    .from('opportunities')
    .select('*')
    .eq('customer', customerName)
    .order('created_at', { ascending: false })

  // Membership / loyalty
  const { data: member } = await supabase
    .from('members')
    .select('*')
    .eq('name', customerName)
    .maybeSingle()

  // Calculate unified metrics
  const b2bRevenue = (salesOrders || []).reduce((s, o) => s + (o.total_amount || o.total || 0), 0)
  const posRevenue = (posTransactions || []).reduce((s, t) => s + (t.total || t.amount || 0), 0)
  const totalRevenue = b2bRevenue + posRevenue
  const totalOrders = (salesOrders || []).length + (posTransactions || []).length
  const arOutstanding = (arRecords || []).filter(a => a.status !== '已收款').reduce((s, a) => s + (a.amount || 0) - (a.paid_amount || 0), 0)
  const arTotal = (arRecords || []).reduce((s, a) => s + (a.amount || 0), 0)
  const arPaid = (arRecords || []).reduce((s, a) => s + (a.paid_amount || 0), 0)
  const collectionRate = arTotal > 0 ? Math.round((arPaid / arTotal) * 100) : 100
  const openTickets = (tickets || []).filter(t => t.status !== '已結案' && t.status !== '已關閉').length

  return {
    customer,
    salesOrders: salesOrders || [],
    posTransactions: posTransactions || [],
    arRecords: arRecords || [],
    tickets: tickets || [],
    opportunities: opportunities || [],
    member,
    metrics: {
      totalRevenue, b2bRevenue, posRevenue,
      totalOrders,
      arOutstanding, collectionRate,
      openTickets,
      loyaltyPoints: member?.points || 0,
      loyaltyTier: member?.tier || '—',
    },
  }
}

// ── 9. 銷售預測 → MRP 需求驅動採購 ──
export async function runForecastDrivenMRP(forecastMonths = 3) {
  // Get historical sales by SKU (past 6 months)
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const { data: orders } = await supabase
    .from('sales_orders')
    .select('id, created_at')
    .gte('created_at', sixMonthsAgo.toISOString())
    .not('payment_status', 'in', '("已取消")')

  const orderIds = (orders || []).map(o => o.id)
  let lines = []
  if (orderIds.length > 0) {
    const { data: soLines } = await supabase
      .from('sales_order_lines')
      .select('*, skus(id, code, name)')
      .in('order_id', orderIds)
    lines = soLines || []
  }

  // Also get POS data for trend
  const { data: posData } = await supabase
    .from('pos_transactions')
    .select('*')
    .gte('created_at', sixMonthsAgo.toISOString())

  // Build monthly demand by SKU
  const monthlyDemand = {}
  for (const line of lines) {
    const order = orders.find(o => o.id === line.order_id)
    if (!order) continue
    const month = order.created_at?.slice(0, 7)
    const code = line.skus?.code || line.sku_code || 'UNKNOWN'
    const name = line.skus?.name || code
    const key = `${code}__${month}`
    if (!monthlyDemand[key]) monthlyDemand[key] = { code, name, month, qty: 0 }
    monthlyDemand[key].qty += (line.quantity || 0)
  }

  // Aggregate by SKU → calculate avg monthly demand
  const skuAvg = {}
  for (const d of Object.values(monthlyDemand)) {
    if (!skuAvg[d.code]) skuAvg[d.code] = { code: d.code, name: d.name, months: {}, totalQty: 0, monthCount: 0 }
    skuAvg[d.code].months[d.month] = d.qty
    skuAvg[d.code].totalQty += d.qty
    skuAvg[d.code].monthCount += 1
  }

  // Simple linear forecast: avg × forecast months with 20% safety buffer
  const forecastDemand = []
  for (const sku of Object.values(skuAvg)) {
    const avgMonthly = sku.monthCount > 0 ? sku.totalQty / sku.monthCount : 0
    const forecastQty = Math.ceil(avgMonthly * forecastMonths * 1.2)
    if (forecastQty > 0) {
      forecastDemand.push({
        sku_code: sku.code,
        sku_name: sku.name,
        quantity: forecastQty,
        avg_monthly: Math.round(avgMonthly),
        confidence: sku.monthCount >= 4 ? 'high' : sku.monthCount >= 2 ? 'medium' : 'low',
      })
    }
  }

  // Get current stock
  const { data: stockData } = await supabase.from('stock_levels').select('*')
  const stockMap = {}
  for (const s of (stockData || [])) {
    const code = s.sku_code || s.product_code || s.code
    if (code) {
      if (!stockMap[code]) stockMap[code] = 0
      stockMap[code] += (s.on_hand || s.quantity || s.qty || 0)
    }
  }

  // Get open PO quantities
  const { data: poData } = await supabase
    .from('purchase_orders')
    .select('*')
    .not('status', 'in', '("已完成","已取消","已關閉")')

  const onOrderMap = {}
  for (const po of (poData || [])) {
    if (po.items && Array.isArray(po.items)) {
      for (const item of po.items) {
        const code = item.product_code || item.code || item.sku_code
        if (code) {
          if (!onOrderMap[code]) onOrderMap[code] = 0
          onOrderMap[code] += (item.qty || item.quantity || 0)
        }
      }
    }
  }

  // Calculate net requirements
  const suggestions = forecastDemand.map(f => {
    const onHand = stockMap[f.sku_code] || 0
    const onOrder = onOrderMap[f.sku_code] || 0
    const netReq = f.quantity - onHand - onOrder
    return {
      ...f,
      on_hand: onHand,
      on_order: onOrder,
      net_requirement: Math.max(0, netReq),
      action: netReq > 0 ? 'purchase' : 'sufficient',
      suggested_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    }
  }).sort((a, b) => b.net_requirement - a.net_requirement)

  return {
    forecast: suggestions,
    summary: {
      totalSkus: suggestions.length,
      needPurchase: suggestions.filter(s => s.action === 'purchase').length,
      totalForecastQty: suggestions.reduce((s, f) => s + f.quantity, 0),
      totalNetReq: suggestions.reduce((s, f) => s + f.net_requirement, 0),
    },
    forecastMonths,
  }
}

// ── 10. 供應鏈風險評分 (Vendor + QC + Lots) ──
export async function analyzeSupplyChainRisk() {
  const { data: suppliers } = await supabase.from('suppliers').select('*')
  const { data: vendorPerf } = await supabase.from('vendor_performance').select('*')
  const { data: qcData } = await supabase.from('quality_inspections').select('*')
  const { data: goodsReceipts } = await supabase.from('goods_receipts').select('*')
  const { data: lots } = await supabase.from('inventory_lots').select('*')
  const { data: pos } = await supabase.from('purchase_orders').select('*')

  // Build vendor scorecard
  const vendorScores = {}
  for (const supplier of (suppliers || [])) {
    const name = supplier.name || supplier.company_name
    vendorScores[name] = {
      name,
      code: supplier.code,
      deliveryScore: 100,
      qualityScore: 100,
      lotRejectionRate: 0,
      avgLeadTime: 0,
      totalOrders: 0,
      lateDeliveries: 0,
      qcFailures: 0,
      riskLevel: 'low',
      riskScore: 0,
    }
  }

  // Vendor performance data
  for (const perf of (vendorPerf || [])) {
    const name = perf.supplier || perf.vendor
    if (vendorScores[name]) {
      vendorScores[name].deliveryScore = perf.delivery_score || perf.on_time_rate || 100
      vendorScores[name].qualityScore = perf.quality_score || perf.quality_rate || 100
    }
  }

  // QC failure rates by supplier (from GR → supplier mapping)
  const grBySupplier = {}
  for (const gr of (goodsReceipts || [])) {
    const supplier = gr.supplier || gr.vendor
    if (supplier) {
      if (!grBySupplier[supplier]) grBySupplier[supplier] = { total: 0, ids: [] }
      grBySupplier[supplier].total += 1
      grBySupplier[supplier].ids.push(gr.id)
    }
  }

  // Map QC inspections to suppliers
  for (const qc of (qcData || [])) {
    for (const [supplier, grInfo] of Object.entries(grBySupplier)) {
      if (vendorScores[supplier]) {
        if (qc.result === '不合格' || qc.result === 'fail' || qc.status === '不合格') {
          vendorScores[supplier].qcFailures += 1
        }
      }
    }
  }

  // Lot expiry risk
  const now = new Date()
  const nearExpiry = (lots || []).filter(l => {
    if (!l.expiry_date) return false
    const expiry = new Date(l.expiry_date)
    const daysUntil = (expiry - now) / 86400000
    return daysUntil < 30 && daysUntil > 0
  })

  // Calculate composite risk score
  for (const v of Object.values(vendorScores)) {
    const deliveryRisk = Math.max(0, 100 - (v.deliveryScore || 100))
    const qualityRisk = Math.max(0, 100 - (v.qualityScore || 100))
    const qcRisk = v.qcFailures * 15
    v.riskScore = Math.min(100, Math.round(deliveryRisk * 0.4 + qualityRisk * 0.4 + qcRisk * 0.2))
    v.riskLevel = v.riskScore >= 60 ? 'high' : v.riskScore >= 30 ? 'medium' : 'low'
  }

  const results = Object.values(vendorScores).sort((a, b) => b.riskScore - a.riskScore)

  return {
    vendors: results,
    lotsNearExpiry: nearExpiry.length,
    summary: {
      totalVendors: results.length,
      highRisk: results.filter(v => v.riskLevel === 'high').length,
      mediumRisk: results.filter(v => v.riskLevel === 'medium').length,
      lowRisk: results.filter(v => v.riskLevel === 'low').length,
      avgRiskScore: results.length > 0 ? Math.round(results.reduce((s, v) => s + v.riskScore, 0) / results.length) : 0,
    },
  }
}

// ── 11. HR + 製造 → 單位人工成本 ──
export async function analyzeLaborCostPerUnit(month) {
  const targetMonth = month || new Date().toISOString().slice(0, 7)

  // Get salary records for the month
  const { data: salaries } = await supabase
    .from('salary_records')
    .select('*')
    .eq('month', targetMonth)

  // Get attendance for the month
  const monthStart = targetMonth + '-01'
  const [y, m] = targetMonth.split('-').map(Number)
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`

  const { data: attendance } = await supabase
    .from('attendance_records')
    .select('*')
    .gte('date', monthStart)
    .lt('date', nextMonth)

  // Get manufacturing orders completed in this period
  const { data: mfgOrders } = await supabase
    .from('manufacturing_orders')
    .select('*')
    .gte('created_at', monthStart)
    .lt('created_at', nextMonth)

  // Calculate total labor hours from attendance
  const totalHours = (attendance || []).reduce((sum, a) => {
    if (a.clock_in && a.clock_out) {
      const inTime = new Date(`${a.date}T${a.clock_in}`)
      const outTime = new Date(`${a.date}T${a.clock_out}`)
      return sum + Math.max(0, (outTime - inTime) / 3600000)
    }
    return sum + 8 // default 8 hours if no clock data
  }, 0)

  // Total labor cost
  const totalLaborCost = (salaries || []).reduce((s, sal) => s + (sal.net_salary || sal.base_salary || 0), 0)

  // Total units produced
  const totalUnitsProduced = (mfgOrders || []).reduce((s, mo) => {
    if (mo.status === '已完成' || mo.status === '完成') {
      return s + (mo.quantity || mo.qty || 0)
    }
    return s
  }, 0)

  // Cost per hour
  const costPerHour = totalHours > 0 ? Math.round(totalLaborCost / totalHours) : 0

  // Cost per unit
  const costPerUnit = totalUnitsProduced > 0 ? Math.round(totalLaborCost / totalUnitsProduced) : 0

  // Breakdown by MO
  const moBreakdown = (mfgOrders || []).map(mo => {
    const qty = mo.quantity || mo.qty || 0
    const laborAlloc = totalUnitsProduced > 0 ? Math.round((qty / totalUnitsProduced) * totalLaborCost) : 0
    return {
      orderNumber: mo.order_number || mo.mo_number || `MO-${mo.id}`,
      product: mo.product_name || mo.product || '—',
      quantity: qty,
      status: mo.status,
      allocatedLaborCost: laborAlloc,
      laborCostPerUnit: qty > 0 ? Math.round(laborAlloc / qty) : 0,
    }
  })

  return {
    month: targetMonth,
    totalLaborCost,
    totalHours: Math.round(totalHours),
    totalUnitsProduced,
    costPerHour,
    costPerUnit,
    employeeCount: (salaries || []).length,
    moBreakdown,
  }
}

// ── 12. 促銷 ROI 分析 (Promotions → POS → Margin) ──
export async function analyzePromotionROI() {
  const { data: promotions } = await supabase.from('promotions').select('*')
  const { data: posData } = await supabase.from('pos_transactions').select('*')
  const { data: costLayers } = await supabase.from('inventory_cost_layers').select('*, skus(code, name)')

  // Build cost map
  const costMap = {}
  for (const layer of (costLayers || [])) {
    const code = layer.skus?.code
    if (!code) continue
    if (!costMap[code]) costMap[code] = { totalCost: 0, totalQty: 0 }
    costMap[code].totalCost += (layer.unit_cost || 0) * (layer.quantity_remaining || 0)
    costMap[code].totalQty += (layer.quantity_remaining || 0)
  }

  const results = (promotions || []).map(promo => {
    const startDate = promo.start_date || promo.created_at?.slice(0, 10)
    const endDate = promo.end_date || new Date().toISOString().slice(0, 10)

    // POS transactions during promo period
    const duringPromo = (posData || []).filter(t => {
      const txDate = (t.created_at || t.date || '').slice(0, 10)
      return txDate >= startDate && txDate <= endDate
    })

    // Baseline: similar period before promo
    const promoDays = Math.max(1, (new Date(endDate) - new Date(startDate)) / 86400000)
    const baselineStart = new Date(new Date(startDate).getTime() - promoDays * 86400000).toISOString().slice(0, 10)
    const baseline = (posData || []).filter(t => {
      const txDate = (t.created_at || t.date || '').slice(0, 10)
      return txDate >= baselineStart && txDate < startDate
    })

    const promoRevenue = duringPromo.reduce((s, t) => s + (t.total || t.amount || 0), 0)
    const baselineRevenue = baseline.reduce((s, t) => s + (t.total || t.amount || 0), 0)
    const salesLift = baselineRevenue > 0 ? Math.round(((promoRevenue - baselineRevenue) / baselineRevenue) * 100) : 0
    const discountCost = promo.budget || promo.discount_amount || 0

    // Estimate margin
    const estimatedCogs = promoRevenue * 0.6 // rough estimate if no line-level data
    const netMargin = promoRevenue - estimatedCogs - discountCost
    const roi = discountCost > 0 ? Math.round(((promoRevenue - baselineRevenue - discountCost) / discountCost) * 100) : 0

    return {
      id: promo.id,
      name: promo.name || promo.title || `促銷 #${promo.id}`,
      type: promo.type || '一般',
      startDate,
      endDate,
      status: promo.status || '進行中',
      promoRevenue,
      baselineRevenue,
      salesLift,
      transactionCount: duringPromo.length,
      baselineCount: baseline.length,
      discountCost,
      netMargin: Math.round(netMargin),
      roi,
    }
  }).sort((a, b) => b.roi - a.roi)

  const totalPromoRevenue = results.reduce((s, r) => s + r.promoRevenue, 0)
  const totalBaselineRevenue = results.reduce((s, r) => s + r.baselineRevenue, 0)
  const totalDiscountCost = results.reduce((s, r) => s + r.discountCost, 0)

  return {
    promotions: results,
    summary: {
      totalPromotions: results.length,
      totalPromoRevenue,
      totalSalesLift: totalBaselineRevenue > 0
        ? Math.round(((totalPromoRevenue - totalBaselineRevenue) / totalBaselineRevenue) * 100) : 0,
      totalDiscountCost,
      avgROI: results.length > 0 ? Math.round(results.reduce((s, r) => s + r.roi, 0) / results.length) : 0,
    },
  }
}

// ── 13. 流程 → 業務結果關聯分析 ──
export async function analyzeWorkflowBusinessOutcomes() {
  const { data: workflows } = await supabase.from('workflows').select('*')
  const { data: tasks } = await supabase.from('tasks').select('*')
  const { data: salesOrders } = await supabase.from('sales_orders').select('*')
  const { data: pos } = await supabase.from('purchase_orders').select('*')
  const { data: mfgOrders } = await supabase.from('manufacturing_orders').select('*')
  const { data: shipments } = await supabase.from('shipments').select('*')

  // Calculate process cycle times
  const orderToShip = (salesOrders || []).map(so => {
    const ship = (shipments || []).find(s => s.order_ref === so.id || s.order_ref === so.order_number)
    if (ship && so.created_at && ship.created_at) {
      const days = (new Date(ship.created_at) - new Date(so.created_at)) / 86400000
      return { orderId: so.id, customer: so.customer, days: Math.round(days * 10) / 10 }
    }
    return null
  }).filter(Boolean)

  const avgOrderToShip = orderToShip.length > 0
    ? Math.round(orderToShip.reduce((s, o) => s + o.days, 0) / orderToShip.length * 10) / 10
    : 0

  // PO to GR cycle time
  const { data: goodsReceipts } = await supabase.from('goods_receipts').select('*')
  const poToGR = (pos || []).map(po => {
    const gr = (goodsReceipts || []).find(g => g.po_ref === po.po_number || g.po_id === po.id)
    if (gr && po.created_at && gr.created_at) {
      const days = (new Date(gr.created_at) - new Date(po.created_at)) / 86400000
      return { poId: po.id, supplier: po.supplier, days: Math.round(days * 10) / 10 }
    }
    return null
  }).filter(Boolean)

  const avgPoToGR = poToGR.length > 0
    ? Math.round(poToGR.reduce((s, o) => s + o.days, 0) / poToGR.length * 10) / 10
    : 0

  // MO cycle time
  const moCycleTime = (mfgOrders || []).map(mo => {
    if (mo.start_date && mo.end_date) {
      const days = (new Date(mo.end_date) - new Date(mo.start_date)) / 86400000
      return { moId: mo.id, product: mo.product_name, days: Math.round(days * 10) / 10 }
    }
    return null
  }).filter(Boolean)

  const avgMoCycle = moCycleTime.length > 0
    ? Math.round(moCycleTime.reduce((s, o) => s + o.days, 0) / moCycleTime.length * 10) / 10
    : 0

  // Task completion rates
  const totalTasks = (tasks || []).length
  const completedTasks = (tasks || []).filter(t => t.status === '已完成' || t.status === 'completed').length
  const overdueTasks = (tasks || []).filter(t => {
    if (t.due_date && t.status !== '已完成' && t.status !== 'completed') {
      return new Date(t.due_date) < new Date()
    }
    return false
  }).length

  // Workflow bottleneck analysis
  const workflowStatus = {}
  for (const wf of (workflows || [])) {
    const status = wf.status || '進行中'
    if (!workflowStatus[status]) workflowStatus[status] = 0
    workflowStatus[status] += 1
  }

  return {
    cycleTime: {
      orderToShip: { avg: avgOrderToShip, data: orderToShip.slice(0, 20), total: orderToShip.length },
      poToGR: { avg: avgPoToGR, data: poToGR.slice(0, 20), total: poToGR.length },
      moCycle: { avg: avgMoCycle, data: moCycleTime.slice(0, 20), total: moCycleTime.length },
    },
    tasks: { total: totalTasks, completed: completedTasks, overdue: overdueTasks, completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0 },
    workflowStatus,
  }
}
