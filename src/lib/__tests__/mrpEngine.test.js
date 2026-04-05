import { describe, it, expect } from 'vitest'
import {
  explodeBOM,
  calculateLeadTimeOffset,
  runMRP,
  generatePurchaseSuggestions,
  calculateCapacityRequirements,
} from '../mrpEngine.js'

// ─── Test Data ──────────────────────────────────────────────

// Simple BOM: Product A → (B×2, C×3)
const simpleBOMs = [
  { parent_code: 'A', component_code: 'B', component_name: 'Part B', qty_per: 2, lead_time_days: 5 },
  { parent_code: 'A', component_code: 'C', component_name: 'Part C', qty_per: 3, lead_time_days: 3 },
]

// Multi-level BOM: A → B×2 → D×4 (B is sub-assembly)
const multiLevelBOMs = [
  { parent_code: 'A', component_code: 'B', component_name: 'Sub-Assy B', qty_per: 2, lead_time_days: 5 },
  { parent_code: 'A', component_code: 'C', component_name: 'Part C', qty_per: 3, lead_time_days: 3 },
  { parent_code: 'B', component_code: 'D', component_name: 'Part D', qty_per: 4, lead_time_days: 7 },
  { parent_code: 'B', component_code: 'E', component_name: 'Part E', qty_per: 1, lead_time_days: 2 },
]

// ═════════════════════════════════════════════════════════════
//  explodeBOM
// ═════════════════════════════════════════════════════════════

describe('explodeBOM', () => {
  it('MFG-U01: single-level BOM explosion', () => {
    const result = explodeBOM('A', 10, simpleBOMs)
    expect(result).toHaveLength(2)

    const partB = result.find(r => r.component_code === 'B')
    expect(partB.required_qty).toBe(20) // 10 × 2
    expect(partB.level).toBe(1)
    expect(partB.parent).toBe('A')

    const partC = result.find(r => r.component_code === 'C')
    expect(partC.required_qty).toBe(30) // 10 × 3
  })

  it('MFG-U02: multi-level BOM explosion (recursive)', () => {
    const result = explodeBOM('A', 10, multiLevelBOMs)

    // Level 1: B×20, C×30
    const partB = result.find(r => r.component_code === 'B' && r.level === 1)
    expect(partB.required_qty).toBe(20)

    // Level 2: D×80 (20 × 4), E×20 (20 × 1)
    const partD = result.find(r => r.component_code === 'D')
    expect(partD.required_qty).toBe(80) // 10 × 2 × 4
    expect(partD.level).toBe(2)
    expect(partD.parent).toBe('B')

    const partE = result.find(r => r.component_code === 'E')
    expect(partE.required_qty).toBe(20) // 10 × 2 × 1
  })

  it('MFG-U09: phantom assembly — components flow through', () => {
    // If B is a sub-assembly, its children should still appear
    const result = explodeBOM('A', 5, multiLevelBOMs)
    const allCodes = result.map(r => r.component_code)
    expect(allCodes).toContain('D') // Through B
    expect(allCodes).toContain('E') // Through B
  })

  it('handles product with no BOM (leaf node)', () => {
    const result = explodeBOM('Z', 10, simpleBOMs)
    expect(result).toHaveLength(0)
  })

  it('qty_per defaults to 1 if not specified', () => {
    const boms = [
      { parent_code: 'X', component_code: 'Y', component_name: 'Part Y' },
    ]
    const result = explodeBOM('X', 5, boms)
    expect(result[0].required_qty).toBe(5)
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateLeadTimeOffset
// ═════════════════════════════════════════════════════════════

describe('calculateLeadTimeOffset', () => {
  it('MFG-U05: offsets due date by lead time', () => {
    const start = calculateLeadTimeOffset('2026-04-20', 5)
    expect(start).toBe('2026-04-15')
  })

  it('handles month boundary', () => {
    const start = calculateLeadTimeOffset('2026-05-03', 5)
    expect(start).toBe('2026-04-28')
  })

  it('zero lead time = same date', () => {
    const start = calculateLeadTimeOffset('2026-04-20', 0)
    expect(start).toBe('2026-04-20')
  })

  it('handles null lead time', () => {
    const start = calculateLeadTimeOffset('2026-04-20', null)
    expect(start).toBe('2026-04-20')
  })
})

// ═════════════════════════════════════════════════════════════
//  runMRP
// ═════════════════════════════════════════════════════════════

describe('runMRP', () => {
  const demandOrders = [
    { order_id: 'SO-001', product_code: 'A', qty: 10, due_date: '2026-05-01' },
  ]

  it('MFG-U03: net req = gross - on-hand', () => {
    const stock = {
      'A': { on_hand: 0, safety_stock: 0 },
      'B': { on_hand: 15, safety_stock: 0 },
      'C': { on_hand: 0, safety_stock: 0 },
    }
    const result = runMRP(demandOrders, simpleBOMs, stock, [])

    // A: need 10, have 0 → net 10
    const orderA = result.plannedOrders.find(o => o.product === 'A')
    expect(orderA.qty).toBe(10)

    // B: need 20, have 15 → net 5
    const orderB = result.plannedOrders.find(o => o.product === 'B')
    expect(orderB.qty).toBe(5)

    // C: need 30, have 0 → net 30
    const orderC = result.plannedOrders.find(o => o.product === 'C')
    expect(orderC.qty).toBe(30)
  })

  it('MFG-U04: net req includes safety stock', () => {
    const stock = {
      'A': { on_hand: 0, safety_stock: 0 },
      'B': { on_hand: 15, safety_stock: 10 },
      'C': { on_hand: 0, safety_stock: 5 },
    }
    const result = runMRP(demandOrders, simpleBOMs, stock, [])

    // B: need 20, have 15, SS=10 → net = 20+10-15 = 15
    const orderB = result.plannedOrders.find(o => o.product === 'B')
    expect(orderB.qty).toBe(15)

    // C: need 30, have 0, SS=5 → net = 30+5-0 = 35
    const orderC = result.plannedOrders.find(o => o.product === 'C')
    expect(orderC.qty).toBe(35)
  })

  it('MFG-U06: purchase suggestions generated for shortages', () => {
    const stock = { 'A': { on_hand: 0 }, 'B': { on_hand: 0 }, 'C': { on_hand: 0 } }
    const result = runMRP(demandOrders, simpleBOMs, stock, [])
    expect(result.shortages.length).toBeGreaterThan(0)
    expect(result.summary.shortage_count).toBeGreaterThan(0)
    for (const s of result.shortages) {
      expect(s.qty_short).toBeGreaterThan(0)
      expect(s.earliest_need).toBeTruthy()
    }
  })

  it('MFG-U07: zero demand = no suggestions', () => {
    const result = runMRP([], simpleBOMs, {}, [])
    expect(result.plannedOrders).toHaveLength(0)
    expect(result.shortages).toHaveLength(0)
  })

  it('considers open POs (on-order quantity)', () => {
    const stock = { 'A': { on_hand: 0 }, 'B': { on_hand: 0 }, 'C': { on_hand: 0 } }
    const openPOs = [
      { product_code: 'B', qty: 20, expected_date: '2026-04-25' },
    ]
    const result = runMRP(demandOrders, simpleBOMs, stock, openPOs)

    // B: need 20, have 0, on-order 20 → net = 0 (no planned order)
    const orderB = result.plannedOrders.find(o => o.product === 'B')
    expect(orderB).toBeUndefined()
  })

  it('planned orders include lead time offset', () => {
    const stock = { 'B': { on_hand: 0 }, 'C': { on_hand: 0 } }
    const result = runMRP(demandOrders, simpleBOMs, stock, [])

    const orderB = result.plannedOrders.find(o => o.product === 'B')
    if (orderB) {
      // B has 5-day lead time, due 2026-05-01 → start 2026-04-26
      expect(orderB.start_date).toBe('2026-04-26')
      expect(orderB.due_date).toBe('2026-05-01')
    }
  })

  it('handles multi-level BOM in MRP', () => {
    const demand = [{ order_id: 'SO-002', product_code: 'A', qty: 5, due_date: '2026-05-01' }]
    const stock = {}
    const result = runMRP(demand, multiLevelBOMs, stock, [])

    // Should include D and E from level 2
    const allProducts = result.plannedOrders.map(o => o.product)
    expect(allProducts).toContain('D')
    expect(allProducts).toContain('E')
  })
})

// ═════════════════════════════════════════════════════════════
//  generatePurchaseSuggestions
// ═════════════════════════════════════════════════════════════

describe('generatePurchaseSuggestions', () => {
  const shortages = [
    { product: 'B', qty_short: 20, earliest_need: '2026-05-01' },
    { product: 'C', qty_short: 30, earliest_need: '2026-05-01' },
  ]

  const suppliers = [
    { supplier_id: 'S1', supplier_name: 'Supplier A', product_code: 'B', unit_price: 100, moq: 10, lead_time_days: 5 },
    { supplier_id: 'S1', supplier_name: 'Supplier A', product_code: 'C', unit_price: 50, moq: 1, lead_time_days: 3 },
  ]

  it('groups by supplier', () => {
    const suggestions = generatePurchaseSuggestions(shortages, suppliers)
    expect(suggestions).toHaveLength(1) // Both from S1
    expect(suggestions[0].supplier_id).toBe('S1')
    expect(suggestions[0].items).toHaveLength(2)
  })

  it('respects MOQ (minimum order quantity)', () => {
    const shortagesSmall = [{ product: 'B', qty_short: 15, earliest_need: '2026-05-01' }]
    const suggestions = generatePurchaseSuggestions(shortagesSmall, suppliers)
    // MOQ=10, need 15 → round up to 20
    const itemB = suggestions[0].items.find(i => i.product_code === 'B')
    expect(itemB.qty).toBe(20)
  })

  it('calculates total amount per supplier', () => {
    const suggestions = generatePurchaseSuggestions(shortages, suppliers)
    const s1 = suggestions[0]
    // B: 20 × 100 = 2000, C: 30 × 50 = 1500, total = 3500
    expect(s1.total_amount).toBe(3500)
  })

  it('handles unknown supplier', () => {
    const suggestions = generatePurchaseSuggestions(
      [{ product: 'Z', qty_short: 10, earliest_need: '2026-05-01' }],
      []
    )
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].supplier_name).toBe('未指定供應商')
  })

  it('handles empty shortages', () => {
    const suggestions = generatePurchaseSuggestions([], suppliers)
    expect(suggestions).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateCapacityRequirements
// ═════════════════════════════════════════════════════════════

describe('calculateCapacityRequirements', () => {
  it('MFG-U08: calculates hours per work center', () => {
    const plannedOrders = [
      { product: 'B', qty: 20, start_date: '2026-04-20', due_date: '2026-05-01' },
      { product: 'C', qty: 30, start_date: '2026-04-22', due_date: '2026-05-01' },
    ]

    const workCenters = [
      {
        work_center_id: 'WC1',
        name: 'Assembly Line',
        available_hours_per_day: 8,
        products: [
          { product_code: 'B', hours_per_unit: 0.5 },
          { product_code: 'C', hours_per_unit: 0.3 },
        ],
      },
    ]

    const result = calculateCapacityRequirements(plannedOrders, workCenters)
    expect(result).toHaveLength(1)

    const wc1 = result[0]
    // B: 20 × 0.5 = 10h, C: 30 × 0.3 = 9h → total 19h
    expect(wc1.required_hours).toBe(19)
    expect(wc1.available_hours).toBeGreaterThan(0)
    expect(typeof wc1.utilization_pct).toBe('number')
    expect(typeof wc1.overloaded).toBe('boolean')
  })

  it('detects overloaded work center', () => {
    const plannedOrders = [
      { product: 'B', qty: 1000, start_date: '2026-04-30', due_date: '2026-05-01' },
    ]
    const workCenters = [
      {
        work_center_id: 'WC1',
        name: 'Assembly',
        available_hours_per_day: 8,
        products: [{ product_code: 'B', hours_per_unit: 2 }],
      },
    ]
    const result = calculateCapacityRequirements(plannedOrders, workCenters)
    expect(result[0].overloaded).toBe(true)
    expect(result[0].utilization_pct).toBeGreaterThan(100)
  })

  it('handles empty planned orders', () => {
    const workCenters = [
      { work_center_id: 'WC1', name: 'Line A', available_hours_per_day: 8, products: [] },
    ]
    const result = calculateCapacityRequirements([], workCenters)
    expect(result[0].required_hours).toBe(0)
  })

  it('handles empty work centers', () => {
    const result = calculateCapacityRequirements([{ product: 'A', qty: 10, start_date: '2026-04-20', due_date: '2026-05-01' }], [])
    expect(result).toHaveLength(0)
  })
})
