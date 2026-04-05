import { describe, it, expect } from 'vitest'
import {
  maskPhone,
  maskEmail,
  maskIdNumber,
  maskAddress,
  applyMasking,
} from '../dataMasking.js'

// ═════════════════════════════════════════════════════════════
describe('maskPhone', () => {
  it('DM-01: masks middle digits (plain format)', () => {
    const result = maskPhone('0912345678')
    expect(result).toBe('0912****678')
  })

  it('masks dash-separated format', () => {
    const result = maskPhone('0912-345-678')
    expect(result).toBe('0912-***-678')
  })

  it('handles null/empty', () => {
    expect(maskPhone(null)).toBe('-')
    expect(maskPhone('')).toBe('-')
  })

  it('handles short numbers', () => {
    expect(maskPhone('1234')).toBe('****')
  })
})

// ═════════════════════════════════════════════════════════════
describe('maskEmail', () => {
  it('DM-02: masks email', () => {
    const result = maskEmail('user@example.com')
    expect(result).toBe('u***@example.com')
  })

  it('handles null/empty', () => {
    expect(maskEmail(null)).toBe('-')
    expect(maskEmail('')).toBe('-')
  })

  it('handles no @ sign', () => {
    expect(maskEmail('invalid')).toBe('***')
  })
})

// ═════════════════════════════════════════════════════════════
describe('maskIdNumber', () => {
  it('DM-03: masks ID number', () => {
    const result = maskIdNumber('A123456789')
    expect(result).toBe('A1234*****')
  })

  it('handles null/empty', () => {
    expect(maskIdNumber(null)).toBe('-')
  })

  it('handles short ID', () => {
    expect(maskIdNumber('ABC')).toBe('***')
  })
})

// ═════════════════════════════════════════════════════════════
describe('maskAddress', () => {
  it('DM-04: masks after city+district', () => {
    const result = maskAddress('台北市信義區信義路五段7號')
    expect(result).toContain('台北市')
    expect(result).toContain('信義區')
    expect(result).toContain('***')
    expect(result).not.toContain('五段7號')
  })

  it('handles county format', () => {
    const result = maskAddress('新北市板橋區中山路一段')
    expect(result).toContain('新北市')
    expect(result).toContain('***')
  })

  it('handles null/empty', () => {
    expect(maskAddress(null)).toBe('-')
  })
})

// ═════════════════════════════════════════════════════════════
describe('applyMasking', () => {
  it('DM-05: admin (hasPermission=true) sees full data', () => {
    expect(applyMasking('0912345678', 'phone', true)).toBe('0912345678')
    expect(applyMasking('user@example.com', 'email', true)).toBe('user@example.com')
    expect(applyMasking('A123456789', 'id', true)).toBe('A123456789')
  })

  it('DM-06: non-admin (hasPermission=false) sees masked data', () => {
    expect(applyMasking('0912345678', 'phone', false)).toContain('****')
    expect(applyMasking('user@example.com', 'email', false)).toContain('***')
    expect(applyMasking('A123456789', 'id', false)).toContain('*****')
  })

  it('unknown type returns value as-is', () => {
    expect(applyMasking('hello', 'unknown', false)).toBe('hello')
  })
})
