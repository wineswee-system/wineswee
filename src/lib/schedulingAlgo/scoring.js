import { parseTime, isWeekendDay } from '../scheduleUtils'

export const FATIGUE_POINTS = {
  weekday_morning: 1,
  weekday_evening: 2,
  weekend_morning: 2,
  weekend_evening: 3,
  holiday: 4,
}

export function classifyShiftFatigue(shiftDef, dateStr, holidays = []) {
  if (holidays.includes(dateStr)) return 'holiday'
  const dow = new Date(dateStr).getDay()
  const isWeekend = isWeekendDay(dow)
  const startH = parseTime(shiftDef.start_time)
  const isMorning = startH < 15
  if (isWeekend) return isMorning ? 'weekend_morning' : 'weekend_evening'
  return isMorning ? 'weekday_morning' : 'weekday_evening'
}

export function getFatiguePoints(shiftDef, dateStr, holidays = []) {
  const type = classifyShiftFatigue(shiftDef, dateStr, holidays)
  return FATIGUE_POINTS[type] || 1
}
