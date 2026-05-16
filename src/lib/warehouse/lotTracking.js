import { round2 } from './constants'

// ══════════════════════════════════════
//  2. 批號追蹤（Lot/Batch Tracking）
// ══════════════════════════════════════

/**
 * 建立批號紀錄
 *
 * @param {string} sku - 料號
 * @param {string} lotNumber - 批號
 * @param {number} qty - 數量
 * @param {string} expiryDate - 到期日（ISO 字串）
 * @param {string} [supplierLot] - 供應商批號
 * @param {string} [coaRef] - 檢驗報告參考編號（Certificate of Analysis）
 * @returns {Object} 批號紀錄
 */
export function createLot(sku, lotNumber, qty, expiryDate, supplierLot = '', coaRef = '') {
  return {
    id: `LOT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku,
    lotNumber,
    qty: round2(qty),
    remainingQty: round2(qty),
    expiryDate,
    supplierLot,
    coaRef,
    status: 'active',
    createdAt: new Date().toISOString(),
  }
}

/**
 * 依到期日排序批號，標記過期/即將過期（30 天內）
 *
 * @param {Array} lots - 批號紀錄 [{lotNumber, expiryDate, ...}]
 * @param {string} asOfDate - 基準日期（ISO 字串）
 * @returns {Array} 排序後的批號，附加 expired / expiringSoon 欄位
 */
export function getLotsByExpiry(lots, asOfDate) {
  const asOf = new Date(asOfDate)
  const soonThreshold = new Date(asOf)
  soonThreshold.setDate(soonThreshold.getDate() + 30)

  return [...(lots || [])]
    .map((lot) => {
      const expiry = new Date(lot.expiryDate)
      return {
        ...lot,
        expired: expiry < asOf,
        expiringSoon: !!(expiry >= asOf && expiry <= soonThreshold),
      }
    })
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))
}

/**
 * 追蹤批號使用紀錄（完整可追溯性）
 *
 * @param {string} lotNumber - 批號
 * @param {Array} transactions - 異動紀錄 [{lotNumber, type, qty, date, ref, ...}]
 * @returns {Object} { lotNumber, usage: [...filtered transactions sorted by date] }
 */
export function traceLotUsage(lotNumber, transactions) {
  const usage = (transactions || [])
    .filter((t) => t.lotNumber === lotNumber)
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  return { lotNumber, usage }
}

/**
 * FEFO（先到期先出）消耗邏輯
 *
 * 依到期日由近到遠消耗批號庫存，回傳已消耗的批號明細。
 *
 * @param {Array} lots - 可用批號 [{lotNumber, remainingQty, expiryDate, ...}]
 * @param {number} requiredQty - 需求數量
 * @returns {Object} { success, consumed: [{lotNumber, qty}], shortfall }
 */
export function FEFO(lots, requiredQty) {
  // 依到期日排序（最近到期的優先）
  const sorted = [...(lots || [])]
    .filter((l) => l.remainingQty > 0)
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))

  const consumed = []
  let remaining = round2(requiredQty)

  for (const lot of sorted) {
    if (remaining <= 0) break

    const take = Math.min(lot.remainingQty, remaining)
    consumed.push({
      lotNumber: lot.lotNumber,
      qty: round2(take),
      expiryDate: lot.expiryDate,
    })
    remaining = round2(remaining - take)
  }

  return {
    success: remaining <= 0,
    consumed,
    shortfall: remaining > 0 ? round2(remaining) : 0,
  }
}
