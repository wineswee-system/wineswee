import { supabase } from '../supabase'

export const getAttendance = (date, options = {}) => {
  const cols = options.columns || '*'
  let q = supabase.from('attendance_records').select(cols).order('date', { ascending: false })
  if (date) q = q.eq('date', date)
  if (options.orgId) q = q.eq('organization_id', options.orgId)
  if (options.from) q = q.gte('date', options.from)
  if (options.to)   q = q.lte('date', options.to)
  if (options.month && /^\d{4}-\d{2}$/.test(options.month)) {
    const [y, m] = options.month.split('-').map(Number)
    const start = `${options.month}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const end = `${options.month}-${String(lastDay).padStart(2, '0')}`
    q = q.gte('date', start).lte('date', end)
  }
  // 月份既然限制了範圍就不再上 cap；給個大數蓋掉 Supabase server-side db.max_rows 預設
  return q.limit(options.limit ?? 50000)
}

export const upsertAttendance = (data) =>
  supabase.from('attendance_records').upsert(data).select().single()

export async function serverClockIn(payload) {
  const { data, error } = await supabase.functions.invoke('clock-in', { body: payload })
  if (error) {
    const msg = data?.reasons ? `${data.error}\n${data.reasons.join('\n')}` : (error.message || '伺服器錯誤')
    const err = new Error(msg)
    err.code = error.context?.status === 403 ? 'VALIDATION_FAILED' : 'SERVER_ERROR'
    throw err
  }
  return data
}

export async function checkMissedClockout(date) {
  const { data } = await supabase.functions.invoke('check-missed-clockout', {
    body: date ? { date } : {},
  })
  return data
}

export const getLeaveRequests = (options = {}) => {
  let q = supabase.from('leave_requests').select('*').is('deleted_at', null).order('id')
  if (options.orgId) q = q.eq('organization_id', options.orgId)
  if (options.month) {  // 'YYYY-MM' → 只撈 start_date 落在當月的(進場降載量)
    const [y, m] = options.month.split('-').map(Number)
    const start = `${options.month}-01`
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)  // 當月最後一天
    q = q.gte('start_date', start).lte('start_date', end)
  }
  return q.limit(options.limit ?? 500)
}

export const createLeaveRequest = (data) =>
  supabase.from('leave_requests').insert(data).select().single()

export const updateLeaveStatus = (id, status, approver, rejectReason) =>
  supabase.rpc('secure_update_leave_status', {
    p_id: id,
    p_status: status,
    p_approver: approver,
    p_reject_reason: rejectReason || null,
  })

export const deleteLeaveRequest = (id, deletedBy) =>
  supabase.rpc('soft_delete_request', { p_table: 'leave_requests', p_id: id, p_deleted_by: deletedBy ?? null })

export const getOvertimeRequests = (options = {}) => {
  // 預設新的在上、limit 2000（治標）；options.month 給的話再加範圍篩選（治本）
  let q = supabase.from('overtime_requests').select('*').is('deleted_at', null)
                  .order('id', { ascending: false })
  if (options.orgId) q = q.eq('organization_id', options.orgId)
  if (options.month && /^\d{4}-\d{2}$/.test(options.month)) {
    const [y, m] = options.month.split('-').map(Number)
    const start = `${options.month}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const end = `${options.month}-${String(lastDay).padStart(2, '0')}`
    // date 跟 request_date 任一落在區間都算（schema drift 相容）
    q = q.or(
      `and(date.gte.${start},date.lte.${end}),and(request_date.gte.${start},request_date.lte.${end})`
    )
  }
  return q.limit(options.limit ?? 2000)
}

export const createOvertimeRequest = (data) =>
  supabase.from('overtime_requests').insert(data).select().single()

export const updateOvertimeStatus = (id, status, rejectReason) =>
  supabase.rpc('secure_update_overtime_status', {
    p_id: id,
    p_status: status,
    p_reject_reason: rejectReason || null,
  })

// Get an employee's scheduled shift for a given date (used by POS shift open)
export async function getEmployeeShiftForDate(employeeName, date) {
  const { data: schedule } = await supabase
    .from('schedules')
    .select('id, employee, date, shift')
    .eq('employee', employeeName)
    .eq('date', date)
    .maybeSingle()
  if (!schedule) return null
  const { data: def } = await supabase
    .from('shift_definitions')
    .select('id, name, start_time, end_time, break_minutes, color')
    .eq('name', schedule.shift)
    .maybeSingle()
  return { ...schedule, definition: def }
}

// Get all active employees for POS shift picker dropdown
export function getEmployeesActive(orgId) {
  let q = supabase
    .from('employees')
    .select('id, name, department, position')
    .order('name')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}
