/**
 * Fatigue Score Engine
 *
 * Calculates and persists monthly fatigue scores from schedule history.
 * Used by the scheduling algorithm to ensure fair shift distribution.
 *
 * Scoring:
 *   平日早班: +1  |  平日晚班: +2
 *   假日早班: +2  |  假日晚班: +3
 *   國定假日: +4
 */

import { supabase } from './supabase'
import { parseTime, isWeekendDay, isAbsence } from './scheduleUtils'

const FATIGUE_POINTS = {
  weekday_morning: 1,
  weekday_evening: 2,
  weekend_morning: 2,
  weekend_evening: 3,
  holiday: 4,
}

function classifyShift(shiftDef, dateStr, holidays = []) {
  if (holidays.includes(dateStr)) return 'holiday'
  const dow = new Date(dateStr).getDay()
  const isWeekend = isWeekendDay(dow)
  const startH = parseTime(shiftDef?.start_time)
  const isMorning = startH < 15
  if (isWeekend) return isMorning ? 'weekend_morning' : 'weekend_evening'
  return isMorning ? 'weekday_morning' : 'weekday_evening'
}

/**
 * Calculate fatigue scores for a given month from schedule data.
 * @param {string} month - Format "YYYY-MM"
 * @returns {Object} { byEmployee: { name: { breakdown, total } } }
 */
export async function calculateMonthlyFatigue(month) {
  const [year, mon] = month.split('-').map(Number)
  const daysInMonth = new Date(year, mon, 0).getDate()
  const dateStart = `${month}-01`
  const dateEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`

  const [
    { data: schedules },
    { data: shiftDefs },
    { data: holidays },
  ] = await Promise.all([
    supabase.from('schedules').select('employee, date, shift')
      .gte('date', dateStart).lte('date', dateEnd),
    supabase.from('shift_definitions').select('name, start_time, end_time'),
    supabase.from('holidays').select('date')
      .gte('date', dateStart).lte('date', dateEnd),
  ])

  const holidayDates = (holidays || []).map(h => h.date)
  const shiftDefMap = {}
  for (const d of (shiftDefs || [])) shiftDefMap[d.name] = d

  const byEmployee = {}

  for (const s of (schedules || [])) {
    if (isAbsence(s.shift)) continue
    const def = shiftDefMap[s.shift]
    if (!def) continue

    if (!byEmployee[s.employee]) {
      byEmployee[s.employee] = {
        weekday_morning: 0,
        weekday_evening: 0,
        weekend_morning: 0,
        weekend_evening: 0,
        holiday_count: 0,
        total_score: 0,
      }
    }

    const type = classifyShift(def, s.date, holidayDates)
    const points = FATIGUE_POINTS[type] || 1

    if (type === 'holiday') {
      byEmployee[s.employee].holiday_count++
    } else {
      byEmployee[s.employee][type]++
    }
    byEmployee[s.employee].total_score += points
  }

  return { month, byEmployee }
}

/**
 * Calculate and persist fatigue scores to the database.
 * @param {string} month - Format "YYYY-MM"
 */
export async function persistFatigueScores(month) {
  const { byEmployee } = await calculateMonthlyFatigue(month)

  const records = Object.entries(byEmployee).map(([employee, scores]) => ({
    employee,
    month,
    ...scores,
  }))

  if (records.length === 0) return { success: true, count: 0 }

  const { error } = await supabase.from('fatigue_scores')
    .upsert(records, { onConflict: 'employee,month' })

  return { success: !error, count: records.length, error: error?.message }
}
