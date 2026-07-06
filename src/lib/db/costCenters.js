/**
 * 成本中心維度查詢（F-A6 部門/門市損益）
 *
 * 取 journal_lines 實際出現過的 cost_center 值（distinct），
 * 供 ProfitLossByDept 多選篩選使用；與 cost_centers 主檔（finance.js getCostCenters）
 * 互補 — 報表以「分錄實際標記」為準，避免主檔有列但無交易的空欄。
 * 頁面直接 import 本檔（不經 db/index.js）。
 */
import { supabase } from '../supabase'

/**
 * 取得 journal_lines 中實際使用過的 cost_center（去重、排序）
 * @param {number} [orgId]
 * @returns {Promise<{data: Array<string>, error: Error|null}>}
 */
export const getDistinctCostCenters = async (orgId) => {
  let q = supabase
    .from('journal_lines')
    .select(orgId ? 'cost_center, journal_entries!inner(organization_id)' : 'cost_center')
    .not('cost_center', 'is', null)
    .limit(10000)
  if (orgId) q = q.eq('journal_entries.organization_id', orgId)

  const { data, error } = await q
  if (error) return { data: [], error }
  const distinct = [...new Set((data || []).map(r => r.cost_center).filter(Boolean))].sort()
  return { data: distinct, error: null }
}
