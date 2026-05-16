/**
 * CRM — CLV, Dynamic Segmentation, Lead Scoring, and Customer Health Score
 */

// ============================================================
// Customer Lifetime Value (CLV)
// ============================================================

/**
 * Calculate CLV for a customer
 * Simple: total_spent + (avg monthly spend × predicted months remaining)
 */
export function calculateCLV(customer, orders = [], predictMonths = 24) {
  const totalSpent = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0)
  if (orders.length < 2) return { clv: totalSpent, avgMonthly: 0, frequency: 0, totalSpent }

  const dates = orders.map(o => new Date(o.created_at)).sort((a, b) => a - b)
  const firstDate = dates[0]
  const lastDate = dates[dates.length - 1]
  const monthsActive = Math.max(1, (lastDate - firstDate) / (1000 * 60 * 60 * 24 * 30))
  const avgMonthly = totalSpent / monthsActive
  const frequency = orders.length / monthsActive

  return {
    clv: Math.round(totalSpent + avgMonthly * predictMonths),
    avgMonthly: Math.round(avgMonthly),
    frequency: Math.round(frequency * 10) / 10,
    totalSpent,
    monthsActive: Math.round(monthsActive),
  }
}

// ============================================================
// Dynamic Segmentation Engine
// ============================================================

const OPERATORS = {
  eq: (a, b) => String(a) === String(b),
  ne: (a, b) => String(a) !== String(b),
  gt: (a, b) => Number(a) > Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  contains: (a, b) => String(a).includes(String(b)),
  not_contains: (a, b) => !String(a).includes(String(b)),
  in: (a, b) => (Array.isArray(b) ? b : String(b).split(',')).includes(String(a)),
  not_in: (a, b) => !(Array.isArray(b) ? b : String(b).split(',')).includes(String(a)),
  is_empty: (a) => !a || a === '' || (Array.isArray(a) && a.length === 0),
  is_not_empty: (a) => a && a !== '' && !(Array.isArray(a) && a.length === 0),
  days_ago_gt: (a, b) => {
    if (!a) return false
    const days = (Date.now() - new Date(a).getTime()) / (1000 * 60 * 60 * 24)
    return days > Number(b)
  },
  days_ago_lt: (a, b) => {
    if (!a) return false
    const days = (Date.now() - new Date(a).getTime()) / (1000 * 60 * 60 * 24)
    return days < Number(b)
  },
}

/**
 * Evaluate a single condition against a record
 */
export function evaluateCondition(record, condition) {
  const { field, operator, value } = condition
  const fieldValue = field.includes('.') ? field.split('.').reduce((obj, key) => obj?.[key], record) : record[field]
  const fn = OPERATORS[operator]
  if (!fn) return false
  return fn(fieldValue, value)
}

/**
 * Evaluate a segment definition against a list of records
 * Segment: { logic: 'and'|'or', conditions: [{ field, operator, value }] }
 */
export function evaluateSegment(records, segment) {
  const { logic = 'and', conditions = [] } = segment
  if (conditions.length === 0) return records

  return records.filter(record => {
    if (logic === 'and') return conditions.every(c => evaluateCondition(record, c))
    return conditions.some(c => evaluateCondition(record, c))
  })
}

/**
 * Pre-built segment definitions
 */
export const PRESET_SEGMENTS = {
  'all': { label: '全部客戶', logic: 'and', conditions: [] },
  'vip': { label: 'VIP 客戶', logic: 'and', conditions: [{ field: 'tags', operator: 'contains', value: 'VIP' }] },
  'inactive_180': { label: '半年未購買', logic: 'and', conditions: [{ field: 'last_purchase', operator: 'days_ago_gt', value: 180 }] },
  'birthday_month': { label: '生日當月', logic: 'and', conditions: [{ field: 'birth_month', operator: 'eq', value: new Date().getMonth() + 1 }] },
  'potential': { label: '潛力客戶', logic: 'and', conditions: [{ field: 'status', operator: 'eq', value: '潛在' }] },
  'high_value': { label: '高價值客戶', logic: 'and', conditions: [{ field: 'total_spent', operator: 'gt', value: 100000 }] },
  'at_risk': { label: '流失風險', logic: 'and', conditions: [{ field: 'last_purchase', operator: 'days_ago_gt', value: 90 }, { field: 'status', operator: 'ne', value: '流失' }] },
  'new_30': { label: '30天內新客', logic: 'and', conditions: [{ field: 'created_at', operator: 'days_ago_lt', value: 30 }] },
}

export const SEGMENT_OPERATORS = [
  { value: 'eq', label: '等於' },
  { value: 'ne', label: '不等於' },
  { value: 'gt', label: '大於' },
  { value: 'gte', label: '大於等於' },
  { value: 'lt', label: '小於' },
  { value: 'lte', label: '小於等於' },
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'in', label: '在列表中' },
  { value: 'is_empty', label: '為空' },
  { value: 'is_not_empty', label: '非空' },
  { value: 'days_ago_gt', label: '超過N天前' },
  { value: 'days_ago_lt', label: '在N天內' },
]

export const CUSTOMER_FIELDS = [
  { value: 'name', label: '客戶姓名', type: 'text' },
  { value: 'company', label: '公司名稱', type: 'text' },
  { value: 'status', label: '狀態', type: 'select', options: ['活躍', '潛在', '冷凍', '流失'] },
  { value: 'tags', label: '標籤', type: 'text' },
  { value: 'source', label: '來源', type: 'text' },
  { value: 'credit_limit', label: '信用額度', type: 'number' },
  { value: 'total_spent', label: '累計消費', type: 'number' },
  { value: 'outstanding_amount', label: '未收帳款', type: 'number' },
  { value: 'created_at', label: '建立日期', type: 'date' },
  { value: 'last_purchase', label: '最後購買', type: 'date' },
  { value: 'assigned_to', label: '負責業務', type: 'text' },
  { value: 'location_id', label: '分店', type: 'number' },
]

// ============================================================
// Lead Scoring
// ============================================================

const SCORE_RULES = [
  { field: 'status', condition: 'eq', value: '活躍', points: 20, label: '活躍客戶' },
  { field: 'tags', condition: 'contains', value: 'VIP', points: 30, label: 'VIP標籤' },
  { field: 'credit_limit', condition: 'gt', value: 50000, points: 15, label: '高信用額度' },
  { field: 'total_spent', condition: 'gt', value: 100000, points: 25, label: '高消費金額' },
  { field: 'total_spent', condition: 'gt', value: 50000, points: 15, label: '中消費金額' },
  { field: 'outstanding_amount', condition: 'gt', value: 0, points: -10, label: '有未收帳款' },
]

/**
 * Calculate lead score for a customer (0-100)
 */
export function calculateLeadScore(customer) {
  let score = 30 // base score
  const breakdown = []

  for (const rule of SCORE_RULES) {
    const val = customer[rule.field]
    let match = false
    if (rule.condition === 'eq') match = String(val) === String(rule.value)
    else if (rule.condition === 'gt') match = Number(val) > Number(rule.value)
    else if (rule.condition === 'contains') match = String(val || '').includes(String(rule.value))

    if (match) {
      score += rule.points
      breakdown.push({ label: rule.label, points: rule.points })
    }
  }

  // Contact frequency bonus
  if (customer._contactCount > 5) { score += 10; breakdown.push({ label: '高互動頻率', points: 10 }) }
  else if (customer._contactCount > 2) { score += 5; breakdown.push({ label: '中互動頻率', points: 5 }) }

  return { score: Math.max(0, Math.min(100, score)), breakdown }
}

/**
 * Enhanced lead scoring with AI — wraps aiLeadScore with fallback
 * Call from UI when you want AI-enhanced scores; falls back to rule-based.
 */
export async function calculateLeadScoreAI(customer, context = {}) {
  try {
    const { aiLeadScore } = await import('../ai/crmAI')
    return await aiLeadScore(customer, context)
  } catch {
    // Fallback to rule-based scoring
    const { score, breakdown } = calculateLeadScore(customer)
    return { score, breakdown: breakdown.map(b => ({ ...b, maxPoints: 30 })), explanation: '（規則式評分，AI 不可用）', nextAction: '' }
  }
}

// ============================================================
// Customer Health Score
// ============================================================

/**
 * Calculate health score for an existing customer (0-100).
 * Higher = healthier relationship, lower = churn risk.
 *
 * Factors:
 * - Recency: days since last purchase (max 30 pts)
 * - Frequency: purchase count in last 6 months (max 25 pts)
 * - Monetary: total spent relative to avg (max 20 pts)
 * - Engagement: contact/activity count (max 15 pts)
 * - Support: open ticket penalty (max -10 pts)
 */
export function calculateHealthScore(customer, { orders = [], activities = [], tickets = [], avgSpent = 50000 } = {}) {
  let score = 0
  const breakdown = []

  // 1. Recency (max 30)
  const lastPurchase = customer.last_purchase || customer.last_order_date
  if (lastPurchase) {
    const daysSince = Math.floor((Date.now() - new Date(lastPurchase).getTime()) / (1000 * 60 * 60 * 24))
    let recencyPts = 0
    if (daysSince <= 30) recencyPts = 30
    else if (daysSince <= 60) recencyPts = 25
    else if (daysSince <= 90) recencyPts = 20
    else if (daysSince <= 180) recencyPts = 10
    else recencyPts = 0
    score += recencyPts
    breakdown.push({ factor: '購買新近度', points: recencyPts, detail: `${daysSince} 天前` })
  } else {
    breakdown.push({ factor: '購買新近度', points: 0, detail: '無購買紀錄' })
  }

  // 2. Frequency (max 25)
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
  const recentOrders = orders.filter(o => new Date(o.created_at) >= sixMonthsAgo)
  const freqPts = Math.min(25, recentOrders.length * 5)
  score += freqPts
  breakdown.push({ factor: '購買頻率', points: freqPts, detail: `近半年 ${recentOrders.length} 筆` })

  // 3. Monetary (max 20)
  const totalSpent = customer.total_spent || orders.reduce((s, o) => s + (o.total_amount || 0), 0)
  const monetaryRatio = avgSpent > 0 ? totalSpent / avgSpent : 0
  const monetaryPts = Math.min(20, Math.round(monetaryRatio * 10))
  score += monetaryPts
  breakdown.push({ factor: '消費金額', points: monetaryPts, detail: `NT$ ${totalSpent.toLocaleString()}` })

  // 4. Engagement (max 15)
  const recentActivities = activities.filter(a => new Date(a.created_at) >= sixMonthsAgo)
  const engagePts = Math.min(15, recentActivities.length * 3)
  score += engagePts
  breakdown.push({ factor: '互動程度', points: engagePts, detail: `近半年 ${recentActivities.length} 次互動` })

  // 5. Support penalty (max -10)
  const openTickets = tickets.filter(t => !['已解決', '已關閉'].includes(t.status))
  const supportPenalty = Math.min(10, openTickets.length * 5)
  score -= supportPenalty
  if (supportPenalty > 0) {
    breakdown.push({ factor: '未解工單', points: -supportPenalty, detail: `${openTickets.length} 張未結` })
  }

  score = Math.max(0, Math.min(100, score))

  // Risk level
  let risk = '低風險'
  let riskColor = 'var(--accent-green)'
  if (score < 30) { risk = '高風險'; riskColor = 'var(--accent-red)' }
  else if (score < 60) { risk = '中風險'; riskColor = 'var(--accent-orange)' }

  return { score, breakdown, risk, riskColor }
}

/**
 * Batch calculate health scores and identify at-risk customers
 */
export function identifyAtRiskCustomers(customers, context = {}) {
  return customers
    .map(c => ({
      ...c,
      health: calculateHealthScore(c, {
        orders: (context.orders || []).filter(o => o.customer_id === c.id || o.customer_name === c.name),
        activities: (context.activities || []).filter(a => a.entity_id === c.id),
        tickets: (context.tickets || []).filter(t => t.customer_name === c.name),
        avgSpent: context.avgSpent || 50000,
      }),
    }))
    .filter(c => c.health.score < 60)
    .sort((a, b) => a.health.score - b.health.score)
}
