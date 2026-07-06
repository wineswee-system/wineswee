/**
 * 安全存量持久化（F-C3.3）— skus.safety_stock / reorder_point / reorder_qty
 *
 * 讀寫皆為 SKU 主檔屬性維護（非金流/狀態轉移），比照既有 updateSKU
 * （src/lib/db/inventory.js）用 plain update，RLS org 範圍已涵蓋。
 */
import { supabase } from '../supabase'

/** 數值欄位正規化：空字串/undefined → null，其餘轉 Number */
const toNumeric = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 取出安全存量三欄的合法 payload（忽略其他欄位，避免誤寫主檔） */
export const mapSafetyStockFields = (data = {}) => ({
  safety_stock: toNumeric(data.safety_stock),
  reorder_point: toNumeric(data.reorder_point),
  reorder_qty: toNumeric(data.reorder_qty),
})

/** 讀取啟用中 SKU 的安全存量設定（org 範圍） */
export const getSkuSafetyStocks = (orgId) => {
  let q = supabase
    .from('skus')
    .select('id, code, name, unit, stock_qty, safety_stock, reorder_point, reorder_qty')
    .eq('status', '啟用')
    .order('code')
  if (orgId) q = q.eq('organization_id', orgId)
  return q.limit(2000)
}

/** 更新單一 SKU 的安全存量三欄 */
export const updateSkuSafetyStock = (skuId, data) =>
  supabase
    .from('skus')
    .update(mapSafetyStockFields(data))
    .eq('id', skuId)
    .select('id, safety_stock, reorder_point, reorder_qty')
    .single()

/**
 * 批次套用（一鍵套用建議值後整批保存）
 * @param {Array<{id:number, safety_stock?, reorder_point?, reorder_qty?}>} rows
 * @returns {Promise<{data: Array, error: Error|null}>} 全部成功 error=null；任一失敗回傳第一個 error
 */
export const bulkUpdateSkuSafetyStock = async (rows = [], orgId) => {
  const results = await Promise.all(rows.map(r => updateSkuSafetyStock(r.id, r, orgId)))
  const firstError = results.find(r => r.error)?.error ?? null
  return { data: results.map(r => r.data).filter(Boolean), error: firstError }
}
