/**
 * 倉儲管理引擎（WMS / Inventory）
 *
 * 核心功能：
 * 1. 庫存保留（Stock Reservation）
 * 2. 批號追蹤（Lot/Batch Tracking）
 * 3. 序號追蹤（Serial Number Tracking）
 * 4. 倉庫區域與儲位（Zones & Bins）
 * 5. 再訂購點警示（Reorder Point Alerts）
 * 6. 循環盤點（Cycle Counting）
 * 7. 庫存調整原因（Adjustment Reasons）
 * 8. 最低/最高庫存水位（Min/Max Stock Levels）
 * 9. 單位換算（Unit of Measure Conversions）
 *
 * 純函式（不依賴外部狀態），所有金額/數量以 Math.round(x*100)/100 精確處理
 */

// ══════════════════════════════════════
//  常數定義
// ══════════════════════════════════════

/** 倉庫區域類型 */
export const ZONE_TYPES = ['receiving', 'storage', 'picking', 'shipping', 'quarantine', 'returns']

/** 庫存調整原因 */
export const ADJUSTMENT_REASONS = [
  { code: 'DAMAGE', label: '損壞報廢', requiresApproval: true },
  { code: 'THEFT', label: '盜竊短少', requiresApproval: true },
  { code: 'COUNT_VARIANCE', label: '盤點差異', requiresApproval: false },
  { code: 'QUALITY_REJECT', label: '品質不合格', requiresApproval: true },
  { code: 'EXPIRY', label: '過期報廢', requiresApproval: false },
  { code: 'RETURN_RESTOCK', label: '退貨入庫', requiresApproval: false },
  { code: 'PRODUCTION_SCRAP', label: '生產報廢', requiresApproval: true },
  { code: 'OTHER', label: '其他', requiresApproval: true },
]

// 精確到小數點兩位的四捨五入
const round2 = (x) => Math.round(x * 100) / 100

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

// ══════════════════════════════════════
//  5. 再訂購點警示（Reorder Point Alerts）
// ══════════════════════════════════════

/**
 * 檢查低於再訂購點的品項
 *
 * @param {Array} stockLevels - 庫存水位 [{sku, on_hand, warehouseId}]
 * @param {Array} skuSettings - 品項設定 [{sku, reorderPoint, minQty, maxQty, reorderQty, supplier}]
 * @returns {Array} 低於再訂購點的警示清單
 */
export function checkReorderPoints(stockLevels, skuSettings) {
  const alerts = []

  for (const setting of skuSettings || []) {
    const stockEntries = (stockLevels || []).filter((s) => s.sku === setting.sku)
    const totalOnHand = stockEntries.reduce((sum, s) => sum + (s.on_hand || 0), 0)

    if (totalOnHand <= setting.reorderPoint) {
      alerts.push({
        sku: setting.sku,
        currentStock: round2(totalOnHand),
        reorderPoint: setting.reorderPoint,
        reorderQty: setting.reorderQty,
        supplier: setting.supplier || null,
        urgency: totalOnHand <= setting.minQty ? 'critical' : 'warning',
      })
    }
  }

  return alerts
}

/**
 * 計算建議訂購數量
 *
 * 公式：max(0, maxStock - currentStock - openPOs)
 *
 * @param {number} currentStock - 目前庫存
 * @param {number} reorderPoint - 再訂購點
 * @param {number} maxStock - 最高庫存
 * @param {number} [openPOs=0] - 在途採購量
 * @returns {number} 建議訂購數量
 */
export function calculateReorderQty(currentStock, reorderPoint, maxStock, openPOs = 0) {
  const effectiveStock = round2(currentStock + openPOs)

  if (effectiveStock > reorderPoint) return 0

  return round2(Math.max(0, maxStock - effectiveStock))
}

/**
 * 產生再訂購報表
 *
 * @param {Array} alerts - 再訂購點警示 [{sku, currentStock, reorderPoint, reorderQty, supplier, urgency}]
 * @returns {Object} 報表 { generatedAt, totalAlerts, critical, warning, items, bySupplier }
 */
export function generateReorderReport(alerts) {
  const items = (alerts || []).sort((a, b) => {
    // 緊急的排前面
    if (a.urgency === 'critical' && b.urgency !== 'critical') return -1
    if (a.urgency !== 'critical' && b.urgency === 'critical') return 1
    return 0
  })

  // 依供應商分組
  const bySupplier = {}
  for (const item of items) {
    const supplier = item.supplier || '未指定供應商'
    if (!bySupplier[supplier]) bySupplier[supplier] = []
    bySupplier[supplier].push(item)
  }

  return {
    generatedAt: new Date().toISOString(),
    totalAlerts: items.length,
    critical: items.filter((i) => i.urgency === 'critical').length,
    warning: items.filter((i) => i.urgency === 'warning').length,
    items,
    bySupplier,
  }
}

// ══════════════════════════════════════
//  6. 循環盤點（Cycle Counting）
// ══════════════════════════════════════

/**
 * ABC 分類法（依價值分類）
 *
 * A 類：前 80% 累積價值
 * B 類：次 15% 累積價值
 * C 類：末 5% 累積價值
 *
 * @param {Array} skus - 品項資料 [{sku, annualValue}]（annualValue = 年用量 × 單價）
 * @returns {Array} 附加 abcClass 的品項清單
 */
export function abcClassification(skus) {
  if (!skus || skus.length === 0) return []

  // 依年度價值降序排列
  const sorted = [...skus].sort((a, b) => (b.annualValue || 0) - (a.annualValue || 0))
  const totalValue = sorted.reduce((sum, s) => sum + (s.annualValue || 0), 0)

  if (totalValue === 0) {
    return sorted.map((s) => ({ ...s, abcClass: 'C' }))
  }

  let cumulative = 0
  return sorted.map((s) => {
    cumulative += s.annualValue || 0
    const pct = cumulative / totalValue

    let abcClass
    if (pct <= 0.8) {
      abcClass = 'A'
    } else if (pct <= 0.95) {
      abcClass = 'B'
    } else {
      abcClass = 'C'
    }

    return { ...s, abcClass, cumulativePercent: round2(pct * 100) }
  })
}

/**
 * 產生循環盤點計畫
 *
 * 方法：
 * - 'abc'：A=每月、B=每季、C=每年
 * - 'random'：隨機選取品項
 *
 * @param {Array} skus - 品項清單（含 abcClass 欄位，若使用 abc 方法）
 * @param {string} method - 盤點方法（'abc' | 'random'）
 * @param {Object} [options] - 選項
 * @param {number} [options.randomPct=10] - random 方法的抽樣百分比
 * @param {string} [options.currentMonth] - 當前月份 (1-12)
 * @returns {Array} 盤點計畫 [{sku, frequency, scheduledDate}]
 */
export function generateCycleCountPlan(skus, method, options = {}) {
  if (!skus || skus.length === 0) return []

  if (method === 'abc') {
    // A=每月盤點、B=每季盤點、C=每年盤點
    const frequencyMap = { A: '每月', B: '每季', C: '每年' }
    const currentMonth = parseInt(options.currentMonth || new Date().getMonth() + 1, 10)

    return skus.filter((s) => {
      if (s.abcClass === 'A') return true               // 每月都盤
      if (s.abcClass === 'B') return currentMonth % 3 === 1 // 每季第一個月
      return currentMonth === 1                          // C 類只在 1 月
    }).map((s) => ({
      sku: s.sku,
      abcClass: s.abcClass || 'C',
      frequency: frequencyMap[s.abcClass] || '每年',
      scheduledDate: new Date().toISOString().slice(0, 10),
    }))
  }

  if (method === 'random') {
    const pct = (options.randomPct || 10) / 100
    const count = Math.max(1, Math.round(skus.length * pct))

    // Fisher-Yates 取前 count 個
    const shuffled = [...skus]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }

    return shuffled.slice(0, count).map((s) => ({
      sku: s.sku,
      abcClass: s.abcClass || null,
      frequency: '隨機',
      scheduledDate: new Date().toISOString().slice(0, 10),
    }))
  }

  return []
}

/**
 * 處理循環盤點結果，計算差異
 *
 * @param {Array} countEntries - 盤點紀錄 [{sku, countedQty, countedBy, countedAt}]
 * @param {Array} systemStock - 系統庫存 [{sku, on_hand}]
 * @returns {Array} 差異報告 [{sku, systemQty, countedQty, variance, variancePct}]
 */
export function processCycleCount(countEntries, systemStock) {
  return (countEntries || []).map((entry) => {
    const stock = (systemStock || []).find((s) => s.sku === entry.sku)
    const systemQty = stock ? stock.on_hand : 0
    const variance = round2(entry.countedQty - systemQty)
    const variancePct = systemQty !== 0
      ? round2((variance / systemQty) * 100)
      : entry.countedQty !== 0 ? 100 : 0

    return {
      sku: entry.sku,
      systemQty,
      countedQty: entry.countedQty,
      variance,
      variancePct,
      countedBy: entry.countedBy,
      countedAt: entry.countedAt,
      hasVariance: variance !== 0,
    }
  })
}

/**
 * 建立庫存調整紀錄
 *
 * @param {string} sku - 料號
 * @param {number} systemQty - 系統數量
 * @param {number} countedQty - 盤點數量
 * @param {string} reason - 調整原因（ADJUSTMENT_REASONS code）
 * @param {string} countedBy - 盤點人員
 * @returns {Object} 調整紀錄
 */
export function createAdjustment(sku, systemQty, countedQty, reason, countedBy) {
  const reasonDef = ADJUSTMENT_REASONS.find((r) => r.code === reason)
  const adjustmentQty = round2(countedQty - systemQty)

  return {
    id: `ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku,
    systemQty: round2(systemQty),
    countedQty: round2(countedQty),
    adjustmentQty,
    reason,
    reasonLabel: reasonDef ? reasonDef.label : reason,
    requiresApproval: reasonDef ? reasonDef.requiresApproval : true,
    status: reasonDef && reasonDef.requiresApproval ? 'pending_approval' : 'approved',
    countedBy,
    createdAt: new Date().toISOString(),
  }
}

// ══════════════════════════════════════
//  7. 庫存調整（Inventory Adjustment）
// ══════════════════════════════════════

/**
 * 建立庫存調整（含核簽流程路由）
 *
 * @param {string} sku - 料號
 * @param {number} qty - 調整數量（正=增加，負=減少）
 * @param {string} reason - 調整原因（ADJUSTMENT_REASONS code）
 * @param {string} notes - 備註
 * @param {string} adjustedBy - 調整人員
 * @returns {Object} { adjustment, requiresApproval }
 */
export function createInventoryAdjustment(sku, qty, reason, notes, adjustedBy) {
  const reasonDef = ADJUSTMENT_REASONS.find((r) => r.code === reason)

  if (!reasonDef) {
    return {
      success: false,
      error: `無效的調整原因代碼：${reason}`,
    }
  }

  const adjustment = {
    id: `IADJ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku,
    qty: round2(qty),
    reason: reasonDef.code,
    reasonLabel: reasonDef.label,
    notes,
    adjustedBy,
    requiresApproval: reasonDef.requiresApproval,
    status: reasonDef.requiresApproval ? 'pending_approval' : 'approved',
    createdAt: new Date().toISOString(),
  }

  return { success: true, adjustment, requiresApproval: reasonDef.requiresApproval }
}

// ══════════════════════════════════════
//  8. 最低/最高庫存水位（Min/Max Stock Levels）
// ══════════════════════════════════════

/**
 * 設定品項的最低/最高庫存水位
 *
 * @param {string} sku - 料號
 * @param {number} minQty - 最低庫存
 * @param {number} maxQty - 最高庫存
 * @param {number} reorderPoint - 再訂購點
 * @param {number} reorderQty - 再訂購量
 * @returns {Object} 設定紀錄
 */
export function setMinMaxLevels(sku, minQty, maxQty, reorderPoint, reorderQty) {
  if (minQty > maxQty) {
    throw new Error(`最低庫存 (${minQty}) 不得大於最高庫存 (${maxQty})`)
  }
  if (reorderPoint < minQty || reorderPoint > maxQty) {
    throw new Error(`再訂購點 (${reorderPoint}) 須介於最低庫存與最高庫存之間`)
  }

  return {
    sku,
    minQty: round2(minQty),
    maxQty: round2(maxQty),
    reorderPoint: round2(reorderPoint),
    reorderQty: round2(reorderQty),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 評估各品項庫存水位狀態
 *
 * @param {Array} stockLevels - 庫存水位 [{sku, on_hand}]
 * @param {Array} settings - 品項設定 [{sku, minQty, maxQty}]
 * @returns {Array} [{sku, on_hand, minQty, maxQty, status: 'understocked'|'overstocked'|'normal'}]
 */
export function evaluateStockLevels(stockLevels, settings) {
  return (settings || []).map((cfg) => {
    const stock = (stockLevels || []).find((s) => s.sku === cfg.sku)
    const onHand = stock ? stock.on_hand : 0

    let status
    if (onHand < cfg.minQty) {
      status = 'understocked'
    } else if (onHand > cfg.maxQty) {
      status = 'overstocked'
    } else {
      status = 'normal'
    }

    return {
      sku: cfg.sku,
      on_hand: round2(onHand),
      minQty: cfg.minQty,
      maxQty: cfg.maxQty,
      status,
    }
  })
}

/**
 * 經濟訂購量（EOQ）
 *
 * 公式：sqrt(2 × 年需求量 × 每次訂購成本 / 年持有成本)
 *
 * @param {number} annualDemand - 年需求量
 * @param {number} orderCost - 每次訂購成本
 * @param {number} holdingCost - 每單位年持有成本
 * @returns {number} 經濟訂購量
 */
export function calculateEOQ(annualDemand, orderCost, holdingCost) {
  if (holdingCost <= 0 || annualDemand <= 0) return 0

  return round2(Math.sqrt((2 * annualDemand * orderCost) / holdingCost))
}

// ══════════════════════════════════════
//  9. 單位換算（Unit of Measure Conversions）
// ══════════════════════════════════════

/**
 * 單位換算
 *
 * 支援多段轉換（e.g. pallet → box → pcs）。
 *
 * @param {number} qty - 數量
 * @param {string} fromUnit - 來源單位
 * @param {string} toUnit - 目標單位
 * @param {Array} conversions - 換算表 [{from, to, factor}]
 * @returns {Object} { success, qty, unit, error? }
 */
export function convertUoM(qty, fromUnit, toUnit, conversions) {
  if (fromUnit === toUnit) {
    return { success: true, qty: round2(qty), unit: toUnit }
  }

  // BFS 尋找轉換路徑（支援雙向）
  const graph = {}
  for (const c of conversions || []) {
    if (!graph[c.from]) graph[c.from] = []
    if (!graph[c.to]) graph[c.to] = []
    graph[c.from].push({ unit: c.to, factor: c.factor })
    graph[c.to].push({ unit: c.from, factor: 1 / c.factor })
  }

  // BFS
  const visited = new Set([fromUnit])
  const queue = [{ unit: fromUnit, factor: 1 }]

  while (queue.length > 0) {
    const current = queue.shift()

    if (current.unit === toUnit) {
      return { success: true, qty: round2(qty * current.factor), unit: toUnit }
    }

    for (const neighbor of graph[current.unit] || []) {
      if (!visited.has(neighbor.unit)) {
        visited.add(neighbor.unit)
        queue.push({ unit: neighbor.unit, factor: current.factor * neighbor.factor })
      }
    }
  }

  return {
    success: false,
    qty: 0,
    unit: toUnit,
    error: `無法從 ${fromUnit} 轉換為 ${toUnit}，請確認換算表`,
  }
}

/**
 * 轉換為基礎單位（最小單位）
 *
 * 基礎單位定義：無法再往下轉換的最小單位。
 *
 * @param {number} qty - 數量
 * @param {string} unit - 目前單位
 * @param {Array} conversions - 換算表 [{from, to, factor}]（from 為大單位，to 為小單位，factor > 1）
 * @returns {Object} { qty, unit }
 */
export function getBaseQty(qty, unit, conversions) {
  if (!conversions || conversions.length === 0) {
    return { qty: round2(qty), unit }
  }

  // 找出基礎單位：只出現在 to 但不出現在 from 的單位
  const fromUnits = new Set((conversions || []).map((c) => c.from))
  const toUnits = new Set((conversions || []).map((c) => c.to))
  let baseUnit = null

  for (const u of toUnits) {
    if (!fromUnits.has(u)) {
      baseUnit = u
      break
    }
  }

  // 若找不到明確的基礎單位，取轉換鏈最末端
  if (!baseUnit) {
    baseUnit = [...toUnits][0]
  }

  const result = convertUoM(qty, unit, baseUnit, conversions)

  if (result.success) {
    return { qty: result.qty, unit: baseUnit }
  }

  // 無法轉換，回傳原值
  return { qty: round2(qty), unit }
}
