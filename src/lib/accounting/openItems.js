import { supabase } from '../supabase'
import { logger } from '../logger'

// ─── F-A3 立沖帳（預收付/暫收付）───────────────────────────────
//
// 薄 RPC wrapper（金流寫入一律 RPC）+ 純函式狀態/餘額/帳齡 helper。
// 立帳/沖銷傳票由 SQL 端經 F-A2 secure_auto_post_voucher 自動拋轉：
//   doc_type 'open_item_create' / 'open_item_settle'，_template = item_type
// 科目對齊 constants.js：預收 2260｜預付 1140｜暫收 2270｜暫付 1160

/** 立沖類型（與 open_items.item_type CHECK 對齊） */
export const OPEN_ITEM_TYPES = ['預收', '預付', '暫收', '暫付']

/** 立沖狀態（與 open_items.status CHECK 對齊） */
export const OPEN_ITEM_STATUSES = ['未沖', '部分沖', '已沖']

/** 類型 → 預設立沖科目（RPC 端有同一份預設，改一邊要同步） */
export const OPEN_ITEM_DEFAULT_ACCOUNTS = {
  '預收': '2260', // 預收貨款（負債）
  '預付': '1140', // 預付款項（資產；1150 已為存貨，故取 1140）
  '暫收': '2270', // 暫收款（負債）
  '暫付': '1160', // 暫付款（資產）
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * 依金額推導立沖狀態（與 secure_settle_open_item 的 CASE 邏輯一致）。
 * @param {number} amount — 立帳金額
 * @param {number} settledAmount — 已沖金額
 * @returns {'未沖'|'部分沖'|'已沖'}
 */
export function deriveOpenItemStatus(amount, settledAmount) {
  const a = round2(amount)
  const s = round2(settledAmount)
  if (s <= 0) return '未沖'
  if (s >= a) return '已沖'
  return '部分沖'
}

/**
 * 未沖餘額 = amount - settled_amount（純函式，供列表/沖銷 modal 顯示）。
 * @param {{amount?: number, settled_amount?: number}} item
 * @returns {number}
 */
export function getOpenItemBalance(item) {
  return round2((item?.amount ?? 0) - (item?.settled_amount ?? 0))
}

/**
 * 帳齡天數：立帳日（created_at）至 asOf 的整天數，未來日期回 0。
 * @param {{created_at?: string|Date}} item
 * @param {Date} [asOf]
 * @returns {number}
 */
export function agingDays(item, asOf = new Date()) {
  if (!item?.created_at) return 0
  const created = new Date(item.created_at)
  if (Number.isNaN(created.getTime())) return 0
  const days = Math.floor((asOf.getTime() - created.getTime()) / 86_400_000)
  return Math.max(0, days)
}

/**
 * 帳齡分桶（沿用 AR/AP 報表慣例四桶）。
 * @param {number} days
 * @returns {'0-30'|'31-60'|'61-90'|'90+'}
 */
export function agingBucket(days) {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '90+'
}

/**
 * 建立立沖單（立帳）→ RPC secure_create_open_item。
 * SQL 端同時自動拋立帳傳票；帶 sourceType/sourceId 時冪等（重放回既有列）。
 * @param {{itemType: string, amount: number, accountCode?: string, partyType?: string,
 *          partyId?: string, partyName?: string, sourceType?: string, sourceId?: string,
 *          memo?: string, payload?: Record<string, unknown>}} params
 * @returns {Promise<object>} open_items 列
 */
export async function createOpenItem({
  itemType, amount, accountCode, partyType, partyId, partyName,
  sourceType, sourceId, memo, payload = {},
} = {}) {
  if (!OPEN_ITEM_TYPES.includes(itemType)) {
    throw new Error(`不合法的立沖類型：${itemType}（僅支援 ${OPEN_ITEM_TYPES.join('/')}）`)
  }
  if (!(Number(amount) > 0)) {
    throw new Error(`立帳金額必須大於 0：${amount}`)
  }

  const { data, error } = await supabase.rpc('secure_create_open_item', {
    p_item_type: itemType,
    p_amount: round2(amount),
    p_account_code: accountCode ?? null,
    p_party_type: partyType ?? null,
    p_party_id: partyId == null ? null : String(partyId),
    p_party_name: partyName ?? null,
    p_source_type: sourceType ?? null,
    p_source_id: sourceId == null ? null : String(sourceId),
    p_memo: memo ?? null,
    p_payload: payload,
  })

  if (error) {
    logger.error('[openItems] 立帳失敗', { itemType, amount, error: error.message })
    throw new Error(`立沖立帳失敗（${itemType}）：${error.message}`)
  }
  return data
}

/**
 * 沖銷立沖單（部分/全額）→ RPC secure_settle_open_item。
 * SQL 端 row-lock、擋超沖、寫沖銷紀錄並自動拋沖銷傳票（方向依 item_type）。
 * @param {string} openItemId
 * @param {number} amount — 本次沖銷金額（> 0，且 ≤ 未沖餘額）
 * @param {{settleDocType?: string, settleDocId?: string, payload?: Record<string, unknown>}} [opts]
 * @returns {Promise<object>} 更新後 open_items 列
 */
export async function settleOpenItem(openItemId, amount, { settleDocType, settleDocId, payload = {} } = {}) {
  if (!openItemId) throw new Error('缺少立沖單 id')
  if (!(Number(amount) > 0)) throw new Error(`沖銷金額必須大於 0：${amount}`)

  const { data, error } = await supabase.rpc('secure_settle_open_item', {
    p_open_item_id: openItemId,
    p_amount: round2(amount),
    p_settle_doc_type: settleDocType ?? null,
    p_settle_doc_id: settleDocId == null ? null : String(settleDocId),
    p_payload: payload,
  })

  if (error) {
    logger.error('[openItems] 沖銷失敗', { openItemId, amount, error: error.message })
    throw new Error(`立沖沖銷失敗：${error.message}`)
  }
  return data
}
