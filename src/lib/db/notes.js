import { supabase } from '../supabase'

// ─── F-A4 票據管理讀取層 ────────────────────────────────────────
// 讀走 RLS（org_visible）；寫一律走 src/lib/accounting/notes.js 的 RPC wrapper。
// 注意：本檔由頁面直接 import（不掛 src/lib/db/index.js）。

const TABLE_BY_KIND = {
  receivable: 'notes_receivable',
  payable:    'notes_payable',
}

/**
 * 票據清單（依到期日排序，NULL 到期日排最後）。
 * @param {'receivable'|'payable'} kind
 * @param {number} orgId
 * @param {{status?: string}} [filters]
 */
export const getNotes = (kind, orgId, { status } = {}) => {
  let q = supabase
    .from(TABLE_BY_KIND[kind] || TABLE_BY_KIND.receivable)
    .select('*')
    .eq('organization_id', orgId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  return q
}
