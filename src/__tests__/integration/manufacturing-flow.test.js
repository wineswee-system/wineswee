/**
 * Integration Test: Manufacturing Flow
 * BOM → MRP → Purchase Suggestions → Inventory Costing
 *
 * Tests cross-module logic: mrpEngine + inventoryCosting + accounting
 */
import { describe, it, expect } from 'vitest'
import { explodeBOM, runMRP, generatePurchaseSuggestions, calculateCapacityRequirements } from '../../lib/mrpEngine.js'
import { calculateFIFO, calculateWeightedAverage, valuateInventory } from '../../lib/inventoryCosting.js'
import { validateJournalEntry } from '../../lib/accounting.js'

describe('Manufacturing Flow Integration', () => {
  // Product FP-001 → (RM-A ×3, SA-001 ×2)
  // SA-001 → (RM-B ×4, RM-C ×1)
  const boms = [
    { parent_code: 'FP-001', component_code: 'RM-A', component_name: '原料 A', qty_per: 3, lead_time_days: 5 },
    { parent_code: 'FP-001', component_code: 'SA-001', component_name: '半成品 001', qty_per: 2, lead_time_days: 3 },
    { parent_code: 'SA-001', component_code: 'RM-B', component_name: '原料 B', qty_per: 4, lead_time_days: 7 },
    { parent_code: 'SA-001', component_code: 'RM-C', component_name: '原料 C', qty_per: 1, lead_time_days: 2 },
  ]

  it('INT-11: BOM explosion feeds MRP correctly', () => {
    const components = explodeBOM('FP-001', 10, boms)

    const rmA = components.find(c => c.component_code === 'RM-A')
    expect(rmA.required_qty).toBe(30) // 10 × 3

    const sa001 = components.find(c => c.component_code === 'SA-001')
    expect(sa001.required_qty).toBe(20) // 10 × 2

    // Level 2: through SA-001
    const rmB = components.find(c => c.component_code === 'RM-B')
    expect(rmB.required_qty).toBe(80) // 10 × 2 × 4
    expect(rmB.level).toBe(2)

    const rmC = components.find(c => c.component_code === 'RM-C')
    expect(rmC.required_qty).toBe(20) // 10 × 2 × 1
  })

  it('INT-12: MRP generates purchase suggestions', () => {
    const demand = [{ order_id: 'MO-001', product_code: 'FP-001', qty: 10, due_date: '2026-05-01' }]
    const stock = {
      'FP-001': { on_hand: 0, safety_stock: 0 },
      'RM-A': { on_hand: 10, safety_stock: 5 },
      'SA-001': { on_hand: 0, safety_stock: 0 },
      'RM-B': { on_hand: 50, safety_stock: 10 },
      'RM-C': { on_hand: 0, safety_stock: 0 },
    }

    const mrp = runMRP(demand, boms, stock, [])
    expect(mrp.shortages.length).toBeGreaterThan(0)

    const suppliers = [
      { supplier_id: 'S1', supplier_name: 'Raw Material Co', product_code: 'RM-A', unit_price: 50, moq: 10 },
      { supplier_id: 'S1', supplier_name: 'Raw Material Co', product_code: 'RM-B', unit_price: 30, moq: 20 },
      { supplier_id: 'S2', supplier_name: 'Parts Inc', product_code: 'RM-C', unit_price: 100, moq: 5 },
    ]

    const suggestions = generatePurchaseSuggestions(mrp.shortages, suppliers)
    expect(suggestions.length).toBeGreaterThan(0)

    // All suggestions should have positive quantities
    for (const s of suggestions) {
      for (const item of s.items) {
        expect(item.qty).toBeGreaterThan(0)
        expect(item.need_date).toBeTruthy()
      }
    }
  })

  it('INT-13: production consumes inventory (FIFO costing)', () => {
    // Raw materials consumed during manufacturing
    const rmATransactions = [
      { type: 'IN', qty: 50, unit_cost: 45, date: '2026-01-01' },
      { type: 'IN', qty: 30, unit_cost: 50, date: '2026-02-01' },
      { type: 'OUT', qty: 30, unit_cost: 0, date: '2026-03-01' }, // Consumed for MO
    ]
    const result = calculateFIFO(rmATransactions)
    expect(result.cogs).toBe(1350) // 30 × 45 (FIFO: oldest first)
    expect(result.ending_qty).toBe(50) // 80 - 30
  })

  it('INT-14: finished goods receipt increases stock value', () => {
    // Finished goods produced: 10 units at cost from BOM
    const fgTransactions = [
      { type: 'IN', qty: 10, unit_cost: 500, date: '2026-04-01' }, // Cost per FG from BOM rollup
    ]
    const result = calculateWeightedAverage(fgTransactions)
    expect(result.ending_qty).toBe(10)
    expect(result.ending_inventory_value).toBe(5000)
    expect(result.avg_unit_cost).toBe(500)
  })

  it('INT-15: cost rollup creates balanced JE', () => {
    const productionCost = 5000 // Total cost of 10 FG units
    const jeLines = [
      { account_code: '1150', account_name: '成品存貨', debit: productionCost, credit: 0 },
      { account_code: '1150', account_name: '在製品', debit: 0, credit: productionCost },
    ]
    const validation = validateJournalEntry(jeLines)
    expect(validation.valid).toBe(true)
  })

  it('INT-CRP: capacity requirements calculated from planned orders', () => {
    const demand = [{ order_id: 'MO-001', product_code: 'FP-001', qty: 100, due_date: '2026-05-01' }]
    const mrp = runMRP(demand, boms, {}, [])

    const workCenters = [
      {
        work_center_id: 'WC-ASM',
        name: '組裝線',
        available_hours_per_day: 8,
        products: [
          { product_code: 'FP-001', hours_per_unit: 0.5 },
          { product_code: 'SA-001', hours_per_unit: 0.3 },
        ],
      },
    ]

    const crp = calculateCapacityRequirements(mrp.plannedOrders, workCenters)
    expect(crp).toHaveLength(1)
    expect(crp[0].required_hours).toBeGreaterThan(0)
    expect(typeof crp[0].overloaded).toBe('boolean')
    expect(crp[0].utilization_pct).toBeGreaterThan(0)
  })
})
