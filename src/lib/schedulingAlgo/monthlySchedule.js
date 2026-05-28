/**
 * Monthly Programmatic Scheduler
 * Processes a full month by iterating weekly chunks with carry-forward context.
 * Calls runProgrammaticSchedule for each week.
 */

import {
  getShiftHours, isAbsence, countsAsMonthlyRest,
  splitIntoWeeks, getCycleFor, isPartTime, parseTime,
  MAX_CONSECUTIVE_WORK_DAYS, isShiftWithinOH, getOperatingHoursForDate, isWeekendDay,
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

  // ══════════════════════════════════════════════════════════════════════
  // ★ 跨 cycle 累積診斷 — 印出 cycle 之間會傳遞的所有 state
  //   讓使用者跑 cycle 3 時可看到累積成什麼樣，找「越排越亂」根因
  // ══════════════════════════════════════════════════════════════════════
  console.group(`[ACCUM DIAGNOSTIC] cycle 開始: ${monthDates[0]} ~ ${monthDates[monthDates.length-1]}`)
  // 1. previousWeek - 上 cycle 末 7 天
  const prevByEmp = {}
  for (const p of (previousWeek || [])) {
    if (!prevByEmp[p.employee]) prevByEmp[p.employee] = []
    prevByEmp[p.employee].push({ date: p.date, shift: p.shift })
  }
  console.log('1. previousWeek (上 cycle 末 7-14 天):', Object.keys(prevByEmp).length, '位員工有資料')
  for (const [emp, days] of Object.entries(prevByEmp)) {
    days.sort((a, b) => a.date.localeCompare(b.date))
    // 算末端連續工作天
    let endStreak = 0
    for (let i = days.length - 1; i >= 0; i--) {
      const s = days[i].shift
      if (s && !isAbsence(s)) endStreak++
      else break
    }
    if (endStreak > 0) {
      console.log(`  ${emp}: 末端連續工作 ${endStreak} 天 (${days.slice(-endStreak).map(d => d.date).join(', ')})`)
    }
  }

  // 2. priorRestByMonth - 跨月休累計
  const prior = data.priorRestByMonth || {}
  console.log('2. priorRestByMonth (cycle 跨到月份的、cycle 外已休天數):', Object.keys(prior).length, '位員工有資料')
  for (const [emp, byMonth] of Object.entries(prior)) {
    const entries = Object.entries(byMonth).map(([m, c]) => `${m}=${c}`).join(', ')
    console.log(`  ${emp}: ${entries}`)
  }

  // 3. fatigueScores - 跨月疲勞累計
  const fatigue = data.fatigueScores || []
  console.log('3. fatigueScores (本月已累積疲勞分):', fatigue.length, '筆')
  for (const f of fatigue.slice(0, 10)) {
    console.log(`  ${f.employee}: total=${f.total_score || 0}`)
  }

  // 4. existingSchedules - 本 cycle 範圍內已鎖定 (re-run 時才有)
  const locked = (data.existingSchedules || []).filter(s => s.shift && !isAbsence(s.shift))
  console.log(`4. existingSchedules (本 cycle 內已鎖定): ${locked.length} 筆 (re-run 才會有)`)

  console.groupEnd()
  // ══════════════════════════════════════════════════════════════════════

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
  // 累積給 weekData.previousWeek — 含 caller 傳的 prev (上 cycle 末 7 天，給 H3 跨 cycle check 用)
  // + 本 cycle 內已跑完的 weeks，讓 isLegallyValid 看到完整歷史。
  // 跨 cycle 只看兩件事：H3 連續上班 ≤6 天 + 月休 cap (priorRestByMonth)
  let accumulatedPrev = [...(previousWeek || [])]

  const monthFatigue = {}
  const monthHours = {}
  const monthRestDays = {}
  // ★ 跨月累計：cycle 內已分配的休假按 calendar month 分桶
  //   給 weekly scheduler 算「本月實際總休 = prior + cycle 已用 + 待分配」用
  const cycleRestByMonth = {}  // { empName: { 'YYYY-MM': count } }
  for (const emp of data.employees) {
    monthFatigue[emp.name] = 0
    monthHours[emp.name] = 0
    monthRestDays[emp.name] = 0
    cycleRestByMonth[emp.name] = {}
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
        // ★ 跨月累計：scoring 函式判斷「這天排休會不會讓 calendar month 超標」
        priorRestByMonth: data.priorRestByMonth || {},
        cycleRestByMonth,  // mutated by reference — pass-by-ref 給 monthly loop 累計
        monthlyRestTargetFT: ftMonthlyTarget,  // 原本的月目標（cycle prorate 之前的值）
        monthlyRestTargetPT: ptMonthlyTarget,
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
          // ★ 累計到 calendar month bucket（給後續週 scoring 判斷跨月超標用）
          const monthKey = a.date.slice(0, 7)
          if (!cycleRestByMonth[a.employee]) cycleRestByMonth[a.employee] = {}
          cycleRestByMonth[a.employee][monthKey] = (cycleRestByMonth[a.employee][monthKey] || 0) + 1
        }
      } else {
        monthHours[a.employee] = (monthHours[a.employee] || 0) + (a.actual_hours || 8)
        const def = data.shiftDefs.find(d => d.name === a.shift)
        if (def) monthFatigue[a.employee] = (monthFatigue[a.employee] || 0) + getFatiguePoints(def, a.date, data.holidays)
      }
    }
    console.log(`[Monthly] Week ${i + 1} done. Hours:`, Object.entries(monthHours).map(([n, h]) => `${n}:${h.toFixed(0)}h`).join(', '))
  }

  // ── 跨月校正 (B)：偵測 cycle + prior 加總 > monthly target，自動 swap ──
  // H soft penalty 在 weekly scheduler 內已降低機率，B 是最後一道防線。
  // 演算法：把超標月內、本 cycle 的休假，跟非超標月、本 cycle 的工作日做 swap
  //         需通過 H3 (連續工作 ≤6 天) 才接受 swap，找不到合法 swap 才報 warning
  const priorRestByMonthForCheck = data.priorRestByMonth || {}

  // helper：算 假設 dateStr 變成工作日後，所在的連續工作天數
  // 包含 data.previousWeek (跨 cycle history) — 不然跨月 swap 在 cycle 邊界會漏算
  const consecutiveWorkAtIfWork = (empName, dateStr, currentAssignments) => {
    const isWorkDay = {}
    // 1. 累計本 cycle 內所有 assignments
    for (const a of currentAssignments) {
      if (a.employee !== empName) continue
      isWorkDay[a.date] = a.shift && !isAbsence(a.shift)
    }
    // 2. 累計 previousWeek (上 cycle 末 7-14 天) — Critical fix: 不然 swap 月初的工作日時
    //    backward streak 會漏算上 cycle 連續工作天，誤判 swap 安全
    for (const p of (data.previousWeek || [])) {
      if (p.employee !== empName) continue
      if (isWorkDay[p.date] !== undefined) continue  // 本 cycle 已有 → 不覆蓋
      isWorkDay[p.date] = p.shift && !isAbsence(p.shift)
    }
    isWorkDay[dateStr] = true  // 假設此日改成上班
    let count = 1
    const d = new Date(dateStr)
    // 往前
    let prev = new Date(d)
    while (true) {
      prev.setDate(prev.getDate() - 1)
      const ds = prev.toISOString().slice(0, 10)
      if (isWorkDay[ds]) count++
      else break
    }
    // 往後
    let next = new Date(d)
    while (true) {
      next.setDate(next.getDate() + 1)
      const ds = next.toISOString().slice(0, 10)
      if (isWorkDay[ds]) count++
      else break
    }
    return count
  }

  for (const emp of data.employees) {
    const isPT = isPartTime(emp)
    const monthTarget = isPT ? ptMonthlyTarget : ftMonthlyTarget
    const allMonthKeys = new Set([
      ...Object.keys(cycleRestByMonth[emp.name] || {}),
      ...Object.keys(priorRestByMonthForCheck[emp.name] || {}),
    ])
    for (const monthKey of allMonthKeys) {
      const cycleRest = cycleRestByMonth[emp.name]?.[monthKey] || 0
      const priorRest = priorRestByMonthForCheck[emp.name]?.[monthKey] || 0
      const total = cycleRest + priorRest
      if (total <= monthTarget) continue
      let excess = total - monthTarget

      // 超標月內、本 cycle 內的休假（自己請的假 / 邊界日不動）
      const overshootRestIndices = allAssignments
        .map((a, idx) => ({ a, idx }))
        .filter(({ a }) =>
          a.employee === emp.name &&
          a.date.slice(0, 7) === monthKey &&
          isAbsence(a.shift) && countsAsMonthlyRest(a.shift) &&
          !data.offRequests.find(o => o.employee === a.employee && o.date === a.date) &&
          a.shift !== '未入職' && a.shift !== '已離職'
        )
        // 月底先 swap（最容易破壞月份累計，且離 cycle 邊界近）
        .sort((x, y) => y.a.date.localeCompare(x.a.date))

      // 非超標月、本 cycle 內的工作日（可被換成休假）
      const otherMonthWorkIndices = allAssignments
        .map((a, idx) => ({ a, idx }))
        .filter(({ a }) =>
          a.employee === emp.name &&
          a.date.slice(0, 7) !== monthKey &&
          !isAbsence(a.shift)
        )
        // 跟超標月相對的另一邊月底先換（最自然，靠近月份交界）
        .sort((x, y) => x.a.date.localeCompare(y.a.date))

      let swapped = 0
      const usedWorkIdx = new Set()
      outer:
      for (const restEntry of overshootRestIndices) {
        if (swapped >= excess) break
        // restEntry.date 即將變成上班 — 先檢查 H3
        const consec = consecutiveWorkAtIfWork(emp.name, restEntry.a.date, allAssignments)
        if (consec > MAX_CONSECUTIVE_WORK_DAYS) continue  // 換了會違 H3
        // 找一個工作日跟它互換
        for (const workEntry of otherMonthWorkIndices) {
          if (usedWorkIdx.has(workEntry.idx)) continue
          // 做 swap：restDay 拿 workDay 的 shift，workDay 變成 '休'
          const restA = allAssignments[restEntry.idx]
          const workA = allAssignments[workEntry.idx]
          // ★ OH 檢查：workA 的 shift 時間（可能是假日 19:00-01:00）必須符合
          //   restA.date 那一天的營業時間（平日 close=00:00 就不能裝 01:00）
          //   不檢查就會出現「演算法把假日班搬到平日」的 OH 違規
          if (workA.actual_start && workA.actual_end) {
            const fakeDef = { start_time: workA.actual_start, end_time: workA.actual_end }
            if (!isShiftWithinOH(fakeDef, restA.date, data.storeSettings)) continue
            // ★ max 檢查：把 workA 的 shift 加到 restA.date 不可超該日時段 max
            //   原本 11-15 已 2 人 max=2，再加 11~20 → 3 人超 max → bug
            const slotCovTarget = computeDaySlotCoverage(restA.date, data.timeSlots || [], allAssignments)
            if (slotCovTarget && shiftWouldOverStaff(fakeDef, slotCovTarget, 'hourly')) continue
          }
          // ★ required 檢查：workA 變休後 workA.date 不可掉到 required 之下
          const trialAfterSwap = allAssignments.map((a, i) => {
            if (i === workEntry.idx) return { ...a, shift: '休', actual_start: null, actual_end: null, actual_hours: 0 }
            if (i === restEntry.idx) return { ...a, shift: workA.shift, actual_start: workA.actual_start, actual_end: workA.actual_end, actual_hours: workA.actual_hours }
            return a
          })
          const slotCovWorkDay = computeDaySlotCoverage(workA.date, data.timeSlots || [], trialAfterSwap)
          if (slotCovWorkDay && slotCovWorkDay.some(s => s.covered < s.required_count)) continue
          allAssignments[restEntry.idx] = {
            ...restA,
            shift: workA.shift,
            actual_start: workA.actual_start,
            actual_end: workA.actual_end,
            actual_hours: workA.actual_hours,
          }
          allAssignments[workEntry.idx] = {
            ...workA, shift: '休',
            actual_start: null, actual_end: null, actual_hours: 0,
          }
          usedWorkIdx.add(workEntry.idx)
          swapped++
          console.log(`[Monthly] cross-month swap: ${emp.name} ${restA.date}(休→${workA.shift}) ↔ ${workA.date}(${workA.shift}→休)`)
          continue outer
        }
      }

      if (swapped < excess) {
        allViolations.push({
          employee: emp.name,
          constraint: 'CROSS_MONTH_REST_OVERSHOOT',
          severity: 'warning',
          date: monthKey + '-01',
          message: `${emp.name} ${monthKey} 月實際排休 ${total} 天（上 cycle ${priorRest} + 本 cycle ${cycleRest}），超出 ${isPT ? 'PT' : 'FT'} 目標 ${monthTarget} 天，自動校正了 ${swapped} 天，剩 ${excess - swapped} 天找不到合法 swap（會違 H3），請手動調整`,
        })
      } else if (swapped > 0) {
        console.log(`[Monthly] ${emp.name} ${monthKey} 跨月校正：自動 swap ${swapped} 天，從 ${total} → ${total - swapped} (target ${monthTarget})`)
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 末端正規化：cycle 最後一天的 backward streak ≤5 → 不傳爛 pattern 到下個 cycle
  // ══════════════════════════════════════════════════════════════════════
  // 解的就是「越排越亂」根因：cycle N 末端如果某員工連續工作 6+ 天，
  // cycle N+1 一開頭 backward 就帶著長 streak，hard rule 越早 trigger 但
  // staffing 反而擋掉、結果違 H3。前面 cycle 全綠、第 3 cycle 開始爆
  // 就是這個累積效應。
  //
  // 強制每個員工 cycle 結束時 backward streak ≤3，給下個 cycle 開頭有 3 天緩衝。
  // 原本 ≤5 不夠：cycle N+1 day 1 work → streak 6，day 2 work → 7 違法。
  // 改 ≤3 後：cycle N+1 day 1-3 work → streak 4-6 OK，day 4 才需要休。
  // (診斷 log 顯示 PT 在 cycle 1 用滿 14 天 = 月 cap 15 的 93%，cycle N+1 May
  //  剩餘 budget 只有 1 天 → 連續工作集中爆發。aggressive 末端 swap 強制平均化。)
  const MAX_END_STREAK = 3
  const cycleEndDate = monthDates[monthDates.length - 1]

  // helper：算 emp 從 fromDate 往回的連續工作天（不假設 fromDate 是上班）
  const backwardWorkStreakFrom = (empName, fromDate, currentAssignments) => {
    const aMap = {}
    for (const a of currentAssignments) {
      if (a.employee === empName) aMap[a.date] = a.shift
    }
    let count = 0
    const d = new Date(fromDate)
    while (true) {
      const ds = d.toISOString().slice(0, 10)
      const s = aMap[ds]
      if (!s || isAbsence(s)) break
      count++
      d.setDate(d.getDate() - 1)
    }
    return count
  }

  for (const emp of data.employees) {
    const endStreak = backwardWorkStreakFrom(emp.name, cycleEndDate, allAssignments)
    if (endStreak <= MAX_END_STREAK) continue

    const excess = endStreak - MAX_END_STREAK  // 要從末端 swap 出幾天
    // 候選：末端連續工作日（從 cycleEndDate 往回 endStreak 天）— 排越後面越優先 swap
    const endWorkDays = []
    {
      const d = new Date(cycleEndDate)
      for (let i = 0; i < endStreak; i++) {
        endWorkDays.push(d.toISOString().slice(0, 10))
        d.setDate(d.getDate() - 1)
      }
    }
    // 找早段（cycle 前 2/3）的休假可以 swap 過來
    const earlyCutoff = monthDates[Math.floor(monthDates.length * 2 / 3) - 1]
    const earlyRestEntries = allAssignments
      .map((a, idx) => ({ a, idx }))
      .filter(({ a }) =>
        a.employee === emp.name &&
        a.date <= earlyCutoff &&
        isAbsence(a.shift) && countsAsMonthlyRest(a.shift) &&
        !data.offRequests.find(o => o.employee === a.employee && o.date === a.date) &&
        a.shift !== '未入職' && a.shift !== '已離職'
      )
      // 越早的越優先 swap 過來（給末端更多喘息）
      .sort((x, y) => x.a.date.localeCompare(y.a.date))

    let swapped = 0
    const usedRestIdx = new Set()
    for (const endDate of endWorkDays) {
      if (swapped >= excess) break
      // 找這個末端 endDate 的 assignment
      const endIdx = allAssignments.findIndex(a => a.employee === emp.name && a.date === endDate)
      if (endIdx === -1) continue
      const endA = allAssignments[endIdx]
      if (isAbsence(endA.shift)) continue
      if (data.offRequests.find(o => o.employee === emp.name && o.date === endDate)) continue

      // 跟某個早段休假交換
      for (const restEntry of earlyRestEntries) {
        if (usedRestIdx.has(restEntry.idx)) continue
        const restA = allAssignments[restEntry.idx]
        // ★ OH 檢查：endA 的時間（可能是假日 19:00-01:00）必須符合 restA.date OH
        //   不檢查就會把假日班搬到平日造成 OH 違規
        if (endA.actual_start && endA.actual_end) {
          const fakeDef = { start_time: endA.actual_start, end_time: endA.actual_end }
          if (!isShiftWithinOH(fakeDef, restA.date, data.storeSettings)) continue
          // ★ max 檢查：把 endA 的 shift 加到 restA.date 不可超該日時段 max
          const slotCovTarget = computeDaySlotCoverage(restA.date, data.timeSlots || [], allAssignments)
          if (slotCovTarget && shiftWouldOverStaff(fakeDef, slotCovTarget, 'hourly')) continue
        }
        // 模擬 swap 後：restA.date 變成 endA 的 shift，endA.date 變成休
        // 檢查 swap 後是否會違 H3（restA.date 變上班會不會破連續 ≤6）
        const trialAssignments = allAssignments.map((a, i) => {
          if (i === endIdx) return { ...a, shift: '休', actual_start: null, actual_end: null, actual_hours: 0 }
          if (i === restEntry.idx) return { ...a, shift: endA.shift, actual_start: endA.actual_start, actual_end: endA.actual_end, actual_hours: endA.actual_hours }
          return a
        })
        const newConsec = consecutiveWorkAtIfWork(emp.name, restA.date, trialAssignments)
        if (newConsec > MAX_CONSECUTIVE_WORK_DAYS) continue
        // ★ required 檢查：endA 變休後，endDate 該日各時段不可掉到 required 之下
        //   (修 7/22 7/23 整天 1 人的問題 — cycle-end swap 太貪把 required 砍光)
        const slotCovAfter = computeDaySlotCoverage(endDate, data.timeSlots || [], trialAssignments)
        if (slotCovAfter && slotCovAfter.some(s => s.covered < s.required_count)) continue
        // 通過 → 套用
        allAssignments[endIdx] = trialAssignments[endIdx]
        allAssignments[restEntry.idx] = trialAssignments[restEntry.idx]
        usedRestIdx.add(restEntry.idx)
        swapped++
        console.log(`[Monthly] cycle-end swap: ${emp.name} ${endDate}(${endA.shift}→休) ↔ ${restA.date}(休→${endA.shift})  末端 streak ${endStreak}→${endStreak - swapped}`)
        break
      }
    }

    if (swapped > 0) {
      console.log(`[Monthly] ${emp.name} 末端正規化：swap ${swapped} 天，cycle 末端 streak ${endStreak}→${endStreak - swapped}`)
    } else if (endStreak > MAX_END_STREAK) {
      console.warn(`[Monthly] ${emp.name} 末端 streak=${endStreak} 找不到合法 swap，下個 cycle 可能出 H3`)
    }
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

        // ★ H3 連續上班保護 — 退讓時用，避免 fallback 到違法 (統一 6 天)
        //   退讓到 eligible 是為了「設定異常」case（譬如 can_open=false+can_close=false 員工
        //   + 該店沒中段班）能找到 shift，但 H3 勞基法不能放棄
        const isH3SafeForRA = () => {
          let consec = 1
          // 從 ra.date 往回連續推算同 emp 工作天數
          // ★ Critical fix: 也要看 previousWeek (跨 cycle history)，
          //   不然月初 / cycle 邊界的轉換會漏算上 cycle 連續工作天
          const raDateObj = new Date(ra.date)
          for (let j = 1; j <= 13; j++) {  // 13 天足夠 cover FT 6 天 + 一點 buffer
            const prev = new Date(raDateObj)
            prev.setDate(raDateObj.getDate() - j)
            const prevStr = prev.toISOString().slice(0, 10)
            const s = schedFromAll[emp.name]?.[prevStr]
            if (s) {
              if (isAbsence(s)) break
              consec++
              continue
            }
            // schedFromAll 沒有 → 看 previousWeek
            const prevA = (data.previousWeek || []).find(p => p.employee === emp.name && p.date === prevStr)
            if (prevA && prevA.shift) {
              if (isAbsence(prevA.shift)) break
              consec++
              continue
            }
            break
          }
          // 公司鐵則：FT 也跟 PT 一樣統一七休一 (≤6 天)
          return consec <= MAX_CONSECUTIVE_WORK_DAYS
        }
        const passH3 = isH3SafeForRA()

        // strict (hourly) 找 safe；找不到退到 binary
        const slotCov = computeDaySlotCoverage(ra.date, timeSlotsForCheck, allAssignments)
        let safe = legalEligible.filter(sd => !shiftWouldOverStaff(sd, slotCov, 'hourly'))
        if (safe.length === 0 && slotCov) {
          safe = legalEligible.filter(sd => !shiftWouldOverStaff(sd, slotCov, 'binary'))
        }
        // ★ FT 偏 9h net=8h 排序，避免撿 6h 短班
        //   優先順序: safe(legal+slot) → legalEligible(legal+no slot fit) → eligible(只放 H9)
        //   但連 H3 都不過時直接 null → 保留休，寧可超 cap 也不違反勞基法
        // ★ 寫死不得超過營業時間：每一層 fallback 都用 isShiftWithinOH per-day 過濾
        const inOH = (sd) => isShiftWithinOH(sd, ra.date, data.storeSettings)
        const picked = !passH3
          ? null
          : ((slotCov ? [...safe].filter(inOH).sort(sortBySdFitForFT)[0] : null)
            || [...legalEligible].filter(inOH).sort(sortBySdFitForFT)[0]
            || [...eligible].filter(inOH).sort(sortBySdFitForFT)[0]
            || data.shiftDefs.filter(inOH)[0]
            || null)
        if (picked) {
          ra.shift = picked.name
          ra.actual_start = picked.start_time?.slice(0, 5) || '11:00'
          ra.actual_end = picked.end_time?.slice(0, 5) || '20:00'
          ra.actual_hours = getShiftHours(picked) - (picked.break_minutes || 60) / 60
          // 同步 schedFromAll 給下個 iteration 的 isLegallyValid 看
          if (!schedFromAll[emp.name]) schedFromAll[emp.name] = {}
          schedFromAll[emp.name][ra.date] = picked.name
        } else {
          // ★ 終極 fallback：shift_definitions 無對應 shift → 生成最多 6h window
          // 從 oh.open 起算 6h，但若超過 oh.close 就 clamp 到 oh.close (避免排出超過營業時間)
          const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
          const dow = new Date(ra.date).getDay()
          const oh = data.storeSettings?.operating_hours?.[dayNames[dow]] ||
                     data.storeSettings?.operatingHours?.[dayNames[dow]]
          if (oh?.open && oh?.close) {
            const ohOpenH = parseTime(oh.open)
            const ohCloseH = parseTime(oh.close)
            const ohCloseEff = ohCloseH <= ohOpenH ? ohCloseH + 24 : ohCloseH
            const maxEnd = ohCloseEff
            const desiredEnd = ohOpenH + 6
            const actualEnd = Math.min(desiredEnd, maxEnd)
            const grossH = actualEnd - ohOpenH
            if (grossH >= 4) {  // 至少 4h 才有意義，否則跳過 fallback
              const startStr = oh.open.slice(0, 5)
              const eh = actualEnd % 24
              const ehM = Math.round((eh - Math.floor(eh)) * 60)
              const endStr = `${String(Math.floor(eh)).padStart(2, '0')}:${String(ehM).padStart(2, '0')}`
              ra.shift = `${startStr}~${endStr}`
              ra.actual_start = startStr
              ra.actual_end = endStr
              ra.actual_hours = grossH >= 6 ? grossH - 1 : (grossH >= 4 ? grossH - 0.5 : grossH)
            }
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
      // ★ 用 isWeekendDay (= WEEKEND_DAYS [5,6] = Fri+Sat)，不要 hardcode Sun+Sat
      //   否則 S10 警告會把週日當假日、週五當平日，跟生成端的 timeSlotMode/weeklySchedule 不一致
      const isWE = isWeekendDay(dow)
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

  // ── ★ 末端營業時間防呆斷言（不再 clamp）──
  // 政策：所有 generation path 都已寫死不得超過 OH（tryShift / isShiftAvailable /
  //      runFillUnassignedFT 各層 inOH 過濾）。若這裡還抓到違規，代表某條路徑漏網，
  //      應該回去修「源頭」而非用 clamp 把時數改怪（之前 16:00-01:00 → 16:00-00:00
  //      會少 1h 變奇怪數字）。這裡只記錯誤，不動 actual_start/end。
  const ohViolations = []
  for (const a of allAssignments) {
    if (!a.actual_start || !a.actual_end || isAbsence(a.shift)) continue
    const oh = getOperatingHoursForDate(data.storeSettings, a.date)
    if (!oh?.open || !oh?.close) continue
    const fakeDef = { start_time: a.actual_start, end_time: a.actual_end }
    if (isShiftWithinOH(fakeDef, a.date, data.storeSettings)) continue
    ohViolations.push({
      employee: a.employee,
      constraint: 'OH_VIOLATION',
      date: a.date,
      message: `${a.employee} ${a.date} 班表 ${a.actual_start}-${a.actual_end} 超出營業時間 ${oh.open}-${oh.close}（generation path bug — 不該發生）`,
      severity: 'error',
    })
    console.error(`[OH Violation] generation path leak: ${a.employee} ${a.date}: ${a.actual_start}-${a.actual_end} 不在 ${oh.open}-${oh.close} 內`)
  }

  const monthlyViolations = validateMonthlyResult(allAssignments, data)
  const combinedViolations = [...filteredAllViolations, ...freshS10, ...monthlyViolations, ...ohViolations]
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
