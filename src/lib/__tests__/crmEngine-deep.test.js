/**
 * Deep CRM Engine Tests — Covers untested functions:
 * Loyalty (earn/redeem/tier), Dedup, Unsubscribe, CSV, CSAT, Forms, Workflows
 */
import { describe, it, expect } from 'vitest'
import {
  calculateTier,
  earnPoints,
  redeemPoints,
  generateReferralCode,
  findDuplicates,
  isUnsubscribed,
  createUnsubscribeRecord,
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
  CRM_ROLES,
  PRODUCT_CATALOG,
} from '../crmEngine.js'

// ═════════════════════════════════════════════════════════════
describe('Loyalty: Tier Calculation', () => {
  it('一般 tier for zero spend', () => {
    const tier = calculateTier(0, 0)
    expect(tier.level).toBe('一般')
  })

  it('銀卡 at 10K spent + 1K points', () => {
    const tier = calculateTier(10000, 1000)
    expect(tier.level).toBe('銀卡')
  })

  it('鑽石 at 200K+ spent', () => {
    const tier = calculateTier(200000, 20000)
    expect(tier.level).toBe('鑽石')
    expect(tier.earn_rate).toBe(3)
    expect(tier.discount).toBe(12)
  })
})

describe('Loyalty: Earn & Redeem Points', () => {
  const member = {
    id: 'M001',
    level: '金卡',
    total_points: 5000,
    available_points: 3000,
    total_spent: 50000,
  }

  it('earns points from purchase', () => {
    const result = earnPoints(member, 10000, '門市消費')
    expect(result.pointsEarned).toBeGreaterThan(0)
    expect(result.newTotalPoints).toBeGreaterThan(5000)
    expect(result.newTotalSpent).toBe(60000)
    expect(result.transaction).toBeDefined()
  })

  it('redeems points successfully', () => {
    const result = redeemPoints(member, 1000)
    expect(result.success).toBe(true)
    expect(result.newAvailablePoints).toBe(2000)
    expect(result.transaction).toBeDefined()
  })

  it('rejects redeem when insufficient points', () => {
    const result = redeemPoints(member, 5000) // Only 3000 available
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('generates referral code', () => {
    const ref = generateReferralCode('M001')
    expect(ref.code).toBeTruthy()
    expect(ref.member_id).toBe('M001')
    expect(ref.max_uses).toBeGreaterThan(0)
  })
})

// ═════════════════════════════════════════════════════════════
describe('Duplicate Detection', () => {
  it('finds duplicates by email', () => {
    const customers = [
      { id: '1', name: 'Alice Wang', email: 'alice@test.com', phone: '0912111222' },
      { id: '2', name: 'Alice W.', email: 'alice@test.com', phone: '0912111333' },
      { id: '3', name: 'Bob Chen', email: 'bob@test.com', phone: '0912222333' },
    ]
    const dupes = findDuplicates(customers)
    expect(dupes.length).toBeGreaterThanOrEqual(1)
    expect(dupes[0].score).toBeGreaterThan(0)
  })

  it('no duplicates in unique list', () => {
    const customers = [
      { id: '1', name: 'Alice', email: 'a@test.com', phone: '0911111111' },
      { id: '2', name: 'Bob', email: 'b@test.com', phone: '0922222222' },
    ]
    const dupes = findDuplicates(customers)
    expect(dupes).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════
describe('Unsubscribe Management', () => {
  const unsubList = [
    { customer_id: 'C1', channel: 'email' },
    { customer_id: 'C1', channel: 'sms' },
    { customer_id: 'C2', channel: 'email' },
  ]

  it('checks if customer is unsubscribed', () => {
    expect(isUnsubscribed(unsubList, 'C1', 'email')).toBe(true)
    expect(isUnsubscribed(unsubList, 'C1', 'line')).toBe(false)
    expect(isUnsubscribed(unsubList, 'C3', 'email')).toBe(false)
  })

  it('creates unsubscribe record', () => {
    const record = createUnsubscribeRecord('C5', 'email', '不想再收到')
    expect(record.customer_id).toBe('C5')
    expect(record.channel).toBe('email')
    expect(record.reason).toBe('不想再收到')
    expect(record.id).toBeTruthy()
  })

  it('filters unsubscribed from recipients', () => {
    const recipients = [
      { id: 'C1', email: 'c1@test.com' },
      { id: 'C2', email: 'c2@test.com' },
      { id: 'C3', email: 'c3@test.com' },
    ]
    const filtered = filterUnsubscribed(recipients, unsubList, 'email')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('C3')
  })
})

// ═════════════════════════════════════════════════════════════
describe('CSV Import/Export', () => {
  it('parses CSV string', () => {
    const csv = '姓名,電話,信箱\n王小明,0912345678,wang@test.com\n李小華,0922333444,lee@test.com'
    const result = parseCSV(csv)
    expect(result.headers).toEqual(['姓名', '電話', '信箱'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]['姓名']).toBe('王小明')
    expect(result.errors).toHaveLength(0)
  })

  it('exports to CSV string', () => {
    const data = [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ]
    // toCSV takes column keys (strings), not {key,label} objects
    const csv = toCSV(data, ['name', 'email'])
    expect(csv).toContain('Alice')
    expect(csv).toContain('bob@test.com')
  })
})

// ═════════════════════════════════════════════════════════════
describe('Deal Line Items', () => {
  it('calculates deal total with line items', () => {
    // Uses quantity and unit_price fields, tax_rate as percentage (5 = 5%)
    const items = [
      { product_code: 'P1', quantity: 10, unit_price: 100, discount_percent: 5, tax_rate: 5 },
      { product_code: 'P2', quantity: 5, unit_price: 200, discount_percent: 0, tax_rate: 5 },
    ]
    const result = calculateDealTotal(items)
    expect(result.subtotal).toBeGreaterThan(0)
    expect(result.grandTotal).toBeGreaterThan(result.subtotal) // Tax added
    expect(result.items).toHaveLength(2)
  })
})

// ═════════════════════════════════════════════════════════════
describe('CSAT', () => {
  it('creates survey record', () => {
    const survey = createCSATSurvey('TK-001', 'C1')
    expect(survey.ticket_id).toBe('TK-001')
    expect(survey.customer_id).toBe('C1')
    expect(survey.score).toBeNull()
  })

  it('calculates CSAT metrics', () => {
    const surveys = [
      { score: 5, responded_at: '2026-01-01' },
      { score: 4, responded_at: '2026-01-02' },
      { score: 3, responded_at: '2026-01-03' },
      { score: null, responded_at: null }, // Unanswered
    ]
    const metrics = calculateCSATMetrics(surveys)
    expect(metrics.avg).toBe(4)
    expect(metrics.count).toBe(3) // Only answered
    expect(metrics.responseRate).toBe(75)
  })
})

// ═════════════════════════════════════════════════════════════
describe('Email Tracking', () => {
  it('generates tracking pixel URL', () => {
    const url = generateTrackingPixel('CAMP-001', 'R-001')
    expect(url).toContain('CAMP-001')
    expect(url).toContain('R-001')
  })

  it('generates tracked link', () => {
    const url = generateTrackedLink('https://example.com/page', 'CAMP-001', 'R-001')
    expect(url).toContain('CAMP-001')
    expect(url).toContain('example.com')
  })

  it('calculates email metrics', () => {
    const events = [
      { type: 'sent' }, { type: 'sent' }, { type: 'sent' },
      { type: 'delivered' }, { type: 'delivered' },
      { type: 'opened' },
      { type: 'clicked' },
      { type: 'bounced' },
    ]
    const metrics = calculateEmailMetrics(events)
    expect(metrics.sent).toBe(3)
    expect(metrics.delivered).toBe(2)
    expect(metrics.opened).toBe(1)
    expect(metrics.clicked).toBe(1)
    expect(metrics.bounced).toBe(1)
    expect(metrics.openRate).toBeGreaterThan(0)
  })
})

// ═════════════════════════════════════════════════════════════
describe('Form Builder & Workflow', () => {
  it('creates form definition', () => {
    const form = createFormDefinition({
      name: 'Lead Capture',
      fields: [{ name: '姓名', type: 'text', required: true }],
    })
    expect(form.id).toBeTruthy()
    expect(form.name).toBe('Lead Capture')
    expect(form.fields).toHaveLength(1)
  })

  it('creates workflow', () => {
    const wf = createWorkflow({
      name: 'Auto-assign lead',
      trigger: 'new_contact',
      actions: [{ type: 'assign', value: 'sales-team' }],
    })
    expect(wf.id).toBeTruthy()
    expect(wf.name).toBe('Auto-assign lead')
  })
})

// ═════════════════════════════════════════════════════════════
describe('CRM RBAC', () => {
  it('checks permissions by role', () => {
    // Find the first role that exists in CRM_ROLES
    const adminRole = CRM_ROLES.find(r => r.id === 'admin' || r.id === 'crm_admin')
    if (adminRole) {
      // Get a module from its permissions
      const modules = Object.keys(adminRole.permissions)
      if (modules.length > 0) {
        const actions = adminRole.permissions[modules[0]]
        expect(hasPermission(adminRole.id, modules[0], actions[0])).toBe(true)
      }
    }
    // Non-existent role returns false
    expect(hasPermission('nonexistent', 'customers', 'view')).toBe(false)
  })

  it('CRM_ROLES has entries', () => {
    expect(CRM_ROLES.length).toBeGreaterThanOrEqual(2)
  })

  it('PRODUCT_CATALOG exists', () => {
    expect(PRODUCT_CATALOG).toBeDefined()
    expect(Array.isArray(PRODUCT_CATALOG)).toBe(true)
  })
})
