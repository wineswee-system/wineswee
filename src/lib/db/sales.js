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
  // 已按 id desc（= 最新在前）排序；limit 防止交易量大時整表拉回
  let q = supabase.from('pos_transactions').select('*').order('id', { ascending: false }).limit(1000)
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getPOSTransactionByNumber = (transactionNumber) =>
  supabase.from('pos_transactions').select('*').eq('transaction_number', transactionNumber).maybeSingle()

// v3：副作用（扣庫存/點數/消費紀錄/優惠券核銷/傳票）由 RPC 後端原子執行。
// points_earned 由後端以 member_levels 計算（單一事實來源），前端傳值僅供相容。
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
    // 離線補送冪等鍵：佇列時以 crypto.randomUUID() 產生，重試帶同值 → RPC 冪等重放
    p_client_tx_id: data.client_tx_id ?? null,
    p_store_id: data.store_id ?? null,
    p_note: data.note ?? null,
    p_manual_discount: data.manual_discount ?? 0,
    p_coupon_assignment_id: data.coupon_assignment_id ?? null,
    p_payment_splits: data.payment_splits ?? null,
    p_manager_pin: data.manager_pin ?? null,
  })

// 零售交易退款（後端原子：退貨紀錄/還庫存/扣回點數/迴轉傳票/稽核）
// items = [{name, qty, price}]；null = 整筆退。組織已設主管 PIN 時必須帶 manager_pin。
export const refundPOSTransaction = ({ transaction_number, items = null, reason = null, refund_method = 'cash', manager_pin = null, cashier = null }) =>
  supabase.rpc('secure_refund_pos_transaction', {
    p_transaction_number: transaction_number,
    p_items: items,
    p_reason: reason,
    p_refund_method: refund_method,
    p_manager_pin: manager_pin,
    p_cashier: cashier,
  })

// ── 現金收支（開班備用金 / 領錢 / 存錢） ───────────────────
export const recordCashMovement = ({ movement_type, amount, reason = null, store_id = null, business_date = null, created_by = null }) =>
  supabase.rpc('pos_record_cash_movement', {
    p_movement_type: movement_type,
    p_amount: amount,
    p_reason: reason,
    p_store_id: store_id,
    p_business_date: business_date ?? new Date().toISOString().slice(0, 10),
    p_created_by: created_by,
  })

export const getCashMovements = (orgId, { storeId = null, date = null } = {}) => {
  let q = supabase.from('pos_cash_movements').select('*').order('created_at', { ascending: true })
  if (orgId) q = q.eq('organization_id', orgId)
  if (storeId != null) q = q.eq('store_id', storeId)
  if (date) q = q.eq('business_date', date)
  return q
}

// ── 主管授權 PIN ────────────────────────────────────────────
export const setManagerPin = ({ label, pin, current_pin = null }) =>
  supabase.rpc('pos_set_manager_pin', { p_label: label, p_pin: pin, p_current_pin: current_pin })

export const getManagerPins = (orgId) => {
  let q = supabase.from('pos_manager_pins').select('id, label, is_active, created_at').order('label')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

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
  let q = supabase.from('members').select('*').order('id', { ascending: false }).limit(2000)
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

// POS member lookup — search by phone, member_number, or member-card QR token (used at checkout)
export async function searchMemberByQuery(query, orgId) {
  if (!query?.trim()) return null
  const q = query.trim()
  let req = supabase
    .from('members')
    .select('id, name, phone, member_number, level, level_id, available_points, lifetime_spend, total_spent, organization_id')
    .or(`phone.ilike.%${q}%,member_number.ilike.%${q}%,qr_token.eq.${q}`)
    .limit(1)
  if (orgId) req = req.eq('organization_id', orgId)
  const { data } = await req
  return data?.[0] ?? null
}

export const createPointTransaction = (data) =>
  supabase.from('point_transactions').insert(data).select().single()

// ── Member Levels ──────────────────────────────────────────
export const getMemberLevels = (orgId) => {
  let q = supabase.from('member_levels').select('*').order('rank', { ascending: true })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getMemberLevelById = (id) =>
  supabase.from('member_levels').select('*').eq('id', id).single()

export const createMemberLevel = (data) =>
  supabase.from('member_levels').insert(data).select().single()

export const updateMemberLevel = (id, data) =>
  supabase.from('member_levels').update(data).eq('id', id).select().single()

export const deleteMemberLevel = (id) =>
  supabase.from('member_levels').delete().eq('id', id)

// ── Member Purchases ───────────────────────────────────────
export const getMemberPurchases = (memberId) =>
  supabase.from('member_purchases')
    .select('*, member_purchase_lines(*)')
    .eq('member_id', memberId)
    .order('purchased_at', { ascending: false })

export const getMemberPurchaseLines = (purchaseId) =>
  supabase.from('member_purchase_lines').select('*, skus(code, name)').eq('purchase_id', purchaseId)

export const createMemberPurchase = (data) =>
  supabase.from('member_purchases').insert(data).select().single()

export const createMemberPurchaseLines = (lines) =>
  supabase.from('member_purchase_lines').insert(lines).select()

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
