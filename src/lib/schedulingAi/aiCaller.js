/**
 * AI Caller
 * Edge function invocation, client-side Gemini fallback, response parsing,
 * client-side validation, and all exported scheduling entry points.
 *
 * Exports: runAiSchedule, runMonthlyAiSchedule, fixViolations, runScheduleWithRetry
 */

import { supabase } from '../supabase'
import {
  parseTime, getShiftHours, getNetWorkHours, effectiveEndHour, isNightShift, isAbsence,
  splitIntoWeeks,
  MIN_SHIFT_INTERVAL, MAX_CONSECUTIVE_WORK_DAYS, MIN_WEEKLY_REST_DAYS,
  DAILY_MAX_SPAN_HOURS, MONTHLY_OVERTIME_CAP, MONTHLY_REST_DAYS_TARGET,
} from '../scheduleUtils'
import { runProgrammaticSchedule } from '../schedulingAlgo'
import { chat as geminiChat, isConfigured as geminiIsConfigured } from '../gemini'
import { buildClientPrompt, buildFixPromptClient, buildRetryPrompt } from './promptBuilder'

// ══════════════════════════════════════════════════════════════
//  Proxy helper
// ══════════════════════════════════════════════════════════════

// All direct Gemini calls route through the gemini-proxy Edge Function.
async function invokeSchedulingProxy(prompt) {
  const { data, error } = await supabase.functions.invoke('gemini-proxy', {
    body: { action: 'schedulingFallback', payload: { prompt } },
  })
  if (error) throw new Error(`AI 服務錯誤：${error.message || '請稍後再試'}`)
  if (data?.error) throw new Error(`AI 服務錯誤：${data.error}`)
  return data?.data?.text ?? ''
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
      if (dailyHours > DAILY_MAX_SPAN_HOURS) {
        violations.push({ employee: emp.name, constraint: 'H2', law: '單日工時上限', message: `${emp.name} on ${date}: total ${dailyHours.toFixed(1)}h, max ${DAILY_MAX_SPAN_HOURS}h`, severity: 'error' })
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
//  Client-Side Fallback (Gemini 2.5 Flash)
// ══════════════════════════════════════════════════════════════

async function callGeminiClientSide(schedulingData) {
  const prompt = buildClientPrompt(schedulingData)

  // Attempt 1
  console.log('[schedulingAi] Calling gemini-proxy schedulingFallback (attempt 1)...')
  const raw = await invokeSchedulingProxy(prompt)
  console.log('[schedulingAi] Raw response length:', raw.length)

  let parsed = parseResponse(raw)
  let violations = validateClientSide(parsed.assignments, schedulingData)
  const errors1 = violations.filter(v => v.severity === 'error')

  // Retry if errors
  if (errors1.length > 0) {
    console.log(`[schedulingAi] ${errors1.length} errors, retrying...`)
    const fixPrompt = buildFixPromptClient(prompt, violations, parsed.assignments)
    const raw2 = await invokeSchedulingProxy(fixPrompt)
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
//  AI Suggestion Helpers (for runScheduleWithRetry)
// ══════════════════════════════════════════════════════════════

/**
 * Parse AI response into structured suggestions.
 */
function parseAiSuggestions(response) {
  try {
    let cleaned = response.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    // Try direct parse
    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      // Extract JSON object
      const firstBrace = cleaned.indexOf('{')
      const lastBrace = cleaned.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const jsonStr = cleaned.slice(firstBrace, lastBrace + 1)
          .replace(/,\s*([\]}])/g, '$1')
        parsed = JSON.parse(jsonStr)
      }
    }

    return parsed?.suggestions || []
  } catch (err) {
    console.warn('[runScheduleWithRetry] Failed to parse AI suggestions:', err.message)
    return []
  }
}

/**
 * Apply AI-suggested fixes to the assignments array.
 * Validates each suggestion before applying.
 */
function applyAiSuggestions(assignments, suggestions, data) {
  const { employees, shiftDefs } = data
  const empNames = new Set(employees.map(e => e.name))
  const validShifts = new Set([
    ...shiftDefs.map(d => d.name),
    '休', '補休', '病', '特休', '會議', '產',
  ])

  for (const suggestion of suggestions) {
    suggestion.applied = false

    // Validate employee exists
    if (!empNames.has(suggestion.employee)) continue

    // Find the assignment to modify
    const idx = assignments.findIndex(
      a => a.employee === suggestion.employee && a.date === suggestion.date
    )
    if (idx === -1) continue

    switch (suggestion.action) {
      case 'reassign': {
        // Validate target shift
        if (!validShifts.has(suggestion.to_shift)) break
        assignments[idx].shift = suggestion.to_shift
        // Update actual times if we have shift def info
        const def = shiftDefs.find(d => d.name === suggestion.to_shift)
        if (def) {
          assignments[idx].actual_start = def.start_time?.slice(0, 5) || null
          assignments[idx].actual_end = def.end_time?.slice(0, 5) || null
          assignments[idx].actual_hours = getNetWorkHours(def)
        } else if (isAbsence(suggestion.to_shift)) {
          assignments[idx].actual_start = null
          assignments[idx].actual_end = null
          assignments[idx].actual_hours = null
        }
        suggestion.applied = true
        break
      }

      case 'rest': {
        assignments[idx].shift = '休'
        assignments[idx].actual_start = null
        assignments[idx].actual_end = null
        assignments[idx].actual_hours = null
        suggestion.applied = true
        break
      }

      case 'swap': {
        if (!suggestion.swap_with || !empNames.has(suggestion.swap_with)) break
        const swapIdx = assignments.findIndex(
          a => a.employee === suggestion.swap_with && a.date === suggestion.date
        )
        if (swapIdx === -1) break

        // Swap shifts between the two employees
        const tempShift = assignments[idx].shift
        const tempStart = assignments[idx].actual_start
        const tempEnd = assignments[idx].actual_end
        const tempHours = assignments[idx].actual_hours

        assignments[idx].shift = assignments[swapIdx].shift
        assignments[idx].actual_start = assignments[swapIdx].actual_start
        assignments[idx].actual_end = assignments[swapIdx].actual_end
        assignments[idx].actual_hours = assignments[swapIdx].actual_hours

        assignments[swapIdx].shift = tempShift
        assignments[swapIdx].actual_start = tempStart
        assignments[swapIdx].actual_end = tempEnd
        assignments[swapIdx].actual_hours = tempHours

        suggestion.applied = true
        break
      }

      default:
        // Unknown action, skip
        break
    }
  }

  return assignments
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
//  Fix Violations (re-run with context)
// ══════════════════════════════════════════════════════════════

export async function fixViolations(schedulingData, currentAssignments, violations) {
  const basePrompt = buildClientPrompt(schedulingData)
  const fixPrompt = buildFixPromptClient(basePrompt, violations, currentAssignments)

  const raw = await invokeSchedulingProxy(fixPrompt)
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

// ══════════════════════════════════════════════════════════════
//  LLM Retry: Programmatic → AI-assisted violation fixing
// ══════════════════════════════════════════════════════════════

/**
 * Run the programmatic scheduler first, then use Gemini AI to fix
 * any remaining violations. Conservative: only accepts AI changes
 * that strictly reduce the violation count.
 *
 * @param {object} data - Scheduling data (same shape as gatherSchedulingData output)
 * @param {object} options
 * @param {number} options.maxRetries - Max AI retry attempts (default 2)
 * @param {boolean} options.useAi - Whether to attempt AI fixes (default true)
 * @returns {object} Schedule result with retryAttempts and reasoning
 */
export async function runScheduleWithRetry(data, { maxRetries = 2, useAi = true } = {}) {
  // Step 1: Run programmatic algorithm
  console.log('[runScheduleWithRetry] Running programmatic schedule...')
  const programmaticResult = runProgrammaticSchedule(data)

  const allViolations = programmaticResult.violations || []
  const errorCount = allViolations.filter(v => v.severity === 'error').length
  const warningCount = allViolations.filter(v => v.severity === 'warning').length

  console.log(`[runScheduleWithRetry] Programmatic result: ${errorCount} errors, ${warningCount} warnings`)

  // Step 2: If no violations, or AI not requested/configured, return as-is
  if (allViolations.length === 0) {
    return {
      ...programmaticResult,
      retryAttempts: 0,
      reasoning: `${programmaticResult.reasoning}。無違規，無需 AI 修正。`,
    }
  }

  if (!useAi || !geminiIsConfigured()) {
    const reason = !useAi ? 'AI 修正已停用' : 'Gemini API 未設定'
    console.log(`[runScheduleWithRetry] Skipping AI retry: ${reason}`)
    return {
      ...programmaticResult,
      retryAttempts: 0,
      reasoning: `${programmaticResult.reasoning}。${reason}，跳過 AI 修正。`,
    }
  }

  // Step 3: AI retry loop
  let bestResult = programmaticResult
  let bestViolationCount = allViolations.length
  let bestErrorCount = errorCount
  const reasoningParts = [programmaticResult.reasoning]
  let retryAttempts = 0

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    retryAttempts = attempt
    console.log(`[runScheduleWithRetry] AI retry attempt ${attempt}/${maxRetries}...`)

    try {
      const currentViolations = bestResult.violations || []
      const currentAssignments = bestResult.assignments || []

      // Build the AI prompt
      const prompt = buildRetryPrompt(currentViolations, currentAssignments, data)

      // Ask Gemini for fix suggestions
      const aiResponse = await geminiChat(prompt, `schedule-retry-${Date.now()}`)

      // Parse AI suggestions
      const suggestions = parseAiSuggestions(aiResponse)

      if (!suggestions || suggestions.length === 0) {
        reasoningParts.push(`第 ${attempt} 次 AI 修正：無可用建議。`)
        continue
      }

      // Apply suggestions to a copy of current assignments
      const fixedAssignments = applyAiSuggestions(
        JSON.parse(JSON.stringify(currentAssignments)),
        suggestions,
        data
      )

      // Re-validate the fixed result
      const fixedViolations = validateClientSide(fixedAssignments, data)
      const fixedErrors = fixedViolations.filter(v => v.severity === 'error').length
      const fixedTotal = fixedViolations.length

      console.log(`[runScheduleWithRetry] Attempt ${attempt}: ${fixedErrors} errors, ${fixedTotal} total violations (was ${bestErrorCount} errors, ${bestViolationCount} total)`)

      // Conservative: only accept if strictly fewer violations
      // Priority: fewer errors first, then fewer total violations
      const improved = fixedErrors < bestErrorCount ||
        (fixedErrors === bestErrorCount && fixedTotal < bestViolationCount)

      if (improved) {
        const changesApplied = suggestions.filter(s => s.applied).length
        reasoningParts.push(
          `第 ${attempt} 次 AI 修正：套用 ${changesApplied} 項變更，` +
          `違規 ${bestViolationCount} → ${fixedTotal}（錯誤 ${bestErrorCount} → ${fixedErrors}）。`
        )

        bestResult = {
          ...bestResult,
          assignments: fixedAssignments,
          violations: fixedViolations,
          errors: fixedViolations.filter(v => v.severity === 'error'),
          warnings: fixedViolations.filter(v => v.severity === 'warning'),
        }
        bestViolationCount = fixedTotal
        bestErrorCount = fixedErrors

        // If no more errors, stop retrying
        if (fixedErrors === 0) {
          reasoningParts.push('所有錯誤已修正，停止重試。')
          break
        }
      } else {
        reasoningParts.push(
          `第 ${attempt} 次 AI 修正：未改善（${fixedErrors} errors / ${fixedTotal} total），保留原排班。`
        )
      }
    } catch (err) {
      console.error(`[runScheduleWithRetry] AI retry attempt ${attempt} failed:`, err.message)
      reasoningParts.push(`第 ${attempt} 次 AI 修正失敗：${err.message}`)
      // Continue to next attempt or return best so far
    }
  }

  return {
    ...bestResult,
    retryAttempts,
    reasoning: reasoningParts.join(' '),
    meta: {
      ...bestResult.meta,
      aiRetryAttempts: retryAttempts,
      aiImproved: bestViolationCount < allViolations.length,
    },
  }
}
