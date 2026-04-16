/**
 * CRM Engine — FULL test suite for new features (2026-04-12)
 *
 * Covers NEW functions not in existing test files: forecastRevenue, earnPoints,
 * redeemPoints, calculateTier, findDuplicates, isUnsubscribed, filterUnsubscribed,
 * calculateDealTotal, calculateCSATMetrics, calculateEmailMetrics, createFormDefinition,
 * createWorkflow, hasPermission, calculateHealthScore, identifyAtRiskCustomers
 */
import {
  forecastRevenue,
  calculatePointsEarned,
  calculateTier,
  redeemPoints,
  earnPoints,
  TIER_RULES,
  findDuplicates,
  isUnsubscribed,
  filterUnsubscribed,
  parseCSV,
  toCSV,
  calculateDealTotal,
  createCSATSurvey,
  calculateCSATMetrics,
  generateTrackingPixel,
  generateTrackedLink,
  calculateEmailMetrics,
  createFormDefinition,
  createWorkflow,
  hasPermission,
  calculateHealthScore,
  identifyAtRiskCustomers,
} from '../crmEngine'

// ════════════════════════════════════════
// 1. Revenue Forecast
// ════════════════════════════════════════

describe('CRM-NEW-01: Revenue Forecast', () => {
  test('forecastRevenue filters won/lost and weights by probability', () => {
    // Use a future month to ensure the expected_close falls in the forecast window
    const now = new Date()
    const futureMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const monthKey = futureMonth.toISOString().slice(0, 7)
    const deals = [
      { stage: '報價', amount: 100000, probability: 50, expected_close: `${monthKey}-15` },
      { stage: '贏單', amount: 200000, probability: 100, expected_close: `${monthKey}-10` },
    ]
    const result = forecastRevenue(deals, 3)
    // Find the month entry that matches our future month
    const entry = result.find(r => r.month === monthKey)
    expect(entry).toBeDefined()
    expect(entry.weighted).toBe(50000) // only 報價 deal
    expect(entry.dealCount).toBe(1)
  })

  test('forecastRevenue returns correct number of months', () => {
    const result = forecastRevenue([], 6)
    expect(result).toHaveLength(6)
  })

  test('forecastRevenue handles missing expected_close', () => {
    const deals = [{ stage: '報價', amount: 50000, probability: 80 }]
    const result = forecastRevenue(deals, 1)
    expect(result[0].dealCount).toBe(0)
  })
})

// ════════════════════════════════════════
// 2. Points & Loyalty (extended)
// ════════════════════════════════════════

describe('CRM-NEW-02: Points & Loyalty Engine', () => {
  test('calculatePointsEarned — base rate (一般)', () => {
    expect(calculatePointsEarned(1000, '一般')).toBe(100)
  })

  test('calculatePointsEarned — gold tier (金卡, 1.5x)', () => {
    expect(calculatePointsEarned(1000, '金卡')).toBe(150)
  })

  test('calculatePointsEarned — diamond tier (鑽石, 3x)', () => {
    expect(calculatePointsEarned(1000, '鑽石')).toBe(300)
  })

  test('calculatePointsEarned — unknown tier defaults to 一般', () => {
    expect(calculatePointsEarned(1000, 'UNKNOWN')).toBe(100)
  })

  test('calculateTier — lowest tier by default', () => {
    expect(calculateTier(0, 0).level).toBe('一般')
  })

  test('calculateTier — requires both spent AND points', () => {
    expect(calculateTier(100000, 0).level).toBe('一般')
    expect(calculateTier(0, 10000).level).toBe('一般')
    expect(calculateTier(30000, 3000).level).toBe('金卡')
  })

  test('calculateTier — diamond tier', () => {
    expect(calculateTier(200000, 20000).level).toBe('鑽石')
  })

  test('redeemPoints — success', () => {
    const member = { id: 'm1', available_points: 500 }
    const result = redeemPoints(member, 200)
    expect(result.success).toBe(true)
    expect(result.discountAmount).toBe(100)
    expect(result.newAvailablePoints).toBe(300)
    expect(result.transaction.points).toBe(-200)
  })

  test('redeemPoints — insufficient points', () => {
    expect(redeemPoints({ id: 'm1', available_points: 50 }, 100).success).toBe(false)
  })

  test('redeemPoints — zero/negative', () => {
    expect(redeemPoints({ id: 'm1', available_points: 500 }, 0).success).toBe(false)
    expect(redeemPoints({ id: 'm1', available_points: 500 }, -10).success).toBe(false)
  })

  test('earnPoints — calculates and detects tier change', () => {
    const member = { id: 'm1', level: '一般', total_points: 900, available_points: 900, total_spent: 9500 }
    const result = earnPoints(member, 1000)
    expect(result.pointsEarned).toBe(100)
    expect(result.newTotalPoints).toBe(1000)
    expect(result.newTotalSpent).toBe(10500)
    expect(result.tierChanged).toBe(true)
    expect(result.newTier).toBe('銀卡')
  })

  test('earnPoints — no tier change', () => {
    const member = { id: 'm1', level: '金卡', total_points: 5000, available_points: 5000, total_spent: 50000 }
    expect(earnPoints(member, 100).tierChanged).toBe(false)
  })
})

// ════════════════════════════════════════
// 3. Duplicate Detection
// ════════════════════════════════════════

describe('CRM-NEW-03: Duplicate Detection', () => {
  test('detects phone match (score 40)', () => {
    const dups = findDuplicates([
      { id: 1, name: 'A', phone: '0912345678' },
      { id: 2, name: 'B', phone: '0912345678' },
    ])
    expect(dups).toHaveLength(1)
    expect(dups[0].score).toBe(40)
  })

  test('detects email match case-insensitive', () => {
    const dups = findDuplicates([
      { id: 1, email: 'test@test.com' },
      { id: 2, email: 'TEST@TEST.COM' },
    ])
    expect(dups[0].reasons).toContain('Email相同')
  })

  test('phone + email + name = capped at 100', () => {
    const dups = findDuplicates([
      { id: 1, name: '王大明', phone: '0912', email: 'a@b.com' },
      { id: 2, name: '王大明', phone: '0912', email: 'a@b.com' },
    ])
    expect(dups[0].score).toBe(100)
  })

  test('name only (30) below threshold → no dup', () => {
    expect(findDuplicates([{ id: 1, name: '王大明' }, { id: 2, name: '王大明' }])).toHaveLength(0)
  })
})

// ════════════════════════════════════════
// 4. Unsubscribe Management
// ════════════════════════════════════════

describe('CRM-NEW-04: Unsubscribe (GDPR)', () => {
  const unsubs = [
    { customer_id: 'c1', channel: 'email' },
    { customer_id: 'c2', channel: 'all' },
  ]

  test('exact channel match', () => {
    expect(isUnsubscribed(unsubs, 'c1', 'email')).toBe(true)
    expect(isUnsubscribed(unsubs, 'c1', 'sms')).toBe(false)
  })

  test('channel=all blocks everything', () => {
    expect(isUnsubscribed(unsubs, 'c2', 'sms')).toBe(true)
  })

  test('filterUnsubscribed', () => {
    const result = filterUnsubscribed([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], unsubs, 'email')
    expect(result.map(r => r.id)).toEqual(['c3'])
  })
})

// ════════════════════════════════════════
// 5. CSV
// ════════════════════════════════════════

describe('CRM-NEW-05: CSV Import/Export', () => {
  test('parseCSV valid', () => {
    const { headers, rows, errors } = parseCSV('"name","email"\n"Alice","a@b.com"')
    expect(headers).toEqual(['name', 'email'])
    expect(rows).toHaveLength(1)
    expect(errors).toHaveLength(0)
  })

  test('parseCSV column mismatch', () => {
    const { errors } = parseCSV('a,b\n1,2,3')
    expect(errors).toHaveLength(1)
  })

  test('toCSV + escaping', () => {
    const csv = toCSV([{ name: 'Say "hi"' }], ['name'])
    expect(csv).toContain('""hi""')
  })

  test('toCSV empty', () => {
    expect(toCSV([])).toBe('')
  })
})

// ════════════════════════════════════════
// 6. Deal Totals
// ════════════════════════════════════════

describe('CRM-NEW-06: Deal Totals', () => {
  test('calculates with discount percent', () => {
    const result = calculateDealTotal([
      { quantity: 10, unit_price: 100, discount_percent: 10, tax_rate: 5 },
    ])
    expect(result.subtotal).toBe(1000)
    expect(result.totalDiscount).toBe(100)
    expect(result.totalTax).toBe(45)
    expect(result.grandTotal).toBe(945)
  })

  test('default tax rate is 5%', () => {
    expect(calculateDealTotal([{ quantity: 1, unit_price: 1000 }]).totalTax).toBe(50)
  })

  test('empty items', () => {
    expect(calculateDealTotal([]).grandTotal).toBe(0)
  })

  test('multiple items aggregate', () => {
    const result = calculateDealTotal([
      { quantity: 2, unit_price: 500, tax_rate: 5 },
      { quantity: 3, unit_price: 300, tax_rate: 5 },
    ])
    expect(result.subtotal).toBe(1900)
  })
})

// ════════════════════════════════════════
// 7. CSAT
// ════════════════════════════════════════

describe('CRM-NEW-07: CSAT Metrics', () => {
  test('createCSATSurvey template', () => {
    const s = createCSATSurvey('T1', 'C1')
    expect(s.score).toBeNull()
    expect(s.id).toMatch(/^CSAT-/)
  })

  test('calculateCSATMetrics', () => {
    const m = calculateCSATMetrics([{ score: 5 }, { score: 4 }, { score: 3 }, { score: null }])
    expect(m.avg).toBe(4)
    expect(m.count).toBe(3)
    expect(m.responseRate).toBe(75)
    expect(m.satisfiedRate).toBe(67)
  })

  test('no responses', () => {
    expect(calculateCSATMetrics([{ score: null }]).count).toBe(0)
  })
})

// ════════════════════════════════════════
// 8. Email Tracking
// ════════════════════════════════════════

describe('CRM-NEW-08: Email Tracking', () => {
  test('tracking pixel URL', () => {
    const url = generateTrackingPixel('C1', 'R1')
    expect(url).toContain('C1')
    expect(url).toContain('.gif')
  })

  test('tracked link encodes URL', () => {
    expect(generateTrackedLink('https://x.com?a=1', 'C1', 'R1')).toContain(encodeURIComponent('https://x.com?a=1'))
  })

  test('email metrics deduplicates opened/clicked', () => {
    const events = [
      { type: 'sent', recipient_id: 'r1' },
      { type: 'delivered', recipient_id: 'r1' },
      { type: 'opened', recipient_id: 'r1' },
      { type: 'opened', recipient_id: 'r1' },
    ]
    expect(calculateEmailMetrics(events).opened).toBe(1)
  })
})

// ════════════════════════════════════════
// 9. Form & Workflow Builder
// ════════════════════════════════════════

describe('CRM-NEW-09: Form & Workflow Builder', () => {
  test('createFormDefinition defaults', () => {
    const f = createFormDefinition({ name: 'Test' })
    expect(f.fields).toHaveLength(4)
    expect(f.status).toBe('draft')
    expect(f.settings.submitButtonText).toBe('送出')
  })

  test('createWorkflow defaults', () => {
    const w = createWorkflow({ name: 'WF' })
    expect(w.trigger).toBe('contact_created')
    expect(w.status).toBe('draft')
    expect(w.executions).toBe(0)
  })
})

// ════════════════════════════════════════
// 10. RBAC
// ════════════════════════════════════════

describe('CRM-NEW-10: Permissions', () => {
  test('admin full access', () => {
    expect(hasPermission('admin', 'customers', 'delete')).toBe(true)
  })

  test('sales limited', () => {
    expect(hasPermission('sales', 'customers', 'delete')).toBe(false)
    expect(hasPermission('sales', 'customers', 'edit')).toBe(true)
  })

  test('support limited', () => {
    expect(hasPermission('support', 'tickets', 'create')).toBe(true)
    expect(hasPermission('support', 'campaigns', 'create')).toBe(false)
  })

  test('unknown role', () => {
    expect(hasPermission('ghost', 'customers', 'read')).toBe(false)
  })
})

// ════════════════════════════════════════
// 11. Health Score
// ════════════════════════════════════════

describe('CRM-NEW-11: Customer Health Score', () => {
  test('high score for active buyer', () => {
    const customer = { last_purchase: new Date().toISOString(), total_spent: 100000 }
    const orders = [
      { created_at: new Date().toISOString(), total_amount: 10000 },
      { created_at: new Date().toISOString(), total_amount: 10000 },
    ]
    const { score } = calculateHealthScore(customer, { orders, avgSpent: 50000 })
    expect(score).toBeGreaterThanOrEqual(40)
  })

  test('low score with open tickets', () => {
    const past = new Date(Date.now() - 200 * 86400000).toISOString()
    const customer = { last_purchase: past, total_spent: 1000 }
    const { score, risk } = calculateHealthScore(customer, { tickets: [{ status: '待處理' }, { status: '處理中' }], avgSpent: 50000 })
    expect(score).toBeLessThan(30)
    expect(risk).toBe('高風險')
  })

  test('identifyAtRiskCustomers', () => {
    const customers = [
      { id: 1, name: 'Good', last_purchase: new Date().toISOString(), total_spent: 100000 },
      { id: 2, name: 'Bad' },
    ]
    const atRisk = identifyAtRiskCustomers(customers, { avgSpent: 50000 })
    expect(atRisk.length).toBeGreaterThanOrEqual(1)
    expect(atRisk[0].name).toBe('Bad')
  })
})
