import { supabase } from './supabase'

// ── Employees ──────────────────────────────────────────────
export const getEmployees = () =>
  supabase.from('employees').select('*').order('id')

export const createEmployee = (data) =>
  supabase.from('employees').insert(data).select().single()

export const updateEmployee = (id, data) =>
  supabase.from('employees').update(data).eq('id', id).select().single()

export const deleteEmployee = (id) =>
  supabase.from('employees').delete().eq('id', id)

export async function inviteEmployee(email, name) {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  const res = await fetch(`${url}/functions/v1/invite-employee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'apikey': key },
    body: JSON.stringify({ email, name }),
  })
  return res.json()
}

// ── Attendance ─────────────────────────────────────────────
export const getAttendance = (date) => {
  const q = supabase.from('attendance_records').select('*').order('id')
  return date ? q.eq('date', date) : q
}

export const upsertAttendance = (data) =>
  supabase.from('attendance_records').upsert(data).select().single()

/**
 * Server-side clock-in via Edge Function (validates GPS + WiFi on server).
 * @param {{ employee: string, action: 'clock_in'|'clock_out', lat?: number, lng?: number, accuracy?: number, ip?: string }} payload
 * @returns {Promise<{ success: boolean, record: object, method: string, locationName: string, ip: string }>}
 * @throws {Error} with descriptive message on validation failure or server error
 */
export async function serverClockIn(payload) {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  const res = await fetch(`${url}/functions/v1/clock-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'apikey': key,
    },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok) {
    const msg = data.reasons ? `${data.error}\n${data.reasons.join('\n')}` : (data.error || '伺服器錯誤')
    const err = new Error(msg)
    err.code = res.status === 403 ? 'VALIDATION_FAILED' : 'SERVER_ERROR'
    throw err
  }
  return data
}

/**
 * Trigger missed clock-out check via Edge Function.
 * @param {string} [date] - optional date override (YYYY-MM-DD), defaults to yesterday
 */
export async function checkMissedClockout(date) {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  const res = await fetch(`${url}/functions/v1/check-missed-clockout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'apikey': key,
    },
    body: JSON.stringify(date ? { date } : {}),
  })
  return res.json()
}

// ── Leave Requests ─────────────────────────────────────────
export const getLeaveRequests = () =>
  supabase.from('leave_requests').select('*').order('id')

export const createLeaveRequest = (data) =>
  supabase.from('leave_requests').insert(data).select().single()

export const updateLeaveStatus = (id, status, approver, rejectReason) =>
  supabase.rpc('secure_update_leave_status', {
    p_id: id,
    p_status: status,
    p_approver: approver,
    p_reject_reason: rejectReason || null,
  })

export const deleteLeaveRequest = (id) =>
  supabase.from('leave_requests').delete().eq('id', id)

// ── Overtime ───────────────────────────────────────────────
export const getOvertimeRequests = () =>
  supabase.from('overtime_requests').select('*').order('id')

export const createOvertimeRequest = (data) =>
  supabase.from('overtime_requests').insert(data).select().single()

export const updateOvertimeStatus = (id, status, rejectReason) =>
  supabase.rpc('secure_update_overtime_status', {
    p_id: id,
    p_status: status,
    p_reject_reason: rejectReason || null,
  })

// ── Salary ─────────────────────────────────────────────────
export const getSalaryRecords = (month) => {
  const q = supabase.from('salary_records').select('*').order('id')
  return month ? q.eq('month', month) : q
}

export const upsertSalaryRecord = (data) =>
  supabase.rpc('secure_upsert_salary', {
    p_employee: data.employee,
    p_month: data.month,
    p_base_salary: data.base_salary,
    p_allowance: data.allowance ?? 0,
    p_overtime: data.overtime ?? 0,
    p_deductions: data.deductions ?? 0,
    p_insurance: data.insurance ?? 0,
    p_net_salary: data.net_salary ?? null,
  })

// ── Schedule ───────────────────────────────────────────────
export const getScheduleData = () =>
  supabase.from('schedule_data').select('*').order('id')

export const updateSchedule = (id, data) =>
  supabase.from('schedule_data').update(data).eq('id', id).select().single()

// ── Holidays ───────────────────────────────────────────────
export const getHolidays = () =>
  supabase.from('holidays').select('*').order('date')

export const createHoliday = (data) =>
  supabase.from('holidays').insert(data).select().single()

export const deleteHoliday = (id) =>
  supabase.from('holidays').delete().eq('id', id)

/** 呼叫 Edge Function 刷新國定假日與排班規則 */
export const refreshHolidays = async (years) => {
  const { data, error } = await supabase.functions.invoke('refresh-holidays', {
    body: years ? { years } : {},
  })
  if (error) throw error
  return data
}

/** 取得排班規則快照 */
export const getSchedulingRules = (year) =>
  supabase
    .from('scheduling_rules_snapshot')
    .select('*')
    .eq('effective_year', year || new Date().getFullYear())
    .order('category')

// ── Performance Reviews ────────────────────────────────────
export const getPerformanceReviews = () =>
  supabase.from('performance_reviews').select('*').order('id')

export const updatePerformanceReview = (id, data) =>
  supabase.from('performance_reviews').update(data).eq('id', id).select().single()

// ── Recruitment ────────────────────────────────────────────
export const getRecruitmentJobs = () =>
  supabase.from('recruitment_jobs').select('*').order('id')

export const createRecruitmentJob = (data) =>
  supabase.from('recruitment_jobs').insert(data).select().single()

export const updateRecruitmentJob = (id, data) =>
  supabase.from('recruitment_jobs').update(data).eq('id', id).select().single()

export const deleteRecruitmentJob = (id) =>
  supabase.from('recruitment_jobs').delete().eq('id', id)

// ── Documents ──────────────────────────────────────────────
export const getDocuments = () =>
  supabase.from('documents').select('*').order('upload_date', { ascending: false })

export const createDocument = (data) =>
  supabase.from('documents').insert(data).select().single()

export const deleteDocument = (id) =>
  supabase.from('documents').delete().eq('id', id)

// ── Business Trips ─────────────────────────────────────────
export const getBusinessTrips = () =>
  supabase.from('business_trips').select('*').order('id')

export const createBusinessTrip = (data) =>
  supabase.from('business_trips').insert(data).select().single()

export const updateBusinessTripStatus = (id, status, rejectReason) =>
  supabase.from('business_trips').update({ status, reject_reason: rejectReason || null }).eq('id', id).select().single()

// ── Expenses ───────────────────────────────────────────────
export const getExpenses = () =>
  supabase.from('expenses').select('*').order('id')

export const createExpense = (data) =>
  supabase.from('expenses').insert(data).select().single()

export const updateExpenseStatus = (id, status, rejectReason) =>
  supabase.from('expenses').update({ status, reject_reason: rejectReason || null }).eq('id', id).select().single()

// ── Workflows ──────────────────────────────────────────────
export const getWorkflows = () =>
  supabase.from('workflows').select('*').order('id')

export const createWorkflow = (data) =>
  supabase.from('workflows').insert(data).select().single()

export const updateWorkflow = (id, data) =>
  supabase.from('workflows').update(data).eq('id', id).select().single()

// ── Workflow Instances ────────────────────────────────────
export const getWorkflowInstances = () =>
  supabase.from('workflow_instances').select('*').order('started_at', { ascending: false })

export const createWorkflowInstance = (data) =>
  supabase.from('workflow_instances').insert(data).select().single()

export const updateWorkflowInstance = (id, data) =>
  supabase.from('workflow_instances').update(data).eq('id', id).select().single()

export const deleteWorkflowInstance = (id) =>
  supabase.from('workflow_instances').delete().eq('id', id)

// ── Workflow Steps ────────────────────────────────────────
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

// ── Step Dependencies (前置條件 & 觸發動作) ─────────────
export const getStepDependencies = (stepId) =>
  supabase.from('workflow_step_dependencies').select('*').or(`step_id.eq.${stepId},depends_on_step_id.eq.${stepId}`)

export const getStepDependenciesByInstance = (stepIds) =>
  supabase.from('workflow_step_dependencies').select('*').in('step_id', stepIds)

export const createStepDependency = (data) =>
  supabase.from('workflow_step_dependencies').insert(data).select().single()

export const deleteStepDependency = (id) =>
  supabase.from('workflow_step_dependencies').delete().eq('id', id)

// ── Step Comments (備註留言) ──────────────────────────────
export const getStepComments = (stepId) =>
  supabase.from('workflow_step_comments').select('*').eq('step_id', stepId).order('created_at', { ascending: true })

export const createStepComment = (data) =>
  supabase.from('workflow_step_comments').insert(data).select().single()

// ── Step Attachments (附件) ──────────────────────────────
export const getStepAttachments = (stepId) =>
  supabase.from('workflow_step_attachments').select('*').eq('step_id', stepId).order('created_at')

export const createStepAttachment = (data) =>
  supabase.from('workflow_step_attachments').insert(data).select().single()

export const deleteStepAttachment = (id) =>
  supabase.from('workflow_step_attachments').delete().eq('id', id)

// ── Step-Checklist Link (關聯查核清單) ───────────────────
export const getStepChecklists = (stepId) =>
  supabase.from('workflow_step_checklists').select('*, checklists(*)').eq('step_id', stepId)

export const linkStepChecklist = (stepId, checklistId) =>
  supabase.from('workflow_step_checklists').insert({ step_id: stepId, checklist_id: checklistId }).select().single()

export const unlinkStepChecklist = (id) =>
  supabase.from('workflow_step_checklists').delete().eq('id', id)

// ── Step Checklist Items (任務內建清單) ──────────────────
export const getStepChecklistItems = (stepId) =>
  supabase.from('workflow_step_checklist_items').select('*').eq('step_id', stepId).order('sort_order')

export const createStepChecklistItem = (data) =>
  supabase.from('workflow_step_checklist_items').insert(data).select().single()

export const updateStepChecklistItem = (id, data) =>
  supabase.from('workflow_step_checklist_items').update(data).eq('id', id).select().single()

export const deleteStepChecklistItem = (id) =>
  supabase.from('workflow_step_checklist_items').delete().eq('id', id)

// ── Approval Chains (簽核鏈) ─────────────────────────────
export const getApprovalChains = () =>
  supabase.from('approval_chains').select('*').order('id')

export const createApprovalChain = (data) =>
  supabase.from('approval_chains').insert(data).select().single()

// ── Approval Forms (簽核表單) ────────────────────────────
export const getApprovalFormByStep = (stepId) =>
  supabase.from('approval_forms').select('*').eq('ref_step_id', stepId).maybeSingle()

export const createApprovalForm = (data) =>
  supabase.from('approval_forms').insert(data).select().single()

export const updateApprovalForm = (id, data) =>
  supabase.from('approval_forms').update(data).eq('id', id).select().single()

// ── Approval Form Steps (簽核步驟) ──────────────────────
export const getApprovalFormSteps = (formId) =>
  supabase.from('approval_form_steps').select('*').eq('form_id', formId).order('step_order')

export const createApprovalFormSteps = (rows) =>
  supabase.from('approval_form_steps').insert(rows).select()

export const updateApprovalFormStep = (id, data) =>
  supabase.from('approval_form_steps').update(data).eq('id', id).select().single()

// ── Tasks (unified: standalone + workflow-linked) ─────────
export const getTasks = (filters = {}) => {
  let q = supabase.from('tasks').select('*').order('created_at', { ascending: false })
  if (filters.instanceId) q = q.eq('workflow_instance_id', filters.instanceId)
  if (filters.assignee_id) q = q.eq('assignee_id', filters.assignee_id)
  else if (filters.assignee) q = q.eq('assignee', filters.assignee)
  if (filters.status) q = q.in('status', Array.isArray(filters.status) ? filters.status : [filters.status])
  if (filters.bucket) q = q.eq('bucket', filters.bucket)
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

// ── Task Dependencies (前置條件 & 觸發動作) ───────────────
export const getTaskDependencies = (taskId) =>
  supabase.from('task_dependencies').select('*').or(`task_id.eq.${taskId},depends_on_task_id.eq.${taskId}`)

export const getTaskDependenciesByInstance = (taskIds) =>
  supabase.from('task_dependencies').select('*').in('task_id', taskIds)

export const createTaskDependency = (data) =>
  supabase.from('task_dependencies').insert(data).select().single()

export const deleteTaskDependency = (id) =>
  supabase.from('task_dependencies').delete().eq('id', id)

// ── Task Comments (備註留言) ──────────────────────────────
export const getTaskComments = (taskId) =>
  supabase.from('task_comments').select('*').eq('task_id', taskId).order('created_at', { ascending: true })

export const createTaskComment = (data) =>
  supabase.from('task_comments').insert(data).select().single()

// ── Task Attachments (附件) ──────────────────────────────
export const getTaskAttachments = (taskId) =>
  supabase.from('task_attachments').select('*').eq('task_id', taskId).order('created_at')

export const createTaskAttachment = (data) =>
  supabase.from('task_attachments').insert(data).select().single()

export const deleteTaskAttachment = (id) =>
  supabase.from('task_attachments').delete().eq('id', id)

// ── Task-Checklist Link (關聯查核清單) ───────────────────
export const getTaskChecklists = (taskId) =>
  supabase.from('task_checklists').select('*, checklists(*)').eq('task_id', taskId)

export const linkTaskChecklist = (taskId, checklistId) =>
  supabase.from('task_checklists').insert({ task_id: taskId, checklist_id: checklistId }).select().single()

export const unlinkTaskChecklist = (id) =>
  supabase.from('task_checklists').delete().eq('id', id)

// ── Task Checklist Items (任務內建清單) ──────────────────
export const getTaskChecklistItems = (taskId) =>
  supabase.from('task_checklist_items').select('*').eq('task_id', taskId).order('sort_order')

export const createTaskChecklistItem = (data) =>
  supabase.from('task_checklist_items').insert(data).select().single()

export const updateTaskChecklistItem = (id, data) =>
  supabase.from('task_checklist_items').update(data).eq('id', id).select().single()

export const deleteTaskChecklistItem = (id) =>
  supabase.from('task_checklist_items').delete().eq('id', id)

// ── Task Confirmations (多人確認) ────────────────────────
export const getTaskConfirmations = (taskId) =>
  supabase.from('task_confirmations').select('*').eq('task_id', taskId).order('created_at')

export const createTaskConfirmation = (data) =>
  supabase.from('task_confirmations').insert(data).select().single()

export const updateTaskConfirmation = (id, data) =>
  supabase.from('task_confirmations').update(data).eq('id', id).select().single()

// ── Approval Forms — task reference ─────────────────────
export const getApprovalFormByTask = (taskId) =>
  supabase.from('approval_forms').select('*').eq('ref_task_id', taskId).maybeSingle()

// ── Checklists ─────────────────────────────────────────────
export const getChecklists = () =>
  supabase.from('checklists').select('*').order('id')

export const createChecklist = (data) =>
  supabase.from('checklists').insert(data).select().single()

export const updateChecklist = (id, data) =>
  supabase.from('checklists').update(data).eq('id', id).select().single()

export const deleteChecklist = (id) =>
  supabase.from('checklists').delete().eq('id', id)

// ── Checklist Items (查核清單項目) ────────────────────────
export const getChecklistItems = (checklistId) =>
  supabase.from('checklist_items').select('*').eq('checklist_id', checklistId).order('sort_order')

export const createChecklistItem = (data) =>
  supabase.from('checklist_items').insert(data).select().single()

export const updateChecklistItem = (id, data) =>
  supabase.from('checklist_items').update(data).eq('id', id).select().single()

export const deleteChecklistItem = (id) =>
  supabase.from('checklist_items').delete().eq('id', id)

// ── Organizations ──────────────────────────────────────────
export const getOrganizations = () =>
  supabase.from('organizations').select('*').order('id')

export const createOrganization = (data) =>
  supabase.from('organizations').insert(data).select().single()

export const updateOrganization = (id, data) =>
  supabase.from('organizations').update(data).eq('id', id).select().single()

export const deleteOrganization = (id) =>
  supabase.from('organizations').delete().eq('id', id)

// ── Companies ─────────────────────────────────────────────
export const getCompanies = () =>
  supabase.from('companies').select('*').order('id')

export const createCompany = (data) =>
  supabase.from('companies').insert(data).select().single()

export const updateCompany = (id, data) =>
  supabase.from('companies').update(data).eq('id', id).select().single()

export const deleteCompany = (id) =>
  supabase.from('companies').delete().eq('id', id)

// ── Stores ────────────────────────────────────────────────
export const getStores = () =>
  supabase.from('stores').select('*').order('id')

export const getStoresWithRefs = () =>
  supabase.from('stores').select('*, company_ref:companies!company_id(id,name), manager_ref:employees!manager_id(id,name)').order('id')

export const createStore = (data) =>
  supabase.from('stores').insert(data).select().single()

export const updateStore = (id, data) =>
  supabase.from('stores').update(data).eq('id', id).select().single()

export const deleteStore = (id) =>
  supabase.from('stores').delete().eq('id', id)

// ── Departments ───────────────────────────────────────────
export const getDepartments = () =>
  supabase.from('departments').select('*').order('id')

export const getDepartmentsWithRefs = () =>
  supabase.from('departments').select('*, manager_ref:employees!manager_id(id,name), parent:departments!parent_department_id(id,name)').order('id')

export const createDepartment = (data) =>
  supabase.from('departments').insert(data).select().single()

export const updateDepartment = (id, data) =>
  supabase.from('departments').update(data).eq('id', id).select().single()

export const deleteDepartment = (id) =>
  supabase.from('departments').delete().eq('id', id)

// ── Employee FK-aware queries ─────────────────────────────
export const getEmployeesWithRefs = () =>
  supabase.from('employees').select('*, dept_ref:departments!department_id(id,name), store_ref:stores!store_id(id,name), supervisor_ref:employees!supervisor_id(id,name)').order('id')

// ── User Stores (multi-store assignment) ──────────────────
export const getEmployeeStores = (employeeId) =>
  supabase.from('user_stores').select('*, store:stores(*)').eq('employee_id', employeeId)

export const setEmployeeStores = async (employeeId, storeIds, primaryStoreId) => {
  await supabase.from('user_stores').delete().eq('employee_id', employeeId)
  if (!storeIds?.length) return
  const rows = storeIds.map(sid => ({
    employee_id: employeeId,
    store_id: sid,
    is_primary: sid === primaryStoreId,
  }))
  return supabase.from('user_stores').insert(rows)
}

// ── Department Manager History ────────────────────────────
export const getDeptManagerHistory = (deptId) =>
  supabase.from('department_manager_history').select('*').eq('department_id', deptId).order('effective_date', { ascending: false })

// ── LINE Groups ───────────────────────────────────────────
export const getLineGroups = () =>
  supabase.from('line_groups').select('*').order('id')

export const getLineMessages = (filters = {}) => {
  let q = supabase.from('line_messages').select('*').order('created_at', { ascending: false }).limit(100)
  if (filters.line_user_id) q = q.eq('line_user_id', filters.line_user_id)
  if (filters.group_id) q = q.eq('group_id', filters.group_id)
  return q
}

// ── Org Subscriptions ─────────────────────────────────────
export const getOrgSubscription = (orgId) =>
  supabase.from('org_subscriptions').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle()

export const getOrgPayments = (orgId) =>
  supabase.from('org_payments').select('*').eq('organization_id', orgId).order('created_at', { ascending: false })

// ── System ─────────────────────────────────────────────────
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

export const getAuditLogs = () =>
  supabase.from('audit_logs').select('*').order('time', { ascending: false })

export const createAuditLog = (data) =>
  supabase.from('audit_logs').insert(data)

export const getKpiData = () =>
  supabase.from('kpi_data').select('*').order('id')

// ── Purchase Management ──
export const getSuppliers = () =>
  supabase.from('suppliers').select('*').order('id')
export const createSupplier = (data) =>
  supabase.from('suppliers').insert(data).select().single()
export const updateSupplier = (id, data) =>
  supabase.from('suppliers').update(data).eq('id', id).select().single()
export const deleteSupplier = (id) =>
  supabase.from('suppliers').delete().eq('id', id)
export const getSupplierById = (id) =>
  supabase.from('suppliers').select('*').eq('id', id).single()

// ── Vendor Categories ──
export const getVendorCategories = () =>
  supabase.from('vendor_categories').select('*').order('id')
export const createVendorCategory = (data) =>
  supabase.from('vendor_categories').insert(data).select().single()
export const updateVendorCategory = (id, data) =>
  supabase.from('vendor_categories').update(data).eq('id', id).select().single()
export const deleteVendorCategory = (id) =>
  supabase.from('vendor_categories').delete().eq('id', id)

// ── Vendor Performance ──
export const getVendorPerformance = () =>
  supabase.from('vendor_performance').select('*').order('id', { ascending: false })
export const createVendorPerformance = (data) =>
  supabase.from('vendor_performance').insert(data).select().single()
export const updateVendorPerformance = (id, data) =>
  supabase.from('vendor_performance').update(data).eq('id', id).select().single()

// ── Vendor Onboarding ──
export const getVendorOnboarding = () =>
  supabase.from('vendor_onboarding').select('*').order('id', { ascending: false })
export const createVendorOnboarding = (data) =>
  supabase.from('vendor_onboarding').insert(data).select().single()
export const updateVendorOnboarding = (id, data) =>
  supabase.from('vendor_onboarding').update(data).eq('id', id).select().single()
export const deleteVendorOnboarding = (id) =>
  supabase.from('vendor_onboarding').delete().eq('id', id)

export const getPurchaseRequests = () =>
  supabase.from('purchase_requests').select('*').order('id', { ascending: false })
export const createPurchaseRequest = (data) =>
  supabase.from('purchase_requests').insert(data).select().single()
export const getPurchaseOrders = () =>
  supabase.from('purchase_orders').select('*').order('id', { ascending: false })
export const createPurchaseOrder = (data) =>
  supabase.rpc('secure_create_purchase_order', {
    p_po_number: data.po_number,
    p_supplier: data.supplier,
    p_items: data.items,
    p_total_amount: data.total_amount,
    p_tax: data.tax ?? 0,
    p_shipping: data.shipping ?? 0,
    p_payment_terms: data.payment_terms ?? null,
    p_expected_date: data.expected_date ?? null,
    p_pr_id: data.pr_id ?? null,
  })
export const getGoodsReceipts = () =>
  supabase.from('goods_receipts').select('*').order('id', { ascending: false })
export const createGoodsReceipt = (data) =>
  supabase.from('goods_receipts').insert(data).select().single()

// ── Procurement Pipeline & Workflow ──
export const getProcurementPipeline = () =>
  supabase.from('procurement_pipeline').select('*').order('created_at', { ascending: false })
export const createProcurementPipelineItem = (data) =>
  supabase.from('procurement_pipeline').insert(data).select().single()
export const updateProcurementPipelineItem = (id, data) =>
  supabase.from('procurement_pipeline').update(data).eq('id', id).select().single()
export const getProcurementWorkflows = () =>
  supabase.from('procurement_workflows').select('*').order('created_at', { ascending: false })
export const createProcurementWorkflow = (data) =>
  supabase.from('procurement_workflows').insert(data).select().single()
export const getProcurementWorkflowInstances = () =>
  supabase.from('procurement_workflow_instances').select('*').order('created_at', { ascending: false })

// ── Finance & Accounting ──
export const getAccounts = () =>
  supabase.from('accounts').select('*').order('code')
export const createAccount = (data) =>
  supabase.from('accounts').insert(data).select().single()
export const updateAccount = (id, data) =>
  supabase.from('accounts').update(data).eq('id', id).select().single()
export const deleteAccount = (id) =>
  supabase.from('accounts').delete().eq('id', id)
export const getJournalEntries = () =>
  supabase.from('journal_entries').select('*').order('id', { ascending: false })
export const getJournalLines = (entryId) =>
  supabase.from('journal_lines').select('*').eq('entry_id', entryId).order('id')
export const createJournalEntry = (data, lines = null) =>
  lines
    ? supabase.rpc('secure_create_journal_entry', {
        p_entry_date: data.entry_date,
        p_description: data.description,
        p_lines: lines,
        p_source: data.source ?? null,
        p_source_id: data.source_id ?? null,
        p_created_by: data.created_by ?? null,
      })
    : supabase.rpc('secure_create_journal_entry', {
        p_entry_date: data.entry_date,
        p_description: data.description,
        p_lines: [],
        p_source: data.source ?? null,
        p_source_id: data.source_id ?? null,
        p_created_by: data.created_by ?? null,
      })
export const createJournalLine = (data) =>
  supabase.rpc('secure_create_journal_line', {
    p_entry_id: data.entry_id,
    p_account_code: data.account_code,
    p_account_name: data.account_name,
    p_debit: data.debit ?? 0,
    p_credit: data.credit ?? 0,
    p_memo: data.memo ?? null,
    p_cost_center: data.cost_center ?? null,
  })
export const getAccountsReceivable = () =>
  supabase.from('accounts_receivable').select('*').order('id', { ascending: false })
export const createAccountReceivable = (data) =>
  supabase.from('accounts_receivable').insert(data).select().single()
export const getAccountsPayable = () =>
  supabase.from('accounts_payable').select('*').order('id', { ascending: false })
export const createAccountPayable = (data) =>
  supabase.from('accounts_payable').insert(data).select().single()

// ── Manufacturing & QM ──
export const getBOMs = () =>
  supabase.from('bom').select('*').order('id')
export const createBOM = (data) =>
  supabase.from('bom').insert(data).select().single()
export const getMRPResults = () =>
  supabase.from('mrp_results').select('*').order('id', { ascending: false })
export const createMRPResult = (data) =>
  supabase.from('mrp_results').insert(data).select().single()
export const getQualityInspections = () =>
  supabase.from('quality_inspections').select('*').order('id', { ascending: false })
export const createQualityInspection = (data) =>
  supabase.from('quality_inspections').insert(data).select().single()

// ── Enterprise Features ──
export const getSupplierContracts = () =>
  supabase.from('supplier_contracts').select('*').order('id', { ascending: false })
export const createSupplierContract = (data) =>
  supabase.from('supplier_contracts').insert(data).select().single()
export const getBudgets = () =>
  supabase.from('budgets').select('*').order('id')
export const createBudget = (data) =>
  supabase.from('budgets').insert(data).select().single()
export const updateBudget = (id, data) =>
  supabase.from('budgets').update(data).eq('id', id).select().single()
export const getBankTransactions = () =>
  supabase.from('bank_transactions').select('*').order('transaction_date', { ascending: false })
export const getManufacturingOrders = () =>
  supabase.from('manufacturing_orders').select('*').order('id', { ascending: false })
export const createManufacturingOrder = (data) =>
  supabase.from('manufacturing_orders').insert(data).select().single()
export const updateManufacturingOrder = (id, data) =>
  supabase.from('manufacturing_orders').update(data).eq('id', id).select().single()
export const getInventoryLots = () =>
  supabase.from('inventory_lots').select('*').order('id', { ascending: false })
export const getStockCounts = () =>
  supabase.from('stock_counts').select('*').order('id', { ascending: false })
export const createStockCount = (data) =>
  supabase.from('stock_counts').insert(data).select().single()
export const getInsuranceSettings = () =>
  supabase.from('insurance_settings').select('*').order('id')

// ── Sales & POS ──
export const getQuotations = () =>
  supabase.from('quotations').select('*').order('id', { ascending: false })
export const createQuotation = (data) =>
  supabase.from('quotations').insert(data).select().single()
export const updateQuotation = (id, data) =>
  supabase.from('quotations').update(data).eq('id', id).select().single()
export const getSalesOrders = () =>
  supabase.from('sales_orders').select('*').order('id', { ascending: false })
export const createSalesOrder = (data) =>
  supabase.rpc('secure_create_sales_order', {
    p_order_number: data.order_number,
    p_customer: data.customer,
    p_items: data.items,
    p_subtotal: data.subtotal,
    p_discount: data.discount ?? 0,
    p_tax: data.tax ?? 0,
    p_total: data.total ?? null,
    p_notes: data.notes ?? null,
    p_created_by: data.created_by ?? null,
    p_quote_id: data.quote_id ?? null,
  })
export const getPromotions = () =>
  supabase.from('promotions').select('*').order('id', { ascending: false })
export const createPromotion = (data) =>
  supabase.from('promotions').insert(data).select().single()
export const getPOSTransactions = () =>
  supabase.from('pos_transactions').select('*').order('id', { ascending: false })
export const createPOSTransaction = (data) =>
  supabase.rpc('secure_create_pos_transaction', {
    p_store: data.store,
    p_cashier: data.cashier,
    p_items: data.items,
    p_subtotal: data.subtotal,
    p_discount: data.discount ?? 0,
    p_tax: data.tax ?? 0,
    p_total: data.total ?? null,
    p_payment_method: data.payment_method ?? '現金',
    p_payment_ref: data.payment_ref ?? null,
    p_member_id: data.member_id ?? null,
    p_points_earned: data.points_earned ?? 0,
    p_points_used: data.points_used ?? 0,
    p_invoice_number: data.invoice_number ?? null,
    p_invoice_carrier: data.invoice_carrier ?? null,
  })
export const getPOSShifts = () =>
  supabase.from('pos_shifts').select('*').order('id', { ascending: false })
export const createPOSShift = (data) =>
  supabase.from('pos_shifts').insert(data).select().single()
export const getReturns = () =>
  supabase.from('returns').select('*').order('id', { ascending: false })
export const createReturn = (data) =>
  supabase.from('returns').insert(data).select().single()

// ── Logistics, Membership, E-Invoice ──
export const getShipments = () =>
  supabase.from('shipments').select('*').order('id', { ascending: false })
export const createShipment = (data) =>
  supabase.from('shipments').insert(data).select().single()
export const updateShipment = (id, data) =>
  supabase.from('shipments').update(data).eq('id', id).select().single()
export const getMembers = () =>
  supabase.from('members').select('*').order('id', { ascending: false })
export const createMember = (data) =>
  supabase.from('members').insert(data).select().single()
export const updateMember = (id, data) =>
  supabase.from('members').update(data).eq('id', id).select().single()
export const getPointTransactions = (memberId) =>
  supabase.from('point_transactions').select('*').eq('member_id', memberId).order('id', { ascending: false })
export const getAllPointTransactions = () =>
  supabase.from('point_transactions').select('*').order('id', { ascending: false })
export const createPointTransaction = (data) =>
  supabase.from('point_transactions').insert(data).select().single()

// ── Referral Codes ──
export const getReferralCodes = () =>
  supabase.from('referral_codes').select('*').order('id', { ascending: false })
export const getReferralCodeByMember = (memberId) =>
  supabase.from('referral_codes').select('*').eq('member_id', memberId).eq('status', '有效').maybeSingle()
export const getReferralCodeByCode = (code) =>
  supabase.from('referral_codes').select('*').eq('code', code).eq('status', '有效').maybeSingle()
export const createReferralCode = (data) =>
  supabase.from('referral_codes').insert(data).select().single()
export const updateReferralCode = (id, data) =>
  supabase.from('referral_codes').update(data).eq('id', id).select().single()

// ── Referral Redemptions ──
export const getReferralRedemptions = (referralCodeId) =>
  supabase.from('referral_redemptions').select('*').eq('referral_code_id', referralCodeId).order('id', { ascending: false })
export const getAllReferralRedemptions = () =>
  supabase.from('referral_redemptions').select('*').order('id', { ascending: false })
export const getReferralRedemptionsByReferee = (refereeId) =>
  supabase.from('referral_redemptions').select('*').eq('referee_id', refereeId).maybeSingle()
export const createReferralRedemption = (data) =>
  supabase.from('referral_redemptions').insert(data).select().single()
export const getInvoices = () =>
  supabase.from('invoices').select('*').order('id', { ascending: false })
export const createInvoice = (data) =>
  supabase.from('invoices').insert(data).select().single()
export const updateInvoice = (id, data) =>
  supabase.from('invoices').update(data).eq('id', id).select().single()

// ── Fixed Assets ──
export const getFixedAssets = () =>
  supabase.from('fixed_assets').select('*').order('id')
export const createFixedAsset = (data) =>
  supabase.from('fixed_assets').insert(data).select().single()
export const updateFixedAsset = (id, data) =>
  supabase.from('fixed_assets').update(data).eq('id', id).select().single()
export const deleteFixedAsset = (id) =>
  supabase.from('fixed_assets').delete().eq('id', id)

// ── Cost Centers ──
export const getCostCenters = () =>
  supabase.from('cost_centers').select('*').order('code')
export const createCostCenter = (data) =>
  supabase.from('cost_centers').insert(data).select().single()
export const updateCostCenter = (id, data) =>
  supabase.from('cost_centers').update(data).eq('id', id).select().single()
export const deleteCostCenter = (id) =>
  supabase.from('cost_centers').delete().eq('id', id)

// ── Journal Entry Updates ──
export const updateJournalEntry = (id, data) =>
  supabase.rpc('secure_update_journal_entry', { p_id: id, p_data: data })
export const getAllJournalLines = () =>
  supabase.from('journal_lines').select('*').order('id')
// 建議改用 createJournalEntry(data, lines) 一次建立分錄+明細（原子操作）
export const batchCreateJournalLines = (lines) =>
  supabase.rpc('secure_batch_create_journal_lines', { p_lines: lines })

// ── Inventory Costing ──
export const getInventoryTransactions = (sku) => {
  const q = supabase.from('inventory_transactions').select('*').order('date')
  return sku ? q.eq('sku', sku) : q
}
export const getStockLevels = () =>
  supabase.from('stock_levels').select('*').order('id')

// ── Enhanced Purchase ──
export const updatePurchaseOrder = (id, data) =>
  supabase.from('purchase_orders').update(data).eq('id', id).select().single()
export const updateGoodsReceipt = (id, data) =>
  supabase.from('goods_receipts').update(data).eq('id', id).select().single()

// ── Campaign / Marketing ──
export const getCampaigns = () =>
  supabase.from('campaigns').select('*').order('id', { ascending: false })
export const createCampaign = (data) =>
  supabase.from('campaigns').insert(data).select().single()
export const updateCampaign = (id, data) =>
  supabase.from('campaigns').update(data).eq('id', id).select().single()

// ── Bank Reconciliation ──
export const updateBankTransaction = (id, data) =>
  supabase.from('bank_transactions').update(data).eq('id', id).select().single()

// ── POS Enhancements ──
export const updatePOSTransaction = (id, data) =>
  supabase.from('pos_transactions').update(data).eq('id', id).select().single()
export const updatePOSShift = (id, data) =>
  supabase.from('pos_shifts').update(data).eq('id', id).select().single()

// ── Salary Updates ──
export const updateSalaryRecord = (id, data) =>
  supabase.rpc('secure_update_salary', { p_id: id, p_data: data })

// ── SKU Updates ──
export const updateSKU = (id, data) =>
  supabase.from('skus').update(data).eq('id', id).select().single()
export const getSKUs = () =>
  supabase.from('skus').select('*').order('id')

// ── Inventory Adjustments ──
export const createInventoryAdjustment = (data) =>
  supabase.rpc('secure_create_inventory_adjustment', {
    p_sku_code: data.sku_code,
    p_sku_name: data.sku_name ?? null,
    p_bin_code: data.bin_code ?? null,
    p_quantity: data.quantity,
    p_reason: data.reason,
    p_operator: data.operator,
    p_unit_cost: data.unit_cost ?? 0,
  })

// ── Sales Order Updates ──
export const updateSalesOrder = (id, data) =>
  supabase.from('sales_orders').update(data).eq('id', id).select().single()

// ── Quotation Line Items ──
export const getQuotationLines = (quotationId) =>
  supabase.from('quotation_lines').select('*, skus(code, name, unit)').eq('quotation_id', quotationId).order('created_at')
export const createQuotationLine = (data) =>
  supabase.from('quotation_lines').insert(data).select().single()
export const updateQuotationLine = (id, data) =>
  supabase.from('quotation_lines').update(data).eq('id', id).select().single()
export const deleteQuotationLine = (id) =>
  supabase.from('quotation_lines').delete().eq('id', id)
export const batchCreateQuotationLines = (lines) =>
  supabase.from('quotation_lines').insert(lines).select()

// ── Sales Order Line Items ──
export const getSalesOrderLines = (orderId) =>
  supabase.from('sales_order_lines').select('*, skus(code, name, unit)').eq('order_id', orderId).order('created_at')
export const createSalesOrderLine = (data) =>
  supabase.from('sales_order_lines').insert(data).select().single()
export const updateSalesOrderLine = (id, data) =>
  supabase.from('sales_order_lines').update(data).eq('id', id).select().single()
export const deleteSalesOrderLine = (id) =>
  supabase.from('sales_order_lines').delete().eq('id', id)
export const batchCreateSalesOrderLines = (lines) =>
  supabase.from('sales_order_lines').insert(lines).select()

// ── Invoice Line Items ──
export const getInvoiceLines = (invoiceId) =>
  supabase.from('invoice_lines').select('*, skus(code, name, unit)').eq('invoice_id', invoiceId).order('created_at')
export const createInvoiceLine = (data) =>
  supabase.from('invoice_lines').insert(data).select().single()
export const updateInvoiceLine = (id, data) =>
  supabase.from('invoice_lines').update(data).eq('id', id).select().single()
export const deleteInvoiceLine = (id) =>
  supabase.from('invoice_lines').delete().eq('id', id)
export const batchCreateInvoiceLines = (lines) =>
  supabase.from('invoice_lines').insert(lines).select()

// ── Bulk Import (文中 Connector) ──────────────────────────
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

// ── Inventory Cost Layers ──
export const getInventoryCostLayers = (skuId) => {
  const q = supabase.from('inventory_cost_layers').select('*, skus(code, name)').order('receipt_date', { ascending: true })
  return skuId ? q.eq('sku_id', skuId) : q
}
export const getActiveCostLayers = (skuId, warehouseId) => {
  let q = supabase.from('inventory_cost_layers').select('*').gt('quantity_remaining', 0).order('receipt_date', { ascending: true })
  if (skuId) q = q.eq('sku_id', skuId)
  if (warehouseId) q = q.eq('warehouse_id', warehouseId)
  return q
}
export const createInventoryCostLayer = (data) =>
  supabase.from('inventory_cost_layers').insert(data).select().single()
export const updateInventoryCostLayer = (id, data) =>
  supabase.from('inventory_cost_layers').update(data).eq('id', id).select().single()

// ── Inventory Valuations ──
export const getInventoryValuations = (costingMethod) => {
  const q = supabase.from('inventory_valuations').select('*, skus(code, name)').order('valuation_date', { ascending: false })
  return costingMethod ? q.eq('costing_method', costingMethod) : q
}
export const createInventoryValuation = (data) =>
  supabase.from('inventory_valuations').insert(data).select().single()
export const batchCreateInventoryValuations = (rows) =>
  supabase.from('inventory_valuations').insert(rows).select()

// ── BOM Lines (結構化 BOM 明細) ──
export const getBOMLines = (bomId) =>
  supabase.from('bom_lines').select('*, skus(id, code, name, unit, cost)').eq('bom_id', bomId).order('id')

export const createBOMLine = (data) =>
  supabase.from('bom_lines').insert(data).select().single()

export const updateBOMLine = (id, data) =>
  supabase.from('bom_lines').update(data).eq('id', id).select().single()

export const deleteBOMLine = (id) =>
  supabase.from('bom_lines').delete().eq('id', id)

// ── MRP Results (批次儲存) ──
export const saveMRPResults = (results) =>
  supabase.from('mrp_results').insert(results).select()

// ── BOM Update ──
export const updateBOM = (id, data) =>
  supabase.from('bom').update(data).eq('id', id).select().single()

// ── Work Centers ──
export const getWorkCenters = () =>
  supabase.from('work_centers').select('*').order('code')
export const createWorkCenter = (data) =>
  supabase.from('work_centers').insert(data).select().single()
export const updateWorkCenter = (id, data) =>
  supabase.from('work_centers').update(data).eq('id', id).select().single()
export const deleteWorkCenter = (id) =>
  supabase.from('work_centers').delete().eq('id', id)

// ── Routings ──
export const getRoutings = (bomId) => {
  const q = supabase.from('routings').select('*, work_centers(code, name)').order('step_number')
  return bomId ? q.eq('bom_id', bomId) : q
}
export const createRouting = (data) =>
  supabase.from('routings').insert(data).select().single()
export const updateRouting = (id, data) =>
  supabase.from('routings').update(data).eq('id', id).select().single()
export const deleteRouting = (id) =>
  supabase.from('routings').delete().eq('id', id)

// ── Price Lists & Rules ──
export const getPriceLists = () =>
  supabase.from('price_lists').select('*').order('id')
export const createPriceList = (data) =>
  supabase.from('price_lists').insert(data).select().single()
export const updatePriceList = (id, data) =>
  supabase.from('price_lists').update(data).eq('id', id).select().single()
export const deletePriceList = (id) =>
  supabase.from('price_lists').delete().eq('id', id)
export const getPriceRules = (priceListId) => {
  const q = supabase.from('price_rules').select('*, skus(code, name)').order('priority', { ascending: false })
  return priceListId ? q.eq('price_list_id', priceListId) : q
}
export const createPriceRule = (data) =>
  supabase.from('price_rules').insert(data).select().single()
export const updatePriceRule = (id, data) =>
  supabase.from('price_rules').update(data).eq('id', id).select().single()
export const deletePriceRule = (id) =>
  supabase.from('price_rules').delete().eq('id', id)

// ── Blanket Orders ──
export const getBlanketOrders = () =>
  supabase.from('blanket_orders').select('*, suppliers(name)').order('id', { ascending: false })
export const createBlanketOrder = (data) =>
  supabase.from('blanket_orders').insert(data).select().single()
export const updateBlanketOrder = (id, data) =>
  supabase.from('blanket_orders').update(data).eq('id', id).select().single()
export const deleteBlanketOrder = (id) =>
  supabase.from('blanket_orders').delete().eq('id', id)
export const getBlanketOrderReleases = (boId) =>
  supabase.from('blanket_order_releases').select('*, purchase_orders(po_number)').eq('blanket_order_id', boId).order('release_date', { ascending: false })
export const createBlanketOrderRelease = (data) =>
  supabase.from('blanket_order_releases').insert(data).select().single()

// ── Customer Segments ──
export const getCustomerSegments = () =>
  supabase.from('customer_segments').select('*').order('id')
export const createCustomerSegment = (data) =>
  supabase.from('customer_segments').insert(data).select().single()
export const updateCustomerSegment = (id, data) =>
  supabase.from('customer_segments').update(data).eq('id', id).select().single()
export const deleteCustomerSegment = (id) =>
  supabase.from('customer_segments').delete().eq('id', id)

// ── Tenants ──
export const getTenants = () =>
  supabase.from('tenants').select('*').order('id')
export const createTenantRecord = (data) =>
  supabase.from('tenants').insert(data).select().single()
export const updateTenantRecord = (id, data) =>
  supabase.from('tenants').update(data).eq('id', id).select().single()
export const deleteTenantRecord = (id) =>
  supabase.from('tenants').delete().eq('id', id)

// ── Warehouses ──
export const getWarehouses = () =>
  supabase.from('warehouses').select('*').order('code')
export const createWarehouse = (data) =>
  supabase.from('warehouses').insert(data).select().single()
export const updateWarehouse = (id, data) =>
  supabase.from('warehouses').update(data).eq('id', id).select().single()
export const deleteWarehouse = (id) =>
  supabase.from('warehouses').delete().eq('id', id)

// ── Warehouse Zones ──
export const getWarehouseZones = (warehouseId) => {
  const q = supabase.from('warehouse_zones').select('*').order('code')
  return warehouseId ? q.eq('warehouse_id', warehouseId) : q
}
export const createWarehouseZone = (data) =>
  supabase.from('warehouse_zones').insert(data).select().single()
export const deleteWarehouseZone = (id) =>
  supabase.from('warehouse_zones').delete().eq('id', id)

// ── Warehouse Bins ──
export const getWarehouseBins = (zoneId) => {
  const q = supabase.from('warehouse_bins').select('*').order('code')
  return zoneId ? q.eq('zone_id', zoneId) : q
}
export const createWarehouseBin = (data) =>
  supabase.from('warehouse_bins').insert(data).select().single()
export const updateWarehouseBin = (id, data) =>
  supabase.from('warehouse_bins').update(data).eq('id', id).select().single()
export const deleteWarehouseBin = (id) =>
  supabase.from('warehouse_bins').delete().eq('id', id)

// ── Approval Rules & Requests ──
export const getApprovalRules = (module) => {
  const q = supabase.from('approval_rules').select('*').order('approval_order')
  return module ? q.eq('module', module) : q
}
export const createApprovalRule = (data) =>
  supabase.from('approval_rules').insert(data).select().single()
export const updateApprovalRule = (id, data) =>
  supabase.from('approval_rules').update(data).eq('id', id).select().single()
export const deleteApprovalRule = (id) =>
  supabase.from('approval_rules').delete().eq('id', id)
export const getApprovalRequests = (status) => {
  const q = supabase.from('approval_requests').select('*').order('created_at', { ascending: false })
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

// ── Subcontracts ──
export const getSubcontracts = () =>
  supabase.from('subcontracts').select('*, suppliers(name)').order('id', { ascending: false })
export const createSubcontract = (data) =>
  supabase.from('subcontracts').insert(data).select().single()
export const updateSubcontract = (id, data) =>
  supabase.from('subcontracts').update(data).eq('id', id).select().single()
export const deleteSubcontract = (id) =>
  supabase.from('subcontracts').delete().eq('id', id)

// ── Pick/Pack Lists ──
export const getPickLists = () =>
  supabase.from('pick_lists').select('*').order('created_at', { ascending: false })
export const createPickList = (data) =>
  supabase.from('pick_lists').insert(data).select().single()
export const updatePickList = (id, data) =>
  supabase.from('pick_lists').update(data).eq('id', id).select().single()
export const getPackLists = () =>
  supabase.from('pack_lists').select('*, pick_lists(pick_number)').order('created_at', { ascending: false })
export const createPackList = (data) =>
  supabase.from('pack_lists').insert(data).select().single()
export const updatePackList = (id, data) =>
  supabase.from('pack_lists').update(data).eq('id', id).select().single()

// ── Accounting Periods ──
export const getAccountingPeriods = () =>
  supabase.from('accounting_periods').select('*').order('period')
export const createAccountingPeriod = (data) =>
  supabase.from('accounting_periods').insert(data).select().single()
export const updateAccountingPeriod = (id, data) =>
  supabase.from('accounting_periods').update(data).eq('id', id).select().single()

// ── Training / LMS ──
export const getTrainingCourses = () =>
  supabase.from('training_courses').select('*').order('id', { ascending: false })
export const createTrainingCourse = (data) =>
  supabase.from('training_courses').insert(data).select().single()
export const updateTrainingCourse = (id, data) =>
  supabase.from('training_courses').update(data).eq('id', id).select().single()
export const deleteTrainingCourse = (id) =>
  supabase.from('training_courses').delete().eq('id', id)
export const getTrainingEnrollments = (courseId) => {
  const q = supabase.from('training_enrollments').select('*').order('id')
  return courseId ? q.eq('course_id', courseId) : q
}
export const createTrainingEnrollment = (data) =>
  supabase.from('training_enrollments').insert(data).select().single()
export const updateTrainingEnrollment = (id, data) =>
  supabase.from('training_enrollments').update(data).eq('id', id).select().single()

// ─�� Warehouse Transfers ──
export const getWarehouseTransfers = () =>
  supabase.from('warehouse_transfers').select('*').order('id', { ascending: false })
export const createWarehouseTransfer = (data) =>
  supabase.from('warehouse_transfers').insert(data).select().single()
export const updateWarehouseTransfer = (id, data) =>
  supabase.from('warehouse_transfers').update(data).eq('id', id).select().single()

// ── Commission ──
export const getCommissionRules = () =>
  supabase.from('commission_rules').select('*').order('id')
export const createCommissionRule = (data) =>
  supabase.from('commission_rules').insert(data).select().single()
export const updateCommissionRule = (id, data) =>
  supabase.from('commission_rules').update(data).eq('id', id).select().single()
export const deleteCommissionRule = (id) =>
  supabase.from('commission_rules').delete().eq('id', id)
export const getCommissionRecords = (period) => {
  const q = supabase.from('commission_records').select('*').order('id', { ascending: false })
  return period ? q.eq('period', period) : q
}
export const createCommissionRecord = (data) =>
  supabase.from('commission_records').insert(data).select().single()
export const updateCommissionRecord = (id, data) =>
  supabase.from('commission_records').update(data).eq('id', id).select().single()

// ── Carrier Configs ──
export const getCarrierConfigs = () =>
  supabase.from('carrier_configs').select('*').order('id')
export const createCarrierConfig = (data) =>
  supabase.from('carrier_configs').insert(data).select().single()
export const updateCarrierConfig = (id, data) =>
  supabase.from('carrier_configs').update(data).eq('id', id).select().single()

// ── Super Admin: Cross-tenant operations ──
export const getAllEmployees = () =>
  supabase.from('employees').select('*, tenants(name)').order('id')
export const updateEmployeeRole = (id, data) =>
  supabase.from('employees').update(data).eq('id', id).select().single()
export const getTenantModuleConfig = (tenantId) =>
  supabase.from('tenants').select('id, name, features, plan, status, max_users').eq('id', tenantId).single()
export const updateTenantModules = (id, features) =>
  supabase.from('tenants').update({ features }).eq('id', id).select().single()
export const getTenantEmployees = (tenantId) =>
  supabase.from('employees').select('*').eq('tenant_id', tenantId).order('id')
export const getRoles = () =>
  supabase.from('roles').select('*').order('level')
export const getPermissions = () =>
  supabase.from('permissions').select('*').order('module, code')
export const getRolePermissions = (roleId) =>
  supabase.from('role_permissions').select('*, permissions(*)').eq('role_id', roleId)
export const updateRolePermissions = (roleId, permissionIds) =>
  supabase.rpc('secure_update_role_permissions', {
    p_role_id: roleId,
    p_permission_ids: permissionIds,
  })

// ── System Logs (Super Admin) ──
export const getSystemLogs = ({ limit = 200, offset = 0, tenantId, level, module, action, from, to } = {}) => {
  let q = supabase.from('system_logs').select('*, tenants(name)', { count: 'exact' })
  if (tenantId) q = q.eq('tenant_id', tenantId)
  if (level) q = q.eq('level', level)
  if (module) q = q.eq('module', module)
  if (action) q = q.eq('action', action)
  if (from) q = q.gte('created_at', from)
  if (to) q = q.lte('created_at', to)
  return q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
}

// ── Error Logs (Super Admin) ──
export const getErrorLogs = ({ limit = 200, offset = 0, tenantId, level, module, resolved, from, to } = {}) => {
  let q = supabase.from('error_logs').select('*, tenants(name)', { count: 'exact' })
  if (tenantId) q = q.eq('tenant_id', tenantId)
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

// ── User Activity (Super Admin) ──
export const getUserActivity = ({ limit = 200, offset = 0, tenantId, userName, action, module, from, to } = {}) => {
  let q = supabase.from('user_activity').select('*, tenants(name)', { count: 'exact' })
  if (tenantId) q = q.eq('tenant_id', tenantId)
  if (userName) q = q.eq('user_name', userName)
  if (action) q = q.eq('action', action)
  if (module) q = q.eq('module', module)
  if (from) q = q.gte('created_at', from)
  if (to) q = q.lte('created_at', to)
  return q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
}

// ── CRM Forms ──────────────────────────────────────────────
export const getCRMForms = () =>
  supabase.from('crm_forms').select('*').order('created_at', { ascending: false })

export const createCRMForm = (data) =>
  supabase.from('crm_forms').insert(data).select().single()

export const updateCRMForm = (id, data) =>
  supabase.from('crm_forms').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()

export const deleteCRMForm = (id) =>
  supabase.from('crm_forms').delete().eq('id', id)

// ── CRM Form Submissions ──────────────────────────────────
export const getCRMFormSubmissions = (formId) => {
  let q = supabase.from('crm_form_submissions').select('*').order('submitted_at', { ascending: false })
  return formId ? q.eq('form_id', formId) : q
}

export const createCRMFormSubmission = (data) =>
  supabase.from('crm_form_submissions').insert(data).select().single()

// ── CRM Territories ───────────────────────────────────────
export const getCRMTerritories = () =>
  supabase.from('crm_territories').select('*').order('id')

export const createCRMTerritory = (data) =>
  supabase.from('crm_territories').insert(data).select().single()

export const updateCRMTerritory = (id, data) =>
  supabase.from('crm_territories').update(data).eq('id', id).select().single()

export const deleteCRMTerritory = (id) =>
  supabase.from('crm_territories').delete().eq('id', id)

// ── CRM Leads ─────────────────────────────────────────────
export const getCRMLeads = () =>
  supabase.from('crm_leads').select('*').order('created_at', { ascending: false })

export const createCRMLead = (data) =>
  supabase.from('crm_leads').insert(data).select().single()

export const updateCRMLead = (id, data) =>
  supabase.from('crm_leads').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()

export const deleteCRMLead = (id) =>
  supabase.from('crm_leads').delete().eq('id', id)

// ── CRM Activities ────────────────────────────────────────
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

// ── CRM Notes ─────────────────────────────────────────────
export const getCRMNotes = (entityType, entityId) =>
  supabase.from('crm_notes').select('*').eq('entity_type', entityType).eq('entity_id', entityId).order('is_pinned', { ascending: false }).order('created_at', { ascending: false })

export const createCRMNote = (data) =>
  supabase.from('crm_notes').insert(data).select().single()

export const updateCRMNote = (id, data) =>
  supabase.from('crm_notes').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()

export const deleteCRMNote = (id) =>
  supabase.from('crm_notes').delete().eq('id', id)

// ── CRM Attachments ───────────────────────────────────────
export const getCRMAttachments = (entityType, entityId) =>
  supabase.from('crm_attachments').select('*').eq('entity_type', entityType).eq('entity_id', entityId).order('created_at', { ascending: false })

export const createCRMAttachment = (data) =>
  supabase.from('crm_attachments').insert(data).select().single()

export const deleteCRMAttachment = (id) =>
  supabase.from('crm_attachments').delete().eq('id', id)

// ── Ticket History ─────────────────────────────────────────
export const getTicketHistory = (ticketId) =>
  supabase.from('ticket_history').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: false })

export const createTicketHistoryEntry = (data) =>
  supabase.from('ticket_history').insert(data).select().single()

// ── Custom SLA Policies ───────────────────────────────────
export const getSLAPolicies = () =>
  supabase.from('sla_policies').select('*').order('id')

export const createSLAPolicy = (data) =>
  supabase.from('sla_policies').insert(data).select().single()

export const updateSLAPolicy = (id, data) =>
  supabase.from('sla_policies').update(data).eq('id', id).select().single()

export const deleteSLAPolicy = (id) =>
  supabase.from('sla_policies').delete().eq('id', id)

// ── CRM Workflows ─────────────────────────────────────────
export const getCRMWorkflows = () =>
  supabase.from('crm_workflows').select('*').order('created_at', { ascending: false })

export const createCRMWorkflow = (data) =>
  supabase.from('crm_workflows').insert(data).select().single()

export const updateCRMWorkflow = (id, data) =>
  supabase.from('crm_workflows').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()

export const deleteCRMWorkflow = (id) =>
  supabase.from('crm_workflows').delete().eq('id', id)

// ── Attrition Risk ────────────────────────────────────────
export const getAttritionSnapshots = (date) => {
  const q = supabase.from('attrition_risk_snapshots').select('*').order('risk_score', { ascending: false })
  return date ? q.eq('snapshot_date', date) : q
}

export const upsertAttritionSnapshot = (data) =>
  supabase.from('attrition_risk_snapshots').upsert(data, { onConflict: 'employee,snapshot_date' }).select().single()

// ── Compensation Bands ────────────────────────────────────
export const getCompensationBands = () =>
  supabase.from('compensation_bands').select('*').order('dept')

export const createCompensationBand = (data) =>
  supabase.from('compensation_bands').insert(data).select().single()

export const updateCompensationBand = (id, data) =>
  supabase.from('compensation_bands').update(data).eq('id', id).select().single()

export const deleteCompensationBand = (id) =>
  supabase.from('compensation_bands').delete().eq('id', id)

// ── Engagement Surveys ────────────────────────────────────
export const getEngagementSurveys = () =>
  supabase.from('engagement_surveys').select('*').order('created_at', { ascending: false })

export const createEngagementSurvey = (data) =>
  supabase.from('engagement_surveys').insert(data).select().single()

export const updateEngagementSurvey = (id, data) =>
  supabase.from('engagement_surveys').update(data).eq('id', id).select().single()

export const deleteEngagementSurvey = (id) =>
  supabase.from('engagement_surveys').delete().eq('id', id)

export const getEngagementResponses = (surveyId) =>
  supabase.from('engagement_responses').select('*').eq('survey_id', surveyId).order('submitted_at', { ascending: false })

export const submitEngagementResponse = (data) =>
  supabase.from('engagement_responses').insert(data).select().single()

// ── Probation ─────────────────────────────────────────────
export const getProbationRecords = () =>
  supabase.from('probation_records').select('*').order('end_date')

export const createProbationRecord = (data) =>
  supabase.from('probation_records').insert(data).select().single()

export const updateProbationRecord = (id, data) =>
  supabase.from('probation_records').update(data).eq('id', id).select().single()

// ── Approval Delegation ───────────────────────────────────
export const getApprovalDelegations = () =>
  supabase.from('approval_delegations').select('*').order('start_date', { ascending: false })

export const createApprovalDelegation = (data) =>
  supabase.from('approval_delegations').insert(data).select().single()

export const updateApprovalDelegation = (id, data) =>
  supabase.from('approval_delegations').update(data).eq('id', id).select().single()

export const deleteApprovalDelegation = (id) =>
  supabase.from('approval_delegations').delete().eq('id', id)

// ── Tax Withholding (扣繳憑單) ────────────────────────────
export const getTaxWithholdingRecords = (year) => {
  const q = supabase.from('tax_withholding_records').select('*').order('employee')
  return year ? q.eq('year', year) : q
}

export const upsertTaxWithholding = (data) =>
  supabase.from('tax_withholding_records').upsert(data, { onConflict: 'employee,year' }).select().single()

// ── Employee Personality ───────────────────────────────────
export const getEmployeePersonality = (employeeId) =>
  supabase.from('employee_personality_profiles').select('*').eq('employee_id', employeeId).maybeSingle()

export const upsertEmployeePersonality = (data) =>
  supabase.from('employee_personality_profiles').upsert(data, { onConflict: 'employee_id' }).select().single()

// ── Employee Development Plans ────────────────────────────
export const getEmployeeDevelopmentPlans = (employeeId) =>
  supabase.from('employee_development_plans').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false })

export const createDevelopmentPlan = (data) =>
  supabase.from('employee_development_plans').insert(data).select().single()

export const updateDevelopmentPlan = (id, data) =>
  supabase.from('employee_development_plans').update(data).eq('id', id).select().single()

export const deleteDevelopmentPlan = (id) =>
  supabase.from('employee_development_plans').delete().eq('id', id)

// ── Benefit Policies ──────────────────────────────────────
export const getBenefitPolicies = (filters = {}) => {
  let q = supabase.from('benefit_policies').select('*, stores(name), employees(name)').order('id', { ascending: false })
  if (filters.storeId) q = q.eq('store_id', filters.storeId)
  if (filters.storeId === null) q = q.is('store_id', null)
  if (filters.category) q = q.eq('category', filters.category)
  if (filters.isActive !== undefined) q = q.eq('is_active', filters.isActive)
  return q
}
export const createBenefitPolicy = (data) =>
  supabase.from('benefit_policies').insert(data).select().single()
export const updateBenefitPolicy = (id, data) =>
  supabase.from('benefit_policies').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()
export const deleteBenefitPolicy = (id) =>
  supabase.from('benefit_policies').delete().eq('id', id)

// ── Bonus Records ─────────────────────────────────────────
export const getBonusRecords = (period) => {
  let q = supabase.from('bonus_records').select('*').order('id', { ascending: false })
  return period ? q.eq('period', period) : q
}
export const createBonusRecord = (data) =>
  supabase.from('bonus_records').insert(data).select().single()
export const updateBonusRecord = (id, data) =>
  supabase.from('bonus_records').update(data).eq('id', id).select().single()

// ── Bonus Settings ────────────────────────────────────────
export const getBonusSettings = (storeId) => {
  let q = supabase.from('bonus_settings').select('*').eq('is_active', true).order('id')
  return storeId ? q.eq('store_id', storeId) : q
}
export const createBonusSetting = (data) =>
  supabase.from('bonus_settings').insert(data).select().single()
export const updateBonusSetting = (id, data) =>
  supabase.from('bonus_settings').update(data).eq('id', id).select().single()
export const deleteBonusSetting = (id) =>
  supabase.from('bonus_settings').delete().eq('id', id)
