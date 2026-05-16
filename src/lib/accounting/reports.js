import { supabase } from '../supabase'
import { CHART_OF_ACCOUNTS, getAccountType } from './constants'

// ─── 試算表 ───────────────────────────────────────────────────

/**
 * 產生試算表（Trial Balance）
 * @param {Array<{code: string, name: string, type: string}>} accounts — 科目清單
 * @param {Array<{account_code: string, debit: number, credit: number}>} journalLines — 所有已過帳分錄明細
 * @returns {Array<{account_code: string, account_name: string, type: string, debit_balance: number, credit_balance: number}>}
 */
export function generateTrialBalance(accounts, journalLines) {
  // 彙總每個科目的借貸合計
  const balanceMap = {}

  for (const line of journalLines) {
    const code = line.account_code
    if (!balanceMap[code]) {
      balanceMap[code] = { totalDebit: 0, totalCredit: 0 }
    }
    balanceMap[code].totalDebit += Number(line.debit) || 0
    balanceMap[code].totalCredit += Number(line.credit) || 0
  }

  const result = []

  for (const acct of accounts) {
    const bal = balanceMap[acct.code]
    if (!bal) continue // 無交易的科目不列入

    const type = acct.type || getAccountType(acct.code)
    const netDebit = Math.round(bal.totalDebit * 100) / 100
    const netCredit = Math.round(bal.totalCredit * 100) / 100

    // 資產/費用/成本類：餘額在借方；負債/權益/收入類：餘額在貸方
    let debit_balance = 0
    let credit_balance = 0

    if (['資產', '營業費用', '銷貨成本'].includes(type)) {
      const net = netDebit - netCredit
      if (net >= 0) {
        debit_balance = Math.round(net * 100) / 100
      } else {
        credit_balance = Math.round(Math.abs(net) * 100) / 100
      }
    } else {
      const net = netCredit - netDebit
      if (net >= 0) {
        credit_balance = Math.round(net * 100) / 100
      } else {
        debit_balance = Math.round(Math.abs(net) * 100) / 100
      }
    }

    result.push({
      account_code: acct.code,
      account_name: acct.name,
      type,
      debit_balance,
      credit_balance,
    })
  }

  // 依科目代碼排序
  result.sort((a, b) => a.account_code.localeCompare(b.account_code))

  return result
}

// ─── 資產負債表 ───────────────────────────────────────────────

/**
 * 從試算表產生資產負債表
 * @param {Array<{account_code: string, account_name: string, type: string, debit_balance: number, credit_balance: number}>} trialBalance
 * @param {string} period — 報表期間，例如 '2026-03'
 * @returns {{assets: Array, liabilities: Array, equity: Array, totalAssets: number, totalLiabilities: number, totalEquity: number, balanced: boolean, period: string}}
 */
export function generateBalanceSheet(trialBalance, period) {
  const assetItems = []
  const liabilityItems = []
  const equityItems = []

  for (const row of trialBalance) {
    const balance = row.debit_balance - row.credit_balance
    const entry = { account_code: row.account_code, account_name: row.account_name, amount: 0 }

    if (row.type === '資產') {
      // 資產正常餘額在借方
      entry.amount = Math.round((row.debit_balance - row.credit_balance) * 100) / 100
      assetItems.push(entry)
    } else if (row.type === '負債') {
      entry.amount = Math.round((row.credit_balance - row.debit_balance) * 100) / 100
      liabilityItems.push(entry)
    } else if (row.type === '權益') {
      entry.amount = Math.round((row.credit_balance - row.debit_balance) * 100) / 100
      equityItems.push(entry)
    }
    // 收入/費用/成本類不列入資產負債表（屬損益表）
  }

  // 分類彙總
  const categorize = (items, categories) => {
    const result = []
    for (const cat of categories) {
      const matched = items.filter(it => it.account_code.startsWith(cat.prefix))
      if (matched.length > 0) {
        const subtotal = Math.round(matched.reduce((s, it) => s + it.amount, 0) * 100) / 100
        result.push({
          category: cat.label,
          items: matched,
          subtotal,
        })
      }
    }
    return result
  }

  const assets = categorize(assetItems, [
    { prefix: '11', label: '流動資產' },
    { prefix: '12', label: '基金及投資' },
    { prefix: '13', label: '固定資產' },
    { prefix: '14', label: '無形資產' },
    { prefix: '15', label: '其他資產' },
    { prefix: '16', label: '固定資產' },
  ])

  const liabilities = categorize(liabilityItems, [
    { prefix: '21', label: '流動負債' },
    { prefix: '22', label: '短期借款' },
    { prefix: '23', label: '長期負債' },
    { prefix: '24', label: '其他負債' },
  ])

  const equity = categorize(equityItems, [
    { prefix: '31', label: '股本' },
    { prefix: '32', label: '資本公積' },
    { prefix: '33', label: '保留盈餘' },
    { prefix: '34', label: '其他權益' },
  ])

  const totalAssets = Math.round(assetItems.reduce((s, it) => s + it.amount, 0) * 100) / 100
  const totalLiabilities = Math.round(liabilityItems.reduce((s, it) => s + it.amount, 0) * 100) / 100
  const totalEquity = Math.round(equityItems.reduce((s, it) => s + it.amount, 0) * 100) / 100
  const balanced = Math.round((totalAssets - totalLiabilities - totalEquity) * 100) / 100 === 0

  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced,
    period,
  }
}

// ─── 損益表 ───────────────────────────────────────────────────

/**
 * 從試算表產生損益表（Profit & Loss Statement）
 * @param {Array<{account_code: string, account_name: string, type: string, debit_balance: number, credit_balance: number}>} trialBalance
 * @param {string} period — 報表期間，例如 '2026-03'
 * @returns {{revenue: Array, costOfGoodsSold: Array, grossProfit: number, operatingExpenses: Array, operatingIncome: number, otherIncome: Array, otherExpenses: Array, netIncome: number, period: string}}
 */
export function generateProfitLoss(trialBalance, period) {
  const revenue = []
  const costOfGoodsSold = []
  const operatingExpenses = []
  const otherIncome = []
  const otherExpenses = []

  for (const row of trialBalance) {
    const entry = { item: row.account_name, amount: 0 }

    if (row.type === '收入') {
      // 收入正常餘額在貸方；銷貨退回(4200)為借方減項
      entry.amount = Math.round((row.credit_balance - row.debit_balance) * 100) / 100
      revenue.push(entry)
    } else if (row.type === '銷貨成本') {
      entry.amount = Math.round((row.debit_balance - row.credit_balance) * 100) / 100
      costOfGoodsSold.push(entry)
    } else if (row.type === '營業費用') {
      entry.amount = Math.round((row.debit_balance - row.credit_balance) * 100) / 100
      operatingExpenses.push(entry)
    } else if (row.type === '營業外收入/支出') {
      // 7xxx: 判斷是收入還是支出
      const net = row.credit_balance - row.debit_balance
      if (net >= 0) {
        entry.amount = Math.round(net * 100) / 100
        otherIncome.push(entry)
      } else {
        entry.amount = Math.round(Math.abs(net) * 100) / 100
        otherExpenses.push(entry)
      }
    }
  }

  const totalRevenue = Math.round(revenue.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const totalCOGS = Math.round(costOfGoodsSold.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const grossProfit = Math.round((totalRevenue - totalCOGS) * 100) / 100

  const totalOpex = Math.round(operatingExpenses.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const operatingIncome = Math.round((grossProfit - totalOpex) * 100) / 100

  const totalOtherIncome = Math.round(otherIncome.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const totalOtherExpenses = Math.round(otherExpenses.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const netIncome = Math.round((operatingIncome + totalOtherIncome - totalOtherExpenses) * 100) / 100

  return {
    revenue,
    costOfGoodsSold,
    grossProfit,
    operatingExpenses,
    operatingIncome,
    otherIncome,
    otherExpenses,
    netIncome,
    period,
  }
}

// ─── 報表資料擷取（Supabase 查詢）──────────────────────────────

/**
 * 取得已過帳傳票的所有分錄（可選日期範圍篩選）
 * @param {string} [asOfDate] — 截止日期 (YYYY-MM-DD)，不傳則取全部
 * @param {string} [startDate] — 起始日期 (YYYY-MM-DD)
 * @returns {Promise<{accounts: Array, lines: Array}>}
 */
async function fetchPostedData(asOfDate, startDate) {
  // 取得已過帳的傳票
  let entryQuery = supabase
    .from('journal_entries')
    .select('id, entry_date')
    .eq('status', '已過帳')

  if (asOfDate) {
    entryQuery = entryQuery.lte('entry_date', asOfDate)
  }
  if (startDate) {
    entryQuery = entryQuery.gte('entry_date', startDate)
  }

  const [entriesRes, accountsRes] = await Promise.all([
    entryQuery,
    supabase.from('accounts').select('*').order('code'),
  ])

  const entries = entriesRes.data || []
  const accounts = accountsRes.data || []
  const entryIds = entries.map(e => e.id)

  if (entryIds.length === 0) {
    return { accounts, lines: [] }
  }

  // Supabase .in() 有上限，分批查詢
  const batchSize = 100
  let allLines = []
  for (let i = 0; i < entryIds.length; i += batchSize) {
    const batch = entryIds.slice(i, i + batchSize)
    const { data } = await supabase
      .from('journal_lines')
      .select('*')
      .in('entry_id', batch)
    if (data) allLines = allLines.concat(data)
  }

  return { accounts, lines: allLines }
}

/**
 * 取得試算表資料（僅已過帳傳票）
 * @param {string} [asOfDate] — 截止日期
 * @returns {Promise<Array<{account_code, account_name, type, debit_balance, credit_balance}>>}
 */
export async function getTrialBalance(asOfDate) {
  const { accounts, lines } = await fetchPostedData(asOfDate)
  return generateTrialBalance(accounts.length > 0 ? accounts : CHART_OF_ACCOUNTS, lines)
}

/**
 * 取得資產負債表資料（僅已過帳傳票）
 * @param {string} [asOfDate] — 截止日期
 * @returns {Promise<{assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, balanced}>}
 */
export async function getBalanceSheetData(asOfDate) {
  const trialBalance = await getTrialBalance(asOfDate)
  const period = asOfDate || new Date().toISOString().slice(0, 10)
  return generateBalanceSheet(trialBalance, period)
}

/**
 * 取得損益表資料（僅已過帳傳票，指定日期範圍）
 * @param {string} startDate — 起始日期
 * @param {string} endDate — 結束日期
 * @returns {Promise<{revenue, costOfGoodsSold, grossProfit, operatingExpenses, operatingIncome, otherIncome, otherExpenses, netIncome}>}
 */
export async function getIncomeStatement(startDate, endDate) {
  const { accounts, lines } = await fetchPostedData(endDate, startDate)
  const trialBalance = generateTrialBalance(accounts.length > 0 ? accounts : CHART_OF_ACCOUNTS, lines)
  const period = `${startDate} ~ ${endDate}`
  return generateProfitLoss(trialBalance, period)
}

// ─── 成本中心支援 ────────────────────────────────────────────────

/**
 * 為分錄明細標記成本中心
 * @param {{account_code: string, debit: number, credit: number}} journalLine — 分錄明細
 * @param {string} costCenter — 成本中心代碼（例如 'CC001'）
 * @returns {{account_code: string, debit: number, credit: number, cost_center: string}}
 */
export function tagCostCenter(journalLine, costCenter) {
  return {
    ...journalLine,
    cost_center: costCenter,
  }
}

/**
 * 依成本中心產生試算表
 * @param {Array<{code: string, name: string, type: string}>} accounts — 科目清單
 * @param {Array<{account_code: string, debit: number, credit: number, cost_center?: string}>} journalLines — 所有已過帳分錄明細
 * @returns {Record<string, Array<{account_code: string, account_name: string, type: string, debit_balance: number, credit_balance: number}>>} 以成本中心為 key 的試算表
 */
export function generateTrialBalanceByCostCenter(accounts, journalLines) {
  // 依成本中心分組
  const grouped = {}
  for (const line of journalLines) {
    const cc = line.cost_center || '未分配'
    if (!grouped[cc]) grouped[cc] = []
    grouped[cc].push(line)
  }

  const result = {}
  for (const [cc, lines] of Object.entries(grouped)) {
    result[cc] = generateTrialBalance(accounts, lines)
  }

  return result
}

// ─── 預算 vs 實際差異分析 ──────────────────────────────────────────

/**
 * 計算預算與實際差異
 * @param {Array<{account_code: string, account_name: string, budget_amount: number}>} budgetItems — 預算項目
 * @param {Array<{account_code: string, account_name: string, actual_amount: number}>} actualItems — 實際項目
 * @returns {Array<{account_code: string, account_name: string, budget_amount: number, actual_amount: number, variance: number, variance_pct: number, favorable: boolean}>}
 */
export function calculateBudgetVariance(budgetItems, actualItems) {
  // 建立實際金額查詢表
  const actualMap = {}
  for (const item of actualItems) {
    actualMap[item.account_code] = item
  }

  return budgetItems.map(budget => {
    const actual = actualMap[budget.account_code]
    const actualAmount = actual ? Math.round((Number(actual.actual_amount) || 0) * 100) / 100 : 0
    const budgetAmount = Math.round((Number(budget.budget_amount) || 0) * 100) / 100
    const variance = Math.round((budgetAmount - actualAmount) * 100) / 100

    // 判斷有利/不利：
    // 收入類：實際 > 預算 → 有利；費用類：實際 < 預算 → 有利
    const type = getAccountType(budget.account_code)
    const isRevenueType = ['收入', '營業外收入/支出'].includes(type)
    const favorable = isRevenueType ? actualAmount >= budgetAmount : actualAmount <= budgetAmount

    const variance_pct = budgetAmount !== 0
      ? Math.round((variance / budgetAmount) * 10000) / 100
      : 0

    return {
      account_code: budget.account_code,
      account_name: budget.account_name,
      budget_amount: budgetAmount,
      actual_amount: actualAmount,
      variance,
      variance_pct,
      favorable,
    }
  })
}

// ─── 應收/應付帳齡分析 ────────────────────────────────────────────

/**
 * 計算應收/應付帳齡分桶（Current / 1-30 / 31-60 / 61-90 / 91-120 / 120+ 天）
 * @param {Array<{id: string, counterparty: string, amount: number, due_date: string}>} invoices — 未結發票清單
 * @param {string} asOfDate — 基準日期（YYYY-MM-DD）
 * @returns {{buckets: {current: number, days_1_30: number, days_31_60: number, days_61_90: number, days_91_120: number, days_over_120: number}, total: number, details: Array<{id: string, counterparty: string, amount: number, due_date: string, days_overdue: number, bucket: string}>}}
 */
export function calculateAgingBuckets(invoices, asOfDate) {
  const asOf = new Date(asOfDate)
  const MS_PER_DAY = 86400000

  const buckets = {
    current: 0,
    days_1_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    days_91_120: 0,
    days_over_120: 0,
  }

  const details = []

  for (const inv of invoices) {
    const dueDate = new Date(inv.due_date)
    const diffDays = Math.floor((asOf - dueDate) / MS_PER_DAY)
    const daysOverdue = Math.max(diffDays, 0)
    const amount = Math.round((Number(inv.amount) || 0) * 100) / 100

    let bucket
    if (diffDays <= 0) {
      bucket = '未到期'
      buckets.current = Math.round((buckets.current + amount) * 100) / 100
    } else if (daysOverdue <= 30) {
      bucket = '1-30天'
      buckets.days_1_30 = Math.round((buckets.days_1_30 + amount) * 100) / 100
    } else if (daysOverdue <= 60) {
      bucket = '31-60天'
      buckets.days_31_60 = Math.round((buckets.days_31_60 + amount) * 100) / 100
    } else if (daysOverdue <= 90) {
      bucket = '61-90天'
      buckets.days_61_90 = Math.round((buckets.days_61_90 + amount) * 100) / 100
    } else if (daysOverdue <= 120) {
      bucket = '91-120天'
      buckets.days_91_120 = Math.round((buckets.days_91_120 + amount) * 100) / 100
    } else {
      bucket = '120天以上'
      buckets.days_over_120 = Math.round((buckets.days_over_120 + amount) * 100) / 100
    }

    details.push({
      id: inv.id,
      counterparty: inv.counterparty,
      amount,
      due_date: inv.due_date,
      days_overdue: daysOverdue,
      bucket,
    })
  }

  const total = Math.round(
    (buckets.current + buckets.days_1_30 + buckets.days_31_60 +
     buckets.days_61_90 + buckets.days_91_120 + buckets.days_over_120) * 100
  ) / 100

  return { buckets, total, details }
}
