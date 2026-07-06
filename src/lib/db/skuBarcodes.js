/**
 * 條碼主檔 db 層（F-C4）— sku_barcodes（一品多碼）
 *
 * 主檔屬性維護（非金流/狀態轉移），比照 safetyStock.js 用 plain update，
 * RLS org 範圍（org_visible）已涵蓋；頁面/元件直接 import 本檔（不經 db/index.js）。
 */
import { supabase } from '../supabase'

/** 依 SKU 列出全部條碼（主要條碼排最前） */
export const listSkuBarcodes = (skuId) =>
  supabase
    .from('sku_barcodes')
    .select('*')
    .eq('sku_id', skuId)
    .order('is_primary', { ascending: false })
    .order('id')

/**
 * 新增條碼
 * @param {{organization_id: number, sku_id: number, barcode: string, type: string, is_primary?: boolean}} data
 */
export const addSkuBarcode = (data) =>
  supabase
    .from('sku_barcodes')
    .insert({
      organization_id: data.organization_id,
      sku_id: data.sku_id,
      barcode: String(data.barcode || '').trim(),
      type: data.type || '店內碼',
      is_primary: !!data.is_primary,
    })
    .select()
    .single()

/** 刪除條碼 */
export const removeSkuBarcode = (id) =>
  supabase.from('sku_barcodes').delete().eq('id', id).select('id')

/**
 * 設定主要條碼：先清同 SKU 其他列的 is_primary 再設定目標列
 * （順序不可反 — sku_barcodes_one_primary_per_sku 部分唯一索引會擋同時兩個主要）
 */
export const setPrimaryBarcode = async (skuId, barcodeId) => {
  const cleared = await supabase
    .from('sku_barcodes')
    .update({ is_primary: false })
    .eq('sku_id', skuId)
    .neq('id', barcodeId)
  if (cleared.error) return cleared

  return supabase
    .from('sku_barcodes')
    .update({ is_primary: true })
    .eq('id', barcodeId)
    .select()
    .single()
}

/**
 * 條碼 → SKU 查詢（出貨掃碼檢核/POS 共用）
 * 先查條碼主檔；查無時退回 skus.code 精確比對（秤重碼品號常＝品號主檔）。
 * @param {number} orgId
 * @param {string} code
 * @returns {Promise<{sku: Object, barcodeRow: Object|null}|null>}
 */
export const lookupByBarcode = async (orgId, code) => {
  const barcode = String(code || '').trim()
  if (!barcode) return null

  let q = supabase
    .from('sku_barcodes')
    .select('*, skus(*)')
    .eq('barcode', barcode)
    .limit(1)
  if (orgId) q = q.eq('organization_id', orgId)
  const { data } = await q.maybeSingle()
  if (data?.skus) return { sku: data.skus, barcodeRow: data }

  // fallback：直接刷品號（skus.code）
  let sq = supabase.from('skus').select('*').eq('code', barcode).limit(1)
  if (orgId) sq = sq.eq('organization_id', orgId)
  const { data: sku } = await sq.maybeSingle()
  return sku ? { sku, barcodeRow: null } : null
}
