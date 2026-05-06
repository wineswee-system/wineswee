import { supabase } from '../supabase'
import { dedup } from './utils'

export const getEmployees = (orgId) => {
  let q = supabase.from('employees').select('*, departments!department_id(name), stores!store_id(name)').order('id')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createEmployee = (data) =>
  supabase.from('employees').insert(data).select().single()

export const updateEmployee = async (id, data) => {
  // Bypasses RLS via SECURITY DEFINER RPC — super_admin can't update via direct table
  const { data: result, error } = await supabase.rpc('secure_update_employee', { p_id: id, p_data: data })
  if (error) return { data: null, error }
  if (!result?.ok) return { data: null, error: { message: result?.error || 'UPDATE_FAILED', details: JSON.stringify(result) } }
  return { data: result.employee, error: null }
}

export const deleteEmployee = (id) =>
  supabase.from('employees').delete().eq('id', id)

export const inviteEmployee = (email, name) =>
  supabase.functions.invoke('invite-employee', { body: { email, name } })

export const getActiveEmployees = (select = 'id, name, department_id, store_id, departments(name), stores(name)', orgId) => {
  const key = orgId ? `activeEmployees:${select}:${orgId}` : `activeEmployees:${select}`
  return dedup(key, () => {
    let q = supabase.from('employees').select(select).eq('status', '在職').order('name')
    if (orgId) q = q.eq('organization_id', orgId)
    return q
  })
}
