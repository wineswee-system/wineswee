import {
  parseTime, getShiftHours, effectiveEndHour, isNightShift, isAbsence,
  splitIntoWeeks, isWeekendDay, getWorkSystemConstraints,
  DAILY_MAX_HOURS, MAX_CONSECUTIVE_WORK_DAYS, MAX_CONSECUTIVE_WORK_DAYS_FT,
  MIN_SHIFT_INTERVAL, MONTHLY_OVERTIME_CAP,
  formatShiftLabel, parseShiftRange, isPartTime,
} from '../scheduleUtils'

export function isLegallyValid(emp, shiftDef, date, schedule, allShiftDefs, weekDates, data) {
  const isPT = isPartTime(emp)
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

  // H16: Day type match (平日/假日班)
  if (shiftDef.day_type && shiftDef.day_type !== 'all') {
    const dow = new Date(date).getDay()
    const isWE = isWeekendDay(dow)
    if (shiftDef.day_type === 'weekday' && isWE) return false
    if (shiftDef.day_type === 'weekend' && !isWE) return false
  }

  // H9: can_open / can_close — only block if EXPLICITLY set to false (not null/undefined)
  const startH = parseTime(shiftDef.start_time)
  const endH = parseTime(shiftDef.end_time)
  if (startH <= 9 && emp.can_open === false) return false
  if ((endH >= 21 || endH < startH) && emp.can_close === false) return false

  // H13: Pregnant/nursing → no night shifts
  if ((emp.is_pregnant || emp.is_nursing) && isNightShift(shiftDef)) return false

  // H2: Daily hours ≤ absolute max
  if (getShiftHours(shiftDef) > wsc.dailyAbsoluteMax) return false

  // H3: Consecutive work days ≤ 6 (PT) / 12 (FT)
  // ★ 修：原本只有 dateIdx===0 才回看 previousWeek，導致跨週連續工作沒算到
  //   → 不管 dateIdx，只要在 current week 沒找到 rest 就一路往 previousWeek 回看
  const dateIdx = weekDates.indexOf(date)
  let consec = 1
  let reachedStart = true  // 是否往回走到當週起點都沒遇到 rest
  for (let i = dateIdx - 1; i >= 0; i--) {
    const s = schedule[emp.name][weekDates[i]]
    if (s && !isAbsence(s)) consec++
    else { reachedStart = false; break }
  }
  if (reachedStart && data.previousWeek) {
    const prevAssignments = data.previousWeek
      .filter(a => a.employee === emp.name)
      .sort((a, b) => b.date.localeCompare(a.date))
    const weekStartDate = new Date(weekDates[0])
    for (const a of prevAssignments) {
      const prevDate = new Date(a.date)
      const daysBefore = Math.round((weekStartDate - prevDate) / 86400000)
      // daysBefore 必須跟 consec - dateIdx 對齊（連續日）
      if (daysBefore !== consec - dateIdx) break
      if (!isAbsence(a.shift)) consec++
      else break
    }
  }
  const maxConsec = isPT ? MAX_CONSECUTIVE_WORK_DAYS : MAX_CONSECUTIVE_WORK_DAYS_FT
  if (consec > maxConsec) {
    // [DBG H3] 臨時 log — 印出哪個 emp 哪天 H3 擋住，方便驗證演算法跑時真的呼叫到
    if (typeof console !== 'undefined' && console.log) {
      console.log(`[DBG H3] BLOCKED ${emp.name} ${date}: consec=${consec} > max=${maxConsec} (${isPT ? 'PT' : 'FT'})`)
    }
    return false
  }

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

  const targetH = isPT ? 40 : 48
  const buffer = wsc.canConcentrateRest
    ? Math.max(8, Math.round(targetH * 0.3))
    : Math.max(4, Math.round(targetH * 0.15))
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

export function validateResult(assignments, data) {
  const violations = []
  const { employees, shiftDefs, weekDates, offRequests, storeSettings, staffingRules = [] } = data

  // shiftDefMap：raw name 跟 normalized name 都當 key，避免 ~ vs - 不匹配
  // 譬如 shift_def.name='10:30-19:30' 跟 a.shift='10:30~19:30' 都能 lookup 到
  const shiftDefMap = {}
  for (const d of shiftDefs) {
    shiftDefMap[d.name] = d
    const normalized = formatShiftLabel(d.name)
    if (normalized !== d.name && !shiftDefMap[normalized]) shiftDefMap[normalized] = d
  }
  const lookupShiftDef = (shiftName) => shiftDefMap[shiftName] || shiftDefMap[formatShiftLabel(shiftName)] || null

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
      const def = lookupShiftDef(a.shift)
      if (def && getShiftHours(def) > DAILY_MAX_HOURS) {
        violations.push({ employee: emp.name, constraint: 'H2', law: '勞基法 §32', message: `${emp.name} ${a.date}: ${getShiftHours(def).toFixed(1)}h 超過每日上限 ${DAILY_MAX_HOURS}h`, severity: 'error' })
      }
    }

    // H3: Consecutive work days（正職 12 天 / 兼職 6 天）
    // ★ 從 previousWeek 末尾往回算連續上班，避免跨週連續沒抓到
    //   (PT 5/16-5/23 連 8 天，Week 4 5/18 開始 consec reset → 漏擋)
    const empIsPT = isPartTime(emp)
    const empMaxConsec = empIsPT ? MAX_CONSECUTIVE_WORK_DAYS : MAX_CONSECUTIVE_WORK_DAYS_FT
    let consec = 0
    if (data.previousWeek) {
      const prevSorted = (data.previousWeek || [])
        .filter(a => a.employee === emp.name)
        .sort((a, b) => b.date.localeCompare(a.date))
      const weekStartDate = new Date(weekDates[0])
      for (const a of prevSorted) {
        const prevDate = new Date(a.date)
        const daysBefore = Math.round((weekStartDate - prevDate) / 86400000)
        if (daysBefore !== consec + 1) break  // 不連續就停
        if (isAbsence(a.shift)) break
        consec++
      }
    }
    for (const date of weekDates) {
      const a = empAssignments.find(a => a.date === date)
      if (a && !isAbsence(a.shift)) {
        consec++
        if (consec > empMaxConsec) {
          violations.push({ employee: emp.name, constraint: 'H3', law: '勞基法 §36', message: `${emp.name} 連續上班 ${consec} 天（上限 ${empMaxConsec} 天）`, severity: 'error' })
        }
      } else consec = 0
    }

    // H4: Cross-day shift gap
    for (let i = 0; i < weekDates.length - 1; i++) {
      const todayA = empAssignments.find(a => a.date === weekDates[i])
      const tomorrowA = empAssignments.find(a => a.date === weekDates[i + 1])
      if (!todayA || isAbsence(todayA.shift) || !tomorrowA || isAbsence(tomorrowA.shift)) continue
      const todayDef = lookupShiftDef(todayA.shift)
      const tomorrowDef = lookupShiftDef(tomorrowA.shift)
      if (!todayDef || !tomorrowDef) continue
      const gap = (parseTime(tomorrowDef.start_time) + 24) - effectiveEndHour(todayDef)
      if (gap < MIN_SHIFT_INTERVAL) {
        violations.push({ employee: emp.name, constraint: 'H4', law: '勞基法 §34', message: `${emp.name} ${weekDates[i]}→${weekDates[i + 1]}: 間隔 ${gap.toFixed(1)}h（需 ≥${MIN_SHIFT_INTERVAL}h）`, severity: 'error' })
      }
    }

    // H13: Pregnant/nursing night shifts
    if (emp.is_pregnant || emp.is_nursing) {
      for (const a of workEntries) {
        const def = lookupShiftDef(a.shift)
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
        // [DBG S10] 收集每個 entry 的判斷結果，警告時印出來
        const _dbg = []
        const covering = assignments.filter(a => {
          if (a.date !== date || isAbsence(a.shift)) return false
          let startH = a.actual_start ? parseTime(a.actual_start) : null
          let endH = a.actual_end ? parseTime(a.actual_end) : null
          let src = 'actual'
          // Fallback：a.shift 對應到一個 shift_def 但 actual_start/end 是 null
          if (startH == null || endH == null) {
            const def = lookupShiftDef(a.shift)
            if (def) { startH = parseTime(def.start_time); endH = parseTime(def.end_time); src = 'shiftDef' }
          }
          // 終極 fallback：shift 本身是時段範圍 label → 直接 parse
          if (startH == null || endH == null) {
            const parsed = parseShiftRange(a.shift)
            if (parsed) { startH = parseTime(parsed.start); endH = parseTime(parsed.end); src = 'parseRange' }
          }
          if (startH == null || endH == null) {
            _dbg.push({ emp: a.employee, shift: a.shift, actual_start: a.actual_start, actual_end: a.actual_end, result: 'NULL_TIMES' })
            return false
          }
          const endEff = endH <= startH ? endH + 24 : endH
          const cover = startH < slotEndEff && endEff > slotStart
          _dbg.push({ emp: a.employee, shift: a.shift, src, startH, endH: endEff, cover })
          return cover
        }).length
        if (covering < slot.required_count) {
          if (typeof console !== 'undefined' && console.log) {
            console.log(`[DBG S10] ${date} ${slot.start_time}-${slot.end_time} cov=${covering}/${slot.required_count}`, _dbg)
          }
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
      const hasOpener = dayWorkers.some(a => {
        const startH = a.actual_start ? parseTime(a.actual_start) : null
        if (startH == null) return false
        return Math.abs(startH - storeOpenH) < 0.5 &&
          employees.find(e => e.name === a.employee)?.can_open
      })
      if (!hasOpener) {
        violations.push({ employee: '-', constraint: 'S8', law: '營運需求', message: `${date}: 無開店資格人員（${oh?.open || '11:00'} 開店）`, severity: 'warning' })
      }

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

export function validateMonthlyResult(assignments, data) {
  const violations = []
  const { employees, shiftDefs, storeSettings } = data
  const wsm = getWorkSystemConstraints(storeSettings?.work_hour_system || '標準工時')

  // shiftDefMap：raw name 跟 normalized name 都當 key，避免 ~ vs - 不匹配
  // 譬如 shift_def.name='10:30-19:30' 跟 a.shift='10:30~19:30' 都能 lookup 到
  const shiftDefMap = {}
  for (const d of shiftDefs) {
    shiftDefMap[d.name] = d
    const normalized = formatShiftLabel(d.name)
    if (normalized !== d.name && !shiftDefMap[normalized]) shiftDefMap[normalized] = d
  }
  const lookupShiftDef = (shiftName) => shiftDefMap[shiftName] || shiftDefMap[formatShiftLabel(shiftName)] || null

  for (const emp of employees) {
    // 排除邊界日（未入職 / 已離職）— 員工尚未/不再服務於公司，不算進任何月制驗證
    const empAssignments = assignments.filter(a =>
      a.employee === emp.name && a.shift !== '未入職' && a.shift !== '已離職'
    )
    const workEntries = empAssignments.filter(a => !isAbsence(a.shift))
    const restEntries = empAssignments.filter(a => isAbsence(a.shift))

    // H6: Monthly overtime cap
    let totalHours = 0
    for (const a of workEntries) {
      const def = lookupShiftDef(a.shift)
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
      // ★ cycle 剛好 = 1 個 period (譬如 4 週變形 cycle 28 天 = 1 個 4 週 period)
      //   → 整 cycle 一次算，不用 sliding window（不然 splitIntoWeeks 切 partial
      //   weeks [3,7,7,7,4] → sliding 4-week = 24 或 25 天 → 誤觸發違規）
      const fullPeriodDays = wsm.periodWeeks * 7
      if (empAssignments.length === fullPeriodDays) {
        let cycleHours = 0
        for (const a of workEntries) {
          const def = lookupShiftDef(a.shift)
          cycleHours += def ? getShiftHours(def) - (def.break_minutes || 60) / 60 : 8
        }
        if (cycleHours > wsm.periodTotalHours) {
          violations.push({
            employee: emp.name, constraint: 'H11', law: `勞基法 §30-3（${wsm.periodWeeks}週變形）`,
            message: `${emp.name}: cycle ${wsm.periodWeeks}週工時 ${cycleHours.toFixed(1)}h 超過上限 ${wsm.periodTotalHours}h`,
            severity: 'error',
          })
        }
        if (restEntries.length < wsm.periodRestDays) {
          violations.push({
            employee: emp.name, constraint: 'H11', law: `勞基法 §30-3（${wsm.periodWeeks}週變形）`,
            message: `${emp.name}: cycle ${wsm.periodWeeks}週僅 ${restEntries.length} 天休假（需 ≥${wsm.periodRestDays} 天）`,
            severity: 'error',
          })
        }
        // 整 cycle 算完直接結束 H11 區塊，跳過 sliding window
      } else {
      const weeks = splitIntoWeeks(empAssignments.map(a => a.date).sort())
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
            const def = lookupShiftDef(a.shift)
            periodHours += def ? getShiftHours(def) - (def.break_minutes || 60) / 60 : 8
          }
        }
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
          break
        }
      }

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
      }  // end of else (sliding window path)
    }

    // H17: Monthly rest day check
    const totalDays = empAssignments.length
    const empIsPT_H17 = isPartTime(emp)
    const ftRestMin = data.storeSettings?.ft_monthly_rest_days ?? 10
    const ptRestMax = data.storeSettings?.pt_monthly_rest_days ?? 20
    const expectedDays = Math.round(totalDays / 30 * (empIsPT_H17 ? ptRestMax : ftRestMin))

    if (empIsPT_H17) {
      if (restEntries.length > expectedDays + 2) {
        violations.push({
          employee: emp.name, constraint: 'H17', law: '門市規定',
          message: `${emp.name}: 本月 ${restEntries.length} 天休假，超過上限 ${ptRestMax} 天`,
          severity: 'error',
        })
      }
    } else {
      if (restEntries.length < expectedDays - 1 && totalDays >= 7) {
        violations.push({
          employee: emp.name, constraint: 'H17', law: '門市規定',
          message: `${emp.name}: 本月僅 ${restEntries.length} 天休假，不足 ${ftRestMin} 天`,
          severity: 'error',
        })
      } else if (restEntries.length > expectedDays + 2) {
        violations.push({
          employee: emp.name, constraint: 'H17', law: '門市規定',
          message: `${emp.name}: 本月 ${restEntries.length} 天休假，超過 ${ftRestMin} 天`,
          severity: 'warning',
        })
      }
    }

    // S5: Monthly hours check
    // 對 cycle 制（譬如 4 週變形 28 天）按比例 prorate：28/30 × 150 = 140h
    // 之前 >=28 即視為 full month → cycle 28 天誤判工時不足；改成 >=30 才算 full
    const isPT = isPartTime(emp)
    const monthlyMin = isPT ? 80 : 150
    const monthlyMax = 175
    const dayRatio = totalDays >= 30 ? 1 : totalDays / 30
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
    // ★ 對 4 週變形等 cycle 制，整 cycle 內 FT 全週上班是必然 → 容忍到 cycle 週數
    //   譬如 4 週變形 cycle 5 weeks (partial split) → 容忍 ≥ 5 週才警告
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
    // cycle 制下，整 cycle 內所有 weeks 都連續週末上班是正常 → 提高門檻
    const s9Threshold = wsm.periodWeeks > 1 ? Math.max(3, weeks.length + 1) : 3
    if (maxConsecWE >= s9Threshold) {
      violations.push({
        employee: emp.name, constraint: 'S9', law: '公平性',
        message: `${emp.name}: 連續 ${maxConsecWE} 週排假日班（建議 ≤ 2 週）`,
        severity: 'warning',
      })
    }
  }

  return violations
}
