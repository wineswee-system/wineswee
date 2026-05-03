import { supabase } from '../supabase'

export const getCRMForms = () =>
  supabase.from('crm_forms').select('*').order('created_at', { ascending: false })

export const createCRMForm = (data) =>
  supabase.from('crm_forms').insert(data).select().single()

export const updateCRMForm = (id, data) =>
  supabase.from('crm_forms').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()

export const deleteCRMForm = (id) =>
  supabase.from('crm_forms').delete().eq('id', id)

export const getCRMFormSubmissions = (formId) => {
  let q = supabase.from('crm_form_submissions').select('*').order('submitted_at', { ascending: false })
  return formId ? q.eq('form_id', formId) : q
}

export const createCRMFormSubmission = (data) =>
  supabase.from('crm_form_submissions').insert(data).select().single()

export const getCRMTerritories = () =>
  supabase.from('crm_territories').select('*').order('id')

export const createCRMTerritory = (data) =>
  supabase.from('crm_territories').insert(data).select().single()

export const updateCRMTerritory = (id, data) =>
  supabase.from('crm_territories').update(data).eq('id', id).select().single()

export const deleteCRMTerritory = (id) =>
  supabase.from('crm_territories').delete().eq('id', id)

export const getCRMLeads = () =>
  supabase.from('crm_leads').select('*').order('created_at', { ascending: false })

export const createCRMLead = (data) =>
  supabase.from('crm_leads').insert(data).select().single()

export const updateCRMLead = (id, data) =>
  supabase.from('crm_leads').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()

export const deleteCRMLead = (id) =>
  supabase.from('crm_leads').delete().eq('id', id)

export const getCRMActivities = (filters = {}) => {
  let q = supabase.from('crm_activities').select('*').order('due_date', { ascending: true })
  if (filters.entity_type && filters.entity_id) {
    q = q.eq('entity_type', filters.entity_type).eq('entity_id', filters.entity_id)
  }
  if (filters.assignee_id) q = q.eq('assignee_id', filters.assignee_id)
  else if (filters.assignee) q = q.eq('assignee', filters.assignee)
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.from) q = q.gte('due_date', filters.from)
  if (filters.to) q = q.lte('due_date', filters.to)
  return q
}

export const createCRMActivity = (data) =>
  supabase.from('crm_activities').insert(data).select().single()

export const updateCRMActivity = (id, data) =>
  supabase.from('crm_activities').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()

export const deleteCRMActivity = (id) =>
  supabase.from('crm_activities').delete().eq('id', id)

export const getCRMNotes = (entityType, entityId) =>
  supabase.from('crm_notes').select('*').eq('entity_type', entityType).eq('entity_id', entityId)
    .order('is_pinned', { ascending: false }).order('created_at', { ascending: false })

export const createCRMNote = (data) =>
  supabase.from('crm_notes').insert(data).select().single()

export const updateCRMNote = (id, data) =>
  supabase.from('crm_notes').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()

export const deleteCRMNote = (id) =>
  supabase.from('crm_notes').delete().eq('id', id)

export const getCRMAttachments = (entityType, entityId) =>
  supabase.from('crm_attachments').select('*').eq('entity_type', entityType).eq('entity_id', entityId)
    .order('created_at', { ascending: false })

export const createCRMAttachment = (data) =>
  supabase.from('crm_attachments').insert(data).select().single()

export const deleteCRMAttachment = (id) =>
  supabase.from('crm_attachments').delete().eq('id', id)

export const getTicketHistory = (ticketId) =>
  supabase.from('ticket_history').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: false })

export const createTicketHistoryEntry = (data) =>
  supabase.from('ticket_history').insert(data).select().single()

export const getSLAPolicies = () =>
  supabase.from('sla_policies').select('*').order('id')

export const createSLAPolicy = (data) =>
  supabase.from('sla_policies').insert(data).select().single()

export const updateSLAPolicy = (id, data) =>
  supabase.from('sla_policies').update(data).eq('id', id).select().single()

export const deleteSLAPolicy = (id) =>
  supabase.from('sla_policies').delete().eq('id', id)

export const getCRMWorkflows = () =>
  supabase.from('crm_workflows').select('*').order('created_at', { ascending: false })

export const createCRMWorkflow = (data) =>
  supabase.from('crm_workflows').insert(data).select().single()

export const updateCRMWorkflow = (id, data) =>
  supabase.from('crm_workflows').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()

export const deleteCRMWorkflow = (id) =>
  supabase.from('crm_workflows').delete().eq('id', id)
