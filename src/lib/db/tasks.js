import { supabase } from '../supabase'

export const getTasks = (filters = {}) => {
  let q = supabase.from('tasks').select('*').order('created_at', { ascending: false })
  if (filters.orgId) q = q.eq('organization_id', filters.orgId)
  if (filters.instanceId) q = q.eq('workflow_instance_id', filters.instanceId)
  if (filters.assignee_id) q = q.eq('assignee_id', filters.assignee_id)
  if (filters.status) q = q.in('status', Array.isArray(filters.status) ? filters.status : [filters.status])
  if (filters.bucket) q = q.eq('bucket', filters.bucket)
  if (filters.task_type) q = q.eq('task_type', filters.task_type)
  if (filters.section_id) q = q.eq('section_id', filters.section_id)
  if (filters.parent_task_id !== undefined) q = filters.parent_task_id === null
    ? q.is('parent_task_id', null)
    : q.eq('parent_task_id', filters.parent_task_id)
  return q
}

export const getTasksByInstance = (instanceId) =>
  supabase.from('tasks').select('*').eq('workflow_instance_id', instanceId).order('step_order')

export const createTask = (data) =>
  supabase.from('tasks').insert(data).select().single()

export const createTasksBatch = (rows) =>
  supabase.from('tasks').insert(rows).select()

export const updateTask = (id, data) =>
  supabase.from('tasks').update(data).eq('id', id).select().single()

export const deleteTask = (id) =>
  supabase.from('tasks').delete().eq('id', id)

export const getTaskDependencies = (taskId) =>
  supabase.from('task_dependencies').select('*').or(`task_id.eq.${taskId},depends_on_task_id.eq.${taskId}`)

export const getTaskDependenciesByInstance = (taskIds) =>
  supabase.from('task_dependencies').select('*').in('task_id', taskIds)

export const createTaskDependency = (data) =>
  supabase.from('task_dependencies').insert(data).select().single()

export const deleteTaskDependency = (id) =>
  supabase.from('task_dependencies').delete().eq('id', id)

export const getTaskComments = (taskId) =>
  supabase.from('task_comments').select('*').eq('task_id', taskId).order('created_at', { ascending: true })

export const createTaskComment = (data) =>
  supabase.from('task_comments').insert(data).select().single()

export const getTaskAttachments = (taskId) =>
  supabase.from('task_attachments').select('*').eq('task_id', taskId).order('created_at')

export const createTaskAttachment = (data) =>
  supabase.from('task_attachments').insert(data).select().single()

export const deleteTaskAttachment = (id) =>
  supabase.from('task_attachments').delete().eq('id', id)

export const getTaskChecklists = (taskId) =>
  supabase.from('task_checklists').select('*, checklists(*)').eq('task_id', taskId)

export const linkTaskChecklist = (taskId, checklistId) =>
  supabase.from('task_checklists').insert({ task_id: taskId, checklist_id: checklistId }).select().single()

export const unlinkTaskChecklist = (id) =>
  supabase.from('task_checklists').delete().eq('id', id)

export const getTaskChecklistItems = (taskId) =>
  supabase.from('task_checklist_items').select('*').eq('task_id', taskId).order('sort_order')

export const createTaskChecklistItem = (data) =>
  supabase.from('task_checklist_items').insert(data).select().single()

export const updateTaskChecklistItem = (id, data) =>
  supabase.from('task_checklist_items').update(data).eq('id', id).select().single()

export const deleteTaskChecklistItem = (id) =>
  supabase.from('task_checklist_items').delete().eq('id', id)

export const getTaskConfirmations = (taskId) =>
  supabase.from('task_confirmations').select('*').eq('task_id', taskId).order('created_at')

export const createTaskConfirmation = (data) =>
  supabase.from('task_confirmations').insert(data).select().single()

export const updateTaskConfirmation = (id, data) =>
  supabase.from('task_confirmations').update(data).eq('id', id).select().single()

export const deleteTaskConfirmation = (id) =>
  supabase.from('task_confirmations').delete().eq('id', id)

export const getTaskWatchers = (taskId) =>
  supabase.from('task_watchers')
    .select('*, employees:employee_id(id, name, email, dept)')
    .eq('task_id', taskId)
    .order('added_at')

export const addTaskWatcher = (data) =>
  supabase.from('task_watchers').insert(data).select().single()

export const removeTaskWatcher = (id) =>
  supabase.from('task_watchers').delete().eq('id', id)

export const getWatchedTasksForEmployee = (employeeId) =>
  supabase.from('task_watchers').select('*, tasks:task_id(*)').eq('employee_id', employeeId)

export const getTaskMentions = (taskId) =>
  supabase.from('task_mentions')
    .select('*, employees:mentioned_employee_id(id, name)')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })

export const createTaskMentions = (rows) =>
  supabase.from('task_mentions').insert(rows).select()

export const markMentionNotified = (id) =>
  supabase.from('task_mentions').update({ notified: true, notified_at: new Date().toISOString() }).eq('id', id)
