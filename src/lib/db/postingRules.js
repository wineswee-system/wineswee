import { supabase } from '../supabase'

// ─── F-A2 posting_rules（傳票自動拋轉規則）─────────────────────────
// 讀：組織自訂規則 + 全域預設模板（organization_id IS NULL）
// 寫：只能寫自己組織的列（RLS 強制）；全域模板要改 → 以組織列覆寫（copy-on-write）

/** 取得規則清單（組織列 + 全域預設列） */
export const getPostingRules = (orgId) => {
  let q = supabase.from('posting_rules')
    .select('*')
    .order('doc_type')
    .order('template_name')
  if (orgId) q = q.or(`organization_id.eq.${orgId},organization_id.is.null`)
  else q = q.is('organization_id', null)
  return q
}

/** 建立組織自訂規則（覆寫全域預設用同 doc_type + template_name） */
export const createPostingRule = (data) =>
  supabase.from('posting_rules').insert(data).select().single()

/** 更新組織自訂規則（全域列 RLS 擋掉，UI 應先 copy-on-write） */
export const updatePostingRule = (id, data) =>
  supabase.from('posting_rules').update(data).eq('id', id).select().single()

/** 刪除組織自訂規則（刪後回落全域預設） */
export const deletePostingRule = (id) =>
  supabase.from('posting_rules').delete().eq('id', id)

/**
 * 組織覆寫（copy-on-write）：編輯全域模板時，先找同鍵組織列 —
 * 有就 update，沒有就 insert 一列組織自訂規則蓋過全域預設。
 * （冪等鍵是 partial unique index，PostgREST upsert 無法推斷，故手動兩段式。）
 */
export const saveOrgPostingRule = async (orgId, docType, templateName, patch) => {
  const { data: existing, error: selErr } = await supabase
    .from('posting_rules')
    .select('id')
    .eq('organization_id', orgId)
    .eq('doc_type', docType)
    .eq('template_name', templateName || 'default')
    .maybeSingle()
  if (selErr) return { data: null, error: selErr }

  if (existing) return updatePostingRule(existing.id, patch)
  return createPostingRule({
    organization_id: orgId,
    doc_type: docType,
    template_name: templateName || 'default',
    ...patch,
  })
}
