/**
 * Warehouse Engine — comprehensive test suite
 *
 * Covers: Stock Reservation, Lots/FEFO, Serial Tracking, Bins, Reorder Points,
 * Cycle Counting (ABC), Adjustments, Min/Max Levels, EOQ, Auto-Reorder POs,
 * Turnover, Dead Stock, Kit Availability, UoM Conversions
 */
import {
  getAvailableStock,
  reserveStock,
  releaseReservation,
  validateStockAvailability,
  createLot,
  getLotsByExpiry,
  traceLotUsage,
  FEFO,
  registerSerial,
  lookupSerial,
  transferSerial,
  createBinLocation,
  assignItemToBin,
  findItemLocations,
  suggestPutaway,
  checkReorderPoints,
  calculateReorderQty,
  generateReorderReport,
  abcClassification,
  generateCycleCountPlan,
  processCycleCount,
  createAdjustment,
  createInventoryAdjustment,
  setMinMaxLevels,
  evaluateStockLevels,
  calculateEOQ,
  generateAutoReorderPOs,
  calculateInventoryTurnover,
  identifyDeadStock,
  calculateKitAvailability,
  convertUoM,
  getBaseQty,
  ZONE_TYPES,
  ADJUSTMENT_REASONS,
} from '../warehouseEngine'

// ════════════════════════════════════════
// 1. Stock Reservation
// ════════════════════════════════════════

describe('WMS-01: Stock Reservation', () => {
  const stocks = [{ sku: 'A', warehouseId: 'W1', on_hand: 100 }]
  const reservations = [{ sku: 'A', warehouseId: 'W1', qty: 30, status: 'active' }]

  test('getAvailableStock = on_hand - reserved', () => {
    expect(getAvailableStock('A', 'W1', stocks, reservations)).toBe(70)
  })

  test('getAvailableStock returns 0 for unknown SKU', () => {
    expect(getAvailableStock('Z', 'W1', stocks, reservations)).toBe(0)
  })

  test('ignores non-active reservations', () => {
    const rels = [{ sku: 'A', warehouseId: 'W1', qty: 30, status: 'released' }]
    expect(getAvailableStock('A', 'W1', stocks, rels)).toBe(100)
  })

  test('reserveStock success', () => {
    const result = reserveStock('A', 50, 'SO-1', 'W1', stocks, reservations)
    expect(result.success).toBe(true)
    expect(result.reservation.qty).toBe(50)
    expect(result.reservation.id).toMatch(/^RSV-/)
    expect(result.reservation.status).toBe('active')
  })

  test('reserveStock fails when insufficient', () => {
    const result = reserveStock('A', 80, 'SO-1', 'W1', stocks, reservations)
    expect(result.success).toBe(false)
    expect(result.error).toContain('庫存不足')
  })

  test('releaseReservation success', () => {
    const rels = [{ id: 'R1', status: 'active', sku: 'A', qty: 10 }]
    const result = releaseReservation('R1', rels)
    expect(result.success).toBe(true)
    expect(result.reservation.status).toBe('released')
  })

  test('releaseReservation fails for non-existent ID', () => {
    expect(releaseReservation('NOPE', []).success).toBe(false)
  })

  test('releaseReservation fails if already released', () => {
    const rels = [{ id: 'R1', status: 'released' }]
    expect(releaseReservation('R1', rels).success).toBe(false)
  })

  test('validateStockAvailability — each line checked independently', () => {
    const lines = [
      { sku: 'A', qty: 50, warehouseId: 'W1' },
      { sku: 'A', qty: 30, warehouseId: 'W1' },
    ]
    const result = validateStockAvailability(lines, stocks, reservations)
    // Each line checks available=70 independently: 50<=70 OK, 30<=70 OK
    expect(result.allAvailable).toBe(true)
    expect(result.lines[0].sufficient).toBe(true)
    expect(result.lines[1].sufficient).toBe(true)
  })

  test('validateStockAvailability — insufficient single line', () => {
    const lines = [{ sku: 'A', qty: 80, warehouseId: 'W1' }]
    const result = validateStockAvailability(lines, stocks, reservations)
    expect(result.allAvailable).toBe(false)
    expect(result.lines[0].sufficient).toBe(false)
  })
})

// ════════════════════════════════════════
// 2. Lot/Batch Tracking
// ════════════════════════════════════════

describe('WMS-02: Lot/Batch Tracking', () => {
  test('createLot returns full record', () => {
    const lot = createLot('A', 'LOT001', 100, '2025-12-31', 'SLOT01', 'COA-01')
    expect(lot.sku).toBe('A')
    expect(lot.lotNumber).toBe('LOT001')
    expect(lot.qty).toBe(100)
    expect(lot.remainingQty).toBe(100)
    expect(lot.supplierLot).toBe('SLOT01')
    expect(lot.status).toBe('active')
  })

  test('getLotsByExpiry sorts and marks expired/expiringSoon', () => {
    const lots = [
      { lotNumber: 'L1', expiryDate: '2025-06-01' },
      { lotNumber: 'L2', expiryDate: '2025-04-10' },
      { lotNumber: 'L3', expiryDate: '2025-03-01' },
    ]
    const result = getLotsByExpiry(lots, '2025-04-01')
    expect(result[0].lotNumber).toBe('L3') // earliest first
    expect(result[0].expired).toBe(true) // March < April
    expect(result[1].expiringSoon).toBe(true) // April 10 within 30 days
    expect(result[2].expired).toBe(false)
    expect(result[2].expiringSoon).toBe(false) // June 1 > 30 days
  })

  test('traceLotUsage filters and sorts by date', () => {
    const txns = [
      { lotNumber: 'L1', date: '2025-03-01', type: 'IN' },
      { lotNumber: 'L2', date: '2025-03-02', type: 'OUT' },
      { lotNumber: 'L1', date: '2025-02-01', type: 'OUT' },
    ]
    const result = traceLotUsage('L1', txns)
    expect(result.usage).toHaveLength(2)
    expect(result.usage[0].date).toBe('2025-02-01') // sorted
  })
})

// ════════════════════════════════════════
// 3. FEFO
// ════════════════════════════════════════

describe('WMS-03: FEFO Consumption', () => {
  const lots = [
    { lotNumber: 'L3', remainingQty: 20, expiryDate: '2025-09-01' },
    { lotNumber: 'L1', remainingQty: 50, expiryDate: '2025-06-01' },
    { lotNumber: 'L2', remainingQty: 30, expiryDate: '2025-07-01' },
  ]

  test('consumes from nearest-expiry first', () => {
    const result = FEFO(lots, 60)
    expect(result.success).toBe(true)
    expect(result.consumed[0].lotNumber).toBe('L1') // June first
    expect(result.consumed[0].qty).toBe(50)
    expect(result.consumed[1].lotNumber).toBe('L2') // then July
    expect(result.consumed[1].qty).toBe(10)
  })

  test('returns shortfall when insufficient', () => {
    const result = FEFO(lots, 200)
    expect(result.success).toBe(false)
    expect(result.shortfall).toBe(100) // 200 - (50+30+20)
  })

  test('skips zero-remaining lots', () => {
    const lotsWithZero = [
      { lotNumber: 'L0', remainingQty: 0, expiryDate: '2025-01-01' },
      { lotNumber: 'L1', remainingQty: 10, expiryDate: '2025-06-01' },
    ]
    const result = FEFO(lotsWithZero, 5)
    expect(result.consumed).toHaveLength(1)
    expect(result.consumed[0].lotNumber).toBe('L1')
  })

  test('handles exact match', () => {
    const result = FEFO(lots, 100) // 50+30+20 = 100
    expect(result.success).toBe(true)
    expect(result.shortfall).toBe(0)
  })
})

// ════════════════════════════════════════
// 4. Serial Number Tracking
// ════════════════════════════════════════

describe('WMS-04: Serial Number Tracking', () => {
  test('registerSerial returns initial record with history', () => {
    const sn = registerSerial('A', 'SN001', 'LOT001', '2026-12-31')
    expect(sn.serialNumber).toBe('SN001')
    expect(sn.lotNumber).toBe('LOT001')
    expect(sn.history).toHaveLength(1)
    expect(sn.history[0].action).toBe('registered')
  })

  test('lookupSerial finds match', () => {
    const serials = [
      registerSerial('A', 'SN001'),
      registerSerial('B', 'SN002'),
    ]
    expect(lookupSerial('SN002', serials).sku).toBe('B')
    expect(lookupSerial('SN999', serials)).toBeNull()
  })

  test('transferSerial appends history entry', () => {
    const serial = registerSerial('A', 'SN001')
    const updated = transferSerial(serial, 'BIN-A', 'BIN-B', '備貨')
    expect(updated.currentLocation).toBe('BIN-B')
    expect(updated.history).toHaveLength(2)
    expect(updated.history[1].action).toBe('transfer')
    expect(updated.history[1].fromLocation).toBe('BIN-A')
  })
})

// ════════════════════════════════════════
// 5. Bin Locations
// ════════════════════════════════════════

describe('WMS-05: Bin Locations', () => {
  test('createBinLocation generates code', () => {
    const bin = createBinLocation('WH01', 'storage', '01', '03', 'B', '5')
    expect(bin.locationCode).toBe('WH01-01-03-B-5')
    expect(bin.zone).toBe('storage')
    expect(bin.status).toBe('active')
  })

  test('createBinLocation rejects invalid zone', () => {
    expect(() => createBinLocation('WH01', 'invalid_zone', '01', '01', 'A', '1')).toThrow('無效的區域類型')
  })

  test('assignItemToBin returns record', () => {
    const rec = assignItemToBin('A', 'WH01-01-03-B-5', 50)
    expect(rec.sku).toBe('A')
    expect(rec.qty).toBe(50)
  })

  test('findItemLocations filters by SKU with qty > 0', () => {
    const inv = [
      { sku: 'A', binLocation: 'B1', qty: 10 },
      { sku: 'A', binLocation: 'B2', qty: 0 },
      { sku: 'B', binLocation: 'B3', qty: 5 },
    ]
    const result = findItemLocations('A', inv)
    expect(result).toHaveLength(1)
    expect(result[0].binLocation).toBe('B1')
  })

  test('suggestPutaway prioritizes same-SKU bins', () => {
    const bins = [
      { locationCode: 'B1', zone: 'storage', currentQty: 5, skus: ['A'], capacity: 100 },
      { locationCode: 'B2', zone: 'storage', currentQty: 0, skus: [], capacity: 100 },
    ]
    const result = suggestPutaway('A', bins, { sameSku: true })
    expect(result[0].locationCode).toBe('B1')
  })

  test('suggestPutaway filters by zone preference', () => {
    const bins = [
      { locationCode: 'B1', zone: 'picking', currentQty: 0, capacity: 50 },
      { locationCode: 'B2', zone: 'storage', currentQty: 0, capacity: 50 },
    ]
    const result = suggestPutaway('A', bins, { zone: 'storage' })
    expect(result).toHaveLength(1)
    expect(result[0].zone).toBe('storage')
  })

  test('suggestPutaway respects maxItemsPerBin', () => {
    const bins = [
      { locationCode: 'B1', zone: 'storage', currentItems: 3, currentQty: 10, capacity: 50 },
      { locationCode: 'B2', zone: 'storage', currentItems: 1, currentQty: 5, capacity: 50 },
    ]
    const result = suggestPutaway('A', bins, { maxItemsPerBin: 2 })
    expect(result).toHaveLength(1)
    expect(result[0].locationCode).toBe('B2')
  })
})

// ════════════════════════════════════════
// 6. Reorder Points
// ════════════════════════════════════════

describe('WMS-06: Reorder Point Alerts', () => {
  test('checkReorderPoints triggers alert below reorder point', () => {
    const stocks = [{ sku: 'A', on_hand: 5 }]
    const settings = [{ sku: 'A', reorderPoint: 10, minQty: 3, reorderQty: 50, supplier: 'S1' }]
    const alerts = checkReorderPoints(stocks, settings)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].urgency).toBe('warning') // 5 > minQty 3
  })

  test('critical urgency when below minQty', () => {
    const stocks = [{ sku: 'A', on_hand: 2 }]
    const settings = [{ sku: 'A', reorderPoint: 10, minQty: 3, reorderQty: 50 }]
    const alerts = checkReorderPoints(stocks, settings)
    expect(alerts[0].urgency).toBe('critical')
  })

  test('no alert when above reorder point', () => {
    const stocks = [{ sku: 'A', on_hand: 20 }]
    const settings = [{ sku: 'A', reorderPoint: 10, minQty: 3, reorderQty: 50 }]
    expect(checkReorderPoints(stocks, settings)).toHaveLength(0)
  })

  test('calculateReorderQty returns qty when below reorder point', () => {
    // effectiveStock = 5 + 0 = 5 <= reorderPoint 10 → maxStock - effectiveStock = 95
    expect(calculateReorderQty(5, 10, 100, 0)).toBe(95)
    // effectiveStock = 3 + 2 = 5 <= 10 → 100 - 5 = 95
    expect(calculateReorderQty(3, 10, 100, 2)).toBe(95)
  })

  test('calculateReorderQty returns 0 when above reorder point', () => {
    // effectiveStock = 5 + 20 = 25 > 10 → 0
    expect(calculateReorderQty(5, 10, 100, 20)).toBe(0)
    expect(calculateReorderQty(50, 10, 100, 0)).toBe(0)
  })

  test('generateReorderReport groups by supplier', () => {
    const alerts = [
      { sku: 'A', urgency: 'critical', supplier: 'S1', currentStock: 2, reorderPoint: 10, reorderQty: 50 },
      { sku: 'B', urgency: 'warning', supplier: 'S1', currentStock: 8, reorderPoint: 10, reorderQty: 30 },
      { sku: 'C', urgency: 'warning', supplier: null, currentStock: 5, reorderPoint: 10, reorderQty: 40 },
    ]
    const report = generateReorderReport(alerts)
    expect(report.totalAlerts).toBe(3)
    expect(report.critical).toBe(1)
    expect(report.bySupplier['S1']).toHaveLength(2)
    expect(report.bySupplier['未指定供應商']).toHaveLength(1)
    expect(report.items[0].urgency).toBe('critical') // critical first
  })
})

// ════════════════════════════════════════
// 7. ABC Classification & Cycle Counting
// ════════════════════════════════════════

describe('WMS-07: ABC & Cycle Counting', () => {
  const skus = [
    { sku: 'X', annualValue: 80000 },
    { sku: 'Y', annualValue: 15000 },
    { sku: 'Z', annualValue: 5000 },
  ]

  test('abcClassification assigns A/B/C correctly', () => {
    const result = abcClassification(skus)
    expect(result[0].sku).toBe('X') // highest value first
    expect(result[0].abcClass).toBe('A')
    expect(result[1].abcClass).toBe('B')
    expect(result[2].abcClass).toBe('C')
  })

  test('abcClassification handles empty input', () => {
    expect(abcClassification([])).toEqual([])
  })

  test('abcClassification — all zero value assigns C', () => {
    const zeros = [{ sku: 'A', annualValue: 0 }, { sku: 'B', annualValue: 0 }]
    const result = abcClassification(zeros)
    expect(result.every(s => s.abcClass === 'C')).toBe(true)
  })

  test('generateCycleCountPlan — abc method', () => {
    const classified = abcClassification(skus)
    const plan = generateCycleCountPlan(classified, 'abc', { currentMonth: '1' })
    // In January: A (monthly) + B (quarterly, month 1) + C (yearly, month 1)
    expect(plan.length).toBe(3)
  })

  test('generateCycleCountPlan — abc method filters B in non-quarter month', () => {
    const classified = abcClassification(skus)
    const plan = generateCycleCountPlan(classified, 'abc', { currentMonth: '2' })
    // In Feb: A only (B only in 1,4,7,10)
    expect(plan.length).toBe(1)
    expect(plan[0].abcClass).toBe('A')
  })

  test('generateCycleCountPlan — random method', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ sku: `S${i}`, annualValue: i }))
    const plan = generateCycleCountPlan(items, 'random', { randomPct: 10 })
    expect(plan.length).toBe(10) // 10%
    expect(plan[0].frequency).toBe('隨機')
  })

  test('processCycleCount calculates variance', () => {
    const entries = [
      { sku: 'A', countedQty: 98, countedBy: 'John', countedAt: '2025-04-01' },
      { sku: 'B', countedQty: 50, countedBy: 'John', countedAt: '2025-04-01' },
    ]
    const system = [{ sku: 'A', on_hand: 100 }, { sku: 'B', on_hand: 50 }]
    const result = processCycleCount(entries, system)
    expect(result[0].variance).toBe(-2)
    expect(result[0].hasVariance).toBe(true)
    expect(result[1].variance).toBe(0)
    expect(result[1].hasVariance).toBe(false)
  })
})

// ════════════════════════════════════════
// 8. Adjustments
// ════════════════════════════════════════

describe('WMS-08: Inventory Adjustments', () => {
  test('createAdjustment with approval-required reason', () => {
    const adj = createAdjustment('A', 100, 95, 'DAMAGE', 'John')
    expect(adj.adjustmentQty).toBe(-5)
    expect(adj.requiresApproval).toBe(true)
    expect(adj.status).toBe('pending_approval')
  })

  test('createAdjustment without approval', () => {
    const adj = createAdjustment('A', 100, 102, 'COUNT_VARIANCE', 'John')
    expect(adj.adjustmentQty).toBe(2)
    expect(adj.requiresApproval).toBe(false)
    expect(adj.status).toBe('approved')
  })

  test('createInventoryAdjustment validates reason code', () => {
    const invalid = createInventoryAdjustment('A', -5, 'INVALID', '', 'John')
    expect(invalid.success).toBe(false)
    expect(invalid.error).toContain('無效')
  })

  test('createInventoryAdjustment success', () => {
    const result = createInventoryAdjustment('A', -5, 'EXPIRY', 'batch expired', 'John')
    expect(result.success).toBe(true)
    expect(result.requiresApproval).toBe(false) // EXPIRY doesn't require approval
  })
})

// ════════════════════════════════════════
// 9. Min/Max Stock Levels
// ════════════════════════════════════════

describe('WMS-09: Min/Max & EOQ', () => {
  test('setMinMaxLevels validates min <= max', () => {
    expect(() => setMinMaxLevels('A', 100, 50, 75, 30)).toThrow('不得大於')
  })

  test('setMinMaxLevels validates reorder point in range', () => {
    expect(() => setMinMaxLevels('A', 10, 100, 5, 30)).toThrow('須介於')
  })

  test('setMinMaxLevels returns settings', () => {
    const s = setMinMaxLevels('A', 10, 100, 50, 30)
    expect(s.sku).toBe('A')
    expect(s.minQty).toBe(10)
  })

  test('evaluateStockLevels classifies correctly', () => {
    const stocks = [{ sku: 'A', on_hand: 5 }, { sku: 'B', on_hand: 50 }, { sku: 'C', on_hand: 200 }]
    const settings = [
      { sku: 'A', minQty: 10, maxQty: 100 },
      { sku: 'B', minQty: 10, maxQty: 100 },
      { sku: 'C', minQty: 10, maxQty: 100 },
    ]
    const result = evaluateStockLevels(stocks, settings)
    expect(result.find(r => r.sku === 'A').status).toBe('understocked')
    expect(result.find(r => r.sku === 'B').status).toBe('normal')
    expect(result.find(r => r.sku === 'C').status).toBe('overstocked')
  })

  test('calculateEOQ formula', () => {
    // EOQ = sqrt(2 * 1000 * 50 / 2) = sqrt(50000) ≈ 223.61
    expect(calculateEOQ(1000, 50, 2)).toBeCloseTo(223.61, 1)
  })

  test('calculateEOQ returns 0 for zero inputs', () => {
    expect(calculateEOQ(0, 50, 2)).toBe(0)
    expect(calculateEOQ(1000, 50, 0)).toBe(0)
  })
})

// ════════════════════════════════════════
// 10. Auto-Reorder POs
// ════════════════════════════════════════

describe('WMS-10: Auto-Reorder PO Generation', () => {
  test('generates POs grouped by supplier', () => {
    const alerts = [
      { sku: 'A', currentStock: 5, reorderPoint: 10, reorderQty: 50, urgency: 'critical' },
      { sku: 'B', currentStock: 8, reorderPoint: 10, reorderQty: 30, urgency: 'warning' },
    ]
    const mappings = [
      { sku: 'A', supplier: 'S1', isPreferred: true, unitCost: 100, leadTimeDays: 7 },
      { sku: 'B', supplier: 'S1', isPreferred: true, unitCost: 50, leadTimeDays: 5 },
    ]
    const { purchaseOrders, skippedItems } = generateAutoReorderPOs(alerts, mappings)
    expect(purchaseOrders).toHaveLength(1) // both grouped under S1
    expect(purchaseOrders[0].items).toHaveLength(2)
    expect(purchaseOrders[0].totalAmount).toBe(50 * 100 + 30 * 50) // 5000 + 1500
    expect(purchaseOrders[0].hasCriticalItems).toBe(true)
    expect(skippedItems).toHaveLength(0)
  })

  test('skips items without supplier mapping', () => {
    const alerts = [{ sku: 'X', currentStock: 1, reorderPoint: 5, reorderQty: 10, urgency: 'critical' }]
    const { purchaseOrders, skippedItems } = generateAutoReorderPOs(alerts, [])
    expect(purchaseOrders).toHaveLength(0)
    expect(skippedItems).toHaveLength(1)
    expect(skippedItems[0].reason).toContain('未設定供應商')
  })

  test('uses minOrderQty when larger than reorderQty', () => {
    const alerts = [{ sku: 'A', currentStock: 5, reorderPoint: 10, reorderQty: 20, urgency: 'warning' }]
    const mappings = [{ sku: 'A', supplier: 'S1', isPreferred: true, unitCost: 10, minOrderQty: 100 }]
    const { purchaseOrders } = generateAutoReorderPOs(alerts, mappings)
    expect(purchaseOrders[0].items[0].qty).toBe(100)
  })

  test('empty alerts returns empty', () => {
    const { purchaseOrders } = generateAutoReorderPOs([], [])
    expect(purchaseOrders).toHaveLength(0)
  })
})

// ════════════════════════════════════════
// 11. Turnover & Dead Stock
// ════════════════════════════════════════

describe('WMS-11: Turnover & Dead Stock', () => {
  test('calculateInventoryTurnover', () => {
    const result = calculateInventoryTurnover(365000, 100000)
    expect(result.turnoverRate).toBe(3.65)
    expect(result.daysOfStock).toBe(100)
  })

  test('calculateInventoryTurnover zero inventory', () => {
    expect(calculateInventoryTurnover(100, 0).turnoverRate).toBe(0)
  })

  test('identifyDeadStock classifies by days', () => {
    const items = [
      { sku: 'A', lastMovementDate: new Date(Date.now() - 10 * 86400000).toISOString(), currentStock: 10, unitCost: 50 },
      { sku: 'B', lastMovementDate: new Date(Date.now() - 100 * 86400000).toISOString(), currentStock: 20, unitCost: 30 },
      { sku: 'C', lastMovementDate: new Date(Date.now() - 200 * 86400000).toISOString(), currentStock: 5, unitCost: 100 },
      { sku: 'D', lastMovementDate: null, currentStock: 3, unitCost: 200 },
    ]
    const result = identifyDeadStock(items, 90)
    // A is active (10 days) → filtered out
    expect(result.find(r => r.sku === 'A')).toBeUndefined()
    // Classification correctness
    expect(result.find(r => r.sku === 'B').classification).toBe('slow')     // 100 days, threshold*1 = slow
    expect(result.find(r => r.sku === 'C').classification).toBe('very_slow') // 200 days, threshold*2 = very_slow
    expect(result.find(r => r.sku === 'D').classification).toBe('dead')     // null = dead
    // Non-active items only
    expect(result).toHaveLength(3)
    // Value calculation
    expect(result.find(r => r.sku === 'B').value).toBe(600)  // 20 * 30
    expect(result.find(r => r.sku === 'C').value).toBe(500)  // 5 * 100
    expect(result.find(r => r.sku === 'D').value).toBe(600)  // 3 * 200
  })
})

// ════════════════════════════════════════
// 12. Kit Availability
// ════════════════════════════════════════

describe('WMS-12: Kit Availability', () => {
  test('calculates based on limiting component', () => {
    const components = [
      { componentSku: 'A', requiredQty: 2 },
      { componentSku: 'B', requiredQty: 3 },
    ]
    const stocks = [
      { sku: 'A', on_hand: 10 },
      { sku: 'B', on_hand: 9 },
    ]
    const result = calculateKitAvailability(components, stocks)
    expect(result.availableKits).toBe(3) // B is limiting: 9/3=3
    expect(result.limitingComponent.sku).toBe('B')
  })

  test('returns 0 for missing component stock', () => {
    const result = calculateKitAvailability([{ componentSku: 'X', requiredQty: 1 }], [])
    expect(result.availableKits).toBe(0)
  })

  test('returns 0 for empty components', () => {
    expect(calculateKitAvailability([], []).availableKits).toBe(0)
  })
})

// ════════════════════════════════════════
// 13. UoM Conversions
// ════════════════════════════════════════

describe('WMS-13: Unit of Measure Conversions', () => {
  const conversions = [
    { from: 'pallet', to: 'box', factor: 48 },
    { from: 'box', to: 'pcs', factor: 12 },
  ]

  test('direct conversion', () => {
    const result = convertUoM(2, 'pallet', 'box', conversions)
    expect(result.success).toBe(true)
    expect(result.qty).toBe(96)
  })

  test('multi-hop conversion (pallet → pcs)', () => {
    const result = convertUoM(1, 'pallet', 'pcs', conversions)
    expect(result.success).toBe(true)
    expect(result.qty).toBe(576) // 48 * 12
  })

  test('reverse conversion (pcs → box)', () => {
    const result = convertUoM(24, 'pcs', 'box', conversions)
    expect(result.success).toBe(true)
    expect(result.qty).toBe(2)
  })

  test('same unit returns identity', () => {
    const result = convertUoM(10, 'box', 'box', conversions)
    expect(result.qty).toBe(10)
  })

  test('fails for unconnected units', () => {
    const result = convertUoM(10, 'kg', 'pcs', conversions)
    expect(result.success).toBe(false)
    expect(result.error).toContain('無法從')
  })

  test('getBaseQty finds smallest unit', () => {
    const result = getBaseQty(2, 'pallet', conversions)
    expect(result.qty).toBe(1152) // 2 * 48 * 12
    expect(result.unit).toBe('pcs')
  })
})

// ════════════════════════════════════════
// 14. Constants
// ════════════════════════════════════════

describe('WMS-14: Constants', () => {
  test('ZONE_TYPES has 6 entries', () => {
    expect(ZONE_TYPES).toHaveLength(6)
    expect(ZONE_TYPES).toContain('quarantine')
    expect(ZONE_TYPES).toContain('returns')
  })

  test('ADJUSTMENT_REASONS has approval flags', () => {
    expect(ADJUSTMENT_REASONS.length).toBe(8)
    expect(ADJUSTMENT_REASONS.find(r => r.code === 'DAMAGE').requiresApproval).toBe(true)
    expect(ADJUSTMENT_REASONS.find(r => r.code === 'COUNT_VARIANCE').requiresApproval).toBe(false)
  })
})
