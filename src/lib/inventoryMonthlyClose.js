import { logger } from './logger'
import {
  rpcRunInventoryClose,
  getInventoryCloseRuns,
  getOrgSettings,
  updateOrgSettingKey,
} from './db/inventoryClose'

// ─── F-C1 月加權平均月結成本 ─────────────────────────────────────
//
// 台灣主流月結模式：月加權單價 =（期初金額＋本期進貨金額含分攤費用）
// ÷（期初量＋進貨量），重算本期全部出庫成本，差額拋「銷貨成本調整」傳票。
//
// - 計算主體在 SQL RPC secure_run_inventory_close（金流寫入一律 RPC）
// - 本檔的純函式與 SQL 端數學語意一致，供測試/UI 試算顯示用
// - org 層級 costing_mode 存 organizations.settings JSONB：
//   'moving_average'（預設，現行即時成本層）| 'monthly_weighted_average'

export const COSTING_MODES = {
  moving_average: '即時移動平均',
  monthly_weighted_average: '月加權平均月結',
}

export const DEFAULT_COSTING_MODE = 'moving_average'

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000

/**
 * 月加權平均單價（與 SQL 端同語意）。
 * 分母（期初量＋進貨量）為 0 或負 → 沿用最近成本 lastCost（零除守門）。
 *
 * @param {{openingQty?: number, openingValue?: number, receiptQty?: number, receiptValue?: number, lastCost?: number}} p
 *   receiptValue 應為「含 landed cost 分攤」的本期進貨金額
 * @returns {{avgCost: number, usedFallback: boolean}}
 */
export function computeMonthlyAvg({ openingQty = 0, openingValue = 0, receiptQty = 0, receiptValue = 0, lastCost = 0 } = {}) {
  const denomQty = (Number(openingQty) || 0) + (Number(receiptQty) || 0)
  if (!(denomQty > 0)) {
    return { avgCost: round4(lastCost), usedFallback: true }
  }
  const totalValue = (Number(openingValue) || 0) + (Number(receiptValue) || 0)
  return { avgCost: round4(totalValue / denomQty), usedFallback: false }
}

/**
 * 出庫成本重算（issued_value_recalc = 出庫量 × 月加權單價）。
 * @param {{issuedQty?: number, avgCost?: number}} p
 * @returns {number}
 */
export function recalcIssuedValue({ issuedQty = 0, avgCost = 0 } = {}) {
  return round2((Number(issuedQty) || 0) * (Number(avgCost) || 0))
}

/**
 * 彙總月結明細差額（adjustment = issued_value_recalc − issued_value_original）。
 * 與 SQL 端 total_adjustment 語意一致。
 * @param {Array<{issued_value_recalc?: number, issued_value_original?: number, adjustment?: number}>} lines
 * @returns {{totalAdjustment: number, totalRecalc: number, totalOriginal: number}}
 */
export function deriveAdjustment(lines) {
  let totalRecalc = 0
  let totalOriginal = 0
  let totalAdjustment = 0
  for (const line of (lines || [])) {
    const recalc = round2(line?.issued_value_recalc)
    const original = round2(line?.issued_value_original)
    totalRecalc = round2(totalRecalc + recalc)
    totalOriginal = round2(totalOriginal + original)
    totalAdjustment = round2(totalAdjustment + (line?.adjustment != null ? round2(line.adjustment) : round2(recalc - original)))
  }
  return { totalAdjustment, totalRecalc, totalOriginal }
}

/**
 * 執行月結（試算或確認）。
 * - confirm=false：重算該期 draft（已 confirmed 的期間回傳既有結果，不重算）
 * - confirm=true ：由 draft 確認 → 產調整傳票 + 寫期末快照 + 鎖定
 * @param {string} period — 'YYYY-MM'
 * @param {{confirm?: boolean}} [opts]
 * @returns {Promise<{run: object, lines: Array, voucher_number: string|null, already_confirmed: boolean}>}
 */
export async function runInventoryClose(period, { confirm = false } = {}) {
  const { data, error } = await rpcRunInventoryClose(period, confirm)
  if (error) {
    logger.error('[inventoryMonthlyClose] 月結執行失敗', { period, confirm, error: error.message })
    throw new Error(`月結${confirm ? '確認' : '試算'}失敗（${period}）：${error.message}`)
  }
  return data
}

/** 月結批次歷史（新期間在前） */
export async function getCloseRuns() {
  const { data, error } = await getInventoryCloseRuns()
  if (error) {
    logger.error('[inventoryMonthlyClose] 讀取月結歷史失敗', { error: error.message })
    throw new Error(`讀取月結歷史失敗：${error.message}`)
  }
  return data || []
}

/** 讀取 org 成本模式（organizations.settings.costing_mode，預設 moving_average） */
export async function getCostingMode(orgId) {
  if (!orgId) return DEFAULT_COSTING_MODE
  const { data, error } = await getOrgSettings(orgId)
  if (error) {
    logger.warn('[inventoryMonthlyClose] 讀取成本模式失敗，回預設', { orgId, error: error.message })
    return DEFAULT_COSTING_MODE
  }
  const mode = data?.settings?.costing_mode
  return COSTING_MODES[mode] ? mode : DEFAULT_COSTING_MODE
}

/** 切換 org 成本模式 */
export async function setCostingMode(orgId, mode) {
  if (!COSTING_MODES[mode]) throw new Error(`不支援的成本模式：${mode}`)
  const { data, error } = await updateOrgSettingKey(orgId, 'costing_mode', mode)
  if (error) {
    logger.error('[inventoryMonthlyClose] 更新成本模式失敗', { orgId, mode, error: error.message })
    throw new Error(`更新成本模式失敗：${error.message}`)
  }
  return data
}
