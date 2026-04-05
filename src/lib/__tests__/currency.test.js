import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_CURRENCIES,
  DEFAULT_RATES,
  getExchangeRate,
  convertCurrency,
  calculateExchangeDifference,
  formatCurrency,
} from '../currency.js'

// ═════════════════════════════════════════════════════════════
describe('SUPPORTED_CURRENCIES & DEFAULT_RATES', () => {
  it('has TWD, USD, EUR, JPY, CNY', () => {
    for (const code of ['TWD', 'USD', 'EUR', 'JPY', 'CNY']) {
      expect(SUPPORTED_CURRENCIES[code]).toBeDefined()
      expect(DEFAULT_RATES[code]).toBeDefined()
    }
  })

  it('TWD rate is 1', () => {
    expect(DEFAULT_RATES.TWD).toBe(1)
  })
})

// ═════════════════════════════════════════════════════════════
describe('getExchangeRate', () => {
  it('same currency = 1', () => {
    expect(getExchangeRate('TWD', 'TWD')).toBe(1)
    expect(getExchangeRate('USD', 'USD')).toBe(1)
  })

  it('USD to TWD', () => {
    const rate = getExchangeRate('USD', 'TWD')
    expect(rate).toBe(DEFAULT_RATES.USD / DEFAULT_RATES.TWD)
    expect(rate).toBeGreaterThan(30) // USD is ~32 TWD
  })

  it('TWD to USD', () => {
    const rate = getExchangeRate('TWD', 'USD')
    expect(rate).toBeLessThan(1) // 1 TWD < 1 USD
  })

  it('throws for unsupported currency', () => {
    expect(() => getExchangeRate('XYZ', 'TWD')).toThrow('不支援的幣別')
    expect(() => getExchangeRate('TWD', 'XYZ')).toThrow('不支援的幣別')
  })
})

// ═════════════════════════════════════════════════════════════
describe('convertCurrency', () => {
  it('CU-01: TWD → USD', () => {
    const result = convertCurrency(1000, 'TWD', 'USD')
    expect(result.from).toBe('TWD')
    expect(result.to).toBe('USD')
    expect(result.convertedAmount).toBeCloseTo(1000 / DEFAULT_RATES.USD, 1)
  })

  it('CU-02: USD → TWD', () => {
    const result = convertCurrency(100, 'USD', 'TWD')
    expect(result.convertedAmount).toBe(Math.round(100 * DEFAULT_RATES.USD))
  })

  it('CU-05: same currency = no conversion', () => {
    const result = convertCurrency(1000, 'TWD', 'TWD')
    expect(result.convertedAmount).toBe(1000)
    expect(result.rate).toBe(1)
  })

  it('respects decimal places per currency', () => {
    const result = convertCurrency(100, 'USD', 'TWD')
    // TWD has 0 decimals → should be integer
    expect(result.convertedAmount).toBe(Math.round(result.convertedAmount))
  })

  it('custom rates', () => {
    const result = convertCurrency(100, 'USD', 'TWD', { USD: 30, TWD: 1 })
    expect(result.convertedAmount).toBe(3000)
  })
})

// ═════════════════════════════════════════════════════════════
describe('calculateExchangeDifference', () => {
  it('CU-03: exchange gain', () => {
    // Bought USD at 30 TWD, now worth 32 TWD
    const result = calculateExchangeDifference(1000, 30, 32, 'USD')
    expect(result.originalTWD).toBe(30000)
    expect(result.currentTWD).toBe(32000)
    expect(result.difference).toBe(2000)
    expect(result.type).toBe('匯兌利益')
  })

  it('CU-04: exchange loss', () => {
    // Bought USD at 32 TWD, now worth 30 TWD
    const result = calculateExchangeDifference(1000, 32, 30, 'USD')
    expect(result.difference).toBe(-2000)
    expect(result.type).toBe('匯兌損失')
  })

  it('no difference when rates equal', () => {
    const result = calculateExchangeDifference(1000, 32, 32, 'USD')
    expect(result.difference).toBe(0)
    expect(result.type).toBe('匯兌利益') // 0 is >= 0
  })
})

// ═════════════════════════════════════════════════════════════
describe('formatCurrency', () => {
  it('CU-06: TWD format', () => {
    expect(formatCurrency(1000, 'TWD')).toContain('1,000')
  })

  it('USD format with decimals', () => {
    expect(formatCurrency(1234.56, 'USD')).toContain('1,234.56')
  })

  it('JPY format without decimals', () => {
    expect(formatCurrency(10000, 'JPY')).toContain('10,000')
  })

  it('negative amount', () => {
    const result = formatCurrency(-500, 'TWD')
    expect(result).toContain('-')
    expect(result).toContain('500')
  })

  it('CU-07: unknown currency falls back', () => {
    const result = formatCurrency(100, 'XYZ')
    expect(result).toContain('XYZ')
    expect(result).toContain('100')
  })

  it('large amounts with commas', () => {
    expect(formatCurrency(1234567, 'TWD')).toContain('1,234,567')
  })
})
