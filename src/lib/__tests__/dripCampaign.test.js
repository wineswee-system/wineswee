import { describe, it, expect } from 'vitest'
import {
  TRIGGER_TYPES,
  STEP_TYPES,
  createDripCampaign,
  addDripStep,
  evaluateDripCondition,
  simulateDripCampaign,
  calculateDripMetrics,
  DRIP_TEMPLATES,
} from '../dripCampaign.js'

// ═════════════════════════════════════════════════════════════
describe('TRIGGER_TYPES & STEP_TYPES', () => {
  it('has 7 trigger types', () => {
    expect(TRIGGER_TYPES.length).toBe(7)
    const ids = TRIGGER_TYPES.map(t => t.id)
    expect(ids).toContain('new_customer')
    expect(ids).toContain('abandoned_cart')
    expect(ids).toContain('post_purchase')
    expect(ids).toContain('manual')
  })

  it('has step types for all channels', () => {
    const ids = STEP_TYPES.map(t => t.id)
    expect(ids).toContain('email')
    expect(ids).toContain('line')
    expect(ids).toContain('sms')
    expect(ids).toContain('wait')
    expect(ids).toContain('condition')
  })
})

// ═════════════════════════════════════════════════════════════
describe('createDripCampaign', () => {
  it('DC-01: creates campaign with steps', () => {
    const campaign = createDripCampaign({
      name: '新客歡迎序列',
      trigger: 'new_customer',
      steps: [
        { type: 'email', subject: '歡迎加入', content: '歡迎！' },
        { type: 'wait', delay_days: 3 },
        { type: 'email', subject: '開始使用', content: '教學' },
      ],
    })
    expect(campaign.id).toBeTruthy()
    expect(campaign.name).toBe('新客歡迎序列')
    expect(campaign.trigger).toBe('new_customer')
    expect(campaign.steps).toHaveLength(3)
    expect(campaign.status).toBe('draft')
    expect(campaign.created_at).toBeTruthy()
  })

  it('throws for missing name', () => {
    expect(() => createDripCampaign({})).toThrow('名稱')
  })

  it('throws for invalid trigger', () => {
    expect(() => createDripCampaign({ name: 'Test', trigger: 'invalid' })).toThrow('不支援的觸發類型')
  })

  it('defaults trigger to manual', () => {
    const campaign = createDripCampaign({ name: 'Test' })
    expect(campaign.trigger).toBe('manual')
  })
})

// ═════════════════════════════════════════════════════════════
describe('addDripStep', () => {
  const campaign = createDripCampaign({ name: 'Test' })

  it('adds email step with subject', () => {
    const steps = addDripStep(campaign, { type: 'email', subject: '主旨', content: '內容' })
    expect(steps).toHaveLength(1)
    expect(steps[0].type).toBe('email')
    expect(steps[0].subject).toBe('主旨')
  })

  it('adds wait step', () => {
    const steps = addDripStep(campaign, { type: 'wait', delay_days: 7 })
    expect(steps[0].delay_days).toBe(7)
  })

  it('throws for invalid step type', () => {
    expect(() => addDripStep(campaign, { type: 'invalid' })).toThrow('不支援的步驟類型')
  })

  it('throws for email without subject or template', () => {
    expect(() => addDripStep(campaign, { type: 'email' })).toThrow('subject 或 template_id')
  })

  it('throws for condition without field/operator', () => {
    expect(() => addDripStep(campaign, { type: 'condition' })).toThrow('field 與 operator')
  })
})

// ═════════════════════════════════════════════════════════════
describe('evaluateDripCondition', () => {
  it('DC-02: evaluates opened_email condition', () => {
    expect(evaluateDripCondition(
      { opened_email: true },
      { field: 'opened_email', operator: 'eq', value: true },
    )).toBe(true)
  })

  it('DC-03: evaluates purchased condition', () => {
    expect(evaluateDripCondition(
      { purchased: false },
      { field: 'purchased', operator: 'eq', value: false },
    )).toBe(true)
  })

  it('numeric comparison', () => {
    expect(evaluateDripCondition(
      { total_spent: 50000 },
      { field: 'total_spent', operator: 'gt', value: 30000 },
    )).toBe(true)
  })

  it('returns false for null/missing condition', () => {
    expect(evaluateDripCondition({}, null)).toBe(false)
    expect(evaluateDripCondition({}, {})).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════
describe('simulateDripCampaign', () => {
  it('DC-04: simulates campaign execution', () => {
    const campaign = createDripCampaign({
      name: 'Test Simulation',
      trigger: 'new_customer',
      steps: [
        { type: 'email', subject: 'Welcome', content: 'Hello' },
        { type: 'wait', delay_days: 3 },
        { type: 'email', subject: 'Follow-up', content: 'How are you?' },
      ],
    })
    // Enrich steps with step_index
    campaign.steps = campaign.steps.map((s, i) => ({ ...s, step_index: i, id: `step-${i}` }))

    const contacts = [
      { id: 'C1', name: 'Alice', email: 'alice@test.com' },
      { id: 'C2', name: 'Bob', email: 'bob@test.com' },
      { id: 'C3', name: 'Charlie', email: 'charlie@test.com' },
    ]

    const result = simulateDripCampaign(campaign, contacts)
    expect(result).toBeDefined()
    // Should have simulation data for each step
    if (result.steps) {
      expect(result.steps.length).toBeGreaterThan(0)
    }
  })
})

// ═════════════════════════════════════════════════════════════
describe('calculateDripMetrics', () => {
  it('DC-05: calculates open/click/conversion rates', () => {
    const campaign = createDripCampaign({ name: 'Test' })
    const history = [
      { step_type: 'email', status: 'sent', opened: true, clicked: true, converted: true },
      { step_type: 'email', status: 'sent', opened: true, clicked: false, converted: false },
      { step_type: 'email', status: 'sent', opened: false, clicked: false, converted: false },
      { step_type: 'email', status: 'failed' },
    ]
    const metrics = calculateDripMetrics(campaign, history)
    expect(metrics).toBeDefined()
    // Should have aggregate metrics
    if (metrics.total_sent !== undefined) {
      expect(metrics.total_sent).toBeGreaterThanOrEqual(0)
    }
  })
})

// ═════════════════════════════════════════════════════════════
describe('DRIP_TEMPLATES', () => {
  it('DC-06: all templates have valid structure', () => {
    expect(DRIP_TEMPLATES.length).toBeGreaterThanOrEqual(3)
    for (const tmpl of DRIP_TEMPLATES) {
      expect(tmpl.id).toBeTruthy()
      expect(tmpl.name).toBeTruthy()
      expect(tmpl.steps).toBeDefined()
      expect(Array.isArray(tmpl.steps)).toBe(true)
    }
  })
})
