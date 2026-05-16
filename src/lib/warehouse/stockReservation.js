import { round2 } from './constants'

// ══════════════════════════════════════
//  1. 庫存保留（Stock Reservation）
// ══════════════════════════════════════

/**
 * 計算可用庫存（現有庫存 - 已保留數量）
 *
 * @param {string} sku - 料號
 * @param {string} warehouseId - 倉庫代碼
 * @param {Array} stockLevels - 庫存水位 [{sku, warehouseId, on_hand}]
 * @param {Array} reservations - 保留紀錄 [{sku, warehouseId, qty, status}]
 * @returns {number} 可用庫存數量
 */
export function getAvailableStock(sku, warehouseId, stockLevels, reservations) {
  const stock = (stockLevels || []).find(
    (s) => s.sku === sku && s.warehouseId === warehouseId
  )
  const onHand = stock ? stock.on_hand : 0

  const reservedQty = (reservations || [])
    .filter((r) => r.sku === sku && r.warehouseId === warehouseId && r.status === 'active')
    .reduce((sum, r) => sum + r.qty, 0)

  return round2(onHand - reservedQty)
}

/**
 * 保留庫存（為銷售訂單鎖定庫存）
 *
 * @param {string} sku - 料號
 * @param {number} qty - 保留數量
 * @param {string} soId - 銷售訂單編號
 * @param {string} warehouseId - 倉庫代碼
 * @param {Array} stockLevels - 庫存水位 [{sku, warehouseId, on_hand}]
 * @param {Array} reservations - 現有保留紀錄
 * @returns {Object} { success, reservation?, error? }
 */
export function reserveStock(sku, qty, soId, warehouseId, stockLevels, reservations) {
  const available = getAvailableStock(sku, warehouseId, stockLevels, reservations)

  if (available < qty) {
    return {
      success: false,
      error: `庫存不足：料號 ${sku} 可用庫存 ${available}，需求 ${qty}`,
    }
  }

  const reservation = {
    id: `RSV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku,
    qty: round2(qty),
    soId,
    warehouseId,
    status: 'active',
    createdAt: new Date().toISOString(),
  }

  return { success: true, reservation }
}

/**
 * 釋放已保留庫存
 *
 * @param {string} reservationId - 保留紀錄 ID
 * @param {Array} reservations - 現有保留紀錄
 * @returns {Object} { success, reservation?, error? }
 */
export function releaseReservation(reservationId, reservations) {
  const reservation = (reservations || []).find((r) => r.id === reservationId)

  if (!reservation) {
    return { success: false, error: `找不到保留紀錄：${reservationId}` }
  }

  if (reservation.status !== 'active') {
    return { success: false, error: `保留紀錄狀態非 active：${reservation.status}` }
  }

  const released = {
    ...reservation,
    status: 'released',
    releasedAt: new Date().toISOString(),
  }

  return { success: true, reservation: released }
}

/**
 * 批次驗證銷售訂單各行項的庫存可用性
 *
 * @param {Array} orderLines - 訂單行項 [{sku, qty, warehouseId}]
 * @param {Array} stockLevels - 庫存水位
 * @param {Array} reservations - 現有保留紀錄
 * @returns {Object} { allAvailable, lines: [{sku, requested, available, sufficient}] }
 */
export function validateStockAvailability(orderLines, stockLevels, reservations) {
  const lines = (orderLines || []).map((line) => {
    const available = getAvailableStock(line.sku, line.warehouseId, stockLevels, reservations)
    return {
      sku: line.sku,
      warehouseId: line.warehouseId,
      requested: line.qty,
      available,
      sufficient: available >= line.qty,
    }
  })

  return {
    allAvailable: lines.every((l) => l.sufficient),
    lines,
  }
}
