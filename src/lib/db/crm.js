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

// ── Member Groups ──────────────────────────────────────────
export const getMemberGroups = (orgId) => {
  let q = supabase.from('member_groups').select('*').order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getMemberGroupById = (id) =>
  supabase.from('member_groups').select('*').eq('id', id).single()

export const createMemberGroup = (data) =>
  supabase.from('member_groups').insert(data).select().single()

export const updateMemberGroup = (id, data) =>
  supabase.from('member_groups')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()

export const deleteMemberGroup = (id) =>
  supabase.from('member_groups').delete().eq('id', id)

export const getMemberGroupMembers = (groupId) =>
  supabase.from('member_group_members')
    .select('*, members(id, name, phone, level, lifetime_spend, lifetime_points, available_points)')
    .eq('group_id', groupId)
    .order('added_at', { ascending: false })

export const addStaticGroupMember = (groupId, memberId) =>
  supabase.from('member_group_members')
    .insert({ group_id: groupId, member_id: memberId })
    .select().single()

export const removeStaticGroupMember = (groupId, memberId) =>
  supabase.from('member_group_members')
    .delete().eq('group_id', groupId).eq('member_id', memberId)

export const refreshMemberGroup = (groupId) =>
  supabase.rpc('refresh_member_group', { p_group_id: groupId })

export const previewMemberGroup = (orgId, criteria) =>
  supabase.rpc('preview_member_group', { p_organization_id: orgId, p_criteria: criteria })

// ── Surveys ────────────────────────────────────────────────
export const getSurveys = (orgId) => {
  let q = supabase.from('surveys').select('*, member_levels(id, name, icon)').order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getSurveyById = (id) =>
  supabase.from('surveys').select('*, member_levels(id, name, icon)').eq('id', id).single()

export const createSurvey = (data) =>
  supabase.from('surveys').insert(data).select().single()

export const updateSurvey = (id, data) =>
  supabase.from('surveys').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()

export const deleteSurvey = (id) =>
  supabase.from('surveys').delete().eq('id', id)

// ── Survey Questions ───────────────────────────────────────
export const getSurveyQuestions = (surveyId) =>
  supabase.from('survey_questions').select('*').eq('survey_id', surveyId).order('sort_order', { ascending: true })

export const createSurveyQuestion = (data) =>
  supabase.from('survey_questions').insert(data).select().single()

export const updateSurveyQuestion = (id, data) =>
  supabase.from('survey_questions').update(data).eq('id', id).select().single()

export const deleteSurveyQuestion = (id) =>
  supabase.from('survey_questions').delete().eq('id', id)

// 單一 RPC 批次重排（sort_order = 陣列位置，0-based，與舊 Promise.all 行為一致）
// 見 migration 20260702620000_db_misc_fixes.sql
export const reorderSurveyQuestions = (questions) =>
  supabase.rpc('reorder_survey_questions', { p_ids: questions.map(q => q.id) })

// ── Survey Invitations ─────────────────────────────────────
export const getSurveyInvitations = (surveyId, { status } = {}) => {
  let q = supabase.from('survey_invitations')
    .select('*, members(id, name, phone, level)')
    .eq('survey_id', surveyId)
    .order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  return q
}

// ── Survey Results ─────────────────────────────────────────
export const getSurveyResults = (surveyId) =>
  supabase.from('survey_responses')
    .select('*, survey_questions(id, type, question, options, sort_order)')
    .eq('survey_id', surveyId)
    .order('created_at', { ascending: false })

export const getSurveyResponseSummary = (surveyId) =>
  supabase.rpc('get_survey_response_summary', { p_survey_id: surveyId })

// ── Pilot Runs ─────────────────────────────────────────────
export const getPilotRuns = (orgId) => {
  let q = supabase.from('pilot_runs')
    .select('*, surveys(id, name, status), member_groups(id, name, type)')
    .order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getPilotRunById = (id) =>
  supabase.from('pilot_runs')
    .select('*, surveys(id, name, status), member_groups(id, name, type)')
    .eq('id', id).single()

export const createPilotRun = (data) =>
  supabase.from('pilot_runs').insert(data).select().single()

export const updatePilotRun = (id, data) =>
  supabase.from('pilot_runs')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()

export const deletePilotRun = (id) =>
  supabase.from('pilot_runs').delete().eq('id', id)

export const launchPilotRun = (pilotRunId) =>
  supabase.rpc('launch_pilot_run', { p_pilot_run_id: pilotRunId })

export const approvePilotRun = (id, notes, decidedBy) =>
  supabase.from('pilot_runs').update({
    decision:       'approve',
    decision_notes: notes || null,
    decided_at:     new Date().toISOString(),
    decided_by:     decidedBy || null,
    status:         'approved',
    updated_at:     new Date().toISOString(),
  }).eq('id', id).select().single()

export const rejectPilotRun = (id, notes, decidedBy) =>
  supabase.from('pilot_runs').update({
    decision:       'reject',
    decision_notes: notes || null,
    decided_at:     new Date().toISOString(),
    decided_by:     decidedBy || null,
    status:         'rejected',
    updated_at:     new Date().toISOString(),
  }).eq('id', id).select().single()

// ── Coupons ────────────────────────────────────────────────

export const getCoupons = (orgId, { status } = {}) => {
  let q = supabase.from('coupons').select('*').order('created_at', { ascending: false })
  if (orgId)  q = q.eq('organization_id', orgId)
  if (status) q = q.eq('status', status)
  return q
}

export const getCouponById = (id) =>
  supabase.from('coupons').select('*').eq('id', id).single()

export const createCoupon = (data) =>
  supabase.from('coupons').insert(data).select().single()

export const updateCoupon = (id, data) =>
  supabase.from('coupons')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()

export const deleteCoupon = (id) =>
  supabase.from('coupons').delete().eq('id', id)

// ── Coupon Assignments ─────────────────────────────────────

export const getMemberCoupons = (memberId) =>
  supabase.from('coupon_assignments')
    .select('*, coupons(id, code, name, type, value, valid_until, min_purchase)')
    .eq('member_id', memberId)
    .order('assigned_at', { ascending: false })

export const getCouponAssignments = (couponId) =>
  supabase.from('coupon_assignments')
    .select('*, members(id, name, phone, member_number)')
    .eq('coupon_id', couponId)
    .order('assigned_at', { ascending: false })

export const assignCoupon = (couponId, memberId, orgId, reason, assignedBy) =>
  supabase.from('coupon_assignments').insert({
    coupon_id:         couponId,
    member_id:         memberId,
    organization_id:   orgId,
    assignment_reason: reason || 'individual',
    assigned_by:       assignedBy || null,
  }).select().single()

export const redeemCoupon = (assignmentId, purchaseId) =>
  supabase.from('coupon_assignments').update({
    used_at:             new Date().toISOString(),
    used_at_purchase_id: purchaseId || null,
  }).eq('id', assignmentId).select().single()

export const bulkAssignCoupon = (couponId, memberIds, orgId, reason) => {
  const rows = memberIds.map(mid => ({
    coupon_id:         couponId,
    member_id:         mid,
    organization_id:   orgId,
    assignment_reason: reason || 'broadcast',
  }))
  return supabase.from('coupon_assignments').upsert(rows, { onConflict: 'coupon_id,member_id' }).select()
}

// ── Member Purchases (global browse) ──────────────────────

export const getAllMemberPurchases = (orgId, { memberId, storeId, dateFrom, dateTo, limit = 200 } = {}) => {
  let q = supabase.from('member_purchases')
    .select('*, members(id, name, phone, member_number), stores(name)')
    .order('purchased_at', { ascending: false })
    .limit(limit)
  if (orgId)    q = q.eq('organization_id', orgId)
  if (memberId) q = q.eq('member_id', memberId)
  if (storeId)  q = q.eq('store_id', storeId)
  if (dateFrom) q = q.gte('purchased_at', `${dateFrom}T00:00:00`)
  if (dateTo)   q = q.lte('purchased_at', `${dateTo}T23:59:59`)
  return q
}

export const getMemberPurchaseSummary = (memberId) =>
  supabase.from('member_purchases')
    .select('total_amount, purchased_at')
    .eq('member_id', memberId)
    .order('purchased_at', { ascending: false })
