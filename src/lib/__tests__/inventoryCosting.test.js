import { describe, it, expect } from 'vitest'
import {
  calculateFIFO,
  calculateLIFO,
  calculateWeightedAverage,
  calculateMovingAverage,
  valuateInventory,
} from '../inventoryCosting.js'

// ─── Shared test data ───────────────────────────────────────
const transactions = [
  { type: 'IN', qty: 100, unit_cost: 10, date: '2026-01-01' },
  { type: 'IN', qty: 50, unit_cost: 12, date: '2026-01-15' },
  { type: 'OUT', qty: 60, unit_cost: 0, date: '2026-02-01' },
  { type: 'IN', qty: 80, unit_cost: 11, date: '2026-02-15' },
  { type: 'OUT', qty: 100, unit_cost: 0, date: '2026-03-01' },
]

// ═════════════════════════════════════════════════════════════
describe('calculateFIFO', () => {
  it('IC-01: uses oldest cost first', () => {
    const txns = [
      { type: 'IN', qty: 100, unit_cost: 10, date: '2026-01-01' },
      { type: 'IN', qty: 50, unit_cost: 15, date: '2026-01-15' },
      { type: 'OUT', qty: 80, unit_cost: 0, date: '2026-02-01' },
    ]
    const result = calculateFIFO(txns)
    // FIFO: first 80 from lot @10 → COGS = 800
    expect(result.cogs).toBe(800)
    expect(result.ending_qty).toBe(70) // 20 left @10 + 50 @15
  })

  it('IC-02: partial lot consumption', () => {
    const txns = [
      { type: 'IN', qty: 100, unit_cost: 10, date: '2026-01-01' },
      { type: 'OUT', qty: 60, unit_cost: 0, date: '2026-02-01' },
    ]
    const result = calculateFIFO(txns)
    expect(result.cogs).toBe(600) // 60 × 10
    expect(result.ending_qty).toBe(40)
    expect(result.layers).toHaveLength(1)
    expect(result.layers[0].qty).toBe(40)
    expect(result.layers[0].unit_cost).toBe(10)
  })

  it('handles full transaction set', () => {
    const result = calculateFIFO(transactions)
    expect(result.ending_qty).toBe(70) // 100+50+80-60-100
    expect(result.cogs).toBeGreaterThan(0)
    expect(result.ending_inventory_value).toBeGreaterThan(0)
  })

  it('handles empty transactions', () => {
    const result = calculateFIFO([])
    expect(result.cogs).toBe(0)
    expect(result.ending_qty).toBe(0)
  })

  it('handles over-issue gracefully', () => {
    const txns = [
      { type: 'IN', qty: 10, unit_cost: 5, date: '2026-01-01' },
      { type: 'OUT', qty: 20, unit_cost: 0, date: '2026-02-01' },
    ]
    const result = calculateFIFO(txns)
    expect(result.cogs).toBe(50) // Only 10 available at $5
    expect(result.ending_qty).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════
describe('calculateLIFO', () => {
  it('IC-03: uses newest cost first', () => {
    const txns = [
      { type: 'IN', qty: 100, unit_cost: 10, date: '2026-01-01' },
      { type: 'IN', qty: 50, unit_cost: 15, date: '2026-01-15' },
      { type: 'OUT', qty: 60, unit_cost: 0, date: '2026-02-01' },
    ]
    const result = calculateLIFO(txns)
    // LIFO: 50@15 + 10@10 → COGS = 750+100 = 850
    expect(result.cogs).toBe(850)
    expect(result.ending_qty).toBe(90) // 90 left @10
  })

  it('FIFO vs LIFO produce different COGS', () => {
    const fifo = calculateFIFO(transactions)
    const lifo = calculateLIFO(transactions)
    // With varying prices, FIFO and LIFO should differ
    expect(fifo.cogs).not.toBe(lifo.cogs)
    // But ending quantities must be the same
    expect(fifo.ending_qty).toBe(lifo.ending_qty)
  })
})

// ═════════════════════════════════════════════════════════════
describe('calculateWeightedAverage', () => {
  it('IC-04: calculates blended cost', () => {
    const txns = [
      { type: 'IN', qty: 100, unit_cost: 10, date: '2026-01-01' },
      { type: 'IN', qty: 100, unit_cost: 20, date: '2026-01-15' },
      { type: 'OUT', qty: 50, unit_cost: 0, date: '2026-02-01' },
    ]
    const result = calculateWeightedAverage(txns)
    // Avg cost = (100*10 + 100*20) / 200 = 15
    // COGS = 50 * 15 = 750
    expect(result.cogs).toBe(750)
    expect(result.ending_qty).toBe(150)
    expect(result.avg_unit_cost).toBe(15)
  })

  it('handles single receipt', () => {
    const txns = [
      { type: 'IN', qty: 100, unit_cost: 10, date: '2026-01-01' },
    ]
    const result = calculateWeightedAverage(txns)
    expect(result.avg_unit_cost).toBe(10)
    expect(result.ending_qty).toBe(100)
  })

  it('handles empty transactions', () => {
    const result = calculateWeightedAverage([])
    expect(result.cogs).toBe(0)
    expect(result.ending_qty).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════
describe('calculateMovingAverage', () => {
  it('IC-05: updates average after each receipt', () => {
    const txns = [
      { type: 'IN', qty: 100, unit_cost: 10, date: '2026-01-01' },
      { type: 'IN', qty: 100, unit_cost: 20, date: '2026-01-15' },
    ]
    const result = calculateMovingAverage(txns)
    expect(result.history).toHaveLength(2)
    expect(result.history[0].avg_cost).toBe(10)  // After 1st receipt
    expect(result.history[1].avg_cost).toBe(15)  // After 2nd: (1000+2000)/200
  })

  it('records history for every transaction', () => {
    const result = calculateMovingAverage(transactions)
    expect(result.history).toHaveLength(transactions.length)
  })
})

// ═════════════════════════════════════════════════════════════
describe('valuateInventory', () => {
  it('IC-06: valuates using specified method', () => {
    const stockLevels = [{ sku: 'SKU-A', qty: 50 }]
    const txns = {
      'SKU-A': [
        { type: 'IN', qty: 100, unit_cost: 10, date: '2026-01-01' },
        { type: 'OUT', qty: 50, unit_cost: 0, date: '2026-02-01' },
      ],
    }
    const result = valuateInventory(stockLevels, 'FIFO', txns)
    expect(result).toHaveLength(1)
    expect(result[0].sku).toBe('SKU-A')
    expect(result[0].unit_cost).toBe(10)
    expect(result[0].total_value).toBe(500)
    expect(result[0].method).toBe('FIFO')
  })

  it('handles SKU with no transactions', () => {
    const result = valuateInventory([{ sku: 'NEW', qty: 10 }], 'FIFO', {})
    expect(result[0].unit_cost).toBe(0)
    expect(result[0].total_value).toBe(0)
  })

  it('defaults to WEIGHTED_AVG for unknown method', () => {
    const result = valuateInventory([{ sku: 'A', qty: 10 }], 'UNKNOWN', {
      'A': [{ type: 'IN', qty: 10, unit_cost: 5, date: '2026-01-01' }],
    })
    expect(result[0].unit_cost).toBe(5)
  })
})
