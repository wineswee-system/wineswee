/**
 * CRM — Funnel / Pipeline Analytics, Win/Loss Tracking, Deal Line Items, Multi-Pipeline
 */

// ============================================================
// Funnel / Pipeline Analytics
// ============================================================

const STAGE_ORDER = ['初步接觸', '需求分析', '報價', '議價', '贏單', '輸單']

/**
 * Forecast revenue from pipeline opportunities by month.
 * Uses weighted pipeline: stage probability × deal amount.
 * @param {Array} opportunities - list of opportunity records
 * @param {number} months - how many months ahead to forecast (default 6)
 * @returns {Array<{month, label, weighted, bestCase, dealCount}>}
 */
export function forecastRevenue(opportunities, months = 6) {
  const now = new Date()
  const result = []

  for (let i = 0; i < months; i++) {
    const m = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const monthKey = m.toISOString().slice(0, 7) // YYYY-MM
    const label = m.toLocaleDateString('zh-TW', { year: 'numeric', month: 'short' })

    // Deals expected to close this month
    const monthDeals = opportunities.filter(o => {
      if (!o.expected_close) return false
      if (o.stage === '贏單' || o.stage === '輸單') return false
      return o.expected_close.slice(0, 7) === monthKey
    })

    const weighted = Math.round(monthDeals.reduce((s, o) => s + (o.amount || 0) * ((o.probability || 0) / 100), 0))
    const bestCase = Math.round(monthDeals.reduce((s, o) => s + (o.amount || 0), 0))

    result.push({ month: monthKey, label, weighted, bestCase, dealCount: monthDeals.length })
  }

  return result
}

/**
 * Calculate funnel conversion rates
 */
export function calculateFunnelConversion(opportunities) {
  const stages = STAGE_ORDER.filter(s => s !== '輸單')
  const result = []

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]
    // Count opps that reached this stage (are at this stage or beyond)
    const stageIdx = STAGE_ORDER.indexOf(stage)
    const reached = opportunities.filter(o => STAGE_ORDER.indexOf(o.stage) >= stageIdx).length
    const current = opportunities.filter(o => o.stage === stage).length
    const prevReached = i === 0 ? opportunities.length : result[i - 1].reached
    const conversionRate = prevReached > 0 ? Math.round((reached / prevReached) * 100) : 0

    result.push({
      stage,
      current,
      reached,
      conversionRate,
      value: opportunities.filter(o => o.stage === stage).reduce((s, o) => s + (o.amount || 0), 0),
      avgDaysInStage: 0, // would need stage transition history
    })
  }

  return result
}

/**
 * Sales rep performance metrics
 */
export function calculateRepPerformance(opportunities, reps) {
  return reps.map(rep => {
    const repOpps = opportunities.filter(o => o.assignee === rep)
    const won = repOpps.filter(o => o.stage === '贏單')
    const lost = repOpps.filter(o => o.stage === '輸單')
    const active = repOpps.filter(o => !['贏單', '輸單'].includes(o.stage))
    const totalValue = won.reduce((s, o) => s + (o.amount || 0), 0)
    const winRate = (won.length + lost.length) > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0

    return {
      rep,
      totalDeals: repOpps.length,
      wonDeals: won.length,
      lostDeals: lost.length,
      activeDeals: active.length,
      totalRevenue: totalValue,
      activeValue: active.reduce((s, o) => s + (o.amount || 0), 0),
      winRate,
      avgDealSize: won.length > 0 ? Math.round(totalValue / won.length) : 0,
    }
  })
}

// ============================================================
// Win/Loss Tracking
// ============================================================

export const WIN_REASONS = [
  '價格優勢', '產品品質', '服務態度', '品牌信任', '客製能力', '交期快速', '長期合作', '其他'
]

export const LOSS_REASONS = [
  '價格太高', '產品不符需求', '競爭對手搶單', '客戶預算不足', '客戶決策延遲',
  '服務不滿意', '交期無法配合', '聯繫不上客戶', '其他'
]

// ============================================================
// Deal Products / Line Items
// ============================================================

export const PRODUCT_CATALOG = [
  { id: 'P001', name: 'A 級原料', unit: 'kg', price: 450, category: '原料' },
  { id: 'P002', name: 'B 級原料', unit: 'kg', price: 320, category: '原料' },
  { id: 'P003', name: '精裝成品 X', unit: '箱', price: 1200, category: '成品' },
  { id: 'P004', name: '標準成品 Y', unit: '箱', price: 800, category: '成品' },
  { id: 'P005', name: '散裝成品 Z', unit: '包', price: 350, category: '成品' },
  { id: 'P006', name: '客製組合包', unit: '組', price: 2500, category: '組合' },
  { id: 'P007', name: '維修服務', unit: '次', price: 3000, category: '服務' },
  { id: 'P008', name: '年度保固', unit: '年', price: 12000, category: '服務' },
]

/**
 * Calculate deal total from line items
 */
export function calculateDealTotal(lineItems) {
  let subtotal = 0
  let totalDiscount = 0
  let totalTax = 0

  const items = lineItems.map(item => {
    const amount = (item.quantity || 0) * (item.unit_price || 0)
    const discount = item.discount_percent ? amount * (item.discount_percent / 100) : (item.discount_amount || 0)
    const afterDiscount = amount - discount
    const tax = afterDiscount * ((item.tax_rate || 5) / 100)

    subtotal += amount
    totalDiscount += discount
    totalTax += tax

    return { ...item, amount, discount, afterDiscount, tax, total: afterDiscount + tax }
  })

  return {
    items,
    subtotal: Math.round(subtotal),
    totalDiscount: Math.round(totalDiscount),
    totalTax: Math.round(totalTax),
    grandTotal: Math.round(subtotal - totalDiscount + totalTax),
  }
}

// ============================================================
// Multi-Pipeline Support
// ============================================================

export const DEFAULT_PIPELINES = [
  { id: 'default', name: '預設漏斗', stages: ['初步接觸', '需求分析', '報價', '議價', '贏單', '輸單'], color: 'var(--accent-cyan)' },
  { id: 'enterprise', name: '企業大單', stages: ['需求確認', '方案設計', '報價審核', '合約談判', '簽約', '失敗'], color: 'var(--accent-purple)' },
  { id: 'renewal', name: '續約管理', stages: ['到期提醒', '聯繫中', '報價中', '確認續約', '已續約', '未續約'], color: 'var(--accent-green)' },
]
