import { supabase } from '../supabase'

// ─── F-A5 固定資產：耐用年數表 / 折舊提列批次（讀取層）───────────────
// 寫入一律走 RPC（見 src/lib/accounting/fixedAssetOps.js），本檔僅查詢。
// 註：依硬性規範不動 db/index.js — 頁面直接 import 本檔。

/** 行政院固定資產耐用年數表（全域參考資料） */
export const getUsefulLifeTable = () =>
  supabase.from('asset_useful_life_table')
    .select('*')
    .order('category')
    .order('item_name')

/** 折舊提列批次（RLS 已限同組織；orgId 傳入時再顯式過濾） */
export const getDepreciationRuns = (orgId) => {
  let q = supabase.from('depreciation_runs')
    .select('*')
    .order('period', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

/** 單一批次的逐資產明細（orgId 傳入時顯式限縮，防跨組織讀取） */
export const getDepreciationRunLines = (runId, orgId) => {
  let q = supabase.from('depreciation_run_lines')
    .select('*')
    .eq('run_id', runId)
  if (orgId) q = q.eq('organization_id', orgId)
  return q.order('asset_id')
}
