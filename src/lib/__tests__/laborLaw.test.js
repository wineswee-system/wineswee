import { describe, it, expect } from 'vitest'
import {
  LABOR_STANDARDS,
  GENDER_EQUALITY,
  OCCUPATIONAL_SAFETY,
  validateSchedule,
  calculateOvertimePay,
} from '../laborLaw.js'
import { validateLeisureQuota } from '../scheduleUtils.js'

// ═════════════════════════════════════════════════════════════
//  LABOR_STANDARDS Constants
// ═════════════════════════════════════════════════════════════

describe('LABOR_STANDARDS', () => {
  it('§30: daily 8h, weekly 40h', () => {
    expect(LABOR_STANDARDS.normalHours.daily).toBe(8)
    expect(LABOR_STANDARDS.normalHours.weekly).toBe(40)
  })

  it('§32: OT max 46h/month, 54h with agreement', () => {
    expect(LABOR_STANDARDS.overtime.maxMonthly).toBe(46)
    expect(LABOR_STANDARDS.overtime.maxMonthlyAgreed).toBe(54)
    expect(LABOR_STANDARDS.overtime.maxQuarterly).toBe(138)
  })

  it('§32: OT rates include weekday 1.34× and 1.67×', () => {
    const rates = LABOR_STANDARDS.overtime.rates
    expect(rates.find(r => r.rate === 1.34)).toBeDefined()
    expect(rates.find(r => r.rate === 1.67)).toBeDefined()
  })

  it('§36: 2 rest days per week', () => {
    expect(LABOR_STANDARDS.restDays.totalPerWeek).toBe(2)
  })

  it('§34: shift interval minimum 11h', () => {
    expect(LABOR_STANDARDS.shiftInterval.minHours).toBe(11)
    expect(LABOR_STANDARDS.shiftInterval.minHoursAgreed).toBe(8)
  })

  it('§37: national holidays for 2026 are listed', () => {
    const holidays = LABOR_STANDARDS.nationalHolidays.holidays2026
    expect(holidays.length).toBeGreaterThanOrEqual(10)
    expect(holidays.find(h => h.name === '勞動節')).toBeDefined()
    expect(holidays.find(h => h.name === '元旦')).toBeDefined()
  })
})

describe('GENDER_EQUALITY', () => {
  it('includes maternity protection', () => {
    expect(GENDER_EQUALITY.maternityProtection.law).toContain('§15')
  })

  it('includes nursing time', () => {
    expect(GENDER_EQUALITY.nursingTime.law).toContain('§18')
  })
})

describe('OCCUPATIONAL_SAFETY', () => {
  it('includes overwork prevention', () => {
    expect(OCCUPATIONAL_SAFETY.overworkPrevention.law).toContain('職安法')
  })

  it('includes 2026 workplace bullying chapter', () => {
    expect(OCCUPATIONAL_SAFETY.workplaceBullying.measures.length).toBeGreaterThan(0)
  })
})

// ═════════════════════════════════════════════════════════════
//  validateSchedule
// ═════════════════════════════════════════════════════════════

describe('validateSchedule', () => {
  const weekDates = ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10', '2026-04-11', '2026-04-12']

  it('HR-U12: valid schedule (5 work + 2 rest) passes', () => {
    const schedules = [
      { employee: '王小明', date: '2026-04-06', shift: '9-18' },
      { employee: '王小明', date: '2026-04-07', shift: '9-18' },
      { employee: '王小明', date: '2026-04-08', shift: '9-18' },
      { employee: '王小明', date: '2026-04-09', shift: '9-18' },
      { employee: '王小明', date: '2026-04-10', shift: '9-18' },
      { employee: '王小明', date: '2026-04-11', shift: '休' },
      { employee: '王小明', date: '2026-04-12', shift: '休' },
    ]
    const result = validateSchedule(schedules, weekDates)
    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('HR-U14: weekly > 40h triggers warning (now lives in validateLeisureQuota)', () => {
    // 6 work days = 48h；check 移到 validateLeisureQuota（cycle-aware：標準工時 cycle = 1 週 40h）
    const schedules = [
      { employee: '王小明', date: '2026-04-06', shift: '9-18' },
      { employee: '王小明', date: '2026-04-07', shift: '9-18' },
      { employee: '王小明', date: '2026-04-08', shift: '9-18' },
      { employee: '王小明', date: '2026-04-09', shift: '9-18' },
      { employee: '王小明', date: '2026-04-10', shift: '9-18' },
      { employee: '王小明', date: '2026-04-11', shift: '9-18' },
      { employee: '王小明', date: '2026-04-12', shift: '休' },
    ]
    const result = validateLeisureQuota({
      schedules,
      workHourSystem: '標準工時',
      startDate: weekDates[0],
      endDate: weekDates[weekDates.length - 1],
    })
    expect(result.warnings.some(w => w.constraint === 'WH')).toBe(true)
  })

  it('HR-U15: < 2 rest days triggers error (§36)', () => {
    // 7 work days, 0 rest
    const schedules = weekDates.map(d => ({
      employee: '王小明', date: d, shift: '9-18',
    }))
    const result = validateSchedule(schedules, weekDates)
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => e.law === '勞基法 §36')).toBe(true)
  })

  it('consecutive work > 6 days triggers error', () => {
    const schedules = weekDates.map(d => ({
      employee: '王小明', date: d, shift: '9-18',
    }))
    const result = validateSchedule(schedules, weekDates)
    expect(result.errors.some(e => e.message.includes('連續工作'))).toBe(true)
  })

  it('連續工作跨週界仍偵測(8 連上,weekDates 只給單週窗)', () => {
    // 迴歸:林則宇情境。H3 須掃整份排班按日曆天相鄰,不能只看 7 天 weekDates 窗,
    // 否則跨週的連上會被切成兩段(各 ≤6)而漏報。
    const schedules = [
      { employee: 'PT林', date: '2026-04-06', shift: '例假' },        // 打斷
      { employee: 'PT林', date: '2026-04-07', shift: '9-18' },        // 連上第 1 天
      { employee: 'PT林', date: '2026-04-08', shift: '9-18' },
      { employee: 'PT林', date: '2026-04-09', shift: '9-18' },
      { employee: 'PT林', date: '2026-04-10', shift: '9-18' },
      { employee: 'PT林', date: '2026-04-11', shift: '9-18' },
      { employee: 'PT林', date: '2026-04-12', shift: '9-18' },        // weekDates 窗到此為止
      { employee: 'PT林', date: '2026-04-13', shift: '9-18' },        // 跨到下週
      { employee: 'PT林', date: '2026-04-14', shift: '9-18' },        // 連上第 8 天
    ]
    // weekDates 刻意只給單週(04-06~04-12);舊碼會在 04-12 截斷只數到 6 而漏報
    const result = validateSchedule(schedules, weekDates)
    const hit = result.errors.find(e => e.message.includes('連續工作'))
    expect(hit).toBeTruthy()
    expect(hit.message).toContain('8')
  })

  it('例假/休息 打斷連續,不誤報(莊浩隆情境)', () => {
    // 迴歸:排班休假存 例假/休息(非舊字串 休),不可被當成上班日累加。
    const schedules = [
      { employee: 'PT莊', date: '2026-04-06', shift: '9-18' },
      { employee: 'PT莊', date: '2026-04-07', shift: '例假' },
      { employee: 'PT莊', date: '2026-04-08', shift: '9-18' },
      { employee: 'PT莊', date: '2026-04-09', shift: '9-18' },
      { employee: 'PT莊', date: '2026-04-10', shift: '休息' },
      { employee: 'PT莊', date: '2026-04-11', shift: '9-18' },
      { employee: 'PT莊', date: '2026-04-12', shift: '9-18' },
    ]
    const result = validateSchedule(schedules, weekDates)
    expect(result.errors.some(e => e.message.includes('連續工作'))).toBe(false)
  })

  // 連續工作上限依員工類型:正職 12(變形工時但書)、兼職 6(七休一)
  const _consecDates = (n) => Array.from({ length: n }, (_, i) => `2026-04-${String(6 + i).padStart(2, '0')}`)
  it('正職連上10天不報(變形工時但書上限12)', () => {
    const schedules = _consecDates(10).map(d => ({ employee: '正職甲', date: d, shift: '9-18' }))
    const result = validateSchedule(schedules, weekDates, [], [{ name: '正職甲', employment_type: '正職' }])
    expect(result.errors.some(e => e.message.includes('連續工作'))).toBe(false)
  })
  it('正職連上13天要報(超過上限12)', () => {
    const schedules = _consecDates(13).map(d => ({ employee: '正職甲', date: d, shift: '9-18' }))
    const result = validateSchedule(schedules, weekDates, [], [{ name: '正職甲', employment_type: '正職' }])
    const hit = result.errors.find(e => e.message.includes('連續工作'))
    expect(hit).toBeTruthy()
    expect(hit.message).toContain('12')
  })
  it('兼職連上10天要報(上限6)', () => {
    const schedules = _consecDates(10).map(d => ({ employee: '兼職乙', date: d, shift: '9-18' }))
    const result = validateSchedule(schedules, weekDates, [], [{ name: '兼職乙', employment_type: '兼職' }])
    expect(result.errors.some(e => e.message.includes('連續工作'))).toBe(true)
  })

  it('short shift interval triggers error (§34)', () => {
    const schedules = [
      { employee: '王小明', date: '2026-04-06', shift: '14-22' },
      { employee: '王小明', date: '2026-04-07', shift: '6-14' },
      { employee: '王小明', date: '2026-04-08', shift: '休' },
      { employee: '王小明', date: '2026-04-09', shift: '休' },
      { employee: '王小明', date: '2026-04-10', shift: '休' },
      { employee: '王小明', date: '2026-04-11', shift: '休' },
      { employee: '王小明', date: '2026-04-12', shift: '休' },
    ]
    const result = validateSchedule(schedules, weekDates)
    // Gap: 22→6 next day = 8h, which is < 11h。§34 班距不足是硬性 error(老闆定,拿掉舊 8h 工會例外)
    expect(result.errors.some(e => e.law === '勞基法 §34')).toBe(true)
  })

  it('離職員工:離職後未完整在職的窗不報例假/休息不足', () => {
    // 王小明 2026-04-08 離職;標準工時每7天需1例1休。該週他只在職到 04-08,
    // 湊不滿例假/休息 → 但不該報(離職者無法回頭補排)。對照下一個 test。
    const schedules = [
      { employee: '王小明', date: '2026-04-06', shift: '9-18' },
      { employee: '王小明', date: '2026-04-07', shift: '9-18' },
      { employee: '王小明', date: '2026-04-08', shift: '9-18' },
    ]
    const result = validateLeisureQuota({
      schedules,
      workHourSystem: '標準工時',
      startDate: '2026-04-06',
      endDate: '2026-04-12',
      employees: [{ name: '王小明', resign_date: '2026-04-08' }],
    })
    expect(result.errors.some(e => e.constraint === 'H5')).toBe(false)
  })

  it('未入職員工:入職前的窗不報例假/休息不足', () => {
    // 王小明 2026-04-10 才入職;該週(04-06~04-12)前段未入職 → 不該報。
    const schedules = [
      { employee: '王小明', date: '2026-04-10', shift: '9-18' },
      { employee: '王小明', date: '2026-04-11', shift: '9-18' },
      { employee: '王小明', date: '2026-04-12', shift: '9-18' },
    ]
    const result = validateLeisureQuota({
      schedules,
      workHourSystem: '標準工時',
      startDate: '2026-04-06',
      endDate: '2026-04-12',
      employees: [{ name: '王小明', join_date: '2026-04-10' }],
    })
    expect(result.errors.some(e => e.constraint === 'H5')).toBe(false)
  })

  it('在職員工:整週在職湊不滿仍正常報例假/休息不足(對照組)', () => {
    const schedules = weekDates.map(d => ({ employee: '王小明', date: d, shift: '9-18' }))
    const result = validateLeisureQuota({
      schedules,
      workHourSystem: '標準工時',
      startDate: '2026-04-06',
      endDate: '2026-04-12',
      employees: [{ name: '王小明' }],   // 無 resign_date = 在職
    })
    expect(result.errors.some(e => e.constraint === 'H5')).toBe(true)
  })

  it('handles multiple employees independently', () => {
    const schedules = [
      // Employee A: valid
      ...weekDates.slice(0, 5).map(d => ({ employee: 'A', date: d, shift: '9-18' })),
      ...weekDates.slice(5).map(d => ({ employee: 'A', date: d, shift: '休' })),
      // Employee B: invalid (7 work days)
      ...weekDates.map(d => ({ employee: 'B', date: d, shift: '9-18' })),
    ]
    const result = validateSchedule(schedules, weekDates)
    expect(result.errors.some(e => e.employee === 'B')).toBe(true)
    expect(result.errors.some(e => e.employee === 'A')).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateOvertimePay
// ═════════════════════════════════════════════════════════════

describe('calculateOvertimePay', () => {
  // baseSalary = 30000, hourlyRate = 30000 / 30 / 8 = 125
  const base = 30000
  const hourly = Math.round(base / 30 / 8) // 125

  it('HR-U16: weekday OT first 2h at 1.34×', () => {
    const pay = calculateOvertimePay(base, 2, 'weekday')
    expect(pay).toBe(Math.round(hourly * 2 * 1.34))
  })

  it('HR-U17: weekday OT 4h — first 2h @1.34 + next 2h @1.67', () => {
    const pay = calculateOvertimePay(base, 4, 'weekday')
    expect(pay).toBe(Math.round(hourly * 2 * 1.34 + hourly * 2 * 1.67))
  })

  it('HR-U18: rest day OT uses higher rates', () => {
    const weekdayPay = calculateOvertimePay(base, 4, 'weekday')
    const restdayPay = calculateOvertimePay(base, 4, 'restday')
    expect(restdayPay).toBeGreaterThanOrEqual(weekdayPay)
  })

  it('rest day OT 10h — includes 2.67× for hours 9-10', () => {
    const pay = calculateOvertimePay(base, 10, 'restday')
    const expected = Math.round(
      hourly * 2 * 1.34 +  // first 2h
      hourly * 6 * 1.67 +  // next 6h (3-8)
      hourly * 2 * 2.67    // last 2h (9-10)
    )
    expect(pay).toBe(expected)
  })

  it('HR-U19: holiday OT = 2× (double pay)', () => {
    const pay = calculateOvertimePay(base, 8, 'holiday')
    expect(pay).toBe(Math.round(hourly * 8 * 2))
  })

  it('unknown type returns 0', () => {
    const pay = calculateOvertimePay(base, 4, 'unknown')
    expect(pay).toBe(0)
  })

  it('0 hours returns 0', () => {
    const pay = calculateOvertimePay(base, 0, 'weekday')
    expect(pay).toBe(0)
  })
})
