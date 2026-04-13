/**
 * Humanized Programmatic Shift Scheduler
 *
 * 5-layer priority scheduling algorithm:
 *   L1  Hard legal constraints (Taiwan labor law)
 *   L2  Employee hard constraints (availability, leave, qualifications)
 *   L3  Operational requirements (minimum staffing)
 *   L4  Employee preferences (shift preference, target hours)
 *   L5  Fairness (fatigue score balancing, weekend rotation)
 *
 * Supports weekly and monthly scheduling.
 */

import {
  parseTime, getShiftHours, effectiveEndHour, isNightShift, isAbsence,
  splitIntoWeeks, isWeekendDay, getWorkSystemConstraints,
  DAILY_MAX_HOURS, MAX_CONSECUTIVE_WORK_DAYS,
  MIN_SHIFT_INTERVAL, MIN_WEEKLY_REST_DAYS, MONTHLY_OVERTIME_CAP,
  MONTHLY_REST_DAYS_TARGET,
} from './scheduleUtils'

// ══════════════════════════════════════════════════════════════
//  Fatigue Scoring
// ══════════════════════════════════════════════════════════════

const FATIGUE_POINTS = {
  weekday_morning: 1,
  weekday_evening: 2,
  weekend_morning: 2,
  weekend_evening: 3,
  holiday: 4,
}

function classifyShiftFatigue(shiftDef, dateStr, holidays = []) {
  if (holidays.includes(dateStr)) return 'holiday'
  const dow = new Date(dateStr).getDay()
  const isWeekend = isWeekendDay(dow)
  const startH = parseTime(shiftDef.start_time)
  const isMorning = startH < 15
  if (isWeekend) return isMorning ? 'weekend_morning' : 'weekend_evening'
  return isMorning ? 'weekday_morning' : 'weekday_evening'
}

function getFatiguePoints(shiftDef, dateStr, holidays = []) {
  const type = classifyShiftFatigue(shiftDef, dateStr, holidays)
  return FATIGUE_POINTS[type] || 1
}

// ══════════════════════════════════════════════════════════════
//  Main Algorithm (Weekly)
// ══════════════════════════════════════════════════════════════

export function runProgrammaticSchedule(data) {
  const {
    employees, shiftDefs, weekDates, existingSchedules, offRequests,
    preferences, storeSettings, holidays = [], fatigueScores = [],
    availability = [],
  } = data

  const staffingRules = data.staffingRules || []
  const timeSlots = data.timeSlots || []
  const minStaff = storeSettings?.minStaff || 1
  const useTimeSlotMode = timeSlots.length > 0  // 時段覆蓋制 or 班別制

  // Work system constraints (標準工時 / 4週變形 etc.)
  const workSystem = storeSettings?.workHourSystem || storeSettings?.work_hour_system || '標準工時'
  const wsConstraints = getWorkSystemConstraints(workSystem)
  // Attach to data so isLegallyValid can access it
  data._wsConstraints = wsConstraints

  // ── Build lookup maps ──
  const offMap = new Set()
  for (const o of offRequests) offMap.add(`${o.employee}_${o.date}`)

  const prefMap = {}
  for (const p of preferences) {
    prefMap[p.employee] = {
      preferred: new Set(p.preferred_shifts || []),
      avoid: new Set(p.avoid_shifts || []),
    }
  }

  // Availability: employee → day_of_week → { start, end }
  const availMap = {}
  for (const a of availability) {
    if (!availMap[a.employee]) availMap[a.employee] = {}
    availMap[a.employee][a.day_of_week] = {
      start: parseTime(a.start_time),
      end: parseTime(a.end_time),
    }
  }

  // Fatigue: employee → total_score (lower = less tired = more likely to get hard shifts)
  const fatigueMap = {}
  for (const f of fatigueScores) fatigueMap[f.employee] = f.total_score || 0

  // Staffing rules: shift_name → required_count
  const staffingMap = {}
  for (const s of staffingRules) {
    staffingMap[s.shift_name] = s.required_count || 0
  }

  // Target hours per employee — 四週變形工時（月制）
  // 月目標：正職 150-160h，兼職 80-160h
  // 每週目標根據 monthlyContext 動態計算（剩餘時數 ÷ 剩餘週數）
  const MONTHLY_FT_MIN = 150
  const MONTHLY_PT_MIN = 80
  const MONTHLY_MAX = 175  // 所有人月工時上限
  const monthlyCtx = data.monthlyContext || null  // { hoursAccumulated: {name: h}, weeksRemaining: n }

  const targetHoursMap = {}
  const hoursRange = {}
  for (const emp of employees) {
    const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT' || emp.position?.includes('PT')
    const monthMin = isPT ? MONTHLY_PT_MIN : MONTHLY_FT_MIN
    const monthMid = Math.round((monthMin + MONTHLY_MAX) / 2)  // FT: 155, PT: 120

    if (monthlyCtx) {
      // 四週變形：無每週上下限，只看月總量
      const accumulated = monthlyCtx.hoursAccumulated?.[emp.name] || 0
      const weeksLeft = (monthlyCtx.weeksRemaining || 0) + 1
      const remainTarget = Math.max(0, monthMin - accumulated)
      const remainMax = Math.max(0, MONTHLY_MAX - accumulated)
      // weekTarget 只是分配參考，不是硬限
      targetHoursMap[emp.name] = Math.round(remainTarget / weeksLeft)
      hoursRange[emp.name] = { min: 0, max: Math.round(remainMax) }  // 無週限，月底收斂
    } else {
      // Standalone weekly: 用月目標÷4.3 做參考
      targetHoursMap[emp.name] = Math.round(monthMid / 4.3)
      hoursRange[emp.name] = { min: 0, max: MONTHLY_MAX }
    }
  }

  // ── Track consecutive weekends worked ──
  // Count how many recent consecutive weekends each employee worked (from previousWeek data)
  const consecWeekends = {}
  for (const emp of employees) {
    let count = 0
    if (data.previousWeek) {
      // Check if employee worked last weekend (Fri/Sat in previous week)
      const prevWeekendWork = data.previousWeek.filter(a =>
        a.employee === emp.name && !isAbsence(a.shift) &&
        isWeekendDay(new Date(a.date).getDay())
      ).length > 0
      if (prevWeekendWork) count = 1
      // Could extend to check 2+ weeks back, but previousWeek is only 1 week
    }
    consecWeekends[emp.name] = count
  }

  // ── Init schedule grid ──
  const schedule = {}
  const actualTimes = {} // emp_date → { start, end, hours }
  for (const emp of employees) {
    schedule[emp.name] = {}
    for (const date of weekDates) {
      schedule[emp.name][date] = null
    }
  }

  // Pre-populate locked (existing) assignments
  for (const s of existingSchedules) {
    if (schedule[s.employee]?.[s.date] !== undefined) {
      schedule[s.employee][s.date] = s.shift
    }
  }

  // ── Step 1: Mark rest days ──
  const restDayPlan = {}
  for (const emp of employees) restDayPlan[emp.name] = new Set()

  // H1: Off-request = mandatory rest (but respect minimum coverage)
  for (const emp of employees) {
    for (const date of weekDates) {
      if (offMap.has(`${emp.name}_${date}`)) {
        restDayPlan[emp.name].add(date)
      }
    }
  }

  // L2: Days with no availability = rest
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

  // Calculate minimum workers needed per day (from time slots or staffing rules)
  const minWorkersPerDay = {}
  for (const date of weekDates) {
    const dow = new Date(date).getDay()
    const isWeekend = isWeekendDay(dow)
    if (useTimeSlotMode) {
      // Max concurrent requirement from time slots
      const daySlots = timeSlots.filter(s =>
        s.day_type === 'all' || (s.day_type === 'weekend' && isWeekend) || (s.day_type === 'weekday' && !isWeekend)
      )
      minWorkersPerDay[date] = Math.max(...daySlots.map(s => s.required_count), minStaff)
    } else {
      // Sum of shift staffing requirements
      const total = staffingRules.reduce((sum, r) => sum + (r.required_count || 0), 0)
      minWorkersPerDay[date] = total || minStaff
    }
  }

  // H1b: Conflict resolution — if too many people rest on the same day, override lowest-priority
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

  // 四週變形：不再按週補休，休假完全由 off_requests（希望休）決定
  // 正職月休上限 10 天，兼職彈性

  // Fill rest into schedule
  for (const emp of employees) {
    for (const date of restDayPlan[emp.name]) {
      if (!schedule[emp.name][date] || isAbsence(schedule[emp.name][date])) {
        schedule[emp.name][date] = '休'
      }
    }
  }

  // Helper: get employee's weekly hours so far (used by both modes)
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

  // ── Step 2: Sort shifts by start time ──
  const sortedShifts = [...shiftDefs].sort((a, b) => parseTime(a.start_time) - parseTime(b.start_time))

  // ══════════════════════════════════════════════════════════════
  //  TIME SLOT COVERAGE MODE (時段覆蓋制)
  // ══════════════════════════════════════════════════════════════
  if (useTimeSlotMode) {
    // ══════════════════════════════════════════════════════════════
    //  TIME SLOT COVERAGE MODE — 三階段排班
    //  Phase 1: 開店人員  Phase 2: 關店人員  Phase 3: 補滿覆蓋
    //  正職 9h gross (8h net + 1h break)，兼職 4-7h 彈性
    //  正職週時 40-48h，兼職週時 24-36h
    // ══════════════════════════════════════════════════════════════

    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

    // ── Helpers ──
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
      return `${s}-${e}`
    }

    const getOH = (date) => {
      const dow = new Date(date).getDay()
      return storeSettings?.operating_hours?.[dayNames[dow]] || storeSettings?.operatingHours?.[dayNames[dow]]
    }

    const isPTEmp = (emp) => emp.employment_type === '兼職' || emp.employment_type === 'PT' || emp.position?.includes('PT')

    // Sort: 正職先排，兼職後排，同類別按時數缺口排
    const sortByNeed = (list) => [...list].sort((a, b) => {
      const aIsPT = isPTEmp(a) ? 1 : 0
      const bIsPT = isPTEmp(b) ? 1 : 0
      if (aIsPT !== bIsPT) return aIsPT - bIsPT  // FT first
      const aDef = targetHoursMap[a.name] - getEmpWeekHours(a.name)
      const bDef = targetHoursMap[b.name] - getEmpWeekHours(b.name)
      return bDef - aDef  // higher deficit first
    })

    // ── Day-by-day assignment ──
    for (const date of weekDates) {
      const daySlots = getSlotsForDate(date)
      if (daySlots.length === 0) continue

      // ── Detect operating hours ──
      const oh = getOH(date)
      const storeOpenH = parseTime(oh?.open || daySlots[0]?.start_time || '11:00')
      const storeCloseStr = oh?.close || daySlots[daySlots.length - 1]?.end_time || '00:00'
      const storeCloseH = parseTime(storeCloseStr)
      const effectiveCloseH = storeCloseH <= storeOpenH ? storeCloseH + 24 : storeCloseH
      const maxGrossH = effectiveCloseH - storeOpenH // max shift length = store hours

      // Track slot coverage
      const slotCoverage = daySlots.map(s => ({ ...s, covered: 0 }))

      // Count locked (existing) assignments into coverage
      for (const emp of employees) {
        const s = schedule[emp.name][date]
        if (s && !isAbsence(s)) {
          const t = actualTimes[`${emp.name}_${date}`]
          if (t) slotCoverage.forEach(slot => { if (overlaps(t.start, t.end, slot.start_time, slot.end_time)) slot.covered++ })
        }
      }

      // Check if opener/closer already covered by locked schedules
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

      // Get available employees for today
      const available = employees.filter(emp =>
        !schedule[emp.name][date] && !restDayPlan[emp.name].has(date)
      )

      // ── Calculate ideal FT gross hours based on remaining work days ──
      const calcFTGross = (empName) => {
        const weekHours = getEmpWeekHours(empName)
        const range = hoursRange[empName]
        const hoursNeeded = range.min - weekHours  // net hours still needed to hit minimum
        // Count remaining work days (today + future days not resting)
        const todayIdx = weekDates.indexOf(date)
        const remainingWorkDays = weekDates.filter((d, i) =>
          i >= todayIdx && !restDayPlan[empName].has(d) && !schedule[empName][d]
        ).length || 1
        const idealNetPerDay = hoursNeeded / remainingWorkDays
        // gross = net + 1h break (for shifts ≥ 6h)
        const idealGross = Math.ceil(idealNetPerDay) + 1
        // Clamp: min 9h, max 11h, max store hours
        return Math.min(Math.max(idealGross, 9), 11, maxGrossH)
      }

      // ── Shift assignment helper: validate & create a shift window ──
      const tryShift = (emp, startH, grossH) => {
        const netH = grossH >= 6 ? grossH - 1 : (grossH >= 4 ? grossH - 0.5 : grossH)
        const endH = startH + grossH

        // Don't go past store closing
        if (endH > effectiveCloseH + 0.5) return null
        // Legal: max daily hours
        if (grossH > wsConstraints.dailyAbsoluteMax) return null
        // Weekly hours hard cap (with 2h buffer for rounding)
        const weekHours = getEmpWeekHours(emp.name)
        if (weekHours + netH > hoursRange[emp.name].max + 2) return null
        // can_open restriction: can_open=false → must start ≥ 2h after opening
        if (emp.can_open === false && startH < storeOpenH + 2) return null
        // can_close restriction: can_close=false → must end ≥ 2h before closing
        if (emp.can_close === false && endH > effectiveCloseH - 2) return null

        // H4: gap from previous day ≥ 11h
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

      // ── Assign a shift and update all tracking ──
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

      // ── Coverage scoring: how well a window fills uncovered slots ──
      const scoreCoverage = (startTime, endTime) => {
        let score = 0
        for (const slot of slotCoverage) {
          if (overlaps(startTime, endTime, slot.start_time, slot.end_time)) {
            const maxC = slot.max_count || slot.required_count + 2
            if (slot.covered >= maxC) score -= 100
            else if (slot.covered < slot.required_count) {
              score += 40
              if (slot.covered === 0) score += 30  // empty slot = most urgent
            } else {
              score += 3  // over min, under max
            }
          }
        }
        return score
      }

      // ════════════════════════════════════════════
      //  Phase 1: 開店人員 — can_open 排在營業開始
      // ════════════════════════════════════════════
      if (!hasOpener) {
        const openers = sortByNeed(
          available.filter(e => e.can_open === true && !schedule[e.name]?.[date])
        )
        for (const emp of openers) {
          const grossH = isPTEmp(emp) ? Math.min(6, maxGrossH) : calcFTGross(emp.name)
          const window = tryShift(emp, storeOpenH, grossH)
          if (window && scoreCoverage(window.start, window.end) > -50) {
            doAssign(emp, window)
            break
          }
        }
      }

      // ════════════════════════════════════════════
      //  Phase 2: 關店人員 — can_close 排到打烊
      // ════════════════════════════════════════════
      if (!hasCloser) {
        const closers = sortByNeed(
          available.filter(e => e.can_close === true && !schedule[e.name]?.[date])
        )
        for (const emp of closers) {
          const grossH = isPTEmp(emp) ? Math.min(6, maxGrossH) : calcFTGross(emp.name)
          const startH = effectiveCloseH - grossH
          if (startH < storeOpenH) continue
          const window = tryShift(emp, startH, grossH)
          if (window && scoreCoverage(window.start, window.end) > -50) {
            doAssign(emp, window)
            break
          }
        }
      }

      // ════════════════════════════════════════════
      //  Phase 3: 補滿覆蓋 — 按需求填補時段缺口
      //  正職 9-11h gross（動態），兼職 3-6h 彈性
      // ════════════════════════════════════════════
      const unassigned = sortByNeed(
        available.filter(e => !schedule[e.name]?.[date])
      )

      for (const emp of unassigned) {
        // All slots at max capacity → rest
        const allMaxMet = slotCoverage.every(s => s.covered >= (s.max_count || s.required_count + 2))
        if (allMaxMet) { schedule[emp.name][date] = '休'; continue }

        const weekHours = getEmpWeekHours(emp.name)
        const range = hoursRange[emp.name]
        const allMinMet = slotCoverage.every(s => s.covered >= s.required_count)
        const pt = isPTEmp(emp)

        // 月工時上限到了 → 必須休
        if (weekHours >= range.max) { schedule[emp.name][date] = '休'; continue }
        // 正職：能排就排（四週變形不提早休，月底收斂）
        // 兼職：達到週目標且覆蓋足夠 → 休
        if (pt && weekHours >= targetHoursMap[emp.name] && allMinMet) { schedule[emp.name][date] = '休'; continue }

        // 正職：動態計算需要的班時（9-11h gross），確保能達到月 150h
        // 兼職：縮短為 3-6h，讓正職有足夠空間
        const ftIdeal = calcFTGross(emp.name)
        const grossDurations = pt
          ? [6, 5, 4, 3].filter(h => h <= maxGrossH)
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
            if (score <= -100) continue  // would exceed max in some slot

            // Bonus: starts at first uncovered slot
            const firstUncovered = slotCoverage.find(s => s.covered < s.required_count)
            if (firstUncovered) {
              const uncovStart = parseTime(firstUncovered.start_time)
              if (Math.abs(h - uncovStart) < 1) score += 25
            }

            // 開關店加分：如果今天還沒有 opener/closer，優先排在營業頭尾
            if (!hasOpener && Math.abs(h - storeOpenH) < 0.5) score += 50
            if (!hasCloser && (h + grossH) >= effectiveCloseH - 0.5) score += 50

            // Weekly hours fit within range
            const afterHours = weekHours + window.netH
            if (afterHours >= range.min && afterHours <= range.max) score += 15  // in range: best
            else if (afterHours < range.min) score += 3                          // still below
            if (afterHours > range.max) score -= 20

            // FT below minimum: bonus for longer shifts that help reach 40h
            if (!pt && afterHours < range.min) {
              score += (window.netH - 8) * 8  // bonus per extra hour above 8h net
            }

            // Fatigue balancing
            const fatigue = fatigueMap[emp.name] || 0
            if (fatigue > 15) score -= fatigue * 0.3

            if (score > bestScore) {
              bestScore = score
              bestWindow = window
            }
          }
        }

        if (bestWindow && bestScore > -50) {
          doAssign(emp, bestWindow)
        } else {
          schedule[emp.name][date] = '休'
        }
      }
    }

    // Skip to Step 4
  } else {

  // ── Step 3: Two-pass shift assignment with conflict resolution ──
  //
  // Pass 1: Everyone picks their "想上" (preferred) shift
  //         If conflicts (more people want a shift than needed),
  //         priority decides who stays, others marked for reassignment.
  // Pass 2: Reassigned people get their "都可以" (neutral) shifts.
  //         "不可上" (blocked) shifts are never assigned.

  // Helper: check if a shift is legally and availability-wise valid for an employee
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

    // Count already-assigned (locked)
    for (const emp of employees) {
      const s = schedule[emp.name][date]
      if (s && !isAbsence(s) && shiftCounts[s] !== undefined) {
        shiftCounts[s]++
      }
    }

    // Cache weekly hours per employee (recomputed each day since prior days may have changed)
    const weekHoursCache = {}
    for (const emp of employees) {
      weekHoursCache[emp.name] = getEmpWeekHours(emp.name)
    }

    // Get unassigned employees
    const toAssign = employees.filter(emp => {
      if (schedule[emp.name][date]) return false
      if (restDayPlan[emp.name].has(date)) return false
      // If already at target hours, auto-rest
      if (weekHoursCache[emp.name] >= targetHoursMap[emp.name]) {
        schedule[emp.name][date] = '休'
        return false
      }
      return true
    })

    const dow = new Date(date).getDay()

    // ── Pass 1: Assign preferred ("想上") shifts ──
    // Collect who wants what
    const wantMap = {} // shiftName → [{ emp, priority }]
    const assigned = new Set()

    for (const emp of toAssign) {
      const pref = prefMap[emp.name]
      if (!pref?.preferred.size) continue

      for (const shiftDef of sortedShifts) {
        if (!pref.preferred.has(shiftDef.name)) continue
        if (pref.avoid.has(shiftDef.name)) continue // blocked overrides
        if (!isShiftAvailable(emp, shiftDef, date)) continue

        if (!wantMap[shiftDef.name]) wantMap[shiftDef.name] = []
        wantMap[shiftDef.name].push({
          emp,
          priority: emp.schedule_priority || 3,
          fatigue: fatigueMap[emp.name] || 0,
        })
      }
    }

    // Resolve conflicts: if more people want a shift than slots available, priority wins
    for (const shiftName of Object.keys(wantMap)) {
      const needed = staffingMap[shiftName] || minStaff
      const slotsLeft = needed - (shiftCounts[shiftName] || 0)
      if (slotsLeft <= 0) continue

      // Sort: lower priority number = higher priority, then lower fatigue
      const candidates = wantMap[shiftName].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority
        return a.fatigue - b.fatigue
      })

      // Assign top candidates (skip already-assigned, don't waste slot count)
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

    // ── Pass 2: Assign remaining employees to "都可以" (neutral) or understaffed shifts ──
    const remaining = toAssign
      .filter(emp => !assigned.has(emp.name))
      .sort((a, b) => {
        // Sort by fatigue (fairness-first for pass 2)
        const fa = fatigueMap[a.name] || 0
        const fb = fatigueMap[b.name] || 0
        return fa - fb
      })

    for (const emp of remaining) {
      if (schedule[emp.name][date]) continue

      const pref = prefMap[emp.name]
      const currentWeekHours = weekHoursCache[emp.name]
      const targetH = targetHoursMap[emp.name]
      let bestShift = null
      let bestScore = -Infinity

      for (const shiftDef of sortedShifts) {
        // Hard block: "不可上" shifts are never assigned
        if (pref?.avoid.has(shiftDef.name)) continue

        if (!isShiftAvailable(emp, shiftDef, date)) continue

        let score = 0

        // Staffing needs — required_count is both minimum AND maximum
        const needed = staffingMap[shiftDef.name] || minStaff
        const current = shiftCounts[shiftDef.name] || 0
        if (current >= needed) continue // Shift is full, don't over-staff
        const deficit = needed - current
        score += 40 + deficit * 10

        // Shift balance: prefer the shift with fewer people assigned (break ties)
        score -= current * 3

        // Preference: "想上" still gets bonus even in pass 2 (they lost conflict but still prefer it)
        if (pref?.preferred.has(shiftDef.name)) score += 15

        // Target hours
        const shiftHours = getShiftHours(shiftDef) - (shiftDef.break_minutes || 60) / 60
        const afterHours = currentWeekHours + shiftHours
        if (afterHours <= targetH) score += 15
        else if (afterHours <= targetH + 4) score += 5
        else score -= 10

        // Fairness
        const fatigue = fatigueMap[emp.name] || 0
        const fatiguePoints = getFatiguePoints(shiftDef, date, holidays)
        if (fatigue > 15) score -= fatiguePoints * 3
        if (isWeekendDay(dow) || holidays.includes(date)) {
          score -= fatigue * 0.5
          // Consecutive weekend protection: penalize if already worked 2+ consecutive weekends
          const cw = consecWeekends[emp.name] || 0
          if (cw >= 2) score -= 40 // Strong penalty: should rest this weekend
          else if (cw >= 1) score -= 15 // Moderate: try to avoid 3 in a row
        }

        if (score > bestScore) {
          bestScore = score
          bestShift = shiftDef
        }
      }

      if (bestShift) {
        schedule[emp.name][date] = bestShift.name
        actualTimes[`${emp.name}_${date}`] = {
          start: bestShift.start_time?.slice(0, 5),
          end: bestShift.end_time?.slice(0, 5),
          hours: getShiftHours(bestShift) - (bestShift.break_minutes || 60) / 60,
        }
        shiftCounts[bestShift.name] = (shiftCounts[bestShift.name] || 0) + 1
      } else {
        schedule[emp.name][date] = '休'
      }
    }
  }

  // ── Step 3b: Post-assignment fixes ──

  // Fix 1: Ensure each day has at least 1 opener and 1 closer
  for (const date of weekDates) {
    const dayAssignments = employees.filter(emp => {
      const s = schedule[emp.name][date]
      return s && !isAbsence(s)
    })

    for (const shiftDef of sortedShifts) {
      const startH = parseTime(shiftDef.start_time)
      const endH = parseTime(shiftDef.end_time)
      const isOpening = startH <= 12 // morning shift = opening
      const isClosing = endH >= 21 || endH < startH // late/cross-midnight = closing

      const scheduled = dayAssignments.filter(emp => schedule[emp.name][date] === shiftDef.name)

      if (isOpening) {
        const hasOpener = scheduled.some(emp => emp.can_open)
        if (!hasOpener && scheduled.length > 0) {
          // Try to swap: find a resting can_open employee and swap with a non-opener
          const restingOpener = employees.find(emp =>
            emp.can_open && schedule[emp.name][date] === '休' &&
            !offMap.has(`${emp.name}_${date}`) &&
            isShiftAvailable(emp, shiftDef, date)
          )
          if (restingOpener) {
            // Find the weakest non-opener to swap out
            const swapOut = scheduled.find(emp => !emp.can_open)
            if (swapOut) {
              schedule[restingOpener.name][date] = shiftDef.name
              schedule[swapOut.name][date] = '休'
              actualTimes[`${restingOpener.name}_${date}`] = actualTimes[`${swapOut.name}_${date}`]
              delete actualTimes[`${swapOut.name}_${date}`]
            }
          }
        }
      }

      if (isClosing) {
        const hasCloser = scheduled.some(emp => emp.can_close)
        if (!hasCloser && scheduled.length > 0) {
          const restingCloser = employees.find(emp =>
            emp.can_close && schedule[emp.name][date] === '休' &&
            !offMap.has(`${emp.name}_${date}`) &&
            isShiftAvailable(emp, shiftDef, date)
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
  } // end else (shift-based mode)

  // ── Step 4: Build assignments ──
  const assignments = []
  for (const emp of employees) {
    for (const date of weekDates) {
      const shift = schedule[emp.name][date] || '休'
      const times = actualTimes[`${emp.name}_${date}`]
      assignments.push({
        employee: emp.name,
        date,
        shift,
        actual_start: times?.start || null,
        actual_end: times?.end || null,
        actual_hours: times?.hours || null,
      })
    }
  }

  // ── Step 5: Validate ──
  const violations = validateResult(assignments, data)

  // ── Step 6: Compute stats ──
  const stats = computeStats(assignments, employees, shiftDefs, weekDates, holidays, targetHoursMap)

  return {
    success: true,
    assignments,
    reasoning: buildReasoning(employees, weekDates, stats),
    aiWarnings: [],
    violations,
    errors: violations.filter(v => v.severity === 'error'),
    warnings: violations.filter(v => v.severity === 'warning'),
    stats,
    meta: {
      model: 'programmatic-v2',
      mode: 'humanized',
      employeeCount: employees.length,
      totalAssignments: assignments.length,
    },
  }
}

// ══════════════════════════════════════════════════════════════
//  Monthly Programmatic Scheduler
// ══════════════════════════════════════════════════════════════

export function runMonthlyProgrammaticSchedule(data, onProgress) {
  const { monthDates, previousWeek } = data
  console.log('[Monthly] monthDates:', monthDates?.length, 'first:', monthDates?.[0], 'last:', monthDates?.[monthDates?.length - 1])
  if (!monthDates || monthDates.length === 0) {
    console.warn('[Monthly] No monthDates, falling back to weekly')
    return runProgrammaticSchedule(data)
  }

  const weeks = splitIntoWeeks(monthDates)
  console.log('[Monthly] Split into', weeks.length, 'weeks:', weeks.map(w => w[0] + '~' + w[w.length - 1]))
  const allAssignments = []
  const allViolations = []
  let lastWeekContext = previousWeek || []

  // Running fatigue accumulation within this month
  const monthFatigue = {}
  for (const emp of data.employees) monthFatigue[emp.name] = 0

  // Running hours accumulation — 四週變形用月總時數分配每週目標
  const monthHours = {}
  for (const emp of data.employees) monthHours[emp.name] = 0

  for (let i = 0; i < weeks.length; i++) {
    const weekDates = weeks[i]
    onProgress?.(`程式排班中... 第 ${i + 1}/${weeks.length} 週`)

    // Merge base fatigue + accumulated month fatigue
    const mergedFatigue = (data.fatigueScores || []).map(f => ({
      ...f,
      total_score: (f.total_score || 0) + (monthFatigue[f.employee] || 0),
    }))
    // Add employees without existing fatigue scores
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
      existingSchedules: data.existingSchedules.filter(
        s => s.date >= weekDates[0] && s.date <= weekDates[weekDates.length - 1]
      ),
      offRequests: data.offRequests.filter(
        o => o.date >= weekDates[0] && o.date <= weekDates[weekDates.length - 1]
      ),
      // 月制上下文：告訴每週排班器目前累積了多少時數、還剩幾週
      monthlyContext: {
        hoursAccumulated: { ...monthHours },
        weeksRemaining: weeks.length - i - 1,
      },
    }

    let result
    try {
      result = runProgrammaticSchedule(weekData)
    } catch (err) {
      console.error(`[Monthly] Week ${i + 1} error:`, err.message, err.stack)
      // Skip this week but continue
      continue
    }
    allAssignments.push(...result.assignments)
    allViolations.push(...result.violations)
    lastWeekContext = result.assignments

    // Accumulate hours + fatigue from this week
    for (const a of result.assignments) {
      if (!isAbsence(a.shift)) {
        const hours = a.actual_hours || 8
        monthHours[a.employee] = (monthHours[a.employee] || 0) + hours
        const def = data.shiftDefs.find(d => d.name === a.shift)
        if (def) {
          monthFatigue[a.employee] = (monthFatigue[a.employee] || 0) +
            getFatiguePoints(def, a.date, data.holidays)
        }
      }
    }
    console.log(`[Monthly] Week ${i + 1} done. Hours:`, Object.entries(monthHours).map(([n, h]) => `${n}:${h.toFixed(0)}h`).join(', '))
  }

  // Monthly validation
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
    meta: {
      model: 'programmatic-v2',
      mode: 'monthly-humanized',
      employeeCount: data.employees.length,
      totalAssignments: allAssignments.length,
      weeksProcessed: weeks.length,
      monthFatigue,
    },
  }
}

// ══════════════════════════════════════════════════════════════
//  L1: Legal Constraint Checks
// ══════════════════════════════════════════════════════════════

function isLegallyValid(emp, shiftDef, date, schedule, allShiftDefs, weekDates, data) {
  const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT' || emp.position?.includes('PT')
  const wsc = data._wsConstraints || getWorkSystemConstraints('標準工時')

  // H14: Store match
  if (shiftDef.store_id) {
    const store = data.locations?.find(l => l.name === emp.store)
    if (store && shiftDef.store_id !== store.id) {
      const additional = emp.additional_stores || []
      if (!additional.includes(shiftDef.store_id)) return false
    }
  }

  // H15: Employment type match
  if (shiftDef.employee_type && shiftDef.employee_type !== 'all') {
    if (isPT && shiftDef.employee_type !== 'pt') return false
    if (!isPT && shiftDef.employee_type === 'pt') return false
  }

  // H9: can_open / can_close — only block if EXPLICITLY set to false (not null/undefined)
  // null = not configured = allow; true = explicitly allowed; false = explicitly blocked
  const startH = parseTime(shiftDef.start_time)
  const endH = parseTime(shiftDef.end_time)
  if (startH <= 9 && emp.can_open === false) return false
  if ((endH >= 21 || endH < startH) && emp.can_close === false) return false
  // Note: when can_close is null/undefined, employee is NOT blocked from closing shifts

  // H13: Pregnant/nursing → no night shifts
  if ((emp.is_pregnant || emp.is_nursing) && isNightShift(shiftDef)) return false

  // H2: Daily hours ≤ absolute max (12h) and normal hours check
  if (getShiftHours(shiftDef) > wsc.dailyAbsoluteMax) return false

  // H3: Consecutive work days ≤ 6
  const dateIdx = weekDates.indexOf(date)
  let consec = 1
  for (let i = dateIdx - 1; i >= 0; i--) {
    const s = schedule[emp.name][weekDates[i]]
    if (s && !isAbsence(s)) consec++
    else break
  }
  // Also check previous week context (only if current date is start of week)
  if (dateIdx === 0 && data.previousWeek) {
    const prevAssignments = data.previousWeek
      .filter(a => a.employee === emp.name)
      .sort((a, b) => b.date.localeCompare(a.date))
    // Only count consecutive days that are actually adjacent to this week's start
    const weekStartDate = new Date(date)
    for (const a of prevAssignments) {
      const prevDate = new Date(a.date)
      const daysBefore = Math.round((weekStartDate - prevDate) / 86400000)
      // Must be consecutive (1 day, 2 days, etc. before week start matching consec count)
      if (daysBefore !== consec) break
      if (!isAbsence(a.shift)) consec++
      else break
    }
  }
  if (consec > MAX_CONSECUTIVE_WORK_DAYS) return false

  // H4: Cross-day shift gap ≥ 11h
  if (dateIdx > 0) {
    const prevShift = schedule[emp.name][weekDates[dateIdx - 1]]
    if (prevShift && !isAbsence(prevShift)) {
      const prevDef = allShiftDefs.find(d => d.name === prevShift)
      if (prevDef) {
        const gap = (startH + 24) - effectiveEndHour(prevDef)
        if (gap < MIN_SHIFT_INTERVAL) return false
      }
    }
  } else if (data.previousWeek) {
    // Check gap from last day of previous week
    const lastPrev = data.previousWeek
      .filter(a => a.employee === emp.name && !isAbsence(a.shift))
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    if (lastPrev) {
      const prevDef = allShiftDefs.find(d => d.name === lastPrev.shift)
      if (prevDef) {
        const gap = (startH + 24) - effectiveEndHour(prevDef)
        if (gap < MIN_SHIFT_INTERVAL) return false
      }
    }
  }

  // Check forward gap too
  if (dateIdx < weekDates.length - 1) {
    const nextShift = schedule[emp.name][weekDates[dateIdx + 1]]
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

  // 四週變形：無每週工時上限，只有月上限 160h，這裡只擋極端值
  const targetH = isPT ? 40 : 48  // 單週安全上限（不是法定限制）
  const buffer = wsc.canConcentrateRest
    ? Math.max(8, Math.round(targetH * 0.3))  // Flexible: allow more per-week variance
    : Math.max(4, Math.round(targetH * 0.15))  // Standard: tighter
  let weeklyHours = getShiftHours(shiftDef) - (shiftDef.break_minutes || 60) / 60
  for (const d of weekDates) {
    const sName = schedule[emp.name][d]
    if (!sName || isAbsence(sName)) continue
    const sDef = allShiftDefs.find(dd => dd.name === sName)
    weeklyHours += sDef ? getShiftHours(sDef) - (sDef.break_minutes || 60) / 60 : 8
  }
  if (weeklyHours > targetH + buffer) return false

  return true
}

// ══════════════════════════════════════════════════════════════
//  Post-Assignment Validation
// ══════════════════════════════════════════════════════════════

function validateResult(assignments, data) {
  const violations = []
  const { employees, shiftDefs, weekDates, offRequests, storeSettings, staffingRules = [] } = data

  const shiftDefMap = {}
  for (const d of shiftDefs) shiftDefMap[d.name] = d

  const offMap = new Set()
  for (const o of offRequests) offMap.add(`${o.employee}_${o.date}`)

  const byEmployee = {}
  for (const a of assignments) {
    if (!byEmployee[a.employee]) byEmployee[a.employee] = []
    byEmployee[a.employee].push(a)
  }

  for (const emp of employees) {
    const empAssignments = (byEmployee[emp.name] || []).sort((a, b) => a.date.localeCompare(b.date))

    // H1: Off-request
    for (const a of empAssignments) {
      if (offMap.has(`${emp.name}_${a.date}`) && !isAbsence(a.shift)) {
        violations.push({ employee: emp.name, constraint: 'H1', law: '排班規則', message: `${emp.name} 在 ${a.date} 有請假但被排班 "${a.shift}"`, severity: 'error' })
      }
    }

    const workEntries = empAssignments.filter(a => !isAbsence(a.shift))

    // H2: Daily hours
    for (const a of workEntries) {
      const def = shiftDefMap[a.shift]
      if (def && getShiftHours(def) > DAILY_MAX_HOURS) {
        violations.push({ employee: emp.name, constraint: 'H2', law: '勞基法 §32', message: `${emp.name} ${a.date}: ${getShiftHours(def).toFixed(1)}h 超過每日上限 ${DAILY_MAX_HOURS}h`, severity: 'error' })
      }
    }

    // H3: Consecutive work days
    let consec = 0
    for (const date of weekDates) {
      const a = empAssignments.find(a => a.date === date)
      if (a && !isAbsence(a.shift)) {
        consec++
        if (consec > MAX_CONSECUTIVE_WORK_DAYS) {
          violations.push({ employee: emp.name, constraint: 'H3', law: '勞基法 §36', message: `${emp.name} 連續上班 ${consec} 天（上限 ${MAX_CONSECUTIVE_WORK_DAYS} 天）`, severity: 'error' })
        }
      } else consec = 0
    }

    // H4: Cross-day shift gap
    for (let i = 0; i < weekDates.length - 1; i++) {
      const todayA = empAssignments.find(a => a.date === weekDates[i])
      const tomorrowA = empAssignments.find(a => a.date === weekDates[i + 1])
      if (!todayA || isAbsence(todayA.shift) || !tomorrowA || isAbsence(tomorrowA.shift)) continue
      const todayDef = shiftDefMap[todayA.shift]
      const tomorrowDef = shiftDefMap[tomorrowA.shift]
      if (!todayDef || !tomorrowDef) continue
      const gap = (parseTime(tomorrowDef.start_time) + 24) - effectiveEndHour(todayDef)
      if (gap < MIN_SHIFT_INTERVAL) {
        violations.push({ employee: emp.name, constraint: 'H4', law: '勞基法 §34', message: `${emp.name} ${weekDates[i]}→${weekDates[i + 1]}: 間隔 ${gap.toFixed(1)}h（需 ≥${MIN_SHIFT_INTERVAL}h）`, severity: 'error' })
      }
    }

    // H10: 四週變形不檢查每週休假，由月制 off_requests 控制

    // H13: Pregnant/nursing night shifts
    if (emp.is_pregnant || emp.is_nursing) {
      for (const a of workEntries) {
        const def = shiftDefMap[a.shift]
        if (def && isNightShift(def)) {
          violations.push({ employee: emp.name, constraint: 'H13', law: '性平法 §15', message: `${emp.name}（孕婦/哺乳）被排夜班 ${a.date}`, severity: 'error' })
        }
      }
    }
  }

  // S1: Staffing per day per shift (班別制)
  for (const date of weekDates) {
    for (const sd of shiftDefs) {
      const required = staffingRules.find(r => r.shift_name === sd.name)?.required_count || 0
      if (required <= 0) continue
      const count = assignments.filter(a => a.date === date && a.shift === sd.name).length
      if (count < required) {
        violations.push({ employee: '-', constraint: 'S1', law: '營運需求', message: `${date} ${sd.name}: ${count}/${required} 人（不足）`, severity: 'warning' })
      }
    }

    // S10: Per-time-slot coverage check (時段覆蓋制)
    const timeSlots = data.timeSlots || []
    if (timeSlots.length > 0) {
      const dow = new Date(date).getDay()
      const isWE = isWeekendDay(dow)
      const daySlots = timeSlots.filter(s =>
        s.day_type === 'all' || (s.day_type === 'weekend' && isWE) || (s.day_type === 'weekday' && !isWE)
      )
      for (const slot of daySlots) {
        const slotStart = parseTime(slot.start_time)
        const slotEnd = parseTime(slot.end_time)
        const slotEndEff = slotEnd <= slotStart ? slotEnd + 24 : slotEnd
        // Count workers whose shift overlaps this slot
        const covering = assignments.filter(a => {
          if (a.date !== date || isAbsence(a.shift)) return false
          const startH = a.actual_start ? parseTime(a.actual_start) : null
          const endH = a.actual_end ? parseTime(a.actual_end) : null
          if (startH == null || endH == null) return false
          const endEff = endH <= startH ? endH + 24 : endH
          return startH < slotEndEff && endEff > slotStart
        }).length
        if (covering < slot.required_count) {
          violations.push({
            employee: '-', constraint: 'S10', law: '營運需求',
            message: `${date} ${slot.start_time}-${slot.end_time}: ${covering}/${slot.required_count} 人（不足）`,
            severity: 'warning',
          })
        }
      }
    }

    // S8: Open/close coverage check
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const ohKey = dayNames[new Date(date).getDay()]
    const oh = storeSettings?.operating_hours?.[ohKey] || storeSettings?.operatingHours?.[ohKey]
    const storeOpenH = parseTime(oh?.open || '11:00')
    const storeCloseStr = oh?.close || '00:00'
    const storeCloseH = parseTime(storeCloseStr)
    const effectiveCloseH = storeCloseH <= storeOpenH ? storeCloseH + 24 : storeCloseH

    const dayWorkers = assignments.filter(a => a.date === date && !isAbsence(a.shift))
    if (dayWorkers.length > 0) {
      // Check opener: someone starting near store open
      const hasOpener = dayWorkers.some(a => {
        const startH = a.actual_start ? parseTime(a.actual_start) : null
        if (startH == null) return false
        return Math.abs(startH - storeOpenH) < 0.5 &&
          employees.find(e => e.name === a.employee)?.can_open
      })
      if (!hasOpener) {
        violations.push({ employee: '-', constraint: 'S8', law: '營運需求', message: `${date}: 無開店資格人員（${oh?.open || '11:00'} 開店）`, severity: 'warning' })
      }

      // Check closer: someone ending near store close
      const hasCloser = dayWorkers.some(a => {
        const startH = a.actual_start ? parseTime(a.actual_start) : null
        const endH = a.actual_end ? parseTime(a.actual_end) : null
        if (endH == null || startH == null) return false
        const effEnd = endH <= startH ? endH + 24 : endH
        return effEnd >= effectiveCloseH - 0.5 &&
          employees.find(e => e.name === a.employee)?.can_close
      })
      if (!hasCloser) {
        violations.push({ employee: '-', constraint: 'S8', law: '營運需求', message: `${date}: 無關店資格人員（${storeCloseStr} 打烊）`, severity: 'warning' })
      }
    }
  }

  return violations
}

// ══════════════════════════════════════════════════════════════
//  Monthly Validation
// ══════════════════════════════════════════════════════════════

function validateMonthlyResult(assignments, data) {
  const violations = []
  const { employees, shiftDefs, storeSettings } = data
  const wsm = getWorkSystemConstraints(storeSettings?.work_hour_system || '標準工時')

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
      totalHours += def ? getShiftHours(def) - (def.break_minutes || 60) / 60 : 8
    }
    const standardHours = workEntries.length * 8
    const overtime = Math.max(0, totalHours - standardHours)
    if (overtime > MONTHLY_OVERTIME_CAP) {
      violations.push({
        employee: emp.name, constraint: 'H6', law: '勞基法 §32',
        message: `${emp.name}: 月加班 ${overtime.toFixed(1)}h（上限 ${MONTHLY_OVERTIME_CAP}h）`,
        severity: 'error',
      })
    }

    // H11: Period total hours check (for flexible work systems)
    if (wsm.periodWeeks > 1) {
      // Check each N-week period within the month
      const weeks = splitIntoWeeks(empAssignments.map(a => a.date).sort())
      // If month has fewer weeks than period, check all available weeks as one period
      const checkPeriods = weeks.length >= wsm.periodWeeks
        ? Array.from({ length: weeks.length - wsm.periodWeeks + 1 }, (_, i) => i)
        : weeks.length > 0 ? [0] : []
      for (const i of checkPeriods) {
        const periodWeeks = weeks.slice(i, i + wsm.periodWeeks)
        const periodDates = periodWeeks.flat()
        let periodHours = 0
        for (const d of periodDates) {
          const a = workEntries.find(a => a.date === d)
          if (a) {
            const def = shiftDefMap[a.shift]
            periodHours += def ? getShiftHours(def) - (def.break_minutes || 60) / 60 : 8
          }
        }
        // Pro-rate limit for partial periods (e.g., 3 weeks of a 4-week period)
        const actualWeeks = periodWeeks.length
        const adjustedLimit = actualWeeks < wsm.periodWeeks
          ? Math.round(wsm.periodTotalHours * actualWeeks / wsm.periodWeeks)
          : wsm.periodTotalHours
        if (periodHours > adjustedLimit) {
          violations.push({
            employee: emp.name, constraint: 'H11', law: `勞基法 §30-3（${wsm.periodWeeks}週變形）`,
            message: `${emp.name}: ${actualWeeks}週工時 ${periodHours.toFixed(1)}h 超過上限 ${adjustedLimit}h`,
            severity: 'error',
          })
          break // Only report first violation
        }
      }

      // Check period rest days
      for (const i of checkPeriods) {
        const periodWeeks = weeks.slice(i, i + wsm.periodWeeks)
        const periodDates = periodWeeks.flat()
        const periodRest = periodDates.filter(d => {
          const a = empAssignments.find(a => a.date === d)
          return !a || isAbsence(a.shift)
        }).length
        const actualWeeksRest = periodWeeks.length
        const adjustedRestMin = actualWeeksRest < wsm.periodWeeks
          ? Math.round(wsm.periodRestDays * actualWeeksRest / wsm.periodWeeks)
          : wsm.periodRestDays
        if (periodRest < adjustedRestMin) {
          violations.push({
            employee: emp.name, constraint: 'H11', law: `勞基法 §30-3（${wsm.periodWeeks}週變形）`,
            message: `${emp.name}: ${actualWeeksRest}週僅 ${periodRest} 天休假（需 ≥${adjustedRestMin} 天）`,
            severity: 'error',
          })
          break
        }
      }
    }

    // S7: Monthly rest day target
    const totalDays = empAssignments.length
    const expectedRest = Math.round(totalDays * MONTHLY_REST_DAYS_TARGET / 30)
    if (restEntries.length < expectedRest - 2) {
      violations.push({
        employee: emp.name, constraint: 'S7', law: '勞動權益',
        message: `${emp.name}: 本月僅 ${restEntries.length} 天休假（建議 ${expectedRest} 天）`,
        severity: 'warning',
      })
    }

    // S5: Monthly hours check — 四週變形：正職 150-160h/月, 兼職 80-160h/月
    const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT'
    const monthlyMin = isPT ? 80 : 150
    const monthlyMax = 175
    // 按天數比例：不足整月時按比例，整月直接用原值
    const dayRatio = totalDays >= 28 ? 1 : totalDays / 30
    const proRatedMin = Math.round(monthlyMin * dayRatio)
    const proRatedMax = Math.round(monthlyMax * dayRatio)
    if (totalHours > proRatedMax) {
      violations.push({
        employee: emp.name, constraint: 'S5', law: '四週變形 ≤175h',
        message: `${emp.name}: 月工時 ${totalHours.toFixed(1)}h 超過上限 ${proRatedMax}h`,
        severity: 'warning',
      })
    }
    if (totalHours < proRatedMin && totalDays >= 7) {
      violations.push({
        employee: emp.name, constraint: 'S5', law: '四週變形',
        message: `${emp.name}: 月工時 ${totalHours.toFixed(1)}h 低於下限 ${proRatedMin}h（目標 ≥${monthlyMin}h）`,
        severity: 'warning',
      })
    }

    // S9: Consecutive weekend check
    const weeks = splitIntoWeeks(empAssignments.map(a => a.date).sort())
    let consecWE = 0
    let maxConsecWE = 0
    for (const week of weeks) {
      const workedWeekend = week.some(d => {
        const dow = new Date(d).getDay()
        if (!isWeekendDay(dow)) return false
        const a = workEntries.find(a => a.date === d)
        return !!a
      })
      if (workedWeekend) {
        consecWE++
        maxConsecWE = Math.max(maxConsecWE, consecWE)
      } else {
        consecWE = 0
      }
    }
    if (maxConsecWE >= 3) {
      violations.push({
        employee: emp.name, constraint: 'S9', law: '公平性',
        message: `${emp.name}: 連續 ${maxConsecWE} 週排假日班（建議 ≤ 2 週）`,
        severity: 'warning',
      })
    }
  }

  return violations
}

// ══════════════════════════════════════════════════════════════
//  Statistics
// ══════════════════════════════════════════════════════════════

function computeStats(assignments, employees, shiftDefs, dates, holidays, targetHoursMap) {
  const shiftDefMap = {}
  for (const d of shiftDefs) shiftDefMap[d.name] = d

  const byEmployee = {}
  for (const emp of employees) {
    const empA = assignments.filter(a => a.employee === emp.name)
    const work = empA.filter(a => !isAbsence(a.shift))
    const rest = empA.filter(a => isAbsence(a.shift))

    let totalHours = 0
    let fatigue = 0
    let weekendShifts = 0
    let eveningShifts = 0

    for (const a of work) {
      const def = shiftDefMap[a.shift]
      if (def) {
        totalHours += getShiftHours(def) - (def.break_minutes || 60) / 60
        fatigue += getFatiguePoints(def, a.date, holidays)
        const dow = new Date(a.date).getDay()
        if (isWeekendDay(dow)) weekendShifts++
        if (parseTime(def.start_time) >= 15) eveningShifts++
      }
    }

    const target = targetHoursMap[emp.name] || 40
    byEmployee[emp.name] = {
      totalHours: Math.round(totalHours * 10) / 10,
      targetHours: target,
      hoursRatio: Math.round((totalHours / target) * 100),
      workDays: work.length,
      restDays: rest.length,
      weekendShifts,
      eveningShifts,
      fatigueScore: fatigue,
    }
  }

  return { byEmployee }
}

// ══════════════════════════════════════════════════════════════
//  Reasoning
// ══════════════════════════════════════════════════════════════

function buildReasoning(employees, dates, stats) {
  const lines = [`程式排班 v2：${employees.length} 位員工 × ${dates.length} 天`]

  if (stats?.byEmployee) {
    const entries = Object.entries(stats.byEmployee)
    const avgFatigue = entries.reduce((sum, [, s]) => sum + s.fatigueScore, 0) / entries.length
    const minF = Math.min(...entries.map(([, s]) => s.fatigueScore))
    const maxF = Math.max(...entries.map(([, s]) => s.fatigueScore))
    lines.push(`辛苦度分布：平均 ${avgFatigue.toFixed(1)}、最低 ${minF}、最高 ${maxF}`)

    const overTarget = entries.filter(([, s]) => s.hoursRatio > 110).length
    const underTarget = entries.filter(([, s]) => s.hoursRatio < 80).length
    if (overTarget > 0) lines.push(`${overTarget} 人超過目標工時 110%`)
    if (underTarget > 0) lines.push(`${underTarget} 人低於目標工時 80%`)
  }

  return lines.join('。')
}
