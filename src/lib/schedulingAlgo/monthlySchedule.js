/**
 * Monthly Programmatic Scheduler
 * Processes a full month by iterating weekly chunks with carry-forward context.
 * Calls runProgrammaticSchedule for each week.
 */

import {
  getShiftHours, isAbsence, countsAsMonthlyRest,
  splitIntoWeeks, getCycleFor, isPartTime, parseTime,
} from '../scheduleUtils'
import { getFatiguePoints } from './scoring'
import { validateMonthlyResult, isLegallyValid } from './validation'
import { computeStats } from './stats'
import { runProgrammaticSchedule } from './weeklySchedule'
import { shiftWouldOverStaff, computeDaySlotCoverage } from './shiftAssigner'

/**
 * 把月制目標 (FT 10 / PT 15) 按 cycle 跨的 calendar month 比例分配。
 * 例：cycle 5/13~6/9 共 28 天 → 五月 19/31 + 六月 9/30 → 月制 10 → cycle 目標 9
 * 這樣即使 cycle 跨月，每個月最後實際拿到的休假天數仍會符合月制設定。
 *
 * 注意：對 4 週 cycle 28 天，prorate 後 9 天會比月制 10 少 1 天。H11 sliding
 * window 可能誤觸發（已在 validation.js 修：cycle 完整時用整體算，9 ≥ 8 OK）
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
  // 累積給 weekData.previousWeek — 含 caller 傳的 prev + 已跑完所有 weeks
  // 這樣 H3 跨多週連續上班檢查能看到完整歷史
  let accumulatedPrev = [...(previousWeek || [])]

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
      // ★ 用累積所有前面週的 assignments，不是只上 1 週
      //   讓 isLegallyValid H3 跨多週連續上班 check 真正生效
      //   譬如 FT 5/11-5/25 連 15 天 → 之前只看 Week 4 (5/18-5/24 = 7 連) → 13 < 12
      //   → 漏擋；現在看 5/1-5/24 → 14 連 > 12 → 擋
      previousWeek: accumulatedPrev,
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
        // Step 1c 按 dayProportion 分攤排休用 — 避免短週 Week 1 (3 天) 被分到整週都休
        cycleDays: monthDates.length,
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
    accumulatedPrev = [...accumulatedPrev, ...result.assignments]  // 累積給下週 H3 check

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

  // ── 最終校正：月休天數 enforce 範圍 ──
  // FT: 精確 = ftMin（target = cap）
  // PT: 範圍 [ftMin, ptMax]，不能少於 FT、不能多於 ptMax
  const ftMin = data.storeSettings?.ft_monthly_rest_days ?? 10
  const ptMax = data.storeSettings?.pt_monthly_rest_days ?? 15
  const timeSlotsForCheck = data.timeSlots || []
  const offSet = new Set(data.offRequests.map(o => `${o.employee}_${o.date}`))

  for (const emp of data.employees) {
    const isPT = isPartTime(emp)
    const restMin = ftMin                                                  // 兩種都至少 ftMin 天
    const restMax = isPT ? Math.max(ftMin, ptMax) : ftMin                  // PT cap = ptMax，FT cap = ftMin
    const empAssignments = allAssignments.filter(a => a.employee === emp.name)
    const restAssignments = empAssignments.filter(a => isAbsence(a.shift))
    const workAssignments = empAssignments.filter(a => !isAbsence(a.shift))

    // ── A. 超出 cap → 把多的 rest 轉成上班 ──
    if (restAssignments.length > restMax) {
      const excess = restAssignments.length - restMax
      const convertible = restAssignments.filter(a =>
        !offSet.has(`${a.employee}_${a.date}`) &&
        a.shift !== '未入職' && a.shift !== '已離職'  // 邊界日不能轉
      )
      const sortedByNeed = [...convertible].sort((a, b) => {
        const aW = allAssignments.filter(x => x.date === a.date && !isAbsence(x.shift)).length
        const bW = allAssignments.filter(x => x.date === b.date && !isAbsence(x.shift)).length
        return aW - bW
      })

      // ★ Phase A 漏洞修法：原本只取 safe[0]（按 start_time 排序第一個）、沒過
      //   H3/H4 hard rule → FT 撿短班、違法上班一律不擋
      // 把 allAssignments 重建成 schedule[name][date] 給 isLegallyValid 用
      const schedFromAll = {}
      for (const aA of allAssignments) {
        if (!schedFromAll[aA.employee]) schedFromAll[aA.employee] = {}
        schedFromAll[aA.employee][aA.date] = aA.shift
      }
      // 取「ra.date 同週的 7 天 Mon-Sun」當 weekDates 傳給 isLegallyValid
      //   不能傳整月 dates，否則 isLegallyValid 內 weekly hours check 會用整月工時 → 全擋
      const getWeekDates7 = (dateStr) => {
        const d = new Date(dateStr)
        const dow = d.getDay()
        const mondayOffset = dow === 0 ? -6 : 1 - dow
        const monday = new Date(d)
        monday.setDate(d.getDate() + mondayOffset)
        const arr = []
        for (let i = 0; i < 7; i++) {
          const x = new Date(monday)
          x.setDate(monday.getDate() + i)
          arr.push(x.toISOString().slice(0, 10))
        }
        return arr
      }
      // sortBySdFitForFT — 跟 Step3b 同邏輯，FT 偏好 net=8h（9h gross - 1h break）
      const sortBySdFitForFT = (a, b) => {
        const aNet = getShiftHours(a) - (a.break_minutes || 60) / 60
        const bNet = getShiftHours(b) - (b.break_minutes || 60) / 60
        const aDist = Math.abs(aNet - 8)
        const bDist = Math.abs(bNet - 8)
        if (aDist !== bDist) return aDist - bDist
        return parseTime(a.start_time) - parseTime(b.start_time)
      }

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

        // ★ 過 isLegallyValid（H3 連續上班 / H4 跨日 11h / H13 孕婦夜班）
        const weekDates7 = getWeekDates7(ra.date)
        const legalEligible = eligible.filter(sd =>
          isLegallyValid(emp, sd, ra.date, schedFromAll, data.shiftDefs, weekDates7, { ...data, previousWeek: allAssignments })
        )

        // strict (hourly) 找 safe；找不到退到 binary
        const slotCov = computeDaySlotCoverage(ra.date, timeSlotsForCheck, allAssignments)
        let safe = legalEligible.filter(sd => !shiftWouldOverStaff(sd, slotCov, 'hourly'))
        if (safe.length === 0 && slotCov) {
          safe = legalEligible.filter(sd => !shiftWouldOverStaff(sd, slotCov, 'binary'))
        }
        // ★ FT 偏 9h net=8h 排序，避免撿 6h 短班
        //   優先順序: safe(legal+slot) → legalEligible(legal+no slot fit) → eligible(放棄 legal 退讓)
        const picked = (slotCov ? [...safe].sort(sortBySdFitForFT)[0] : null)
                    || [...legalEligible].sort(sortBySdFitForFT)[0]
                    || [...eligible].sort(sortBySdFitForFT)[0]
                    || data.shiftDefs[0]
                    || null
        if (picked) {
          ra.shift = picked.name
          ra.actual_start = picked.start_time?.slice(0, 5) || '11:00'
          ra.actual_end = picked.end_time?.slice(0, 5) || '20:00'
          ra.actual_hours = getShiftHours(picked) - (picked.break_minutes || 60) / 60
          // 同步 schedFromAll 給下個 iteration 的 isLegallyValid 看
          if (!schedFromAll[emp.name]) schedFromAll[emp.name] = {}
          schedFromAll[emp.name][ra.date] = picked.name
        } else {
          // ★ 終極 fallback：shift_definitions 無對應 shift → 生成 6h window
          const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
          const dow = new Date(ra.date).getDay()
          const oh = data.storeSettings?.operating_hours?.[dayNames[dow]] ||
                     data.storeSettings?.operatingHours?.[dayNames[dow]]
          if (oh?.open) {
            const startStr = oh.open.slice(0, 5)
            const [sh, sm] = startStr.split(':').map(Number)
            const endH = sh + 6
            const endStr = `${String(endH % 24).padStart(2, '0')}:${String(sm).padStart(2, '0')}`
            ra.shift = `${startStr}~${endStr}`
            ra.actual_start = startStr
            ra.actual_end = endStr
            ra.actual_hours = 5
          }
        }
      }
    }

    // ── B. 少於 min → 把多的上班轉成休 ──
    // 條件：不轉掉「邊界日」也不轉掉「該日剩太少人會掉到 minStaff」的日
    if (restAssignments.length < restMin) {
      const shortfall = restMin - restAssignments.length
      // 不能轉的：邊界日 / 已是 absence
      const convertible = workAssignments.filter(a =>
        a.shift !== '未入職' && a.shift !== '已離職'
      )
      // 優先轉「該日工作人手多」的（減一個還夠）
      const sortedBySurplus = [...convertible].sort((a, b) => {
        const aW = allAssignments.filter(x => x.date === a.date && !isAbsence(x.shift)).length
        const bW = allAssignments.filter(x => x.date === b.date && !isAbsence(x.shift)).length
        return bW - aW  // 多的優先轉
      })
      const minStaff = data.storeSettings?.minStaff || 1
      let converted = 0
      for (const wa of sortedBySurplus) {
        if (converted >= shortfall) break
        const dayWorkers = allAssignments.filter(x => x.date === wa.date && !isAbsence(x.shift)).length
        if (dayWorkers - 1 < minStaff) continue  // 轉掉會掉到 minStaff 之下
        wa.shift = '休'
        wa.actual_start = null
        wa.actual_end = null
        wa.actual_hours = null
        converted++
      }
    }
  }

  // ★ Phase A/B 改了 allAssignments → weeklyViolations 的 S10 過時了
  //   filter 掉舊 S10，對 Phase A/B 後的 allAssignments 重跑 S10 一次
  //   修「畫面 3 人 cover 但警告 1/2」的 source-不同步 bug
  const filteredAllViolations = allViolations.filter(v => v.constraint !== 'S10')
  const freshS10 = []
  const timeSlotsForS10 = data.timeSlots || []
  if (timeSlotsForS10.length > 0) {
    for (const date of monthDates) {
      const dow = new Date(date).getDay()
      const isWE = dow === 0 || dow === 6
      const daySlots = timeSlotsForS10.filter(s =>
        s.day_type === 'all' || (s.day_type === 'weekend' && isWE) || (s.day_type === 'weekday' && !isWE)
      )
      for (const slot of daySlots) {
        const slotStart = (() => { const [h, m] = String(slot.start_time).split(':').map(Number); return h + (m || 0) / 60 })()
        const slotEnd = (() => { const [h, m] = String(slot.end_time).split(':').map(Number); return h + (m || 0) / 60 })()
        const slotEndEff = slotEnd <= slotStart ? slotEnd + 24 : slotEnd
        const covering = allAssignments.filter(a => {
          if (a.date !== date) return false
          if (a.shift === '休' || a.shift === '補休' || a.shift === '病' || a.shift === '特休' || a.shift === '會議' || a.shift === '產' || a.shift === '事' || a.shift === '婚' || a.shift === '喪' || a.shift === '公' || a.shift === '生' || a.shift === '工傷' || a.shift === '陪產' || a.shift === '未入職' || a.shift === '已離職') return false
          let st = a.actual_start, en = a.actual_end
          if (!st || !en) {
            const m = String(a.shift || '').match(/^(\d{1,2}):?(\d{0,2})\s*[-~]\s*(\d{1,2}):?(\d{0,2})$/)
            if (m) { st = `${m[1]}:${m[2] || '00'}`; en = `${m[3]}:${m[4] || '00'}` }
          }
          if (!st || !en) return false
          const [sh, sm] = String(st).split(':').map(Number)
          const [eh, em] = String(en).split(':').map(Number)
          const startH = sh + (sm || 0) / 60
          const endH = eh + (em || 0) / 60
          const endEff = endH <= startH ? endH + 24 : endH
          return startH < slotEndEff && endEff > slotStart
        }).length
        if (covering < slot.required_count) {
          freshS10.push({
            employee: '-', constraint: 'S10', law: '營運需求',
            message: `${date} ${slot.start_time}-${slot.end_time}: ${covering}/${slot.required_count} 人（不足）`,
            severity: 'warning',
          })
        }
      }
    }
  }

  const monthlyViolations = validateMonthlyResult(allAssignments, data)
  const combinedViolations = [...filteredAllViolations, ...freshS10, ...monthlyViolations]
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
