import { supabase } from '../supabase'

// ─── F-A3 立沖帳讀取層 ─────────────────────────────────────────
// 讀走 RLS（org_visible）；寫一律走 src/lib/accounting/openItems.js 的 RPC wrapper。
// 注意：本檔由頁面直接 import（不掛 src/lib/db/index.js）。

/**
 * 立沖單清單（可依類型/狀態過濾）。
 * @param {number} orgId
 * @param {{itemType?: string, status?: string}} [filters]
 */
export const getOpenItems = (orgId, { itemType, status } = {}) => {
  let q = supabase
    .from('open_items')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
  if (itemType) q = q.eq('item_type', itemType)
  if (status) q = q.eq('status', status)
  return q
}

/** 單張立沖單的沖銷紀錄（沖銷 modal 明細；orgId 傳入時顯式限縮本組織） */
export const getOpenItemSettlements = (openItemId, orgId) => {
  let q = supabase
    .from('open_item_settlements')
    .select('*')
    .eq('open_item_id', openItemId)
  if (orgId) q = q.eq('organization_id', orgId)
  return q.order('settled_at', { ascending: true })
}
