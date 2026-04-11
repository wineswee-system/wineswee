/**
 * Attendance vs Schedule Comparison
 *
 * Compares actual punch-in/out times with scheduled times
 * to detect late arrivals, early departures, and no-shows.
 */

import { supabase } from './supabase'
import { parseTime, isAbsence } from './scheduleUtils'

/**
 * Compare attendance records with scheduled shifts for a date range.
 * @param {string} dateStart - YYYY-MM-DD
 * @param {string} dateEnd - YYYY-MM-DD
 * @param {string} [storeName] - Optional store filter
 * @returns {Array<{ employee, date, scheduled_start, scheduled_end, clock_in, clock_out, late_minutes, early_leave_minutes, status }>}
 */
export async function compareAttendanceWithSchedule(dateStart, dateEnd, storeName) {
  const [
    { data: schedules },
    { data: attendance },
    { data: shiftDefs },
  ] = await Promise.all([
    supabase.from('schedules').select('employee, date, shift, actual_start, actual_end')
      .gte('date', dateStart).lte('date', dateEnd),
    supabase.from('attendance_records').select('employee_name, date, clock_in, clock_out, status')
      .gte('date', dateStart).lte('date', dateEnd),
    supabase.from('shift_definitions').select('name, start_time, end_time'),
  ])

  const shiftDefMap = {}
  for (const d of (shiftDefs || [])) shiftDefMap[d.name] = d

  const results = []

  for (const sched of (schedules || [])) {
    if (isAbsence(sched.shift)) continue

    const def = shiftDefMap[sched.shift]
    const scheduledStart = sched.actual_start?.slice(0, 5) || def?.start_time?.slice(0, 5)
    const scheduledEnd = sched.actual_end?.slice(0, 5) || def?.end_time?.slice(0, 5)

    if (!scheduledStart || !scheduledEnd) continue

    // Find matching attendance record
    const att = (attendance || []).find(a => a.employee_name === sched.employee && a.date === sched.date)

    const scheduledStartH = parseTime(scheduledStart)
    let lateMinutes = 0
    let earlyLeaveMinutes = 0
    let status = 'normal'

    if (!att || !att.clock_in) {
      status = 'no_show'
    } else {
      const clockInH = parseTime(att.clock_in)
      lateMinutes = Math.max(0, Math.round((clockInH - scheduledStartH) * 60))

      if (att.clock_out && scheduledEnd) {
        const scheduledEndH = parseTime(scheduledEnd)
        const clockOutH = parseTime(att.clock_out)
        // Handle cross-midnight
        const effectiveEnd = scheduledEndH < scheduledStartH ? scheduledEndH + 24 : scheduledEndH
        const effectiveClockOut = clockOutH < scheduledStartH ? clockOutH + 24 : clockOutH
        earlyLeaveMinutes = Math.max(0, Math.round((effectiveEnd - effectiveClockOut) * 60))
      }

      if (lateMinutes > 5) status = 'late'
      else if (earlyLeaveMinutes > 5) status = 'early_leave'
      else status = 'normal'
    }

    results.push({
      employee: sched.employee,
      date: sched.date,
      shift: sched.shift,
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      clock_in: att?.clock_in || null,
      clock_out: att?.clock_out || null,
      late_minutes: lateMinutes,
      early_leave_minutes: earlyLeaveMinutes,
      status,
    })
  }

  return results
}

/**
 * Get summary stats for attendance comparison.
 */
export function summarizeComparison(results) {
  const total = results.length
  const normal = results.filter(r => r.status === 'normal').length
  const late = results.filter(r => r.status === 'late').length
  const earlyLeave = results.filter(r => r.status === 'early_leave').length
  const noShow = results.filter(r => r.status === 'no_show').length

  const byEmployee = {}
  for (const r of results) {
    if (!byEmployee[r.employee]) byEmployee[r.employee] = { late: 0, earlyLeave: 0, noShow: 0, totalLateMinutes: 0 }
    if (r.status === 'late') { byEmployee[r.employee].late++; byEmployee[r.employee].totalLateMinutes += r.late_minutes }
    if (r.status === 'early_leave') byEmployee[r.employee].earlyLeave++
    if (r.status === 'no_show') byEmployee[r.employee].noShow++
  }

  return { total, normal, late, earlyLeave, noShow, byEmployee }
}
