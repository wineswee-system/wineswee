import { ZONE_TYPES, round2 } from './constants'

// ══════════════════════════════════════
//  4. 倉庫區域與儲位（Zones & Bins）
// ══════════════════════════════════════

/**
 * 產生儲位代碼（e.g. "WH01-A-01-03-B"）
 *
 * @param {string} warehouse - 倉庫代碼（e.g. "WH01"）
 * @param {string} zone - 區域代碼
 * @param {string} aisle - 走道
 * @param {string} rack - 貨架
 * @param {string} shelf - 層板
 * @param {string} bin - 儲格
 * @returns {Object} 儲位紀錄
 */
export function createBinLocation(warehouse, zone, aisle, rack, shelf, bin) {
  if (!ZONE_TYPES.includes(zone)) {
    throw new Error(`無效的區域類型：${zone}，有效值為 ${ZONE_TYPES.join(', ')}`)
  }

  const locationCode = [warehouse, aisle, rack, shelf, bin]
    .filter(Boolean)
    .join('-')

  return {
    locationCode,
    warehouse,
    zone,
    aisle,
    rack,
    shelf,
    bin,
    status: 'active',
    createdAt: new Date().toISOString(),
  }
}

/**
 * 將料號放入儲位（上架）
 *
 * @param {string} sku - 料號
 * @param {string} binLocation - 儲位代碼
 * @param {number} qty - 數量
 * @returns {Object} 儲位庫存紀錄
 */
export function assignItemToBin(sku, binLocation, qty) {
  return {
    sku,
    binLocation,
    qty: round2(qty),
    assignedAt: new Date().toISOString(),
  }
}

/**
 * 查詢料號所在的所有儲位
 *
 * @param {string} sku - 料號
 * @param {Array} binInventory - 儲位庫存 [{sku, binLocation, qty}]
 * @returns {Array} 包含該料號的儲位清單
 */
export function findItemLocations(sku, binInventory) {
  return (binInventory || []).filter((b) => b.sku === sku && b.qty > 0)
}

/**
 * 建議上架儲位（規則式）
 *
 * 規則依序評估：
 * - zone：偏好特定區域
 * - maxItemsPerBin：每格最大料號數
 * - preferEmpty：優先空儲格
 * - sameSku：優先放入已有相同料號的儲格
 *
 * @param {string} sku - 料號
 * @param {Array} availableBins - 可用儲位 [{locationCode, zone, currentItems, currentQty, capacity}]
 * @param {Object} [rules] - 上架規則
 * @param {string} [rules.zone] - 偏好區域
 * @param {number} [rules.maxItemsPerBin] - 每格最大料號數
 * @param {boolean} [rules.preferEmpty] - 優先空儲格
 * @param {boolean} [rules.sameSku] - 優先已有相同料號的儲格
 * @returns {Array} 建議儲位清單（依優先度排序）
 */
export function suggestPutaway(sku, availableBins, rules = {}) {
  let candidates = [...(availableBins || [])]

  // 過濾：偏好區域
  if (rules.zone) {
    const zoneMatches = candidates.filter((b) => b.zone === rules.zone)
    if (zoneMatches.length > 0) candidates = zoneMatches
  }

  // 過濾：每格最大料號數
  if (rules.maxItemsPerBin != null) {
    candidates = candidates.filter(
      (b) => (b.currentItems || 0) < rules.maxItemsPerBin
    )
  }

  // 過濾：容量未滿
  candidates = candidates.filter(
    (b) => b.capacity == null || (b.currentQty || 0) < b.capacity
  )

  // 排序：sameSku 優先 → preferEmpty 優先 → 剩餘容量最大
  candidates.sort((a, b) => {
    // 已有相同料號的儲格優先
    if (rules.sameSku) {
      const aHasSku = (a.skus || []).includes(sku) ? 0 : 1
      const bHasSku = (b.skus || []).includes(sku) ? 0 : 1
      if (aHasSku !== bHasSku) return aHasSku - bHasSku
    }

    // 空儲格優先
    if (rules.preferEmpty) {
      const aEmpty = (a.currentQty || 0) === 0 ? 0 : 1
      const bEmpty = (b.currentQty || 0) === 0 ? 0 : 1
      if (aEmpty !== bEmpty) return aEmpty - bEmpty
    }

    // 剩餘容量大的優先
    const aRemain = (a.capacity || Infinity) - (a.currentQty || 0)
    const bRemain = (b.capacity || Infinity) - (b.currentQty || 0)
    return bRemain - aRemain
  })

  return candidates
}
