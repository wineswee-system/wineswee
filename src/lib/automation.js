import { supabase } from './supabase'

/**
 * SME OPS 自動化引擎
 *
 * 勾稽邏輯:
 * 1. CRM 訂單 → 檢查 WMS 庫存 → 不足自動產生採購建議 (PR)
 * 2. WMS 出貨完成 → 自動拋轉 AR 應收帳款
 * 3. 成本核算: WMS 進貨成本 + HR 人工成本 = 毛利
 */

// ── 1. CRM → WMS → 採購建議 ──
// 當 CRM 建立銷售訂單時，檢查 WMS 庫存，不足則自動產生採購申請
export async function checkStockAndCreatePR(orderItems, requester = '系統') {
  const shortages = []

  for (const item of orderItems) {
    // 查 WMS 庫存
    const { data: stock } = await supabase
      .from('stock_levels')
      .select('*')
      .eq('sku_name', item.name)
      .maybeSingle()

    const available = stock?.quantity || 0
    const needed = item.qty || 0

    if (available < needed) {
      shortages.push({
        name: item.name,
        current_stock: available,
        needed: needed,
        shortage: needed - available,
        // 建議採購量 = 缺少量 × 1.5 (安全係數)
        suggested_qty: Math.ceil((needed - available) * 1.5),
        unit: stock?.unit || item.unit || '個',
        price: stock?.unit_cost || item.price || 0,
      })
    }
  }

  if (shortages.length === 0) return { ok: true, shortages: [], pr: null }

  // 自動產生採購申請
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
    requester,
    department: '系統自動',
    items: prItems,
    total_amount: totalAmount,
    reason: `庫存不足自動產生（${shortages.map(s => s.name).join('、')}）`,
    status: '待審核',
  }).select().single()

  if (error) return { ok: false, error: error.message }

  return { ok: true, shortages, pr }
}

// ── 2. WMS 出貨 → AR 應收帳款 ──
// 當 WMS 出貨單完成時，自動建立應收帳款
export async function createARFromShipment(shipment) {
  const invoiceNumber = `INV-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-3)}`

  const { data: ar, error: arError } = await supabase.from('accounts_receivable').insert({
    invoice_number: invoiceNumber,
    customer: shipment.customer,
    order_ref: shipment.order_ref || shipment.id,
    amount: shipment.total_amount,
    paid_amount: 0,
    due_date: getDueDate(30), // NET30
    status: '未收款',
  }).select().single()

  if (arError) return { ok: false, error: arError.message }

  // 同時產生傳票
  if (ar) {
    const entryNumber = `JE-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-3)}`
    const { data: entry, error: entryError } = await supabase.from('journal_entries').insert({
      entry_number: entryNumber,
      entry_date: new Date().toISOString().slice(0, 10),
      description: `出貨產生應收 - ${shipment.customer} (${invoiceNumber})`,
      source: '出貨',
      source_id: shipment.id,
      status: '已過帳',
      created_by: '系統',
    }).select().single()

    if (entryError) return { ok: false, error: entryError.message }

    if (entry) {
      const { error: linesError } = await supabase.from('journal_lines').insert([
        {
          entry_id: entry.id,
          account_code: '1300',
          account_name: '應收帳款',
          debit: shipment.total_amount,
          credit: 0,
          memo: `${shipment.customer} - ${invoiceNumber}`,
        },
        {
          entry_id: entry.id,
          account_code: '4100',
          account_name: '營業收入',
          debit: 0,
          credit: shipment.total_amount,
          memo: `${shipment.customer} - ${invoiceNumber}`,
        },
      ])
      if (linesError) return { ok: false, error: linesError.message }
    }
  }

  return ar
}

// ── 3. 採購入庫 → AP 應付帳款 ──
// 當進貨驗收完成，自動建立應付帳款
export async function createAPFromReceipt(receipt, po) {
  const billNumber = `BILL-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-3)}`
  const amount = (po.total_amount || 0) + (po.tax || 0) + (po.shipping || 0)
  const paymentDays = parsePaymentTerms(po.payment_terms)

  const { data: ap, error: apError } = await supabase.from('accounts_payable').insert({
    bill_number: billNumber,
    supplier: po.supplier,
    po_ref: po.po_number,
    amount,
    paid_amount: 0,
    due_date: getDueDate(paymentDays),
    status: '未付款',
  }).select().single()

  if (apError) return { ok: false, error: apError.message }

  // 產生傳票
  if (ap) {
    const entryNumber = `JE-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-3)}A`
    const { data: entry, error: entryError } = await supabase.from('journal_entries').insert({
      entry_number: entryNumber,
      entry_date: new Date().toISOString().slice(0, 10),
      description: `採購入庫 - ${po.supplier} (${po.po_number})`,
      source: '採購',
      source_id: po.id,
      status: '已過帳',
      created_by: '系統',
    }).select().single()

    if (entryError) return { ok: false, error: entryError.message }

    if (entry) {
      const { error: linesError } = await supabase.from('journal_lines').insert([
        {
          entry_id: entry.id,
          account_code: '5100',
          account_name: '營業成本',
          debit: amount,
          credit: 0,
          memo: `${po.supplier} - ${po.po_number}`,
        },
        {
          entry_id: entry.id,
          account_code: '2100',
          account_name: '應付帳款',
          debit: 0,
          credit: amount,
          memo: `${po.supplier} - ${po.po_number}`,
        },
      ])
      if (linesError) return { ok: false, error: linesError.message }
    }
  }

  return ap
}

// ── 4. 成本核算 ──
// 計算指定期間的毛利
export async function calculateProfitability(month) {
  // month format: '2026-04'
  const monthStart = month + '-01'
  const [y, m] = month.split('-').map(Number)
  const nextMonthStart = m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, '0')}-01`

  // 收入: AR 已收款金額
  const { data: arRecords } = await supabase
    .from('accounts_receivable')
    .select('amount, paid_amount')
    .gte('created_at', monthStart)
    .lt('created_at', nextMonthStart)

  const revenue = (arRecords || []).reduce((s, r) => s + (r.paid_amount || 0), 0)

  // 進貨成本: AP 金額
  const { data: apRecords } = await supabase
    .from('accounts_payable')
    .select('amount, paid_amount')
    .gte('created_at', monthStart)
    .lt('created_at', nextMonthStart)

  const purchaseCost = (apRecords || []).reduce((s, r) => s + (r.amount || 0), 0)

  // 人工成本: 薪資
  const { data: salaryRecords } = await supabase
    .from('salary_records')
    .select('net_salary')
    .eq('month', month)

  const laborCost = (salaryRecords || []).reduce((s, r) => s + (r.net_salary || 0), 0)

  const totalCost = purchaseCost + laborCost
  const grossProfit = revenue - totalCost
  const grossMargin = revenue > 0 ? Math.round((grossProfit / revenue) * 100) : 0

  return {
    revenue,
    purchaseCost,
    laborCost,
    totalCost,
    grossProfit,
    grossMargin,
  }
}

// ── 5. 特休結清 ──
// 到職滿一年，未使用的特休在下月薪資結清
// 例：3月到職 → 隔年3月週年 → 4月薪資結清未休特休
export async function calculateAnnualLeaveSettlement() {
  const today = new Date()
  const currentMonth = today.toISOString().slice(0, 7) // e.g. 2026-04

  const { data: employees } = await supabase
    .from('employees').select('*').eq('status', '在職')

  if (!employees) return []

  const settlements = []

  for (const emp of employees) {
    if (!emp.join_date) continue

    const joinDate = new Date(emp.join_date)
    const yearsWorked = Math.floor((today - joinDate) / (365.25 * 86400000))

    if (yearsWorked < 1) continue

    // Anniversary month: join_date month
    const anniversaryMonth = joinDate.getMonth() // 0-based
    // Settlement month = anniversary month + 1
    const settlementMonth = anniversaryMonth + 1 // 1-based for display
    const currentMonthNum = today.getMonth() + 1

    // Only process in the settlement month
    if (currentMonthNum !== (settlementMonth === 13 ? 1 : settlementMonth)) continue

    // Idempotency check: skip if settlement already exists for this employee+year
    const settlementYear = today.getFullYear()
    const { data: existing } = await supabase
      .from('leave_settlements')
      .select('id')
      .eq('employee', emp.name)
      .eq('settlement_month', currentMonth)
      .maybeSingle()

    if (existing) continue

    // Calculate entitled annual leave based on Taiwan labor law
    let entitled = 0
    if (yearsWorked >= 10) entitled = 30
    else if (yearsWorked >= 5) entitled = 15
    else if (yearsWorked >= 3) entitled = 14
    else if (yearsWorked >= 2) entitled = 10
    else entitled = 7 // 1 year

    // Get used leave in the past year
    const yearStart = new Date(today.getFullYear() - 1, anniversaryMonth, joinDate.getDate())
    const { data: leaves } = await supabase
      .from('leave_requests')
      .select('days')
      .eq('employee', emp.name)
      .eq('type', '特休')
      .eq('status', '已核准')
      .gte('start_date', yearStart.toISOString().slice(0, 10))

    const used = (leaves || []).reduce((s, l) => s + (l.days || 0), 0)
    const unused = Math.max(0, entitled - used)

    if (unused > 0) {
      // Calculate daily rate for settlement
      const { data: salary } = await supabase
        .from('salary_records')
        .select('base_salary')
        .eq('employee', emp.name)
        .order('month', { ascending: false })
        .limit(1)
        .maybeSingle()

      const dailyRate = salary ? (salary.base_salary || 0) / 30 : 0
      const settlementAmount = Math.round(unused * dailyRate)

      settlements.push({
        employee: emp.name,
        yearsWorked,
        entitled,
        used,
        unused,
        dailyRate: Math.round(dailyRate),
        settlementAmount,
        settlementMonth: currentMonth,
      })
    }
  }

  return settlements
}

// ── Helpers ──

function getDueDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function parsePaymentTerms(terms) {
  if (!terms) return 30
  if (terms === 'COD') return 0
  const match = terms.match(/NET(\d+)/)
  return match ? parseInt(match[1]) : 30
}
