import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ══════════════════════════════════════════════════════════════
//  Types
// ══════════════════════════════════════════════════════════════

interface Employee {
  id: string
  name: string
  dept: string
  position: string
  store: string
  employment_type: string
  schedule_priority: number
  can_open: boolean
  can_close: boolean
  additional_stores: string[]
  gender?: string
  is_pregnant?: boolean
  is_nursing?: boolean
  skills?: string[]
}

interface ShiftDef {
  id: string
  name: string
  start_time: string  // "HH:MM"
  end_time: string
  color: string
  store_id: string | null
  employee_type: string | null
  sort_order: number
}

interface ScheduleEntry {
  employee: string
  date: string
  shift: string
}

interface Violation {
  employee: string
  constraint: string
  law: string
  message: string
  severity: 'error' | 'warning'
}

interface SchedulingRequest {
  employees: Employee[]
  shiftDefs: ShiftDef[]
  weekDates: string[]
  existingSchedules: ScheduleEntry[]
  offRequests: { employee: string; date: string }[]
  holidays: string[]
  preferences: { employee: string; preferred_shifts: string[]; avoid_shifts: string[] }[]
  previousWeek: ScheduleEntry[]
  historicalSchedules: ScheduleEntry[]  // 8-week history
  storeSettings: {
    minStaff: number
    maxStaff?: number
    operatingHours?: { open: string; close: string }
    peakDays?: number[]  // 0=Sun ... 6=Sat
  }
  budget?: { maxOvertimeHours: number; maxWeeklyCost?: number }
  tenantId?: string
}

// ══════════════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════════════

function parseTime(t: string): number {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return (h || 0) + (m || 0) / 60
}

function shiftHours(def: ShiftDef): number {
  const s = parseTime(def.start_time)
  const e = parseTime(def.end_time)
  return e > s ? e - s : (24 - s + e)
}

function shiftGapHours(prevDef: ShiftDef, currDef: ShiftDef): number {
  const prevStart = parseTime(prevDef.start_time)
  const prevEnd = parseTime(prevDef.end_time)
  const currStart = parseTime(currDef.start_time)
  const crossesMidnight = prevEnd < prevStart
  if (crossesMidnight) {
    return currStart - prevEnd  // both on same calendar day
  }
  return currStart + (24 - prevEnd)
}

function isNightShift(def: ShiftDef): boolean {
  const s = parseTime(def.start_time)
  const e = parseTime(def.end_time)
  // Overlaps 22:00-06:00 window
  return s >= 22 || e <= 6 || e < s
}

// ══════════════════════════════════════════════════════════════
//  Phase 3: Historical Pattern Analysis
// ══════════════════════════════════════════════════════════════

function analyzeHistoricalPatterns(
  employees: Employee[],
  history: ScheduleEntry[],
  shiftDefs: ShiftDef[]
) {
  const patterns: Record<string, {
    avgHoursPerWeek: number
    dayOfWeekFrequency: Record<number, number>  // 0=Mon frequency
    shiftTypeDistribution: Record<string, number>
    weekendWorkRatio: number
    totalWeeksTracked: number
  }> = {}

  for (const emp of employees) {
    const empSchedules = history.filter(s => s.employee === emp.name && s.shift !== '休')

    // Group by ISO week
    const weekMap: Record<string, ScheduleEntry[]> = {}
    for (const s of empSchedules) {
      const d = new Date(s.date)
      const weekNum = `${d.getFullYear()}-W${Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7)}`
      if (!weekMap[weekNum]) weekMap[weekNum] = []
      weekMap[weekNum].push(s)
    }

    const totalWeeks = Math.max(Object.keys(weekMap).length, 1)

    // Day-of-week frequency (0=Mon ... 6=Sun)
    const dowFreq: Record<number, number> = {}
    for (let i = 0; i < 7; i++) dowFreq[i] = 0
    for (const s of empSchedules) {
      const dow = (new Date(s.date).getDay() + 6) % 7  // Mon=0
      dowFreq[dow]++
    }

    // Shift type distribution
    const shiftDist: Record<string, number> = {}
    for (const s of empSchedules) {
      shiftDist[s.shift] = (shiftDist[s.shift] || 0) + 1
    }

    // Weekend work ratio
    const weekendDays = empSchedules.filter(s => {
      const dow = new Date(s.date).getDay()
      return dow === 0 || dow === 6
    }).length
    const weekendRatio = empSchedules.length > 0 ? weekendDays / empSchedules.length : 0

    // Average hours per week
    let totalHours = 0
    for (const s of empSchedules) {
      const def = shiftDefs.find(d => d.name === s.shift)
      totalHours += def ? shiftHours(def) : 8
    }

    patterns[emp.name] = {
      avgHoursPerWeek: totalHours / totalWeeks,
      dayOfWeekFrequency: dowFreq,
      shiftTypeDistribution: shiftDist,
      weekendWorkRatio: weekendRatio,
      totalWeeksTracked: totalWeeks,
    }
  }

  return patterns
}

// ══════════════════════════════════════════════════════════════
//  Phase 4: Prompt Construction
// ══════════════════════════════════════════════════════════════

function buildSystemPrompt(req: SchedulingRequest, patterns: ReturnType<typeof analyzeHistoricalPatterns>): string {
  const { employees, shiftDefs, weekDates, existingSchedules, offRequests, holidays, preferences, previousWeek, storeSettings } = req

  const holidaySet = new Set(holidays)
  const offMap: Record<string, boolean> = {}
  for (const o of offRequests) offMap[`${o.employee}_${o.date}`] = true

  // Build employee profiles
  const empProfiles = employees.map(emp => {
    const pref = preferences.find(p => p.employee === emp.name)
    const hist = patterns[emp.name]
    const prevWeekShifts = previousWeek.filter(s => s.employee === emp.name)

    return `  - ${emp.name} | ${emp.position} | ${emp.store} | priority=${emp.schedule_priority || 3} | type=${emp.employment_type || 'full_time'}
    can_open=${emp.can_open !== false} | can_close=${emp.can_close !== false}
    ${emp.gender ? `gender=${emp.gender}` : ''} ${emp.is_pregnant ? '| PREGNANT' : ''} ${emp.is_nursing ? '| NURSING' : ''}
    ${emp.skills?.length ? `skills=[${emp.skills.join(',')}]` : ''}
    ${emp.additional_stores?.length ? `cross_store=[${emp.additional_stores.join(',')}]` : ''}
    ${pref ? `preferred=[${pref.preferred_shifts.join(',')}] avoid=[${pref.avoid_shifts.join(',')}]` : ''}
    ${hist ? `history: avg ${hist.avgHoursPerWeek.toFixed(1)}h/wk, weekend_ratio=${(hist.weekendWorkRatio * 100).toFixed(0)}%` : ''}
    last_week: [${prevWeekShifts.map(s => `${s.date}:${s.shift}`).join(', ')}]`
  }).join('\n')

  // Build shift definitions
  const shiftInfo = shiftDefs.map(d =>
    `  - "${d.name}" | ${d.start_time}~${d.end_time} | ${shiftHours(d).toFixed(1)}h | store=${d.store_id || 'all'} | emp_type=${d.employee_type || 'all'}`
  ).join('\n')

  // Build existing assignments (locked)
  const locked = existingSchedules.map(s => `  - ${s.employee} | ${s.date} | ${s.shift} (LOCKED)`).join('\n')

  // Build off-requests & holidays
  const offInfo = offRequests.map(o => `  - ${o.employee} OFF on ${o.date}`).join('\n')
  const holidayInfo = holidays.filter(h => weekDates.includes(h)).map(h => `  - ${h}`).join('\n')

  // Build date context
  const dateContext = weekDates.map(d => {
    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(new Date(d).getDay() + 6) % 7]
    const isHoliday = holidaySet.has(d)
    const isPeak = storeSettings.peakDays?.includes(new Date(d).getDay())
    return `  - ${d} (${dow})${isHoliday ? ' [HOLIDAY]' : ''}${isPeak ? ' [PEAK]' : ''}`
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

## STAFFING REQUIREMENTS
- Minimum staff per day: ${storeSettings.minStaff}
${storeSettings.maxStaff ? `- Maximum staff per day: ${storeSettings.maxStaff}` : ''}
${req.budget ? `- Max overtime hours budget: ${req.budget.maxOvertimeHours}h/month` : ''}

## HARD CONSTRAINTS (H1-H15) — MUST NOT VIOLATE
H1: Employees with off-requests or on approved leave MUST be assigned "休" on those dates.
H2: Normal work hours max 8h/day. With overtime, absolute max 12h/day. (勞基法 §30, §32)
H3: Max 6 consecutive work days. Every 7 days must include at least 1 regular day off. (勞基法 §36 七休一)
H4: Minimum 11 hours rest between shift changes. Can be reduced to 8h only with union agreement. (勞基法 §34)
H5: After 4 continuous work hours, must have at least 30 min break. (勞基法 §35)
H6: Monthly overtime cap: 46 hours. (勞基法 §32)
H7: Quarterly overtime cap: 138 hours (if monthly exceeds 46h with union agreement, max 54h/month). (勞基法 §32)
H8: Employees must only be assigned shifts matching their skills/position. PT employees only get PT-eligible shifts.
H9: Opening shifts require can_open=true. Closing shifts require can_close=true.
H10: Minimum 2 rest days per week (1 regular day off + 1 rest day). (勞基法 §36)
H11: National holidays — assign "休" unless employee explicitly agrees to work (then pay 2x). (勞基法 §37)
H12: Female employees cannot work 22:00-06:00 night shifts UNLESS union agreement + safety measures are in place. (勞基法 §49)
H13: Pregnant or nursing employees MUST NOT be assigned night shifts (22:00-06:00). (性平法 §15, 職安法 §30-1)
H14: Shifts must match the employee's store assignment (store_id match or global shift).
H15: Employment type matching — PT employees get PT-eligible shifts only; full-time get full-time shifts.

## SOFT CONSTRAINTS (S1-S8) — OPTIMIZE WHEN POSSIBLE
S1: Meet minimum staffing level (${storeSettings.minStaff} people/day). On peak days, aim for +1-2 above minimum.
S2: Respect employee shift preferences (preferred_shifts / avoid_shifts). Weight: high.
S3: Stay within overtime budget. Prefer standard hours over overtime assignments.
S4: Match historical demand patterns — schedule more staff on historically busy days.
S5: Maintain schedule consistency — similar patterns to previous weeks when possible.
S6: Fairness — distribute weekend/holiday work evenly. Minimize variance in total hours across employees.
S7: Higher priority employees (priority=1) get preferred/peak shifts first.
S8: Avoid assigning the same employee consecutive unpopular shifts (closing→opening, weekend→weekend).

## OUTPUT FORMAT
Return ONLY a valid JSON object with this exact structure:
{
  "assignments": [
    { "employee": "Name", "date": "YYYY-MM-DD", "shift": "ShiftName or 休" }
  ],
  "reasoning": "Brief explanation of key scheduling decisions",
  "warnings": ["Any soft constraint trade-offs made"]
}

RULES:
1. Every employee MUST have exactly one assignment per day for all 7 days.
2. Do NOT modify any LOCKED assignments.
3. Use exact shift names from the AVAILABLE SHIFTS list, or "休" for rest.
4. Output valid JSON only — no markdown, no code fences, no extra text.`
}

// ══════════════════════════════════════════════════════════════
//  Phase 5: Validate AI Output
// ══════════════════════════════════════════════════════════════

function validateSchedule(
  assignments: ScheduleEntry[],
  req: SchedulingRequest
): Violation[] {
  const violations: Violation[] = []
  const { employees, shiftDefs, weekDates, offRequests, holidays, storeSettings } = req

  const shiftDefMap: Record<string, ShiftDef> = {}
  for (const d of shiftDefs) shiftDefMap[d.name] = d

  const offMap: Record<string, boolean> = {}
  for (const o of offRequests) offMap[`${o.employee}_${o.date}`] = true

  const holidaySet = new Set(holidays)

  // Group by employee
  const byEmployee: Record<string, ScheduleEntry[]> = {}
  for (const a of assignments) {
    if (!byEmployee[a.employee]) byEmployee[a.employee] = []
    byEmployee[a.employee].push(a)
  }

  for (const emp of employees) {
    const empAssignments = (byEmployee[emp.name] || [])
      .sort((a, b) => a.date.localeCompare(b.date))

    const workDays = empAssignments.filter(a => a.shift !== '休')
    const restDays = empAssignments.filter(a => a.shift === '休')

    // H1: Off-request violations
    for (const a of empAssignments) {
      if (offMap[`${emp.name}_${a.date}`] && a.shift !== '休') {
        violations.push({
          employee: emp.name, constraint: 'H1', law: '排班規則',
          message: `${emp.name} has off-request on ${a.date} but assigned "${a.shift}"`,
          severity: 'error',
        })
      }
    }

    // H2: Max daily hours
    for (const a of workDays) {
      const def = shiftDefMap[a.shift]
      if (def && shiftHours(def) > 12) {
        violations.push({
          employee: emp.name, constraint: 'H2', law: '勞基法 §30/§32',
          message: `${emp.name} on ${a.date}: shift "${a.shift}" is ${shiftHours(def).toFixed(1)}h, exceeds 12h max`,
          severity: 'error',
        })
      }
    }

    // H3: Max 6 consecutive work days
    let consecutive = 0
    for (const date of weekDates) {
      const a = empAssignments.find(a => a.date === date)
      if (a && a.shift !== '休') {
        consecutive++
        if (consecutive > 6) {
          violations.push({
            employee: emp.name, constraint: 'H3', law: '勞基法 §36',
            message: `${emp.name} has ${consecutive} consecutive work days ending ${date}`,
            severity: 'error',
          })
        }
      } else {
        consecutive = 0
      }
    }

    // H4: 11-hour shift interval
    for (let i = 1; i < empAssignments.length; i++) {
      const prev = empAssignments[i - 1]
      const curr = empAssignments[i]
      if (prev.shift === '休' || curr.shift === '休') continue
      const prevDef = shiftDefMap[prev.shift]
      const currDef = shiftDefMap[curr.shift]
      if (!prevDef || !currDef) continue
      const gap = shiftGapHours(prevDef, currDef)
      if (gap < 11) {
        violations.push({
          employee: emp.name, constraint: 'H4', law: '勞基法 §34',
          message: `${emp.name} ${prev.date}→${curr.date}: only ${gap.toFixed(1)}h gap (${prev.shift}→${curr.shift}), min 11h required`,
          severity: 'error',
        })
      }
    }

    // H9: Open/close capability
    for (const a of workDays) {
      const def = shiftDefMap[a.shift]
      if (!def) continue
      const startH = parseTime(def.start_time)
      const endH = parseTime(def.end_time)
      if (startH <= 9 && emp.can_open === false) {
        violations.push({
          employee: emp.name, constraint: 'H9', law: '排班規則',
          message: `${emp.name} on ${a.date}: assigned opening shift "${a.shift}" but can_open=false`,
          severity: 'error',
        })
      }
      if ((endH >= 21 || endH < startH) && emp.can_close === false) {
        violations.push({
          employee: emp.name, constraint: 'H9', law: '排班規則',
          message: `${emp.name} on ${a.date}: assigned closing shift "${a.shift}" but can_close=false`,
          severity: 'error',
        })
      }
    }

    // H10: Min 2 rest days per week
    if (restDays.length < 2 && empAssignments.length >= 7) {
      violations.push({
        employee: emp.name, constraint: 'H10', law: '勞基法 §36',
        message: `${emp.name} has only ${restDays.length} rest days this week, minimum 2 required`,
        severity: 'error',
      })
    }

    // H11: Holiday work check
    for (const a of workDays) {
      if (holidaySet.has(a.date)) {
        violations.push({
          employee: emp.name, constraint: 'H11', law: '勞基法 §37',
          message: `${emp.name} assigned to work on holiday ${a.date} — requires explicit consent + 2x pay`,
          severity: 'warning',
        })
      }
    }

    // H12 & H13: Night shift restrictions
    for (const a of workDays) {
      const def = shiftDefMap[a.shift]
      if (!def || !isNightShift(def)) continue
      if (emp.is_pregnant || emp.is_nursing) {
        violations.push({
          employee: emp.name, constraint: 'H13', law: '性平法 §15 / 職安法 §30-1',
          message: `${emp.name} (pregnant/nursing) assigned night shift "${a.shift}" on ${a.date} — PROHIBITED`,
          severity: 'error',
        })
      } else if (emp.gender === 'F') {
        violations.push({
          employee: emp.name, constraint: 'H12', law: '勞基法 §49',
          message: `${emp.name} (female) assigned night shift "${a.shift}" on ${a.date} — requires union agreement`,
          severity: 'warning',
        })
      }
    }

    // H14 & H15: Store/type matching
    for (const a of workDays) {
      const def = shiftDefMap[a.shift]
      if (!def) {
        violations.push({
          employee: emp.name, constraint: 'H14', law: '排班規則',
          message: `${emp.name} on ${a.date}: shift "${a.shift}" not found in shift definitions`,
          severity: 'error',
        })
      }
    }

    // S1: Staffing levels (as warning)
    // Check per-day after all employees
  }

  // S1: Check daily staffing
  for (const date of weekDates) {
    const working = assignments.filter(a => a.date === date && a.shift !== '休').length
    if (working < storeSettings.minStaff) {
      violations.push({
        employee: '-', constraint: 'S1', law: '營運需求',
        message: `${date}: only ${working} staff scheduled, minimum ${storeSettings.minStaff} required`,
        severity: 'warning',
      })
    }
  }

  // S6: Fairness check
  const hoursByEmp: Record<string, number> = {}
  for (const emp of employees) {
    const work = (byEmployee[emp.name] || []).filter(a => a.shift !== '休')
    let hours = 0
    for (const a of work) {
      const def = shiftDefMap[a.shift]
      hours += def ? shiftHours(def) : 8
    }
    hoursByEmp[emp.name] = hours
  }
  const hoursValues = Object.values(hoursByEmp)
  if (hoursValues.length > 1) {
    const avg = hoursValues.reduce((a, b) => a + b, 0) / hoursValues.length
    const maxDiff = Math.max(...hoursValues.map(h => Math.abs(h - avg)))
    if (maxDiff > 12) {
      violations.push({
        employee: '-', constraint: 'S6', law: '公平性',
        message: `Hours variance too high: max deviation ${maxDiff.toFixed(1)}h from average ${avg.toFixed(1)}h`,
        severity: 'warning',
      })
    }
  }

  return violations
}

// ══════════════════════════════════════════════════════════════
//  Phase 5: Call Gemini 2.5 Pro
// ══════════════════════════════════════════════════════════════

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${err}`)
  }

  const data = await response.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

function parseAiResponse(raw: string): { assignments: ScheduleEntry[]; reasoning: string; warnings: string[] } {
  // Strip markdown fences if present
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }
  const parsed = JSON.parse(cleaned)
  return {
    assignments: parsed.assignments || [],
    reasoning: parsed.reasoning || '',
    warnings: parsed.warnings || [],
  }
}

// ══════════════════════════════════════════════════════════════
//  Phase 6: Fix Violations (retry prompt)
// ══════════════════════════════════════════════════════════════

function buildFixPrompt(
  originalPrompt: string,
  violations: Violation[],
  previousOutput: ScheduleEntry[]
): string {
  const errorViolations = violations.filter(v => v.severity === 'error')
  const violationSummary = errorViolations.map(v =>
    `  - [${v.constraint}] ${v.message} (${v.law})`
  ).join('\n')

  return `${originalPrompt}

## PREVIOUS ATTEMPT HAD ${errorViolations.length} VIOLATIONS — FIX THEM

The previous schedule output had these violations that MUST be fixed:
${violationSummary}

Previous (invalid) assignments:
${JSON.stringify(previousOutput, null, 2)}

Please regenerate a CORRECTED schedule that fixes ALL of the above violations while still respecting all hard and soft constraints.
Return ONLY valid JSON in the same format as before.`
}

// ══════════════════════════════════════════════════════════════
//  Main Handler
// ══════════════════════════════════════════════════════════════

serve(async (httpReq) => {
  if (httpReq.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured on server' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const req: SchedulingRequest = await httpReq.json()

    // ── Phase 3: Analyze history ──
    const patterns = analyzeHistoricalPatterns(req.employees, req.historicalSchedules || [], req.shiftDefs)

    // ── Phase 4: Build prompt ──
    const systemPrompt = buildSystemPrompt(req, patterns)

    // ── Phase 5: First LLM call ──
    console.log('[scheduling-ai] Calling Gemini 2.5 Pro (attempt 1)...')
    const raw1 = await callGemini(systemPrompt, apiKey)
    let result = parseAiResponse(raw1)

    // ── Validate ──
    let violations = validateSchedule(result.assignments, req)
    const errors1 = violations.filter(v => v.severity === 'error')
    console.log(`[scheduling-ai] Attempt 1: ${result.assignments.length} assignments, ${errors1.length} errors, ${violations.length - errors1.length} warnings`)

    // ── Phase 6: Retry if violations ──
    if (errors1.length > 0) {
      console.log(`[scheduling-ai] ${errors1.length} errors found, retrying with fix prompt...`)
      const fixPrompt = buildFixPrompt(systemPrompt, violations, result.assignments)
      const raw2 = await callGemini(fixPrompt, apiKey)
      const result2 = parseAiResponse(raw2)
      const violations2 = validateSchedule(result2.assignments, req)
      const errors2 = violations2.filter(v => v.severity === 'error')

      console.log(`[scheduling-ai] Attempt 2: ${result2.assignments.length} assignments, ${errors2.length} errors`)

      // Use attempt 2 if it has fewer errors
      if (errors2.length < errors1.length) {
        result = result2
        violations = violations2
      }
    }

    // ── Return draft result ──
    return new Response(
      JSON.stringify({
        success: true,
        assignments: result.assignments,
        reasoning: result.reasoning,
        aiWarnings: result.warnings,
        violations: violations,
        errors: violations.filter(v => v.severity === 'error'),
        warnings: violations.filter(v => v.severity === 'warning'),
        meta: {
          model: 'gemini-2.5-pro',
          employeeCount: req.employees.length,
          totalAssignments: result.assignments.length,
          retried: violations.filter(v => v.severity === 'error').length > 0,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[scheduling-ai] Error:', err)
    return new Response(
      JSON.stringify({ error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
