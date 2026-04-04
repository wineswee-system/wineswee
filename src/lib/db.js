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

// ── Leave Requests ─────────────────────────────────────────
export const getLeaveRequests = () =>
  supabase.from('leave_requests').select('*').order('id')

export const createLeaveRequest = (data) =>
  supabase.from('leave_requests').insert(data).select().single()

export const updateLeaveStatus = (id, status, approver) =>
  supabase.from('leave_requests').update({ status, approver }).eq('id', id).select().single()

export const deleteLeaveRequest = (id) =>
  supabase.from('leave_requests').delete().eq('id', id)

// ── Overtime ───────────────────────────────────────────────
export const getOvertimeRequests = () =>
  supabase.from('overtime_requests').select('*').order('id')

export const createOvertimeRequest = (data) =>
  supabase.from('overtime_requests').insert(data).select().single()

export const updateOvertimeStatus = (id, status) =>
  supabase.from('overtime_requests').update({ status }).eq('id', id).select().single()

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

export const updateBusinessTripStatus = (id, status) =>
  supabase.from('business_trips').update({ status }).eq('id', id).select().single()

// ── Expenses ───────────────────────────────────────────────
export const getExpenses = () =>
  supabase.from('expenses').select('*').order('id')

export const createExpense = (data) =>
  supabase.from('expenses').insert(data).select().single()

export const updateExpenseStatus = (id, status) =>
  supabase.from('expenses').update({ status }).eq('id', id).select().single()

// ── Workflows ──────────────────────────────────────────────
export const getWorkflows = () =>
  supabase.from('workflows').select('*').order('id')

export const createWorkflow = (data) =>
  supabase.from('workflows').insert(data).select().single()

export const updateWorkflow = (id, data) =>
  supabase.from('workflows').update(data).eq('id', id).select().single()

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

// ── Organizations ──────────────────────────────────────────
export const getCompanies = () =>
  supabase.from('companies').select('*').order('id')

export const createCompany = (data) =>
  supabase.from('companies').insert(data).select().single()

export const getStores = () =>
  supabase.from('stores').select('*').order('id')

export const createStore = (data) =>
  supabase.from('stores').insert(data).select().single()

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
