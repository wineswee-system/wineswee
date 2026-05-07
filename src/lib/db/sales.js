import { supabase } from '../supabase'

export const getCustomers = (orgId) => {
  let q = supabase.from('customers').select('id, name, credit_limit, outstanding_amount').order('name')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getCustomerSegments = () =>
  supabase.from('customer_segments').select('*').order('id')

export const createCustomerSegment = (data) =>
  supabase.from('customer_segments').insert(data).select().single()

export const updateCustomerSegment = (id, data) =>
  supabase.from('customer_segments').update(data).eq('id', id).select().single()

export const deleteCustomerSegment = (id) =>
  supabase.from('customer_segments').delete().eq('id', id)

export const getQuotations = (orgId) => {
  let q = supabase.from('quotations').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createQuotation = (data) =>
  supabase.from('quotations').insert(data).select().single()

export const updateQuotation = (id, data) =>
  supabase.from('quotations').update(data).eq('id', id).select().single()

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

export const getSalesOrders = (orgId) => {
  let q = supabase.from('sales_orders').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

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

export const updateSalesOrder = (id, data) =>
  supabase.from('sales_orders').update(data).eq('id', id).select().single()

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

export const getPromotions = (orgId) => {
  let q = supabase.from('promotions').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createPromotion = (data) =>
  supabase.from('promotions').insert(data).select().single()

export const getPriceLists = (orgId) => {
  let q = supabase.from('price_lists').select('*').order('id')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

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

export const getPOSTransactions = (orgId) => {
  let q = supabase.from('pos_transactions').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

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

export const updatePOSTransaction = (id, data) =>
  supabase.from('pos_transactions').update(data).eq('id', id).select().single()

export const getPOSShifts = (orgId) => {
  let q = supabase.from('pos_shifts').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createPOSShift = (data) =>
  supabase.from('pos_shifts').insert(data).select().single()

export const updatePOSShift = (id, data) =>
  supabase.from('pos_shifts').update(data).eq('id', id).select().single()

export const getReturns = (orgId) => {
  let q = supabase.from('returns').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createReturn = (data) =>
  supabase.from('returns').insert(data).select().single()

export const getShipments = (orgId) => {
  let q = supabase.from('shipments').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createShipment = (data) =>
  supabase.from('shipments').insert(data).select().single()

export const updateShipment = (id, data) =>
  supabase.from('shipments').update(data).eq('id', id).select().single()

export const getMembers = (orgId) => {
  let q = supabase.from('members').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createMember = (data) =>
  supabase.from('members').insert(data).select().single()

export const updateMember = (id, data) =>
  supabase.from('members').update(data).eq('id', id).select().single()

export const getPointTransactions = (memberId) =>
  supabase.from('point_transactions').select('*').eq('member_id', memberId).order('id', { ascending: false })

export const getAllPointTransactions = (orgId) => {
  let q = supabase.from('point_transactions').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createPointTransaction = (data) =>
  supabase.from('point_transactions').insert(data).select().single()

export const getReferralCodes = (orgId) => {
  let q = supabase.from('referral_codes').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getReferralCodeByMember = (memberId) =>
  supabase.from('referral_codes').select('*').eq('member_id', memberId).eq('status', '有效').maybeSingle()

export const getReferralCodeByCode = (code) =>
  supabase.from('referral_codes').select('*').eq('code', code).eq('status', '有效').maybeSingle()

export const createReferralCode = (data) =>
  supabase.from('referral_codes').insert(data).select().single()

export const updateReferralCode = (id, data) =>
  supabase.from('referral_codes').update(data).eq('id', id).select().single()

export const getReferralRedemptions = (referralCodeId) =>
  supabase.from('referral_redemptions').select('*').eq('referral_code_id', referralCodeId).order('id', { ascending: false })

export const getAllReferralRedemptions = (orgId) => {
  let q = supabase.from('referral_redemptions').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getReferralRedemptionsByReferee = (refereeId) =>
  supabase.from('referral_redemptions').select('*').eq('referee_id', refereeId).maybeSingle()

export const createReferralRedemption = (data) =>
  supabase.from('referral_redemptions').insert(data).select().single()

export const getInvoices = (orgId) => {
  let q = supabase.from('invoices').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createInvoice = (data) =>
  supabase.from('invoices').insert(data).select().single()

export const updateInvoice = (id, data) =>
  supabase.from('invoices').update(data).eq('id', id).select().single()

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

export const getCampaigns = () =>
  supabase.from('campaigns').select('*').order('id', { ascending: false })

export const createCampaign = (data) =>
  supabase.from('campaigns').insert(data).select().single()

export const updateCampaign = (id, data) =>
  supabase.from('campaigns').update(data).eq('id', id).select().single()

export const getCarrierConfigs = () =>
  supabase.from('carrier_configs').select('*').order('id')

export const createCarrierConfig = (data) =>
  supabase.from('carrier_configs').insert(data).select().single()

export const updateCarrierConfig = (id, data) =>
  supabase.from('carrier_configs').update(data).eq('id', id).select().single()
