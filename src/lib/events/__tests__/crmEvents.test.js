/**
 * CRM Events catalog + Handlers — test suite
 *
 * Validates event schemas and handler side effects
 */
import { CRM_EVENTS } from '../catalog/crm.events'

describe('CRM-EVT-01: Event Catalog Schema', () => {
  test('all events have domain, action, version, payload', () => {
    for (const [key, schema] of Object.entries(CRM_EVENTS)) {
      expect(schema.domain).toBe('crm')
      expect(schema.action).toBeTruthy()
      expect(schema.version).toBeGreaterThanOrEqual(1)
      expect(schema.payload).toBeDefined()
    }
  })

  test('required payload fields marked correctly', () => {
    const wonEvent = CRM_EVENTS['crm.opportunity.won']
    expect(wonEvent.payload.opportunity_id.required).toBe(true)
    expect(wonEvent.payload.customer.required).toBe(true)
    expect(wonEvent.payload.amount.required).toBe(true)
  })

  test('form.submitted has data object payload', () => {
    const formEvent = CRM_EVENTS['crm.form.submitted']
    expect(formEvent.payload.data.type).toBe('object')
    expect(formEvent.payload.data.required).toBe(true)
  })

  test('at least 10 CRM events defined', () => {
    // catalog 會持續成長，固定數字會 rot；改成 baseline 斷言
    expect(Object.keys(CRM_EVENTS).length).toBeGreaterThanOrEqual(10)
  })

  test('all event keys match domain.action pattern', () => {
    for (const key of Object.keys(CRM_EVENTS)) {
      expect(key).toMatch(/^crm\.\w+\.\w+$/)
    }
  })

  test('lead.scored has old_score optional, new_score required', () => {
    const ev = CRM_EVENTS['crm.lead.scored']
    expect(ev.payload.old_score.required).toBe(false)
    expect(ev.payload.new_score.required).toBe(true)
  })

  test('activity.overdue has due_date required', () => {
    const ev = CRM_EVENTS['crm.activity.overdue']
    expect(ev.payload.due_date.required).toBe(true)
  })

  test('quote.generated has amount required', () => {
    const ev = CRM_EVENTS['crm.quote.generated']
    expect(ev.payload.amount.required).toBe(true)
    expect(ev.payload.amount.type).toBe('number')
  })
})
