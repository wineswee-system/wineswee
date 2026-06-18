/**
 * Prompt Builder
 * Builds AI prompt strings for scheduling and violation-fix requests.
 */

import {
  parseTime, getShiftHours, isAbsence,
  MONTHLY_OVERTIME_CAP, MONTHLY_REST_DAYS_TARGET,
  MIN_SHIFT_INTERVAL, MAX_CONSECUTIVE_WORK_DAYS, MIN_WEEKLY_REST_DAYS,
  DAILY_MAX_SPAN_HOURS,
} from '../scheduleUtils'

// ══════════════════════════════════════════════════════════════
//  Client-Side Prompt Builder (single assignment per employee per day)
// ══════════════════════════════════════════════════════════════

export function buildClientPrompt(data) {
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
${crossStoreSection}## 已鎖定班表 (不可修改)
${locked || '  (無)'}

## 請假申請 (該天必須排休)
${offInfo || '  (無)'}

## 人力需求
- 每天最少人力: ${storeSettings.minStaff} 人
- 週末/尖峰日: 建議多 1-2 人

## 硬性規則 (不可違反)
H1: 有請假的員工當天必須排休（使用對應假別代碼）
H2: 每天工時 ≤${DAILY_MAX_SPAN_HOURS}h（公司規定，10 工作 + 1 休息）
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

export function buildFixPromptClient(originalPrompt, violations, previousOutput) {
  const errorViolations = violations.filter(v => v.severity === 'error')
  const summary = errorViolations.map(v => `  - [${v.constraint}] ${v.message}`).join('\n')

  return `${originalPrompt}

## PREVIOUS ATTEMPT HAD ${errorViolations.length} VIOLATIONS — FIX THEM
${summary}

Previous assignments: ${JSON.stringify(previousOutput)}

Regenerate a CORRECTED schedule fixing ALL violations. Return valid JSON only.`
}

// ══════════════════════════════════════════════════════════════
//  Retry Prompt Builder (AI-assisted violation fixing)
// ══════════════════════════════════════════════════════════════

/**
 * Build a prompt asking Gemini to suggest fixes for scheduling violations.
 */
export function buildRetryPrompt(violations, assignments, data) {
  const { employees, shiftDefs } = data

  const violationSummary = violations.map(v =>
    `- [${v.severity}][${v.constraint}] ${v.message}`
  ).join('\n')

  // Summarize current assignments (group by employee)
  const assignmentsByEmp = {}
  for (const a of assignments) {
    if (!assignmentsByEmp[a.employee]) assignmentsByEmp[a.employee] = []
    assignmentsByEmp[a.employee].push(`${a.date}:${a.shift}`)
  }
  const assignmentSummary = Object.entries(assignmentsByEmp).map(
    ([emp, shifts]) => `  ${emp}: ${shifts.join(', ')}`
  ).join('\n')

  // Employee constraints summary
  const constraintSummary = employees.map(emp => {
    const parts = [`${emp.name} (${emp.employment_type || 'full_time'})`]
    if (emp.can_open === false) parts.push('不可開店')
    if (emp.can_close === false) parts.push('不可關店')
    if (emp.is_pregnant) parts.push('孕婦')
    if (emp.is_nursing) parts.push('哺乳')
    return `  - ${parts.join(' | ')}`
  }).join('\n')

  // Available shifts
  const shiftList = shiftDefs.map(d =>
    `  - "${d.name}" ${d.start_time?.slice(0, 5)}~${d.end_time?.slice(0, 5)} (${getShiftHours(d).toFixed(1)}h)`
  ).join('\n')

  return `你是排班修正 AI。以下排班結果有違規，請建議具體修正。

## 違規項目（${violations.length} 項）
${violationSummary}

## 目前排班
${assignmentSummary}

## 員工限制
${constraintSummary}

## 可用班別
${shiftList}

## 修正規則
- 只修正有違規的部分，不要大幅改動
- 優先修正 error，再修 warning
- 可用操作：swap（兩人換班）、reassign（改班別）、rest（改為休假）
- 休假代碼："休"
- 換班時確保雙方都合法

請用 JSON 回覆修正建議：
{
  "suggestions": [
    {
      "action": "swap|reassign|rest",
      "employee": "員工姓名",
      "date": "YYYY-MM-DD",
      "from_shift": "原班別",
      "to_shift": "新班別",
      "swap_with": "換班對象（僅 swap 時）",
      "reason": "修正原因"
    }
  ]
}
只輸出 JSON，不要加說明文字。`
}
