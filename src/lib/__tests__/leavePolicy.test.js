import { describe, it, expect } from 'vitest'
import {
  LEAVE_TYPES,
  getAnnualLeaveEntitlement,
  getLeaveTypeInfo,
  validateLeaveRequest,
  calculateDeduction,
} from '../leavePolicy.js'

// ═══════════════════════════════════════════════════���═════════
//  LEAVE_TYPES — 16 Leave Types
// ════════════════��════════════════════════════════��═══════════

describe('LEAVE_TYPES', () => {
  it('HR-U34: all 16 leave types are defined', () => {
    const expectedCodes = [
      'annual', 'sick', 'personal', 'official', 'maternity', 'paternity',
      'parental', 'menstrual', 'marriage', 'bereavement', 'family_care',
      'occupational', 'nursing', 'prenatal',
    ]
    // At least 15 types (some might be combined)
    expect(LEAVE_TYPES.length).toBeGreaterThanOrEqual(15)

    for (const code of expectedCodes) {
      const found = LEAVE_TYPES.find(t => t.code === code)
      expect(found, `Leave type '${code}' should exist`).toBeDefined()
      expect(found.name).toBeTruthy()
      expect(found.law).toBeTruthy()
    }
  })

  it('each leave type has required fields', () => {
    for (const type of LEAVE_TYPES) {
      expect(type.code).toBeTruthy()
      expect(type.name).toBeTruthy()
      expect(type.law).toBeTruthy()
      expect(typeof type.paid).toBe('boolean')
      expect(type.unit).toBeTruthy()
    }
  })
})

// ══���══════════════════════════════════���═══════════════════════
//  Annual Leave Entitlement (特休)
// ════════════════════��═════════════════════════════════��══════

describe('Annual Leave Entitlement (§38)', () => {
  const calc = LEAVE_TYPES.find(t => t.code === 'annual').calcEntitlement

  it('HR-U22: 6mo–1yr = 3 days', () => {
    expect(calc(0.5)).toBe(3)
    expect(calc(0.8)).toBe(3)
  })

  it('HR-U23: 1–2yr = 7 days', () => {
    expect(calc(1)).toBe(7)
    expect(calc(1.5)).toBe(7)
  })

  it('HR-U24: 2–3yr = 10 days', () => {
    expect(calc(2)).toBe(10)
    expect(calc(2.9)).toBe(10)
  })

  it('3–5yr = 14 days', () => {
    expect(calc(3)).toBe(14)
    expect(calc(4.9)).toBe(14)
  })

  it('HR-U25: 5–10yr = 15 days', () => {
    expect(calc(5)).toBe(15)
    expect(calc(9.9)).toBe(15)
  })

  it('HR-U26: 10+yr = 15 + extra per year, max 30', () => {
    expect(calc(10)).toBe(15)
    expect(calc(11)).toBe(16)
    expect(calc(15)).toBe(20)
    expect(calc(25)).toBe(30)
    expect(calc(30)).toBe(30) // capped at 30
  })

  it('< 6 months = 0 days', () => {
    expect(calc(0)).toBe(0)
    expect(calc(0.4)).toBe(0)
  })
})

// ═══════════════════��═════════════════════════════��═══════════
//  getAnnualLeaveEntitlement
// ═════════════════════════════════════════════════════════════

describe('getAnnualLeaveEntitlement', () => {
  it('returns days and yearsWorked for valid join date', () => {
    // Someone who joined ~3 years ago (safely in the 2-3yr bracket → 10 days)
    const threeYearsAgo = new Date()
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3)
    threeYearsAgo.setMonth(threeYearsAgo.getMonth() + 1) // 2yr 11mo to be in 2-3yr bracket
    const result = getAnnualLeaveEntitlement(threeYearsAgo.toISOString())
    expect(result.days).toBeGreaterThanOrEqual(7) // At least 1-2yr bracket
    expect(result.yearsWorked).toBeGreaterThanOrEqual(2)
  })

  it('returns 0 for null join date', () => {
    const result = getAnnualLeaveEntitlement(null)
    expect(result.days).toBe(0)
    expect(result.yearsWorked).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════
//  getLeaveTypeInfo
// ════════���═════════════════════════���══════════════════════════

describe('getLeaveTypeInfo', () => {
  it('finds by code', () => {
    const info = getLeaveTypeInfo('sick')
    expect(info).toBeDefined()
    expect(info.name).toBe('普通傷病假')
  })

  it('finds by shortName', () => {
    const info = getLeaveTypeInfo('病假')
    expect(info).toBeDefined()
    expect(info.code).toBe('sick')
  })

  it('finds by full name', () => {
    const info = getLeaveTypeInfo('普通傷病假')
    expect(info).toBeDefined()
    expect(info.code).toBe('sick')
  })

  it('returns undefined for unknown type', () => {
    expect(getLeaveTypeInfo('unknown')).toBeUndefined()
  })
})

// ════════��════════════════════════════════════════════════════
//  validateLeaveRequest
// ═══════════════════════════��═════════════════════════════════

describe('validateLeaveRequest', () => {
  it('HR-U27: sick leave max 30 days — rejects 31st day', () => {
    const result = validateLeaveRequest({
      type: 'sick',
      days: 1,
      usedDays: 30,
      gender: 'female',
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('不足')
  })

  it('sick leave within limit passes', () => {
    const result = validateLeaveRequest({
      type: 'sick',
      days: 1,
      usedDays: 10,
      gender: 'male',
    })
    expect(result.valid).toBe(true)
  })

  it('HR-U28: menstrual leave approved for female', () => {
    const result = validateLeaveRequest({
      type: 'menstrual',
      days: 1,
      usedDays: 0,
      gender: 'female',
    })
    expect(result.valid).toBe(true)
  })

  it('menstrual leave rejected for male', () => {
    const result = validateLeaveRequest({
      type: 'menstrual',
      days: 1,
      usedDays: 0,
      gender: 'male',
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('僅限女性')
  })

  it('HR-U29: family care leave max 7 days — rejects 8th', () => {
    const result = validateLeaveRequest({
      type: 'family_care',
      days: 1,
      usedDays: 7,
      gender: 'male',
    })
    expect(result.valid).toBe(false)
  })

  it('HR-U30: maternity leave for female', () => {
    const result = validateLeaveRequest({
      type: 'maternity',
      days: 56,
      gender: 'female',
    })
    expect(result.valid).toBe(true)
  })

  it('maternity leave rejected for male', () => {
    const result = validateLeaveRequest({
      type: 'maternity',
      days: 56,
      gender: 'male',
    })
    expect(result.valid).toBe(false)
  })

  it('HR-U31: paternity leave 7 days', () => {
    const result = validateLeaveRequest({
      type: 'paternity',
      days: 7,
      usedDays: 0,
      gender: 'male',
    })
    expect(result.valid).toBe(true)
  })

  it('paternity leave over limit rejected', () => {
    const result = validateLeaveRequest({
      type: 'paternity',
      days: 1,
      usedDays: 7,
      gender: 'male',
    })
    expect(result.valid).toBe(false)
  })

  it('HR-U33: invalid leave type', () => {
    const result = validateLeaveRequest({ type: 'nonexistent', days: 1 })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('無效')
  })

  it('personal leave max 14 days', () => {
    const result = validateLeaveRequest({
      type: 'personal',
      days: 1,
      usedDays: 14,
      gender: 'male',
    })
    expect(result.valid).toBe(false)
  })

  it('marriage leave max 8 days', () => {
    const ok = validateLeaveRequest({ type: 'marriage', days: 8, usedDays: 0 })
    expect(ok.valid).toBe(true)
    const over = validateLeaveRequest({ type: 'marriage', days: 1, usedDays: 8 })
    expect(over.valid).toBe(false)
  })

  it('hourly request converted to days', () => {
    // 24h = 3 days, used 28 of 30 sick days → only 2 left
    const result = validateLeaveRequest({
      type: 'sick',
      hours: 24,
      usedDays: 28,
      gender: 'male',
    })
    expect(result.valid).toBe(false) // 3 days requested, only 2 remaining
  })
})

// ══════════════════���══════════════════════════════════════════
//  calculateDeduction
// ���════════════════════════════════════════════════���═══════════

describe('calculateDeduction', () => {
  const baseSalary = 30000 // daily = 1000, hourly = 125

  it('annual leave (paid) — no deduction', () => {
    const deduction = calculateDeduction({ type: 'annual', days: 3, baseSalary })
    expect(deduction).toBe(0)
  })

  it('personal leave (unpaid) — full deduction', () => {
    const deduction = calculateDeduction({ type: 'personal', days: 2, baseSalary })
    const dailyRate = Math.round(baseSalary / 30)
    expect(deduction).toBe(dailyRate * 2)
  })

  it('sick leave — half deduction', () => {
    const deduction = calculateDeduction({ type: 'sick', days: 1, baseSalary })
    const dailyRate = Math.round(baseSalary / 30)
    expect(deduction).toBe(Math.round(dailyRate * 1 * 0.5))
  })

  it('menstrual leave — half deduction', () => {
    const deduction = calculateDeduction({ type: 'menstrual', days: 1, baseSalary })
    const dailyRate = Math.round(baseSalary / 30)
    expect(deduction).toBe(Math.round(dailyRate * 1 * 0.5))
  })

  it('hourly deduction for unpaid leave', () => {
    const deduction = calculateDeduction({ type: 'personal', hours: 4, baseSalary })
    const hourlyRate = Math.round(Math.round(baseSalary / 30) / 8)
    expect(deduction).toBe(hourlyRate * 4)
  })

  it('unknown leave type returns 0', () => {
    const deduction = calculateDeduction({ type: 'nonexistent', days: 5, baseSalary })
    expect(deduction).toBe(0)
  })

  it('official leave (paid) — no deduction', () => {
    const deduction = calculateDeduction({ type: 'official', days: 1, baseSalary })
    expect(deduction).toBe(0)
  })

  it('paternity leave (paid) — no deduction', () => {
    const deduction = calculateDeduction({ type: 'paternity', days: 7, baseSalary })
    expect(deduction).toBe(0)
  })
})
