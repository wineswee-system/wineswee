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
  formatShiftLabel, parseShiftRange,
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
  const monthRestTarget = {}  // Step 1c 主動排到的月休天數（FT/PT 都是 ftMin）
  const monthRestCap = {}     // 月休上限（FT=ftMin, PT=ptMax）
  for (const emp of employees) {
    const isPT = isPTEmp(emp)
    const monthMin = isPT ? MONTHLY_PT_MIN : MONTHLY_FT_MIN
    // personal_hour_cap (個人 cycle 時數上限) 蓋過店面預設
    const monthMax = emp.personal_hour_cap != null
      ? Math.min(emp.personal_hour_cap, isPT ? MONTHLY_PT_MAX : MONTHLY_FT_MAX)
      : (isPT ? MONTHLY_PT_MAX : MONTHLY_FT_MAX)
    monthTargetMap[emp.name] = { min: monthMin, max: monthMax, isPT, personalCap: emp.personal_hour_cap }
    // 月休範圍：FT 固定 ft_monthly_rest_days；PT 在 [ftMin, ptMax] 之間
    const ftMin = storeSettings?.ft_monthly_rest_days ?? 10
    const ptMax = storeSettings?.pt_monthly_rest_days ?? 15
    if (isPT) {
      // PT target = ftMin（Step 1c 至少主動排到 ftMin 天，不能少於 FT）
      // PT cap = max(ftMin, ptMax)（Phase 3 排休上限，避免 ptMax < ftMin 反轉）
      monthRestTarget[emp.name] = ftMin
      monthRestCap[emp.name] = Math.max(ftMin, ptMax)
    } else {
      // FT target = cap = ftMin，月休精確命中
      monthRestTarget[emp.name] = ftMin
      monthRestCap[emp.name] = ftMin
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
      // ★ 同步補 actualTimes — Phase 3 hourly buckets / S10 驗證都靠它算覆蓋
      if (!isAbsence(s.shift)) {
        let st = s.actual_start
        let et = s.actual_end
        let h = s.actual_hours
        // shift 是 shift_definitions 內 fixed 班但 schedules 表沒填 actual_start/end
        // → 從 shift_def 補（normalized name 比對，避免 ~ vs - 不匹配）
        if (!st || !et) {
          const targetNorm = formatShiftLabel(s.shift)
          const def = shiftDefs.find(d =>
            d.name === s.shift || formatShiftLabel(d.name) === targetNorm
          )
          if (def) {
            st = def.start_time
            et = def.end_time
            if (!h) h = getShiftHours(def) - (def.break_minutes || 60) / 60
          }
        }
        // 終極 fallback：shift 本身就是時段範圍 label（時段制動態 window，
        // 譬如 '10:30~19:30' 不對應任何 shift_def）→ 直接 parse
        if (!st || !et) {
          const parsed = parseShiftRange(s.shift)
          if (parsed) {
            st = parsed.start
            et = parsed.end
            if (!h) {
              const sH = parseTime(st), eH = parseTime(et)
              const eEff = eH <= sH ? eH + 24 : eH
              const grossH = eEff - sH
              h = grossH >= 6 ? grossH - 1 : grossH  // 6h+ 扣 1h 休息
            }
          }
        }
        if (st && et) {
          actualTimes[`${s.employee}_${s.date}`] = {
            start: typeof st === 'string' ? st.slice(0, 5) : st,
            end: typeof et === 'string' ? et.slice(0, 5) : et,
            hours: h || null,
          }
        }
      }
    }
  }

  // ── Step 1: Mark rest days ─────────────────────────────────────
  const restDayPlan = {}
  for (const emp of employees) restDayPlan[emp.name] = new Set()

  // 邊界日（入職前 / 離職後）— 直接寫死 absence label，演算法後續會 skip
  // 用 NOT_HIRED / RESIGNED（countsAsRest=false）避免吃進月休配額
  for (const emp of employees) {
    for (const date of weekDates) {
      if (emp.join_date && date < emp.join_date) {
        restDayPlan[emp.name].add(date)
        schedule[emp.name][date] = '未入職'
      } else if (emp.resign_date && date > emp.resign_date) {
        restDayPlan[emp.name].add(date)
        schedule[emp.name][date] = '已離職'
      }
    }
  }

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
  // 按「該週天數佔 cycle 比例」分攤排休（不是按週數平均）
  // 之前 ceil(target / weeksLeft) → 譬如 PT target=14, weeksLeft=5 → avgPerWeek=3
  //   Week 1 只 3 天但被分到 3 天休 → 整週 0 工時 → 5/1 slot 缺人 S10 警告
  // 改成 round(target × weekDays / cycleDays)：Week 1 (3 days) PT 只排 ~2 天休
  const getMonthRestRemaining = (empName) => {
    const target = monthRestTarget[empName] || 10
    const thisWeekUsed = weekDates.filter(d => restDayPlan[empName].has(d)).length
    if (monthlyCtx) {
      const prevUsed = monthlyCtx.restDaysUsed?.[empName] || 0
      const monthRemaining = Math.max(0, target - prevUsed - thisWeekUsed)
      // 按該週天數比例分攤 — 短週（如 Week 1 = 3 天）按 dayProportion 算
      // 用 ceil 而非 round，避免 round 後加總 < target 導致月休少 1 天
      // 靠 monthRemaining cap 收斂（最後幾週被 cap 卡住）→ 加總精確命中 target
      const cycleDays = monthlyCtx.cycleDays || 28
      const targetThisWeek = Math.ceil(target * weekDates.length / cycleDays)
      return Math.min(monthRemaining, Math.max(0, targetThisWeek - thisWeekUsed))
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
  // 算「不休此日 (上班)，往回看到第一個非工作日為止的連續工作天」— 只往回算
  // 不算 forward 避免「未排日 = 視為上班」over-count 誤觸發 bonus
  const consecutiveWorkBackward = (empName, date) => {
    if (restDayPlan[empName]?.has(date)) return 0
    let count = 1  // 假設 date 上班
    const d = new Date(date)
    let prev = new Date(d)
    for (let i = 0; i < 20; i++) {
      prev.setDate(prev.getDate() - 1)
      const ds = prev.toISOString().slice(0, 10)
      // 已排休 / accumulatedPrev 內標記非工作 → break
      if (restDayPlan[empName]?.has(ds)) break
      if (schedule[empName]?.[ds] && !isAbsence(schedule[empName][ds])) { count++; continue }
      const prevA = (data.previousWeek || []).find(p => p.employee === empName && p.date === ds)
      if (prevA && prevA.shift) {
        if (isAbsence(prevA.shift)) break
        count++; continue
      }
      // 完全沒紀錄 → 假設不上班（cycle 邊界外）→ break
      break
    }
    return count
  }

  const restSpreadScore = (empName, date) => {
    const demand = minWorkersPerDay[date] || minStaff
    const peerResting = employees.filter(e => restDayPlan[e.name].has(date)).length
    const adj = adjacentRestCount(empName, date)
    // ★ 跨月超標軟懲罰（penalty=10 — 輕引導，H3 跟其他項都能 override）
    let crossMonthPenalty = 0
    if (monthlyCtx?.priorRestByMonth || monthlyCtx?.cycleRestByMonth) {
      const monthKey = date.slice(0, 7)
      const prior = monthlyCtx.priorRestByMonth?.[empName]?.[monthKey] || 0
      const cycleSoFar = monthlyCtx.cycleRestByMonth?.[empName]?.[monthKey] || 0
      const thisWeekInMonth = weekDates.filter(d => d.slice(0, 7) === monthKey && restDayPlan[empName].has(d)).length
      const isPT = monthTargetMap[empName]?.isPT
      const target = isPT
        ? (monthlyCtx.monthlyRestTargetPT ?? 15)
        : (monthlyCtx.monthlyRestTargetFT ?? 10)
      const totalIfAdd = prior + cycleSoFar + thisWeekInMonth + 1
      crossMonthPenalty = Math.max(0, totalIfAdd - target) * 10
    }
    // ★ H3 救援 bonus：往回看連續 ≥6 天 → 此日強烈鼓勵排休
    //   只算 backward (forward 算不準會 over-fire)，bonus 絕對值遠高於 month penalty
    let h3Bonus = 0
    const consecBack = consecutiveWorkBackward(empName, date)
    if (consecBack >= 6) h3Bonus = -100 * (consecBack - 5)  // 連 6 天 -100，連 7 天 -200 ...
    return demand + peerResting * 2.5 + adj * 3 + crossMonthPenalty + h3Bonus + Math.random() * 0.5
  }
  const pickRestDays = (empName, count, minStaffPerDay) => {
    let needed = count
    const empObj = employees.find(e => e.name === empName)
    const empCanOpen = empObj?.can_open === true
    const empCanClose = empObj?.can_close === true
    // 店內 can_open / can_close 總人數 — 只有 1 人時不 enforce 保護（否則該員工永遠不能休）
    const totalCanOpen = employees.filter(e => e.can_open === true).length
    const totalCanClose = employees.filter(e => e.can_close === true).length
    while (needed > 0) {
      const candidates = weekDates
        .filter(d => !restDayPlan[empName].has(d) && !schedule[empName][d])
        .map(d => ({ date: d, score: restSpreadScore(empName, d) }))
        .filter(c => {
          const restingOnDay = employees.filter(e => restDayPlan[e.name].has(c.date)).length
          const workingAfter = employees.length - restingOnDay - 1
          return workingAfter >= minStaffPerDay(c.date)
        })
        // ★ 保護「該日至少留 1 個 can_open 員工不休」— 不然 10:30 早班沒人 cover
        //   只在店內 can_open 員工 ≥ 2 時 enforce（避免單一 can_open 永遠不能休）
        .filter(c => {
          if (!empCanOpen || totalCanOpen < 2) return true
          const remainingCanOpen = employees.filter(e =>
            e.can_open === true && e.name !== empName && !restDayPlan[e.name].has(c.date)
          ).length
          return remainingCanOpen >= 1
        })
        // ★ 同樣保護 can_close — 不然關店時段沒人 cover
        .filter(c => {
          if (!empCanClose || totalCanClose < 2) return true
          const remainingCanClose = employees.filter(e =>
            e.can_close === true && e.name !== empName && !restDayPlan[e.name].has(c.date)
          ).length
          return remainingCanClose >= 1
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
    targetHoursMap, hoursRange, monthlyCtx, monthTargetMap, monthRestTarget, monthRestCap,
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
