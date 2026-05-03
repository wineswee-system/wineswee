import { supabase } from '../supabase'

export const getApprovalChains = async (orgId) => {
  let q = supabase
    .from('approval_chains')
    .select('*, approval_chain_steps(id, step_order, role_name, role_id, label, target_type, target_role_id, target_dept_id, target_emp_id)')
    .order('id')
  if (orgId) q = q.eq('organization_id', orgId)
  const { data, error } = await q
  if (error) return { data: null, error }
  const rows = (data || []).map(c => {
    const rawSteps = [...(c.approval_chain_steps || [])].sort((a, b) => (a.step_order || 0) - (b.step_order || 0))
    const steps = rawSteps.map(s => ({
      id: s.id,
      step_order: s.step_order,
      role: s.role_name,
      label: s.label,
      target_type: s.target_type,
      target_role_id: s.target_role_id,
      target_dept_id: s.target_dept_id,
      target_emp_id: s.target_emp_id,
    }))
    const { approval_chain_steps: _unused, ...rest } = c
    return { ...rest, steps }
  })
  return { data: rows, error: null }
}

export const createApprovalChain = async (data) => {
  const { steps, ...chainCore } = data || {}
  const { data: chain, error } = await supabase.from('approval_chains').insert(chainCore).select().single()
  if (error || !chain) return { data: chain, error }
  if (Array.isArray(steps) && steps.length > 0) {
    const rows = steps.map((s, i) => ({
      chain_id: chain.id,
      step_order: s.step_order ?? i,
      role_name: s.role || s.role_name || (s.label || '審核'),
      role_id: s.role_id ?? null,
      label: s.label ?? null,
      target_type: s.target_type || 'label',
      target_role_id: s.target_role_id ?? null,
      target_dept_id: s.target_dept_id ?? null,
      target_emp_id: s.target_emp_id ?? null,
      organization_id: chain.organization_id ?? null,
    }))
    const { error: stepErr } = await supabase.from('approval_chain_steps').insert(rows)
    if (stepErr) return { data: chain, error: stepErr }
  }
  return { data: { ...chain, steps: steps || [] }, error: null }
}

export const updateApprovalChain = async (id, data) => {
  const { steps, ...chainCore } = data || {}
  let chain = null
  if (Object.keys(chainCore).length > 0) {
    const { data: c, error } = await supabase.from('approval_chains').update(chainCore).eq('id', id).select().single()
    if (error) return { data: null, error }
    chain = c
  }
  if (Array.isArray(steps)) {
    await supabase.from('approval_chain_steps').delete().eq('chain_id', id)
    if (steps.length > 0) {
      const { data: existing } = await supabase.from('approval_chains').select('organization_id').eq('id', id).maybeSingle()
      const rows = steps.map((s, i) => ({
        chain_id: id,
        step_order: s.step_order ?? i,
        role_name: s.role || s.role_name || (s.label || '審核'),
        role_id: s.role_id ?? null,
        label: s.label ?? null,
        target_type: s.target_type || 'label',
        target_role_id: s.target_role_id ?? null,
        target_dept_id: s.target_dept_id ?? null,
        target_emp_id: s.target_emp_id ?? null,
        organization_id: existing?.organization_id ?? null,
      }))
      const { error: stepErr } = await supabase.from('approval_chain_steps').insert(rows)
      if (stepErr) return { data: chain, error: stepErr }
    }
  }
  return { data: { ...(chain || { id }), steps: steps || undefined }, error: null }
}

export const deleteApprovalChain = (id) =>
  supabase.from('approval_chains').delete().eq('id', id)

export const getApprovalFormByStep = (stepId) =>
  supabase.from('approval_forms').select('*').eq('ref_step_id', stepId).maybeSingle()

export const getApprovalFormByTask = (taskId) =>
  supabase.from('approval_forms').select('*').eq('ref_task_id', taskId).maybeSingle()

export const createApprovalForm = (data) =>
  supabase.from('approval_forms').insert(data).select().single()

export const updateApprovalForm = (id, data) =>
  supabase.from('approval_forms').update(data).eq('id', id).select().single()

export const getApprovalFormSteps = (formId) =>
  supabase.from('approval_form_steps').select('*').eq('form_id', formId).order('step_order')

export const createApprovalFormSteps = (rows) =>
  supabase.from('approval_form_steps').insert(rows).select()

export const updateApprovalFormStep = (id, data) =>
  supabase.from('approval_form_steps').update(data).eq('id', id).select().single()

export const getApprovalRules = (module) => {
  const q = supabase.from('approval_rules').select('*').order('approval_order').limit(200)
  return module ? q.eq('module', module) : q
}

export const createApprovalRule = (data) =>
  supabase.from('approval_rules').insert(data).select().single()

export const updateApprovalRule = (id, data) =>
  supabase.from('approval_rules').update(data).eq('id', id).select().single()

export const deleteApprovalRule = (id) =>
  supabase.from('approval_rules').delete().eq('id', id)

export const getApprovalRequests = (status) => {
  const q = supabase.from('approval_requests').select('*').order('created_at', { ascending: false }).limit(200)
  return status ? q.eq('status', status) : q
}

export const createApprovalRequest = (data) =>
  supabase.rpc('secure_create_approval_request', {
    p_module: data.module,
    p_document_type: data.document_type,
    p_document_id: data.document_id,
    p_requester: data.requester,
    p_rule_id: data.rule_id ?? null,
  })

export const updateApprovalRequest = (id, data) =>
  supabase.rpc('secure_update_approval', {
    p_id: id,
    p_status: data.status,
    p_approver: data.approver,
    p_comments: data.comments ?? null,
    p_reject_reason: data.reject_reason ?? null,
  })

export const getApprovalDelegations = () =>
  supabase.from('approval_delegations').select('*').order('start_date', { ascending: false }).limit(200)

export const createApprovalDelegation = (data) =>
  supabase.from('approval_delegations').insert(data).select().single()

export const updateApprovalDelegation = (id, data) =>
  supabase.from('approval_delegations').update(data).eq('id', id).select().single()

export const deleteApprovalDelegation = (id) =>
  supabase.from('approval_delegations').delete().eq('id', id)
