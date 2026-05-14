import { supabase } from '../supabase'

export const getWorkflows = (options = {}) => {
  let q = supabase.from('workflows').select('*').order('id')
  if (options.orgId) q = q.eq('organization_id', options.orgId)
  return q.limit(options.limit ?? 200)
}

export const createWorkflow = (data) =>
  supabase.from('workflows').insert(data).select().single()

export const updateWorkflow = (id, data) =>
  supabase.from('workflows').update(data).eq('id', id).select().single()

export const deleteWorkflow = (id, orgId) => {
  let q = supabase.from('workflows').delete().eq('id', id)
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getWorkflowInstances = (options = {}) => {
  let q = supabase.from('workflow_instances').select('*').order('started_at', { ascending: false })
  if (options.orgId) q = q.eq('organization_id', options.orgId)
  if (options.excludeTemplates?.length) {
    q = q.not('template_name', 'in', `(${options.excludeTemplates.map(n => `"${n}"`).join(',')})`)
  }
  return q.limit(options.limit ?? 200)
}

export const createWorkflowInstance = (data) =>
  supabase.from('workflow_instances').insert(data).select().single()

export const updateWorkflowInstance = (id, data) =>
  supabase.from('workflow_instances').update(data).eq('id', id).select().single()

export const deleteWorkflowInstance = (id, orgId) => {
  let q = supabase.from('workflow_instances').delete().eq('id', id)
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getWorkflowSteps = (instanceId) => {
  const q = supabase.from('workflow_steps').select('*').order('step_order')
  return instanceId ? q.eq('instance_id', instanceId) : q
}

export const createWorkflowStep = (data) =>
  supabase.from('workflow_steps').insert(data).select().single()

export const createWorkflowStepsBatch = (rows) =>
  supabase.from('workflow_steps').insert(rows).select()

export const updateWorkflowStep = (id, data) =>
  supabase.from('workflow_steps').update(data).eq('id', id).select().single()

export const deleteWorkflowStep = (id) =>
  supabase.from('workflow_steps').delete().eq('id', id)

export const getWorkflowCategories = () =>
  supabase.from('workflow_categories').select('*').eq('scope', 'workflow').order('sort_order').order('id')

export const createWorkflowCategory = (data) =>
  supabase.from('workflow_categories').insert({ scope: 'workflow', ...data }).select().single()

export const deleteWorkflowCategory = (id) =>
  supabase.from('workflow_categories').delete().eq('id', id)

export const getCategories = (scope) =>
  supabase.from('workflow_categories').select('*').eq('scope', scope).order('sort_order').order('id')

export const createCategory = ({ scope, name, color, sort_order }) =>
  supabase.from('workflow_categories').insert({ scope, name, color, sort_order }).select().single()

export const updateCategory = (id, data) =>
  supabase.from('workflow_categories').update(data).eq('id', id).select().single()

export const deleteCategory = (id) =>
  supabase.from('workflow_categories').delete().eq('id', id)

export const getTags = () =>
  supabase.from('tags').select('*').order('sort_order').order('id')

export const createTag = (data) =>
  supabase.from('tags').insert(data).select().single()

export const updateTag = (id, data) =>
  supabase.from('tags').update(data).eq('id', id).select().single()

export const deleteTag = (id) =>
  supabase.from('tags').delete().eq('id', id)
