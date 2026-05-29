/**
 * Time Slot Coverage Mode (時段覆蓋制)
 * Assigns employee shifts by covering required time slots for a single day.
 * Called by weeklySchedule.js when timeSlots.length > 0.
 */

import {
  parseTime, isAbsence, countsAsMonthlyRest,
  isWeekendDay, MIN_SHIFT_INTERVAL, isPartTime,
} from '../scheduleUtils'
import { isLegallyValid } from './validation'

export const isPTEmp = isPartTime

function fmtH(h) {
  return `${String(Math.floor(h % 24)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`
}

function fmtLabel(startTime, endTime) {
  const s = startTime.replace(':00', '').replace(/^0/, '')
  const e = endTime.replace(':00', '').replace(/^0/, '')
  return `${s}~${e}`
}

function overlaps(wStart, wEnd, sStart, sEnd) {
  const ws = parseTime(wStart), we = parseTime(wEnd)
  const ss = parseTime(sStart), se = parseTime(sEnd)
  const weEff = we <= ws ? we + 24 : we
  const seEff = se <= ss ? se + 24 : se
  return ws < seEff && weEff > ss
}

/**
 * Run the time-slot coverage assignment for all dates in the week.
 * Mutates `schedule` and `actualTimes` in place.
 *
 * Phase 1: opener / Phase 2: closer / Phase 3: first-fit-fills-gap
 */
export function runTimeSlotMode(ctx) {
  const {
    employees, weekDates, timeSlots, storeSettings,
    schedule, actualTimes, restDayPlan,
    hoursRange, monthlyCtx, monthTargetMap,
    monthRestTarget, monthRestCap, wsConstraints, shiftDefs, data,
  } = ctx

  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

  const getSlotsForDate = (date) => {
    const dow = new Date(date).getDay()
    const isWE = isWeekendDay(dow)
    return timeSlots.filter(s =>
      s.day_type === 'all' || (s.day_type === 'weekend' && isWE) || (s.day_type === 'weekday' && !isWE)
    ).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
  }

  const getEmpWeekHours = (empName) => {
    let h = 0
    for (const d of weekDates) {
      const s = schedule[empName][d]
      if (s && !isAbsence(s)) {
        const times = actualTimes[`${empName}_${d}`]
        if (times?.hours) h += times.hours
        else h += 8
      }
    }
    return h
  }

  const sortByNeed = (list) => [...list].sort((a, b) => {
    const aIsPT = isPTEmp(a) ? 1 : 0
    const bIsPT = isPTEmp(b) ? 1 : 0
    if (aIsPT !== bIsPT) return aIsPT - bIsPT
    // 用「月累積工時 vs 月 min」算缺口，累積落後的優先（避免 stable sort 因 name
    // 順序偏袒同一個 emp、其他人 fill=0 排休 — 譬如許辰排在第 4 永遠 fill=0 那種）
    const aMonthAcc = (monthlyCtx?.hoursAccumulated?.[a.name] || 0) + getEmpWeekHours(a.name)
    const bMonthAcc = (monthlyCtx?.hoursAccumulated?.[b.name] || 0) + getEmpWeekHours(b.name)
    const aMonthMin = monthTargetMap[a.name]?.min || (aIsPT ? 80 : 150)
    const bMonthMin = monthTargetMap[b.name]?.min || (bIsPT ? 80 : 150)
    const aDef = aMonthMin - aMonthAcc
    const bDef = bMonthMin - bMonthAcc
    return bDef - aDef  // 月缺口大的先排
  })

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

    // ── Hourly-precise slot coverage ──
    // slot.covered = min headcount across half-hour buckets within the slot
    // hourlyBuckets[b] = number of employees working during half-hour b (mod 48)
    // 修真實 bug：原本用 binary overlap 算 covered → 22-01 slot 內 15-0 + 19-1
    //  → covered=2 = required，但 00-01 實際只有 1 人 → 誤判已滿不會補位
    const slotCoverage = daySlots.map(s => {
      const ss = parseTime(s.start_time)
      const se = parseTime(s.end_time)
      const seEff = se <= ss ? se + 24 : se
      const sb = Math.floor(ss * 2), eb = Math.floor(seEff * 2)
      return { ...s, covered: 0, coveredHourly: new Array(eb - sb).fill(0), _startBucket: sb, _endBucket: eb }
    })
    const hourlyBuckets = new Array(48).fill(0)

    const refreshCoverage = () => {
      hourlyBuckets.fill(0)
      for (const emp of employees) {
        const s = schedule[emp.name][date]
        if (!s || isAbsence(s)) continue
        const t = actualTimes[`${emp.name}_${date}`]
        if (!t?.start || !t?.end) continue
        const startH = parseTime(t.start), endH = parseTime(t.end)
        const effEnd = endH <= startH ? endH + 24 : endH
        const sb = Math.floor(startH * 2), eb = Math.floor(effEnd * 2)
        for (let b = sb; b < eb; b++) hourlyBuckets[b % 48]++
      }
      for (const slot of slotCoverage) {
        let min = Infinity
        for (let i = 0; i < slot.coveredHourly.length; i++) {
          const b = slot._startBucket + i
          const cnt = hourlyBuckets[b % 48]
          slot.coveredHourly[i] = cnt
          if (cnt < min) min = cnt
        }
        slot.covered = min === Infinity ? 0 : min
      }
    }
    refreshCoverage()

    // (移除舊的 hasOpener/hasCloser flags — Phase 1/2 改用 openReq/closeReq 補到 required 為止)

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
      // ★ 寫死不得超過營業時間：startH/endH 必須完全落在 [storeOpenH, effectiveCloseH] 內。
      //   只留 0.01h 浮點 rounding tolerance；不再給 0.5h 寬限（會超 30 分）。
      if (startH < storeOpenH - 0.01) return null
      if (endH > effectiveCloseH + 0.01) return null
      if (grossH > wsConstraints.dailyAbsoluteMax) return null
      const weekHours = getEmpWeekHours(emp.name)
      if (weekHours + netH > hoursRange[emp.name].max + 2) return null
      // UI 是 checkbox（勾=可、沒勾=不可）→ null 視同沒勾 = 不可
      if (emp.can_open !== true && startH < storeOpenH + 2) return null
      if (emp.can_close !== true && endH > effectiveCloseH - 2) return null
      const dateIdx = weekDates.indexOf(date)
      if (dateIdx > 0) {
        const prevT = actualTimes[`${emp.name}_${weekDates[dateIdx - 1]}`]
        if (prevT) {
          const prevEndH = parseTime(prevT.end)
          const effPrevEnd = prevEndH < parseTime(prevT.start) ? prevEndH + 24 : prevEndH
          if ((startH + 24) - effPrevEnd < MIN_SHIFT_INTERVAL) return null
        }
      }
      // ★ 連續上班天數 hard check（PT 6 / FT 12）— 時段制原本沒檢查 ★
      const fakeShiftDef = {
        name: '__time_slot_window__',
        start_time: fmtH(startH),
        end_time: fmtH(endH),
        break_minutes: (grossH - netH) * 60,
      }
      if (!isLegallyValid(emp, fakeShiftDef, date, schedule, shiftDefs, weekDates, data)) return null
      return { start: fmtH(startH), end: fmtH(endH), netH, grossH, breakH: grossH - netH }
    }

    const doAssign = (emp, window) => {
      schedule[emp.name][date] = fmtLabel(window.start, window.end)
      actualTimes[`${emp.name}_${date}`] = { start: window.start, end: window.end, hours: window.netH }
      refreshCoverage()  // hourly buckets + slot.covered 重算
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

    // hourly-precise wouldOver — Phase 1/2/3 共用，判斷 window 加入後是否會讓
    // 某個 slot 內某個 half-hour bucket 超過 max_count
    const wouldOverHourly = (window) => {
      const ws = parseTime(window.start), we = parseTime(window.end)
      const weEff = we <= ws ? we + 24 : we
      const winSb = Math.floor(ws * 2), winEb = Math.floor(weEff * 2)
      for (const slot of slotCoverage) {
        const maxC = slot.max_count || slot.required_count + 2
        const ovStart = Math.max(winSb, slot._startBucket)
        const ovEnd = Math.min(winEb, slot._endBucket)
        for (let b = ovStart; b < ovEnd; b++) {
          if (slot.coveredHourly[b - slot._startBucket] + 1 > maxC) return true
        }
      }
      return false
    }

    // ★ 找該日「最早 slot」(store-open) 跟「最晚 slot」(store-close) 的 required_count
    //   Phase 1/2 要補到 required 為止，不能一個就 break（早班 / 關班 req=2 case）
    const openSlot = daySlots.find(s => parseTime(s.start_time) <= storeOpenH + 0.1)
    const openReq = openSlot?.required_count || 1
    const closeSlot = daySlots.slice().reverse().find(s => {
      const se = parseTime(s.end_time)
      const seEff = se <= parseTime(s.start_time) ? se + 24 : se
      return seEff >= effectiveCloseH - 0.1
    })
    const closeReq = closeSlot?.required_count || 1

    // Phase 1: 開店人員 — 補到 openReq 為止
    // PT 偏好 6h，需要時自動放寬到 7-9h（仍受 maxGrossH 跟 H 系列規則擋）
    // 加 wouldOverHourly 跟 Phase 3 對齊 — 避免 partial bucket over-staff
    let openerCount = 0
    for (const emp of employees) {
      const t = actualTimes[`${emp.name}_${date}`]
      if (t && Math.abs(parseTime(t.start) - storeOpenH) < 0.5) openerCount++
    }
    if (openerCount < openReq) {
      const ptGrossOptions = [6, 7, 8, 9]
      let added = 0
      const need = openReq - openerCount
      while (added < need) {
        const openers = sortByNeed(employees.filter(e =>
          e.can_open === true && !schedule[e.name]?.[date] && !restDayPlan[e.name].has(date)
        ))
        let placedThisRound = false
        for (const emp of openers) {
          const grossOptions = isPTEmp(emp) ? ptGrossOptions.filter(h => h <= maxGrossH) : [calcFTGross(emp.name)]
          let assigned = false
          for (const grossH of grossOptions) {
            const window = tryShift(emp, storeOpenH, grossH)
            if (window && !wouldOverHourly(window) && scoreCoverage(window.start, window.end) > -50) {
              doAssign(emp, window)
              if (date === weekDates[0]) console.log(`[DBG ${date}] Phase1 opener#${openerCount + added + 1}: ${emp.name} → ${window.start}~${window.end}`)
              assigned = true
              placedThisRound = true
              added++
              break
            }
          }
          if (assigned) break
        }
        if (!placedThisRound) break  // 沒人能再開店 → 退出
      }
    }

    // Phase 2: 關店人員 — 補到 closeReq 為止，加 wouldOverHourly 避免 over-staff
    let closerCount = 0
    for (const emp of employees) {
      const t = actualTimes[`${emp.name}_${date}`]
      if (!t) continue
      const tStartH = parseTime(t.start)
      const tEndH = parseTime(t.end)
      const effEnd = tEndH <= tStartH ? tEndH + 24 : tEndH
      if (effEnd >= effectiveCloseH - 0.5) closerCount++
    }
    if (closerCount < closeReq) {
      const ptGrossOptions = [6, 7, 8, 9]
      let added = 0
      const need = closeReq - closerCount
      while (added < need) {
        const closers = sortByNeed(employees.filter(e =>
          e.can_close === true && !schedule[e.name]?.[date] && !restDayPlan[e.name].has(date)
        ))
        let placedThisRound = false
        for (const emp of closers) {
          const grossOptions = isPTEmp(emp) ? ptGrossOptions.filter(h => h <= maxGrossH) : [calcFTGross(emp.name)]
          let assigned = false
          for (const grossH of grossOptions) {
            const startH = effectiveCloseH - grossH
            if (startH < storeOpenH) continue
            const window = tryShift(emp, startH, grossH)
            if (window && !wouldOverHourly(window) && scoreCoverage(window.start, window.end) > -50) {
              doAssign(emp, window)
              if (date === weekDates[0]) console.log(`[DBG ${date}] Phase2 closer#${closerCount + added + 1}: ${emp.name} → ${window.start}~${window.end}`)
              assigned = true
              placedThisRound = true
              added++
              break
            }
          }
          if (assigned) break
        }
        if (!placedThisRound) break  // 沒人能再關店 → 退出
      }
    }
    if (date === weekDates[0]) {
      const summary = employees.map(e => `${e.name}=${schedule[e.name][date] || '空'}`).join(' | ')
      const cov = slotCoverage.map(s => `${s.start_time?.slice(0,5)}=${s.covered}/${s.required_count}/max${s.max_count ?? 'NULL'}`).join(' ')
      console.log(`[DBG ${date}] After Phase1+2: ${summary} | slotCov: ${cov}`)
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
        // PT 排休 cap (= ptMax)，FT 用 target (= ftMin)
        const monthRestLimit = monthRestCap[emp.name] || 15

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

      // ★ first-fit-fills-gap：對每個 emp 掃時間軸找「能填到某個缺人 slot 且不會 over」的第一個 window
      // PT 偏好 6h 但「需要時」自動放寬到 7-9h；最後才退回 5h/4h 短班
      const ftIdeal = calcFTGross(emp.name)
      const grossDurations = pt
        ? [6, 7, 8, 9, 5, 4].filter(h => h <= maxGrossH)
        : [ftIdeal, 9].filter(h => h <= maxGrossH)

      // hourly-precise：對每個 slot 內、window 也涵蓋的 bucket 檢查 +1 是否超 max
      // （之前每個 candidate window 都 print 一行 → log 爆量，現在拿掉 per-window log；
      //   若需要 debug 看 chosen=null 那段 summary 已足夠）
      const wouldOver = (window) => {
        const ws = parseTime(window.start), we = parseTime(window.end)
        const weEff = we <= ws ? we + 24 : we
        const winSb = Math.floor(ws * 2), winEb = Math.floor(weEff * 2)
        for (const slot of slotCoverage) {
          const maxC = slot.max_count || slot.required_count + 2
          const ovStart = Math.max(winSb, slot._startBucket)
          const ovEnd = Math.min(winEb, slot._endBucket)
          for (let b = ovStart; b < ovEnd; b++) {
            if (slot.coveredHourly[b - slot._startBucket] + 1 > maxC) return true
          }
        }
        return false
      }
      // ★ Set cover greedy：列所有 valid window，選補最多 deficit bucket 的
      // Score = 該 window 內 cov < required 的 bucket 數量（純粹數補位量，沒 weight）
      // Tiebreaker: fill 同 → grossH 越接近 PT 標準 6h 越好（避免 4h 短班被偏好
      //             讓 PT 月工時 < min）→ startH 大者勝（晚 start 優先）
      // 自動行為：
      //   - opener slot 缺人 → fill 高 → 自動排成 opener
      //   - closer slot 缺人 → fill 高 → 自動排成 closer
      //   - 頭重腳輕 → fill 偏 deficit 那邊 → 自動補晚班
      //   - PT 偏好 6h 班，需要時才用 7-9h 或 4-5h
      //   - fill = 0 → 該 emp 沒地方補 (PT 排休、FT 留空 Step3b 補)
      const computeFill = (window) => {
        const ws = parseTime(window.start), we = parseTime(window.end)
        const weEff = we <= ws ? we + 24 : we
        const winSb = Math.floor(ws * 2), winEb = Math.floor(weEff * 2)
        let count = 0
        let weightedScore = 0  // ★ 同 fill 數時，required_count 高的 slot 優先補
        for (const slot of slotCoverage) {
          const ovStart = Math.max(winSb, slot._startBucket)
          const ovEnd = Math.min(winEb, slot._endBucket)
          for (let b = ovStart; b < ovEnd; b++) {
            if (slot.coveredHourly[b - slot._startBucket] < slot.required_count) {
              count++
              weightedScore += slot.required_count  // required=2 → 加 2, required=1 → 加 1
            }
          }
        }
        return { count, weightedScore }
      }
      // grossH 偏離 6h 的距離 — 越小越好（PT 標準 6h，FT 9h 也接近）
      const grossDistance = (grossH) => Math.abs(grossH - 6)

      let chosen = null  // { window, fill, weightedScore, grossH, h, distance }
      for (const grossH of grossDurations) {
        for (let h = storeOpenH; h <= effectiveCloseH - grossH; h += 0.5) {
          const window = tryShift(emp, h, grossH)
          if (!window) continue
          if (wouldOver(window)) continue
          const { count: fill, weightedScore } = computeFill(window)
          if (fill <= 0) continue
          const distance = grossDistance(grossH)
          // tiebreaker: fill 大者 → weightedScore 大者（補 required 高的 slot）
          //   → distance 小者 → start 早者勝（之前 h > chosen.h 反了，導致 5/13
          //     詹怡理 fill 同時偏 15-00 而不是 11-20，11-14 缺位沒被補）
          if (!chosen ||
              fill > chosen.fill ||
              (fill === chosen.fill && weightedScore > chosen.weightedScore) ||
              (fill === chosen.fill && weightedScore === chosen.weightedScore && distance < chosen.distance) ||
              (fill === chosen.fill && weightedScore === chosen.weightedScore && distance === chosen.distance && h < chosen.h)) {
            chosen = { window, fill, weightedScore, grossH, h, distance }
          }
        }
      }
      const chosenWindow = chosen?.window || null
      if (chosen && date === weekDates[0]) {
        console.log(`[DBG ${date}] Phase3 ${emp.name} setcover: fill=${chosen.fill} grossH=${chosen.grossH} → ${chosenWindow.start}~${chosenWindow.end}`)
      }

      if (chosenWindow) {
        doAssign(emp, chosenWindow)
        if (date === weekDates[0]) console.log(`[DBG ${date}] Phase3 ${emp.name} ${pt?'(PT)':''} → ${chosenWindow.start}~${chosenWindow.end}`)
      } else {
        if (!isPTEmp(emp)) {
          if (date === weekDates[0]) console.log(`[DBG ${date}] Phase3 ${emp.name} 找不到 window → 留空`)
        }
        else {
          // ★ PT fill=0：先 check 月休是否已達 cap，達到不能再休（避免許辰那種 5/23 極端）
          const prevRest = monthlyCtx?.restDaysUsed?.[emp.name] || 0
          const thisWeekRest = Object.values(schedule[emp.name]).filter(s => s && countsAsMonthlyRest(s)).length
          const totalRestSoFar = prevRest + thisWeekRest
          const cap = monthRestCap[emp.name] || 15
          if (totalRestSoFar >= cap) {
            // 月休已達 cap → 強制找任意 not-over valid window 上班（即使該 emp can_open=false 等限制）
            let forceWindow = null
            for (const grossH of [6, 5, 7, 4, 8, 9]) {
              if (grossH > maxGrossH) continue
              for (let h = storeOpenH; h <= effectiveCloseH - grossH; h += 0.5) {
                const w = tryShift(emp, h, grossH)
                if (w && !wouldOverHourly(w)) { forceWindow = w; break }
              }
              if (forceWindow) break
            }
            if (forceWindow) {
              doAssign(emp, forceWindow)
              if (date === weekDates[0]) console.log(`[DBG ${date}] Phase3 ${emp.name} (PT) cap 已達 → 強制 ${forceWindow.start}~${forceWindow.end}`)
            } else {
              schedule[emp.name][date] = '休'  // 真找不到才休（會超 cap 但無解）
              if (date === weekDates[0]) console.log(`[DBG ${date}] Phase3 ${emp.name} (PT) cap 已達但找不到 window → 仍休`)
            }
          } else {
            schedule[emp.name][date] = '休'
            if (date === weekDates[0]) console.log(`[DBG ${date}] Phase3 ${emp.name} (PT) → 休`)
          }
        }
      }
    }
    if (date === weekDates[0]) {
      const summary = employees.map(e => `${e.name}=${schedule[e.name][date] || '空'}`).join(' | ')
      const cov = slotCoverage.map(s => `${s.start_time?.slice(0,5)}=${s.covered}/${s.required_count}`).join(' ')
      console.log(`[DBG ${date}] After Phase3: ${summary} | slotCov: ${cov}`)
    }
  }
}
