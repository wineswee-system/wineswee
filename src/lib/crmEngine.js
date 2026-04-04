/**
 * CRM Engine — Core business logic for CRM gaps implementation
 * Covers: Contact↔Company, CLV, Dynamic Segments, Lead Scoring, SLA,
 * Funnel Analytics, Win/Loss, Points Engine, Tier Rules, Dedup, Unsubscribe
 */

// ============================================================
// 1. Contact ↔ Company (Account) Model
// ============================================================

/**
 * Create a company (account) record
 */
export function createCompanyRecord(data) {
  return {
    id: data.id || `COM-${Date.now()}`,
    name: data.name || '',
    industry: data.industry || '',
    size: data.size || '', // 微型, 小型, 中型, 大型
    website: data.website || '',
    address: data.address || '',
    tax_id: data.tax_id || '', // 統一編號
    phone: data.phone || '',
    annual_revenue: data.annual_revenue || 0,
    employee_count: data.employee_count || 0,
    owner: data.owner || '',
    notes: data.notes || '',
    created_at: data.created_at || new Date().toISOString(),
  }
}

/**
 * Link a contact to a company with a role
 */
export function linkContactToCompany(contactId, companyId, role = '聯絡人') {
  const ROLES = ['決策者', '影響者', '聯絡人', '採購', '技術負責人', '財務負責人', '其他']
  return {
    contact_id: contactId,
    company_id: companyId,
    role: ROLES.includes(role) ? role : '聯絡人',
    is_primary: false,
    created_at: new Date().toISOString(),
  }
}

/**
 * Get all contacts for a company
 */
export function getCompanyContacts(contacts, companyLinks, companyId) {
  const linkIds = companyLinks.filter(l => l.company_id === companyId).map(l => l.contact_id)
  return contacts.filter(c => linkIds.includes(c.id))
}

// ============================================================
// 2. Customer Lifetime Value (CLV)
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
// 3. Dynamic Segmentation Engine
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
// 4. Lead Scoring
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

// ============================================================
// 5. SLA Engine
// ============================================================

export const SLA_POLICIES = [
  { priority: '緊急', response_hours: 1, resolution_hours: 4, label: '緊急 SLA' },
  { priority: '高', response_hours: 4, resolution_hours: 24, label: '高優先 SLA' },
  { priority: '一般', response_hours: 8, resolution_hours: 48, label: '一般 SLA' },
  { priority: '低', response_hours: 24, resolution_hours: 72, label: '低優先 SLA' },
]

/**
 * Calculate SLA status for a ticket
 */
export function calculateSLAStatus(ticket) {
  const policy = SLA_POLICIES.find(p => p.priority === ticket.priority) || SLA_POLICIES[2]
  const createdAt = new Date(ticket.created_at)
  const now = ticket.resolved_at ? new Date(ticket.resolved_at) : new Date()
  const hoursElapsed = (now - createdAt) / (1000 * 60 * 60)

  const responseDeadline = new Date(createdAt.getTime() + policy.response_hours * 60 * 60 * 1000)
  const resolutionDeadline = new Date(createdAt.getTime() + policy.resolution_hours * 60 * 60 * 1000)

  const isResolved = ['已解決', '已關閉'].includes(ticket.status)
  const responseBreached = !ticket.first_response_at && now > responseDeadline
  const resolutionBreached = !isResolved && now > resolutionDeadline

  let status = 'on_track' // on_track, warning, breached
  if (resolutionBreached || responseBreached) status = 'breached'
  else if (hoursElapsed > policy.resolution_hours * 0.75) status = 'warning'

  return {
    status,
    policy,
    hoursElapsed: Math.round(hoursElapsed * 10) / 10,
    responseDeadline,
    resolutionDeadline,
    responseBreached,
    resolutionBreached,
    remainingHours: Math.max(0, Math.round((policy.resolution_hours - hoursElapsed) * 10) / 10),
  }
}

/**
 * Auto-assign ticket using round-robin
 */
export function autoAssignTicket(agents, tickets) {
  if (!agents.length) return null
  const assignCounts = {}
  agents.forEach(a => { assignCounts[a] = 0 })
  tickets.filter(t => !['已解決', '已關閉'].includes(t.status)).forEach(t => {
    if (t.assignee && assignCounts[t.assignee] !== undefined) assignCounts[t.assignee]++
  })
  return agents.reduce((min, a) => (assignCounts[a] < assignCounts[min] ? a : min), agents[0])
}

/**
 * Check if ticket should be escalated
 */
export function checkEscalation(ticket) {
  const sla = calculateSLAStatus(ticket)
  const escalations = []
  if (sla.responseBreached) escalations.push({ type: 'response', message: `回應 SLA 已逾期（${sla.policy.response_hours}小時）` })
  if (sla.resolutionBreached) escalations.push({ type: 'resolution', message: `解決 SLA 已逾期（${sla.policy.resolution_hours}小時）` })
  if (sla.status === 'warning') escalations.push({ type: 'warning', message: `即將逾期（剩餘 ${sla.remainingHours} 小時）` })
  return escalations
}

// ============================================================
// 6. Funnel / Pipeline Analytics
// ============================================================

const STAGE_ORDER = ['初步接觸', '需求分析', '報價', '議價', '贏單', '輸單']

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
// 7. Win/Loss Tracking
// ============================================================

export const WIN_REASONS = [
  '價格優勢', '產品品質', '服務態度', '品牌信任', '客製能力', '交期快速', '長期合作', '其他'
]

export const LOSS_REASONS = [
  '價格太高', '產品不符需求', '競爭對手搶單', '客戶預算不足', '客戶決策延遲',
  '服務不滿意', '交期無法配合', '聯繫不上客戶', '其他'
]

// ============================================================
// 8. Points & Loyalty Engine
// ============================================================

export const TIER_RULES = [
  { level: '一般', min_spent: 0, min_points: 0, earn_rate: 1, discount: 0 },
  { level: '銀卡', min_spent: 10000, min_points: 1000, earn_rate: 1.2, discount: 3 },
  { level: '金卡', min_spent: 30000, min_points: 3000, earn_rate: 1.5, discount: 5 },
  { level: '白金', min_spent: 80000, min_points: 8000, earn_rate: 2, discount: 8 },
  { level: '鑽石', min_spent: 200000, min_points: 20000, earn_rate: 3, discount: 12 },
]

/**
 * Calculate points earned from a purchase
 */
export function calculatePointsEarned(amount, memberLevel = '一般') {
  const tier = TIER_RULES.find(t => t.level === memberLevel) || TIER_RULES[0]
  const basePoints = Math.floor(amount / 10) // 1 point per $10
  return Math.floor(basePoints * tier.earn_rate)
}

/**
 * Determine the correct tier based on total spent/points
 */
export function calculateTier(totalSpent, totalPoints) {
  let newTier = TIER_RULES[0]
  for (const tier of TIER_RULES) {
    if (totalSpent >= tier.min_spent && totalPoints >= tier.min_points) {
      newTier = tier
    }
  }
  return newTier
}

/**
 * Process a point redemption
 */
export function redeemPoints(member, pointsToRedeem, redemptionType = 'discount') {
  if (pointsToRedeem <= 0 || pointsToRedeem > (member.available_points || 0)) {
    return { success: false, error: '點數不足或無效數量' }
  }

  const pointValue = 0.5 // 1 point = $0.5
  const discountAmount = Math.floor(pointsToRedeem * pointValue)

  return {
    success: true,
    transaction: {
      id: `PT-${Date.now()}`,
      member_id: member.id,
      type: 'redeem',
      points: -pointsToRedeem,
      description: `${redemptionType === 'discount' ? '折抵消費' : '兌換商品'} (${pointsToRedeem}點 = $${discountAmount})`,
      discount_amount: discountAmount,
      created_at: new Date().toISOString(),
    },
    newAvailablePoints: (member.available_points || 0) - pointsToRedeem,
    discountAmount,
  }
}

/**
 * Process a point earning event
 */
export function earnPoints(member, amount, description = '消費累點') {
  const points = calculatePointsEarned(amount, member.level)
  const newTotal = (member.total_points || 0) + points
  const newAvailable = (member.available_points || 0) + points
  const newSpent = (member.total_spent || 0) + amount
  const newTier = calculateTier(newSpent, newTotal)

  return {
    transaction: {
      id: `PT-${Date.now()}`,
      member_id: member.id,
      type: 'earn',
      points: points,
      description: `${description} ($${amount.toLocaleString()} × ${TIER_RULES.find(t => t.level === member.level)?.earn_rate || 1}x)`,
      created_at: new Date().toISOString(),
    },
    pointsEarned: points,
    newTotalPoints: newTotal,
    newAvailablePoints: newAvailable,
    newTotalSpent: newSpent,
    tierChanged: newTier.level !== member.level,
    newTier: newTier.level,
  }
}

/**
 * Generate referral code
 */
export function generateReferralCode(memberId) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'REF-'
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return { code, member_id: memberId, uses: 0, max_uses: 10, bonus_points: 200, created_at: new Date().toISOString() }
}

// ============================================================
// 9. Duplicate Detection
// ============================================================

/**
 * Find potential duplicate contacts
 */
export function findDuplicates(customers) {
  const duplicates = []
  for (let i = 0; i < customers.length; i++) {
    for (let j = i + 1; j < customers.length; j++) {
      const a = customers[i], b = customers[j]
      let score = 0
      const reasons = []

      // Exact phone match
      if (a.phone && b.phone && a.phone === b.phone) { score += 40; reasons.push('電話相同') }
      // Exact email match
      if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) { score += 40; reasons.push('Email相同') }
      // Same name + company
      if (a.name && b.name && a.name === b.name) { score += 30; reasons.push('姓名相同') }
      if (a.company && b.company && a.company === b.company) { score += 20; reasons.push('公司相同') }

      if (score >= 40) {
        duplicates.push({ customerA: a, customerB: b, score: Math.min(100, score), reasons })
      }
    }
  }
  return duplicates.sort((a, b) => b.score - a.score)
}

// ============================================================
// 10. Unsubscribe Management (個資法 Compliance)
// ============================================================

/**
 * Check if a customer has unsubscribed from a channel
 */
export function isUnsubscribed(unsubscribeList, customerId, channel = 'all') {
  return unsubscribeList.some(u =>
    u.customer_id === customerId && (u.channel === 'all' || u.channel === channel || channel === 'all')
  )
}

/**
 * Create unsubscribe record
 */
export function createUnsubscribeRecord(customerId, channel, reason = '') {
  return {
    id: `UNSUB-${Date.now()}`,
    customer_id: customerId,
    channel, // 'email', 'sms', 'line', 'all'
    reason,
    created_at: new Date().toISOString(),
  }
}

/**
 * Filter recipients by unsubscribe status
 */
export function filterUnsubscribed(recipients, unsubscribeList, channel) {
  return recipients.filter(r => !isUnsubscribed(unsubscribeList, r.id || r.customer_id, channel))
}

// ============================================================
// 11. CSV Import/Export
// ============================================================

/**
 * Parse CSV string to array of objects
 */
export function parseCSV(csvString) {
  const lines = csvString.trim().split('\n')
  if (lines.length < 2) return { headers: [], rows: [], errors: [] }

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const rows = []
  const errors = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    if (values.length !== headers.length) {
      errors.push(`第 ${i + 1} 行：欄位數量不符（預期 ${headers.length}，實際 ${values.length}）`)
      continue
    }
    const row = {}
    headers.forEach((h, idx) => { row[h] = values[idx] })
    rows.push(row)
  }

  return { headers, rows, errors }
}

/**
 * Convert array of objects to CSV string
 */
export function toCSV(data, columns) {
  if (!data.length) return ''
  const headers = columns || Object.keys(data[0])
  const headerLabels = headers.map(h => {
    const field = CUSTOMER_FIELDS.find(f => f.value === h)
    return field ? field.label : h
  })

  const rows = data.map(row =>
    headers.map(h => {
      let val = row[h]
      if (val === null || val === undefined) val = ''
      if (Array.isArray(val)) val = val.join(';')
      val = String(val).replace(/"/g, '""')
      return `"${val}"`
    }).join(',')
  )

  return [headerLabels.map(h => `"${h}"`).join(','), ...rows].join('\n')
}

/**
 * Download CSV as file
 */
export function downloadCSV(csvString, filename = 'export.csv') {
  const BOM = '\uFEFF' // UTF-8 BOM for Excel
  const blob = new Blob([BOM + csvString], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Map CSV headers to customer fields
 */
export const CSV_FIELD_MAP = {
  '客戶姓名': 'name', '姓名': 'name', 'name': 'name',
  '公司': 'company', '公司名稱': 'company', 'company': 'company',
  '電話': 'phone', 'phone': 'phone', '手機': 'phone',
  'Email': 'email', 'email': 'email', '信箱': 'email',
  '狀態': 'status', 'status': 'status',
  '標籤': 'tags', 'tags': 'tags',
  '來源': 'source', 'source': 'source',
  '負責業務': 'assigned_to', '業務': 'assigned_to',
  '備註': 'notes', 'notes': 'notes',
  '信用額度': 'credit_limit', 'credit_limit': 'credit_limit',
}

// ============================================================
// 12. Deal Products / Line Items
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
// 13. Multi-Pipeline Support
// ============================================================

export const DEFAULT_PIPELINES = [
  { id: 'default', name: '預設漏斗', stages: ['初步接觸', '需求分析', '報價', '議價', '贏單', '輸單'], color: 'var(--accent-cyan)' },
  { id: 'enterprise', name: '企業大單', stages: ['需求確認', '方案設計', '報價審核', '合約談判', '簽約', '失敗'], color: 'var(--accent-purple)' },
  { id: 'renewal', name: '續約管理', stages: ['到期提醒', '聯繫中', '報價中', '確認續約', '已續約', '未續約'], color: 'var(--accent-green)' },
]

// ============================================================
// 14. CSAT (Customer Satisfaction)
// ============================================================

/**
 * Create CSAT survey for resolved ticket
 */
export function createCSATSurvey(ticketId, customerId) {
  return {
    id: `CSAT-${Date.now()}`,
    ticket_id: ticketId,
    customer_id: customerId,
    score: null, // 1-5
    comment: '',
    created_at: new Date().toISOString(),
    responded_at: null,
  }
}

/**
 * Calculate CSAT metrics
 */
export function calculateCSATMetrics(surveys) {
  const responded = surveys.filter(s => s.score !== null)
  if (responded.length === 0) return { avg: 0, count: 0, responseRate: 0, distribution: {} }

  const avg = responded.reduce((s, r) => s + r.score, 0) / responded.length
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  responded.forEach(s => { distribution[s.score] = (distribution[s.score] || 0) + 1 })

  return {
    avg: Math.round(avg * 10) / 10,
    count: responded.length,
    responseRate: Math.round((responded.length / surveys.length) * 100),
    distribution,
    satisfiedRate: Math.round((responded.filter(s => s.score >= 4).length / responded.length) * 100),
  }
}

// ============================================================
// 15. Email Tracking (Open/Click)
// ============================================================

/**
 * Generate tracking pixel URL (simulated)
 */
export function generateTrackingPixel(campaignId, recipientId) {
  return `https://track.smeops.local/pixel/${campaignId}/${recipientId}.gif`
}

/**
 * Generate tracked link
 */
export function generateTrackedLink(originalUrl, campaignId, recipientId) {
  return `https://track.smeops.local/click/${campaignId}/${recipientId}?url=${encodeURIComponent(originalUrl)}`
}

/**
 * Calculate email tracking metrics
 */
export function calculateEmailMetrics(events) {
  const sent = events.filter(e => e.type === 'sent').length
  const delivered = events.filter(e => e.type === 'delivered').length
  const opened = new Set(events.filter(e => e.type === 'opened').map(e => e.recipient_id)).size
  const clicked = new Set(events.filter(e => e.type === 'clicked').map(e => e.recipient_id)).size
  const bounced = events.filter(e => e.type === 'bounced').length
  const unsubscribed = events.filter(e => e.type === 'unsubscribed').length

  return {
    sent, delivered, opened, clicked, bounced, unsubscribed,
    deliveryRate: sent > 0 ? Math.round((delivered / sent) * 100) : 0,
    openRate: delivered > 0 ? Math.round((opened / delivered) * 100) : 0,
    clickRate: opened > 0 ? Math.round((clicked / opened) * 100) : 0,
    bounceRate: sent > 0 ? Math.round((bounced / sent) * 100) : 0,
    unsubRate: delivered > 0 ? Math.round((unsubscribed / delivered) * 100) : 0,
  }
}

// ============================================================
// 16. Form Builder Model
// ============================================================

export function createFormDefinition(data) {
  return {
    id: data.id || `FORM-${Date.now()}`,
    name: data.name || '新表單',
    description: data.description || '',
    fields: data.fields || [
      { id: 'f1', type: 'text', label: '姓名', required: true, placeholder: '請輸入姓名' },
      { id: 'f2', type: 'email', label: 'Email', required: true, placeholder: '請輸入Email' },
      { id: 'f3', type: 'tel', label: '電話', required: false, placeholder: '0912-345-678' },
      { id: 'f4', type: 'textarea', label: '需求說明', required: false, placeholder: '請描述您的需求...' },
    ],
    settings: {
      submitButtonText: data.submitButtonText || '送出',
      successMessage: data.successMessage || '感謝您的填寫！我們會盡快與您聯繫。',
      assignTo: data.assignTo || '',
      createDeal: data.createDeal || false,
      dealPipeline: data.dealPipeline || 'default',
      notifyEmail: data.notifyEmail || '',
      redirectUrl: data.redirectUrl || '',
    },
    style: {
      theme: data.theme || 'default', // default, minimal, modern
      primaryColor: data.primaryColor || '#22d3ee',
      borderRadius: data.borderRadius || 8,
    },
    status: data.status || 'draft', // draft, active, archived
    submissions: 0,
    created_at: new Date().toISOString(),
  }
}

export const FORM_FIELD_TYPES = [
  { value: 'text', label: '文字' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: '電話' },
  { value: 'number', label: '數字' },
  { value: 'textarea', label: '多行文字' },
  { value: 'select', label: '下拉選單' },
  { value: 'radio', label: '單選' },
  { value: 'checkbox', label: '多選' },
  { value: 'date', label: '日期' },
  { value: 'hidden', label: '隱藏欄位' },
]

// ============================================================
// 17. Workflow Builder Model
// ============================================================

export const WORKFLOW_TRIGGERS = [
  { value: 'deal_stage_changed', label: '商機階段變更' },
  { value: 'deal_won', label: '商機贏單' },
  { value: 'deal_lost', label: '商機輸單' },
  { value: 'contact_created', label: '新聯絡人建立' },
  { value: 'ticket_created', label: '新工單建立' },
  { value: 'ticket_sla_warning', label: '工單 SLA 即將逾期' },
  { value: 'ticket_sla_breached', label: '工單 SLA 已逾期' },
  { value: 'form_submitted', label: '表單提交' },
  { value: 'customer_inactive', label: '客戶不活躍' },
  { value: 'member_tier_changed', label: '會員等級變更' },
]

export const WORKFLOW_ACTIONS = [
  { value: 'send_email', label: '發送 Email', icon: '📧' },
  { value: 'send_line', label: '發送 LINE', icon: '💬' },
  { value: 'send_sms', label: '發送 SMS', icon: '📱' },
  { value: 'create_task', label: '建立任務', icon: '📋' },
  { value: 'assign_to', label: '指派負責人', icon: '👤' },
  { value: 'update_field', label: '更新欄位', icon: '✏️' },
  { value: 'add_tag', label: '新增標籤', icon: '🏷️' },
  { value: 'create_deal', label: '建立商機', icon: '💰' },
  { value: 'create_ticket', label: '建立工單', icon: '🎫' },
  { value: 'add_points', label: '新增點數', icon: '⭐' },
  { value: 'wait', label: '等待', icon: '⏳' },
  { value: 'condition', label: '條件分支', icon: '🔀' },
  { value: 'webhook', label: 'Webhook', icon: '🔗' },
  { value: 'notify', label: '系統通知', icon: '🔔' },
]

export function createWorkflow(data) {
  return {
    id: data.id || `WF-${Date.now()}`,
    name: data.name || '新工作流程',
    description: data.description || '',
    trigger: data.trigger || 'contact_created',
    triggerConfig: data.triggerConfig || {},
    steps: data.steps || [],
    status: data.status || 'draft', // draft, active, paused
    executions: 0,
    created_at: new Date().toISOString(),
  }
}

// ============================================================
// 18. Role-Based CRM Permissions
// ============================================================

export const CRM_ROLES = [
  {
    id: 'admin', name: 'CRM 管理員',
    permissions: {
      customers: ['read', 'create', 'edit', 'delete', 'export', 'import'],
      deals: ['read', 'create', 'edit', 'delete', 'export'],
      tickets: ['read', 'create', 'edit', 'delete', 'assign'],
      campaigns: ['read', 'create', 'edit', 'delete', 'send'],
      members: ['read', 'create', 'edit', 'delete'],
      reports: ['read', 'export'],
      settings: ['read', 'edit'],
    }
  },
  {
    id: 'manager', name: '業務主管',
    permissions: {
      customers: ['read', 'create', 'edit', 'export'],
      deals: ['read', 'create', 'edit', 'export'],
      tickets: ['read', 'edit', 'assign'],
      campaigns: ['read', 'create', 'send'],
      members: ['read', 'edit'],
      reports: ['read', 'export'],
      settings: ['read'],
    }
  },
  {
    id: 'sales', name: '業務人員',
    permissions: {
      customers: ['read', 'create', 'edit'],
      deals: ['read', 'create', 'edit'],
      tickets: ['read', 'create'],
      campaigns: ['read'],
      members: ['read'],
      reports: ['read'],
      settings: [],
    }
  },
  {
    id: 'support', name: '客服人員',
    permissions: {
      customers: ['read'],
      deals: ['read'],
      tickets: ['read', 'create', 'edit'],
      campaigns: [],
      members: ['read'],
      reports: [],
      settings: [],
    }
  },
]

/**
 * Check if a role has a specific permission
 */
export function hasPermission(roleId, module, action) {
  const role = CRM_ROLES.find(r => r.id === roleId)
  if (!role) return false
  return role.permissions[module]?.includes(action) || false
}
