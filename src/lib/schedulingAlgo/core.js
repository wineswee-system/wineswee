import {
  parseTime, getShiftHours, isAbsence, countsAsMonthlyRest,
  splitIntoWeeks, isWeekendDay, getWorkSystemConstraints,
  getCycleFor,
  MIN_SHIFT_INTERVAL, MONTHLY_OVERTIME_CAP,
} from '../scheduleUtils'
import { getFatiguePoints } from './scoring'
import { isLegallyValid, validateResult, validateMonthlyResult } from './validation'
import { computeStats, buildReasoning } from './stats'

export function runProgrammaticSchedule(data) {
  const {
    employees, shiftDefs, weekDates, existingSchedules, offRequests,
    preferences, storeSettings, holidays = [], fatigueScores = [],
    availability = [],
  } = data

  const staffingRules = data.staffingRules || []
  const timeSlots = data.timeSlots || []
  const minStaffWeekday = storeSettings?.minStaff || 1
  const minStaffWeekend = storeSettings?.minStaffWeekend || minStaffWeekday
  const minStaff = minStaffWeekday
  const useTimeSlotMode = timeSlots.length > 0

  if (shiftDefs.length === 0 && !useTimeSlotMode) {
    return {
      assignments: [],
      errors: [{ employee: '-', constraint: 'SYSTEM', severity: 'error', message: '班別定義為空，請先到「門市設定」新增班別' }],
      warnings: [],
      violations: [],
      reasoning: '無法排班：缺少班別定義',
      meta: { mode: 'shift', algorithm: 'programmatic-v2' },
    }
  }

  const workSystem = storeSettings?.workHourSystem || storeSettings?.work_hour_system || '標準工時'
  const wsConstraints = getWorkSystemConstraints(workSystem)
  data._wsConstraints = wsConstraints

  const offMap = new Set()
  for (const o of offRequests) offMap.add(`${o.employee}_${o.date}`)

  const prefMap = {}
  for (const p of preferences) {
    prefMap[p.employee] = {
      preferred: new Set(p.preferred_shifts || []),
      neutral: new Set(p.neutral_shifts || []),
      avoid: new Set(p.avoid_shifts || []),
    }
  }

  const availMap = {}
  for (const a of availability) {
    if (!availMap[a.employee]) availMap[a.employee] = {}
    availMap[a.employee][a.day_of_week] = {
      start: parseTime(a.start_time),
      end: parseTime(a.end_time),
    }
  }

  const fatigueMap = {}
  for (const f of fatigueScores) fatigueMap[f.employee] = f.total_score || 0

  const staffingMap = {}
  for (const s of staffingRules) {
    staffingMap[s.shift_name] = s.required_count || 0
  }

  const MONTHLY_FT_MIN = storeSettings?.ft_monthly_hours_min ?? 150
  const MONTHLY_PT_MIN = storeSettings?.pt_monthly_hours_min ?? 80
  const MONTHLY_FT_MAX = storeSettings?.ft_monthly_hours_max ?? 175
  const MONTHLY_PT_MAX = storeSettings?.pt_monthly_hours_max ?? 175
  const monthlyCtx = data.monthlyContext || null

  const targetHoursMap = {}
  const hoursRange = {}
  const monthTargetMap = {}
  const monthRestTarget = {}
  for (const emp of employees) {
    const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT' || emp.position?.includes('PT')
    const monthMin = isPT ? MONTHLY_PT_MIN : MONTHLY_FT_MIN
    // personal_hour_cap (個人 cycle 時數上限) 蓋過店面預設
    const monthMax = emp.personal_hour_cap != null
      ? Math.min(emp.personal_hour_cap, isPT ? MONTHLY_PT_MAX : MONTHLY_FT_MAX)
      : (isPT ? MONTHLY_PT_MAX : MONTHLY_FT_MAX)
    monthTargetMap[emp.name] = { min: monthMin, max: monthMax, isPT, personalCap: emp.personal_hour_cap }
    if (isPT) {
      const ptRestLimit = storeSettings?.pt_monthly_rest_days ?? 20
      const weeklyH = emp.weekly_target_hours || 20
      const avgShiftH = 6
      const workDaysPerMonth = Math.round(Math.ceil(weeklyH / avgShiftH) * 4.3)
      monthRestTarget[emp.name] = Math.min(ptRestLimit, Math.max(8, 30 - workDaysPerMonth))
    } else {
      monthRestTarget[emp.name] = storeSettings?.ft_monthly_rest_days ?? 10
    }

    const accumulated = monthlyCtx?.hoursAccumulated?.[emp.name] || 0
    const weeksLeft = Math.max((monthlyCtx?.weeksRemaining || 0) + 1, 1)
    const remainTarget = Math.max(0, monthMin - accumulated)
    const remainMax = Math.max(0, monthMax - accumulated)
    targetHoursMap[emp.name] = Math.round(remainTarget / weeksLeft)
    hoursRange[emp.name] = { min: 0, max: Math.round(remainMax / weeksLeft) + 8 }
  }

  const consecWeekends = {}
  for (const emp of employees) {
    let count = 0
    if (data.previousWeek) {
      const prevWeekendWork = data.previousWeek.filter(a =>
        a.employee === emp.name && !isAbsence(a.shift) &&
        isWeekendDay(new Date(a.date).getDay())
      ).length > 0
      if (prevWeekendWork) count = 1
    }
    consecWeekends[emp.name] = count
  }

  const schedule = {}
  const actualTimes = {}
  for (const emp of employees) {
    schedule[emp.name] = {}
    for (const date of weekDates) schedule[emp.name][date] = null
  }

  for (const s of existingSchedules) {
    if (schedule[s.employee]?.[s.date] !== undefined) {
      schedule[s.employee][s.date] = s.shift
    }
  }

  // ── Step 1: Mark rest days ──
  const restDayPlan = {}
  for (const emp of employees) restDayPlan[emp.name] = new Set()

  for (const emp of employees) {
    for (const date of weekDates) {
      if (offMap.has(`${emp.name}_${date}`)) restDayPlan[emp.name].add(date)
    }
  }

  for (const emp of employees) {
    for (const date of weekDates) {
      if (restDayPlan[emp.name].has(date)) continue
      const dow = new Date(date).getDay()
      const avail = availMap[emp.name]
      if (avail && Object.keys(avail).length > 0 && !avail[dow]) {
        restDayPlan[emp.name].add(date)
      }
    }
  }

  const minWorkersPerDay = {}
  for (const date of weekDates) {
    const dow = new Date(date).getDay()
    const isWeekend = isWeekendDay(dow)
    const dayMinStaff = isWeekend ? minStaffWeekend : minStaffWeekday
    if (useTimeSlotMode) {
      const daySlots = timeSlots.filter(s =>
        s.day_type === 'all' || (s.day_type === 'weekend' && isWeekend) || (s.day_type === 'weekday' && !isWeekend)
      )
      minWorkersPerDay[date] = Math.max(...daySlots.map(s => s.required_count), dayMinStaff)
    } else {
      const total = staffingRules.reduce((sum, r) => sum + (r.required_count || 0), 0)
      minWorkersPerDay[date] = total || dayMinStaff
    }
  }

  for (const date of weekDates) {
    const restingOnDay = employees.filter(e => restDayPlan[e.name].has(date))
    const needed = minWorkersPerDay[date] || minStaff
    const working = employees.length - restingOnDay.length
    if (working < needed && restingOnDay.length > 0) {
      const removable = restingOnDay
        .filter(e => offMap.has(`${e.name}_${date}`))
        .sort((a, b) => {
          const aIsPT = a.employment_type === '兼職' || a.employment_type === 'PT' ? 0 : 1
          const bIsPT = b.employment_type === '兼職' || b.employment_type === 'PT' ? 0 : 1
          if (aIsPT !== bIsPT) return aIsPT - bIsPT
          return (b.schedule_priority || 3) - (a.schedule_priority || 3)
        })
      let toRemove = needed - working
      for (const emp of removable) {
        if (toRemove <= 0) break
        restDayPlan[emp.name].delete(date)
        toRemove--
      }
    }
  }

  // ── Step 1c: 主動分配休假 ──
  const getMonthRestRemaining = (empName) => {
    const isPT = monthTargetMap[empName]?.isPT
    const target = monthRestTarget[empName] || 10
    const thisWeekUsed = weekDates.filter(d => restDayPlan[empName].has(d)).length
    if (monthlyCtx) {
      const prevUsed = monthlyCtx.restDaysUsed?.[empName] || 0
      const monthRemaining = Math.max(0, target - prevUsed - thisWeekUsed)
      if (!isPT) {
        const weeksLeft = (monthlyCtx.weeksRemaining ?? 0) + 1
        const avgPerWeek = Math.ceil((target - prevUsed) / weeksLeft)
        return Math.min(monthRemaining, Math.max(0, avgPerWeek - thisWeekUsed))
      }
      return monthRemaining
    }
    const weeklyTarget = Math.ceil(target / 4)
    return Math.max(0, weeklyTarget - thisWeekUsed)
  }

  const ftFirstOrder = [...employees].sort((a, b) => {
    const aIsPT = monthTargetMap[a.name]?.isPT ? 1 : 0
    const bIsPT = monthTargetMap[b.name]?.isPT ? 1 : 0
    return aIsPT - bIsPT
  })

  for (const emp of ftFirstOrder) {
    const remaining = getMonthRestRemaining(emp.name)
    if (remaining <= 0) continue
    const candidates = weekDates
      .filter(d => !restDayPlan[emp.name].has(d) && !schedule[emp.name][d])
      .map(d => ({ date: d, demand: minWorkersPerDay[d] || minStaff }))
      .sort((a, b) => a.demand - b.demand)
    let needed = remaining
    for (const c of candidates) {
      if (needed <= 0) break
      const restingOnDay = employees.filter(e => restDayPlan[e.name].has(c.date)).length
      const workingAfter = employees.length - restingOnDay - 1
      if (workingAfter < (minWorkersPerDay[c.date] || minStaff)) continue
      restDayPlan[emp.name].add(c.date)
      needed--
    }
  }

  const maxMinWorkers = Math.max(...weekDates.map(d => minWorkersPerDay[d] || minStaff))
  if (employees.length > maxMinWorkers) {
    for (const emp of ftFirstOrder) {
      const isPT = monthTargetMap[emp.name]?.isPT
      if (isPT) continue
      const remaining = getMonthRestRemaining(emp.name)
      if (remaining <= 0) continue
      const candidates = weekDates
        .filter(d => !restDayPlan[emp.name].has(d) && !schedule[emp.name][d])
        .map(d => ({ date: d, demand: minWorkersPerDay[d] || minStaff }))
        .sort((a, b) => a.demand - b.demand)
      let needed = remaining
      for (const c of candidates) {
        if (needed <= 0) break
        const restingOnDay = employees.filter(e => restDayPlan[e.name].has(c.date)).length
        const workingAfter = employees.length - restingOnDay - 1
        if (workingAfter < Math.max(1, (minWorkersPerDay[c.date] || minStaff) - 1)) continue
        restDayPlan[emp.name].add(c.date)
        needed--
      }
    }
  }

  for (const emp of employees) {
    for (const date of restDayPlan[emp.name]) {
      if (!schedule[emp.name][date] || isAbsence(schedule[emp.name][date])) {
        schedule[emp.name][date] = '休'
      }
    }
  }

  const getEmpWeekHours = (empName) => {
    let h = 0
    for (const d of weekDates) {
      const s = schedule[empName][d]
      if (s && !isAbsence(s)) {
        const times = actualTimes[`${empName}_${d}`]
        if (times?.hours) h += times.hours
        else {
          const def = shiftDefs.find(sd => sd.name === s)
          h += def ? getShiftHours(def) - (def.break_minutes || 60) / 60 : 8
        }
      }
    }
    return h
  }

  const isPTEmp = (emp) => emp.employment_type === '兼職' || emp.employment_type === 'PT' || emp.position?.includes('PT')

  // ── Step 2: Sort shifts by start time ──
  const sortedShifts = [...shiftDefs].sort((a, b) => parseTime(a.start_time) - parseTime(b.start_time))

  if (useTimeSlotMode) {
    // ══════════════════════════════════════════════════════════════
    //  TIME SLOT COVERAGE MODE (時段覆蓋制)
    // ══════════════════════════════════════════════════════════════
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

    const getSlotsForDate = (date) => {
      const dow = new Date(date).getDay()
      const isWE = isWeekendDay(dow)
      return timeSlots.filter(s =>
        s.day_type === 'all' || (s.day_type === 'weekend' && isWE) || (s.day_type === 'weekday' && !isWE)
      ).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
    }

    const overlaps = (wStart, wEnd, sStart, sEnd) => {
      const ws = parseTime(wStart), we = parseTime(wEnd)
      const ss = parseTime(sStart), se = parseTime(sEnd)
      const weEff = we <= ws ? we + 24 : we
      const seEff = se <= ss ? se + 24 : se
      return ws < seEff && weEff > ss
    }

    const fmtH = (h) => `${String(Math.floor(h % 24)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`

    const fmtLabel = (startTime, endTime) => {
      const s = startTime.replace(':00', '').replace(/^0/, '')
      const e = endTime.replace(':00', '').replace(/^0/, '')
      return `${s}~${e}`
    }

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

    const sortByNeed = (list) => [...list].sort((a, b) => {
      const aIsPT = isPTEmp(a) ? 1 : 0
      const bIsPT = isPTEmp(b) ? 1 : 0
      if (aIsPT !== bIsPT) return aIsPT - bIsPT
      const aDef = targetHoursMap[a.name] - getEmpWeekHours(a.name)
      const bDef = targetHoursMap[b.name] - getEmpWeekHours(b.name)
      return bDef - aDef
    })

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
            if ((startH + 24) - effPrevEnd < MIN_SHIFT_INTERVAL) return null
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

      // Phase 1: 開店人員
      if (!hasOpener) {
        const openers = sortByNeed(available.filter(e => e.can_open === true && !schedule[e.name]?.[date]))
        for (const emp of openers) {
          const grossH = isPTEmp(emp) ? Math.min(6, maxGrossH) : calcFTGross(emp.name)
          const window = tryShift(emp, storeOpenH, grossH)
          if (window && scoreCoverage(window.start, window.end) > -50) { doAssign(emp, window); break }
        }
      }

      // Phase 2: 關店人員
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

      // Phase 3: 補滿覆蓋
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

          const monthHoursSoFar = Object.entries(actualTimes).filter(([k]) => k.startsWith(emp.name + '_')).reduce((s, [, v]) => s + (v?.hours || 0), 0)
          const empMonthMin = monthTargetMap[emp.name]?.min || 80
          if (monthHoursSoFar >= empMonthMin && allMinMet && monthRestUsed < monthRestLimit && !ftStillNeedRest) {
            schedule[emp.name][date] = '休'; continue
          }
        }

        const monthHrsSoFar = Object.entries(actualTimes).filter(([k]) => k.startsWith(emp.name + '_')).reduce((s, [, v]) => s + (v?.hours || 0), 0)
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
          if (!isPTEmp(emp)) { /* 不休，留空 */ }
          else schedule[emp.name][date] = '休'
        }
      }
    }

  } else {

  // ── Step 3: Two-pass shift assignment ──
  const isShiftAvailable = (emp, shiftDef, date) => {
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

  for (const date of weekDates) {
    const shiftCounts = {}
    for (const sd of sortedShifts) shiftCounts[sd.name] = 0

    for (const emp of employees) {
      const s = schedule[emp.name][date]
      if (s && !isAbsence(s) && shiftCounts[s] !== undefined) shiftCounts[s]++
    }

    const weekHoursCache = {}
    for (const emp of employees) weekHoursCache[emp.name] = getEmpWeekHours(emp.name)

    const getMonthRestUsed = (empName) => {
      const prev = monthlyCtx?.restDaysUsed?.[empName] || 0
      const thisWeek = Object.values(schedule[empName]).filter(s => s && countsAsMonthlyRest(s)).length
      return prev + thisWeek
    }

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
        if (!isShiftAvailable(emp, shiftDef, date)) continue
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
        if (!isShiftAvailable(emp, shiftDef, date)) continue
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
        const fallback = sortedShifts.find(sd => !(pref?.avoid.has(sd.name)) && isShiftAvailable(emp, sd, date))
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

  // ── Step 3a: Hybrid Mode — 彈性補班 ──
  if (storeSettings?.operating_hours || timeSlots.length > 0) {
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

  // ── Step 3c: Cross-store borrowing ──
  // assignments declared here (not at Step 4) so push() below is in scope.
  const assignments = []
  if (data.allStoreEmployees && data.allStoreEmployees.length > 0) {
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

  // ── Step 3b: Post-assignment fixes ──
  for (const date of weekDates) {
    const dayAssignments = employees.filter(emp => { const s = schedule[emp.name][date]; return s && !isAbsence(s) })
    for (const shiftDef of sortedShifts) {
      const startH = parseTime(shiftDef.start_time)
      const endH = parseTime(shiftDef.end_time)
      const isOpening = startH <= 12
      const isClosing = endH >= 21 || endH < startH
      const scheduled = dayAssignments.filter(emp => schedule[emp.name][date] === shiftDef.name)
      if (isOpening && !scheduled.some(emp => emp.can_open) && scheduled.length > 0) {
        const restingOpener = employees.find(emp => emp.can_open && schedule[emp.name][date] === '休' && !offMap.has(`${emp.name}_${date}`) && isShiftAvailable(emp, shiftDef, date))
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
        const restingCloser = employees.find(emp => emp.can_close && schedule[emp.name][date] === '休' && !offMap.has(`${emp.name}_${date}`) && isShiftAvailable(emp, shiftDef, date))
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
  } // end else (shift-based mode)

  // ── Step 3b: Fill unassigned FT cells ──
  for (const emp of employees) {
    if (isPTEmp(emp)) continue
    for (const date of weekDates) {
      if (schedule[emp.name][date]) continue
      if (restDayPlan[emp.name].has(date)) continue
      const dow = new Date(date).getDay()
      const isWeekend = isWeekendDay(dow)
      const eligible = sortedShifts.filter(sd => {
        if (sd.employee_type && sd.employee_type !== 'all' && sd.employee_type !== 'full_time') return false
        if (sd.day_type === 'weekday' && isWeekend) return false
        if (sd.day_type === 'weekend' && !isWeekend) return false
        if (getShiftHours(sd) > wsConstraints.dailyAbsoluteMax) return false
        return true
      })
      if (eligible.length > 0) {
        const sd = eligible[0]
        schedule[emp.name][date] = sd.name
        actualTimes[`${emp.name}_${date}`] = { start: sd.start_time?.slice(0, 5), end: sd.end_time?.slice(0, 5), hours: getShiftHours(sd) - (sd.break_minutes || 60) / 60 }
      }
    }
  }

  // ── Step 4: Build assignments ──
  for (const emp of employees) {
    for (const date of weekDates) {
      const shift = schedule[emp.name][date] || '休'
      const times = actualTimes[`${emp.name}_${date}`]
      assignments.push({ employee: emp.name, date, shift, actual_start: times?.start || null, actual_end: times?.end || null, actual_hours: times?.hours || null })
    }
  }

  const violations = validateResult(assignments, data)
  const stats = computeStats(assignments, employees, shiftDefs, weekDates, holidays, targetHoursMap)
  const errors = violations.filter(v => v.severity === 'error')
  const warnings = violations.filter(v => v.severity === 'warning')
  const hasUncoveredSlots = warnings.some(v => v.constraint === 'S1' || v.constraint === 'S10')
  const hasOpenerCloserGap = warnings.some(v => v.constraint === 'S8')

  return {
    success: true,
    status: 'draft',
    assignments,
    reasoning: buildReasoning(employees, weekDates, stats),
    aiWarnings: [],
    violations,
    errors,
    warnings,
    publishChecklist: [
      { check: '無違規', passed: errors.length === 0 },
      { check: '所有班次有覆蓋', passed: !hasUncoveredSlots },
      { check: '開店/關店人員到位', passed: !hasOpenerCloserGap },
    ],
    stats,
    meta: { model: 'programmatic-v2', mode: 'humanized', employeeCount: employees.length, totalAssignments: assignments.length },
  }
}

export function runMonthlyProgrammaticSchedule(data, onProgress) {
  const { monthDates, previousWeek } = data
  console.log('[Monthly] monthDates:', monthDates?.length, 'first:', monthDates?.[0], 'last:', monthDates?.[monthDates?.length - 1])
  if (!monthDates || monthDates.length === 0) {
    console.warn('[Monthly] No monthDates, falling back to weekly')
    return runProgrammaticSchedule(data)
  }

  const weeks = splitIntoWeeks(monthDates)
  console.log('[Monthly] Split into', weeks.length, 'weeks:', weeks.map(w => w[0] + '~' + w[w.length - 1]))

  // ── Cycle-aware mode detection ──
  // 變形工時 + 有 anchor → 改成「按 cycle 累積/重置時數」而非按月
  // 演算法核心邏輯不變，只是 monthHours/monthRestDays 在跨 cycle 時 reset
  const ws = data.storeSettings?.work_hour_system || '標準工時'
  const anchor = data.storeSettings?.variable_period_start || null
  const isCycleMode = ws !== '標準工時' && !!anchor
  // 每週對應的 cycleIndex（標準工時時都填 0，視為單一 cycle）
  // 用「該週工作日數較多的那個 cycle」做歸屬，避免錯置
  const weekCycleIdx = weeks.map(w => {
    if (!isCycleMode) return 0
    const counts = {}
    for (const date of w) {
      const idx = getCycleFor(date, ws, anchor).cycleIndex
      counts[idx] = (counts[idx] || 0) + 1
    }
    let bestIdx = -1, bestCount = 0
    for (const [idx, count] of Object.entries(counts)) {
      if (count > bestCount) { bestIdx = parseInt(idx); bestCount = count }
    }
    if (Object.keys(counts).length > 1) {
      console.warn(`[Monthly] Week ${w[0]}~${w[w.length-1]} 跨 cycle 邊界 (cycle ${Object.keys(counts).join(', ')}); 歸屬 cycle ${bestIdx}（多數天落點）。建議 anchor 設在週首日 (Sun) 以對齊。`)
    }
    return bestIdx
  })
  if (isCycleMode) {
    console.log('[Monthly] Cycle-aware mode:', ws, 'anchor=', anchor)
    console.log('[Monthly] Week→cycle:', weekCycleIdx)
  }

  const allAssignments = []
  const allViolations = []
  let lastWeekContext = previousWeek || []

  const monthFatigue = {}
  const monthHours = {}
  const monthRestDays = {}
  for (const emp of data.employees) {
    monthFatigue[emp.name] = 0
    monthHours[emp.name] = 0
    monthRestDays[emp.name] = 0
  }

  for (let i = 0; i < weeks.length; i++) {
    const weekDates = weeks[i]
    onProgress?.(`程式排班中... 第 ${i + 1}/${weeks.length} 週`)

    // Cycle 切換時 reset 累積（換新 cycle = 清零重算 168h cap）
    if (isCycleMode && i > 0 && weekCycleIdx[i] !== weekCycleIdx[i - 1]) {
      console.log(`[Monthly] Week ${i + 1}: entering new cycle ${weekCycleIdx[i]}, resetting accumulators`)
      for (const emp of data.employees) {
        monthHours[emp.name] = 0
        monthRestDays[emp.name] = 0
      }
    }

    const mergedFatigue = (data.fatigueScores || []).map(f => ({
      ...f,
      total_score: (f.total_score || 0) + (monthFatigue[f.employee] || 0),
    }))
    for (const emp of data.employees) {
      if (!mergedFatigue.find(f => f.employee === emp.name)) {
        mergedFatigue.push({ employee: emp.name, total_score: monthFatigue[emp.name] || 0 })
      }
    }

    const weekData = {
      ...data,
      weekDates,
      monthDates: null,
      previousWeek: lastWeekContext,
      fatigueScores: mergedFatigue,
      existingSchedules: data.existingSchedules.filter(s => s.date >= weekDates[0] && s.date <= weekDates[weekDates.length - 1]),
      offRequests: data.offRequests.filter(o => o.date >= weekDates[0] && o.date <= weekDates[weekDates.length - 1]),
      monthlyContext: {
        hoursAccumulated: { ...monthHours },
        restDaysUsed: { ...monthRestDays },
        // weeksRemaining 改成 cycle-aware：cycle 內還剩幾週（不含本週）
        weeksRemaining: isCycleMode
          ? weekCycleIdx.slice(i + 1).filter(c => c === weekCycleIdx[i]).length
          : (weeks.length - i - 1),
      },
    }

    let result
    try {
      result = runProgrammaticSchedule(weekData)
    } catch (err) {
      console.error(`[Monthly] Week ${i + 1} error:`, err.message, err.stack)
      continue
    }
    allAssignments.push(...result.assignments)
    allViolations.push(...result.violations)
    lastWeekContext = result.assignments

    for (const a of result.assignments) {
      if (isAbsence(a.shift)) {
        // 只有公司給的休 (休/補休) 才算進月休配額
        // 員工請的假 (特休/病/產等) 不算 → 不影響月休天數
        if (countsAsMonthlyRest(a.shift)) {
          monthRestDays[a.employee] = (monthRestDays[a.employee] || 0) + 1
        }
      } else {
        monthHours[a.employee] = (monthHours[a.employee] || 0) + (a.actual_hours || 8)
        const def = data.shiftDefs.find(d => d.name === a.shift)
        if (def) monthFatigue[a.employee] = (monthFatigue[a.employee] || 0) + getFatiguePoints(def, a.date, data.holidays)
      }
    }
    console.log(`[Monthly] Week ${i + 1} done. Hours:`, Object.entries(monthHours).map(([n, h]) => `${n}:${h.toFixed(0)}h`).join(', '))
  }

  // ── 最終校正：月休強制精確到目標天數 ──
  for (const emp of data.employees) {
    const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT' || emp.position?.includes('PT')
    const target = isPT ? (data.storeSettings?.pt_monthly_rest_days ?? 20) : (data.storeSettings?.ft_monthly_rest_days ?? 10)
    const empAssignments = allAssignments.filter(a => a.employee === emp.name)
    const restAssignments = empAssignments.filter(a => isAbsence(a.shift))
    const excess = restAssignments.length - target
    if (excess > 0) {
      const offSet = new Set(data.offRequests.map(o => `${o.employee}_${o.date}`))
      const convertible = restAssignments.filter(a => !offSet.has(`${a.employee}_${a.date}`))
      const sortedByNeed = [...convertible].sort((a, b) => {
        const aW = allAssignments.filter(x => x.date === a.date && !isAbsence(x.shift)).length
        const bW = allAssignments.filter(x => x.date === b.date && !isAbsence(x.shift)).length
        return aW - bW
      })
      const toFix = Math.min(excess, sortedByNeed.length)
      for (let i = 0; i < toFix; i++) {
        const ra = sortedByNeed[i]
        const empType = isPT ? 'PT' : 'FT'
        const eligible = data.shiftDefs.filter(sd => {
          if (sd.employee_type && sd.employee_type !== 'all') {
            if ((sd.employee_type === '正職' ? 'FT' : 'PT') !== empType) return false
          }
          return true
        })
        const picked = eligible[0] || data.shiftDefs[0]
        if (picked) {
          ra.shift = picked.name
          ra.actual_start = picked.start_time?.slice(0, 5) || '11:00'
          ra.actual_end = picked.end_time?.slice(0, 5) || '20:00'
          ra.actual_hours = getShiftHours(picked) - (picked.break_minutes || 60) / 60
        }
      }
    }
  }

  const monthlyViolations = validateMonthlyResult(allAssignments, data)
  const combinedViolations = [...allViolations, ...monthlyViolations]
  const stats = computeStats(
    allAssignments, data.employees, data.shiftDefs,
    monthDates, data.holidays || [],
    Object.fromEntries(data.employees.map(e => [e.name, e.weekly_target_hours || 40]))
  )

  return {
    success: true,
    assignments: allAssignments,
    reasoning: `程式月排班：${weeks.length} 週 × ${data.employees.length} 位員工`,
    aiWarnings: [],
    violations: combinedViolations,
    errors: combinedViolations.filter(v => v.severity === 'error'),
    warnings: combinedViolations.filter(v => v.severity === 'warning'),
    stats,
    meta: { model: 'programmatic-v2', mode: 'monthly-humanized', employeeCount: data.employees.length, totalAssignments: allAssignments.length, weeksProcessed: weeks.length, monthFatigue },
  }
}
