import { supabase } from '../supabase'

// ─── F-C3.2 折讓單讀寫層（銷貨/進貨折讓）─────────────────────────
// 讀走 RLS（org_visible）；草稿建立/取消走 RLS（僅限 draft 列）；
// 「確認」一律走 src/lib/allowances.js 的 RPC wrapper
// （secure_confirm_sales_allowance / secure_confirm_purchase_allowance）。
// 注意：本檔由頁面/lib 直接 import（不掛 src/lib/db/index.js）— 同 openItems.js 慣例。

/**
 * 銷貨折讓單清單（可依狀態過濾）。
 * @param {number} orgId
 * @param {{status?: string}} [filters]
 */
export const getSalesAllowances = (orgId, { status } = {}) => {
  let q = supabase
    .from('sales_allowances')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  return q
}

/** 單張銷貨折讓單 */
export const getSalesAllowance = (id) =>
  supabase.from('sales_allowances').select('*').eq('id', id).maybeSingle()

/** 建立銷貨折讓草稿（RLS 強制 status='draft' + 本組織） */
export const insertSalesAllowance = (row) =>
  supabase.from('sales_allowances').insert(row).select().single()

/** 取消銷貨折讓草稿（僅 draft 可取消 — RLS + 條件雙重把關） */
export const cancelSalesAllowanceDraft = (id) =>
  supabase
    .from('sales_allowances')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'draft')
    .select()
    .single()

/**
 * 進貨折讓單清單（可依狀態過濾）。
 * @param {number} orgId
 * @param {{status?: string}} [filters]
 */
export const getPurchaseAllowances = (orgId, { status } = {}) => {
  let q = supabase
    .from('purchase_allowances')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  return q
}

/** 單張進貨折讓單 */
export const getPurchaseAllowance = (id) =>
  supabase.from('purchase_allowances').select('*').eq('id', id).maybeSingle()

/** 建立進貨折讓草稿 */
export const insertPurchaseAllowance = (row) =>
  supabase.from('purchase_allowances').insert(row).select().single()

/** 取消進貨折讓草稿 */
export const cancelPurchaseAllowanceDraft = (id) =>
  supabase
    .from('purchase_allowances')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'draft')
    .select()
    .single()
