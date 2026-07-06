import { supabase } from '../supabase'

// 存貨評價月結快照（inventory_valuations）— 唯讀查詢層
// 供營業成本表取期初/期末存貨（F-C1 月加權平均月結寫入的快照）
// 欄位：sku_id, valuation_date (date), costing_method, total_quantity, total_value, unit_cost
// 注意：inventory_valuations 本身無 organization_id 欄位，org 範圍一律經 skus join 過濾。

/** 取指定評價日的全部 SKU 快照列（org 範圍經 skus join） */
export const getValuationSnapshotsByDate = (valuationDate, costingMethod, orgId) => {
  let q = supabase
    .from('inventory_valuations')
    .select('*, skus!inner(organization_id)')
    .eq('valuation_date', valuationDate)
  if (orgId) q = q.eq('skus.organization_id', orgId)
  if (costingMethod) q = q.eq('costing_method', costingMethod)
  return q
}

/** 取 <= 指定日期的最近一個評價日（找不到回 null）— 用於期初/期末快照定位 */
export async function getLatestValuationDate(onOrBefore, orgId) {
  let q = supabase
    .from('inventory_valuations')
    .select('valuation_date, skus!inner(organization_id)')
    .lte('valuation_date', onOrBefore)
  if (orgId) q = q.eq('skus.organization_id', orgId)
  const { data, error } = await q
    .order('valuation_date', { ascending: false })
    .limit(1)
  if (error) return { data: null, error }
  return { data: data?.[0]?.valuation_date ?? null, error: null }
}

/** 加總某評價日全部 SKU 的存貨價值（無快照回 null，不虛構數字） */
export async function getValuationTotalByDate(valuationDate, costingMethod, orgId) {
  const { data, error } = await getValuationSnapshotsByDate(valuationDate, costingMethod, orgId)
  if (error) return { data: null, error }
  if (!data || data.length === 0) return { data: null, error: null }
  const total = Math.round(data.reduce((s, r) => s + (Number(r.total_value) || 0), 0) * 100) / 100
  return { data: total, error: null }
}
