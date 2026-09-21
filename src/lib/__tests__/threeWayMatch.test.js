import { describe, it, expect } from 'vitest'
import {
  MATCH_TOLERANCES,
  calculatePriceVariance,
  performThreeWayMatch,
} from '../threeWayMatch.js'

// ─── Shared test data ───────────────────────────────────────
const makePO = (items, total) => ({ poNumber: 'PO-001', items, total })
const makeGR = (items) => ({ grNumber: 'GR-001', items, receivedDate: '2026-04-01' })
const makeINV = (items, total) => ({ invoiceNumber: 'INV-001', items, total })

const item = (code, qty, price) => ({ itemCode: code, qty, unitPrice: price })
const grItem = (code, qty) => ({ itemCode: code, receivedQty: qty })
const invItem = (code, qty, price) => ({ itemCode: code, qty, unitPrice: price })

// ═════════════════════════════════════════════════════════════
describe('MATCH_TOLERANCES', () => {
  it('has qty, price, and total tolerances', () => {
    expect(MATCH_TOLERANCES.qty).toBeDefined()
    expect(MATCH_TOLERANCES.price).toBeDefined()
    expect(MATCH_TOLERANCES.total).toBeDefined()
  })
})

// ═════════════════════════════════════════════════════════════
describe('calculatePriceVariance', () => {
  it('TW-06: calculates variance percentage', () => {
    const result = calculatePriceVariance(100, 105)
    expect(result.variance).toBe(5)
    expect(result.percentage).toBe(0.05)
    expect(result.favorable).toBe(false)
  })

  it('favorable when invoice < PO', () => {
    const result = calculatePriceVariance(100, 95)
    expect(result.variance).toBe(-5)
    expect(result.favorable).toBe(true)
  })

  it('zero variance', () => {
    const result = calculatePriceVariance(100, 100)
    expect(result.variance).toBe(0)
    expect(result.percentage).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════
describe('performThreeWayMatch', () => {
  it('TW-01: perfect match → matched + autoApprove', () => {
    const po = makePO([item('A', 100, 10)], 1000)
    const gr = makeGR([grItem('A', 100)])
    const inv = makeINV([invItem('A', 100, 10)], 1000)

    const result = performThreeWayMatch(po, gr, inv)
    expect(result.matched).toBe(true)
    expect(result.autoApprove).toBe(true)
    expect(result.discrepancies).toHaveLength(0)
  })

  it('TW-02: within tolerance → matched', () => {
    // 1% price variance, tolerance is 1%
    const po = makePO([item('A', 100, 100)], 10000)
    const gr = makeGR([grItem('A', 100)])
    const inv = makeINV([invItem('A', 100, 101)], 10100)

    const result = performThreeWayMatch(po, gr, inv)
    expect(result.matched).toBe(true)
  })

  it('TW-03: exceeds tolerance → flagged', () => {
    // 10% price variance, default tolerance is 1%
    const po = makePO([item('A', 100, 100)], 10000)
    const gr = makeGR([grItem('A', 100)])
    const inv = makeINV([invItem('A', 100, 110)], 11000)

    const result = performThreeWayMatch(po, gr, inv)
    expect(result.matched).toBe(false)
    expect(result.discrepancies.length).toBeGreaterThan(0)
    expect(result.autoApprove).toBe(false)
  })

  it('TW-04: quantity mismatch', () => {
    const po = makePO([item('A', 100, 10)], 1000)
    const gr = makeGR([grItem('A', 90)]) // 10% short
    const inv = makeINV([invItem('A', 100, 10)], 1000)

    const result = performThreeWayMatch(po, gr, inv)
    expect(result.matched).toBe(false)
    expect(result.discrepancies.some(d => d.field.startsWith('qty_'))).toBe(true)
  })

  it('TW-05: missing item in one document', () => {
    const po = makePO([item('A', 100, 10), item('B', 50, 20)], 2000)
    const gr = makeGR([grItem('A', 100)]) // Missing B
    const inv = makeINV([invItem('A', 100, 10), invItem('B', 50, 20)], 2000)

    const result = performThreeWayMatch(po, gr, inv)
    expect(result.matched).toBe(false)
    expect(result.discrepancies.some(d => d.variance === 'missing_item')).toBe(true)
  })

  it('total amount variance check', () => {
    const po = makePO([item('A', 100, 10)], 1000)
    const gr = makeGR([grItem('A', 100)])
    const inv = makeINV([invItem('A', 100, 10)], 1100) // 10% total variance

    const result = performThreeWayMatch(po, gr, inv)
    expect(result.matched).toBe(false)
    expect(result.discrepancies.some(d => d.field === 'total')).toBe(true)
  })

  it('custom tolerances override defaults', () => {
    const po = makePO([item('A', 100, 100)], 10000)
    const gr = makeGR([grItem('A', 100)])
    const inv = makeINV([invItem('A', 100, 110)], 11000)

    // With 15% tolerance, this should pass
    const result = performThreeWayMatch(po, gr, inv, { qty: 0.05, price: 0.15, total: 0.15 })
    expect(result.matched).toBe(true)
  })

  it('multiple items all match', () => {
    const po = makePO([item('A', 100, 10), item('B', 50, 20)], 2000)
    const gr = makeGR([grItem('A', 100), grItem('B', 50)])
    const inv = makeINV([invItem('A', 100, 10), invItem('B', 50, 20)], 2000)

    const result = performThreeWayMatch(po, gr, inv)
    expect(result.matched).toBe(true)
    expect(result.autoApprove).toBe(true)
  })
})
