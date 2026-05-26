/**
 * Weekly Programmatic Scheduler
 * Orchestrates a single-week schedule by:
 *   1. Building scheduling context (Step 0 data expansion)
 *   2. Marking rest days (Step 1) + actively distributing rest (Step 1c)
 *   3. Dispatching to time-slot mode or shift-based mode
 *   4. Running cross-cutting fixes (hybrid gap-fill, cross-store, opener/closer, FT empty-cell)
 *   5. Validating + producing stats
 */

import {
  parseTime, getShiftHours, isAbsence,
  isWeekendDay, getWorkSystemConstraints,
} from '../scheduleUtils'
import { validateResult } from './validation'
import { computeStats, buildReasoning } from './stats'
import { runTimeSlotMode, isPTEmp } from './timeSlotMode'
import {
  runShiftBasedAssignment, runHybridGapFill,
  runCrossStoreBorrowing, runOpenerCloserFixes, runFillUnassignedFT,
} from './shiftAssigner'

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

  // ── Step 0: Build lookups ──────────────────────────────────────
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
    const isPT = isPTEmp(emp)
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
      // ★ 同步補 actualTimes，否則 validation S10 看不到這些 shift 的工時
      if (!isAbsence(s.shift) && s.actual_start) {
        actualTimes[`${s.employee}_${s.date}`] = {
          start: typeof s.actual_start === 'string' ? s.actual_start.slice(0, 5) : s.actual_start,
          end: typeof s.actual_end === 'string' ? s.actual_end.slice(0, 5) : s.actual_end,
          hours: s.actual_hours || null,
        }
      }
    }
  }

  // ── Step 1: Mark rest days ─────────────────────────────────────
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
          const aIsPT = isPTEmp(a) ? 0 : 1
          const bIsPT = isPTEmp(b) ? 0 : 1
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

  // ── Step 1c: 主動分配休假 ──────────────────────────────────────
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

  // 休假分散化 — 避免「2 FT 同日連休 2 天」整齊到不自然
  // 評分（越低越優先選為休假日）：
  //   demand            ← 低需求日優先休
  //   peerResting × 2.5 ← 別人已休該日 → +2.5 分（壓制同日多人休）
  //   adjacent × 3      ← emp 自己前後 1 天已休 → +3 分（壓制連休）
  //   jitter × 0.5      ← 微量隨機破同分
  const adjacentRestCount = (empName, date) => {
    const idx = weekDates.indexOf(date)
    let cnt = 0
    if (idx > 0 && restDayPlan[empName].has(weekDates[idx - 1])) cnt++
    if (idx < weekDates.length - 1 && restDayPlan[empName].has(weekDates[idx + 1])) cnt++
    return cnt
  }
  const restSpreadScore = (empName, date) => {
    const demand = minWorkersPerDay[date] || minStaff
    const peerResting = employees.filter(e => restDayPlan[e.name].has(date)).length
    const adj = adjacentRestCount(empName, date)
    return demand + peerResting * 2.5 + adj * 3 + Math.random() * 0.5
  }
  const pickRestDays = (empName, count, minStaffPerDay) => {
    let needed = count
    while (needed > 0) {
      const candidates = weekDates
        .filter(d => !restDayPlan[empName].has(d) && !schedule[empName][d])
        .map(d => ({ date: d, score: restSpreadScore(empName, d) }))
        .filter(c => {
          const restingOnDay = employees.filter(e => restDayPlan[e.name].has(c.date)).length
          const workingAfter = employees.length - restingOnDay - 1
          return workingAfter >= minStaffPerDay(c.date)
        })
        .sort((a, b) => a.score - b.score)
      if (candidates.length === 0) break
      restDayPlan[empName].add(candidates[0].date)
      needed--
    }
  }

  for (const emp of ftFirstOrder) {
    const remaining = getMonthRestRemaining(emp.name)
    if (remaining <= 0) continue
    pickRestDays(emp.name, remaining, (d) => minWorkersPerDay[d] || minStaff)
  }

  const maxMinWorkers = Math.max(...weekDates.map(d => minWorkersPerDay[d] || minStaff))
  if (employees.length > maxMinWorkers) {
    for (const emp of ftFirstOrder) {
      if (isPTEmp(emp)) continue
      const remaining = getMonthRestRemaining(emp.name)
      if (remaining <= 0) continue
      // 第二輪允許 minStaff - 1（讓 FT 月休能補到目標）
      pickRestDays(emp.name, remaining, (d) => Math.max(1, (minWorkersPerDay[d] || minStaff) - 1))
    }
  }

  for (const emp of employees) {
    for (const date of restDayPlan[emp.name]) {
      if (!schedule[emp.name][date] || isAbsence(schedule[emp.name][date])) {
        schedule[emp.name][date] = '休'
      }
    }
  }

  // ── Helper closures (used by both modes via ctx) ────────────────
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

  // ── Step 2: Sort shifts by start time ──────────────────────────
  const sortedShifts = [...shiftDefs].sort((a, b) => parseTime(a.start_time) - parseTime(b.start_time))

  // assignments declared here (shared across both modes — bug fix: was previously
  // only declared inside the else branch, causing ReferenceError when useTimeSlotMode=true)
  const assignments = []

  // ── Build shared scheduling context ────────────────────────────
  const ctx = {
    // Inputs
    employees, weekDates, shiftDefs, sortedShifts, timeSlots, storeSettings,
    staffingRules, minStaff, holidays, data,
    // Lookups
    offMap, prefMap, availMap, fatigueMap, staffingMap,
    targetHoursMap, hoursRange, monthlyCtx, monthTargetMap, monthRestTarget,
    consecWeekends, restDayPlan, wsConstraints, useTimeSlotMode,
    // Mutable state
    schedule, actualTimes, assignments,
    // Helpers
    isPTEmp, getEmpWeekHours,
  }

  // ── Step 3: Mode dispatch ──────────────────────────────────────
  if (useTimeSlotMode) {
    runTimeSlotMode(ctx)
  } else {
    runShiftBasedAssignment(ctx)
    runHybridGapFill(ctx)         // self-skips if useTimeSlotMode
    runCrossStoreBorrowing(ctx)   // 班別制專屬（原行為，保持一致）
    runOpenerCloserFixes(ctx)
  }

  // ── Step 3b: Fill unassigned FT cells (両モード共通) ───────────
  runFillUnassignedFT(ctx)

  // ── Step 4: Build assignments + validate ───────────────────────
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
