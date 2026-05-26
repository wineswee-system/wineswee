/**
 * Data Gathering Phase
 * Fetches all scheduling data from Supabase needed for AI or programmatic scheduling.
 */

import { supabase } from '../supabase'
import { getCrossStoreEligible } from '../scheduleUtils'

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

  // Current month for fatigue lookup
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
    { data: fatigueData },
    { data: holidayData },
    { data: timeSlotsData },
  ] = await Promise.all([
    supabase.from('schedules').select('employee, date, shift, absence_type, source_store, actual_start, actual_end, actual_hours')
      .gte('date', dateStart).lte('date', dateEnd),
    supabase.from('off_requests').select('employee, date, status')
      .gte('date', dateStart).lte('date', dateEnd)
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
    supabase.from('fatigue_scores').select('employee, total_score, month').eq('month', currentMonth),
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
    shiftDefs,
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
    fatigueScores: (fatigueData || []).map(f => ({
      employee: f.employee,
      total_score: f.total_score || 0,
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
  }
}
