import { supabase } from '../supabase'
import { CHART_OF_ACCOUNTS, getAccountType } from './constants'
import { getTenantOrgId } from '../events/middleware/tenantContext.js'

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

  // 收入減項（contra revenue）：銷貨退回及折讓 — 科目表未細分時以名稱判斷（fallback）
  const isRevenueContra = (row) =>
    row.type === '收入' && /銷貨退回|銷貨折讓|退回及折讓/.test(row.account_name || '')
  let salesReturnsAndAllowances = 0

  for (const row of trialBalance) {
    const entry = { item: row.account_name, amount: 0 }

    if (row.type === '收入') {
      // 收入正常餘額在貸方；銷貨退回及折讓為借方減項（列於收入段、金額為負）
      entry.amount = Math.round((row.credit_balance - row.debit_balance) * 100) / 100
      if (isRevenueContra(row)) {
        salesReturnsAndAllowances = Math.round((salesReturnsAndAllowances - entry.amount) * 100) / 100
      }
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

  // 綜合損益表擴充（商業會計法對齊）：
  // - grossRevenue/netRevenue：銷貨退回及折讓列為收入減項（totalRevenue 本即淨額，此處補齊揭露）
  // - otherComprehensiveIncome：本期其他綜合損益（SME 多為 0，格式先留）
  const netRevenue = Math.round(revenue.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const grossRevenue = Math.round((netRevenue + salesReturnsAndAllowances) * 100) / 100
  const otherComprehensiveIncome = []
  const totalOtherComprehensiveIncome = 0
  const comprehensiveIncome = Math.round((netIncome + totalOtherComprehensiveIncome) * 100) / 100

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
    // 綜合損益表新增段（additive — 既有欄位不變）
    grossRevenue,
    salesReturnsAndAllowances,
    netRevenue,
    otherComprehensiveIncome,
    totalOtherComprehensiveIncome,
    comprehensiveIncome,
  }
}

// ─── 共用：報表取數過濾（免過帳即時報表）───────────────────────

const r2 = (n) => Math.round(n * 100) / 100

/** 餘額在借方的科目類型（其餘視為貸方正常餘額） */
const DEBIT_NORMAL_TYPES = ['資產', '營業費用', '銷貨成本']

/**
 * 過濾可入報表的傳票（預設僅已過帳；includeDraft 時加計草稿）
 * @param {Array<{status: string}>} entries — 傳票清單
 * @param {{includeDraft?: boolean}} [options]
 * @returns {Array} 過濾後傳票
 */
export function filterPostableEntries(entries, { includeDraft = false } = {}) {
  return (entries || []).filter(e =>
    e.status === '已過帳' || (includeDraft && e.status === '草稿')
  )
}

/** 依日期區間過濾傳票（from/to 皆為 YYYY-MM-DD，可省略） */
function filterEntriesByDate(entries, from, to) {
  return entries.filter(e => {
    if (from && e.entry_date < from) return false
    if (to && e.entry_date > to) return false
    return true
  })
}

/** 排序 key：entry_date → entry_number */
function compareChrono(a, b) {
  const d = String(a.entry_date || '').localeCompare(String(b.entry_date || ''))
  if (d !== 0) return d
  return String(a.entry_number || '').localeCompare(String(b.entry_number || ''))
}

// ─── 日記帳（Journal Book）────────────────────────────────────

/**
 * 產生日記帳：依 entry_date + entry_number 排序列示傳票分錄，含日合計/月合計/總計
 * @param {Array<{id, entry_number, entry_date, description, status}>} entries — 傳票
 * @param {Array<{entry_id, account_code, account_name, debit, credit, memo?}>} lines — 分錄明細
 * @param {{from?: string, to?: string, includeDraft?: boolean}} [options]
 * @returns {{days: Array<{date: string, entries: Array, subtotalDebit: number, subtotalCredit: number}>, months: Array<{month: string, totalDebit: number, totalCredit: number}>, totalDebit: number, totalCredit: number, balanced: boolean, entryCount: number, from: string|null, to: string|null, includeDraft: boolean}}
 */
export function generateJournalBook(entries, lines, { from, to, includeDraft = false } = {}) {
  const usable = filterEntriesByDate(
    filterPostableEntries(entries, { includeDraft }), from, to
  ).slice().sort(compareChrono)

  const linesByEntry = {}
  for (const line of lines || []) {
    const key = line.entry_id
    if (!linesByEntry[key]) linesByEntry[key] = []
    linesByEntry[key].push(line)
  }

  const dayMap = new Map() // 保持插入順序（已按日期排序）
  const monthMap = new Map()
  let totalDebit = 0
  let totalCredit = 0

  for (const entry of usable) {
    const entryLines = (linesByEntry[entry.id] || []).map(l => ({
      account_code: l.account_code,
      account_name: l.account_name,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      memo: l.memo ?? l.description ?? '',
    }))
    const entryDebit = r2(entryLines.reduce((s, l) => s + l.debit, 0))
    const entryCredit = r2(entryLines.reduce((s, l) => s + l.credit, 0))

    const date = entry.entry_date
    if (!dayMap.has(date)) dayMap.set(date, { date, entries: [], subtotalDebit: 0, subtotalCredit: 0 })
    const day = dayMap.get(date)
    day.entries.push({
      id: entry.id,
      entry_number: entry.entry_number,
      entry_date: entry.entry_date,
      description: entry.description || '',
      status: entry.status,
      lines: entryLines,
      totalDebit: entryDebit,
      totalCredit: entryCredit,
    })
    day.subtotalDebit = r2(day.subtotalDebit + entryDebit)
    day.subtotalCredit = r2(day.subtotalCredit + entryCredit)

    const month = String(date || '').slice(0, 7)
    if (!monthMap.has(month)) monthMap.set(month, { month, totalDebit: 0, totalCredit: 0 })
    const m = monthMap.get(month)
    m.totalDebit = r2(m.totalDebit + entryDebit)
    m.totalCredit = r2(m.totalCredit + entryCredit)

    totalDebit = r2(totalDebit + entryDebit)
    totalCredit = r2(totalCredit + entryCredit)
  }

  return {
    days: [...dayMap.values()],
    months: [...monthMap.values()],
    totalDebit,
    totalCredit,
    balanced: r2(totalDebit - totalCredit) === 0,
    entryCount: usable.length,
    from: from ?? null,
    to: to ?? null,
    includeDraft,
  }
}

// ─── 總分類帳/明細帳（General Ledger）─────────────────────────

/**
 * 產生總分類帳/明細帳：每科目期初餘額 + 逐筆過帳（含逐筆餘額）+ 期末餘額
 * 餘額符號依正常餘額方向（getAccountType）：資產/費用/成本借方為正，其餘貸方為正
 * @param {Array} entries — 傳票（含 status/entry_date/entry_number）
 * @param {Array} lines — 分錄明細（entry_id 對應 entries.id；可含 cost_center）
 * @param {{accountCodes?: Array<string>, from?: string, to?: string, openingBalances?: Record<string, number>, costCenter?: string, includeDraft?: boolean}} [options]
 *   - openingBalances：外部提供期初餘額（正常方向為正）；未提供時以 from 之前的分錄推算
 *   - costCenter：明細帳維度 — 僅計入該成本中心的分錄
 * @returns {{accounts: Array<{account_code, account_name, type, normal_side, openingBalance, postings: Array<{date, entry_number, description, memo, cost_center, debit, credit, balance}>, totalDebit, totalCredit, closingBalance}>, from, to, costCenter, includeDraft}}
 */
export function generateGeneralLedger(entries, lines, {
  accountCodes, from, to, openingBalances, costCenter, includeDraft = false,
} = {}) {
  const usable = filterPostableEntries(entries, { includeDraft })
  const entryMap = {}
  for (const e of usable) entryMap[e.id] = e

  // 分錄依所屬傳票日期切成「期初前」與「期間內」
  const priorLines = []
  const periodLines = []
  for (const line of lines || []) {
    const entry = entryMap[line.entry_id]
    if (!entry) continue
    if (costCenter && line.cost_center !== costCenter) continue
    const date = entry.entry_date
    if (to && date > to) continue
    if (from && date < from) { priorLines.push({ line, entry }); continue }
    periodLines.push({ line, entry })
  }

  // 決定要出帳的科目
  const codes = accountCodes && accountCodes.length > 0
    ? [...accountCodes]
    : [...new Set([
        ...periodLines.map(({ line }) => line.account_code),
        ...Object.keys(openingBalances || {}),
      ])].sort()

  const nameOf = (code) => {
    const hit = [...periodLines, ...priorLines]
      .find(({ line }) => line.account_code === code && line.account_name)
    if (hit) return hit.line.account_name
    const seed = CHART_OF_ACCOUNTS.find(a => a.code === code)
    return seed ? seed.name : code
  }

  const accounts = []
  for (const code of codes) {
    const type = getAccountType(code)
    const debitNormal = DEBIT_NORMAL_TYPES.includes(type)
    const signed = (l) => debitNormal
      ? (Number(l.debit) || 0) - (Number(l.credit) || 0)
      : (Number(l.credit) || 0) - (Number(l.debit) || 0)

    // 期初：外部提供優先，否則由 from 之前的分錄推算
    let openingBalance
    if (openingBalances && openingBalances[code] !== undefined) {
      openingBalance = r2(Number(openingBalances[code]) || 0)
    } else {
      openingBalance = r2(priorLines
        .filter(({ line }) => line.account_code === code)
        .reduce((s, { line }) => s + signed(line), 0))
    }

    const acctLines = periodLines
      .filter(({ line }) => line.account_code === code)
      .sort((a, b) => compareChrono(a.entry, b.entry) || ((a.line.id ?? 0) - (b.line.id ?? 0)))

    let running = openingBalance
    let totalDebit = 0
    let totalCredit = 0
    const postings = acctLines.map(({ line, entry }) => {
      const debit = Number(line.debit) || 0
      const credit = Number(line.credit) || 0
      totalDebit = r2(totalDebit + debit)
      totalCredit = r2(totalCredit + credit)
      running = r2(running + signed(line))
      return {
        date: entry.entry_date,
        entry_number: entry.entry_number,
        description: entry.description || '',
        memo: line.memo ?? '',
        cost_center: line.cost_center ?? null,
        debit,
        credit,
        balance: running,
      }
    })

    if (postings.length === 0 && openingBalance === 0 && !(accountCodes && accountCodes.length > 0)) {
      continue // 未指定科目時，無交易且無期初的科目不列
    }

    accounts.push({
      account_code: code,
      account_name: nameOf(code),
      type,
      normal_side: debitNormal ? 'debit' : 'credit',
      openingBalance,
      postings,
      totalDebit,
      totalCredit,
      closingBalance: running,
    })
  }

  return {
    accounts,
    from: from ?? null,
    to: to ?? null,
    costCenter: costCenter ?? null,
    includeDraft,
  }
}

// ─── 營業成本表（Cost of Goods Sold Statement）────────────────

/**
 * 產生營業成本表：期初存貨 + 本期進貨（− 進貨退出及折讓）− 期末存貨 = 銷貨成本
 * 期初/期末存貨取 inventory_valuations 月結快照（F-C1），本函式為純計算不取數
 * @param {{openingInventory?: number, purchases?: number, purchaseReturnsAllowances?: number, closingInventory?: number, period?: string}} params
 * @returns {{rows: Array<{label: string, amount: number, emphasis?: boolean}>, openingInventory, purchases, purchaseReturnsAllowances, netPurchases, goodsAvailable, closingInventory, costOfGoodsSold, period}}
 */
export function generateCostOfGoodsSold({
  openingInventory = 0,
  purchases = 0,
  purchaseReturnsAllowances = 0,
  closingInventory = 0,
  period,
} = {}) {
  const opening = r2(Number(openingInventory) || 0)
  const purch = r2(Number(purchases) || 0)
  const returns = r2(Number(purchaseReturnsAllowances) || 0)
  const closing = r2(Number(closingInventory) || 0)

  const netPurchases = r2(purch - returns)
  const goodsAvailable = r2(opening + netPurchases)
  const costOfGoodsSold = r2(goodsAvailable - closing)

  return {
    rows: [
      { label: '期初存貨', amount: opening },
      { label: '本期進貨', amount: purch },
      { label: '減：進貨退出及折讓', amount: r2(-returns) },
      { label: '進貨淨額', amount: netPurchases, emphasis: true },
      { label: '可供銷售商品成本', amount: goodsAvailable, emphasis: true },
      { label: '減：期末存貨', amount: r2(-closing) },
      { label: '銷貨成本', amount: costOfGoodsSold, emphasis: true },
    ],
    openingInventory: opening,
    purchases: purch,
    purchaseReturnsAllowances: returns,
    netPurchases,
    goodsAvailable,
    closingInventory: closing,
    costOfGoodsSold,
    period: period ?? null,
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
  // 取得已過帳的傳票（顯式限縮本組織 — RLS 之外的第二道防線）
  const orgId = getTenantOrgId()
  let entryQuery = supabase
    .from('journal_entries')
    .select('id, entry_date')
    .eq('status', '已過帳')
  if (orgId) entryQuery = entryQuery.eq('organization_id', orgId)

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
