/**
 * Time Slot Coverage Mode (時段覆蓋制)
 * Assigns employee shifts by covering required time slots for a single day.
 * Called by weeklyScheduleCore.js when timeSlots.length > 0.
 */

import { parseTime, isAbsence, countsAsMonthlyRest, isWeekendDay } from '../scheduleUtils'

// Re-exported so weeklyScheduleCore can use it without duplicating the logic.
export function isPTEmp(emp) {
  return emp.employment_type === '兼職' || emp.employment_type === 'PT' || emp.position?.includes('PT')
}

function fmtH(h) {
  return `${String(Math.floor(h % 24)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`
}

function fmtLabel(startTime, endTime) {
  const s = startTime.replace(':00', '').replace(/^0/, '')
  const e = endTime.replace(':00', '').replace(/^0/, '')
  return `${s}~${e}`
}

function overlaps(wStart, wEnd, sStart, sEnd) {
  const ws = parseTime(wStart), we = parseTime(wEnd)
  const ss = parseTime(sStart), se = parseTime(sEnd)
  const weEff = we <= ws ? we + 24 : we
  const seEff = se <= ss ? se + 24 : se
  return ws < seEff && weEff > ss
}

/**
 * Run the time-slot coverage assignment for all dates in the week.
 * Mutates `schedule` and `actualTimes` in place.
 *
 * @param {object} ctx - Shared scheduling context built by weeklyScheduleCore
 */
export function runTimeSlotMode(ctx) {
  const {
    employees, weekDates, timeSlots, storeSettings,
    schedule, actualTimes, restDayPlan, fatigueMap,
    targetHoursMap, hoursRange, monthlyCtx, monthTargetMap,
    monthRestTarget, wsConstraints,
  } = ctx

  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

  const getSlotsForDate = (date) => {
    const dow = new Date(date).getDay()
    const isWE = isWeekendDay(dow)
    return timeSlots.filter(s =>
      s.day_type === 'all' || (s.day_type === 'weekend' && isWE) || (s.day_type === 'weekday' && !isWE)
    ).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
  }

  const getEmpWeekHours = (empName) => {
    let h = 0
    for (const d of weekDates) {
      const s = schedule[empName][d]
      if (s && !isAbsence(s)) {
        const times = actualTimes[`${empName}_${d}`]
        if (times?.hours) h += times.hours
        else h += 8
      }
    }
    return h
  }

  const sortByNeed = (list) => [...list].sort((a, b) => {
    const aIsPT = isPTEmp(a) ? 1 : 0
    const bIsPT = isPTEmp(b) ? 1 : 0
    if (aIsPT !== bIsPT) return aIsPT - bIsPT
    const aDef = targetHoursMap[a.name] - getEmpWeekHours(a.name)
    const bDef = targetHoursMap[b.name] - getEmpWeekHours(b.name)
    return bDef - aDef
  })

  const getOH = (date) => {
    const dow = new Date(date).getDay()
    const oh = storeSettings?.operating_hours?.[dayNames[dow]] || storeSettings?.operatingHours?.[dayNames[dow]]
    if (!oh && date === weekDates[0]) {
      console.warn(`[Schedule] 營業時間讀取失敗！date=${date} dow=${dow} dayName=${dayNames[dow]}`,
        'operating_hours keys:', Object.keys(storeSettings?.operating_hours || {}),
        'operatingHours keys:', Object.keys(storeSettings?.operatingHours || {}),
        'raw operating_hours:', JSON.stringify(storeSettings?.operating_hours)?.slice(0, 200))
    }
    return oh
  }

  for (const date of weekDates) {
    const daySlots = getSlotsForDate(date)
    if (daySlots.length === 0) continue

    const oh = getOH(date)
    const storeOpenH = parseTime(oh?.open || '11:00')
    if (date === weekDates[0]) {
      console.log(`[Schedule] date=${date} oh=`, JSON.stringify(oh), `storeOpenH=${storeOpenH}`)
    }
    const storeCloseStr = oh?.close || '00:00'
    const storeCloseH = parseTime(storeCloseStr)
    const effectiveCloseH = storeCloseH <= storeOpenH ? storeCloseH + 24 : storeCloseH
    const maxGrossH = effectiveCloseH - storeOpenH

    const slotCoverage = daySlots.map(s => ({ ...s, covered: 0 }))

    for (const emp of employees) {
      const s = schedule[emp.name][date]
      if (s && !isAbsence(s)) {
        const t = actualTimes[`${emp.name}_${date}`]
        if (t) slotCoverage.forEach(slot => { if (overlaps(t.start, t.end, slot.start_time, slot.end_time)) slot.covered++ })
      }
    }

    let hasOpener = false
    let hasCloser = false
    for (const emp of employees) {
      const t = actualTimes[`${emp.name}_${date}`]
      if (!t) continue
      const tStartH = parseTime(t.start)
      if (Math.abs(tStartH - storeOpenH) < 0.5) hasOpener = true
      const tEndH = parseTime(t.end)
      const effEnd = tEndH <= tStartH ? tEndH + 24 : tEndH
      if (effEnd >= effectiveCloseH - 0.5) hasCloser = true
    }

    const available = employees.filter(emp =>
      !schedule[emp.name][date] && !restDayPlan[emp.name].has(date)
    )

    const calcFTGross = (empName) => {
      const weekHours = getEmpWeekHours(empName)
      const range = hoursRange[empName]
      const hoursNeeded = range.min - weekHours
      const todayIdx = weekDates.indexOf(date)
      const remainingWorkDays = weekDates.filter((d, i) =>
        i >= todayIdx && !restDayPlan[empName].has(d) && !schedule[empName][d]
      ).length || 1
      const idealNetPerDay = hoursNeeded / remainingWorkDays
      const idealGross = Math.ceil(idealNetPerDay) + 1
      return Math.min(Math.max(idealGross, 9), 11, maxGrossH)
    }

    const tryShift = (emp, startH, grossH) => {
      const netH = grossH >= 6 ? grossH - 1 : (grossH >= 4 ? grossH - 0.5 : grossH)
      const endH = startH + grossH
      if (startH < storeOpenH) return null
      if (endH > effectiveCloseH + 0.5) return null
      if (grossH > wsConstraints.dailyAbsoluteMax) return null
      const weekHours = getEmpWeekHours(emp.name)
      if (weekHours + netH > hoursRange[emp.name].max + 2) return null
      if (emp.can_open === false && startH < storeOpenH + 2) return null
      if (emp.can_close === false && endH > effectiveCloseH - 2) return null
      const dateIdx = weekDates.indexOf(date)
      if (dateIdx > 0) {
        const prevT = actualTimes[`${emp.name}_${weekDates[dateIdx - 1]}`]
        if (prevT) {
          const prevEndH = parseTime(prevT.end)
          const effPrevEnd = prevEndH < parseTime(prevT.start) ? prevEndH + 24 : prevEndH
          if ((startH + 24) - effPrevEnd < ctx.MIN_SHIFT_INTERVAL) return null
        }
      }
      return { start: fmtH(startH), end: fmtH(endH), netH, grossH, breakH: grossH - netH }
    }

    const doAssign = (emp, window) => {
      schedule[emp.name][date] = fmtLabel(window.start, window.end)
      actualTimes[`${emp.name}_${date}`] = { start: window.start, end: window.end, hours: window.netH }
      slotCoverage.forEach(slot => {
        if (overlaps(window.start, window.end, slot.start_time, slot.end_time)) slot.covered++
      })
      const sH = parseTime(window.start)
      const eH = parseTime(window.end)
      const effE = eH <= sH ? eH + 24 : eH
      if (Math.abs(sH - storeOpenH) < 0.5) hasOpener = true
      if (effE >= effectiveCloseH - 0.5) hasCloser = true
    }

    const scoreCoverage = (startTime, endTime) => {
      let score = 0
      for (const slot of slotCoverage) {
        if (overlaps(startTime, endTime, slot.start_time, slot.end_time)) {
          const maxC = slot.max_count || slot.required_count + 2
          if (slot.covered >= maxC) return -999
          else if (slot.covered < slot.required_count) { score += 40; if (slot.covered === 0) score += 30 }
          else score += 3
        }
      }
      return score
    }

    // Phase 1: Opener
    if (!hasOpener) {
      const openers = sortByNeed(available.filter(e => e.can_open === true && !schedule[e.name]?.[date]))
      for (const emp of openers) {
        const grossH = isPTEmp(emp) ? Math.min(6, maxGrossH) : calcFTGross(emp.name)
        const window = tryShift(emp, storeOpenH, grossH)
        if (window && scoreCoverage(window.start, window.end) > -50) { doAssign(emp, window); break }
      }
    }

    // Phase 2: Closer
    if (!hasCloser) {
      const closers = sortByNeed(available.filter(e => e.can_close === true && !schedule[e.name]?.[date]))
      for (const emp of closers) {
        const grossH = isPTEmp(emp) ? Math.min(6, maxGrossH) : calcFTGross(emp.name)
        const startH = effectiveCloseH - grossH
        if (startH < storeOpenH) continue
        const window = tryShift(emp, startH, grossH)
        if (window && scoreCoverage(window.start, window.end) > -50) { doAssign(emp, window); break }
      }
    }

    // Phase 3: Fill coverage gaps
    const unassigned = sortByNeed(available.filter(e => !schedule[e.name]?.[date]))

    for (const emp of unassigned) {
      const pt = isPTEmp(emp)
      const allMaxMet = slotCoverage.every(s => s.covered >= (s.max_count || s.required_count + 2))
      const weekHours = getEmpWeekHours(emp.name)
      const range = hoursRange[emp.name]
      const allMinMet = slotCoverage.every(s => s.covered >= s.required_count)

      if (!pt) {
        if (weekHours >= range.max) continue
      } else {
        const prevRestUsed = monthlyCtx?.restDaysUsed?.[emp.name] || 0
        const thisWeekRest = Object.values(schedule[emp.name]).filter(s => s && countsAsMonthlyRest(s)).length
        const monthRestUsed = prevRestUsed + thisWeekRest
        const monthRestLimit = monthRestTarget[emp.name] || 15

        const ftStillNeedRest = unassigned.some(e => {
          if (isPTEmp(e)) return false
          if (schedule[e.name]?.[date]) return false
          const ftPrevRest = monthlyCtx?.restDaysUsed?.[e.name] || 0
          const ftThisWeekRest = Object.values(schedule[e.name]).filter(s => s && countsAsMonthlyRest(s)).length
          const ftMonthRest = ftPrevRest + ftThisWeekRest
          return ftMonthRest < (monthRestTarget[e.name] || 10)
        })

        if (allMaxMet && monthRestUsed < monthRestLimit && !ftStillNeedRest) { schedule[emp.name][date] = '休'; continue }
        if (weekHours >= range.max) { schedule[emp.name][date] = '休'; continue }

        const monthHoursSoFar = Object.entries(actualTimes)
          .filter(([k]) => k.startsWith(emp.name + '_'))
          .reduce((s, [, v]) => s + (v?.hours || 0), 0)
        const empMonthMin = monthTargetMap[emp.name]?.min || 80
        if (monthHoursSoFar >= empMonthMin && allMinMet && monthRestUsed < monthRestLimit && !ftStillNeedRest) {
          schedule[emp.name][date] = '休'; continue
        }
      }

      const monthHrsSoFar = Object.entries(actualTimes)
        .filter(([k]) => k.startsWith(emp.name + '_'))
        .reduce((s, [, v]) => s + (v?.hours || 0), 0)
      const empMonthTarget = monthTargetMap[emp.name]?.min || (pt ? 80 : 150)
      const ftIdeal = calcFTGross(emp.name)
      const monthHoursDeficit = empMonthTarget - monthHrsSoFar
      const ptIdeal = monthHoursDeficit > 30 ? 8 : monthHoursDeficit > 15 ? 7 : 6
      const grossDurations = pt
        ? [ptIdeal, ptIdeal - 1, ptIdeal - 2, ptIdeal - 3].filter(h => h >= 3 && h <= maxGrossH)
        : (ftIdeal > 9
            ? [ftIdeal, ftIdeal - 1, 9].filter(h => h >= 9 && h <= maxGrossH)
            : [9].filter(h => h <= maxGrossH))

      let bestWindow = null
      let bestScore = -Infinity

      for (const grossH of grossDurations) {
        for (let h = storeOpenH; h <= effectiveCloseH - grossH; h++) {
          const window = tryShift(emp, h, grossH)
          if (!window) continue
          let score = scoreCoverage(window.start, window.end)
          if (score <= -100) continue
          const firstUncovered = slotCoverage.find(s => s.covered < s.required_count)
          if (firstUncovered) {
            const uncovStart = parseTime(firstUncovered.start_time)
            if (Math.abs(h - uncovStart) < 1) score += 25
          }
          if (!hasOpener && Math.abs(h - storeOpenH) < 0.5) score += 50
          if (!hasCloser && (h + grossH) >= effectiveCloseH - 0.5) score += 50
          const afterHours = weekHours + window.netH
          if (afterHours >= range.min && afterHours <= range.max) score += 15
          else if (afterHours < range.min) score += 3
          if (afterHours > range.max) score -= 20
          if (!pt && afterHours < range.min) score += (window.netH - 8) * 8
          const fatigue = fatigueMap[emp.name] || 0
          if (fatigue > 15) score -= fatigue * 0.3
          if (score > bestScore) { bestScore = score; bestWindow = window }
        }
      }

      if (bestWindow && bestScore > -50) {
        doAssign(emp, bestWindow)
      } else {
        if (!isPTEmp(emp)) { /* leave empty — FT fill handled in Step 3b of core */ }
        else schedule[emp.name][date] = '休'
      }
    }
  }
}
