import { supabase } from '../supabase'

export const getOrganizations = () =>
  supabase.from('organizations').select('*').order('id')

export const createOrganization = (data) =>
  supabase.from('organizations').insert(data).select().single()

export const updateOrganization = (id, data) =>
  supabase.from('organizations').update(data).eq('id', id).select().single()

export const deleteOrganization = (id) =>
  supabase.from('organizations').delete().eq('id', id)

// Legacy tenant aliases — callers must check isSuperAdmin before invoking; relies on RLS for DB enforcement
export const getTenants = () =>
  supabase.from('organizations').select('*').order('id')

export const createTenantRecord = (data) =>
  supabase.from('organizations').insert(data).select().single()

export const updateTenantRecord = (id, data) =>
  supabase.from('organizations').update(data).eq('id', id).select().single()

export const deleteTenantRecord = (id) =>
  supabase.from('organizations').delete().eq('id', id)

export const getCompanies = () =>
  supabase.from('companies').select('*').order('id')

export const createCompany = (data) =>
  supabase.from('companies').insert(data).select().single()

export const updateCompany = (id, data) =>
  supabase.from('companies').update(data).eq('id', id).select().single()

export const deleteCompany = (id) =>
  supabase.from('companies').delete().eq('id', id)

export const getStores = (orgId) => {
  let q = supabase.from('stores').select('*').order('id')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getStoresWithRefs = (orgId) => {
  let q = supabase.from('stores').select('*, company_ref:companies!company_id(id,name), manager_ref:employees!manager_id(id,name)').order('id')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createStore = (data) =>
  supabase.from('stores').insert(data).select().single()

export const updateStore = (id, data) =>
  supabase.from('stores').update(data).eq('id', id).select().single()

export const deleteStore = (id) =>
  supabase.from('stores').delete().eq('id', id)

export const getDepartments = (orgId) => {
  let q = supabase.from('departments').select('*').order('id')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getDepartmentsWithRefs = () =>
  supabase.from('departments').select('*, manager_ref:employees!manager_id(id,name), parent:departments!parent_department_id(id,name)').order('id')

export const createDepartment = (data) =>
  supabase.from('departments').insert(data).select().single()

export const updateDepartment = (id, data) =>
  supabase.from('departments').update(data).eq('id', id).select().single()

export const deleteDepartment = (id) =>
  supabase.from('departments').delete().eq('id', id)

// ── Department Sections（部門下的「課」）────────────────────
export const getDepartmentSections = (orgId) => {
  let q = supabase.from('department_sections').select('*').eq('is_active', true).order('sort_order')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getDepartmentSectionsAll = (orgId) => {
  // 含 inactive，給管理頁用
  let q = supabase.from('department_sections').select('*').order('department_id').order('sort_order')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createDepartmentSection = (data) =>
  supabase.from('department_sections').insert(data).select().single()

export const updateDepartmentSection = (id, data) =>
  supabase.from('department_sections').update(data).eq('id', id).select().single()

export const deleteDepartmentSection = (id) =>
  supabase.from('department_sections').delete().eq('id', id)

export const getDeptManagerHistory = (deptId) =>
  supabase.from('department_manager_history').select('*').eq('department_id', deptId).order('effective_date', { ascending: false })

export const getRoles = (orgId) => {
  let q = supabase.from('roles').select('*').order('level', { ascending: false })
  if (orgId) q = q.or(`organization_id.eq.${orgId},is_system.eq.true`)
  return q
}

export const getPermissions = () =>
  supabase.from('permissions').select('*').order('module').order('code')

export const getRolePermissions = (roleId) =>
  supabase.from('role_permissions').select('*, permissions(code, name, module)').eq('role_id', roleId)

export const setRolePermissions = (roleId, permissionIds) =>
  supabase.rpc('replace_role_permissions', {
    p_role_id: roleId,
    p_permission_ids: permissionIds?.length ? permissionIds : [],
  })

export const getEmployeePermissions = async (employeeId) => {
  const { data } = await supabase
    .from('employees')
    .select('roles(role_permissions(permissions(code)))')
    .eq('id', employeeId)
    .single()
  return (data?.roles?.role_permissions || []).map(p => p.permissions?.code).filter(Boolean)
}

export const getLineGroups = () =>
  supabase.from('line_groups').select('*').order('id')

export const getLineMessages = (filters = {}) => {
  let q = supabase.from('line_messages').select('*').order('created_at', { ascending: false }).limit(100)
  if (filters.line_user_id) q = q.eq('line_user_id', filters.line_user_id)
  if (filters.group_id) q = q.eq('group_id', filters.group_id)
  return q
}

export const getOrgSubscription = (orgId) =>
  supabase.from('org_subscriptions').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle()

export const getOrgPayments = (orgId) =>
  supabase.from('org_payments').select('*').eq('organization_id', orgId).order('created_at', { ascending: false })
