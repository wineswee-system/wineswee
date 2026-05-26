import { supabase } from '../supabase'

export const getTriggers = () =>
  supabase.from('triggers').select('*').order('id')

export const updateTrigger = (id, data) =>
  supabase.from('triggers').update(data).eq('id', id).select().single()

export const getNotifications = (userId, empId) => {
  const q = supabase.from('notifications').select('*').order('created_at', { ascending: false })
  if (userId && empId) return q.or(`user_id.eq.${userId},recipient_emp_id.eq.${empId}`)
  if (userId) return q.eq('user_id', userId)
  if (empId) return q.eq('recipient_emp_id', empId)
  return q
}

export const markNotificationRead = (id) =>
  supabase.from('notifications').update({ read: true }).eq('id', id)

export const markAllNotificationsRead = (userId, empId) => {
  if (!userId && !empId) return Promise.resolve({ data: null, error: { message: 'userId or empId required' } })
  const q = supabase.from('notifications').update({ read: true }).eq('read', false)
  if (userId && empId) return q.or(`user_id.eq.${userId},recipient_emp_id.eq.${empId}`)
  if (userId) return q.eq('user_id', userId)
  return q.eq('recipient_emp_id', empId)
}

export const getAuditLogs = ({ limit = 100, offset = 0, orgId, userName, action, tables, targetId, from, to, search } = {}) => {
  if (!orgId) return Promise.resolve({ data: [], count: 0, error: null })
  let q = supabase.from('audit_logs').select('*', { count: 'exact' }).order('time', { ascending: false })
  q = q.eq('organization_id', orgId)
  if (userName) q = q.eq('user', userName)
  if (action) q = q.eq('action', action)
  if (tables?.length) q = q.in('target_table', tables)
  if (targetId != null) q = q.eq('target_id', targetId)
  if (from) q = q.gte('time', from)
  if (to) q = q.lte('time', to)
  if (search) {
    const s = search.replace(/[^\w\s\-一-鿿]/g, '').replace(/_/g, '\\_').trim()
    if (s) q = q.or(`action.ilike.%${s}%,target.ilike.%${s}%`)
  }
  return q.range(offset, offset + limit - 1)
}

export const getAuditLogsAll = ({ limit = 100, offset = 0, orgId, userName, action, tables, targetId, from, to, search } = {}) => {
  let q = supabase.from('audit_logs').select('*, organizations(name)', { count: 'exact' }).order('time', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  if (userName) q = q.eq('user', userName)
  if (action) q = q.eq('action', action)
  if (tables?.length) q = q.in('target_table', tables)
  if (targetId != null) q = q.eq('target_id', targetId)
  if (from) q = q.gte('time', from)
  if (to) q = q.lte('time', to)
  if (search) {
    const s = search.replace(/[^\w\s\-一-鿿]/g, '').replace(/_/g, '\\_').trim()
    if (s) q = q.or(`action.ilike.%${s}%,target.ilike.%${s}%`)
  }
  return q.range(offset, offset + limit - 1)
}

export const createAuditLog = (data) => {
  if (!data?.organization_id) return Promise.resolve({ data: null, error: 'organization_id required' })
  return supabase.from('audit_logs').insert(data)
}

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

export const resolveErrorLog = (id, resolvedBy, note, reference) =>
  supabase.from('error_logs').update({
    resolved:        true,
    resolved_by:     resolvedBy,
    resolved_at:     new Date().toISOString(),
    resolution_note: note      || null,
    fix_reference:   reference || null,
  }).eq('id', id).select().single()

/**
 * Revert a resolved error back to unresolved.
 * Intentionally keeps resolution_note + fix_reference so the previous fix
 * attempt remains visible in the history.
 * recurrence_count is NOT reset here — it is incremented by logError() on
 * the next occurrence of the same error_code.
 */
export const unresolveErrorLog = (id) =>
  supabase.from('error_logs').update({
    resolved:    false,
    resolved_by: null,
    resolved_at: null,
  }).eq('id', id).select().single()

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
