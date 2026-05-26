import { describe, it, expect } from 'vitest'
import { validateResult } from '../schedulingAlgo/validation.js'

describe('S10 cover logic (5/15 場景 — 2 人 cover 11-14 應 pass)', () => {
  it('two employees cover 11-14, required=2, should NOT warn', () => {
    const assignments = [
      { employee: '吳恩齊', date: '2026-05-15', shift: '休', actual_start: null, actual_end: null },
      { employee: '周佳霖', date: '2026-05-15', shift: '11~20', actual_start: '11:00', actual_end: '20:00', actual_hours: 8 },
      { employee: '施怡廷', date: '2026-05-15', shift: '16~1', actual_start: '16:00', actual_end: '01:00', actual_hours: 8 },
      { employee: '王竣禾', date: '2026-05-15', shift: '11~17', actual_start: '11:00', actual_end: '17:00', actual_hours: 5 },
      { employee: '詹怡理', date: '2026-05-15', shift: '16~1', actual_start: '16:00', actual_end: '01:00', actual_hours: 8 },
      { employee: '阮玉安', date: '2026-05-15', shift: '休', actual_start: null, actual_end: null },
    ]
    const data = {
      employees: assignments.map(a => ({ name: a.employee, employment_type: '正職' })),
      shiftDefs: [],
      weekDates: ['2026-05-15'],
      offRequests: [],
      storeSettings: { work_hour_system: '標準工時', operating_hours: { fri: { open: '11:00', close: '01:00' } } },
      staffingRules: [],
      timeSlots: [
        { start_time: '11:00:00', end_time: '14:00:00', required_count: 2, day_type: 'weekday' },
      ],
    }
    const violations = validateResult(assignments, data)
    const s10 = violations.filter(v => v.constraint === 'S10')
    console.log('S10 violations:', s10)
    expect(s10).toHaveLength(0)
  })

  it('with duplicate slot (req=2 + req=1), still 2 cover, no warn', () => {
    const assignments = [
      { employee: '周佳霖', date: '2026-05-15', shift: '11~20', actual_start: '11:00', actual_end: '20:00', actual_hours: 8 },
      { employee: '王竣禾', date: '2026-05-15', shift: '11~17', actual_start: '11:00', actual_end: '17:00', actual_hours: 5 },
    ]
    const data = {
      employees: assignments.map(a => ({ name: a.employee, employment_type: '正職' })),
      shiftDefs: [],
      weekDates: ['2026-05-15'],
      offRequests: [],
      storeSettings: { work_hour_system: '標準工時', operating_hours: { fri: { open: '11:00', close: '01:00' } } },
      staffingRules: [],
      timeSlots: [
        { id: 1, start_time: '11:00:00', end_time: '14:00:00', required_count: 2, day_type: 'weekday' },
        { id: 2, start_time: '11:00:00', end_time: '14:00:00', required_count: 1, day_type: 'weekday' },
      ],
    }
    const violations = validateResult(assignments, data)
    const s10 = violations.filter(v => v.constraint === 'S10')
    console.log('S10 with duplicate slots:', s10)
    expect(s10).toHaveLength(0)
  })
})
