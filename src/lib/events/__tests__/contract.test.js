import { describe, it, expect } from 'vitest'
import { EVENT_CATALOG } from '../catalog/index.js'

/**
 * Contract Tests for Event Catalog
 *
 * Ensures producers and consumers agree on event schemas.
 * These tests act as a contract — if a schema changes,
 * both producer and consumer code must be updated.
 */

describe('Event Catalog Contract', () => {
  // ── Structure Validation ──

  it('every event has required fields', () => {
    for (const [type, schema] of Object.entries(EVENT_CATALOG)) {
      expect(schema.domain, `${type} missing domain`).toBeTruthy()
      expect(schema.action, `${type} missing action`).toBeTruthy()
      expect(schema.version, `${type} missing version`).toBeGreaterThanOrEqual(1)
      expect(schema.description, `${type} missing description`).toBeTruthy()
      expect(schema.payload, `${type} missing payload`).toBeTruthy()
    }
  })

  it('event type matches domain.action format', () => {
    for (const [type, schema] of Object.entries(EVENT_CATALOG)) {
      expect(type).toBe(`${schema.domain}.${schema.action}`)
    }
  })

  it('payload fields have type and required defined', () => {
    for (const [type, schema] of Object.entries(EVENT_CATALOG)) {
      for (const [field, def] of Object.entries(schema.payload)) {
        expect(def.type, `${type}.${field} missing type`).toBeTruthy()
        expect(typeof def.required, `${type}.${field} missing required`).toBe('boolean')
      }
    }
  })

  // ── Domain Coverage ──

  const EXPECTED_DOMAINS = ['finance', 'hr']

  it('all 2 domains are represented', () => {
    const domains = [...new Set(Object.values(EVENT_CATALOG).map(s => s.domain))]
    for (const expected of EXPECTED_DOMAINS) {
      expect(domains, `Missing domain: ${expected}`).toContain(expected)
    }
  })

  it('each domain has at least 2 events', () => {
    for (const domain of EXPECTED_DOMAINS) {
      const events = Object.entries(EVENT_CATALOG).filter(([, s]) => s.domain === domain)
      expect(events.length, `${domain} has fewer than 2 events`).toBeGreaterThanOrEqual(2)
    }
  })

  // ── Finance Events Contract ──

  describe('finance events', () => {
    it('finance.ar.created exists', () => {
      expect(EVENT_CATALOG['finance.ar.created']).toBeTruthy()
    })

    it('finance.ap.created exists', () => {
      expect(EVENT_CATALOG['finance.ap.created']).toBeTruthy()
    })

    it('finance.journal.posted exists', () => {
      expect(EVENT_CATALOG['finance.journal.posted']).toBeTruthy()
    })

    it('finance.voucher.auto_posted has required fields', () => {
      const schema = EVENT_CATALOG['finance.voucher.auto_posted']
      expect(schema).toBeTruthy()
      expect(schema.payload.entry_id.required).toBe(true)
      expect(schema.payload.doc_type.required).toBe(true)
      expect(schema.payload.source_type.required).toBe(true)
      expect(schema.payload.source_id.required).toBe(true)
    })

    it('finance.invoice lifecycle events exist (F-B3 vat ingestion)', () => {
      for (const type of ['finance.invoice.issued', 'finance.invoice.voided', 'finance.invoice.allowance']) {
        const schema = EVENT_CATALOG[type]
        expect(schema, `missing ${type}`).toBeTruthy()
        expect(schema.payload.payment_id.required).toBe(true)
      }
      expect(EVENT_CATALOG['finance.invoice.issued'].payload.invoice_number.required).toBe(true)
    })
  })

  // ── HR Events Contract ──

  describe('hr events', () => {
    it('hr.expense.approved has required fields', () => {
      const schema = EVENT_CATALOG['hr.expense.approved']
      expect(schema).toBeTruthy()
      expect(schema.payload.expense_id.required).toBe(true)
      expect(schema.payload.employee.required).toBe(true)
      expect(schema.payload.amount.required).toBe(true)
    })

    it('hr.salary.calculated has required fields', () => {
      const schema = EVENT_CATALOG['hr.salary.calculated']
      expect(schema).toBeTruthy()
      expect(schema.payload.employee_id.required).toBe(true)
      expect(schema.payload.net_salary.required).toBe(true)
    })
  })

  // ── Version Compatibility ──

  it('all events are version 1 (no breaking changes yet)', () => {
    for (const [type, schema] of Object.entries(EVENT_CATALOG)) {
      expect(schema.version, `${type} unexpected version`).toBe(1)
    }
  })

  // ── Serialization Safety ──

  it('catalog is JSON-serializable (no functions or circular refs)', () => {
    const json = JSON.stringify(EVENT_CATALOG)
    const parsed = JSON.parse(json)
    expect(Object.keys(parsed).length).toBe(Object.keys(EVENT_CATALOG).length)
  })
})
