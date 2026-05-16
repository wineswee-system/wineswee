// ══════════════════════════════════════
//  3. 序號追蹤（Serial Number Tracking）
// ══════════════════════════════════════

/**
 * 註冊唯一序號
 *
 * @param {string} sku - 料號
 * @param {string} serialNumber - 序號
 * @param {string} [lotNumber] - 所屬批號
 * @param {string} [warrantyEnd] - 保固到期日（ISO 字串）
 * @returns {Object} 序號紀錄
 */
export function registerSerial(sku, serialNumber, lotNumber = '', warrantyEnd = '') {
  return {
    id: `SN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku,
    serialNumber,
    lotNumber,
    warrantyEnd,
    status: 'active',
    history: [
      {
        action: 'registered',
        date: new Date().toISOString(),
        notes: '序號首次註冊',
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

/**
 * 查詢序號（含完整歷史紀錄）
 *
 * @param {string} serialNumber - 序號
 * @param {Array} serials - 序號紀錄清單
 * @returns {Object|null} 序號紀錄或 null
 */
export function lookupSerial(serialNumber, serials) {
  return (serials || []).find((s) => s.serialNumber === serialNumber) || null
}

/**
 * 序號移轉紀錄（位置異動）
 *
 * @param {Object} serial - 序號紀錄
 * @param {string} fromLocation - 來源位置
 * @param {string} toLocation - 目標位置
 * @param {string} reason - 異動原因
 * @returns {Object} 更新後的序號紀錄
 */
export function transferSerial(serial, fromLocation, toLocation, reason) {
  const entry = {
    action: 'transfer',
    fromLocation,
    toLocation,
    reason,
    date: new Date().toISOString(),
  }

  return {
    ...serial,
    currentLocation: toLocation,
    history: [...(serial.history || []), entry],
  }
}
