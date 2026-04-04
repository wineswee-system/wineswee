import { describe, it, expect } from 'vitest'
import {
  createCompanyRecord,
  linkContactToCompany,
  getCompanyContacts,
  calculateCLV,
  evaluateCondition,
  evaluateSegment,
  PRESET_SEGMENTS,
  SEGMENT_OPERATORS,
  CUSTOMER_FIELDS,
  calculateLeadScore,
  SLA_POLICIES,
  calculateSLAStatus,
  autoAssignTicket,
  checkEscalation,
  calculateFunnelConversion,
  calculateRepPerformance,
  WIN_REASONS,
  LOSS_REASONS,
  TIER_RULES,
  calculatePointsEarned,
} from '../crmEngine.js'

// ═════════════════════════════════════════════════════════════
describe('Company-Contact Hierarchy', () => {
  it('CR-10: creates company record', () => {
    const company = createCompanyRecord({ name: 'Test Corp', industry: 'Tech' })
    expect(company).toBeDefined()
    expect(company.name).toBe('Test Corp')
    expect(company.id).toBeTruthy()
  })

  it('links contact to company with valid role', () => {
    const link = linkContactToCompany('C001', 'CO001', '決策者')
    expect(link.contact_id).toBe('C001')
    expect(link.company_id).toBe('CO001')
    expect(link.role).toBe('決策者')
  })

  it('defaults to 聯絡人 for invalid role', () => {
    const link = linkContactToCompany('C001', 'CO001', 'InvalidRole')
    expect(link.role).toBe('聯絡人')
  })

  it('gets company contacts', () => {
    const contacts = [
      { id: 'C001', name: 'Alice' },
      { id: 'C002', name: 'Bob' },
      { id: 'C003', name: 'Charlie' },
    ]
    const links = [
      { contact_id: 'C001', company_id: 'CO001', role: 'CEO' },
      { contact_id: 'C003', company_id: 'CO001', role: 'CTO' },
    ]
    const result = getCompanyContacts(contacts, links, 'CO001')
    expect(result).toHaveLength(2)
    expect(result.map(c => c.name)).toContain('Alice')
    expect(result.map(c => c.name)).toContain('Charlie')
  })
})

// ═════════════════════════════════════════════════════════════
describe('calculateCLV', () => {
  it('CR-02: calculates lifetime value', () => {
    const customer = { id: 'C001', created_at: '2024-01-01' }
    const orders = [
      { total_amount: 10000, created_at: '2024-06-01' },
      { total_amount: 15000, created_at: '2025-01-01' },
      { total_amount: 20000, created_at: '2025-06-01' },
    ]
    const result = calculateCLV(customer, orders)
    expect(result.totalSpent).toBe(45000)
    expect(result.clv).toBeGreaterThan(0)
    expect(result.avgMonthly).toBeGreaterThan(0)
    expect(result.frequency).toBeGreaterThan(0)
  })

  it('handles no orders', () => {
    const result = calculateCLV({ id: 'C001' }, [])
    expect(result.totalSpent).toBe(0)
    expect(result.clv).toBe(0)
  })

  it('single order returns totalSpent as clv', () => {
    const result = calculateCLV({ id: 'C001' }, [{ total_amount: 5000, created_at: '2025-01-01' }])
    expect(result.totalSpent).toBe(5000)
    expect(result.clv).toBe(5000)
  })
})

// ═════════════════════════════════════════════════════════════
describe('Segmentation', () => {
  it('CR-03: evaluates condition with operators', () => {
    const record = { total_spent: 50000, city: '台北市' }
    expect(evaluateCondition(record, { field: 'total_spent', operator: 'gt', value: 30000 })).toBe(true)
    expect(evaluateCondition(record, { field: 'total_spent', operator: 'lt', value: 30000 })).toBe(false)
    expect(evaluateCondition(record, { field: 'city', operator: 'eq', value: '台北市' })).toBe(true)
    expect(evaluateCondition(record, { field: 'city', operator: 'ne', value: '台北市' })).toBe(false)
    expect(evaluateCondition(record, { field: 'city', operator: 'contains', value: '台北' })).toBe(true)
  })

  it('evaluates segment', () => {
    const records = [
      { id: '1', total_spent: 50000 },
      { id: '2', total_spent: 10000 },
      { id: '3', total_spent: 80000 },
    ]
    const segment = { conditions: [{ field: 'total_spent', operator: 'gt', value: 30000 }], logic: 'and' }
    const result = evaluateSegment(records, segment)
    expect(result).toHaveLength(2)
  })

  it('has preset segments as object', () => {
    expect(Object.keys(PRESET_SEGMENTS).length).toBeGreaterThanOrEqual(3)
    expect(PRESET_SEGMENTS.vip).toBeDefined()
    expect(PRESET_SEGMENTS.high_value).toBeDefined()
  })

  it('has operators and fields defined', () => {
    expect(SEGMENT_OPERATORS.length).toBeGreaterThan(0)
    expect(CUSTOMER_FIELDS.length).toBeGreaterThan(0)
  })
})

// ═════════════════════════════════════════════════════════════
describe('calculateLeadScore', () => {
  it('CR-01: returns score 0-100', () => {
    const customer = {
      email: 'test@company.com',
      phone: '0912345678',
      company: 'Big Corp',
      total_spent: 100000,
      last_activity: new Date().toISOString(),
    }
    const result = calculateLeadScore(customer)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.breakdown).toBeDefined()
    expect(Array.isArray(result.breakdown)).toBe(true)
  })

  it('empty customer gets low score', () => {
    const result = calculateLeadScore({})
    expect(result.score).toBeLessThanOrEqual(30)
  })
})

// ═════════════════════════════════════════════════════════════
describe('SLA Management', () => {
  it('CR-04: calculates SLA status', () => {
    const ticket = {
      type: '問題',
      priority: '高',
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    }
    const result = calculateSLAStatus(ticket)
    expect(result.status).toBeTruthy()
    expect(result.hoursElapsed).toBeGreaterThanOrEqual(1)
    expect(typeof result.responseBreached).toBe('boolean')
    expect(typeof result.resolutionBreached).toBe('boolean')
  })

  it('SLA_POLICIES has entries', () => {
    expect(SLA_POLICIES.length).toBeGreaterThan(0)
  })

  it('CR-05: auto-assigns to least-loaded agent', () => {
    // autoAssignTicket takes agent strings, uses assignee field
    const agents = ['Agent A', 'Agent B']
    const tickets = [
      { assignee: 'Agent A', status: '處理中' },
      { assignee: 'Agent A', status: '處理中' },
      { assignee: 'Agent B', status: '處理中' },
    ]
    const result = autoAssignTicket(agents, tickets)
    expect(result).toBe('Agent B')
  })

  it('CR-06: checks escalation', () => {
    const overdueTicket = {
      type: '問題',
      priority: '高',
      created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      status: '處理中',
    }
    const escalations = checkEscalation(overdueTicket)
    expect(escalations.length).toBeGreaterThan(0)
    expect(escalations[0].type).toBeTruthy()
  })
})

// ═════════════════════════════════════════════════════════════
describe('Funnel & Performance', () => {
  it('CR-07: calculates funnel conversion', () => {
    const opportunities = [
      { stage: '潛在客戶', amount: 10000 },
      { stage: '需求確認', amount: 20000 },
      { stage: '報價中', amount: 15000 },
      { stage: '贏單', amount: 30000 },
    ]
    const result = calculateFunnelConversion(opportunities)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]).toHaveProperty('stage')
    expect(result[0]).toHaveProperty('current')
  })

  it('calculates rep performance', () => {
    const opportunities = [
      { assignee: 'Rep A', stage: '贏單', amount: 50000 },
      { assignee: 'Rep A', stage: '輸單', amount: 20000 },
      { assignee: 'Rep B', stage: '贏單', amount: 30000 },
    ]
    const reps = ['Rep A', 'Rep B']
    const result = calculateRepPerformance(opportunities, reps)
    expect(result).toHaveLength(2)
    const repA = result.find(r => r.rep === 'Rep A')
    expect(repA.wonDeals).toBe(1)
    expect(repA.lostDeals).toBe(1)
    expect(repA.totalRevenue).toBe(50000)
  })

  it('has win/loss reasons', () => {
    expect(WIN_REASONS.length).toBeGreaterThan(0)
    expect(LOSS_REASONS.length).toBeGreaterThan(0)
  })
})

// ═════════════════════════════════════════════════════════════
describe('Points & Loyalty', () => {
  it('CR-08: points earned based on tier earn_rate', () => {
    // 一般: earn_rate=1, 金卡: earn_rate=1.5
    const general = calculatePointsEarned(1000, '一般')
    const gold = calculatePointsEarned(1000, '金卡')
    expect(general).toBe(100) // floor(1000/10) * 1
    expect(gold).toBe(150)    // floor(1000/10) * 1.5
    expect(gold).toBeGreaterThan(general)
  })

  it('default tier earns base points', () => {
    const points = calculatePointsEarned(1000)
    expect(points).toBe(100) // floor(1000/10) * 1 (一般 default)
  })

  it('CR-09: tier rules cover 5 levels', () => {
    expect(TIER_RULES).toHaveLength(5)
    expect(TIER_RULES[0].level).toBe('一般')
    expect(TIER_RULES[4].level).toBe('鑽石')
  })

  it('higher tier = higher earn rate', () => {
    for (let i = 1; i < TIER_RULES.length; i++) {
      expect(TIER_RULES[i].earn_rate).toBeGreaterThan(TIER_RULES[i - 1].earn_rate)
    }
  })
})
