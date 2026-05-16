import { round2 } from './constants'

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
