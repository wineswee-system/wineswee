/**
 * F-B4 二代健保補充保費 — 資料層（讀取）
 *
 * - 寫入一律走 SECURITY DEFINER RPC（見 src/lib/nhiSupplement.js 的 wrapper），
 *   本檔僅收斂讀取查詢（CONVENTIONS.md 第 1/2 點）。
 * - 參數表 nhi_supplement_params 為法定全域值（非 org 範疇）。
 */
import { supabase } from '../supabase'

/**
 * 取得年度法規參數（費率/門檻）；找不到當年 → 取 ≤ 當年最近一年
 * @param {number} year - 西元年
 * @returns {Promise<{effective_year:number, rate:number, bonus_multiple:number,
 *   single_payment_threshold:number, other_income_threshold:number, payment_cap:number}|null>}
 */
export async function getNhiParams(year) {
  const { data, error } = await supabase
    .from('nhi_supplement_params')
    .select('*')
    .lte('effective_year', year)
    .order('effective_year', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message || '讀取二代健保參數失敗')
  return data
}

/**
 * 取得某期別（YYYY-MM）代扣明細（含員工姓名）
 * @param {string} period - 'YYYY-MM'
 */
export async function getNhiRecordsByPeriod(period) {
  const { data, error } = await supabase
    .from('nhi_supplement_records')
    .select('*, employees(name)')
    .eq('period', period)
    .order('category')
    .order('created_at')
  if (error) throw new Error(error.message || '讀取二代健保代扣明細失敗')
  return data || []
}

/**
 * 取得年度全部代扣明細（年度彙總用）
 * @param {number} year - 西元年
 */
export async function getNhiRecordsByYear(year) {
  const { data, error } = await supabase
    .from('nhi_supplement_records')
    .select('*, employees(name)')
    .like('period', `${year}-%`)
    .order('period')
  if (error) throw new Error(error.message || '讀取二代健保年度明細失敗')
  return data || []
}

/**
 * 取得某期別雇主負擔列（無則 null）
 * @param {string} period - 'YYYY-MM'
 */
export async function getNhiEmployerRecord(period) {
  const { data, error } = await supabase
    .from('nhi_employer_records')
    .select('*')
    .eq('period', period)
    .maybeSingle()
  if (error) throw new Error(error.message || '讀取二代健保雇主負擔失敗')
  return data
}

/**
 * 刪除手動登錄列（RLS 僅允許 source_type='manual' 且 org 內）
 * @param {string} id - nhi_supplement_records.id (uuid)
 */
export async function deleteNhiManualRecord(id) {
  const { error } = await supabase
    .from('nhi_supplement_records')
    .delete()
    .eq('id', id)
    .eq('source_type', 'manual')
  if (error) throw new Error(error.message || '刪除手動登錄列失敗')
}
