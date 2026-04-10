/**
 * Programmatic Shift Scheduler (No AI)
 *
 * Deterministic constraint-satisfaction algorithm that assigns shifts.
 * Supports both weekly and monthly scheduling.
 *
 * Hard constraints:
 *   H1  Off-request → rest day
 *   H2  Daily total hours ≤ 12h
 *   H3  Max 6 consecutive work days
 *   H4  Cross-day shift gap ≥ 11h
 *   H9  can_open / can_close flags
 *   H10 Min 2 full rest days per week
 *   H13 Pregnant/nursing → no night shifts (22-06)
 *   H14 Shift must match employee store
 *   H15 PT employees only get PT-eligible shifts
 *
 * Soft constraints:
 *   S1  Min staff per day
 *   S2  Respect employee preferences
 *   S3  Fair shift distribution
 *   S5  Target ~40h/week
 *   S6  Priority employees get preferred shifts
 *   S7  Monthly rest day target (~10/month)
 */

import {
  parseTime, getShiftHours, effectiveEndHour, isNightShift, isAbsence,
  splitIntoWeeks, DAILY_MAX_HOURS, MAX_CONSECUTIVE_WORK_DAYS,
  MIN_SHIFT_INTERVAL, MIN_WEEKLY_REST_DAYS, MONTHLY_OVERTIME_CAP,
  MONTHLY_REST_DAYS_TARGET,
} from './scheduleUtils'

// ══════════════════════════════════════════════════════════════
//  Main Algorithm (Weekly)
// ══════════════════════════════════════════════════════════════

/**
 * Run the programmatic scheduler for a single week.
 * @param {Object} data - Same shape as gatherSchedulingData() output
 */
export function runProgrammaticSchedule(data) {
  const { employees, shiftDefs, weekDates, existingSchedules, offRequests, preferences, storeSettings } = data

  const minStaff = storeSettings?.minStaff || 1

  // Build lookup maps
  const offMap = {}
  for (const o of offRequests) offMap[`${o.employee}_${o.date}`] = true

  const prefMap = {}
  for (const p of preferences) {
    prefMap[p.employee] = { preferred: new Set(p.preferred_shifts || []), avoid: new Set(p.avoid_shifts || []) }
  }

  // Sort employees by priority (1=highest → gets first pick)
  const sortedEmps = [...employees].sort((a, b) => (a.schedule_priority || 3) - (b.schedule_priority || 3))

  // Track schedule: emp → date → shift name or absence
  const schedule = {}
  for (const emp of employees) {
    schedule[emp.name] = {}
    for (const date of weekDates) {
      schedule[emp.name][date] = null
    }
  }

  // Pre-populate locked assignments
  for (const s of existingSchedules) {
    if (schedule[s.employee]?.[s.date] !== undefined) {
      schedule[s.employee][s.date] = s.shift
    }
  }

  // ── Step 1: Assign rest days ──
  const restDayPlan = {}
  for (const emp of employees) {
    restDayPlan[emp.name] = new Set()
  }

  // H1: Off-request dates are mandatory rest
  for (const emp of employees) {
    for (const date of weekDates) {
      if (offMap[`${emp.name}_${date}`]) {
        restDayPlan[emp.name].add(date)
      }
    }
  }

  // H10: Ensure at least 2 rest days per week
  for (const emp of employees) {
    const rest = restDayPlan[emp.name]
    if (rest.size >= MIN_WEEKLY_REST_DAYS) continue

    const dayScores = weekDates.map((date, idx) => {
      if (rest.has(date)) return { date, score: -1 }
      if (schedule[emp.name][date] && !isAbsence(schedule[emp.name][date])) return { date, score: -1 } // locked work
      const dow = new Date(date).getDay()
      let score = 0
      if (dow === 0) score += 10
      if (dow === 6) score += 8
      if (rest.size === 0 && idx >= 4) score += 5
      if (rest.size === 1) {
        const existingIdx = weekDates.indexOf([...rest][0])
        score += Math.abs(idx - existingIdx)
      }
      return { date, score }
    }).filter(d => d.score >= 0).sort((a, b) => b.score - a.score)

    while (rest.size < MIN_WEEKLY_REST_DAYS && dayScores.length > 0) {
      rest.add(dayScores.shift().date)
    }
  }

  // Fill rest day slots
  for (const emp of employees) {
    for (const date of restDayPlan[emp.name]) {
      if (!schedule[emp.name][date] || isAbsence(schedule[emp.name][date])) {
        schedule[emp.name][date] = '休'
      }
    }
  }

  // ── Step 2: Sort shifts by start time ──
  const sortedShifts = [...shiftDefs].sort((a, b) => parseTime(a.start_time) - parseTime(b.start_time))

  // ── Step 3: Assign work shifts ──
  // For each date, pick the best shift for each unassigned employee
  for (const date of weekDates) {
    for (const emp of sortedEmps) {
      // Skip if already assigned (locked or rest)
      if (schedule[emp.name][date]) continue
      if (restDayPlan[emp.name].has(date)) continue

      // Find the best shift for this employee
      const pref = prefMap[emp.name]
      let bestShift = null
      let bestScore = -1

      for (const shiftDef of sortedShifts) {
        if (!isShiftValid(emp, shiftDef, date, schedule, shiftDefs, weekDates, data)) continue

        let score = 10 // base
        if (pref?.preferred.has(shiftDef.name)) score += 20
        if (pref?.avoid.has(shiftDef.name)) score -= 15

        // Prefer shifts that need more staff
        const currentCount = Object.values(schedule).filter(s => s[date] === shiftDef.name).length
        if (currentCount < minStaff) score += 30

        if (score > bestScore) {
          bestScore = score
          bestShift = shiftDef.name
        }
      }

      schedule[emp.name][date] = bestShift || '休'
    }
  }

  // ── Step 4: Build assignments array ──
  const assignments = []
  for (const emp of employees) {
    for (const date of weekDates) {
      assignments.push({
        employee: emp.name,
        date,
        shift: schedule[emp.name][date] || '休',
      })
    }
  }

  // ── Step 5: Validate ──
  const violations = validateResult(assignments, data)

  return {
    success: true,
    assignments,
    reasoning: `程式排班：${employees.length} 位員工 × ${weekDates.length} 天，優先滿足最低人力 ${minStaff} 人/天，每人至少 ${MIN_WEEKLY_REST_DAYS} 天休假。`,
    aiWarnings: [],
    violations,
    errors: violations.filter(v => v.severity === 'error'),
    warnings: violations.filter(v => v.severity === 'warning'),
    meta: {
      model: 'programmatic',
      mode: 'deterministic',
      employeeCount: employees.length,
      totalAssignments: assignments.length,
    },
  }
}

// ══════════════════════════════════════════════════════════════
//  Monthly Programmatic Scheduler
// ══════════════════════════════════════════════════════════════

/**
 * Run programmatic scheduling for a full month using weekly chunks.
 */
export function runMonthlyProgrammaticSchedule(data, onProgress) {
  const { monthDates, previousWeek } = data
  if (!monthDates || monthDates.length === 0) {
    return runProgrammaticSchedule(data)
  }

  const weeks = splitIntoWeeks(monthDates)
  const allAssignments = []
  const allViolations = []
  let lastWeekContext = previousWeek || []

  for (let i = 0; i < weeks.length; i++) {
    const weekDates = weeks[i]
    onProgress?.(`程式排班中... 第 ${i + 1}/${weeks.length} 週`)

    const weekData = {
      ...data,
      weekDates,
      monthDates: null,
      previousWeek: lastWeekContext,
      existingSchedules: data.existingSchedules.filter(
        s => s.date >= weekDates[0] && s.date <= weekDates[weekDates.length - 1]
      ),
      offRequests: data.offRequests.filter(
        o => o.date >= weekDates[0] && o.date <= weekDates[weekDates.length - 1]
      ),
    }

    const result = runProgrammaticSchedule(weekData)
    allAssignments.push(...result.assignments)
    allViolations.push(...result.violations)
    lastWeekContext = result.assignments
  }

  // Monthly validation
  const monthlyViolations = validateMonthlyResult(allAssignments, data)
  const combinedViolations = [...allViolations, ...monthlyViolations]

  return {
    success: true,
    assignments: allAssignments,
    reasoning: `程式月排班：${weeks.length} 週 × ${data.employees.length} 位員工`,
    aiWarnings: [],
    violations: combinedViolations,
    errors: combinedViolations.filter(v => v.severity === 'error'),
    warnings: combinedViolations.filter(v => v.severity === 'warning'),
    meta: {
      model: 'programmatic',
      mode: 'monthly-deterministic',
      employeeCount: data.employees.length,
      totalAssignments: allAssignments.length,
      weeksProcessed: weeks.length,
    },
  }
}

// ══════════════════════════════════════════════════════════════
//  Constraint Checks
// ══════════════════════════════════════════════════════════════

function isShiftValid(emp, shiftDef, date, schedule, allShiftDefs, weekDates, data) {
  const isPT = emp.position?.includes('PT') || emp.employment_type === 'PT'

  // H14: Store match
  if (shiftDef.store_id && shiftDef.store_id !== emp.store) {
    const store = data.locations?.find(l => l.name === emp.store)
    if (store && shiftDef.store_id !== store.id) return false
  }

  // H15: Employment type match
  if (shiftDef.employee_type && shiftDef.employee_type !== 'all') {
    if (isPT && shiftDef.employee_type !== 'pt') return false
    if (!isPT && shiftDef.employee_type === 'pt') return false
  }

  // H9: can_open / can_close
  const startH = parseTime(shiftDef.start_time)
  const endH = parseTime(shiftDef.end_time)
  if (startH <= 9 && emp.can_open === false) return false
  if ((endH >= 21 || endH < startH) && emp.can_close === false) return false

  // H13: Pregnant/nursing → no night shifts
  if ((emp.is_pregnant || emp.is_nursing) && isNightShift(shiftDef)) return false

  // H2: Daily hours ≤ 12h
  if (getShiftHours(shiftDef) > DAILY_MAX_HOURS) return false

  // H3: Would this create > 6 consecutive work days?
  const dateIdx = weekDates.indexOf(date)
  let consec = 1
  for (let i = dateIdx - 1; i >= 0; i--) {
    const s = schedule[emp.name][weekDates[i]]
    if (s && !isAbsence(s)) consec++
    else break
  }
  for (let i = dateIdx + 1; i < weekDates.length; i++) {
    const s = schedule[emp.name][weekDates[i]]
    if (s && !isAbsence(s)) consec++
    else break
  }
  if (consec > MAX_CONSECUTIVE_WORK_DAYS) return false

  // H4: Cross-day gap ≥ 11h
  if (dateIdx > 0) {
    const prevDate = weekDates[dateIdx - 1]
    const prevShift = schedule[emp.name][prevDate]
    if (prevShift && !isAbsence(prevShift)) {
      const prevDef = allShiftDefs.find(d => d.name === prevShift)
      if (prevDef) {
        const prevEnd = effectiveEndHour(prevDef)
        const gap = (startH + 24) - prevEnd
        if (gap < MIN_SHIFT_INTERVAL) return false
      }
    }
  }
  if (dateIdx < weekDates.length - 1) {
    const nextDate = weekDates[dateIdx + 1]
    const nextShift = schedule[emp.name][nextDate]
    if (nextShift && !isAbsence(nextShift)) {
      const nextDef = allShiftDefs.find(d => d.name === nextShift)
      if (nextDef) {
        const newEnd = effectiveEndHour(shiftDef)
        const nextStart = parseTime(nextDef.start_time)
        const gap = (nextStart + 24) - newEnd
        if (gap < MIN_SHIFT_INTERVAL) return false
      }
    }
  }

  // S5: Weekly hours soft cap (don't exceed ~48h)
  let weeklyHours = getShiftHours(shiftDef)
  for (const d of weekDates) {
    const sName = schedule[emp.name][d]
    if (!sName || isAbsence(sName)) continue
    const sDef = allShiftDefs.find(dd => dd.name === sName)
    weeklyHours += sDef ? getShiftHours(sDef) : 8
  }
  if (weeklyHours > 48) return false

  return true
}

// ══════════════════════════════════════════════════════════════
//  Post-Assignment Validation
// ══════════════════════════════════════════════════════════════

function validateResult(assignments, data) {
  const violations = []
  const { employees, shiftDefs, weekDates, offRequests, storeSettings } = data

  const shiftDefMap = {}
  for (const d of shiftDefs) shiftDefMap[d.name] = d

  const offMap = {}
  for (const o of offRequests) offMap[`${o.employee}_${o.date}`] = true

  const byEmployee = {}
  for (const a of assignments) {
    if (!byEmployee[a.employee]) byEmployee[a.employee] = []
    byEmployee[a.employee].push(a)
  }

  for (const emp of employees) {
    const empAssignments = (byEmployee[emp.name] || []).sort((a, b) => a.date.localeCompare(b.date))

    // H1: Off-request
    for (const a of empAssignments) {
      if (offMap[`${emp.name}_${a.date}`] && !isAbsence(a.shift)) {
        violations.push({ employee: emp.name, constraint: 'H1', law: '排班規則', message: `${emp.name} has off-request on ${a.date} but assigned "${a.shift}"`, severity: 'error' })
      }
    }

    // H2: Daily hours
    const workEntries = empAssignments.filter(a => !isAbsence(a.shift))
    for (const a of workEntries) {
      const def = shiftDefMap[a.shift]
      if (def && getShiftHours(def) > DAILY_MAX_HOURS) {
        violations.push({ employee: emp.name, constraint: 'H2', law: '勞基法 §32', message: `${emp.name} on ${a.date}: ${getShiftHours(def).toFixed(1)}h, max ${DAILY_MAX_HOURS}h`, severity: 'error' })
      }
    }

    // H3: Consecutive work days
    let consec = 0
    for (const date of weekDates) {
      const a = empAssignments.find(a => a.date === date)
      if (a && !isAbsence(a.shift)) {
        consec++
        if (consec > MAX_CONSECUTIVE_WORK_DAYS) {
          violations.push({ employee: emp.name, constraint: 'H3', law: '勞基法 §36', message: `${emp.name} has ${consec} consecutive work days`, severity: 'error' })
        }
      } else consec = 0
    }

    // H4: Cross-day shift gap
    for (let i = 0; i < weekDates.length - 1; i++) {
      const today = weekDates[i]
      const tomorrow = weekDates[i + 1]
      const todayA = empAssignments.find(a => a.date === today)
      const tomorrowA = empAssignments.find(a => a.date === tomorrow)
      if (!todayA || isAbsence(todayA.shift) || !tomorrowA || isAbsence(tomorrowA.shift)) continue

      const todayDef = shiftDefMap[todayA.shift]
      const tomorrowDef = shiftDefMap[tomorrowA.shift]
      if (!todayDef || !tomorrowDef) continue

      const latestEnd = effectiveEndHour(todayDef)
      const earliestStart = parseTime(tomorrowDef.start_time)
      const gap = (earliestStart + 24) - latestEnd
      if (gap < MIN_SHIFT_INTERVAL) {
        violations.push({ employee: emp.name, constraint: 'H4', law: '勞基法 §34', message: `${emp.name} ${today}→${tomorrow}: ${gap.toFixed(1)}h gap, min ${MIN_SHIFT_INTERVAL}h`, severity: 'error' })
      }
    }

    // H10: Min rest days per week
    const restDays = empAssignments.filter(a => isAbsence(a.shift)).length
    if (weekDates.length >= 7 && restDays < MIN_WEEKLY_REST_DAYS) {
      violations.push({ employee: emp.name, constraint: 'H10', law: '勞基法 §36', message: `${emp.name} only ${restDays} rest days, min ${MIN_WEEKLY_REST_DAYS}`, severity: 'error' })
    }

    // H13: Pregnant/nursing night shifts
    if (emp.is_pregnant || emp.is_nursing) {
      for (const a of workEntries) {
        const def = shiftDefMap[a.shift]
        if (def && isNightShift(def)) {
          violations.push({ employee: emp.name, constraint: 'H13', law: '性平法 §15', message: `${emp.name} (pregnant/nursing) assigned night shift on ${a.date}`, severity: 'error' })
        }
      }
    }
  }

  // S1: Staffing per day
  for (const date of weekDates) {
    const working = assignments.filter(a => a.date === date && !isAbsence(a.shift)).length
    if (working < (storeSettings?.minStaff || 1)) {
      violations.push({ employee: '-', constraint: 'S1', law: '營運需求', message: `${date}: only ${working} staff, min ${storeSettings.minStaff}`, severity: 'warning' })
    }
  }

  return violations
}

// ══════════════════════════════════════════════════════════════
//  Monthly Validation
// ══════════════════════════════════════════════════════════════

function validateMonthlyResult(assignments, data) {
  const violations = []
  const { employees, shiftDefs } = data

  const shiftDefMap = {}
  for (const d of shiftDefs) shiftDefMap[d.name] = d

  for (const emp of employees) {
    const empAssignments = assignments.filter(a => a.employee === emp.name)
    const workEntries = empAssignments.filter(a => !isAbsence(a.shift))
    const restEntries = empAssignments.filter(a => isAbsence(a.shift))

    // H6: Monthly overtime cap
    let totalHours = 0
    for (const a of workEntries) {
      const def = shiftDefMap[a.shift]
      totalHours += def ? getShiftHours(def) : 8
    }
    const standardHours = workEntries.length * 8
    const overtime = Math.max(0, totalHours - standardHours)
    if (overtime > MONTHLY_OVERTIME_CAP) {
      violations.push({
        employee: emp.name, constraint: 'H6', law: '勞基法 §32',
        message: `${emp.name}: 月加班 ${overtime.toFixed(1)}h, 上限 ${MONTHLY_OVERTIME_CAP}h`,
        severity: 'error',
      })
    }

    // S7: Monthly rest day target
    const totalDays = empAssignments.length
    const expectedRest = Math.round(totalDays * MONTHLY_REST_DAYS_TARGET / 30)
    if (restEntries.length < expectedRest - 2) {
      violations.push({
        employee: emp.name, constraint: 'S7', law: '勞動權益',
        message: `${emp.name}: 本月僅 ${restEntries.length} 天休假, 建議 ${expectedRest} 天`,
        severity: 'warning',
      })
    }
  }

  return violations
}
