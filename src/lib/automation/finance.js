import { supabase } from '../supabase'
import { workflow, step, fanOut, fanIn, registerStep } from '../workflow/index.js'

// ── Monthly Close Workflow ──
// Usage: await workflow.start('monthly-close', { month: '2026-05' })
//
// DAG:
//   ledger.lock
//     ↓ fan-out (3 parallel branches)
//       branch 0: payroll.calculate → payroll.post
//       branch 1: tax.calculate
//       branch 2: inventory.snapshot
//     ↓ fan-in (all must succeed)
//   profitability.calculate
//   report.generate

registerStep('ledger.lock', async (ctx) => {
  await supabase.from('accounting_periods')
    .update({ status: 'locked' })
    .eq('month', ctx.month)
  return { locked: ctx.month }
})

registerStep('payroll.calculate', async (ctx) => {
  const { calculateAnnualLeaveSettlement } = await import('./hr.js')
  const settlements = await calculateAnnualLeaveSettlement()
  return { settlements }
})

registerStep('payroll.post', async (ctx) => {
  return { posted: true }
})

registerStep('tax.calculate', async (ctx) => {
  return { taxMonth: ctx.month }
})

registerStep('inventory.snapshot', async (ctx) => {
  const { data } = await supabase.from('inventory').select('id, quantity, unit_cost')
  return { items: data?.length ?? 0 }
})

registerStep('profitability.calculate', async (ctx) => {
  return await calculateProfitability(ctx.month)
})

registerStep('report.generate', async (ctx) => {
  return { report: 'monthly-close', month: ctx.month, generatedAt: new Date().toISOString() }
})

workflow.define('monthly-close', [
  step('ledger.lock'),
  fanOut([
    [step('payroll.calculate'), step('payroll.post')],
    [step('tax.calculate')],
    [step('inventory.snapshot')],
  ]),
  fanIn({ strategy: 'all', onFail: 'abort' }),
  step('profitability.calculate'),
  step('report.generate'),
])

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

  // 同時產生傳票（透過 Postgres Function，原子操作）
  if (ar) {
    const { error: entryError } = await supabase.rpc('secure_create_journal_entry', {
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_description: `出貨產生應收 - ${shipment.customer} (${invoiceNumber})`,
      p_lines: [
        { account_code: '1300', account_name: '應收帳款', debit: shipment.total_amount, credit: 0, memo: `${shipment.customer} - ${invoiceNumber}` },
        { account_code: '4100', account_name: '營業收入', debit: 0, credit: shipment.total_amount, memo: `${shipment.customer} - ${invoiceNumber}` },
      ],
      p_source: '出貨',
      p_source_id: shipment.id,
      p_created_by: '系統',
    })
    if (entryError) return { ok: false, error: entryError.message }
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

  // 產生傳票（透過 Postgres Function，原子操作）
  if (ap) {
    const { error: entryError } = await supabase.rpc('secure_create_journal_entry', {
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_description: `採購入庫 - ${po.supplier} (${po.po_number})`,
      p_lines: [
        { account_code: '5100', account_name: '營業成本', debit: amount, credit: 0, memo: `${po.supplier} - ${po.po_number}` },
        { account_code: '2100', account_name: '應付帳款', debit: 0, credit: amount, memo: `${po.supplier} - ${po.po_number}` },
      ],
      p_source: '採購',
      p_source_id: po.id,
      p_created_by: '系統',
    })
    if (entryError) return { ok: false, error: entryError.message }
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

// ── 6. HR 費用核銷 → Finance 自動傳票 ──
export async function createJEFromExpense(expense) {
  const entryNumber = `JE-EXP-${new Date().toISOString().slice(0, 4)}-${String(Date.now()).slice(-4)}`

  const categoryAccountMap = {
    '交通': { code: '6200', name: '交通費' },
    '住宿': { code: '6300', name: '旅費' },
    '餐飲': { code: '6400', name: '交際費' },
    '設備': { code: '6500', name: '設備維護費' },
    '其他': { code: '6900', name: '其他費用' },
  }

  const account = categoryAccountMap[expense.category] || categoryAccountMap['其他']
  const amount = Number(expense.amount)

  const { data: entry, error: entryError } = await supabase.rpc('secure_create_journal_entry', {
    p_entry_date: expense.date || new Date().toISOString().slice(0, 10),
    p_description: `費用核銷 - ${expense.employee} (${expense.category}: ${expense.description || ''})`,
    p_lines: [
      { account_code: account.code, account_name: account.name, debit: amount, credit: 0, memo: `${expense.employee} - ${expense.category}` },
      { account_code: '1100', account_name: '現金', debit: 0, credit: amount, memo: `${expense.employee} - ${expense.category}` },
    ],
    p_source: '費用核銷',
    p_source_id: expense.id,
    p_created_by: '系統',
  })

  if (entryError) return { ok: false, error: entryError.message }

  return { ok: true, entry }
}
