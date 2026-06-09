/**
 * Shift Assigner
 * Handles the shift-based (non-time-slot) assignment passes, cross-store borrowing,
 * hybrid gap-fill, post-assignment opener/closer swaps, and FT empty-cell fill for a single week.
 */

import {
  parseTime, getShiftHours, getNetWorkHours, isAbsence, countsAsMonthlyRest,
  isWeekendDay, MONTHLY_OVERTIME_CAP, isPartTime, isShiftWithinOH,
} from '../scheduleUtils'
import { isLegallyValid } from './validation'

/**
 * Check whether a shift is available for an employee on a given date,
 * considering legal validity and personal availability windows.
 */
export function isShiftAvailable(emp, shiftDef, date, schedule, shiftDefs, weekDates, data, availMap) {
  if (!isLegallyValid(emp, shiftDef, date, schedule, shiftDefs, weekDates, data)) return false
  // ★ 寫死不得超過營業時間 — Pass 1/2 / cross-store borrowing / opener-closer swap 共用入口。
  //   source filter 用「跨日 union」會放掉某些日子超 OH 的 shift，這裡擋掉每日違規。
  if (!isShiftWithinOH(shiftDef, date, data?.storeSettings)) return false
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
 */
export function runShiftBasedAssignment(ctx) {
  const {
    employees, weekDates, schedule, actualTimes,
    sortedShifts, shiftDefs, restDayPlan,
    prefMap, availMap, staffingMap,
    targetHoursMap, monthRestTarget, monthRestCap,
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
        // PT 月休已達 cap (= ptMax) → 強制工作；否則繼續排休
        const restLimit = monthRestCap[emp.name] || 15
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
        wantMap[shiftDef.name].push({ emp, priority: emp.schedule_priority || 3 })
      }
    }

    for (const shiftName of Object.keys(wantMap)) {
      const needed = staffingMap[shiftName] || minStaff
      const slotsLeft = needed - (shiftCounts[shiftName] || 0)
      if (slotsLeft <= 0) continue
      const candidates = wantMap[shiftName].sort((a, b) => a.priority - b.priority)
      const shiftDef = sortedShifts.find(s => s.name === shiftName)
      let filled = 0
      for (const { emp } of candidates) {
        if (filled >= slotsLeft) break
        if (assigned.has(emp.name)) continue
        schedule[emp.name][date] = shiftName
        actualTimes[`${emp.name}_${date}`] = {
          start: shiftDef?.start_time?.slice(0, 5),
          end: shiftDef?.end_time?.slice(0, 5),
          hours: shiftDef ? getNetWorkHours(shiftDef) : 8,
        }
        shiftCounts[shiftName] = (shiftCounts[shiftName] || 0) + 1
        assigned.add(emp.name)
        filled++
      }
    }

    // Pass 2: Assign remaining to neutral/understaffed shifts
    //   排序：月休用多的先（讓月休少的人有機會多排到）
    const remaining = toAssign
      .filter(emp => !assigned.has(emp.name))
      .sort((a, b) => getMonthRestUsed(b.name) - getMonthRestUsed(a.name))

    for (const emp of remaining) {
      if (schedule[emp.name][date]) continue
      const pref = prefMap[emp.name]
      const currentWeekHours = weekHoursCache[emp.name]
      const targetH = targetHoursMap[emp.name]
      // 用 cap 判斷月休是否耗盡：FT cap = ftMin (10)，PT cap = ptMax (15)
      const empMonthRestLimit = monthRestCap[emp.name] || 10
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
        const shiftHours = getNetWorkHours(shiftDef)
        const afterHours = currentWeekHours + shiftHours
        if (afterHours <= targetH) score += 15
        else if (afterHours <= targetH + 4) score += 5
        else score -= 10
        if (isWeekendDay(dow) || holidays.includes(date)) {
          // consecWeekends 目前最高只到 1（單 cycle 邊界 flag），>= 2 永遠不會 true
          // → 只保留 cw === 1 的 -15 罰；若之後要真累計，要先改 weeklySchedule consecWeekends 邏輯
          if ((consecWeekends[emp.name] || 0) >= 1) score -= 15
        }
        if (score > bestScore) { bestScore = score; bestShift = shiftDef }
      }

      if (bestShift) {
        schedule[emp.name][date] = bestShift.name
        actualTimes[`${emp.name}_${date}`] = {
          start: bestShift.start_time?.slice(0, 5),
          end: bestShift.end_time?.slice(0, 5),
          hours: getNetWorkHours(bestShift),
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
            hours: getNetWorkHours(fallback),
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
 *
 * ★ 時段制下 SKIP — Phase 1-4 + Step 3b 已處理時段需求，跑這個會：
 *   1. 覆蓋 restDayPlan 排的「休」→ FT 月休天數短少 (H11 違規)
 *   2. 用 minStaff（不看 max_count）→ over-staff
 *   3. 寫 "HH:MM-HH:MM" 格式（不一致）
 */
export function runHybridGapFill(ctx) {
  const {
    employees, weekDates, schedule, actualTimes,
    shiftDefs, offMap, availMap,
    targetHoursMap, getEmpWeekHours, useTimeSlotMode, data,
  } = ctx

  if (useTimeSlotMode) return

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
    // ★ 寫死不得超過營業時間：用 floor(opOpen) / floor(opClose)，避免 ceil 把上限拉到 OH 外
    //   例：opClose=22.5 → 原本 ceil=23 → 22-23h 也算覆蓋目標 → gap 補到 23:00 → 超 OH
    const hourlyCoverage = {}
    for (let h = Math.floor(opOpen); h < Math.floor(opClose); h++) hourlyCoverage[h % 24] = 0
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
        // ★ 寫死不得超過營業時間（gap 視窗也要過）
        if (!isShiftWithinOH(fakeShiftDef, date, storeSettings)) return false
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
        const isPT = isPartTime(emp)
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
        // ★ 跨店借調也必須符合「該日」目標店 OH（防止源頭 shiftDef 跨日 union 漏網）
        if (!isShiftWithinOH(sd, date, data?.storeSettings)) continue
        const shiftHours = getNetWorkHours(sd)
        const isPT = isPartTime(emp)
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

  const lockedKeys = new Set((data.existingSchedules || []).filter(s => s.employee && s.date).map(s => `${s.employee}_${s.date}`))
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
          !lockedKeys.has(`${emp.name}_${date}`) &&
          isShiftAvailable(emp, shiftDef, date, schedule, shiftDefs, weekDates, data, availMap)
        )
        if (restingOpener) {
          const swapOut = scheduled.find(emp => !emp.can_open && !lockedKeys.has(`${emp.name}_${date}`))
          if (swapOut) {
            schedule[restingOpener.name][date] = shiftDef.name
            schedule[swapOut.name][date] = '休'
            lockedKeys.add(`${swapOut.name}_${date}`) // prevent re-selection in later shiftDef iterations
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
          !lockedKeys.has(`${emp.name}_${date}`) &&
          isShiftAvailable(emp, shiftDef, date, schedule, shiftDefs, weekDates, data, availMap)
        )
        if (restingCloser) {
          const swapOut = scheduled.find(emp => !emp.can_close && !lockedKeys.has(`${emp.name}_${date}`))
          if (swapOut) {
            schedule[restingCloser.name][date] = shiftDef.name
            schedule[swapOut.name][date] = '休'
            lockedKeys.add(`${swapOut.name}_${date}`) // prevent re-selection in later shiftDef iterations
            actualTimes[`${restingCloser.name}_${date}`] = actualTimes[`${swapOut.name}_${date}`]
            delete actualTimes[`${swapOut.name}_${date}`]
          }
        }
      }
    }
  }
}

/**
 * Check whether assigning `sd` would push any covered time slot beyond max_count.
 *   mode='hourly' (default): half-hour bucket precision — strict, catches partial over
 *   mode='binary': legacy overlap-based check using slot.covered (= hourly min)
 *                  — looser fallback, used when strict mode leaves no safe shift
 *                    and we'd rather accept marginal over than violate higher-priority
 *                    constraint (e.g., FT monthly rest target = 10 must hit exactly).
 * Returns false when slotCov is null (shift-based mode has no slot coverage).
 */
export function shiftWouldOverStaff(sd, slotCov, mode = 'hourly') {
  if (!slotCov) return false
  const sdStart = parseTime(sd.start_time), sdEnd = parseTime(sd.end_time)
  const sdEndEff = sdEnd <= sdStart ? sdEnd + 24 : sdEnd
  if (mode === 'binary') {
    for (const slot of slotCov) {
      const maxC = slot.max_count || slot.required_count + 2
      const ss = parseTime(slot.start_time), se = parseTime(slot.end_time)
      const seEff = se <= ss ? se + 24 : se
      if (!(sdStart < seEff && sdEndEff > ss)) continue
      if (slot.covered >= maxC) return true
    }
    return false
  }
  // hourly precision (default)
  const sdStartBucket = Math.floor(sdStart * 2)
  const sdEndBucket = Math.floor(sdEndEff * 2)
  for (const slot of slotCov) {
    const maxC = slot.max_count || slot.required_count + 2
    if (slot.coveredHourly && slot._startBucket != null) {
      const ovStart = Math.max(sdStartBucket, slot._startBucket)
      const ovEnd = Math.min(sdEndBucket, slot._endBucket)
      for (let b = ovStart; b < ovEnd; b++) {
        if (slot.coveredHourly[b - slot._startBucket] + 1 > maxC) return true
      }
    } else {
      // hourly data missing → degrade to binary
      const ss = parseTime(slot.start_time), se = parseTime(slot.end_time)
      const seEff = se <= ss ? se + 24 : se
      if (!(sdStart < seEff && sdEndEff > ss)) continue
      if (slot.covered >= maxC) return true
    }
  }
  return false
}

/**
 * Compute current per-slot coverage for a single date from a flat assignments array.
 * Uses half-hour buckets (48 per day) so partial-overlap is precise:
 *   slot.covered = min hourly headcount within slot (true bottleneck)
 *   slot.coveredHourly = per-bucket headcount array within slot
 *   slot._startBucket / _endBucket = bucket range for hourly checks
 * Returns null when timeSlots is empty (shift-based mode).
 */
export function computeDaySlotCoverage(date, timeSlots, assignments) {
  if (!timeSlots || timeSlots.length === 0) return null
  const dow = new Date(date).getDay()
  const isWE = isWeekendDay(dow)
  const daySlots = timeSlots.filter(s =>
    s.day_type === 'all' || (s.day_type === 'weekend' && isWE) || (s.day_type === 'weekday' && !isWE)
  )
  // Build half-hour buckets for the date (48 buckets, mod 48 wraps midnight)
  const buckets = new Array(48).fill(0)
  for (const a of assignments) {
    if (a.date !== date) continue
    if (isAbsence(a.shift)) continue
    if (!a.actual_start || !a.actual_end) continue
    const startH = parseTime(a.actual_start)
    const endH = parseTime(a.actual_end)
    const effEnd = endH <= startH ? endH + 24 : endH
    const sb = Math.floor(startH * 2)
    const eb = Math.floor(effEnd * 2)
    for (let b = sb; b < eb; b++) buckets[b % 48]++
  }
  return daySlots.map(s => {
    const ss = parseTime(s.start_time)
    const se = parseTime(s.end_time)
    const seEff = se <= ss ? se + 24 : se
    const sb = Math.floor(ss * 2)
    const eb = Math.floor(seEff * 2)
    const coveredHourly = []
    let min = Infinity
    for (let b = sb; b < eb; b++) {
      const cnt = buckets[b % 48]
      coveredHourly.push(cnt)
      if (cnt < min) min = cnt
    }
    return {
      ...s,
      covered: min === Infinity ? 0 : min,
      coveredHourly,
      _startBucket: sb,
      _endBucket: eb,
    }
  })
}

/**
 * Fill unassigned FT cells with a "safe" shift (one that doesn't over-staff any time slot).
 * 時段制下優先選不會 over-staff 的 shift；若全 over → 排休（不 over-staff 優先）。
 * 班別制下 slotCov 是 null → safe === eligible，永遠取第一個 eligible shift。
 * Mutates `schedule` and `actualTimes` in place.
 */
export function runFillUnassignedFT(ctx) {
  const {
    employees, weekDates, schedule, actualTimes,
    sortedShifts, shiftDefs, restDayPlan, timeSlots, useTimeSlotMode,
    wsConstraints, isPTEmp, data,
  } = ctx

  // Hourly-precise slot coverage (跟 module-level computeDaySlotCoverage 同邏輯，
  // 差別是吃 schedule/actualTimes lookup 而非 flat assignments array)
  const computeDaySlotCov = (date) => {
    if (!useTimeSlotMode) return null
    const dow = new Date(date).getDay()
    const isWE = isWeekendDay(dow)
    const daySlots = timeSlots.filter(s =>
      s.day_type === 'all' || (s.day_type === 'weekend' && isWE) || (s.day_type === 'weekday' && !isWE)
    )
    const buckets = new Array(48).fill(0)
    for (const e2 of employees) {
      const s2 = schedule[e2.name][date]
      if (!s2 || isAbsence(s2)) continue
      const t = actualTimes[`${e2.name}_${date}`]
      if (!t?.start || !t?.end) continue
      const startH = parseTime(t.start), endH = parseTime(t.end)
      const effEnd = endH <= startH ? endH + 24 : endH
      const sb = Math.floor(startH * 2), eb = Math.floor(effEnd * 2)
      for (let b = sb; b < eb; b++) buckets[b % 48]++
    }
    return daySlots.map(s => {
      const ss = parseTime(s.start_time)
      const se = parseTime(s.end_time)
      const seEff = se <= ss ? se + 24 : se
      const sb = Math.floor(ss * 2), eb = Math.floor(seEff * 2)
      const coveredHourly = []
      let min = Infinity
      for (let b = sb; b < eb; b++) {
        const cnt = buckets[b % 48]
        coveredHourly.push(cnt)
        if (cnt < min) min = cnt
      }
      return { ...s, covered: min === Infinity ? 0 : min, coveredHourly, _startBucket: sb, _endBucket: eb }
    })
  }

  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const storeSettings = ctx.storeSettings

  // ★ FT 偏好排序：net hours 越接近 8h（= 9h gross - 1h break）越好；
  //   tiebreaker: start_time 早者勝（保留原 sortedShifts 行為）
  //   Why: 之前 safe[0] / eligible[0] 直接取 sortedShifts 第一個（start_time 最早），
  //        如果該店 shift_definitions 內有 11:00-17:00 (6h) 跟 11:00-20:00 (9h) 並存，
  //        且 start_time 相同 → safe[0] 會撿到 6h 短班 → FT 整月被排成 6h
  const sortBySdFitForFT = (a, b) => {
    const aNet = getNetWorkHours(a)
    const bNet = getNetWorkHours(b)
    const aDist = Math.abs(aNet - 8)
    const bDist = Math.abs(bNet - 8)
    if (aDist !== bDist) return aDist - bDist
    return parseTime(a.start_time) - parseTime(b.start_time)
  }

  for (const emp of employees) {
    if (isPTEmp(emp)) continue
    for (const date of weekDates) {
      if (schedule[emp.name][date]) continue
      if (restDayPlan[emp.name].has(date)) continue
      const dow = new Date(date).getDay()
      const isWeekend = isWeekendDay(dow)

      // ★ 算當日營業時間，給 can_open / can_close 檢查用（跟 timeSlotMode.tryShift 對齊）
      const oh = storeSettings?.operating_hours?.[dayNames[dow]] || storeSettings?.operatingHours?.[dayNames[dow]]
      const storeOpenH = oh?.open ? parseTime(oh.open) : null
      const storeCloseH = oh?.close ? parseTime(oh.close) : null
      const effectiveCloseH = (storeOpenH != null && storeCloseH != null && storeCloseH <= storeOpenH)
        ? storeCloseH + 24 : storeCloseH

      const eligibleAll = sortedShifts.filter(sd => {
        if (sd.employee_type && sd.employee_type !== 'all' && sd.employee_type !== 'full_time') return false
        if (sd.day_type === 'weekday' && isWeekend) return false
        if (sd.day_type === 'weekend' && !isWeekend) return false
        if (getShiftHours(sd) > wsConstraints.dailyAbsoluteMax) return false
        // ★ 寫死不得超過營業時間 — Step3b 也用 isShiftWithinOH 做 per-day 檢查，
        //   避免 cross-day union source filter 漏掉某日違規 shift
        if (!isShiftWithinOH(sd, date, storeSettings)) return false
        // ★ can_open / can_close — 跟 timeSlotMode.tryShift 對齊
        //   UI 是 checkbox：勾=可、沒勾=不可。null 視同沒勾 → 用 `!== true`
        if (storeOpenH != null && emp.can_open !== true) {
          const sdStartH = parseTime(sd.start_time)
          if (sdStartH < storeOpenH + 2) return false
        }
        if (effectiveCloseH != null && emp.can_close !== true) {
          const sdStartH = parseTime(sd.start_time)
          const sdEndH = parseTime(sd.end_time)
          const effEnd = sdEndH <= sdStartH ? sdEndH + 24 : sdEndH
          if (effEnd > effectiveCloseH - 2) return false
        }
        return true
      })
      // ★ 過 isLegallyValid (H3 連續上班 / H4 跨日 11h / H13 孕婦夜班 等 hard rule)
      //   之前 Step3b 沒過 → FT 連續上班可達 19 天嚴重違反 H3 (上限 12)
      const eligible = eligibleAll.filter(sd =>
        isLegallyValid(emp, sd, date, schedule, shiftDefs, weekDates, data)
      )
      if (eligible.length === 0) {
        // 全 eligible 都違反 hard rule → 排休（H3 已達上限就強制休一天）
        if (date === weekDates[0]) console.log(`[DBG ${date}] Step3b ${emp.name} 全 eligible 違反 hard rule → 休`)
        schedule[emp.name][date] = '休'
        continue
      }
      // 先 strict (hourly) 找 safe；找不到退到 binary (slot-min) — 接受 marginal partial over
      // 以維持 FT 月休精確（hard rule: ftMin 必須命中）
      const slotCov = computeDaySlotCov(date)
      let safe = eligible.filter(sd => !shiftWouldOverStaff(sd, slotCov, 'hourly'))
      if (safe.length === 0 && useTimeSlotMode) {
        safe = eligible.filter(sd => !shiftWouldOverStaff(sd, slotCov, 'binary'))
      }
      if (safe.length === 0) {
        if (useTimeSlotMode) {
          schedule[emp.name][date] = '休'
          if (date === weekDates[0]) console.log(`[DBG ${date}] Step3b ${emp.name} safe=[] (strict+binary) → 休`)
        } else {
          const sd = [...eligible].sort(sortBySdFitForFT)[0]
          schedule[emp.name][date] = sd.name
          actualTimes[`${emp.name}_${date}`] = { start: sd.start_time?.slice(0, 5), end: sd.end_time?.slice(0, 5), hours: getNetWorkHours(sd) }
          if (date === weekDates[0]) console.log(`[DBG ${date}] Step3b ${emp.name} 班別制 → ${sd.name}`)
        }
        continue
      }
      const sd = [...safe].sort(sortBySdFitForFT)[0]
      schedule[emp.name][date] = sd.name
      actualTimes[`${emp.name}_${date}`] = { start: sd.start_time?.slice(0, 5), end: sd.end_time?.slice(0, 5), hours: getNetWorkHours(sd) }
      if (date === weekDates[0]) console.log(`[DBG ${date}] Step3b ${emp.name} → ${sd.name} (net=${getNetWorkHours(sd).toFixed(1)}h)`)
    }
  }
}
