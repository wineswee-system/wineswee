import { supabase } from '../supabase'

export const getTriggers = () =>
  supabase.from('triggers').select('*').order('id')

export const updateTrigger = (id, data) =>
  supabase.from('triggers').update(data).eq('id', id).select().single()

export const getNotifications = (userId) => {
  const q = supabase.from('notifications').select('*').order('created_at', { ascending: false })
  return userId ? q.eq('user_id', userId) : q
}

export const markNotificationRead = (id) =>
  supabase.from('notifications').update({ read: true }).eq('id', id)

export const markAllNotificationsRead = () =>
  supabase.from('notifications').update({ read: true }).eq('read', false)

export const getAuditLogs = (orgId) => {
  let q = supabase.from('audit_logs').select('*').order('time', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createAuditLog = (data) =>
  supabase.from('audit_logs').insert(data)

export const getKpiData = () =>
  supabase.from('kpi_data').select('*').order('id')

export const getSystemLogs = ({ limit = 200, offset = 0, tenantId, orgId, level, module, action, from, to } = {}) => {
  let q = supabase.from('system_logs').select('*, organizations(name)', { count: 'exact' })
  const scopeId = orgId ?? tenantId
  if (scopeId) q = q.eq('organization_id', scopeId)
  if (level) q = q.eq('level', level)
  if (module) q = q.eq('module', module)
  if (action) q = q.eq('action', action)
  if (from) q = q.gte('created_at', from)
  if (to) q = q.lte('created_at', to)
  return q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
}

export const getErrorLogs = ({ limit = 200, offset = 0, tenantId, orgId, level, module, resolved, from, to } = {}) => {
  let q = supabase.from('error_logs').select('*, organizations(name)', { count: 'exact' })
  const scopeId = orgId ?? tenantId
  if (scopeId) q = q.eq('organization_id', scopeId)
  if (level) q = q.eq('level', level)
  if (module) q = q.eq('module', module)
  if (resolved !== undefined) q = q.eq('resolved', resolved)
  if (from) q = q.gte('created_at', from)
  if (to) q = q.lte('created_at', to)
  return q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
}

export const resolveErrorLog = (id, resolvedBy) =>
  supabase.from('error_logs').update({ resolved: true, resolved_by: resolvedBy, resolved_at: new Date().toISOString() }).eq('id', id).select().single()

export const unresolveErrorLog = (id) =>
  supabase.from('error_logs').update({ resolved: false, resolved_by: null, resolved_at: null }).eq('id', id).select().single()

export const deleteErrorLog = (id) =>
  supabase.from('error_logs').delete().eq('id', id)

export const getUserActivity = ({ limit = 200, offset = 0, tenantId, orgId, userName, action, module, from, to } = {}) => {
  let q = supabase.from('user_activity').select('*, organizations(name)', { count: 'exact' })
  const scopeId = orgId ?? tenantId
  if (scopeId) q = q.eq('organization_id', scopeId)
  if (userName) q = q.eq('user_name', userName)
  if (action) q = q.eq('action', action)
  if (module) q = q.eq('module', module)
  if (from) q = q.gte('created_at', from)
  if (to) q = q.lte('created_at', to)
  return q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
}

export const drainEntity = ({ entityType, entityId, entityName, payload, relatedData, deletedBy, organizationId }) =>
  supabase.from('deletion_drain').insert({
    entity_type:     entityType,
    entity_id:       entityId,
    entity_name:     entityName,
    payload,
    related_data:    relatedData || null,
    deleted_by:      deletedBy,
    organization_id: organizationId || null,
  }).select().single()

export const getDeletionDrain = (orgId) => {
  let q = supabase.from('deletion_drain').select('*').order('deleted_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

// Super admin cross-org operations
export const getAllEmployees = () =>
  supabase.from('employees').select('*, organizations(name)').order('id')

export const updateEmployeeRole = (id, data) =>
  supabase.from('employees').update(data).eq('id', id).select().single()

export const getTenantModuleConfig = (orgId) =>
  supabase.from('organizations').select('id, name, features, plan, status, max_users').eq('id', orgId).single()

export const updateTenantModules = (id, features) =>
  supabase.from('organizations').update({ features }).eq('id', id).select().single()

export const getTenantEmployees = (orgId) =>
  supabase.from('employees').select('*').eq('organization_id', orgId).order('id')

export const updateRolePermissions = async (roleId, permissionIds) => {
  await supabase.from('role_permissions').delete().eq('role_id', roleId)
  if (!permissionIds?.length) return
  const rows = permissionIds.map(pid => ({ role_id: roleId, permission_id: pid }))
  return supabase.from('role_permissions').insert(rows)
}

// Bulk imports
export const bulkUpsertSKUs = (rows) =>
  supabase.from('skus').upsert(rows, { onConflict: 'code' }).select()

export const bulkUpsertCustomers = (rows) =>
  supabase.from('customers').upsert(rows, { onConflict: 'code' }).select()

export const bulkUpsertSuppliers = (rows) =>
  supabase.from('suppliers').upsert(rows, { onConflict: 'code' }).select()

export const bulkInsertPOSTransactions = (rows) =>
  supabase.from('pos_transactions').insert(rows).select()

export const bulkUpsertStockLevels = (rows) =>
  supabase.rpc('secure_bulk_upsert_stock_levels', { p_rows: rows })

export const bulkInsertJournalEntries = (rows) =>
  supabase.rpc('secure_bulk_insert_journal_entries', { p_rows: rows })
