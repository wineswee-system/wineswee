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

// ── Leave Requests ─────────────────────────────────────────
export const getLeaveRequests = () =>
  supabase.from('leave_requests').select('*').order('id')

export const createLeaveRequest = (data) =>
  supabase.from('leave_requests').insert(data).select().single()

export const updateLeaveStatus = (id, status, approver, rejectReason) =>
  supabase.from('leave_requests').update({ status, approver, reject_reason: rejectReason || null }).eq('id', id).select().single()

export const deleteLeaveRequest = (id) =>
  supabase.from('leave_requests').delete().eq('id', id)

// ── Overtime ───────────────────────────────────────────────
export const getOvertimeRequests = () =>
  supabase.from('overtime_requests').select('*').order('id')

export const createOvertimeRequest = (data) =>
  supabase.from('overtime_requests').insert(data).select().single()

export const updateOvertimeStatus = (id, status, rejectReason) =>
  supabase.from('overtime_requests').update({ status, reject_reason: rejectReason || null }).eq('id', id).select().single()

// ── Salary ─────────────────────────────────────────────────
export const getSalaryRecords = (month) => {
  const q = supabase.from('salary_records').select('*').order('id')
  return month ? q.eq('month', month) : q
}

export const upsertSalaryRecord = (data) =>
  supabase.from('salary_records').upsert(data).select().single()

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

// ── Tasks ──────────────────────────────────────────────────
export const getTasks = () =>
  supabase.from('tasks').select('*').order('id')

export const createTask = (data) =>
  supabase.from('tasks').insert(data).select().single()

export const updateTask = (id, data) =>
  supabase.from('tasks').update(data).eq('id', id).select().single()

export const deleteTask = (id) =>
  supabase.from('tasks').delete().eq('id', id)

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
export const getCompanies = () =>
  supabase.from('companies').select('*').order('id')

export const createCompany = (data) =>
  supabase.from('companies').insert(data).select().single()

export const getStores = () =>
  supabase.from('stores').select('*').order('id')

export const createStore = (data) =>
  supabase.from('stores').insert(data).select().single()

export const updateStore = (id, data) =>
  supabase.from('stores').update(data).eq('id', id).select().single()

export const deleteStore = (id) =>
  supabase.from('stores').delete().eq('id', id)

export const getDepartments = () =>
  supabase.from('departments').select('*').order('id')

export const createDepartment = (data) =>
  supabase.from('departments').insert(data).select().single()

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
  supabase.from('purchase_orders').insert(data).select().single()
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
export const getJournalEntries = () =>
  supabase.from('journal_entries').select('*').order('id', { ascending: false })
export const getJournalLines = (entryId) =>
  supabase.from('journal_lines').select('*').eq('entry_id', entryId).order('id')
export const createJournalEntry = (data) =>
  supabase.from('journal_entries').insert(data).select().single()
export const createJournalLine = (data) =>
  supabase.from('journal_lines').insert(data).select().single()
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
  supabase.from('sales_orders').insert(data).select().single()
export const getPromotions = () =>
  supabase.from('promotions').select('*').order('id', { ascending: false })
export const createPromotion = (data) =>
  supabase.from('promotions').insert(data).select().single()
export const getPOSTransactions = () =>
  supabase.from('pos_transactions').select('*').order('id', { ascending: false })
export const createPOSTransaction = (data) =>
  supabase.from('pos_transactions').insert(data).select().single()
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
export const getPointTransactions = (memberId) =>
  supabase.from('point_transactions').select('*').eq('member_id', memberId).order('id', { ascending: false })
export const createPointTransaction = (data) =>
  supabase.from('point_transactions').insert(data).select().single()
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
  supabase.from('journal_entries').update(data).eq('id', id).select().single()
export const getAllJournalLines = () =>
  supabase.from('journal_lines').select('*').order('id')
export const batchCreateJournalLines = (lines) =>
  supabase.from('journal_lines').insert(lines).select()

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
  supabase.from('salary_records').update(data).eq('id', id).select().single()

// ── SKU Updates ──
export const updateSKU = (id, data) =>
  supabase.from('skus').update(data).eq('id', id).select().single()
export const getSKUs = () =>
  supabase.from('skus').select('*').order('id')

// ── Inventory Adjustments ──
export const createInventoryAdjustment = (data) =>
  supabase.from('inventory_adjustments').insert(data).select().single()

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
  supabase.from('stock_levels').upsert(rows, { onConflict: 'sku_code,warehouse' }).select()

export const bulkInsertJournalEntries = (rows) =>
  supabase.from('journal_entries').insert(rows).select()

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
  supabase.from('approval_requests').insert(data).select().single()
export const updateApprovalRequest = (id, data) =>
  supabase.from('approval_requests').update(data).eq('id', id).select().single()

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
export const updateRolePermissions = async (roleId, permissionIds) => {
  await supabase.from('role_permissions').delete().eq('role_id', roleId)
  if (permissionIds.length === 0) return { data: [], error: null }
  const rows = permissionIds.map(pid => ({ role_id: roleId, permission_id: pid }))
  return supabase.from('role_permissions').insert(rows).select()
}

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
