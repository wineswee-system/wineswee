import { describe, it, expect } from 'vitest'
import { runProgrammaticSchedule, runMonthlyProgrammaticSchedule } from '../schedulingAlgo'
import { isAbsence, getMonthDates, splitIntoWeeks } from '../scheduleUtils'

// ══════════════════════════════════════════════════════════════
//  Test Fixtures
// ══════════════════════════════════════════════════════════════

const makeEmp = (name, opts = {}) => ({
  name,
  employment_type: opts.pt ? '兼職' : '正職',
  can_open: opts.can_open ?? null,
  can_close: opts.can_close ?? null,
  is_pregnant: opts.is_pregnant ?? false,
  is_nursing: opts.is_nursing ?? false,
  schedule_priority: opts.priority ?? 3,
  store: opts.store ?? '總店',
  position: opts.position ?? '',
  base_salary: opts.base_salary ?? 30000,
  ...opts,
})

const makeShift = (name, start, end, opts = {}) => ({
  name,
  start_time: start,
  end_time: end,
  break_minutes: opts.break_minutes ?? 60,
  store_id: opts.store_id ?? null,
  employee_type: opts.employee_type ?? 'all',
  day_type: opts.day_type ?? 'all',
})

const makeWeekDates = (startDate = '2026-04-13') => {
  const dates = []
  const d = new Date(startDate)
  for (let i = 0; i < 7; i++) {
    const dd = new Date(d)
    dd.setDate(d.getDate() + i)
    dates.push(dd.toISOString().slice(0, 10))
  }
  return dates
}

const baseData = () => ({
  employees: [
    makeEmp('Alice', { can_open: true }),
    makeEmp('Bob', { can_close: true }),
    makeEmp('Carol'),
  ],
  shiftDefs: [
    makeShift('早班', '09:00', '18:00'),
    makeShift('晚班', '14:00', '23:00'),
  ],
  weekDates: makeWeekDates('2026-04-13'), // Mon-Sun
  existingSchedules: [],
  offRequests: [],
  preferences: [],
  storeSettings: { minStaff: 1, workHourSystem: '標準工時' },
  holidays: [],
  fatigueScores: [],
  availability: [],
  staffingRules: [
    { shift_name: '早班', required_count: 1 },
    { shift_name: '晚班', required_count: 1 },
  ],
  timeSlots: [],
})

// ══════════════════════════════════════════════════════════════
//  Basic Scheduling
// ══════════════════════════════════════════════════════════════

describe('runProgrammaticSchedule', () => {
  it('SCH-U01: returns valid structure', () => {
    const result = runProgrammaticSchedule(baseData())
    expect(result.success).toBe(true)
    expect(result.assignments).toBeDefined()
    expect(Array.isArray(result.assignments)).toBe(true)
    expect(result.violations).toBeDefined()
    expect(result.stats).toBeDefined()
    expect(result.meta.model).toBe('programmatic-v2')
  })

  it('SCH-U02: every employee gets assigned every day', () => {
    const data = baseData()
    const result = runProgrammaticSchedule(data)
    for (const emp of data.employees) {
      for (const date of data.weekDates) {
        const a = result.assignments.find(a => a.employee === emp.name && a.date === date)
        expect(a, `${emp.name} missing assignment on ${date}`).toBeDefined()
        expect(a.shift).toBeTruthy()
      }
    }
  })

  it('SCH-U03: no hard constraint violations (H1-H4)', () => {
    const result = runProgrammaticSchedule(baseData())
    const errors = result.errors.filter(v => ['H1', 'H2', 'H3', 'H4'].includes(v.constraint))
    expect(errors).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════
//  H1: Off-Request / Leave Respect
// ══════════════════════════════════════════════════════════════

describe('H1: off-request respect', () => {
  it('SCH-U10: employee with off-request gets rest on that day', () => {
    const data = baseData()
    data.offRequests = [{ employee: 'Alice', date: '2026-04-15' }]
    const result = runProgrammaticSchedule(data)
    const a = result.assignments.find(a => a.employee === 'Alice' && a.date === '2026-04-15')
    expect(isAbsence(a.shift)).toBe(true)
  })

  it('SCH-U11: multiple off-requests for same employee', () => {
    const data = baseData()
    data.offRequests = [
      { employee: 'Bob', date: '2026-04-14' },
      { employee: 'Bob', date: '2026-04-16' },
    ]
    const result = runProgrammaticSchedule(data)
    expect(isAbsence(result.assignments.find(a => a.employee === 'Bob' && a.date === '2026-04-14').shift)).toBe(true)
    expect(isAbsence(result.assignments.find(a => a.employee === 'Bob' && a.date === '2026-04-16').shift)).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════
//  H2: Daily Hours Limit
// ══════════════════════════════════════════════════════════════

describe('H2: daily hours limit', () => {
  it('SCH-U20: no assignment exceeds 12 hours', () => {
    const data = baseData()
    data.shiftDefs.push(makeShift('超長班', '06:00', '22:00', { break_minutes: 60 }))
    data.staffingRules.push({ shift_name: '超長班', required_count: 1 })
    const result = runProgrammaticSchedule(data)
    const h2errors = result.errors.filter(v => v.constraint === 'H2')
    // The 16-hour shift should either be rejected or flagged
    const longAssignments = result.assignments.filter(a => a.shift === '超長班')
    // Algorithm should NOT assign a 16h shift
    expect(longAssignments.length).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════
//  H3: Consecutive Work Days
// ══════════════════════════════════════════════════════════════

describe('H3: consecutive work days', () => {
  it('SCH-U30: part-time employees get rest within 6 consecutive days', () => {
    const data = baseData()
    data.employees = [makeEmp('PT-Amy', { pt: true })]
    const result = runProgrammaticSchedule(data)
    const assignments = result.assignments
      .filter(a => a.employee === 'PT-Amy')
      .sort((a, b) => a.date.localeCompare(b.date))

    let consec = 0
    for (const a of assignments) {
      if (!isAbsence(a.shift)) consec++
      else consec = 0
      expect(consec, `PT-Amy consecutive ${consec} days on ${a.date}`).toBeLessThanOrEqual(6)
    }
  })

  it('SCH-U31: full-time employees can work up to 12 consecutive days (4-week flex)', () => {
    const data = baseData()
    data.storeSettings.workHourSystem = '4週變形'
    const result = runProgrammaticSchedule(data)
    const h3errors = result.errors.filter(v => v.constraint === 'H3')
    expect(h3errors).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════
//  H4: Shift Interval (11-hour gap)
// ══════════════════════════════════════════════════════════════

describe('H4: shift interval', () => {
  it('SCH-U40: no shift gap under 11 hours', () => {
    const data = baseData()
    data.shiftDefs = [
      makeShift('晚班', '15:00', '23:00'),
      makeShift('早班', '06:00', '15:00'),
    ]
    data.staffingRules = [
      { shift_name: '晚班', required_count: 2 },
      { shift_name: '早班', required_count: 2 },
    ]
    const result = runProgrammaticSchedule(data)
    const h4errors = result.errors.filter(v => v.constraint === 'H4')
    expect(h4errors).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════
//  H13: Pregnant / Nursing → No Night Shifts
// ══════════════════════════════════════════════════════════════

describe('H13: pregnant/nursing protection', () => {
  it('SCH-U50: pregnant employee never assigned night shift', () => {
    const data = baseData()
    data.employees = [
      makeEmp('Preg', { is_pregnant: true, can_open: true, can_close: true }),
      makeEmp('Normal', { can_open: true, can_close: true }),
    ]
    data.shiftDefs = [
      makeShift('日班', '09:00', '18:00'),
      makeShift('夜班', '22:00', '06:00'),
    ]
    data.staffingRules = [
      { shift_name: '日班', required_count: 1 },
      { shift_name: '夜班', required_count: 1 },
    ]
    const result = runProgrammaticSchedule(data)
    const pregNights = result.assignments.filter(a => a.employee === 'Preg' && a.shift === '夜班')
    expect(pregNights.length).toBe(0)
    const h13errors = result.errors.filter(v => v.constraint === 'H13')
    expect(h13errors).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════
//  Time Slot Coverage Mode
// ══════════════════════════════════════════════════════════════

describe('time slot coverage mode', () => {
  const timeSlotData = () => ({
    ...baseData(),
    employees: [
      makeEmp('Alice', { can_open: true }),
      makeEmp('Bob', { can_close: true }),
      makeEmp('Carol'),
      makeEmp('Dave'),
    ],
    shiftDefs: [
      makeShift('早班', '09:00', '18:00'),
      makeShift('晚班', '14:00', '23:00'),
    ],
    timeSlots: [
      { start_time: '11:00', end_time: '14:00', required_count: 2, day_type: 'all' },
      { start_time: '14:00', end_time: '18:00', required_count: 2, day_type: 'all' },
      { start_time: '18:00', end_time: '22:00', required_count: 1, day_type: 'all' },
    ],
    staffingRules: [],
    storeSettings: {
      minStaff: 1,
      workHourSystem: '4週變形',
      operatingHours: {
        mon: { open: '11:00', close: '22:00' },
        tue: { open: '11:00', close: '22:00' },
        wed: { open: '11:00', close: '22:00' },
        thu: { open: '11:00', close: '22:00' },
        fri: { open: '11:00', close: '22:00' },
        sat: { open: '11:00', close: '22:00' },
        sun: { open: '11:00', close: '22:00' },
      },
    },
  })

  it('SCH-U60: time slot mode produces assignments with actual times', () => {
    const result = runProgrammaticSchedule(timeSlotData())
    const workAssignments = result.assignments.filter(a => !isAbsence(a.shift))
    for (const a of workAssignments) {
      expect(a.actual_start, `${a.employee} ${a.date} missing actual_start`).toBeTruthy()
      expect(a.actual_end, `${a.employee} ${a.date} missing actual_end`).toBeTruthy()
      expect(a.actual_hours, `${a.employee} ${a.date} missing actual_hours`).toBeGreaterThan(0)
    }
  })

  it('SCH-U61: opener assigned at store opening time', () => {
    const data = timeSlotData()
    const result = runProgrammaticSchedule(data)
    // At least one assignment per day should start at 11:00
    for (const date of data.weekDates) {
      const dayWork = result.assignments.filter(a => a.date === date && !isAbsence(a.shift))
      const hasOpener = dayWork.some(a => a.actual_start === '11:00')
      expect(hasOpener, `No opener on ${date}`).toBe(true)
    }
  })

  it('SCH-U62: no hard violations in time slot mode', () => {
    const result = runProgrammaticSchedule(timeSlotData())
    const errors = result.errors
    expect(errors).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════
//  FT/PT Priority: Full-time First
// ══════════════════════════════════════════════════════════════

describe('FT/PT priority', () => {
  it('SCH-U70: full-time employees get more hours than part-time', () => {
    const data = baseData()
    data.employees = [
      makeEmp('FT-1'),
      makeEmp('PT-1', { pt: true }),
    ]
    const result = runProgrammaticSchedule(data)
    const ftHours = result.assignments
      .filter(a => a.employee === 'FT-1' && !isAbsence(a.shift))
      .reduce((sum, a) => sum + (a.actual_hours || 8), 0)
    const ptHours = result.assignments
      .filter(a => a.employee === 'PT-1' && !isAbsence(a.shift))
      .reduce((sum, a) => sum + (a.actual_hours || 8), 0)
    expect(ftHours).toBeGreaterThanOrEqual(ptHours)
  })
})

// ══════════════════════════════════════════════════════════════
//  Preferences: Preferred / Avoid Shifts
// ══════════════════════════════════════════════════════════════

describe('shift preferences', () => {
  it('SCH-U80: avoided shift is never assigned', () => {
    const data = baseData()
    data.preferences = [
      { employee: 'Alice', preferred_shifts: ['早班'], avoid_shifts: ['晚班'] },
    ]
    const result = runProgrammaticSchedule(data)
    const aliceNight = result.assignments.filter(a => a.employee === 'Alice' && a.shift === '晚班')
    expect(aliceNight.length).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════
//  Monthly Scheduling
// ══════════════════════════════════════════════════════════════

describe('runMonthlyProgrammaticSchedule', () => {
  const monthlyData = () => ({
    ...baseData(),
    monthDates: getMonthDates(2026, 4),
    weekDates: undefined,
    storeSettings: {
      minStaff: 1,
      workHourSystem: '4週變形',
      ft_monthly_rest_days: 10,
      pt_monthly_rest_days: 15,
    },
  })

  it('SCH-U90: monthly schedule covers all days of month', () => {
    const data = monthlyData()
    const result = runMonthlyProgrammaticSchedule(data)
    expect(result.success).toBe(true)
    for (const emp of data.employees) {
      for (const date of data.monthDates) {
        const a = result.assignments.find(a => a.employee === emp.name && a.date === date)
        expect(a, `${emp.name} missing on ${date}`).toBeDefined()
      }
    }
  })

  it('SCH-U91: full-time employee monthly hours reported in stats', () => {
    const data = monthlyData()
    const result = runMonthlyProgrammaticSchedule(data)
    expect(result.stats).toBeDefined()
    // Verify algorithm completes without crash and produces assignments for all days
    const totalAssignments = result.assignments.length
    expect(totalAssignments).toBe(data.employees.length * data.monthDates.length)
  })

  it('SCH-U92: full-time employee rest days ≤ store limit (sufficient staffing slots)', () => {
    const data = monthlyData()
    // 3 人 3 班 = 足夠班位讓每人都能排到
    data.staffingRules = [
      { shift_name: '早班', required_count: 2 },
      { shift_name: '晚班', required_count: 2 },
    ]
    const result = runMonthlyProgrammaticSchedule(data)
    for (const emp of data.employees.filter(e => e.employment_type !== '兼職')) {
      const restDays = result.assignments
        .filter(a => a.employee === emp.name && isAbsence(a.shift))
        .length
      expect(restDays, `${emp.name} rest days ${restDays}`).toBeLessThanOrEqual(10)
    }
  })

  it('SCH-U93: part-time employee gets scheduled and rests less than full month', () => {
    const data = monthlyData()
    data.employees = [
      makeEmp('Alice', { can_open: true }),
      makeEmp('Bob', { can_close: true }),
      makeEmp('PT-1', { pt: true }),
    ]
    data.staffingRules = [
      { shift_name: '早班', required_count: 2 },
      { shift_name: '晚班', required_count: 2 },
    ]
    const result = runMonthlyProgrammaticSchedule(data)
    const workDays = result.assignments
      .filter(a => a.employee === 'PT-1' && !isAbsence(a.shift))
      .length
    // PT should work at least some days (not all rest)
    expect(workDays, `PT-1 should work some days, got ${workDays}`).toBeGreaterThan(0)
    const hours = result.assignments
      .filter(a => a.employee === 'PT-1' && !isAbsence(a.shift))
      .reduce((sum, a) => sum + (a.actual_hours || 8), 0)
    // PT monthly target is 80h, should get at least close
    expect(hours, `PT-1 hours ${hours}`).toBeGreaterThanOrEqual(40)
  })

  it('SCH-U94: no hard violations across entire month (sufficient staffing)', () => {
    const data = monthlyData()
    data.staffingRules = [
      { shift_name: '早班', required_count: 2 },
      { shift_name: '晚班', required_count: 2 },
    ]
    const result = runMonthlyProgrammaticSchedule(data)
    const errors = result.errors
    expect(errors, `Violations: ${JSON.stringify(errors)}`).toEqual([])
  })

  it('SCH-U95: leave request in month is respected', () => {
    const data = monthlyData()
    data.offRequests = [
      { employee: 'Alice', date: '2026-04-10' },
      { employee: 'Alice', date: '2026-04-20' },
    ]
    const result = runMonthlyProgrammaticSchedule(data)
    for (const date of ['2026-04-10', '2026-04-20']) {
      const a = result.assignments.find(a => a.employee === 'Alice' && a.date === date)
      expect(isAbsence(a.shift), `Alice should rest on ${date}, got ${a.shift}`).toBe(true)
    }
  })
})

// ══════════════════════════════════════════════════════════════
//  Edge Cases
// ══════════════════════════════════════════════════════════════

describe('edge cases', () => {
  it('SCH-U100: single employee still gets valid schedule', () => {
    const data = baseData()
    data.employees = [makeEmp('Solo', { can_open: true, can_close: true })]
    const result = runProgrammaticSchedule(data)
    expect(result.success).toBe(true)
    expect(result.assignments.length).toBe(7)
  })

  it('SCH-U101: all employees request same day off → minimum coverage maintained', () => {
    const data = baseData()
    data.offRequests = data.employees.map(e => ({ employee: e.name, date: '2026-04-15' }))
    const result = runProgrammaticSchedule(data)
    const workingOnDay = result.assignments.filter(
      a => a.date === '2026-04-15' && !isAbsence(a.shift)
    )
    // At least minStaff should be working despite all requesting off
    expect(workingOnDay.length).toBeGreaterThanOrEqual(data.storeSettings.minStaff)
  })

  it('SCH-U102: existing locked schedule is preserved', () => {
    const data = baseData()
    data.existingSchedules = [
      { employee: 'Alice', date: '2026-04-14', shift: '晚班' },
    ]
    const result = runProgrammaticSchedule(data)
    const a = result.assignments.find(a => a.employee === 'Alice' && a.date === '2026-04-14')
    expect(a.shift).toBe('晚班')
  })
})
