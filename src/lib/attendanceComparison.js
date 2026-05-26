/**
 * Attendance vs Schedule Comparison
 *
 * Compares actual punch-in/out times with scheduled times
 * to detect late arrivals, early departures, and no-shows.
 *
 * Uses schedule's actual_start/actual_end (from 時段覆蓋制) first,
 * falls back to shift_definitions for named shifts, then store office hours.
 *
 * Late tolerance is read from store_settings.late_tolerance_minutes.
 */

import { supabase } from './supabase'
import { parseTime, isAbsence } from './scheduleUtils'

/**
 * Compare attendance records with scheduled shifts for a date range.
 * @param {string} dateStart - YYYY-MM-DD
 * @param {string} dateEnd - YYYY-MM-DD
 * @param {string|number} [storeNameOrId] - Optional store filter
 * @returns {Array<{
 *   employee, employee_id, date,
 *   scheduled_start, scheduled_end,
 *   clock_in, clock_out,
 *   late_minutes, early_leave_minutes,
 *   status, is_late, is_early_leave,   ← explicit boolean flags (fix #8)
 *   late_tolerance
 * }>}
 */
export async function compareAttendanceWithSchedule(dateStart, dateEnd, storeNameOrId) {
  // [Fix 2] Select employee_id for ID-based join; text employee column is legacy fallback
  let schedQ = supabase.from('schedules')
    .select('employee_id, employee, date, shift, actual_start, actual_end')
    .gte('date', dateStart).lte('date', dateEnd)

  let attQ = supabase.from('attendance_records')
    .select('employee_id, employee, date, clock_in, clock_out, status')
    .gte('date', dateStart).lte('date', dateEnd)

  // Load late tolerance + office hours + store_id from stores table
  let lateTolerance = 5  // default: 5 minutes
  let scopedStoreId = null
  let officeHoursStart = null  // "HH:MM" or null — store-level default shift start
  let officeHoursEnd   = null  // "HH:MM" or null — store-level default shift end

  if (storeNameOrId) {
    let storeQuery = supabase.from('stores')
      .select('id, late_tolerance_minutes, has_office_hours, office_hours_start, office_hours_end')
    if (typeof storeNameOrId === 'number') {
      storeQuery = storeQuery.eq('id', storeNameOrId)
    } else {
      storeQuery = storeQuery.eq('name', storeNameOrId)
    }
    const { data: store } = await storeQuery.maybeSingle()
    if (store?.late_tolerance_minutes != null) lateTolerance = store.late_tolerance_minutes
    if (store?.id != null) scopedStoreId = store.id
    if (store?.has_office_hours) {
      officeHoursStart = store.office_hours_start ? String(store.office_hours_start).slice(0, 5) : null
      officeHoursEnd   = store.office_hours_end   ? String(store.office_hours_end).slice(0, 5)   : null
    }
  }

  // [Fix 2+3] Scope both tables consistently when a store is given.
  // attendance_records has store_id; schedules does not — scope via employee IDs.
  if (scopedStoreId) {
    attQ = attQ.eq('store_id', scopedStoreId)

    const { data: storeEmps } = await supabase
      .from('employees').select('id').eq('store_id', scopedStoreId)
    const empIds = (storeEmps || []).map(e => e.id)
    if (empIds.length) schedQ = schedQ.in('employee_id', empIds)
  }

  // Scope shift_definitions to this store (fallback to global if store_id null)
  let defQ = supabase.from('shift_definitions').select('name, start_time, end_time, store_id')
  if (scopedStoreId) defQ = defQ.or(`store_id.eq.${scopedStoreId},store_id.is.null`)

  const [{ data: schedules }, { data: attendance }, { data: shiftDefs }] = await Promise.all([schedQ, attQ, defQ])

  const shiftDefMap = {}
  for (const d of (shiftDefs || [])) shiftDefMap[d.name] = d

  const results = []

  for (const sched of (schedules || [])) {
    if (isAbsence(sched.shift)) continue

    // Priority: actual_start/end from schedule (時段覆蓋制) > shift definition
    const def = shiftDefMap[sched.shift]
    const scheduledStart = sched.actual_start?.slice(0, 5) || def?.start_time?.slice(0, 5)
    const scheduledEnd   = sched.actual_end?.slice(0, 5)   || def?.end_time?.slice(0, 5)

    // Fall back to store office hours when no shift definition found
    const effectiveStart = scheduledStart || officeHoursStart
    const effectiveEnd   = scheduledEnd   || officeHoursEnd
    if (!effectiveStart || !effectiveEnd) continue

    // [Fix 2] Match by employee_id (INT FK) when available; fall back to name string
    const att = (attendance || []).find(a => {
      if (a.date !== sched.date) return false
      if (sched.employee_id && a.employee_id) return a.employee_id === sched.employee_id
      return a.employee === sched.employee  // legacy text fallback
    })

    const scheduledStartH = parseTime(effectiveStart)
    const scheduledEndH   = parseTime(effectiveEnd)
    let lateMinutes      = 0
    let earlyLeaveMinutes = 0
    let status = 'normal'

    if (!att || !att.clock_in) {
      status = 'no_show'
    } else {
      // Late check: clock_in vs effective shift start
      const clockInH = parseTime(att.clock_in)
      lateMinutes = Math.max(0, Math.round((clockInH - scheduledStartH) * 60))

      // Early leave check: clock_out vs effective shift end
      if (att.clock_out) {
        const clockOutH = parseTime(att.clock_out)
        // Handle cross-midnight
        const adjEnd      = scheduledEndH < scheduledStartH ? scheduledEndH   + 24 : scheduledEndH
        const adjClockOut = clockOutH     < scheduledStartH ? clockOutH       + 24 : clockOutH
        earlyLeaveMinutes = Math.max(0, Math.round((adjEnd - adjClockOut) * 60))
      }

      // [Fix 8] Explicit boolean flags so both conditions are always captured.
      // status keeps a single priority value (late > early_leave) for filtering/display.
      const isLate       = lateMinutes      > lateTolerance
      const isEarlyLeave = earlyLeaveMinutes > lateTolerance
      if (isLate)            status = 'late'
      else if (isEarlyLeave) status = 'early_leave'
      else                   status = 'normal'
    }

    results.push({
      employee:     sched.employee,
      employee_id:  sched.employee_id ?? null,
      date:         sched.date,
      shift:        sched.shift,
      scheduled_start:    effectiveStart,
      scheduled_end:      effectiveEnd,
      clock_in:           att?.clock_in  || null,
      clock_out:          att?.clock_out || null,
      late_minutes:       lateMinutes,
      early_leave_minutes: earlyLeaveMinutes,
      status,
      is_late:       lateMinutes      > lateTolerance,  // [Fix 8] true even when status='late'
      is_early_leave: earlyLeaveMinutes > lateTolerance, //   and independently when status='early_leave'
      late_tolerance: lateTolerance,
    })
  }

  return results
}

// summarizeComparison removed — no live callers found (Attendance.jsx filters inline).
// If a summary is needed in future, compute from the result array directly:
//   const late = results.filter(r => r.is_late).length
//   const earlyLeave = results.filter(r => r.is_early_leave).length
//   const noShow = results.filter(r => r.status === 'no_show').length
