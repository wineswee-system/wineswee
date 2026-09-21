import { supabase } from '../supabase'

export const getProjects = (orgId) => {
  let q = supabase.from('projects').select('*').order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getProject = (id, orgId) => {
  let q = supabase.from('projects').select('*').eq('id', id)
  if (orgId) q = q.eq('organization_id', orgId)
  return q.maybeSingle()
}

export const createProject = (data) =>
  supabase.from('projects').insert(data).select().single()

export const updateProject = (id, data) =>
  supabase.from('projects').update(data).eq('id', id).select().single()

export const getProjectMembers = (projectId) =>
  supabase.from('v_project_members_full').select('*').eq('project_id', projectId).order('added_at')

export const addProjectMember = (data) =>
  supabase.from('project_members').insert(data).select().single()

export const updateProjectMember = (id, data) =>
  supabase.from('project_members').update(data).eq('id', id).select().single()

export const removeProjectMember = (id) =>
  supabase.from('project_members').delete().eq('id', id)

export const getProjectSections = (projectId) =>
  supabase.from('project_sections').select('*').eq('project_id', projectId).order('sort_order')

export const createProjectSection = (data) =>
  supabase.from('project_sections').insert(data).select().single()

export const updateProjectSection = (id, data) =>
  supabase.from('project_sections').update(data).eq('id', id).select().single()

export const deleteProjectSection = (id) =>
  supabase.from('project_sections').delete().eq('id', id)

export const getProjectCustomFields = (projectId) =>
  supabase.from('project_custom_fields').select('*').eq('project_id', projectId).order('sort_order')

export const createProjectCustomField = (data) =>
  supabase.from('project_custom_fields').insert(data).select().single()

export const updateProjectCustomField = (id, data) =>
  supabase.from('project_custom_fields').update(data).eq('id', id).select().single()

export const deleteProjectCustomField = (id) =>
  supabase.from('project_custom_fields').delete().eq('id', id)

export const getTaskCustomFieldValues = (taskId) =>
  supabase.from('task_custom_field_values').select('*, field:field_id(*)').eq('task_id', taskId)

export const upsertTaskCustomFieldValue = (data) =>
  supabase.from('task_custom_field_values')
    .upsert(data, { onConflict: 'task_id,field_id' })
    .select().single()

export const getTaskActivity = (taskId, limit = 50) =>
  supabase.from('task_activity')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .limit(limit)

export const logTaskActivity = (data) =>
  supabase.from('task_activity').insert(data).select().single()

export const getTasksExpanded = (filters = {}) => {
  let q = supabase.from('v_tasks_expanded').select('*').order('created_at', { ascending: false })
  if (filters.orgId) q = q.eq('organization_id', filters.orgId)
  if (filters.project_id) q = q.eq('project_id', filters.project_id)
  if (filters.section_id) q = q.eq('section_id', filters.section_id)
  if (filters.assignee_id) q = q.eq('assignee_id', filters.assignee_id)
  if (filters.status) q = q.in('status', Array.isArray(filters.status) ? filters.status : [filters.status])
  return q
}

export const getChecklists = (orgId) => {
  let q = supabase.from('checklists').select('*').order('id')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createChecklist = (data) =>
  supabase.from('checklists').insert(data).select().single()

export const updateChecklist = (id, data) =>
  supabase.from('checklists').update(data).eq('id', id).select().single()

export const deleteChecklist = (id) =>
  supabase.from('checklists').delete().eq('id', id)

export const getChecklistItems = (checklistId) =>
  supabase.from('checklist_items').select('*').eq('checklist_id', checklistId).order('sort_order')

export const createChecklistItem = (data) =>
  supabase.from('checklist_items').insert(data).select().single()

export const updateChecklistItem = (id, data) =>
  supabase.from('checklist_items').update(data).eq('id', id).select().single()

export const deleteChecklistItem = (id) =>
  supabase.from('checklist_items').delete().eq('id', id)
