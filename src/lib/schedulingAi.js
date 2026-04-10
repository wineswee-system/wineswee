/**
 * AI Scheduler Orchestrator (Client-Side)
 *
 * Implements the 6-phase LLM-based scheduling framework:
 * 1. Trigger — user clicks "AI 自動排班"
 * 2. Data gathering — fetches previous week, 8-week history, leave, availability, preferences
 * 3. Edge function call — sends everything to scheduling-ai edge function
 * 4. (Edge function internally: prompt construction → Gemini 2.5 Pro → validation → retry)
 * 5. Result handling — displays draft with violations/warnings
 * 6. Fix violations — re-runs with violation context if needed
 *
 * Falls back to client-side Gemini call if edge function is unavailable.
 */

import { supabase } from './supabase'
import { GoogleGenerativeAI } from '@google/generative-ai'

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY

// ══════════════════════════════════════════════════════════════
//  Phase 2: Data Gathering
// ══════════════════════════════════════════════════════════════

/**
 * Gather all data needed for AI scheduling.
 * @param {Object} params
 * @param {string[]} params.weekDates - 7 dates for the target week
 * @param {Object[]} params.employees - filtered employee list
 * @param {Object[]} params.shiftDefs - shift definitions
 * @param {string} params.storeFilter - current store name
 * @param {Object[]} params.locations - all stores
 * @param {number} params.minStaff - minimum staff per day
 * @param {string} [params.tenantId]
 */
export async function gatherSchedulingData({
  weekDates,
  employees,
  shiftDefs,
  storeFilter,
  locations,
  minStaff,
  tenantId,
}) {
  const weekStart = weekDates[0]
  const weekEnd = weekDates[6]

  // Previous week dates
  const prevWeekStart = new Date(new Date(weekStart).getTime() - 7 * 86400000).toISOString().slice(0, 10)
  const prevWeekEnd = new Date(new Date(weekStart).getTime() - 1 * 86400000).toISOString().slice(0, 10)

  // 8-week history start
  const historyStart = new Date(new Date(weekStart).getTime() - 56 * 86400000).toISOString().slice(0, 10)

  // Parallel data fetches
  const [
    { data: existingSchedules },
    { data: offRequests },
    { data: previousWeek },
    { data: historicalSchedules },
    { data: preferences },
    { data: holidays },
    { data: storeSettingsData },
    { data: staffingData },
  ] = await Promise.all([
    // Current week existing schedules
    supabase.from('schedules').select('employee, date, shift')
      .gte('date', weekStart).lte('date', weekEnd),
    // Off requests for target week
    supabase.from('off_requests').select('employee, date')
      .gte('date', weekStart).lte('date', weekEnd),
    // Previous week schedules (for continuity)
    supabase.from('schedules').select('employee, date, shift')
      .gte('date', prevWeekStart).lte('date', prevWeekEnd),
    // 8-week history
    supabase.from('schedules').select('employee, date, shift')
      .gte('date', historyStart).lt('date', weekStart),
    // Employee shift preferences
    supabase.from('employee_shift_preferences').select('employee, preferred_shifts, avoid_shifts'),
    // Holidays
    supabase.from('holidays').select('date'),
    // Store settings
    storeFilter
      ? supabase.from('store_settings').select('*')
          .eq('store_id', locations.find(l => l.name === storeFilter)?.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Staffing requirements
    storeFilter
      ? supabase.from('store_staffing').select('*')
          .eq('store_id', locations.find(l => l.name === storeFilter)?.id)
      : Promise.resolve({ data: [] }),
  ])

  // Build store settings
  const storeSettings = {
    minStaff: minStaff || 3,
    maxStaff: storeSettingsData?.max_staff || undefined,
    operatingHours: storeSettingsData?.operating_hours || undefined,
    peakDays: storeSettingsData?.peak_days || [0, 6], // default: Sun + Sat
  }

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
    weekDates,
    existingSchedules: existingSchedules || [],
    offRequests: (offRequests || []).map(o => ({ employee: o.employee, date: o.date })),
    holidays: (holidays || []).map(h => h.date),
    preferences: (preferences || []).map(p => ({
      employee: p.employee,
      preferred_shifts: p.preferred_shifts || [],
      avoid_shifts: p.avoid_shifts || [],
    })),
    previousWeek: previousWeek || [],
    historicalSchedules: historicalSchedules || [],
    storeSettings,
    tenantId,
  }
}

// ══════════════════════════════════════════════════════════════
//  Phase 5: Call AI (Edge Function or Client Fallback)
// ══════════════════════════════════════════════════════════════

/**
 * Run the AI scheduler.
 * Tries edge function first, falls back to client-side Gemini call.
 */
export async function runAiSchedule(schedulingData) {
  // Try edge function first
  try {
    const result = await callEdgeFunction(schedulingData)
    if (result.success) return result
  } catch (err) {
    console.warn('[schedulingAi] Edge function unavailable, falling back to client-side:', err.message)
  }

  // Fallback: client-side Gemini call
  return await callGeminiClientSide(schedulingData)
}

async function callEdgeFunction(data) {
  const { data: result, error } = await supabase.functions.invoke('scheduling-ai', {
    body: data,
  })
  if (error) throw error
  return result
}

// ══════════════════════════════════════════════════════════════
//  Client-Side Fallback (same logic as edge function)
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

  const patterns = analyzeHistoricalPatterns(schedulingData)
  const prompt = buildClientPrompt(schedulingData, patterns)

  // Attempt 1
  console.log('[schedulingAi] Calling Gemini 2.5 Flash (attempt 1)...')
  const result1 = await model.generateContent(prompt)
  let raw = result1.response.text()
  console.log('[schedulingAi] Raw response length:', raw.length)
  console.log('[schedulingAi] Raw response preview:', raw.slice(0, 500))
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

function parseResponse(raw) {
  let cleaned = raw.trim()

  // 移除 markdown code fence
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  // 嘗試直接解析
  try {
    const parsed = JSON.parse(cleaned)
    return {
      assignments: parsed.assignments || [],
      reasoning: parsed.reasoning || '',
      warnings: parsed.warnings || [],
    }
  } catch {
    // fallback: 從回傳文字中提取最大的 JSON 物件
  }

  // 找到第一個 { 和最後一個 } 之間的內容
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    let jsonStr = cleaned.slice(firstBrace, lastBrace + 1)

    // 修復常見的 JSON 問題
    // 1. 移除尾端多餘逗號 (trailing commas)
    jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1')
    // 2. 移除控制字元
    jsonStr = jsonStr.replace(/[\x00-\x1F\x7F]/g, (ch) =>
      ch === '\n' || ch === '\r' || ch === '\t' ? ch : ''
    )
    // 3. 修復未跳脫的換行 (在字串值內)
    jsonStr = jsonStr.replace(/(?<=:\s*"[^"]*)\n([^"]*")/g, '\\n$1')

    try {
      const parsed = JSON.parse(jsonStr)
      return {
        assignments: parsed.assignments || [],
        reasoning: parsed.reasoning || '',
        warnings: parsed.warnings || [],
      }
    } catch {
      // 最後手段：嘗試只提取 assignments 陣列
    }
  }

  // 最後手段：用 regex 提取 assignments
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
//  Client-Side Prompt Builder (mirrors edge function)
// ══════════════════════════════════════════════════════════════

function parseTime(t) {
  if (!t) return 0
  const [h, m] = String(t).split(':').map(Number)
  return (h || 0) + (m || 0) / 60
}

function getShiftHours(def) {
  const s = parseTime(def.start_time)
  const e = parseTime(def.end_time)
  return e > s ? e - s : (24 - s + e)
}

function analyzeHistoricalPatterns(data) {
  const patterns = {}
  for (const emp of data.employees) {
    const history = (data.historicalSchedules || []).filter(s => s.employee === emp.name && s.shift !== '休')
    const totalWeeks = Math.max(1, Math.ceil(history.length / 5))
    let totalHours = 0
    let weekendDays = 0
    for (const s of history) {
      const def = data.shiftDefs.find(d => d.name === s.shift)
      totalHours += def ? getShiftHours(def) : 8
      const dow = new Date(s.date).getDay()
      if (dow === 0 || dow === 6) weekendDays++
    }
    patterns[emp.name] = {
      avgHoursPerWeek: totalHours / totalWeeks,
      weekendWorkRatio: history.length > 0 ? weekendDays / history.length : 0,
      totalWeeksTracked: totalWeeks,
    }
  }
  return patterns
}

function buildClientPrompt(data, patterns) {
  const { employees, shiftDefs, weekDates, existingSchedules, offRequests, holidays, preferences, previousWeek, storeSettings } = data

  const holidaySet = new Set(holidays)

  const empProfiles = employees.map(emp => {
    const pref = preferences.find(p => p.employee === emp.name)
    const hist = patterns[emp.name]
    const prevWeekShifts = previousWeek.filter(s => s.employee === emp.name)
    return `  - ${emp.name} | ${emp.position} | ${emp.store} | priority=${emp.schedule_priority} | type=${emp.employment_type}
    can_open=${emp.can_open} | can_close=${emp.can_close}${emp.is_pregnant ? ' | PREGNANT' : ''}${emp.is_nursing ? ' | NURSING' : ''}
    ${pref ? `preferred=[${pref.preferred_shifts.join(',')}] avoid=[${pref.avoid_shifts.join(',')}]` : ''}
    ${hist ? `history: avg ${hist.avgHoursPerWeek.toFixed(1)}h/wk, weekend=${(hist.weekendWorkRatio * 100).toFixed(0)}%` : ''}
    last_week: [${prevWeekShifts.map(s => `${s.date}:${s.shift}`).join(', ')}]`
  }).join('\n')

  const shiftInfo = shiftDefs.map(d =>
    `  - "${d.name}" | ${d.start_time?.slice(0, 5)}~${d.end_time?.slice(0, 5)} | ${getShiftHours(d).toFixed(1)}h | store=${d.store_id || 'all'} | type=${d.employee_type || 'all'}`
  ).join('\n')

  const locked = existingSchedules.filter(s => s.shift).map(s => `  - ${s.employee} | ${s.date} | ${s.shift}`).join('\n')
  const offInfo = offRequests.map(o => `  - ${o.employee} OFF on ${o.date}`).join('\n')
  const holidayInfo = holidays.filter(h => weekDates.includes(h)).map(h => `  - ${h}`).join('\n')

  const dateContext = weekDates.map(d => {
    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(new Date(d).getDay() + 6) % 7]
    const isHoliday = holidaySet.has(d)
    return `  - ${d} (${dow})${isHoliday ? ' [HOLIDAY]' : ''}`
  }).join('\n')

  return `You are an expert HR scheduling AI for a Taiwan-based business. Generate a weekly employee shift schedule that strictly complies with Taiwan labor law.

## SCHEDULE PERIOD
${dateContext}

## EMPLOYEES (${employees.length} total)
${empProfiles}

## AVAILABLE SHIFTS
${shiftInfo}

## EXISTING ASSIGNMENTS (DO NOT MODIFY)
${locked || '  (none)'}

## OFF REQUESTS (MUST ASSIGN REST)
${offInfo || '  (none)'}

## HOLIDAYS
${holidayInfo || '  (none in this week)'}

## STAFFING
- Minimum staff per day: ${storeSettings.minStaff}

## HARD CONSTRAINTS (H1-H15) — MUST NOT VIOLATE
H1: Employees with off-requests MUST be assigned "休".
H2: Max 8h/day normal, 12h/day absolute max with OT. (勞基法 §30, §32)
H3: Max 6 consecutive work days. (勞基法 §36 七休一)
H4: Min 11 hours rest between shifts. (勞基法 §34)
H5: 30 min break after 4h continuous work. (勞基法 §35)
H6: Monthly OT cap 46h. (勞基法 §32)
H7: Quarterly OT cap 138h. (勞基法 §32)
H8: Match employee skills/position to shift requirements.
H9: Opening shifts need can_open=true. Closing shifts need can_close=true.
H10: Min 2 rest days per week. (勞基法 §36)
H11: National holidays default to rest unless explicit consent. (勞基法 §37)
H12: Female night shift (22-06) requires union agreement. (勞基法 §49)
H13: Pregnant/nursing employees CANNOT work night shifts. (性平法 §15)
H14: Shifts must match employee's store assignment.
H15: PT employees only get PT-eligible shifts.

## SOFT CONSTRAINTS (S1-S8) — OPTIMIZE
S1: Meet min staffing (${storeSettings.minStaff}/day).
S2: Respect shift preferences.
S3: Minimize overtime.
S4: Match historical demand patterns.
S5: Schedule consistency with previous weeks.
S6: Fair distribution of hours and weekend work.
S7: Priority employees (1=highest) get preferred shifts.
S8: Avoid consecutive unpopular shifts for same employee.

## OUTPUT FORMAT
Return ONLY valid JSON:
{
  "assignments": [{ "employee": "Name", "date": "YYYY-MM-DD", "shift": "ShiftName or 休" }],
  "reasoning": "Brief explanation",
  "warnings": ["Trade-offs made"]
}

RULES:
1. Every employee MUST have exactly one assignment per day for all 7 days.
2. Do NOT modify LOCKED assignments.
3. Use exact shift names or "休".
4. Output valid JSON only.`
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
//  Client-Side Validation (mirrors edge function)
// ══════════════════════════════════════════════════════════════

function validateClientSide(assignments, data) {
  const violations = []
  const { employees, shiftDefs, weekDates, offRequests, holidays, storeSettings } = data

  const shiftDefMap = {}
  for (const d of shiftDefs) shiftDefMap[d.name] = d

  const offMap = {}
  for (const o of offRequests) offMap[`${o.employee}_${o.date}`] = true

  const byEmployee = {}
  for (const a of assignments) {
    if (!byEmployee[a.employee]) byEmployee[a.employee] = []
    byEmployee[a.employee].push(a)
  }

  for (const emp of employees) {
    const empAssignments = (byEmployee[emp.name] || []).sort((a, b) => a.date.localeCompare(b.date))
    const workDays = empAssignments.filter(a => a.shift !== '休')
    const restDays = empAssignments.filter(a => a.shift === '休')

    // H1: Off-request
    for (const a of empAssignments) {
      if (offMap[`${emp.name}_${a.date}`] && a.shift !== '休') {
        violations.push({ employee: emp.name, constraint: 'H1', law: '排班規則', message: `${emp.name} has off-request on ${a.date} but assigned "${a.shift}"`, severity: 'error' })
      }
    }

    // H3: Consecutive days
    let consec = 0
    for (const date of weekDates) {
      const a = empAssignments.find(x => x.date === date)
      if (a && a.shift !== '休') {
        consec++
        if (consec > 6) violations.push({ employee: emp.name, constraint: 'H3', law: '勞基法 §36', message: `${emp.name} has ${consec} consecutive work days`, severity: 'error' })
      } else consec = 0
    }

    // H4: 11h gap
    for (let i = 1; i < empAssignments.length; i++) {
      const prev = empAssignments[i - 1]
      const curr = empAssignments[i]
      if (prev.shift === '休' || curr.shift === '休') continue
      const prevDef = shiftDefMap[prev.shift]
      const currDef = shiftDefMap[curr.shift]
      if (!prevDef || !currDef) continue
      const prevEnd = parseTime(prevDef.end_time)
      const prevStart = parseTime(prevDef.start_time)
      const currStart = parseTime(currDef.start_time)
      const crossesMidnight = prevEnd < prevStart
      const gap = crossesMidnight ? (currStart - prevEnd) : (currStart + 24 - prevEnd)
      if (gap < 11) {
        violations.push({ employee: emp.name, constraint: 'H4', law: '勞基法 §34', message: `${emp.name} ${prev.date}→${curr.date}: ${gap.toFixed(1)}h gap, min 11h`, severity: 'error' })
      }
    }

    // H9: Open/close
    for (const a of workDays) {
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

    // H10: Min 2 rest days
    if (restDays.length < 2 && empAssignments.length >= 7) {
      violations.push({ employee: emp.name, constraint: 'H10', law: '勞基法 §36', message: `${emp.name} only ${restDays.length} rest days, min 2`, severity: 'error' })
    }

    // H13: Pregnant/nursing night shifts
    if (emp.is_pregnant || emp.is_nursing) {
      for (const a of workDays) {
        const def = shiftDefMap[a.shift]
        if (!def) continue
        const s = parseTime(def.start_time)
        const e = parseTime(def.end_time)
        if (s >= 22 || e <= 6 || e < s) {
          violations.push({ employee: emp.name, constraint: 'H13', law: '性平法 §15', message: `${emp.name} (pregnant/nursing) assigned night shift on ${a.date}`, severity: 'error' })
        }
      }
    }
  }

  // S1: Staffing
  for (const date of weekDates) {
    const working = assignments.filter(a => a.date === date && a.shift !== '休').length
    if (working < (storeSettings?.minStaff || 1)) {
      violations.push({ employee: '-', constraint: 'S1', law: '營運需求', message: `${date}: only ${working} staff, min ${storeSettings.minStaff}`, severity: 'warning' })
    }
  }

  return violations
}

// ══════════════════════════════════════════════════════════════
//  Phase 6: Fix Violations (re-run with context)
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

  const patterns = analyzeHistoricalPatterns(schedulingData)
  const basePrompt = buildClientPrompt(schedulingData, patterns)
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
