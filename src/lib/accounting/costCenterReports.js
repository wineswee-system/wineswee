/**
 * 部門/門市損益（F-A6，PLAN_fin-tax-inv_2026-07-04 一/F-A6）
 *
 * 純計算層：以 journal_lines.cost_center 為維度切分損益，
 * 重用 reports.js 的 filterPostableEntries / generateTrialBalance / generateProfitLoss。
 * 頁面（ProfitLossByDept.jsx）直接 import 本檔，不經 accounting barrel。
 */
import { filterPostableEntries, generateTrialBalance, generateProfitLoss } from './reports'
import { getAccountType } from './constants'

const r2 = (n) => Math.round(n * 100) / 100

/** 未標記 cost_center 的分錄歸入「共同」欄 */
export const COMMON_COLUMN = '共同'

/** 從 generateProfitLoss 結果萃取欄位（單一成本中心的損益欄） */
function toColumn(costCenter, pl) {
  const revenue = r2(pl.revenue.reduce((s, x) => s + x.amount, 0))
  const cogs = r2(pl.costOfGoodsSold.reduce((s, x) => s + x.amount, 0))
  const expenses = r2(pl.operatingExpenses.reduce((s, x) => s + x.amount, 0))
  return {
    costCenter,
    revenue,
    cogs,
    grossProfit: pl.grossProfit,
    expenses,
    operatingIncome: pl.operatingIncome,
  }
}

/** 由分錄推導科目清單（generateTrialBalance 只列入 accounts 內的科目） */
function accountsFromLines(lines) {
  const map = new Map()
  for (const l of lines) {
    if (!map.has(l.account_code)) {
      map.set(l.account_code, {
        code: l.account_code,
        name: l.account_name || l.account_code,
        type: getAccountType(l.account_code),
      })
    }
  }
  return [...map.values()]
}

/**
 * 依成本中心產生損益表欄位（部門/門市損益）
 * @param {Array<{id, entry_date, status}>} entries — 傳票
 * @param {Array<{entry_id, account_code, account_name?, debit, credit, cost_center?}>} lines — 分錄明細
 * @param {{from?: string, to?: string, costCenters?: Array<string>, includeDraft?: boolean}} [options]
 *   - costCenters：僅列出指定成本中心欄（未標記分錄一律進「共同」欄，不受此篩選影響）
 * @returns {{columns: Array<{costCenter, revenue, cogs, grossProfit, expenses, operatingIncome}>,
 *            common: {costCenter, revenue, cogs, grossProfit, expenses, operatingIncome},
 *            total: {costCenter, revenue, cogs, grossProfit, expenses, operatingIncome},
 *            costCenters: Array<string>, from, to, includeDraft}}
 */
export function generateProfitLossByCostCenter(entries, lines, {
  from, to, costCenters, includeDraft = false,
} = {}) {
  const usable = filterPostableEntries(entries, { includeDraft })
  const entryMap = {}
  for (const e of usable) {
    const date = e.entry_date
    if (from && date < from) continue
    if (to && date > to) continue
    entryMap[e.id] = e
  }

  // 分錄依 cost_center 分組；未標記 → 共同
  const selected = costCenters && costCenters.length > 0 ? new Set(costCenters) : null
  const grouped = new Map() // costCenter -> lines[]
  const commonLines = []
  const includedLines = []
  for (const line of lines || []) {
    if (!entryMap[line.entry_id]) continue
    const cc = line.cost_center || null
    if (!cc) {
      commonLines.push(line)
      includedLines.push(line)
      continue
    }
    if (selected && !selected.has(cc)) continue // 未選取的成本中心不列入本報表
    if (!grouped.has(cc)) grouped.set(cc, [])
    grouped.get(cc).push(line)
    includedLines.push(line)
  }

  const period = `${from || ''} ~ ${to || ''}`
  const buildColumn = (cc, ccLines) => {
    const accounts = accountsFromLines(ccLines)
    const tb = generateTrialBalance(accounts, ccLines)
    return toColumn(cc, generateProfitLoss(tb, period))
  }

  const columns = [...grouped.keys()].sort().map(cc => buildColumn(cc, grouped.get(cc)))
  const common = buildColumn(COMMON_COLUMN, commonLines)
  const total = buildColumn('合計', includedLines)

  return {
    columns,
    common,
    total,
    costCenters: columns.map(c => c.costCenter),
    from: from ?? null,
    to: to ?? null,
    includeDraft,
  }
}

/**
 * 共同費用分攤：把「共同」欄的營業費用依規則分攤到各成本中心欄
 * - method 'revenue'：按各中心營收比（營收為 0 的中心分攤 0；全部營收為 0 時退回平均分攤）
 * - method 'headcount'：按提供的權數（weights，例如人數）比例分攤；權數和為 0 時退回平均分攤
 * 分攤採 r2 逐筆進位、尾差歸最後一個中心 → 分攤後合計與分攤前完全一致。
 *
 * @param {Array<{costCenter, revenue, cogs, grossProfit, expenses, operatingIncome}>} byCenter — 各中心欄
 * @param {{expenses: number}} commonColumn — 共同欄（generateProfitLossByCostCenter 的 common）
 * @param {{method?: 'revenue'|'headcount', weights?: Record<string, number>}} [options]
 * @returns {{columns: Array, common: Object, allocations: Array<{costCenter, base, ratio, allocated}>,
 *            method: string, totalAllocated: number, fallbackEqual: boolean}}
 */
export function allocateCommonExpenses(byCenter, commonColumn, { method = 'revenue', weights } = {}) {
  const centers = byCenter || []
  const commonExpenses = r2(Number(commonColumn?.expenses) || 0)

  if (centers.length === 0 || commonExpenses === 0) {
    return {
      columns: centers.map(c => ({ ...c })),
      common: { ...(commonColumn || {}) },
      allocations: [],
      method,
      totalAllocated: 0,
      fallbackEqual: false,
    }
  }

  // 分攤基礎權數
  const baseOf = (c) => method === 'headcount'
    ? Math.max(Number(weights?.[c.costCenter]) || 0, 0)
    : Math.max(Number(c.revenue) || 0, 0) // 負營收（純退貨月）視為 0，防負向分攤
  let bases = centers.map(baseOf)
  let baseSum = bases.reduce((s, b) => s + b, 0)

  // 零基礎防護：全部權數/營收為 0 → 平均分攤（避免除以零）
  const fallbackEqual = baseSum <= 0
  if (fallbackEqual) {
    bases = centers.map(() => 1)
    baseSum = centers.length
  }

  let allocatedSum = 0
  const allocations = centers.map((c, i) => {
    const ratio = bases[i] / baseSum
    let allocated
    if (i === centers.length - 1) {
      allocated = r2(commonExpenses - allocatedSum) // 尾差歸最後一欄，總額守恆
    } else {
      allocated = r2(commonExpenses * ratio)
      allocatedSum = r2(allocatedSum + allocated)
    }
    return {
      costCenter: c.costCenter,
      base: r2(bases[i]),
      ratio: Math.round(ratio * 10000) / 10000,
      allocated,
    }
  })

  const columns = centers.map((c, i) => {
    const expenses = r2(c.expenses + allocations[i].allocated)
    return {
      ...c,
      expenses,
      allocatedCommon: allocations[i].allocated,
      operatingIncome: r2(c.grossProfit - expenses),
    }
  })

  // 分攤後共同欄費用歸零（收入/成本若有值仍保留揭露）
  const common = {
    ...commonColumn,
    expenses: 0,
    allocatedOut: commonExpenses,
    operatingIncome: r2(Number(commonColumn?.grossProfit) || 0),
  }

  return {
    columns,
    common,
    allocations,
    method,
    totalAllocated: commonExpenses,
    fallbackEqual,
  }
}
