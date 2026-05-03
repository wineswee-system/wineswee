import { isAbsence, splitIntoWeeks, isWeekendDay } from '../scheduleUtils'

/**
 * Analyze past 4-8 weeks of schedule data to extract per-employee and store-level insights.
 *
 * @param {Array<{ employee: string, date: string, shift: string, actual_hours: number }>} pastSchedules
 * @param {Array<{ name: string, employment_type?: string }>} employees
 * @returns {{ employeeInsights: Record<string, object>, storeInsights: object }}
 */
export function analyzeHistoricalPatterns(pastSchedules, employees) {
  if (!pastSchedules || pastSchedules.length === 0) {
    return { employeeInsights: {}, storeInsights: {} }
  }

  const byEmployee = {}
  for (const entry of pastSchedules) {
    if (!byEmployee[entry.employee]) byEmployee[entry.employee] = []
    byEmployee[entry.employee].push(entry)
  }

  const allDates = [...new Set(pastSchedules.map(s => s.date))].sort()
  const weeks = splitIntoWeeks(allDates)
  const totalWeeks = Math.max(weeks.length, 1)

  const employeeInsights = {}
  for (const emp of employees) {
    const entries = byEmployee[emp.name] || []
    const workEntries = entries.filter(e => e.shift && !isAbsence(e.shift))

    const totalHours = workEntries.reduce((sum, e) => sum + (e.actual_hours || 0), 0)
    const avgWeeklyHours = Math.round((totalHours / totalWeeks) * 10) / 10

    const dayCounts = [0, 0, 0, 0, 0, 0, 0]
    for (const e of workEntries) {
      const dow = new Date(e.date).getDay()
      dayCounts[dow]++
    }
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const preferredDays = dayNames
      .map((name, i) => ({ day: name, count: dayCounts[i] }))
      .filter(d => d.count > 0)
      .sort((a, b) => b.count - a.count)
      .map(d => d.day)

    const shiftCounts = {}
    for (const e of workEntries) {
      shiftCounts[e.shift] = (shiftCounts[e.shift] || 0) + 1
    }
    const preferredShifts = Object.entries(shiftCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([shift]) => shift)

    let weekendsWorked = 0
    for (const week of weeks) {
      const workedWeekend = week.some(date => {
        const dow = new Date(date).getDay()
        if (!isWeekendDay(dow)) return false
        return workEntries.some(e => e.date === date)
      })
      if (workedWeekend) weekendsWorked++
    }
    const weekendRate = Math.round((weekendsWorked / totalWeeks) * 100)

    const weeklyFatigue = weeks.map(week => {
      let fatigue = 0
      for (const date of week) {
        const entry = workEntries.find(e => e.date === date)
        if (!entry) continue
        const dow = new Date(date).getDay()
        const isWE = isWeekendDay(dow)
        fatigue += isWE ? 3 : 1
        fatigue += (entry.actual_hours || 0) > 8 ? 2 : 0
      }
      return fatigue
    })
    const avgFatigue = weeklyFatigue.length > 0
      ? Math.round((weeklyFatigue.reduce((s, f) => s + f, 0) / weeklyFatigue.length) * 10) / 10
      : 0

    employeeInsights[emp.name] = {
      avgWeeklyHours,
      preferredDays,
      preferredShifts,
      weekendRate,
      avgFatigue,
    }
  }

  const dayNamesStore = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

  const dailyStaffCounts = {}
  const dowTotals = [0, 0, 0, 0, 0, 0, 0]
  const dowDays = [0, 0, 0, 0, 0, 0, 0]
  for (const date of allDates) {
    const dow = new Date(date).getDay()
    const staffCount = pastSchedules.filter(s => s.date === date && s.shift && !isAbsence(s.shift)).length
    dailyStaffCounts[date] = staffCount
    dowTotals[dow] += staffCount
    dowDays[dow]++
  }
  const dowAvg = dayNamesStore.map((name, i) => ({
    day: name,
    avg: dowDays[i] > 0 ? dowTotals[i] / dowDays[i] : 0,
  }))
  const busiestDay = dowAvg.sort((a, b) => b.avg - a.avg)[0]?.day || 'unknown'

  const totalStaffDays = Object.values(dailyStaffCounts).reduce((s, c) => s + c, 0)
  const avgDailyStaff = allDates.length > 0
    ? Math.round((totalStaffDays / allDates.length) * 10) / 10
    : 0

  const hourlyPresence = {}
  for (let h = 0; h < 24; h++) hourlyPresence[h] = { total: 0, days: 0 }

  for (const date of allDates) {
    const dateEntries = pastSchedules.filter(s => s.date === date && s.shift && !isAbsence(s.shift))
    const hoursActive = new Set()
    for (const entry of dateEntries) {
      const hours = entry.actual_hours || 8
      for (let h = 9; h < 9 + Math.min(hours, 15); h++) {
        hoursActive.add(h % 24)
      }
    }
    for (const h of hoursActive) {
      hourlyPresence[h].total += dateEntries.length
      hourlyPresence[h].days++
    }
  }

  const coverageGaps = []
  for (let h = 8; h <= 23; h++) {
    const p = hourlyPresence[h]
    if (p.days > 0) {
      const avgStaff = p.total / p.days
      if (avgStaff < 1.5) {
        coverageGaps.push({
          hour: `${String(h).padStart(2, '0')}:00`,
          avgStaff: Math.round(avgStaff * 10) / 10,
        })
      }
    }
  }

  return {
    employeeInsights,
    storeInsights: { busiestDay, avgDailyStaff, coverageGaps },
  }
}
