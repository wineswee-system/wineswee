/**
 * Monthly Programmatic Scheduler
 * Processes a full month by iterating weekly chunks with carry-forward context.
 * Calls runProgrammaticSchedule for each week.
 */

import {
  getShiftHours, isAbsence, countsAsMonthlyRest,
  splitIntoWeeks, getCycleFor,
} from '../scheduleUtils'
import { getFatiguePoints } from './scoring'
import { validateMonthlyResult } from './validation'
import { computeStats } from './stats'
import { runProgrammaticSchedule } from './weeklySchedule'

/**
 * 把月制目標 (FT 10 / PT 15) 按 cycle 跨的 calendar month 比例分配。
 * 例：cycle 5/13~6/9 共 28 天 → 五月 19/31 + 六月 9/30 → 月制 10 → cycle 目標 9
 * 這樣即使 cycle 跨月，每個月最後實際拿到的休假天數仍會符合月制設定。
 */
function proRateMonthlyTarget(cycleDates, monthlyTarget) {
  if (!cycleDates || cycleDates.length === 0) return monthlyTarget
  const byMonth = {}
  for (const d of cycleDates) {
    const ym = String(d).slice(0, 7)
    byMonth[ym] = (byMonth[ym] || 0) + 1
  }
  let total = 0
  for (const [ym, count] of Object.entries(byMonth)) {
    const [yr, mo] = ym.split('-').map(Number)
    const daysInMonth = new Date(yr, mo, 0).getDate() // mo 1-12, day 0 = last day of prev month
    total += (count / daysInMonth) * monthlyTarget
  }
  return Math.round(total)
}

export function runMonthlyProgrammaticSchedule(data, onProgress) {
  const { monthDates, previousWeek } = data
  console.log('[Monthly] monthDates:', monthDates?.length, 'first:', monthDates?.[0], 'last:', monthDates?.[monthDates?.length - 1])
  if (!monthDates || monthDates.length === 0) {
    console.warn('[Monthly] No monthDates, falling back to weekly')
    return runProgrammaticSchedule(data)
  }

  // ── 月制目標 → cycle 比例分配 ──
  // 設定的 ft/pt_monthly_rest_days 是「每月」目標；cycle 若跨月就要按比例算
  const ftMonthlyTarget = data.storeSettings?.ft_monthly_rest_days ?? 10
  const ptMonthlyTarget = data.storeSettings?.pt_monthly_rest_days ?? 15
  const ftCycleTarget = proRateMonthlyTarget(monthDates, ftMonthlyTarget)
  const ptCycleTarget = proRateMonthlyTarget(monthDates, ptMonthlyTarget)
  console.log(`[Monthly] 月制目標 FT=${ftMonthlyTarget}/PT=${ptMonthlyTarget} → cycle 目標 FT=${ftCycleTarget}/PT=${ptCycleTarget}（cycle ${monthDates.length} 天）`)

  // 深拷一份 storeSettings 改寫 rest target 給 weekly + final correction 用
  const cycleStoreSettings = {
    ...data.storeSettings,
    ft_monthly_rest_days: ftCycleTarget,
    pt_monthly_rest_days: ptCycleTarget,
  }
  data = { ...data, storeSettings: cycleStoreSettings }

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
