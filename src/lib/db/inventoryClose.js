import { supabase } from '../supabase'

// F-C1 月加權平均月結 / F-C2 盤點盈虧過帳 — 資料存取層
// （新功能 helper 依規約獨立成檔，由 lib/頁面直接 import，不掛進 db/index.js）

/** 月結試算/確認（SECURITY DEFINER RPC；confirm=true 需先有 draft） */
export const rpcRunInventoryClose = (period, confirm = false) =>
  supabase.rpc('secure_run_inventory_close', { p_period: period, p_confirm: confirm })

/** 盤點單過帳（已核對 → 已調帳；產盤差調整 + 盤盈虧傳票） */
export const rpcPostStockCount = (countId) =>
  supabase.rpc('secure_post_stock_count', { p_count_id: countId })

/** 月結批次歷史（RLS：本組織可見） */
export const getInventoryCloseRuns = () =>
  supabase.from('inventory_close_runs').select('*').order('period', { ascending: false })

/** 單一月結批次的逐 SKU 明細 */
export const getInventoryCloseLines = (runId) =>
  supabase.from('inventory_close_lines').select('*').eq('run_id', runId).order('id')

/** org 層級設定（organizations.settings JSONB）— costing_mode 存放處 */
export const getOrgSettings = (orgId) =>
  supabase.from('organizations').select('id, settings').eq('id', orgId).single()

/** 更新 org 設定的單一 key（讀-改-寫；settings 為 JSONB 物件） */
export async function updateOrgSettingKey(orgId, key, value) {
  const { data, error } = await getOrgSettings(orgId)
  if (error) return { data: null, error }
  const settings = { ...(data?.settings || {}), [key]: value }
  return supabase.from('organizations').update({ settings }).eq('id', orgId).select('id, settings').single()
}

/** 更新盤點單（核對結果回寫 items / 狀態） */
export const updateStockCount = (id, patch) =>
  supabase.from('stock_counts').update(patch).eq('id', id).select().single()
