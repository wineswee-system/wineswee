/**
 * F-B2 字軌配號管理資料層
 *
 * - 配號區間列表 / 用量查詢（get_track_usage RPC — 區間 × 已用 × 餘量）
 * - 手動建立配號區間（財政部配號檔匯入亦走同一 insert，source='config'）
 * - 配號「消耗」一律走 server-side allocate_invoice_number（service role），
 *   本檔僅管理區間主檔。
 */
import { supabase } from '../supabase'
import { logger } from '../logger'

/** 餘量警示門檻（%）：低於此值 UI 顯示警示 Badge */
export const LOW_REMAINING_PCT = 20

/**
 * 期別驗證：YYYYMM 且月份為奇數月（雙月一期，例 202607 = 7-8 月期）
 * @param {number|string} period
 * @returns {boolean}
 */
export function isValidTrackPeriod(period) {
  const p = Number(period)
  if (!Number.isInteger(p) || String(p).length !== 6) return false
  const month = p % 100
  return [1, 3, 5, 7, 9, 11].includes(month)
}

/** 配號區間用量（get_track_usage RPC：期別/字軌/起迄/已用/餘量/餘量%） */
export const getTrackUsage = (orgId) =>
  supabase.rpc('get_track_usage', { p_org: orgId })

/**
 * 建立配號區間（手動建期別 / 配號檔匯入）
 * @param {{organizationId: number, period: number, track: string, rangeStart: number, rangeEnd: number, source?: 'config'|'manual'}} input
 * @returns {Promise<Object>} 新建的 allocation 列
 */
export async function createTrackAllocation({
  organizationId, period, track, rangeStart, rangeEnd, source = 'manual',
} = {}) {
  if (!organizationId) throw new Error('缺少 organization_id')
  if (!isValidTrackPeriod(period)) throw new Error('期別必須為 YYYYMM 且起始月為奇數月（例 202607）')
  if (!/^[A-Z]{2}$/.test(String(track || ''))) throw new Error('字軌必須為 2 碼大寫英文字母')

  const start = Number(rangeStart)
  const end = Number(rangeEnd)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 99999999) {
    throw new Error('起迄號碼必須為 0 ~ 99999999 之整數')
  }
  if (end < start) throw new Error('迄號不可小於起號')

  const { data, error } = await supabase
    .from('invoice_track_allocations')
    .insert({
      organization_id: organizationId,
      period: Number(period),
      track,
      range_start: start,
      range_end: end,
      source,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') throw new Error('同期別/字軌已存在相同起號的配號區間')
    throw new Error(error.message || '建立配號區間失敗')
  }

  logger.info('Invoice track allocation created', {
    module: 'finance', period: Number(period), track, range_start: start, range_end: end, source,
  })

  return data
}

/**
 * 關閉配號區間（期末未用空白字軌繳回前先 closed，不再配號）
 * @param {string} allocationId
 * @param {number} [orgId] 傳入時顯式限縮本組織（RLS 之外的第二道防線）
 */
export async function closeTrackAllocation(allocationId, orgId) {
  if (!allocationId) throw new Error('缺少配號區間編號')
  let q = supabase
    .from('invoice_track_allocations')
    .update({ status: 'closed' })
    .eq('id', allocationId)
  if (orgId) q = q.eq('organization_id', orgId)
  const { data, error } = await q
    .select()
    .single()
  if (error) throw new Error(error.message || '關閉配號區間失敗')
  return data
}
