import { supabase } from './supabase'

// ── employee_assignments helpers ──────────────────────────────
// 主要 = primary (only one active at a time per employee)
// 次要 = secondary (any number concurrent)

const today = () => new Date().toISOString().slice(0, 10)

export const listAssignments = (employeeId) =>
  supabase
    .from('employee_assignments')
    .select('*, departments(name), stores(name), updated_by_emp:updated_by(name)')
    .eq('employee_id', employeeId)
    .order('start_date', { ascending: false })

export const getActivePrimary = async (employeeId) => {
  const { data } = await supabase
    .from('employee_assignments')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('department_type', '主要')
    .eq('is_active', true)
    .maybeSingle()
  return data || null
}

// Close any active 主要 row (end_date + is_active=false). Safe no-op if none.
export const closeActivePrimary = async (employeeId, endDate = today(), updatedBy = null) => {
  const { error } = await supabase
    .from('employee_assignments')
    .update({ end_date: endDate, is_active: false, updated_by: updatedBy })
    .eq('employee_id', employeeId)
    .eq('department_type', '主要')
    .eq('is_active', true)
  return { error }
}

// Insert a new assignment row. Caller must ensure 主要 uniqueness (close previous first).
export const createAssignment = (payload) =>
  supabase
    .from('employee_assignments')
    .insert({
      department_type: '主要',
      is_part_time: false,
      avg_weekly_hours: 0,
      start_date: today(),
      ...payload,
    })
    .select()
    .single()

export const updateAssignment = (id, patch) =>
  supabase.from('employee_assignments').update(patch).eq('id', id).select().single()

export const deleteAssignment = (id) =>
  supabase.from('employee_assignments').delete().eq('id', id)

// Replace the active 主要 with a new one when dept/store/position/employment_type changes.
// Returns the new assignment row or null if nothing changed.
export const rotatePrimary = async (employeeId, next, updatedBy = null) => {
  const cur = await getActivePrimary(employeeId)
  const same =
    cur &&
    cur.department_id === (next.department_id ?? null) &&
    cur.store_id === (next.store_id ?? null) &&
    cur.position === (next.position ?? null) &&
    cur.employment_type === (next.employment_type ?? null) &&
    cur.job_grade === (next.job_grade ?? null)
  if (same) return { data: null, error: null, changed: false }

  const rotateDate = next.start_date || today()
  if (cur) {
    const closeDate = new Date(rotateDate)
    closeDate.setDate(closeDate.getDate() - 1)
    const closeStr = closeDate.toISOString().slice(0, 10)
    await supabase
      .from('employee_assignments')
      .update({
        end_date: closeStr < cur.start_date ? cur.start_date : closeStr,
        is_active: false,
        updated_by: updatedBy,
      })
      .eq('id', cur.id)
  }

  const { data, error } = await createAssignment({
    employee_id: employeeId,
    department_type: '主要',
    start_date: rotateDate,
    is_active: true,
    updated_by: updatedBy,
    ...next,
  })
  return { data, error, changed: true }
}
