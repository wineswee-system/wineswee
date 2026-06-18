/**
 * Real-time schedule validation for manual edits.
 *
 * Checks a single cell change against labor law constraints
 * BEFORE saving, and returns warnings/errors.
 */

import {
  parseTime, getShiftHours, getNetWorkHours, effectiveEndHour, isNightShift, isAbsence,
  getWorkSystemConstraints,
  DAILY_MAX_SPAN_HOURS, MAX_CONSECUTIVE_WORK_DAYS, MIN_SHIFT_INTERVAL, MIN_WEEKLY_REST_DAYS,
} from './scheduleUtils'

/**
 * Validate a proposed shift change for one employee on one date.
 * @returns {{ ok: boolean, warnings: string[], errors: string[] }}
 */
export function validateShiftChange({
  empName, date, newShift, employees, schedules, shiftDefs, weekDates,
  workHourSystem,
}) {
  const errors = []
  const warnings = []
  const wsc = getWorkSystemConstraints(workHourSystem || '標準工時')

  if (!newShift || isAbsence(newShift)) {
    return { ok: true, warnings: [], errors: [] }
  }

  const emp = employees.find(e => e.name === empName)
  if (!emp) return { ok: true, warnings: [], errors: [] }

  const shiftDef = shiftDefs.find(d => d.name === newShift)
  if (!shiftDef) return { ok: true, warnings: [], errors: [] }

  const shiftDefMap = {}
  for (const d of shiftDefs) shiftDefMap[d.name] = d

  // Build a simulated schedule with the proposed change
  const getShiftForDate = (d) => {
    if (d === date) return newShift
    const s = schedules.find(s => s.employee === empName && s.date === d)
    return s?.shift || null
  }

  // H2: 單日排班上限 11h（10 工作 + 1 休息）
  const hours = getShiftHours(shiftDef)
  if (hours > DAILY_MAX_SPAN_HOURS) {
    errors.push(`單日工時 ${hours.toFixed(1)}h 超過上限 ${DAILY_MAX_SPAN_HOURS}h（10 工作 + 1 休息）`)
  }

  // H3: Consecutive work days ≤ 6
  const dateIdx = weekDates.indexOf(date)
  if (dateIdx >= 0) {
    let consec = 1
    // Count backward
    for (let i = dateIdx - 1; i >= 0; i--) {
      const s = getShiftForDate(weekDates[i])
      if (s && !isAbsence(s)) consec++
      else break
    }
    // Count forward
    for (let i = dateIdx + 1; i < weekDates.length; i++) {
      const s = getShiftForDate(weekDates[i])
      if (s && !isAbsence(s)) consec++
      else break
    }
    if (consec > MAX_CONSECUTIVE_WORK_DAYS) {
      errors.push(`連續上班 ${consec} 天，超過上限 ${MAX_CONSECUTIVE_WORK_DAYS} 天（勞基法 §36）`)
    }
  }

  // H4: Cross-day shift gap ≥ 11h
  if (dateIdx > 0) {
    const prevShift = getShiftForDate(weekDates[dateIdx - 1])
    if (prevShift && !isAbsence(prevShift)) {
      const prevDef = shiftDefMap[prevShift]
      if (prevDef) {
        const gap = (parseTime(shiftDef.start_time) + 24) - effectiveEndHour(prevDef)
        if (gap < MIN_SHIFT_INTERVAL) {
          errors.push(`與前一天間隔僅 ${gap.toFixed(1)}h，需 ≥${MIN_SHIFT_INTERVAL}h（勞基法 §34）`)
        }
      }
    }
  }
  if (dateIdx < weekDates.length - 1) {
    const nextShift = getShiftForDate(weekDates[dateIdx + 1])
    if (nextShift && !isAbsence(nextShift)) {
      const nextDef = shiftDefMap[nextShift]
      if (nextDef) {
        const gap = (parseTime(nextDef.start_time) + 24) - effectiveEndHour(shiftDef)
        if (gap < MIN_SHIFT_INTERVAL) {
          errors.push(`與隔天間隔僅 ${gap.toFixed(1)}h，需 ≥${MIN_SHIFT_INTERVAL}h（勞基法 §34）`)
        }
      }
    }
  }

  // H10: Check if this change would reduce rest days below minimum
  if (dateIdx >= 0) {
    let restCount = 0
    for (const d of weekDates) {
      const s = getShiftForDate(d)
      if (!s || isAbsence(s)) restCount++
    }
    if (weekDates.length >= 7 && restCount < wsc.weeklyRestMin) {
      errors.push(`本週僅剩 ${restCount} 天休假，需 ≥${wsc.weeklyRestMin} 天（勞基法 §36）`)
    }
  }

  // H13: Pregnant/nursing night shift
  if ((emp.is_pregnant || emp.is_nursing) && isNightShift(shiftDef)) {
    errors.push(`${empName} 為孕婦/哺乳員工，不得排夜班（性平法 §15）`)
  }

  // H9: can_open / can_close
  const startH = parseTime(shiftDef.start_time)
  const endH = parseTime(shiftDef.end_time)
  if (startH <= 9 && emp.can_open === false) {
    warnings.push(`${empName} 無開店資格，但被排到開店班`)
  }
  if ((endH >= 21 || endH < startH) && emp.can_close === false) {
    warnings.push(`${empName} 無關店資格，但被排到關店班`)
  }

  // Weekly hours warning
  let weeklyHours = getNetWorkHours(shiftDef)
  for (const d of weekDates) {
    if (d === date) continue
    const s = getShiftForDate(d)
    if (s && !isAbsence(s)) {
      const def = shiftDefMap[s]
      weeklyHours += def ? getNetWorkHours(def) : 8
    }
  }
  const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT'
  const target = emp.weekly_target_hours || (isPT ? 20 : 40)
  if (weeklyHours > target * 1.2) {
    warnings.push(`本週工時 ${weeklyHours.toFixed(1)}h 超過目標 ${target}h 的 120%`)
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors,
  }
}
