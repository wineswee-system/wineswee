/**
 * AI Scheduler Orchestrator (Client-Side)
 *
 * Supports both weekly and monthly scheduling:
 * 1. Trigger — user clicks "AI 自動排班"
 * 2. Data gathering — fetches schedules, leave, availability, preferences
 * 3. Edge function call → client fallback (prompt → Gemini → validation → retry)
 * 4. Result handling — displays draft with violations/warnings
 * 5. Fix violations — re-runs with violation context if needed
 *
 * Monthly mode: processes the month in weekly chunks with carry-forward context.
 * Falls back to client-side Gemini call if edge function is unavailable.
 */

import { supabase } from './supabase'
import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  parseTime, getShiftHours, effectiveEndHour, isNightShift, isAbsence,
  splitIntoWeeks, ABSENCE_TYPES, MONTHLY_OVERTIME_CAP, MONTHLY_REST_DAYS_TARGET,
  MIN_SHIFT_INTERVAL, MAX_CONSECUTIVE_WORK_DAYS, MIN_WEEKLY_REST_DAYS,
  DAILY_MAX_HOURS, canWorkAtStore, getCrossStoreEligible,
} from './scheduleUtils'

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY

// ══════════════════════════════════════════════════════════════
//  Phase 2: Data Gathering
// ══════════════════════════════════════════════════════════════

/**
 * Gather all data needed for AI scheduling.
 * Supports both weekly (weekDates) and monthly (monthDates) modes.
 */
export async function gatherSchedulingData({
  weekDates,
  monthDates,
  employees,
  shiftDefs,
  storeFilter,
  locations,
  minStaff,
  tenantId,
}) {
  const dates = monthDates || weekDates
  const dateStart = dates[0]
  const dateEnd = dates[dates.length - 1]

  // Previous period dates (for continuity)
  const prevStart = new Date(new Date(dateStart).getTime() - 7 * 86400000).toISOString().slice(0, 10)
  const prevEnd = new Date(new Date(dateStart).getTime() - 1 * 86400000).toISOString().slice(0, 10)

  // Parallel data fetches
  const [
    { data: existingSchedules },
    { data: offRequests },
    { data: previousPeriod },
    { data: preferences },
    { data: storeSettingsData },
    { data: staffingData },
  ] = await Promise.all([
    supabase.from('schedules').select('employee, date, shift, absence_type, source_store')
      .gte('date', dateStart).lte('date', dateEnd),
    supabase.from('off_requests').select('employee, date')
      .gte('date', dateStart).lte('date', dateEnd),
    supabase.from('schedules').select('employee, date, shift')
      .gte('date', prevStart).lte('date', prevEnd),
    supabase.from('employee_shift_preferences').select('employee, preferred_shifts, avoid_shifts'),
    storeFilter
      ? supabase.from('store_settings').select('*')
          .eq('store_id', locations.find(l => l.name === storeFilter)?.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    storeFilter
      ? supabase.from('store_staffing').select('*')
          .eq('store_id', locations.find(l => l.name === storeFilter)?.id)
      : Promise.resolve({ data: [] }),
  ])

  const storeSettings = {
    minStaff: minStaff || 3,
    maxStaff: storeSettingsData?.max_staff || undefined,
    operatingHours: storeSettingsData?.operating_hours || undefined,
    peakDays: storeSettingsData?.peak_days || [0, 6],
  }

  // Cross-store eligible employees (for borrowing suggestions)
  const crossStoreEligible = storeFilter
    ? getCrossStoreEligible(employees, storeFilter, locations)
    : []

  return {
    employees: employees.map(e => ({
      id: e.id,
      name: e.name,
      dept: e.dept,
      position: e.position,
      store: e.store,
      employment_type: e.employment_type || 'full_time',
      schedule_priority: e.schedule_priority || 3,
      can_open: e.can_open !== false,
      can_close: e.can_close !== false,
      additional_stores: e.additional_stores || [],
      gender: e.gender,
      is_pregnant: e.is_pregnant,
      is_nursing: e.is_nursing,
      skills: e.skills || [],
    })),
    shiftDefs,
    weekDates: weekDates || dates,
    monthDates: monthDates || null,
    existingSchedules: existingSchedules || [],
    offRequests: (offRequests || []).map(o => ({ employee: o.employee, date: o.date })),
    preferences: (preferences || []).map(p => ({
      employee: p.employee,
      preferred_shifts: p.preferred_shifts || [],
      avoid_shifts: p.avoid_shifts || [],
    })),
    previousWeek: previousPeriod || [],
    storeSettings,
    crossStoreEligible,
    locations,
    tenantId,
  }
}

// ══════════════════════════════════════════════════════════════
//  Run AI Schedule (Weekly — single call)
// ══════════════════════════════════════════════════════════════

/**
 * Run the AI scheduler for a single week.
 * Tries edge function first, falls back to client-side Gemini call.
 */
export async function runAiSchedule(schedulingData) {
  try {
    const result = await callEdgeFunction(schedulingData)
    if (result.success) return result
  } catch (err) {
    console.warn('[schedulingAi] Edge function unavailable, falling back to client-side:', err.message)
  }
  return await callGeminiClientSide(schedulingData)
}

// ══════════════════════════════════════════════════════════════
//  Run Monthly AI Schedule (weekly chunks with carry-forward)
// ══════════════════════════════════════════════════════════════

/**
 * Run AI scheduling for a full month by processing weekly chunks.
 * Each week carries forward context from previously generated weeks.
 */
export async function runMonthlyAiSchedule(schedulingData, onProgress) {
  const { monthDates, previousWeek } = schedulingData
  if (!monthDates || monthDates.length === 0) {
    return runAiSchedule(schedulingData)
  }

  const weeks = splitIntoWeeks(monthDates)
  const allAssignments = []
  const allViolations = []
  let lastWeekContext = previousWeek || []

  for (let i = 0; i < weeks.length; i++) {
    const weekDates = weeks[i]
    onProgress?.(`AI 排班中... 第 ${i + 1}/${weeks.length} 週 (${weekDates[0]} ~ ${weekDates[weekDates.length - 1]})`)

    // Build per-week data with carry-forward from previous weeks
    const weekData = {
      ...schedulingData,
      weekDates,
      monthDates: null, // force weekly mode for the actual AI call
      previousWeek: lastWeekContext,
      existingSchedules: schedulingData.existingSchedules.filter(
        s => s.date >= weekDates[0] && s.date <= weekDates[weekDates.length - 1]
      ),
      offRequests: schedulingData.offRequests.filter(
        o => o.date >= weekDates[0] && o.date <= weekDates[weekDates.length - 1]
      ),
    }

    const result = await runAiSchedule(weekData)
    allAssignments.push(...(result.assignments || []))
    allViolations.push(...(result.violations || []))

    // Carry forward: last 7 days of generated assignments
    lastWeekContext = result.assignments || []
  }

  // Monthly-scope validation pass
  const monthlyViolations = validateMonthly(allAssignments, schedulingData)

  const combinedViolations = [...allViolations, ...monthlyViolations]
  return {
    success: true,
    assignments: allAssignments,
    reasoning: `月排班完成：${weeks.length} 週 × ${schedulingData.employees.length} 位員工`,
    aiWarnings: [],
    violations: combinedViolations,
    errors: combinedViolations.filter(v => v.severity === 'error'),
    warnings: combinedViolations.filter(v => v.severity === 'warning'),
    meta: {
      model: 'gemini-2.5-flash',
      mode: 'monthly',
      employeeCount: schedulingData.employees.length,
      totalAssignments: allAssignments.length,
      weeksProcessed: weeks.length,
    },
  }
}

// ══════════════════════════════════════════════════════════════
//  Edge Function Call
// ══════════════════════════════════════════════════════════════

async function callEdgeFunction(data) {
  const { data: result, error } = await supabase.functions.invoke('scheduling-ai', {
    body: data,
  })
  if (error) throw error
  return result
}

// ══════════════════════════════════════════════════════════════
//  Client-Side Fallback (Gemini 2.5 Flash)
// ══════════════════════════════════════════════════════════════

async function callGeminiClientSide(schedulingData) {
  if (!GEMINI_KEY || GEMINI_KEY === 'your_gemini_api_key_here') {
    throw new Error('請在 .env 設定 VITE_GEMINI_API_KEY')
  }

  const genAI = new GoogleGenerativeAI(GEMINI_KEY)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
    },
  })

  const prompt = buildClientPrompt(schedulingData)

  // Attempt 1
  console.log('[schedulingAi] Calling Gemini 2.5 Flash (attempt 1)...')
  const result1 = await model.generateContent(prompt)
  let raw = result1.response.text()
  console.log('[schedulingAi] Raw response length:', raw.length)

  let parsed = parseResponse(raw)
  let violations = validateClientSide(parsed.assignments, schedulingData)
  const errors1 = violations.filter(v => v.severity === 'error')

  // Retry if errors
  if (errors1.length > 0) {
    console.log(`[schedulingAi] ${errors1.length} errors, retrying...`)
    const fixPrompt = buildFixPromptClient(prompt, violations, parsed.assignments)
    const result2 = await model.generateContent(fixPrompt)
    const raw2 = result2.response.text()
    const parsed2 = parseResponse(raw2)
    const violations2 = validateClientSide(parsed2.assignments, schedulingData)
    const errors2 = violations2.filter(v => v.severity === 'error')

    if (errors2.length < errors1.length) {
      parsed = parsed2
      violations = violations2
    }
  }

  return {
    success: true,
    assignments: parsed.assignments,
    reasoning: parsed.reasoning,
    aiWarnings: parsed.warnings,
    violations,
    errors: violations.filter(v => v.severity === 'error'),
    warnings: violations.filter(v => v.severity === 'warning'),
    meta: {
      model: 'gemini-2.5-flash',
      mode: 'client-fallback',
      employeeCount: schedulingData.employees.length,
      totalAssignments: parsed.assignments.length,
    },
  }
}

// ══════════════════════════════════════════════════════════════
//  Response Parsing (robust JSON extraction)
// ══════════════════════════════════════════════════════════════

function parseResponse(raw) {
  let cleaned = raw.trim()

  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  try {
    const parsed = JSON.parse(cleaned)
    return {
      assignments: parsed.assignments || [],
      reasoning: parsed.reasoning || '',
      warnings: parsed.warnings || [],
    }
  } catch { /* fallback */ }

  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    let jsonStr = cleaned.slice(firstBrace, lastBrace + 1)
    jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1')
    jsonStr = jsonStr.replace(/[\x00-\x1F\x7F]/g, (ch) =>
      ch === '\n' || ch === '\r' || ch === '\t' ? ch : ''
    )
    jsonStr = jsonStr.replace(/(?<=:\s*"[^"]*)\n([^"]*")/g, '\\n$1')

    try {
      const parsed = JSON.parse(jsonStr)
      return {
        assignments: parsed.assignments || [],
        reasoning: parsed.reasoning || '',
        warnings: parsed.warnings || [],
      }
    } catch { /* last resort */ }
  }

  const assignMatch = cleaned.match(/"assignments"\s*:\s*(\[[\s\S]*?\])\s*[,}]/)
  if (assignMatch) {
    try {
      const assignments = JSON.parse(assignMatch[1].replace(/,\s*([\]}])/g, '$1'))
      return { assignments, reasoning: 'JSON 解析修復模式', warnings: ['原始回傳 JSON 格式有誤，已自動修復'] }
    } catch { /* give up */ }
  }

  throw new Error('AI 回傳格式無法解析，請重試')
}

// ══════════════════════════════════════════════════════════════
//  Client-Side Prompt Builder (single assignment per employee per day)
// ══════════════════════════════════════════════════════════════

function buildClientPrompt(data) {
  const { employees, shiftDefs, weekDates, existingSchedules, offRequests, preferences, previousWeek, storeSettings, crossStoreEligible } = data

  const empProfiles = employees.map(emp => {
    const pref = preferences.find(p => p.employee === emp.name)
    const prevWeekShifts = previousWeek.filter(s => s.employee === emp.name)
    const lines = [
      `  - ${emp.name} | ${emp.position || '員工'} | 門市=${emp.store} | priority=${emp.schedule_priority} | type=${emp.employment_type}`,
      `    can_open=${emp.can_open} | can_close=${emp.can_close}${emp.is_pregnant ? ' | PREGNANT' : ''}${emp.is_nursing ? ' | NURSING' : ''}`,
    ]
    if (emp.additional_stores?.length > 0) {
      lines.push(`    可支援門市=[${emp.additional_stores.join(',')}]`)
    }
    if (pref) {
      lines.push(`    preferred=[${pref.preferred_shifts.join(',')}] avoid=[${pref.avoid_shifts.join(',')}]`)
    }
    if (prevWeekShifts.length > 0) {
      lines.push(`    上週: [${prevWeekShifts.map(s => `${s.date}:${s.shift}`).join(', ')}]`)
    }
    return lines.join('\n')
  }).join('\n')

  const shiftInfo = shiftDefs.map(d =>
    `  - "${d.name}" | ${d.start_time?.slice(0, 5)}~${d.end_time?.slice(0, 5)} | ${getShiftHours(d).toFixed(1)}h | store=${d.store_id || 'all'} | type=${d.employee_type || 'all'}`
  ).join('\n')

  const locked = existingSchedules.filter(s => s.shift && !isAbsence(s.shift)).map(s => `  - ${s.employee} | ${s.date} | ${s.shift}`).join('\n')
  const offInfo = offRequests.map(o => `  - ${o.employee} OFF on ${o.date}`).join('\n')

  const dateContext = weekDates.map(d => {
    const dow = ['日', '一', '二', '三', '四', '五', '六'][new Date(d).getDay()]
    return `  - ${d} (${dow})`
  }).join('\n')

  // Shift period classification
  const shiftsByPeriod = { morning: [], afternoon: [], evening: [], night: [] }
  for (const d of shiftDefs) {
    const s = parseTime(d.start_time)
    if (s < 12) shiftsByPeriod.morning.push(d.name)
    else if (s < 16) shiftsByPeriod.afternoon.push(d.name)
    else if (s < 20) shiftsByPeriod.evening.push(d.name)
    else shiftsByPeriod.night.push(d.name)
  }

  const coverageGuide = [
    shiftsByPeriod.morning.length > 0 ? `  - 早班 (開店): ${shiftsByPeriod.morning.join(', ')}` : '',
    shiftsByPeriod.afternoon.length > 0 ? `  - 午班: ${shiftsByPeriod.afternoon.join(', ')}` : '',
    shiftsByPeriod.evening.length > 0 ? `  - 晚班: ${shiftsByPeriod.evening.join(', ')}` : '',
    shiftsByPeriod.night.length > 0 ? `  - 夜班 (收店): ${shiftsByPeriod.night.join(', ')}` : '',
  ].filter(Boolean).join('\n')

  // Cross-store section
  let crossStoreSection = ''
  if (crossStoreEligible?.length > 0) {
    crossStoreSection = `\n## 跨店支援候選人
以下員工來自其他門市，可在人力不足時借調：
${crossStoreEligible.map(e => `  - ${e.name} | 主店=${e.store} | 可支援=[${(e.additional_stores || []).join(',')}]`).join('\n')}
借調時 assignment 中加入 "store" 欄位標示被支援的門市。\n`
  }

  // Absence type reference
  const absenceRef = `## 假別代碼
  - "休" = 例假/休息日
  - "補休" = 補休假
  - "病" = 病假
  - "特休" = 特別休假
  - "會議" = 開會 (部分工時)
  - "產" = 產假`

  const numDays = weekDates.length

  return `你是台灣門市排班專家 AI。請根據以下資訊產生排班表，嚴格遵守台灣勞基法。

## 排班期間 (${numDays} 天)
${dateContext}

## 員工 (${employees.length} 人)
${empProfiles}

## 可用班別
${shiftInfo}

## 班別時段分類
${coverageGuide}

${absenceRef}
${crossStoreSection}
## 已鎖定班表 (不可修改)
${locked || '  (無)'}

## 請假申請 (該天必須排休)
${offInfo || '  (無)'}

## 人力需求
- 每天最少人力: ${storeSettings.minStaff} 人
- 週末/尖峰日: 建議多 1-2 人

## 硬性規則 (不可違反)
H1: 有請假的員工當天必須排休（使用對應假別代碼）
H2: 每天工時 ≤${DAILY_MAX_HOURS}h (勞基法 §30,§32)
H3: 連續工作 ≤${MAX_CONSECUTIVE_WORK_DAYS} 天 (勞基法 §36 七休一)
H4: 換班間隔 ≥${MIN_SHIFT_INTERVAL} 小時 (勞基法 §34)
H5: 連續工作 4h 需休息 30 分鐘 (勞基法 §35)
H6: 每月加班 ≤${MONTHLY_OVERTIME_CAP}h (勞基法 §32)
H10: 每週至少 ${MIN_WEEKLY_REST_DAYS} 天完整休假 (勞基法 §36 一例一休)
H12: 女性夜班 (22-06) 需工會同意 (勞基法 §49)
H13: 孕婦/哺乳期不得排夜班 (性平法 §15)
H14: 班別需對應員工所屬門市（或該員工的可支援門市）
H15: 兼職員工只排兼職班別

## 軟性規則 (盡量遵守)
S1: 每天達到最低人力 ${storeSettings.minStaff} 人
S2: 尊重員工班別偏好
S3: 公平分配班次，避免同一人連續排不受歡迎的班
S4: 週末出勤公平輪流
S5: 每人每週工時盡量接近 40h
S6: 高優先權員工 (priority=1) 優先排偏好班別
S7: 每月目標 ~${MONTHLY_REST_DAYS_TARGET} 天休假

## 輸出格式
只回傳合法 JSON，不要加說明文字：
{
  "assignments": [{ "employee": "姓名", "date": "YYYY-MM-DD", "shift": "班別名稱 or 休/補休/病/特休/會議" }],
  "reasoning": "簡短說明排班邏輯",
  "warnings": ["注意事項"]
}

規則：
1. 每位員工每天恰好 1 筆 assignment
2. 不可修改已鎖定的班表
3. shift 欄位用精確的班別名稱或假別代碼（休/補休/病/特休/會議）
4. 只輸出 JSON
5. 全部員工合計 ${employees.length * numDays} 筆`
}

function buildFixPromptClient(originalPrompt, violations, previousOutput) {
  const errorViolations = violations.filter(v => v.severity === 'error')
  const summary = errorViolations.map(v => `  - [${v.constraint}] ${v.message}`).join('\n')

  return `${originalPrompt}

## PREVIOUS ATTEMPT HAD ${errorViolations.length} VIOLATIONS — FIX THEM
${summary}

Previous assignments: ${JSON.stringify(previousOutput)}

Regenerate a CORRECTED schedule fixing ALL violations. Return valid JSON only.`
}

// ══════════════════════════════════════════════════════════════
//  Client-Side Validation (weekly scope)
// ══════════════════════════════════════════════════════════════

function validateClientSide(assignments, data) {
  const violations = []
  const { employees, shiftDefs, weekDates, offRequests, storeSettings } = data

  const shiftDefMap = {}
  for (const d of shiftDefs) shiftDefMap[d.name] = d

  const offMap = {}
  for (const o of offRequests) offMap[`${o.employee}_${o.date}`] = true

  const byEmployee = {}
  for (const a of assignments) {
    if (!byEmployee[a.employee]) byEmployee[a.employee] = []
    byEmployee[a.employee].push(a)
  }

  const dates = weekDates

  for (const emp of employees) {
    const empAssignments = (byEmployee[emp.name] || []).sort((a, b) => a.date.localeCompare(b.date))
    const workEntries = empAssignments.filter(a => !isAbsence(a.shift))

    // Group by date
    const byDate = {}
    for (const a of empAssignments) {
      if (!byDate[a.date]) byDate[a.date] = []
      byDate[a.date].push(a)
    }

    // H1: Off-request
    for (const a of empAssignments) {
      if (offMap[`${emp.name}_${a.date}`] && !isAbsence(a.shift)) {
        violations.push({ employee: emp.name, constraint: 'H1', law: '排班規則', message: `${emp.name} has off-request on ${a.date} but assigned "${a.shift}"`, severity: 'error' })
      }
    }

    // H2: Daily total hours ≤ 12h
    for (const [date, dayAssignments] of Object.entries(byDate)) {
      const dayShifts = dayAssignments.filter(a => !isAbsence(a.shift))
      if (dayShifts.length === 0) continue
      let dailyHours = 0
      for (const a of dayShifts) {
        const def = shiftDefMap[a.shift]
        dailyHours += def ? getShiftHours(def) : 8
      }
      if (dailyHours > DAILY_MAX_HOURS) {
        violations.push({ employee: emp.name, constraint: 'H2', law: '勞基法 §32', message: `${emp.name} on ${date}: total ${dailyHours.toFixed(1)}h, max ${DAILY_MAX_HOURS}h`, severity: 'error' })
      }
    }

    // H3: Consecutive work days
    let consec = 0
    for (const date of dates) {
      const dayAssignments = byDate[date] || []
      const hasWork = dayAssignments.some(a => !isAbsence(a.shift))
      if (hasWork) {
        consec++
        if (consec > MAX_CONSECUTIVE_WORK_DAYS) {
          violations.push({ employee: emp.name, constraint: 'H3', law: '勞基法 §36', message: `${emp.name} has ${consec} consecutive work days`, severity: 'error' })
        }
      } else {
        consec = 0
      }
    }

    // H4: Cross-day shift gap ≥ 11h
    for (let i = 0; i < dates.length - 1; i++) {
      const today = dates[i]
      const tomorrow = dates[i + 1]
      const todayShifts = (byDate[today] || []).filter(a => !isAbsence(a.shift))
      const tomorrowShifts = (byDate[tomorrow] || []).filter(a => !isAbsence(a.shift))
      if (todayShifts.length === 0 || tomorrowShifts.length === 0) continue

      let latestEnd = 0
      let latestShiftName = ''
      for (const a of todayShifts) {
        const def = shiftDefMap[a.shift]
        if (!def) continue
        const ee = effectiveEndHour(def)
        if (ee > latestEnd) { latestEnd = ee; latestShiftName = a.shift }
      }

      let earliestStart = 24
      let earliestShiftName = ''
      for (const a of tomorrowShifts) {
        const def = shiftDefMap[a.shift]
        if (!def) continue
        const startH = parseTime(def.start_time)
        if (startH < earliestStart) { earliestStart = startH; earliestShiftName = a.shift }
      }

      const gap = (earliestStart + 24) - latestEnd
      if (gap < MIN_SHIFT_INTERVAL) {
        violations.push({ employee: emp.name, constraint: 'H4', law: '勞基法 §34', message: `${emp.name} ${today}→${tomorrow}: ${gap.toFixed(1)}h gap (${latestShiftName}→${earliestShiftName}), min ${MIN_SHIFT_INTERVAL}h`, severity: 'error' })
      }
    }

    // H9: Open/close
    for (const a of workEntries) {
      const def = shiftDefMap[a.shift]
      if (!def) continue
      const startH = parseTime(def.start_time)
      const endH = parseTime(def.end_time)
      if (startH <= 9 && emp.can_open === false) {
        violations.push({ employee: emp.name, constraint: 'H9', law: '排班規則', message: `${emp.name} on ${a.date}: opening shift but can_open=false`, severity: 'error' })
      }
      if ((endH >= 21 || endH < startH) && emp.can_close === false) {
        violations.push({ employee: emp.name, constraint: 'H9', law: '排班規則', message: `${emp.name} on ${a.date}: closing shift but can_close=false`, severity: 'error' })
      }
    }

    // H10: Min 2 full rest days per week
    // For weekly-scoped validation, check the full date range in 7-day windows
    const weeks = splitIntoWeeks(dates)
    for (const week of weeks) {
      if (week.length < 7) continue // skip partial weeks
      let fullRestDays = 0
      for (const date of week) {
        const dayAssignments = byDate[date] || []
        const allRest = dayAssignments.length > 0 && dayAssignments.every(a => isAbsence(a.shift))
        if (allRest || dayAssignments.length === 0) fullRestDays++
      }
      if (fullRestDays < MIN_WEEKLY_REST_DAYS) {
        violations.push({ employee: emp.name, constraint: 'H10', law: '勞基法 §36', message: `${emp.name} week ${week[0]}~${week[week.length - 1]}: only ${fullRestDays} rest days, min ${MIN_WEEKLY_REST_DAYS}`, severity: 'error' })
      }
    }

    // H13: Pregnant/nursing night shifts
    if (emp.is_pregnant || emp.is_nursing) {
      for (const a of workEntries) {
        const def = shiftDefMap[a.shift]
        if (def && isNightShift(def)) {
          violations.push({ employee: emp.name, constraint: 'H13', law: '性平法 §15', message: `${emp.name} (pregnant/nursing) assigned night shift on ${a.date}`, severity: 'error' })
        }
      }
    }
  }

  // S1: Staffing per day
  for (const date of dates) {
    const working = assignments.filter(a => a.date === date && !isAbsence(a.shift)).length
    if (working < (storeSettings?.minStaff || 1)) {
      violations.push({ employee: '-', constraint: 'S1', law: '營運需求', message: `${date}: only ${working} staff, min ${storeSettings.minStaff}`, severity: 'warning' })
    }
  }

  return violations
}

// ══════════════════════════════════════════════════════════════
//  Monthly-Scope Validation
// ══════════════════════════════════════════════════════════════

function validateMonthly(assignments, data) {
  const violations = []
  const { employees, shiftDefs } = data

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
      totalHours += def ? getShiftHours(def) : 8
    }
    const standardHours = workEntries.length * 8
    const overtime = Math.max(0, totalHours - standardHours)
    if (overtime > MONTHLY_OVERTIME_CAP) {
      violations.push({
        employee: emp.name, constraint: 'H6', law: '勞基法 §32',
        message: `${emp.name}: 月加班 ${overtime.toFixed(1)}h, 上限 ${MONTHLY_OVERTIME_CAP}h`,
        severity: 'error',
      })
    }

    // S7: Monthly rest day target (~10 days for 30-day month)
    const totalDays = empAssignments.length
    const expectedRest = Math.round(totalDays * MONTHLY_REST_DAYS_TARGET / 30)
    if (restEntries.length < expectedRest - 2) {
      violations.push({
        employee: emp.name, constraint: 'S7', law: '勞動權益',
        message: `${emp.name}: 本月僅 ${restEntries.length} 天休假, 建議 ${expectedRest} 天`,
        severity: 'warning',
      })
    }
  }

  return violations
}

// ══════════════════════════════════════════════════════════════
//  Fix Violations (re-run with context)
// ══════════════════════════════════════════════════════════════

export async function fixViolations(schedulingData, currentAssignments, violations) {
  if (!GEMINI_KEY || GEMINI_KEY === 'your_gemini_api_key_here') {
    throw new Error('請在 .env 設定 VITE_GEMINI_API_KEY')
  }

  const genAI = new GoogleGenerativeAI(GEMINI_KEY)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.2, maxOutputTokens: 16384, responseMimeType: 'application/json' },
  })

  const basePrompt = buildClientPrompt(schedulingData)
  const fixPrompt = buildFixPromptClient(basePrompt, violations, currentAssignments)

  const result = await model.generateContent(fixPrompt)
  const raw = result.response.text()
  console.log('[schedulingAi:fix] Raw response length:', raw.length)
  const parsed = parseResponse(raw)
  const newViolations = validateClientSide(parsed.assignments, schedulingData)

  return {
    success: true,
    assignments: parsed.assignments,
    reasoning: parsed.reasoning,
    aiWarnings: parsed.warnings,
    violations: newViolations,
    errors: newViolations.filter(v => v.severity === 'error'),
    warnings: newViolations.filter(v => v.severity === 'warning'),
    meta: { model: 'gemini-2.5-flash', mode: 'fix-violations' },
  }
}
