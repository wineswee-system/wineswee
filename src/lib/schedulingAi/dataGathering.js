/**
 * Data Gathering Phase
 * Fetches all scheduling data from Supabase needed for AI or programmatic scheduling.
 */

import { supabase } from '../supabase'
import { getCrossStoreEligible, countsAsMonthlyRest } from '../scheduleUtils'

/**
 * Gather all data needed for AI scheduling.
 * Supports both weekly (weekDates) and monthly (monthDates) modes.
 */
export async function gatherSchedulingData({
  weekDates,
  monthDates,
  employees,
  shiftDefs,
  storeFilter,
  locations,
  minStaff,
  minStaffWeekend,
  tenantId,
}) {
  const dates = monthDates || weekDates
  const dateStart = dates[0]
  const dateEnd = dates[dates.length - 1]

  // Previous period dates (for continuity)
  const prevStart = new Date(new Date(dateStart).getTime() - 7 * 86400000).toISOString().slice(0, 10)
  const prevEnd = new Date(new Date(dateStart).getTime() - 1 * 86400000).toISOString().slice(0, 10)

  // Current month — for store_time_slots year_month lookup
  const currentMonth = dateStart.slice(0, 7)

  // Parallel data fetches
  const [
    { data: existingSchedules },
    { data: offRequests },
    { data: previousPeriod },
    { data: preferences },
    { data: storeSettingsData },
    { data: staffingData },
    { data: availabilityData },
    { data: holidayData },
    { data: timeSlotsData },
  ] = await Promise.all([
    supabase.from('schedules').select('employee, date, shift, absence_type, source_store, actual_start, actual_end, actual_hours')
      .gte('date', dateStart).lte('date', dateEnd),
    supabase.from('off_requests').select('employee, date, status')
      .gte('date', dateStart).lte('date', dateEnd)
      .is('deleted_at', null)
      .or('status.eq.已核准,status.is.null'),  // 待審核/已駁回 不影響排班
    supabase.from('schedules').select('employee, date, shift')
      .gte('date', prevStart).lte('date', prevEnd),
    supabase.from('employee_shift_preferences').select('employee, preferred_shifts, avoid_shifts'),
    storeFilter
      ? supabase.from('store_settings').select('*')
          .eq('store_id', locations.find(l => l.name === storeFilter)?.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    storeFilter
      ? supabase.from('store_staffing').select('*')
          .eq('store_id', locations.find(l => l.name === storeFilter)?.id)
      : Promise.resolve({ data: [] }),
    supabase.from('employee_availability').select('employee, day_of_week, start_time, end_time'),
    supabase.from('holidays').select('date').gte('date', dateStart).lte('date', dateEnd),
    storeFilter
      ? (async () => {
          const sid = locations.find(l => l.name === storeFilter)?.id
          const { data: monthData } = await supabase.from('store_time_slots').select('*').eq('store_id', sid).eq('year_month', currentMonth)
          if (monthData?.length) return { data: monthData }
          return supabase.from('store_time_slots').select('*').eq('store_id', sid).is('year_month', null)
        })()
      : Promise.resolve({ data: [] }),
  ])

  // ── 跨 cycle 月休累計：抓「本 cycle 跨到的所有 calendar month」在 cycle 範圍外的休假 ──
  // 用於：cycle B (5/29-6/25) 排班時知道 cycle A (5/1-5/28) 已給某員 X 天 5 月休，
  //       避免 cycle B 在 5/29-31 再排休造成 5 月總休 > 月目標。
  const cycleStartDate = new Date(dateStart)
  const cycleEndDate = new Date(dateEnd)
  const monthRangeStart = new Date(cycleStartDate.getFullYear(), cycleStartDate.getMonth(), 1)
    .toISOString().slice(0, 10)
  const monthRangeEnd = new Date(cycleEndDate.getFullYear(), cycleEndDate.getMonth() + 1, 0)
    .toISOString().slice(0, 10)

  const { data: monthRangeSchedules } = await supabase
    .from('schedules')
    .select('employee, date, shift, absence_type')
    .gte('date', monthRangeStart).lte('date', monthRangeEnd)

  const priorRestByMonth = {}
  for (const s of (monthRangeSchedules || [])) {
    // 排除本 cycle 範圍（會用 existingSchedules 算 in-cycle rest）
    if (s.date >= dateStart && s.date <= dateEnd) continue
    if (!s.shift || !countsAsMonthlyRest(s.shift)) continue
    const monthKey = s.date.slice(0, 7)
    if (!priorRestByMonth[s.employee]) priorRestByMonth[s.employee] = {}
    priorRestByMonth[s.employee][monthKey] = (priorRestByMonth[s.employee][monthKey] || 0) + 1
  }

  const storeSettings = {
    minStaff: minStaff || 3,
    minStaffWeekend: minStaffWeekend || minStaff || 3,
    maxStaff: storeSettingsData?.max_staff || undefined,
    operating_hours: storeSettingsData?.operating_hours || undefined,
    operatingHours: storeSettingsData?.operating_hours || undefined,
    peakDays: storeSettingsData?.peak_days || [5, 6], // Fri + Sat
    workHourSystem: storeSettingsData?.work_hour_system || undefined,
    work_hour_system: storeSettingsData?.work_hour_system || undefined,
    ft_monthly_rest_days: storeSettingsData?.ft_monthly_rest_days ?? 10,
    pt_monthly_rest_days: storeSettingsData?.pt_monthly_rest_days ?? 15,
    ft_monthly_hours_min: storeSettingsData?.ft_monthly_hours_min ?? 150,
    ft_monthly_hours_max: storeSettingsData?.ft_monthly_hours_max ?? 175,
    pt_monthly_hours_min: storeSettingsData?.pt_monthly_hours_min ?? 80,
    pt_monthly_hours_max: storeSettingsData?.pt_monthly_hours_max ?? 175,
  }

  // Cross-store eligible employees (for borrowing suggestions)
  const crossStoreEligible = storeFilter
    ? getCrossStoreEligible(employees, storeFilter, locations)
    : []

  // ── ★ 源頭過濾：把不在營業時間的 shift_definitions 直接拿掉 ──
  // 避免下游所有 fallback path 都要記得檢查營業時間。
  // 取 operating_hours 跨日 union（最早 open / 最晚 close）當合法範圍。
  const parseHM = (t) => {
    if (!t) return null
    const [h, m] = t.split(':').map(Number)
    return h + (m || 0) / 60
  }
  const ohRange = (() => {
    const oh = storeSettingsData?.operating_hours || {}
    let earliestOpen = null, latestCloseEff = null
    for (const k of Object.keys(oh)) {
      const d = oh[k]
      const op = parseHM(d?.open)
      const cl = parseHM(d?.close)
      if (op == null || cl == null) continue
      const clEff = cl <= op ? cl + 24 : cl
      if (earliestOpen == null || op < earliestOpen) earliestOpen = op
      if (latestCloseEff == null || clEff > latestCloseEff) latestCloseEff = clEff
    }
    return earliestOpen != null && latestCloseEff != null
      ? { open: earliestOpen, closeEff: latestCloseEff }
      : null
  })()
  const filteredShiftDefs = ohRange
    ? shiftDefs.filter(s => {
        const sh = parseHM(s.start_time)
        const eh = parseHM(s.end_time)
        if (sh == null || eh == null) return true  // 沒設時間 → 不擋
        const ehEff = eh <= sh ? eh + 24 : eh
        const inRange = sh >= ohRange.open - 0.01 && ehEff <= ohRange.closeEff + 0.01
        if (!inRange) {
          console.warn(`[gatherSchedulingData] 過濾掉非營業時間 shift: ${s.name} ${s.start_time}-${s.end_time} (營業 ${ohRange.open}-${ohRange.closeEff})`)
        }
        return inRange
      })
    : shiftDefs

  return {
    employees: employees.map(e => ({
      id: e.id,
      name: e.name,
      dept: e.dept,
      position: e.position,
      store: e.store,
      employment_type: e.employment_type || 'full_time',
      schedule_priority: e.schedule_priority || 3,
      can_open: e.can_open,       // null=未設定(不限制), true=可開店, false=不可開店
      can_close: e.can_close,     // null=未設定(不限制), true=可關店, false=不可關店
      additional_stores: e.additional_stores || [],
      gender: e.gender,
      is_pregnant: e.is_pregnant,
      is_nursing: e.is_nursing,
      skills: e.skills || [],
      weekly_target_hours: e.weekly_target_hours || null,
      join_date: e.join_date || null,       // 入職前的日子不排班
      resign_date: e.resign_date || null,   // 離職後的日子不排班
    })),
    shiftDefs: filteredShiftDefs,
    weekDates: weekDates || dates,
    monthDates: monthDates || null,
    existingSchedules: existingSchedules || [],
    offRequests: (offRequests || []).map(o => ({ employee: o.employee, date: o.date })),
    preferences: (preferences || []).map(p => ({
      employee: p.employee,
      preferred_shifts: p.preferred_shifts || [],
      avoid_shifts: p.avoid_shifts || [],
    })),
    previousWeek: previousPeriod || [],
    storeSettings,
    staffingRules: staffingData || [],
    availability: (availabilityData || []).map(a => ({
      employee: a.employee,
      day_of_week: a.day_of_week,
      start_time: a.start_time,
      end_time: a.end_time,
    })),
    holidays: (holidayData || []).map(h => h.date),
    timeSlots: (timeSlotsData || []).map(s => ({
      day_type: s.day_type,
      start_time: s.start_time,
      end_time: s.end_time,
      required_count: s.required_count,
      max_count: s.max_count || null,
    })),
    crossStoreEligible,
    locations,
    tenantId,
    priorRestByMonth,  // ★ 跨 cycle 月休累計（cycle 外、同 calendar month 的休假）
  }
}
