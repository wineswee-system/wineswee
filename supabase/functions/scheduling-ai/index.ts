import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

// Restrict CORS to the app's own origin in production.
// Set SITE_URL via: supabase secrets set SITE_URL=https://your-domain.com
// @ts-ignore — Deno global available at runtime in Supabase Edge Functions
const SITE_URL = Deno.env.get('SITE_URL') || '*'
const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
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
  store?: string
  absence_type?: string
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
  monthDates?: string[]
  existingSchedules: ScheduleEntry[]
  offRequests: { employee: string; date: string }[]
  preferences: { employee: string; preferred_shifts: string[]; avoid_shifts: string[] }[]
  previousWeek: ScheduleEntry[]
  crossStoreEligible?: Employee[]
  storeSettings: {
    minStaff: number
    maxStaff?: number
    operatingHours?: { open: string; close: string }
    peakDays?: number[]
  }
  budget?: { maxOvertimeHours: number; maxWeeklyCost?: number }
  tenantId?: string
}

// ══════════════════════════════════════════════════════════════
//  Constants
// ══════════════════════════════════════════════════════════════

const DAILY_MAX_HOURS = 12
const MAX_CONSECUTIVE_WORK_DAYS = 6
const MIN_SHIFT_INTERVAL = 11
const MIN_WEEKLY_REST_DAYS = 2
const MONTHLY_OVERTIME_CAP = 46
const MONTHLY_REST_DAYS_TARGET = 10

const ABSENCE_VALUES = new Set(['休', '補休', '病', '特休', '會議', '產'])

function isAbsence(shift: string): boolean {
  return ABSENCE_VALUES.has(shift)
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

function effectiveEndHour(def: ShiftDef): number {
  const s = parseTime(def.start_time)
  const e = parseTime(def.end_time)
  return e < s ? e + 24 : e
}

function isNightShift(def: ShiftDef): boolean {
  const s = parseTime(def.start_time)
  const e = parseTime(def.end_time)
  return s >= 22 || e <= 6 || e < s
}

function splitIntoWeeks(dates: string[]): string[][] {
  const weeks: string[][] = []
  let current: string[] = []
  for (const date of dates) {
    const dow = new Date(date).getDay()
    if (dow === 1 && current.length > 0) {
      weeks.push(current)
      current = []
    }
    current.push(date)
  }
  if (current.length > 0) weeks.push(current)
  return weeks
}

// ══════════════════════════════════════════════════════════════
//  Prompt Construction (single assignment per employee per day)
// ══════════════════════════════════════════════════════════════

function buildSystemPrompt(req: SchedulingRequest): string {
  const { employees, shiftDefs, weekDates, existingSchedules, offRequests, preferences, previousWeek, storeSettings, crossStoreEligible } = req

  // Build employee profiles
  const empProfiles = employees.map(emp => {
    const pref = preferences.find(p => p.employee === emp.name)
    const prevWeekShifts = previousWeek.filter(s => s.employee === emp.name)
    const lines = [
      `  - ${emp.name} | ${emp.position || '員工'} | 門市=${emp.store} | priority=${emp.schedule_priority || 3} | type=${emp.employment_type || 'full_time'}`,
      `    can_open=${emp.can_open !== false} | can_close=${emp.can_close !== false}${emp.gender ? ` | gender=${emp.gender}` : ''}${emp.is_pregnant ? ' | PREGNANT' : ''}${emp.is_nursing ? ' | NURSING' : ''}`,
    ]
    if (emp.additional_stores?.length) lines.push(`    可支援門市=[${emp.additional_stores.join(',')}]`)
    if (emp.skills?.length) lines.push(`    skills=[${emp.skills.join(',')}]`)
    if (pref) lines.push(`    preferred=[${pref.preferred_shifts.join(',')}] avoid=[${pref.avoid_shifts.join(',')}]`)
    if (prevWeekShifts.length) lines.push(`    上週: [${prevWeekShifts.map(s => `${s.date}:${s.shift}`).join(', ')}]`)
    return lines.join('\n')
  }).join('\n')

  const shiftInfo = shiftDefs.map(d =>
    `  - "${d.name}" | ${d.start_time}~${d.end_time} | ${shiftHours(d).toFixed(1)}h | store=${d.store_id || 'all'} | emp_type=${d.employee_type || 'all'}`
  ).join('\n')

  const locked = existingSchedules.filter(s => !isAbsence(s.shift)).map(s => `  - ${s.employee} | ${s.date} | ${s.shift} (LOCKED)`).join('\n')
  const offInfo = offRequests.map(o => `  - ${o.employee} OFF on ${o.date}`).join('\n')

  const dateContext = weekDates.map(d => {
    const dayLabels = ['日', '一', '二', '三', '四', '五', '六']
    const dow = dayLabels[new Date(d).getDay()]
    const isPeak = storeSettings.peakDays?.includes(new Date(d).getDay())
    return `  - ${d} (${dow})${isPeak ? ' [PEAK]' : ''}`
  }).join('\n')

  // Cross-store section
  let crossStoreSection = ''
  if (crossStoreEligible?.length) {
    crossStoreSection = `\n## 跨店支援候選人
以下員工來自其他門市，可在人力不足時借調：
${crossStoreEligible.map(e => `  - ${e.name} | 主店=${e.store} | 可支援=[${(e.additional_stores || []).join(',')}]`).join('\n')}
借調時 assignment 中加入 "store" 欄位標示被支援的門市。\n`
  }

  const numDays = weekDates.length

  return `你是台灣門市排班專家 AI。請根據以下資訊產生排班表，嚴格遵守台灣勞基法。

## 排班期間 (${numDays} 天)
${dateContext}

## 員工 (${employees.length} 人)
${empProfiles}

## 可用班別
${shiftInfo}

## 假別代碼
  - "休" = 例假/休息日
  - "補休" = 補休假
  - "病" = 病假
  - "特休" = 特別休假
  - "會議" = 開會 (部分工時)
  - "產" = 產假
${crossStoreSection}
## 已鎖定班表 (不可修改)
${locked || '  (無)'}

## 請假申請 (該天必須排休)
${offInfo || '  (無)'}

## 人力需求
- 每天最少人力: ${storeSettings.minStaff}
${storeSettings.maxStaff ? `- 每天最多人力: ${storeSettings.maxStaff}` : ''}
${req.budget ? `- 月加班時數上限: ${req.budget.maxOvertimeHours}h` : ''}

## 硬性規則 (H1-H15) — 不可違反
H1: 有請假的員工當天必須排休（使用對應假別代碼）
H2: 每天工時 ≤${DAILY_MAX_HOURS}h (勞基法 §30,§32)
H3: 連續工作 ≤${MAX_CONSECUTIVE_WORK_DAYS} 天 (勞基法 §36 七休一)
H4: 換班間隔 ≥${MIN_SHIFT_INTERVAL} 小時 (勞基法 §34)
H5: 連續工作 4h 需休息 30 分鐘 (勞基法 §35)
H6: 每月加班 ≤${MONTHLY_OVERTIME_CAP}h (勞基法 §32)
H9: 開店班需 can_open=true，關店班需 can_close=true
H10: 每週至少 ${MIN_WEEKLY_REST_DAYS} 天完整休假 (勞基法 §36 一例一休)
H12: 女性夜班 (22-06) 需工會同意 (勞基法 §49)
H13: 孕婦/哺乳期不得排夜班 (性平法 §15)
H14: 班別需對應員工所屬門市（或該員工的可支援門市）
H15: 兼職員工只排兼職班別

## 軟性規則 (S1-S7) — 盡量遵守
S1: 每天達到最低人力 ${storeSettings.minStaff} 人，尖峰日多 1-2 人
S2: 尊重員工班別偏好
S3: 公平分配班次
S4: 週末出勤公平輪流
S5: 每人每週工時盡量接近 40h
S6: 高優先權員工 (priority=1) 優先排偏好班別
S7: 每月目標 ~${MONTHLY_REST_DAYS_TARGET} 天休假

## 輸出格式
只回傳合法 JSON：
{
  "assignments": [{ "employee": "姓名", "date": "YYYY-MM-DD", "shift": "班別名稱 or 休/補休/病/特休/會議" }],
  "reasoning": "簡短說明排班邏輯",
  "warnings": ["注意事項"]
}

規則：
1. 每位員工每天恰好 1 筆 assignment
2. 不可修改已鎖定的班表
3. shift 欄位用精確的班別名稱或假別代碼
4. 只輸出 JSON
5. 全部員工合計 ${employees.length * numDays} 筆`
}

// ══════════════════════════════════════════════════════════════
//  Validation
// ══════════════════════════════════════════════════════════════

function validateSchedule(
  assignments: ScheduleEntry[],
  req: SchedulingRequest
): Violation[] {
  const violations: Violation[] = []
  const { employees, shiftDefs, weekDates, offRequests, storeSettings } = req

  const shiftDefMap: Record<string, ShiftDef> = {}
  for (const d of shiftDefs) shiftDefMap[d.name] = d

  const offMap: Record<string, boolean> = {}
  for (const o of offRequests) offMap[`${o.employee}_${o.date}`] = true

  const byEmployee: Record<string, ScheduleEntry[]> = {}
  for (const a of assignments) {
    if (!byEmployee[a.employee]) byEmployee[a.employee] = []
    byEmployee[a.employee].push(a)
  }

  for (const emp of employees) {
    const empAssignments = (byEmployee[emp.name] || []).sort((a, b) => a.date.localeCompare(b.date))
    const workDays = empAssignments.filter(a => !isAbsence(a.shift))
    const restDays = empAssignments.filter(a => isAbsence(a.shift))

    // H1: Off-request
    for (const a of empAssignments) {
      if (offMap[`${emp.name}_${a.date}`] && !isAbsence(a.shift)) {
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
      if (def && shiftHours(def) > DAILY_MAX_HOURS) {
        violations.push({
          employee: emp.name, constraint: 'H2', law: '勞基法 §30/§32',
          message: `${emp.name} on ${a.date}: shift "${a.shift}" is ${shiftHours(def).toFixed(1)}h, exceeds ${DAILY_MAX_HOURS}h`,
          severity: 'error',
        })
      }
    }

    // H3: Max consecutive work days
    let consecutive = 0
    for (const date of weekDates) {
      const a = empAssignments.find(a => a.date === date)
      if (a && !isAbsence(a.shift)) {
        consecutive++
        if (consecutive > MAX_CONSECUTIVE_WORK_DAYS) {
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

    // H4: Shift interval ≥ 11h
    for (let i = 0; i < weekDates.length - 1; i++) {
      const todayA = empAssignments.find(a => a.date === weekDates[i])
      const tomorrowA = empAssignments.find(a => a.date === weekDates[i + 1])
      if (!todayA || isAbsence(todayA.shift) || !tomorrowA || isAbsence(tomorrowA.shift)) continue
      const todayDef = shiftDefMap[todayA.shift]
      const tomorrowDef = shiftDefMap[tomorrowA.shift]
      if (!todayDef || !tomorrowDef) continue
      const latestEnd = effectiveEndHour(todayDef)
      const earliestStart = parseTime(tomorrowDef.start_time)
      const gap = (earliestStart + 24) - latestEnd
      if (gap < MIN_SHIFT_INTERVAL) {
        violations.push({
          employee: emp.name, constraint: 'H4', law: '勞基法 §34',
          message: `${emp.name} ${weekDates[i]}→${weekDates[i + 1]}: ${gap.toFixed(1)}h gap (${todayA.shift}→${tomorrowA.shift}), min ${MIN_SHIFT_INTERVAL}h`,
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
        violations.push({ employee: emp.name, constraint: 'H9', law: '排班規則', message: `${emp.name} on ${a.date}: opening shift but can_open=false`, severity: 'error' })
      }
      if ((endH >= 21 || endH < startH) && emp.can_close === false) {
        violations.push({ employee: emp.name, constraint: 'H9', law: '排班規則', message: `${emp.name} on ${a.date}: closing shift but can_close=false`, severity: 'error' })
      }
    }

    // H10: Min rest days per week
    const weeks = splitIntoWeeks(weekDates)
    for (const week of weeks) {
      if (week.length < 7) continue
      let weekRest = 0
      for (const date of week) {
        const a = empAssignments.find(a => a.date === date)
        if (!a || isAbsence(a.shift)) weekRest++
      }
      if (weekRest < MIN_WEEKLY_REST_DAYS) {
        violations.push({
          employee: emp.name, constraint: 'H10', law: '勞基法 §36',
          message: `${emp.name} week ${week[0]}~${week[week.length - 1]}: only ${weekRest} rest days, min ${MIN_WEEKLY_REST_DAYS}`,
          severity: 'error',
        })
      }
    }

    // H12 & H13: Night shift restrictions
    for (const a of workDays) {
      const def = shiftDefMap[a.shift]
      if (!def || !isNightShift(def)) continue
      if (emp.is_pregnant || emp.is_nursing) {
        violations.push({ employee: emp.name, constraint: 'H13', law: '性平法 §15', message: `${emp.name} (pregnant/nursing) assigned night shift "${a.shift}" on ${a.date}`, severity: 'error' })
      } else if (emp.gender === 'F') {
        violations.push({ employee: emp.name, constraint: 'H12', law: '勞基法 §49', message: `${emp.name} (female) assigned night shift "${a.shift}" on ${a.date} — requires union agreement`, severity: 'warning' })
      }
    }
  }

  // S1: Daily staffing
  for (const date of weekDates) {
    const working = assignments.filter(a => a.date === date && !isAbsence(a.shift)).length
    if (working < storeSettings.minStaff) {
      violations.push({ employee: '-', constraint: 'S1', law: '營運需求', message: `${date}: only ${working} staff, min ${storeSettings.minStaff}`, severity: 'warning' })
    }
  }

  // S6: Fairness check
  const hoursByEmp: Record<string, number> = {}
  for (const emp of employees) {
    const work = (byEmployee[emp.name] || []).filter(a => !isAbsence(a.shift))
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
      violations.push({ employee: '-', constraint: 'S6', law: '公平性', message: `Hours variance too high: max deviation ${maxDiff.toFixed(1)}h from average ${avg.toFixed(1)}h`, severity: 'warning' })
    }
  }

  return violations
}

// ══════════════════════════════════════════════════════════════
//  Gemini API Call
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
        maxOutputTokens: 16384,
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
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  try {
    const parsed = JSON.parse(cleaned)
    return { assignments: parsed.assignments || [], reasoning: parsed.reasoning || '', warnings: parsed.warnings || [] }
  } catch { /* fallback */ }

  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    let jsonStr = cleaned.slice(firstBrace, lastBrace + 1)
    jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1')
    try {
      const parsed = JSON.parse(jsonStr)
      return { assignments: parsed.assignments || [], reasoning: parsed.reasoning || '', warnings: parsed.warnings || [] }
    } catch { /* last resort */ }
  }

  const assignMatch = cleaned.match(/"assignments"\s*:\s*(\[[\s\S]*?\])\s*[,}]/)
  if (assignMatch) {
    try {
      const assignments = JSON.parse(assignMatch[1].replace(/,\s*([\]}])/g, '$1'))
      return { assignments, reasoning: 'JSON 解析修復模式', warnings: ['JSON 格式已自動修復'] }
    } catch { /* give up */ }
  }

  throw new Error('AI 回傳格式無法解析')
}

// ══════════════════════════════════════════════════════════════
//  Fix Violations Prompt
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
${violationSummary}

Previous (invalid) assignments:
${JSON.stringify(previousOutput)}

Regenerate a CORRECTED schedule fixing ALL violations. Return valid JSON only.`
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

    const systemPrompt = buildSystemPrompt(req)

    // First LLM call
    console.log('[scheduling-ai] Calling Gemini 2.5 Pro (attempt 1)...')
    const raw1 = await callGemini(systemPrompt, apiKey)
    let result = parseAiResponse(raw1)

    let violations = validateSchedule(result.assignments, req)
    const errors1 = violations.filter(v => v.severity === 'error')
    console.log(`[scheduling-ai] Attempt 1: ${result.assignments.length} assignments, ${errors1.length} errors, ${violations.length - errors1.length} warnings`)

    // Retry if violations
    if (errors1.length > 0) {
      console.log(`[scheduling-ai] ${errors1.length} errors found, retrying...`)
      const fixPrompt = buildFixPrompt(systemPrompt, violations, result.assignments)
      const raw2 = await callGemini(fixPrompt, apiKey)
      const result2 = parseAiResponse(raw2)
      const violations2 = validateSchedule(result2.assignments, req)
      const errors2 = violations2.filter(v => v.severity === 'error')
      console.log(`[scheduling-ai] Attempt 2: ${result2.assignments.length} assignments, ${errors2.length} errors`)

      if (errors2.length < errors1.length) {
        result = result2
        violations = violations2
      }
    }

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
          retried: errors1.length > 0,
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
