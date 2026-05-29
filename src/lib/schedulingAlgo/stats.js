import { getShiftHours, isAbsence, parseTime, isWeekendDay } from '../scheduleUtils'

export function computeStats(assignments, employees, shiftDefs, _dates, _holidays, targetHoursMap) {
  const shiftDefMap = {}
  for (const d of shiftDefs) shiftDefMap[d.name] = d

  const byEmployee = {}
  for (const emp of employees) {
    const empA = assignments.filter(a => a.employee === emp.name)
    const work = empA.filter(a => !isAbsence(a.shift))
    const rest = empA.filter(a => isAbsence(a.shift))

    let totalHours = 0
    let weekendShifts = 0
    let eveningShifts = 0

    for (const a of work) {
      const def = shiftDefMap[a.shift]
      if (def) {
        totalHours += getShiftHours(def) - (def.break_minutes || 60) / 60
        const dow = new Date(a.date).getDay()
        if (isWeekendDay(dow)) weekendShifts++
        if (parseTime(def.start_time) >= 15) eveningShifts++
      }
    }

    const target = targetHoursMap[emp.name] || 40
    byEmployee[emp.name] = {
      totalHours: Math.round(totalHours * 10) / 10,
      targetHours: target,
      hoursRatio: Math.round((totalHours / target) * 100),
      workDays: work.length,
      restDays: rest.length,
      weekendShifts,
      eveningShifts,
    }
  }

  return { byEmployee }
}

export function buildReasoning(employees, dates, stats) {
  const lines = [`程式排班 v2：${employees.length} 位員工 × ${dates.length} 天`]

  if (stats?.byEmployee) {
    const entries = Object.entries(stats.byEmployee)
    const overTarget = entries.filter(([, s]) => s.hoursRatio > 110).length
    const underTarget = entries.filter(([, s]) => s.hoursRatio < 80).length
    if (overTarget > 0) lines.push(`${overTarget} 人超過目標工時 110%`)
    if (underTarget > 0) lines.push(`${underTarget} 人低於目標工時 80%`)
  }

  return lines.join('。')
}
