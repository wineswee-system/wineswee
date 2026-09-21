import { supabase } from '../supabase'

export const getScheduleData = (options = {}) => {
  let q = supabase.from('schedule_data').select('*').order('id')
  if (options.orgId) q = q.eq('organization_id', options.orgId)
  return q.limit(options.limit ?? 500)
}

export const updateSchedule = (id, data, orgId) => {
  let q = supabase.from('schedule_data').update(data).eq('id', id)
  if (orgId) q = q.eq('organization_id', orgId)
  return q.select().single()
}

export const getHolidays = (options = {}) => {
  let q = supabase.from('holidays').select('*').order('date')
  return q.limit(options.limit ?? 500)
}

export const createHoliday = (data) =>
  supabase.from('holidays').insert(data).select().single()

export const deleteHoliday = (id) =>
  supabase.from('holidays').delete().eq('id', id)

export const refreshHolidays = async (years) => {
  const { data, error } = await supabase.functions.invoke('refresh-holidays', {
    body: years ? { years } : {},
  })
  if (error) throw error
  return data
}

export const getSchedulingRules = (year) =>
  supabase
    .from('scheduling_rules_snapshot')
    .select('*')
    .eq('effective_year', year || new Date().getFullYear())
    .order('category')
