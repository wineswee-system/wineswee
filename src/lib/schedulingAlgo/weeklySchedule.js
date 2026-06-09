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
  parseTime, getNetWorkHours, getRestMinutes, isAbsence,
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
    preferences, storeSettings, holidays = [],
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
      // PT target = ptMax（Step 1c 主動排到 ptMax 天，避免 PT 工作密度過高破 H3）
      // 原本是 ftMin → 等於 PT 只主動排 ~9 天休、剩下靠 Phase 3 補。staffing 緊時
      // Phase 3 補不到 → PT 工作 19/28 天 → 必破七休一。
      // PT cap = max(ftMin, ptMax)（保 cap ≥ target）
      monthRestTarget[emp.name] = Math.max(ftMin, ptMax)
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
            if (!h) h = getNetWorkHours(def)
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
              h = grossH - getRestMinutes(grossH) / 60
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
      // ★ Bug 修正：原本 filter 是 `offMap.has(...)` 把「員工請假」當 removable
      //   → 員工請的假被強制變上班 → 違反 H1 + 法律風險
      //   正解：「**沒有** off_request 的人」才能被抽掉（algorithm 自動安排的休可以被退回上班）
      const removable = restingOnDay
        .filter(e => !offMap.has(`${e.name}_${date}`))
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

  // 員工處理順序：「rest deficit 高的先排」
  // 原本固定 FT 先 PT 後 → 前幾週 FT 把好日子拿光、PT 累積 deficit
  //                       → 後幾週 PT 想補休但 staffing 擋掉 → 末段連續工作 7+ 天 → 違 H3
  // 改成 deficit 排序：本週開始時，誰累積最落後就先給機會
  // (FT vs PT 不再硬性優先；deficit 自然會平均拉回兩邊)
  const ftFirstOrder = [...employees].sort((a, b) => {
    const aTarget = monthRestTarget[a.name] || 10
    const bTarget = monthRestTarget[b.name] || 10
    const aUsed = monthlyCtx?.restDaysUsed?.[a.name] || 0
    const bUsed = monthlyCtx?.restDaysUsed?.[b.name] || 0
    // 進度比例：應該已用 vs 實際已用，差越大越落後
    // 用本週開始時的「應該進度」算（總 cycle 內已過幾週 / 總週數）
    const cycleDays = monthlyCtx?.cycleDays || 28
    const weeksRemaining = monthlyCtx?.weeksRemaining ?? 0
    const totalWeeks = Math.ceil(cycleDays / 7)
    const weeksDone = Math.max(0, totalWeeks - weeksRemaining - 1)
    const expectedRatio = totalWeeks > 0 ? weeksDone / totalWeeks : 0
    const aExpected = aTarget * expectedRatio
    const bExpected = bTarget * expectedRatio
    const aDeficit = aExpected - aUsed
    const bDeficit = bExpected - bUsed
    if (Math.abs(aDeficit - bDeficit) > 0.1) return bDeficit - aDeficit  // deficit 大的先
    // tie-break：仍然 FT 先（保 backward compat）
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
  // ══════════════════════════════════════════════════════════════════════
  // Layer 1 (Hard Rules): 法規必守 — 直接強制，不打分、不被 staffing 擋
  //   - H3 (連續上班 ≤6 天 / §36 七休一)
  // ══════════════════════════════════════════════════════════════════════

  // 連續工作天數 (optimistic) — 只算已確認的工作（schedule + previousWeek）
  // 不假設「未排日 = 上班」避免 over-fire；只抓真正會違法的 case (主要是 cycle 邊界)
  const consecutiveWorkConfirmed = (empName, date) => {
    if (restDayPlan[empName]?.has(date)) return 0
    let count = 1
    const d = new Date(date)
    let prev = new Date(d)
    for (let i = 0; i < 20; i++) {
      prev.setDate(prev.getDate() - 1)
      const ds = prev.toISOString().slice(0, 10)
      if (restDayPlan[empName]?.has(ds)) break
      if (schedule[empName]?.[ds]) {
        if (isAbsence(schedule[empName][ds])) break
        count++; continue
      }
      const prevA = (data.previousWeek || []).find(p => p.employee === empName && p.date === ds)
      if (prevA && prevA.shift) {
        if (isAbsence(prevA.shift)) break
        count++; continue
      }
      break  // 無紀錄 → 不算 (cycle 邊界外或當週未排)
    }
    return count
  }

  // Hard enforcement：對每位員工，迭代週內每天 — 若此日上班會破 H3 → 強制休
  // 不打分、不被 staffing/can_open/can_close 擋 — 七休一是勞基法 §36 紅線
  // 用 confirmed (不悲觀) 避免 over-trigger；主要 catch cycle 邊界的長 streak case
  const enforceH3Hard = (empName) => {
    for (const date of weekDates) {
      if (restDayPlan[empName].has(date) || schedule[empName][date]) continue
      const consec = consecutiveWorkConfirmed(empName, date)
      if (consec > 6) {  // 7+ = 違法
        restDayPlan[empName].add(date)
        console.log(`[H3 Hard] ${empName} ${date} 強制休 (連續 ${consec} 天)`)
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Layer 2 (Soft Scoring): 軟偏好 — 在 hard rule 之後，挑剩餘休假日
  //   - demand (低需求日優先)
  //   - peerResting (避免同日多人休)
  //   - adjacent (避免連休)
  // ══════════════════════════════════════════════════════════════════════
  const restSpreadScore = (empName, date) => {
    const demand = minWorkersPerDay[date] || minStaff
    const peerResting = employees.filter(e => restDayPlan[e.name].has(date)).length
    const adj = adjacentRestCount(empName, date)
    return demand + peerResting * 2.5 + adj * 3 + Math.random() * 0.5
  }
  const pickRestDays = (empName, count, minStaffPerDay) => {
    let needed = count
    const empObj = employees.find(e => e.name === empName)
    const empCanOpen = empObj?.can_open === true
    const empCanClose = empObj?.can_close === true
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
        .filter(c => {
          if (!empCanOpen || totalCanOpen < 2) return true
          const remainingCanOpen = employees.filter(e =>
            e.can_open === true && e.name !== empName && !restDayPlan[e.name].has(c.date)
          ).length
          return remainingCanOpen >= 1
        })
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

  // ── 執行順序：1. 先 hard enforcement 把違法日強制休 ──
  for (const emp of ftFirstOrder) {
    enforceH3Hard(emp.name)
  }
  // ── 2. 再用 soft scoring 把剩餘休假配額補到 monthly target ──
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
    offMap, prefMap, availMap, staffingMap,
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
