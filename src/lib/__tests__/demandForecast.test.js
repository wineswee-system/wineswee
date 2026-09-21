/**
 * Demand Forecast Engine — comprehensive test suite
 *
 * Covers: aggregateDemand, SMA, WMA, Seasonal Decomposition,
 * autoForecast, Safety Stock, Reorder Point
 */
import {
  aggregateDemand,
  simpleMovingAverage,
  weightedMovingAverage,
  seasonalDecomposition,
  autoForecast,
  calculateSafetyStock,
  calculateReorderPoint,
} from '../demandForecast'

// ════════════════════════════════════════
// 1. Aggregate Demand
// ════════════════════════════════════════

describe('DF-01: aggregateDemand', () => {
  test('filters only OUT transactions', () => {
    const txns = [
      { date: '2025-01-15', qty: 10, type: 'OUT' },
      { date: '2025-01-20', qty: 50, type: 'IN' },
      { date: '2025-01-25', qty: 5, type: 'OUT' },
    ]
    const result = aggregateDemand(txns, 'monthly')
    expect(result).toHaveLength(1)
    expect(result[0].demand).toBe(15) // 10 + 5
    expect(result[0].period).toBe('2025-01')
  })

  test('daily aggregation', () => {
    const txns = [
      { date: '2025-03-01', qty: 10, type: 'OUT' },
      { date: '2025-03-01', qty: 5, type: 'OUT' },
      { date: '2025-03-02', qty: 20, type: 'OUT' },
    ]
    const result = aggregateDemand(txns, 'daily')
    expect(result).toHaveLength(2)
    expect(result[0].period).toBe('2025-03-01')
    expect(result[0].demand).toBe(15)
  })

  test('weekly aggregation', () => {
    const txns = [
      { date: '2025-01-06', qty: 10, type: 'OUT' },
      { date: '2025-01-08', qty: 5, type: 'OUT' },
    ]
    const result = aggregateDemand(txns, 'weekly')
    expect(result).toHaveLength(1)
    expect(result[0].period).toMatch(/^2025-W/)
  })

  test('handles empty/null input', () => {
    expect(aggregateDemand(null, 'monthly')).toEqual([])
    expect(aggregateDemand([], 'monthly')).toEqual([])
  })

  test('uses absolute qty values', () => {
    const txns = [{ date: '2025-01-01', qty: -10, type: 'OUT' }]
    expect(aggregateDemand(txns, 'monthly')[0].demand).toBe(10)
  })

  test('sorted chronologically', () => {
    const txns = [
      { date: '2025-03-01', qty: 1, type: 'OUT' },
      { date: '2025-01-01', qty: 1, type: 'OUT' },
      { date: '2025-02-01', qty: 1, type: 'OUT' },
    ]
    const result = aggregateDemand(txns, 'monthly')
    expect(result.map(r => r.period)).toEqual(['2025-01', '2025-02', '2025-03'])
  })
})

// ════════════════════════════════════════
// 2. Simple Moving Average
// ════════════════════════════════════════

describe('DF-02: Simple Moving Average', () => {
  test('returns avg of recent window', () => {
    const data = [10, 20, 30, 40, 50]
    const result = simpleMovingAverage(data, 3, 2)
    expect(result.method).toBe('SMA')
    expect(result.forecast).toHaveLength(2)
    // avg of last 3: (30+40+50)/3 = 40
    expect(result.forecast[0]).toBeCloseTo(40, 0)
  })

  test('handles empty data', () => {
    const result = simpleMovingAverage([], 3, 3)
    expect(result.forecast).toEqual([0, 0, 0])
    expect(result.confidence).toBe(0)
  })

  test('window larger than data uses all data', () => {
    const result = simpleMovingAverage([10, 20], 5, 1)
    expect(result.forecast[0]).toBe(15) // avg of [10,20]
  })

  test('confidence higher when enough data', () => {
    const steady = [100, 100, 100, 100, 100]
    const result = simpleMovingAverage(steady, 3, 1)
    expect(result.confidence).toBeGreaterThan(0.5)
    expect(result.stdDev).toBe(0) // no variance
  })
})

// ════════════════════════════════════════
// 3. Weighted Moving Average
// ════════════════════════════════════════

describe('DF-03: Weighted Moving Average', () => {
  test('gives more weight to recent values', () => {
    const data = [10, 20, 30] // weights: 1, 2, 3 → (10+40+90)/6 = 23.33
    const result = weightedMovingAverage(data, 3, 1)
    expect(result.method).toBe('WMA')
    expect(result.forecast[0]).toBeCloseTo(23.33, 1)
  })

  test('handles empty data', () => {
    const result = weightedMovingAverage([], 3, 2)
    expect(result.forecast).toEqual([0, 0])
    expect(result.confidence).toBe(0)
  })

  test('single data point', () => {
    const result = weightedMovingAverage([50], 3, 1)
    expect(result.forecast[0]).toBe(50) // only one value
  })
})

// ════════════════════════════════════════
// 4. Seasonal Decomposition
// ════════════════════════════════════════

describe('DF-04: Seasonal Decomposition', () => {
  test('falls back to WMA when data < seasonLength', () => {
    const result = seasonalDecomposition([10, 20, 30], 12, 2)
    expect(result.method).toContain('fallback WMA')
  })

  test('decomposes seasonal pattern with enough data', () => {
    // Create 24 months of data with seasonal pattern
    const data = Array.from({ length: 24 }, (_, i) => {
      const season = Math.sin((i / 12) * 2 * Math.PI) * 20
      return 100 + season + i * 2 // trend + seasonal
    })
    const result = seasonalDecomposition(data, 12, 3)
    expect(result.method).toBe('SEASONAL')
    expect(result.forecast).toHaveLength(3)
    expect(result.seasonalIndices).toHaveLength(12)
    expect(result.confidence).toBe(0.75) // enough data
  })

  test('confidence is 0.5 when data < 2×seasonLength', () => {
    const data = Array.from({ length: 14 }, (_, i) => 100 + i)
    const result = seasonalDecomposition(data, 12, 2)
    expect(result.confidence).toBe(0.5)
  })

  test('forecast values are non-negative', () => {
    const data = Array.from({ length: 24 }, () => 10)
    const result = seasonalDecomposition(data, 12, 3)
    result.forecast.forEach(v => expect(v).toBeGreaterThanOrEqual(0))
  })
})

// ════════════════════════════════════════
// 5. Auto Forecast
// ════════════════════════════════════════

describe('DF-05: autoForecast', () => {
  test('returns NONE for empty data', () => {
    const result = autoForecast([], 12, 3)
    expect(result.method).toBe('NONE')
    expect(result.confidence).toBe(0)
  })

  test('uses SMA for < 6 data points', () => {
    const result = autoForecast([10, 20, 30], 12, 2)
    expect(result.method).toBe('SMA')
  })

  test('uses SEASONAL for >= 2×seasonLength data', () => {
    const data = Array.from({ length: 24 }, (_, i) => 100 + Math.sin(i / 6 * Math.PI) * 20)
    const result = autoForecast(data, 12, 3)
    expect(result.method).toBe('SEASONAL')
  })

  test('detects upward trend and uses WMA', () => {
    const data = [10, 20, 30, 40, 80, 120, 200] // strong uptrend
    const result = autoForecast(data, 12, 2)
    expect(result.method).toBe('WMA')
  })

  test('stable data uses SMA', () => {
    const data = [100, 101, 99, 100, 100, 101, 99]
    const result = autoForecast(data, 12, 2)
    expect(result.method).toBe('SMA')
  })
})

// ════════════════════════════════════════
// 6. Safety Stock & Reorder Point
// ════════════════════════════════════════

describe('DF-06: Safety Stock & Reorder Point', () => {
  test('calculateSafetyStock formula: Z × σ × √(leadTime)', () => {
    // 1.65 × 10 × √(9) = 1.65 × 10 × 3 = 49.5
    expect(calculateSafetyStock(10, 9, 1.65)).toBe(49.5)
  })

  test('calculateSafetyStock returns 0 for zero stdDev', () => {
    expect(calculateSafetyStock(0, 10)).toBe(0)
  })

  test('calculateSafetyStock returns 0 for zero leadTime', () => {
    expect(calculateSafetyStock(10, 0)).toBe(0)
  })

  test('calculateReorderPoint = avgDaily × leadTime + safety', () => {
    // 50 × 7 + 100 = 450
    expect(calculateReorderPoint(50, 7, 100)).toBe(450)
  })

  test('calculateReorderPoint with zero safety stock', () => {
    expect(calculateReorderPoint(10, 5, 0)).toBe(50)
  })
})
