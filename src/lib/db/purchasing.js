import { supabase } from '../supabase'

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

export const getVendorCategories = () =>
  supabase.from('vendor_categories').select('*').order('id')

export const createVendorCategory = (data) =>
  supabase.from('vendor_categories').insert(data).select().single()

export const updateVendorCategory = (id, data) =>
  supabase.from('vendor_categories').update(data).eq('id', id).select().single()

export const deleteVendorCategory = (id) =>
  supabase.from('vendor_categories').delete().eq('id', id)

export const getVendorPerformance = () =>
  supabase.from('vendor_performance').select('*').order('id', { ascending: false })

export const createVendorPerformance = (data) =>
  supabase.from('vendor_performance').insert(data).select().single()

export const updateVendorPerformance = (id, data) =>
  supabase.from('vendor_performance').update(data).eq('id', id).select().single()

export const getVendorOnboarding = () =>
  supabase.from('vendor_onboarding').select('*').order('id', { ascending: false })

export const createVendorOnboarding = (data) =>
  supabase.from('vendor_onboarding').insert(data).select().single()

export const updateVendorOnboarding = (id, data) =>
  supabase.from('vendor_onboarding').update(data).eq('id', id).select().single()

export const deleteVendorOnboarding = (id) =>
  supabase.from('vendor_onboarding').delete().eq('id', id)

export const getPurchaseRequests = () =>
  supabase.from('purchase_requests').select('*').order('id', { ascending: false }).limit(1000)

export const createPurchaseRequest = (data) =>
  supabase.from('purchase_requests').insert(data).select().single()

export const getPurchaseOrders = () =>
  supabase.from('purchase_orders').select('*').order('id', { ascending: false }).limit(1000)

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

export const updatePurchaseOrder = (id, data) =>
  supabase.from('purchase_orders').update(data).eq('id', id).select().single()

export const getGoodsReceipts = () =>
  supabase.from('goods_receipts').select('*').order('id', { ascending: false })

export const createGoodsReceipt = (data) =>
  supabase.from('goods_receipts').insert(data).select().single()

export const updateGoodsReceipt = (id, data) =>
  supabase.from('goods_receipts').update(data).eq('id', id).select().single()

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

export const getSupplierContracts = () =>
  supabase.from('supplier_contracts').select('*').order('id', { ascending: false })

export const createSupplierContract = (data) =>
  supabase.from('supplier_contracts').insert(data).select().single()

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

export const getSubcontracts = () =>
  supabase.from('subcontracts').select('*, suppliers(name)').order('id', { ascending: false })

export const createSubcontract = (data) =>
  supabase.from('subcontracts').insert(data).select().single()

export const updateSubcontract = (id, data) =>
  supabase.from('subcontracts').update(data).eq('id', id).select().single()

export const deleteSubcontract = (id) =>
  supabase.from('subcontracts').delete().eq('id', id)
