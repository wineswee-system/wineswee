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

  // Target weekly hours per employee
  const targetHoursMap = {}
  for (const emp of employees) {
    const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT' || emp.position?.includes('PT')
    // Use explicit target if set AND reasonable, otherwise use type-based default
    const dbTarget = emp.weekly_target_hours
    targetHoursMap[emp.name] = (isPT && (!dbTarget || dbTarget >= 40)) ? 30 : (dbTarget || 48)
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

  // H1: Off-request = mandatory rest
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

  // H10: Ensure minimum rest days per week (varies by work system)
  // BUT also ensure every day has enough workers (no store closure)
  const weeklyRestMin = wsConstraints.weeklyRestMin
  for (const emp of employees) {
    const rest = restDayPlan[emp.name]
    if (rest.size >= weeklyRestMin) continue

    // Count how many people are already resting per day
    const restCountByDay = {}
    for (const date of weekDates) {
      restCountByDay[date] = 0
      for (const e of employees) {
        if (restDayPlan[e.name].has(date)) restCountByDay[date]++
      }
    }

    // Score candidate rest days
    const candidates = weekDates
      .map((date, idx) => {
        if (rest.has(date)) return null
        if (schedule[emp.name][date] && !isAbsence(schedule[emp.name][date])) return null

        // Check: would this rest day leave too few workers?
        const workersIfRest = employees.length - restCountByDay[date] - 1
        const needed = minWorkersPerDay[date] || minStaff
        if (workersIfRest < needed) return null // Can't rest on this day — not enough coverage

        const dow = new Date(date).getDay()
        let score = 0
        // Restaurants: weekends are busiest, slightly prefer resting on weekdays
        if (dow >= 1 && dow <= 4) score += 3
        if (dow === 5 || dow === 6) score -= 2
        // STRONG: spread rest days evenly — heavily penalize days where others already rest
        score -= restCountByDay[date] * 15
        // Spread rest days apart
        if (rest.size === 1) {
          const existingIdx = weekDates.indexOf([...rest][0])
          score += Math.abs(idx - existingIdx)
        }
        // If high fatigue, give rest on busy days
        const fatigue = fatigueMap[emp.name] || 0
        if (fatigue > 20) score += 3
        return { date, score }
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)

    while (rest.size < weeklyRestMin && candidates.length > 0) {
      rest.add(candidates.shift().date)
    }
  }

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
    //  TIME SLOT COVERAGE MODE — 完整重寫
    // ══════════════════════════════════════════════════════════════

    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

    // Helpers
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

    // Get operating hours for a date
    const getOH = (date) => {
      const dow = new Date(date).getDay()
      return storeSettings?.operating_hours?.[dayNames[dow]] || storeSettings?.operatingHours?.[dayNames[dow]]
    }

    // ── Day-by-day assignment ──
    for (const date of weekDates) {
      const daySlots = getSlotsForDate(date)
      if (daySlots.length === 0) continue

      const oh = getOH(date)
      const storeOpenH = parseTime(oh?.open || daySlots[0]?.start_time || '11:00')
      const storeCloseStr = oh?.close || daySlots[daySlots.length - 1]?.end_time || '00:00'
      const storeCloseH = parseTime(storeCloseStr)
      const effectiveCloseH = storeCloseH <= storeOpenH ? storeCloseH + 24 : storeCloseH

      // Track coverage
      const slotCoverage = daySlots.map(s => ({ ...s, covered: 0 }))

      // Count locked assignments
      for (const emp of employees) {
        const s = schedule[emp.name][date]
        if (s && !isAbsence(s)) {
          const t = actualTimes[`${emp.name}_${date}`]
          if (t) slotCoverage.forEach(slot => { if (overlaps(t.start, t.end, slot.start_time, slot.end_time)) slot.covered++ })
        }
      }

      // Generate all possible start hours
      const startHours = []
      for (let h = storeOpenH; h <= effectiveCloseH - 3; h++) {
        startHours.push(fmtH(h))
      }

      // Get available employees
      const available = employees.filter(emp =>
        !schedule[emp.name][date] && !restDayPlan[emp.name].has(date)
      )

      // Sort: full-time first (they anchor the schedule), then by who needs more hours
      available.sort((a, b) => {
        const aIsPT = a.employment_type === '兼職' || a.employment_type === 'PT'
        const bIsPT = b.employment_type === '兼職' || b.employment_type === 'PT'
        if (aIsPT !== bIsPT) return aIsPT ? 1 : -1 // Full-time first
        const aH = getEmpWeekHours(a.name), bH = getEmpWeekHours(b.name)
        const aRem = targetHoursMap[a.name] - aH, bRem = targetHoursMap[b.name] - bH
        return bRem - aRem // More remaining hours = higher priority
      })

      for (const emp of available) {
        if (schedule[emp.name][date]) continue

        // All slots covered (min met) AND no more room (max met)?
        const allMinMet = slotCoverage.every(s => s.covered >= s.required_count)
        const allMaxMet = slotCoverage.every(s => s.covered >= (s.max_count || s.required_count + 2))
        if (allMinMet && allMaxMet) { schedule[emp.name][date] = '休'; continue }

        const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT'
        const weekHours = getEmpWeekHours(emp.name)
        const targetH = targetHoursMap[emp.name]

        // If over target AND all minimum covered → rest
        if (weekHours >= targetH && allMinMet) { schedule[emp.name][date] = '休'; continue }

        // Determine shift duration (NET hours, excluding break)
        // Full-time: 8h net (9h gross with 1h break)
        // Part-time: flexible, fill what's needed
        const netDurations = isPT
          ? [7, 6, 5, 4, 3]
          : [8]

        let bestWindow = null
        let bestScore = -Infinity

        for (const startTime of startHours) {
          const startH = parseTime(startTime)

          // can_open check: only employees with can_open can start at store opening
          if (emp.can_open === false && Math.abs(startH - storeOpenH) < 0.5) continue

          for (const netH of netDurations) {
            const breakH = netH >= 6 ? 1 : (netH >= 4 ? 0.5 : 0)
            const grossH = netH + breakH
            const endH = startH + grossH
            const endTime = fmtH(endH)

            // can_close check: only employees with can_close can end at store closing
            if (emp.can_close === false && endH >= effectiveCloseH - 0.5) continue

            // Legal: max daily hours
            if (grossH > wsConstraints.dailyAbsoluteMax) continue

            // Don't go past store closing
            if (endH > effectiveCloseH + 0.5) continue

            // H4: gap from previous day
            const dateIdx = weekDates.indexOf(date)
            if (dateIdx > 0) {
              const prevT = actualTimes[`${emp.name}_${weekDates[dateIdx - 1]}`]
              if (prevT) {
                const prevEndH = parseTime(prevT.end)
                const effPrevEnd = prevEndH < parseTime(prevT.start) ? prevEndH + 24 : prevEndH
                if ((startH + 24) - effPrevEnd < MIN_SHIFT_INTERVAL) continue
              }
            }

            // Score this window
            let score = 0
            let anyUnderMin = false

            for (const slot of slotCoverage) {
              if (overlaps(startTime, endTime, slot.start_time, slot.end_time)) {
                const maxC = slot.max_count || slot.required_count + 2
                if (slot.covered >= maxC) { score -= 100; break } // Would exceed max

                if (slot.covered < slot.required_count) {
                  score += 40 // Under minimum — critical
                  anyUnderMin = true
                  if (slot.covered === 0) score += 30 // Empty slot — most critical
                } else {
                  score += 3 // Over minimum, under max — OK but low priority
                }
              }
            }

            // If nothing needs coverage and employee is over target → skip
            if (!anyUnderMin && weekHours >= targetH) continue

            // Prefer windows that start at the earliest uncovered slot
            const firstUncovered = slotCoverage.find(s => s.covered < s.required_count)
            if (firstUncovered) {
              const uncovStart = parseTime(firstUncovered.start_time)
              if (Math.abs(startH - uncovStart) < 0.5) score += 25 // Starts at the gap
            }

            // Target hours fit
            if (weekHours + netH <= targetH) score += 10
            else if (weekHours + netH <= targetH * 1.15) score += 3
            else score -= 5

            if (score > bestScore) {
              bestScore = score
              bestWindow = { start: startTime, end: endTime, netH, grossH, breakH }
            }
          }
        }

        if (bestWindow && bestScore > -50) {
          schedule[emp.name][date] = fmtLabel(bestWindow.start, bestWindow.end)
          actualTimes[`${emp.name}_${date}`] = { start: bestWindow.start, end: bestWindow.end, hours: bestWindow.netH }

          // Update coverage
          slotCoverage.forEach(slot => {
            if (overlaps(bestWindow.start, bestWindow.end, slot.start_time, slot.end_time)) slot.covered++
          })
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

    // Accumulate fatigue from this week
    for (const a of result.assignments) {
      if (!isAbsence(a.shift)) {
        const def = data.shiftDefs.find(d => d.name === a.shift)
        if (def) {
          monthFatigue[a.employee] = (monthFatigue[a.employee] || 0) +
            getFatiguePoints(def, a.date, data.holidays)
        }
      }
    }
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

  // Weekly hours soft cap — buffer scales with target (20% of target, min 4h)
  // For flexible work systems (4週變形), weekly cap is looser since hours balance across period
  const targetH = emp.weekly_target_hours || (isPT ? 20 : 40)
  const buffer = wsc.canConcentrateRest
    ? Math.max(8, Math.round(targetH * 0.3))  // Flexible: allow more per-week variance
    : Math.max(4, Math.round(targetH * 0.2))  // Standard: tighter
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

    // H10: Min rest days per week (adjusted for work system)
    const wsVal = getWorkSystemConstraints(storeSettings?.work_hour_system || '標準工時')
    const restDays = empAssignments.filter(a => isAbsence(a.shift)).length
    if (weekDates.length >= 7 && restDays < wsVal.weeklyRestMin) {
      violations.push({ employee: emp.name, constraint: 'H10', law: '勞基法 §36', message: `${emp.name} 僅 ${restDays} 天休假（需 ≥${wsVal.weeklyRestMin} 天）`, severity: 'error' })
    }

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

  // S1: Staffing per day per shift
  for (const date of weekDates) {
    for (const sd of shiftDefs) {
      const required = staffingRules.find(r => r.shift_name === sd.name)?.required_count || 0
      if (required <= 0) continue
      const count = assignments.filter(a => a.date === date && a.shift === sd.name).length
      if (count < required) {
        violations.push({ employee: '-', constraint: 'S1', law: '營運需求', message: `${date} ${sd.name}: ${count}/${required} 人（不足）`, severity: 'warning' })
      }
    }

    // S8: Open/close coverage check
    for (const sd of shiftDefs) {
      const startH = parseTime(sd.start_time)
      const endH = parseTime(sd.end_time)
      const isOpening = startH <= 12
      const isClosing = endH >= 21 || endH < startH

      const shiftWorkers = assignments.filter(a => a.date === date && a.shift === sd.name)
      if (shiftWorkers.length === 0) continue

      if (isOpening) {
        const hasOpener = shiftWorkers.some(a => employees.find(e => e.name === a.employee)?.can_open)
        if (!hasOpener) {
          violations.push({ employee: '-', constraint: 'S8', law: '營運需求', message: `${date} ${sd.name}: 無開店資格人員`, severity: 'warning' })
        }
      }
      if (isClosing) {
        const hasCloser = shiftWorkers.some(a => employees.find(e => e.name === a.employee)?.can_close)
        if (!hasCloser) {
          violations.push({ employee: '-', constraint: 'S8', law: '營運需求', message: `${date} ${sd.name}: 無關店資格人員`, severity: 'warning' })
        }
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

    // S5: Weekly hours target check
    const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT'
    const target = emp.weekly_target_hours || (isPT ? 20 : 40)
    const avgWeeklyHours = totalDays > 0 ? (totalHours / totalDays) * 7 : 0
    if (avgWeeklyHours > target * 1.2) {
      violations.push({
        employee: emp.name, constraint: 'S5', law: '工時管理',
        message: `${emp.name}: 週均工時 ${avgWeeklyHours.toFixed(1)}h 超過目標 ${target}h 的 120%`,
        severity: 'warning',
      })
    }
    if (avgWeeklyHours < target * 0.6 && totalDays >= 7) {
      violations.push({
        employee: emp.name, constraint: 'S5', law: '工時管理',
        message: `${emp.name}: 週均工時 ${avgWeeklyHours.toFixed(1)}h 低於目標 ${target}h 的 60%`,
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
