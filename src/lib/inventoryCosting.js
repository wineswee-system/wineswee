import { supabase } from './supabase'

/**
 * 存貨成本計算引擎
 *
 * 支援四種成本計算方法：
 * 1. FIFO 先進先出法
 * 2. LIFO 後進先出法
 * 3. 加權平均法（Weighted Average）
 * 4. 移動平均法（Moving Average）
 *
 * 純函式（不依賴外部狀態）+ Supabase 持久化成本層
 * 交易紀錄格式：[{type: 'IN'|'OUT', qty, unit_cost, date}]
 */

// ══════════════════════════════════════
//  1. FIFO 先進先出法
// ══════════════════════════════════════

/**
 * 先進先出法計算存貨成本
 *
 * 進貨時建立成本層（layer），出貨時由最早的成本層扣除。
 *
 * @param {Array} transactions - 交易紀錄
 *   [{type: 'IN'|'OUT', qty: number, unit_cost: number, date: string}]
 * @returns {Object} 計算結果
 *   {cogs, ending_inventory_value, ending_qty, layers: [{qty, unit_cost}]}
 */
export function calculateFIFO(transactions) {
  const layers = [] // 成本層，先進的排在前面
  let cogs = 0     // 銷貨成本

  // 依日期排序
  const sorted = [...(transactions || [])].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  )

  for (const txn of sorted) {
    if (txn.type === 'IN') {
      // 進貨：新增成本層
      layers.push({
        qty: txn.qty,
        unit_cost: txn.unit_cost,
      })
    } else if (txn.type === 'OUT') {
      // 出貨：從最早的成本層開始扣除（FIFO）
      let remaining = txn.qty

      while (remaining > 0 && layers.length > 0) {
        const oldest = layers[0]

        if (oldest.qty <= remaining) {
          // 整層用完
          cogs += oldest.qty * oldest.unit_cost
          remaining -= oldest.qty
          layers.shift()
        } else {
          // 部分扣除
          cogs += remaining * oldest.unit_cost
          oldest.qty -= remaining
          remaining = 0
        }
      }

      // 若 remaining > 0 表示庫存不足（負庫存情境），此處不額外處理
    }
  }

  // 計算期末存貨
  const endingQty = layers.reduce((sum, l) => sum + l.qty, 0)
  const endingValue = layers.reduce((sum, l) => sum + l.qty * l.unit_cost, 0)

  return {
    cogs: Math.round(cogs * 100) / 100,
    ending_inventory_value: Math.round(endingValue * 100) / 100,
    ending_qty: endingQty,
    layers: layers.map(l => ({ qty: l.qty, unit_cost: l.unit_cost })),
  }
}

// ══════════════════════════════════════
//  2. LIFO 後進先出法
// ══════════════════════════════════════

/**
 * 後進先出法計算存貨成本
 *
 * 進貨時建立成本層，出貨時由最新的成本層扣除。
 *
 * @param {Array} transactions - 交易紀錄（同 FIFO）
 * @returns {Object} 計算結果（同 FIFO 格式）
 */
export function calculateLIFO(transactions) {
  const layers = [] // 成本層，後進的排在最後
  let cogs = 0

  const sorted = [...(transactions || [])].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  )

  for (const txn of sorted) {
    if (txn.type === 'IN') {
      layers.push({
        qty: txn.qty,
        unit_cost: txn.unit_cost,
      })
    } else if (txn.type === 'OUT') {
      // 出貨：從最新的成本層開始扣除（LIFO）
      let remaining = txn.qty

      while (remaining > 0 && layers.length > 0) {
        const newest = layers[layers.length - 1]

        if (newest.qty <= remaining) {
          cogs += newest.qty * newest.unit_cost
          remaining -= newest.qty
          layers.pop()
        } else {
          cogs += remaining * newest.unit_cost
          newest.qty -= remaining
          remaining = 0
        }
      }
    }
  }

  const endingQty = layers.reduce((sum, l) => sum + l.qty, 0)
  const endingValue = layers.reduce((sum, l) => sum + l.qty * l.unit_cost, 0)

  return {
    cogs: Math.round(cogs * 100) / 100,
    ending_inventory_value: Math.round(endingValue * 100) / 100,
    ending_qty: endingQty,
    layers: layers.map(l => ({ qty: l.qty, unit_cost: l.unit_cost })),
  }
}

// ══════════════════════════════════════
//  3. 加權平均法
// ══════════════════════════════════════

/**
 * 加權平均法計算存貨成本
 *
 * 每次進貨時重新計算平均單位成本。
 * 出貨以當時的加權平均成本計算。
 *
 * @param {Array} transactions - 交易紀錄
 * @returns {Object} 計算結果
 *   {cogs, ending_inventory_value, ending_qty, avg_unit_cost}
 */
export function calculateWeightedAverage(transactions) {
  let totalQty = 0
  let totalValue = 0
  let cogs = 0

  const sorted = [...(transactions || [])].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  )

  for (const txn of sorted) {
    if (txn.type === 'IN') {
      // 進貨：累加數量和金額，重新計算平均成本
      totalQty += txn.qty
      totalValue += txn.qty * txn.unit_cost
    } else if (txn.type === 'OUT') {
      // 出貨：以當前加權平均成本計算
      const avgCost = totalQty > 0 ? totalValue / totalQty : 0
      const outCost = txn.qty * avgCost
      cogs += outCost
      totalQty -= txn.qty
      totalValue -= outCost

      // 防止浮點誤差導致負值
      if (totalQty <= 0) {
        totalQty = 0
        totalValue = 0
      }
    }
  }

  const avgUnitCost = totalQty > 0 ? totalValue / totalQty : 0

  return {
    cogs: Math.round(cogs * 100) / 100,
    ending_inventory_value: Math.round(totalValue * 100) / 100,
    ending_qty: totalQty,
    avg_unit_cost: Math.round(avgUnitCost * 100) / 100,
  }
}

// ══════════════════════════════════════
//  4. 移動平均法
// ══════════════════════════════════════

/**
 * 移動平均法計算存貨成本
 *
 * 與加權平均類似，但額外記錄每筆交易後的平均成本歷史。
 *
 * @param {Array} transactions - 交易紀錄
 * @returns {Object} 計算結果
 *   {cogs, ending_inventory_value, avg_unit_cost, history: [{date, avg_cost}]}
 */
export function calculateMovingAverage(transactions) {
  let totalQty = 0
  let totalValue = 0
  let cogs = 0
  const history = []

  const sorted = [...(transactions || [])].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  )

  for (const txn of sorted) {
    if (txn.type === 'IN') {
      totalQty += txn.qty
      totalValue += txn.qty * txn.unit_cost
    } else if (txn.type === 'OUT') {
      const avgCost = totalQty > 0 ? totalValue / totalQty : 0
      const outCost = txn.qty * avgCost
      cogs += outCost
      totalQty -= txn.qty
      totalValue -= outCost

      if (totalQty <= 0) {
        totalQty = 0
        totalValue = 0
      }
    }

    // 每筆交易後記錄當前平均成本
    const currentAvg = totalQty > 0 ? totalValue / totalQty : 0
    history.push({
      date: txn.date,
      avg_cost: Math.round(currentAvg * 100) / 100,
    })
  }

  const avgUnitCost = totalQty > 0 ? totalValue / totalQty : 0

  return {
    cogs: Math.round(cogs * 100) / 100,
    ending_inventory_value: Math.round(totalValue * 100) / 100,
    avg_unit_cost: Math.round(avgUnitCost * 100) / 100,
    history,
  }
}

// ══════════════════════════════════════
//  5. 存貨評價（套用成本方法）
// ══════════════════════════════════════

/**
 * 對整批存貨套用指定的成本計算方法
 *
 * @param {Array} stockLevels - 庫存清單
 *   [{sku, qty}]
 * @param {string} costingMethod - 成本方法 ('FIFO'|'LIFO'|'WEIGHTED_AVG'|'MOVING_AVG')
 * @param {Object} transactions - 各品號的交易紀錄（以 SKU 為 key）
 *   {[sku]: [{type, qty, unit_cost, date}]}
 * @returns {Array} 評價結果
 *   [{sku, qty, unit_cost, total_value, method}]
 */
export function valuateInventory(stockLevels, costingMethod, transactions) {
  // 選擇成本計算函式
  const costFn = {
    FIFO: calculateFIFO,
    LIFO: calculateLIFO,
    WEIGHTED_AVG: calculateWeightedAverage,
    MOVING_AVG: calculateMovingAverage,
  }[costingMethod] || calculateWeightedAverage

  const result = []

  for (const stock of (stockLevels || [])) {
    const txns = transactions?.[stock.sku] || []

    if (txns.length === 0) {
      // 無交易紀錄，成本為 0
      result.push({
        sku: stock.sku,
        qty: stock.qty,
        unit_cost: 0,
        total_value: 0,
        method: costingMethod || 'WEIGHTED_AVG',
      })
      continue
    }

    const costResult = costFn(txns)

    // 從計算結果取得單位成本
    let unitCost = 0
    if (costResult.avg_unit_cost !== undefined) {
      unitCost = costResult.avg_unit_cost
    } else if (costResult.layers && costResult.layers.length > 0) {
      // FIFO/LIFO：以剩餘成本層的加權平均作為單位成本
      const totalVal = costResult.layers.reduce((s, l) => s + l.qty * l.unit_cost, 0)
      const totalQty = costResult.layers.reduce((s, l) => s + l.qty, 0)
      unitCost = totalQty > 0 ? totalVal / totalQty : 0
    }

    result.push({
      sku: stock.sku,
      qty: stock.qty,
      unit_cost: Math.round(unitCost * 100) / 100,
      total_value: Math.round(stock.qty * unitCost * 100) / 100,
      method: costingMethod || 'WEIGHTED_AVG',
    })
  }

  return result
}

// ══════════════════════════════════════
//  6. Supabase 持久化成本層 API
// ══════════════════════════════════════

/**
 * FIFO 出庫：從最舊的成本層開始消耗
 *
 * @param {number} skuId - SKU ID
 * @param {number} warehouseId - 倉庫 ID
 * @param {number} quantityNeeded - 需出庫數量
 * @returns {Object} { totalCost, layers: [{ layerId, quantityUsed, unitCost }] }
 */
export async function consumeFIFO(skuId, warehouseId, quantityNeeded) {
  const { data: costLayers, error } = await supabase
    .from('inventory_cost_layers')
    .select('*')
    .eq('sku_id', skuId)
    .eq('warehouse_id', warehouseId)
    .gt('quantity_remaining', 0)
    .order('receipt_date', { ascending: true })

  if (error) throw error

  let remaining = quantityNeeded
  let totalCost = 0
  const consumed = []

  for (const layer of (costLayers || [])) {
    if (remaining <= 0) break

    const used = Math.min(layer.quantity_remaining, remaining)
    totalCost += used * layer.unit_cost
    remaining -= used

    const newQty = layer.quantity_remaining - used
    const { error: updateErr } = await supabase
      .from('inventory_cost_layers')
      .update({ quantity_remaining: newQty })
      .eq('id', layer.id)

    if (updateErr) throw updateErr

    consumed.push({
      layerId: layer.id,
      quantityUsed: used,
      unitCost: layer.unit_cost,
    })
  }

  if (remaining > 0) {
    return {
      totalCost: Math.round(totalCost * 100) / 100,
      layers: consumed,
      shortage: remaining,
      error: `庫存不足，尚缺 ${remaining} 單位`,
    }
  }

  return {
    totalCost: Math.round(totalCost * 100) / 100,
    layers: consumed,
    shortage: 0,
  }
}

/**
 * 加權平均成本：計算所有剩餘成本層的加權平均單位成本
 *
 * @param {number} skuId - SKU ID
 * @param {number} warehouseId - 倉庫 ID（可選，null 表示全倉庫）
 * @returns {Object} { avgUnitCost, totalQty, totalValue }
 */
export async function getWeightedAvgCost(skuId, warehouseId) {
  let query = supabase
    .from('inventory_cost_layers')
    .select('quantity_remaining, unit_cost')
    .eq('sku_id', skuId)
    .gt('quantity_remaining', 0)

  if (warehouseId) query = query.eq('warehouse_id', warehouseId)

  const { data, error } = await query
  if (error) throw error

  const totalQty = (data || []).reduce((s, l) => s + Number(l.quantity_remaining), 0)
  const totalValue = (data || []).reduce((s, l) => s + Number(l.quantity_remaining) * Number(l.unit_cost), 0)
  const avgUnitCost = totalQty > 0 ? totalValue / totalQty : 0

  return {
    avgUnitCost: Math.round(avgUnitCost * 100) / 100,
    totalQty,
    totalValue: Math.round(totalValue * 100) / 100,
  }
}

/**
 * 新增成本層（收貨時呼叫）
 *
 * @param {number} skuId - SKU ID
 * @param {number} warehouseId - 倉庫 ID
 * @param {number} quantity - 數量
 * @param {number} unitCost - 單位成本
 * @param {string} sourceType - 來源類型 (purchase, manufacturing, adjustment)
 * @param {number} sourceId - 來源 ID（如採購單 ID）
 * @param {string} lotNumber - 批號（可選）
 * @returns {Object} 新增的成本層資料
 */
export async function addCostLayer(skuId, warehouseId, quantity, unitCost, sourceType, sourceId, lotNumber) {
  const { data, error } = await supabase
    .from('inventory_cost_layers')
    .insert({
      sku_id: skuId,
      warehouse_id: warehouseId,
      quantity_remaining: quantity,
      unit_cost: unitCost,
      source_type: sourceType || 'purchase',
      source_id: sourceId || null,
      lot_number: lotNumber || null,
      receipt_date: new Date().toISOString().split('T')[0],
    })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * 取得庫存估價報表
 *
 * @param {string} costingMethod - 成本方法 ('fifo' | 'weighted_avg')
 * @returns {Array} [{ sku_id, sku_code, sku_name, unit, total_quantity, total_value, unit_cost, costing_method }]
 */
export async function getInventoryValuation(costingMethod = 'weighted_avg') {
  // 取得所有有剩餘數量的成本層，含 SKU 資訊
  const { data: layers, error } = await supabase
    .from('inventory_cost_layers')
    .select('sku_id, quantity_remaining, unit_cost, receipt_date, skus(id, code, name, unit)')
    .gt('quantity_remaining', 0)
    .order('receipt_date', { ascending: true })

  if (error) throw error

  // 依 SKU 分組
  const grouped = {}
  for (const layer of (layers || [])) {
    const sid = layer.sku_id
    if (!grouped[sid]) {
      grouped[sid] = {
        sku_id: sid,
        sku_code: layer.skus?.code || '',
        sku_name: layer.skus?.name || '',
        unit: layer.skus?.unit || '',
        layers: [],
      }
    }
    grouped[sid].layers.push({
      qty: Number(layer.quantity_remaining),
      unit_cost: Number(layer.unit_cost),
    })
  }

  const result = []

  for (const skuData of Object.values(grouped)) {
    const totalQty = skuData.layers.reduce((s, l) => s + l.qty, 0)
    let totalValue = 0
    let unitCost = 0

    if (costingMethod === 'fifo') {
      // FIFO 估價：每層各自的數量 * 成本
      totalValue = skuData.layers.reduce((s, l) => s + l.qty * l.unit_cost, 0)
      unitCost = totalQty > 0 ? totalValue / totalQty : 0
    } else {
      // 加權平均：全部加總算平均
      totalValue = skuData.layers.reduce((s, l) => s + l.qty * l.unit_cost, 0)
      unitCost = totalQty > 0 ? totalValue / totalQty : 0
      totalValue = totalQty * unitCost
    }

    result.push({
      sku_id: skuData.sku_id,
      sku_code: skuData.sku_code,
      sku_name: skuData.sku_name,
      unit: skuData.unit,
      total_quantity: Math.round(totalQty * 100) / 100,
      total_value: Math.round(totalValue * 100) / 100,
      unit_cost: Math.round(unitCost * 100) / 100,
      costing_method: costingMethod,
    })
  }

  return result
}

/**
 * 儲存估價快照
 *
 * @param {Array} valuations - getInventoryValuation 的回傳結果
 * @param {string} valuationDate - 估價日期 (YYYY-MM-DD)
 * @returns {Array} 已插入的快照資料
 */
export async function saveValuationSnapshot(valuations, valuationDate) {
  const rows = valuations.map(v => ({
    sku_id: v.sku_id,
    valuation_date: valuationDate || new Date().toISOString().split('T')[0],
    costing_method: v.costing_method,
    total_quantity: v.total_quantity,
    total_value: v.total_value,
    unit_cost: v.unit_cost,
  }))

  const { data, error } = await supabase
    .from('inventory_valuations')
    .insert(rows)
    .select()

  if (error) throw error
  return data
}
