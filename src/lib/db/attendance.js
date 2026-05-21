import { supabase } from '../supabase'

export const getAttendance = (date, options = {}) => {
  const cols = options.columns || '*'
  let q = supabase.from('attendance_records').select(cols).order('date', { ascending: false })
  if (date) q = q.eq('date', date)
  if (options.orgId) q = q.eq('organization_id', options.orgId)
  if (options.from) q = q.gte('date', options.from)
  if (options.limit) q = q.limit(options.limit)
  return q
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
  let q = supabase.from('overtime_requests').select('*').is('deleted_at', null).order('id')
  if (options.orgId) q = q.eq('organization_id', options.orgId)
  return q.limit(options.limit ?? 500)
}

export const createOvertimeRequest = (data) =>
  supabase.from('overtime_requests').insert(data).select().single()

export const updateOvertimeStatus = (id, status, rejectReason) =>
  supabase.rpc('secure_update_overtime_status', {
    p_id: id,
    p_status: status,
    p_reject_reason: rejectReason || null,
  })
