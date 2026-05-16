/**
 * Shift Assigner
 * Handles the shift-based (non-time-slot) assignment passes, cross-store borrowing,
 * hybrid gap-fill, and post-assignment opener/closer swaps for a single week.
 */

import {
  parseTime, getShiftHours, isAbsence, countsAsMonthlyRest,
  isWeekendDay, MONTHLY_OVERTIME_CAP,
} from '../scheduleUtils'
import { getFatiguePoints } from './scoring'
import { isLegallyValid } from './validation'

/**
 * Check whether a shift is available for an employee on a given date,
 * considering legal validity and personal availability windows.
 */
export function isShiftAvailable(emp, shiftDef, date, schedule, shiftDefs, weekDates, data, availMap) {
  if (!isLegallyValid(emp, shiftDef, date, schedule, shiftDefs, weekDates, data)) return false
  const dow = new Date(date).getDay()
  const avail = availMap[emp.name]?.[dow]
  if (avail) {
    const shiftStart = parseTime(shiftDef.start_time)
    const shiftEnd = parseTime(shiftDef.end_time)
    const isCrossMidnight = shiftEnd < shiftStart
    if (avail.end > avail.start) {
      if (isCrossMidnight) { if (shiftStart < avail.start) return false }
      else { if (shiftStart < avail.start || shiftEnd > avail.end) return false }
    } else if (avail.end < avail.start || avail.end === 0) {
      if (shiftStart < avail.start) return false
      if (!isCrossMidnight && shiftEnd > 24) return false
    }
  }
  return true
}

/**
 * Run the two-pass shift assignment for all dates in shift-based (non-time-slot) mode.
 * Mutates `schedule` and `actualTimes` in place.
 *
 * @param {Object} ctx - scheduling context extracted from runProgrammaticSchedule
 */
export function runShiftBasedAssignment(ctx) {
  const {
    employees, weekDates, schedule, actualTimes,
    sortedShifts, shiftDefs, restDayPlan, offMap,
    prefMap, availMap, fatigueMap, staffingMap,
    targetHoursMap, monthRestTarget,
    minStaff, monthlyCtx, isPTEmp, getEmpWeekHours,
    consecWeekends, holidays, data,
  } = ctx

  const getMonthRestUsed = (empName) => {
    const prev = monthlyCtx?.restDaysUsed?.[empName] || 0
    const thisWeek = Object.values(schedule[empName]).filter(s => s && countsAsMonthlyRest(s)).length
    return prev + thisWeek
  }

  for (const date of weekDates) {
    const shiftCounts = {}
    for (const sd of sortedShifts) shiftCounts[sd.name] = 0

    for (const emp of employees) {
      const s = schedule[emp.name][date]
      if (s && !isAbsence(s) && shiftCounts[s] !== undefined) shiftCounts[s]++
    }

    const weekHoursCache = {}
    for (const emp of employees) weekHoursCache[emp.name] = getEmpWeekHours(emp.name)

    const toAssign = employees.filter(emp => {
      if (schedule[emp.name][date]) return false
      if (restDayPlan[emp.name].has(date)) return false
      if (weekHoursCache[emp.name] >= targetHoursMap[emp.name]) {
        const pt = isPTEmp(emp)
        if (!pt) return true
        const restLimit = monthRestTarget[emp.name] || 15
        if (getMonthRestUsed(emp.name) >= restLimit) return true
        const ftNeedMore = employees.some(e => {
          if (isPTEmp(e)) return false
          if (schedule[e.name][date]) return false
          return getMonthRestUsed(e.name) < (monthRestTarget[e.name] || 10)
        })
        if (ftNeedMore) return true
        schedule[emp.name][date] = '休'
        return false
      }
      return true
    })

    const dow = new Date(date).getDay()

    // Pass 1: Assign preferred shifts
    const wantMap = {}
    const assigned = new Set()

    for (const emp of toAssign) {
      const pref = prefMap[emp.name]
      if (!pref?.preferred.size) continue
      for (const shiftDef of sortedShifts) {
        if (!pref.preferred.has(shiftDef.name)) continue
        if (pref.avoid.has(shiftDef.name)) continue
        if (!isShiftAvailable(emp, shiftDef, date, schedule, shiftDefs, weekDates, data, availMap)) continue
        if (!wantMap[shiftDef.name]) wantMap[shiftDef.name] = []
        wantMap[shiftDef.name].push({ emp, priority: emp.schedule_priority || 3, fatigue: fatigueMap[emp.name] || 0 })
      }
    }

    for (const shiftName of Object.keys(wantMap)) {
      const needed = staffingMap[shiftName] || minStaff
      const slotsLeft = needed - (shiftCounts[shiftName] || 0)
      if (slotsLeft <= 0) continue
      const candidates = wantMap[shiftName].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority
        return a.fatigue - b.fatigue
      })
      const shiftDef = sortedShifts.find(s => s.name === shiftName)
      let filled = 0
      for (const { emp } of candidates) {
        if (filled >= slotsLeft) break
        if (assigned.has(emp.name)) continue
        schedule[emp.name][date] = shiftName
        actualTimes[`${emp.name}_${date}`] = {
          start: shiftDef?.start_time?.slice(0, 5),
          end: shiftDef?.end_time?.slice(0, 5),
          hours: shiftDef ? getShiftHours(shiftDef) - (shiftDef.break_minutes || 60) / 60 : 8,
        }
        shiftCounts[shiftName] = (shiftCounts[shiftName] || 0) + 1
        assigned.add(emp.name)
        filled++
      }
    }

    // Pass 2: Assign remaining to neutral/understaffed shifts
    const remaining = toAssign
      .filter(emp => !assigned.has(emp.name))
      .sort((a, b) => {
        const restA = getMonthRestUsed(a.name)
        const restB = getMonthRestUsed(b.name)
        if (restA !== restB) return restB - restA
        return (fatigueMap[a.name] || 0) - (fatigueMap[b.name] || 0)
      })

    for (const emp of remaining) {
      if (schedule[emp.name][date]) continue
      const pref = prefMap[emp.name]
      const currentWeekHours = weekHoursCache[emp.name]
      const targetH = targetHoursMap[emp.name]
      const empMonthRestLimit = monthRestTarget[emp.name] || 10
      const monthRestExhausted = getMonthRestUsed(emp.name) >= empMonthRestLimit

      let bestShift = null
      let bestScore = -Infinity

      for (const shiftDef of sortedShifts) {
        if (pref?.avoid.has(shiftDef.name)) continue
        if (!isShiftAvailable(emp, shiftDef, date, schedule, shiftDefs, weekDates, data, availMap)) continue
        let score = 0
        const needed = staffingMap[shiftDef.name] || minStaff
        const current = shiftCounts[shiftDef.name] || 0
        if (current >= needed) {
          if (monthRestExhausted) score -= 30
          else continue
        } else {
          score += 40 + (needed - current) * 10
        }
        score -= current * 3
        if (pref?.preferred.has(shiftDef.name)) score += 20
        else if (pref?.neutral.has(shiftDef.name)) score += 8
        if (monthRestExhausted) score += 60
        const shiftHours = getShiftHours(shiftDef) - (shiftDef.break_minutes || 60) / 60
        const afterHours = currentWeekHours + shiftHours
        if (afterHours <= targetH) score += 15
        else if (afterHours <= targetH + 4) score += 5
        else score -= 10
        const fatigue = fatigueMap[emp.name] || 0
        const fatiguePoints = getFatiguePoints(shiftDef, date, holidays)
        if (fatigue > 15) score -= fatiguePoints * 3
        if (isWeekendDay(dow) || holidays.includes(date)) {
          score -= fatigue * 0.5
          const cw = consecWeekends[emp.name] || 0
          if (cw >= 2) score -= 40
          else if (cw >= 1) score -= 15
        }
        if (score > bestScore) { bestScore = score; bestShift = shiftDef }
      }

      if (bestShift) {
        schedule[emp.name][date] = bestShift.name
        actualTimes[`${emp.name}_${date}`] = {
          start: bestShift.start_time?.slice(0, 5),
          end: bestShift.end_time?.slice(0, 5),
          hours: getShiftHours(bestShift) - (bestShift.break_minutes || 60) / 60,
        }
        shiftCounts[bestShift.name] = (shiftCounts[bestShift.name] || 0) + 1
      } else if (monthRestExhausted) {
        const fallback = sortedShifts.find(sd =>
          !(pref?.avoid.has(sd.name)) &&
          isShiftAvailable(emp, sd, date, schedule, shiftDefs, weekDates, data, availMap)
        )
        if (fallback) {
          schedule[emp.name][date] = fallback.name
          actualTimes[`${emp.name}_${date}`] = {
            start: fallback.start_time?.slice(0, 5),
            end: fallback.end_time?.slice(0, 5),
            hours: getShiftHours(fallback) - (fallback.break_minutes || 60) / 60,
          }
          shiftCounts[fallback.name] = (shiftCounts[fallback.name] || 0) + 1
        } else if (isPTEmp(emp)) schedule[emp.name][date] = '休'
      } else if (isPTEmp(emp)) schedule[emp.name][date] = '休'
    }
  }
}

/**
 * Hybrid mode: scan for hourly coverage gaps and fill them with the best-fit employee.
 * Mutates `schedule` and `actualTimes` in place.
 */
export function runHybridGapFill(ctx) {
  const {
    employees, weekDates, schedule, actualTimes,
    shiftDefs, offMap, availMap, fatigueMap,
    targetHoursMap, isPTEmp, getEmpWeekHours, data,
  } = ctx

  const storeSettings = data.storeSettings
  if (!storeSettings?.operating_hours) return

  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  for (const date of weekDates) {
    const dow = new Date(date).getDay()
    const dayKey = dayNames[dow]
    let opOpen = 9, opClose = 22
    if (storeSettings?.operating_hours?.[dayKey]) {
      const oh = storeSettings.operating_hours[dayKey]
      if (oh.open) opOpen = parseTime(oh.open)
      if (oh.close) opClose = parseTime(oh.close)
      if (opClose <= opOpen) opClose += 24
    }
    const hourlyCoverage = {}
    for (let h = Math.floor(opOpen); h < Math.ceil(opClose); h++) hourlyCoverage[h % 24] = 0
    for (const emp of employees) {
      const s = schedule[emp.name][date]
      if (!s || isAbsence(s)) continue
      const times = actualTimes[`${emp.name}_${date}`]
      if (!times?.start || !times?.end) continue
      let sh = parseTime(times.start), eh = parseTime(times.end)
      if (eh <= sh) eh += 24
      for (let h = Math.ceil(sh); h < Math.floor(eh); h++) {
        if (hourlyCoverage[h % 24] !== undefined) hourlyCoverage[h % 24]++
      }
    }
    const gaps = Object.entries(hourlyCoverage)
      .filter(([, count]) => count < (storeSettings?.minStaff || 1))
      .map(([h]) => parseInt(h)).sort((a, b) => a - b)
    if (gaps.length === 0) continue
    const windows = []
    let winStart = gaps[0], winEnd = gaps[0]
    for (let i = 1; i < gaps.length; i++) {
      if (gaps[i] === winEnd + 1) { winEnd = gaps[i] }
      else { windows.push({ start: winStart, end: winEnd + 1 }); winStart = gaps[i]; winEnd = gaps[i] }
    }
    windows.push({ start: winStart, end: winEnd + 1 })
    for (const win of windows) {
      const shiftStart = `${String(win.start).padStart(2, '0')}:00`
      const shiftEnd = `${String(win.end).padStart(2, '0')}:00`
      const shiftHours = win.end - win.start
      if (shiftHours < 3 || shiftHours > 12) continue
      const candidates = employees.filter(emp => {
        if (schedule[emp.name][date] && schedule[emp.name][date] !== '休') return false
        if (offMap.has(`${emp.name}_${date}`)) return false
        const fakeShiftDef = { name: `flex_${shiftStart}-${shiftEnd}`, start_time: shiftStart, end_time: shiftEnd }
        if (!isLegallyValid(emp, fakeShiftDef, date, schedule, shiftDefs, weekDates, data)) return false
        if (availMap[emp.name]) {
          const dayAvail = availMap[emp.name][dow]
          if (dayAvail && !(win.start >= dayAvail.start && win.end <= dayAvail.end)) return false
        }
        return true
      })
      if (candidates.length === 0) continue
      let bestEmp = null, bestScore = -Infinity
      for (const emp of candidates) {
        let score = 0
        const wh = getEmpWeekHours(emp.name)
        const target = targetHoursMap[emp.name]
        if (wh + shiftHours <= target) score += 20
        else if (wh + shiftHours <= target + 4) score += 5
        else score -= 15
        score -= (fatigueMap[emp.name] || 0) * 0.5
        const isPT = emp.employment_type === '兼職'
        if (!isPT && shiftHours >= 6) score += 10
        if (isPT && shiftHours <= 6) score += 10
        if (score > bestScore) { bestScore = score; bestEmp = emp }
      }
      if (bestEmp) {
        schedule[bestEmp.name][date] = `${shiftStart.slice(0, 5)}-${shiftEnd.slice(0, 5)}`
        actualTimes[`${bestEmp.name}_${date}`] = { start: shiftStart.slice(0, 5), end: shiftEnd.slice(0, 5), hours: shiftHours }
      }
    }
  }
}

/**
 * Cross-store borrowing: fill understaffed shifts from employees at other stores
 * who are permitted to work here. Pushes cross-store entries to `assignments`.
 * Mutates `schedule`, `actualTimes`, and `assignments` in place.
 */
export function runCrossStoreBorrowing(ctx) {
  const {
    employees, weekDates, schedule, actualTimes, assignments,
    sortedShifts, shiftDefs, staffingRules, minStaff, data,
  } = ctx

  if (!data.allStoreEmployees || data.allStoreEmployees.length === 0) return

  const localEmpNames = new Set(employees.map(e => e.name))
  const currentStoreId = data.storeSettings?.store_id || data.storeSettings?.id || null

  for (const date of weekDates) {
    const understaffedShifts = []
    for (const sd of sortedShifts) {
      const needed = staffingRules.find(r => r.shift_name === sd.name)?.required_count || minStaff
      const current = employees.filter(e => schedule[e.name]?.[date] === sd.name).length
      if (current < needed) understaffedShifts.push({ shiftDef: sd, deficit: needed - current })
    }
    if (understaffedShifts.length === 0) continue
    for (const { shiftDef: sd, deficit } of understaffedShifts) {
      let filled = 0
      const borrowable = data.allStoreEmployees.filter(emp => {
        if (localEmpNames.has(emp.name)) return false
        const additional = emp.additional_stores || []
        if (!currentStoreId || !additional.includes(currentStoreId)) return false
        if (emp._scheduledDates?.includes(date)) return false
        return true
      })
      for (const emp of borrowable) {
        if (filled >= deficit) break
        const fakeSchedule = { [emp.name]: {} }
        for (const d of weekDates) fakeSchedule[emp.name][d] = null
        if (!isLegallyValid(emp, sd, date, fakeSchedule, shiftDefs, weekDates, data)) continue
        const shiftHours = getShiftHours(sd) - (sd.break_minutes || 60) / 60
        const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT'
        if ((emp._weeklyHours || 0) + shiftHours > (isPT ? 40 : 48)) continue
        if ((emp._monthlyHours || 0) + shiftHours > MONTHLY_OVERTIME_CAP + 160) continue
        schedule[emp.name] = schedule[emp.name] || {}
        schedule[emp.name][date] = sd.name
        actualTimes[`${emp.name}_${date}`] = { start: sd.start_time?.slice(0, 5), end: sd.end_time?.slice(0, 5), hours: shiftHours }
        assignments.push({ employee: emp.name, date, shift: sd.name, actual_start: sd.start_time?.slice(0, 5), actual_end: sd.end_time?.slice(0, 5), actual_hours: shiftHours, is_cross_store: true, home_store: emp.store })
        filled++
      }
    }
  }
}

/**
 * Post-assignment fixes: ensure opening shifts have a can_open employee and
 * closing shifts have a can_close employee; swap with a resting eligible employee if needed.
 * Mutates `schedule` and `actualTimes` in place.
 */
export function runOpenerCloserFixes(ctx) {
  const {
    employees, weekDates, schedule, actualTimes,
    sortedShifts, shiftDefs, offMap, availMap, data,
  } = ctx

  for (const date of weekDates) {
    const dayAssignments = employees.filter(emp => { const s = schedule[emp.name][date]; return s && !isAbsence(s) })
    for (const shiftDef of sortedShifts) {
      const startH = parseTime(shiftDef.start_time)
      const endH = parseTime(shiftDef.end_time)
      const isOpening = startH <= 12
      const isClosing = endH >= 21 || endH < startH
      const scheduled = dayAssignments.filter(emp => schedule[emp.name][date] === shiftDef.name)
      if (isOpening && !scheduled.some(emp => emp.can_open) && scheduled.length > 0) {
        const restingOpener = employees.find(emp =>
          emp.can_open &&
          schedule[emp.name][date] === '休' &&
          !offMap.has(`${emp.name}_${date}`) &&
          isShiftAvailable(emp, shiftDef, date, schedule, shiftDefs, weekDates, data, availMap)
        )
        if (restingOpener) {
          const swapOut = scheduled.find(emp => !emp.can_open)
          if (swapOut) {
            schedule[restingOpener.name][date] = shiftDef.name
            schedule[swapOut.name][date] = '休'
            actualTimes[`${restingOpener.name}_${date}`] = actualTimes[`${swapOut.name}_${date}`]
            delete actualTimes[`${swapOut.name}_${date}`]
          }
        }
      }
      if (isClosing && !scheduled.some(emp => emp.can_close) && scheduled.length > 0) {
        const restingCloser = employees.find(emp =>
          emp.can_close &&
          schedule[emp.name][date] === '休' &&
          !offMap.has(`${emp.name}_${date}`) &&
          isShiftAvailable(emp, shiftDef, date, schedule, shiftDefs, weekDates, data, availMap)
        )
        if (restingCloser) {
          const swapOut = scheduled.find(emp => !emp.can_close)
          if (swapOut) {
            schedule[restingCloser.name][date] = shiftDef.name
            schedule[swapOut.name][date] = '休'
            actualTimes[`${restingCloser.name}_${date}`] = actualTimes[`${swapOut.name}_${date}`]
            delete actualTimes[`${swapOut.name}_${date}`]
          }
        }
      }
    }
  }
}
