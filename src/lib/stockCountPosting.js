import { logger } from './logger'
import { rpcPostStockCount } from './db/inventoryClose'

// ─── F-C2 盤點盈虧自動轉傳票 ─────────────────────────────────────
//
// 盤點狀態機：盤點中 → 已核對 → 已調帳
// 「已調帳」動作走 SECURITY DEFINER RPC secure_post_stock_count：
//   items JSONB 逐品項差異 → inventory_adjustments（reason '盤差'）
//   → 淨盤虧拋 'inventory_count' default 傳票（借 存貨盤損／貸 存貨）
//   → 淨盤盈拋 overage 模板（借 存貨／貸 存貨盤盈）
//   → 同時有盈有虧拆兩張（source_ref ':loss' / ':gain'）
// 本檔純函式與 SQL 端導出邏輯一致，供 UI 預覽與測試。

/** 可過帳狀態（狀態守門：僅「已核對」可執行調帳） */
export const POSTABLE_STATUS = '已核對'

/** @param {string} status @returns {boolean} 是否可執行調帳過帳 */
export function canPostStockCount(status) {
  return status === POSTABLE_STATUS
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * 自 stock_counts.items JSONB 導出逐品項差異（與 SQL 端同語意）。
 * 支援 {sku|sku_code, name|sku_name, system_qty, counted_qty, unit_cost} 兩組鍵名；
 * 差異為 0 或缺品號的列會被略過。
 * @param {Array<object>} items
 * @returns {Array<{sku_code: string, sku_name: string, system_qty: number, counted_qty: number, variance: number, unit_cost: number, amount: number}>}
 */
export function deriveVariances(items) {
  const result = []
  for (const item of (items || [])) {
    const skuCode = item?.sku ?? item?.sku_code ?? null
    if (!skuCode) continue
    const systemQty = Number(item?.system_qty) || 0
    const countedQty = item?.counted_qty == null ? systemQty : (Number(item.counted_qty) || 0)
    const variance = countedQty - systemQty
    if (variance === 0) continue
    const unitCost = Number(item?.unit_cost) || 0
    result.push({
      sku_code: skuCode,
      sku_name: item?.name ?? item?.sku_name ?? skuCode,
      system_qty: systemQty,
      counted_qty: countedQty,
      variance,
      unit_cost: unitCost,
      amount: round2(variance * unitCost), // 數量差 × 單價 = 金額差（正=盤盈、負=盤虧）
    })
  }
  return result
}

/**
 * 盤盈/盤虧拆分彙總（與 SQL 端傳票金額同語意）。
 * @param {ReturnType<typeof deriveVariances>} variances
 * @returns {{shortageTotal: number, overageTotal: number, netAmount: number, lossItems: Array, gainItems: Array}}
 *   shortageTotal / overageTotal 皆為正數金額；netAmount = overage − shortage
 */
export function splitLossGain(variances) {
  let shortageTotal = 0
  let overageTotal = 0
  const lossItems = []
  const gainItems = []
  for (const v of (variances || [])) {
    if (v.variance < 0) {
      shortageTotal = round2(shortageTotal + round2(-v.variance * v.unit_cost))
      lossItems.push(v)
    } else if (v.variance > 0) {
      overageTotal = round2(overageTotal + round2(v.variance * v.unit_cost))
      gainItems.push(v)
    }
  }
  return {
    shortageTotal,
    overageTotal,
    netAmount: round2(overageTotal - shortageTotal),
    lossItems,
    gainItems,
  }
}

/**
 * 盤點單過帳（已核對 → 已調帳）。
 * 傳入盤點單列（含 status）時先做前端狀態守門，再呼叫 RPC；
 * SQL 端另有狀態守門 + 傳票冪等唯一鍵，重複呼叫不會重複入帳。
 * @param {{id: number, status?: string}|number} countOrId
 * @returns {Promise<{count_id: number, shortage_total: number, overage_total: number, variance_amount: number, vouchers: Array, already_posted: boolean}>}
 */
export async function postStockCount(countOrId) {
  const isObj = countOrId != null && typeof countOrId === 'object'
  const id = isObj ? countOrId.id : countOrId
  const status = isObj ? countOrId.status : null

  if (status != null && status !== '已調帳' && !canPostStockCount(status)) {
    throw new Error(`僅「${POSTABLE_STATUS}」狀態的盤點單可執行調帳過帳（目前狀態：${status}）`)
  }

  const { data, error } = await rpcPostStockCount(id)
  if (error) {
    logger.error('[stockCountPosting] 盤點過帳失敗', { countId: id, error: error.message })
    throw new Error(`盤點過帳失敗（#${id}）：${error.message}`)
  }
  return data
}
