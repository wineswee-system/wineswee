import { ADJUSTMENT_REASONS, round2 } from './constants'

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
//  10. 自動補貨（Auto-Reorder → PO）
// ══════════════════════════════════════

/**
 * 產生自動補貨採購單（依供應商合併）
 *
 * @param {Array} alerts - 再訂購點警示（checkReorderPoints 的輸出）
 * @param {Array} supplierMappings - 供應商對應 [{sku, supplier, supplierSkuCode, leadTimeDays, minOrderQty, unitCost, isPreferred}]
 * @param {Object} [options] - 選項
 * @param {boolean} [options.autoApprove=false] - 是否自動核准
 * @param {string} [options.requester='系統自動'] - 申請人
 * @returns {Object} { purchaseOrders: [...], skippedItems: [...] }
 */
export function generateAutoReorderPOs(alerts, supplierMappings, options = {}) {
  const { autoApprove = false, requester = '系統自動' } = options

  if (!alerts || alerts.length === 0) {
    return { purchaseOrders: [], skippedItems: [] }
  }

  const supplierGroups = {}
  const skippedItems = []

  for (const alert of alerts) {
    const mappings = (supplierMappings || []).filter(m => m.sku === alert.sku)
    const preferred = mappings.find(m => m.isPreferred) || mappings[0]

    if (!preferred) {
      skippedItems.push({
        sku: alert.sku,
        reason: '未設定供應商',
        currentStock: alert.currentStock,
        reorderQty: alert.reorderQty,
      })
      continue
    }

    const supplier = preferred.supplier
    if (!supplierGroups[supplier]) {
      supplierGroups[supplier] = { supplier, items: [] }
    }

    const orderQty = round2(Math.max(alert.reorderQty || 0, preferred.minOrderQty || 0))

    supplierGroups[supplier].items.push({
      sku: alert.sku,
      supplierSkuCode: preferred.supplierSkuCode || alert.sku,
      qty: orderQty,
      unitCost: preferred.unitCost || 0,
      amount: round2(orderQty * (preferred.unitCost || 0)),
      urgency: alert.urgency,
      currentStock: alert.currentStock,
      reorderPoint: alert.reorderPoint,
      leadTimeDays: preferred.leadTimeDays || 7,
    })
  }

  const purchaseOrders = Object.values(supplierGroups).map(group => {
    const totalAmount = round2(group.items.reduce((sum, i) => sum + i.amount, 0))
    const maxLeadTime = Math.max(...group.items.map(i => i.leadTimeDays))
    const expectedDate = new Date()
    expectedDate.setDate(expectedDate.getDate() + maxLeadTime)

    return {
      id: `AUTO-PO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      poNumber: `APO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      supplier: group.supplier,
      items: group.items,
      totalAmount,
      expectedDate: expectedDate.toISOString().slice(0, 10),
      status: autoApprove ? '待確認' : '草稿',
      source: 'auto_reorder',
      requester,
      hasCriticalItems: group.items.some(i => i.urgency === 'critical'),
      createdAt: new Date().toISOString(),
    }
  })

  return { purchaseOrders, skippedItems }
}

/**
 * 計算庫存周轉率
 *
 * @param {number} cogs - 銷貨成本（期間）
 * @param {number} avgInventoryValue - 平均庫存價值
 * @returns {Object} { turnoverRate, daysOfStock }
 */
export function calculateInventoryTurnover(cogs, avgInventoryValue) {
  if (avgInventoryValue <= 0) return { turnoverRate: 0, daysOfStock: Infinity }

  const turnoverRate = round2(cogs / avgInventoryValue)
  const daysOfStock = turnoverRate > 0 ? round2(365 / turnoverRate) : Infinity

  return { turnoverRate, daysOfStock }
}

/**
 * 識別呆滯庫存
 *
 * @param {Array} skuTransactions - [{sku, lastMovementDate, currentStock, unitCost}]
 * @param {number} thresholdDays - 閾值天數（預設 90 天無異動視為呆滯）
 * @param {string} asOfDate - 基準日期
 * @returns {Array} 呆滯品項清單 [{sku, daysSinceMovement, currentStock, value, classification}]
 */
export function identifyDeadStock(skuTransactions, thresholdDays = 90, asOfDate = new Date().toISOString()) {
  const asOf = new Date(asOfDate)

  return (skuTransactions || [])
    .map(item => {
      const lastMove = item.lastMovementDate ? new Date(item.lastMovementDate) : null
      const daysSince = lastMove ? Math.floor((asOf - lastMove) / 86400000) : Infinity

      let classification
      if (daysSince === Infinity || daysSince >= thresholdDays * 3) {
        classification = 'dead'
      } else if (daysSince >= thresholdDays * 2) {
        classification = 'very_slow'
      } else if (daysSince >= thresholdDays) {
        classification = 'slow'
      } else {
        classification = 'active'
      }

      return {
        sku: item.sku,
        daysSinceMovement: daysSince === Infinity ? '從未異動' : daysSince,
        currentStock: item.currentStock || 0,
        value: round2((item.currentStock || 0) * (item.unitCost || 0)),
        unitCost: item.unitCost || 0,
        lastMovementDate: item.lastMovementDate || null,
        classification,
      }
    })
    .filter(item => item.classification !== 'active')
    .sort((a, b) => {
      const order = { dead: 0, very_slow: 1, slow: 2 }
      return (order[a.classification] || 3) - (order[b.classification] || 3) || b.value - a.value
    })
}

/**
 * 組合商品庫存計算（依組件最小可用量）
 *
 * @param {Array} kitComponents - [{componentSku, requiredQty}]
 * @param {Array} stockLevels - [{sku, on_hand}]
 * @returns {Object} { availableKits, limitingComponent }
 */
export function calculateKitAvailability(kitComponents, stockLevels) {
  if (!kitComponents || kitComponents.length === 0) {
    return { availableKits: 0, limitingComponent: null }
  }

  let minKits = Infinity
  let limitingComponent = null

  for (const comp of kitComponents) {
    const stock = (stockLevels || []).find(s => s.sku === comp.componentSku)
    const onHand = stock ? stock.on_hand : 0
    const possibleKits = comp.requiredQty > 0 ? Math.floor(onHand / comp.requiredQty) : 0

    if (possibleKits < minKits) {
      minKits = possibleKits
      limitingComponent = {
        sku: comp.componentSku,
        onHand,
        requiredPerKit: comp.requiredQty,
        possibleKits,
      }
    }
  }

  return {
    availableKits: minKits === Infinity ? 0 : minKits,
    limitingComponent,
  }
}
