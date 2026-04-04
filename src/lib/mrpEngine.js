/**
 * MRP 物料需求計畫引擎
 *
 * 核心功能：
 * 1. MRP 展開（多階 BOM 遞迴展開）— 純函式 + Supabase 版
 * 2. 淨需求計算（毛需求 - 庫存 - 在途）
 * 3. 計畫訂單產生（含前置時間偏移）
 * 4. 採購建議（依供應商分組）
 * 5. 產能需求計畫（CRP）
 * 6. Supabase-backed BOM explosion + MRP run
 */

import { supabase } from './supabase'

// ══════════════════════════════════════
//  1. BOM 遞迴展開（純函式版 — 向後相容）
// ══════════════════════════════════════

/**
 * 遞迴展開 BOM（物料清單）— 純函式，不依賴 DB
 *
 * @param {string} productCode - 產品代碼
 * @param {number} qty - 需求數量
 * @param {Array} boms - BOM 資料 [{parent_code, component_code, component_name, qty_per, lead_time_days}]
 * @param {number} level - 展開層級（0 = 成品）
 * @returns {Array} 展開後的物料清單（扁平化）
 */
export function explodeBOM(productCode, qty, boms, level = 0) {
  const result = []
  const children = boms.filter(b => b.parent_code === productCode)

  for (const child of children) {
    const requiredQty = qty * (child.qty_per || 1)

    result.push({
      component_code: child.component_code,
      component_name: child.component_name || child.component_code,
      required_qty: requiredQty,
      level: level + 1,
      parent: productCode,
    })

    // 遞迴展開子組件
    const subComponents = explodeBOM(child.component_code, requiredQty, boms, level + 1)
    result.push(...subComponents)
  }

  return result
}

// ══════════════════════════════════════
//  1b. Supabase-backed BOM 遞迴展開
// ══════════════════════════════════════

/**
 * 從 bom_lines 表遞迴展開多階 BOM（Supabase 版）
 *
 * @param {number} bomId - BOM ID
 * @param {number} quantity - 需求數量
 * @param {number} level - 展開層級
 * @param {Set} visited - 已訪問的 BOM ID（防止循環引用）
 * @returns {Promise<Array>} 展開後的扁平物料清單
 *   [{ skuId, skuCode, skuName, requiredQty, level, bomPath, unit, scrapRate, unitCost }]
 */
export async function explodeBOMFromDB(bomId, quantity = 1, level = 0, visited = new Set()) {
  // 防止循環引用
  if (visited.has(bomId)) {
    console.warn(`BOM 循環引用檢測: bomId=${bomId}`)
    return []
  }
  visited.add(bomId)

  try {
    const { data: lines, error } = await supabase
      .from('bom_lines')
      .select('*, skus(id, code, name, unit, cost)')
      .eq('bom_id', bomId)
      .order('id')

    if (error) throw error
    if (!lines || lines.length === 0) return []

    const result = []

    for (const line of lines) {
      const requiredQty = quantity * (line.quantity || 1) * (1 + (line.scrap_rate || 0) / 100)
      const sku = line.skus || {}

      if (line.is_sub_assembly && line.sub_bom_id) {
        // 子組件本身也加入結果（標記為子組件）
        result.push({
          skuId: line.component_sku_id,
          skuCode: sku.code || '—',
          skuName: sku.name || '子組件',
          requiredQty,
          level: level + 1,
          bomPath: `BOM#${bomId}`,
          unit: line.unit || sku.unit || 'pcs',
          scrapRate: line.scrap_rate || 0,
          unitCost: sku.cost || 0,
          isSubAssembly: true,
          subBomId: line.sub_bom_id,
        })

        // 遞迴展開子組件
        const subResults = await explodeBOMFromDB(line.sub_bom_id, requiredQty, level + 1, new Set(visited))
        result.push(...subResults)
      } else {
        // 原物料
        result.push({
          skuId: line.component_sku_id,
          skuCode: sku.code || '—',
          skuName: sku.name || '未知',
          requiredQty,
          level: level + 1,
          bomPath: `BOM#${bomId}`,
          unit: line.unit || sku.unit || 'pcs',
          scrapRate: line.scrap_rate || 0,
          unitCost: sku.cost || 0,
          isSubAssembly: false,
          subBomId: null,
        })
      }
    }

    // 匯總同一 SKU（合併數量）
    const aggregated = new Map()
    for (const item of result) {
      const key = `${item.skuId}-${item.level}`
      if (aggregated.has(key)) {
        const existing = aggregated.get(key)
        existing.requiredQty += item.requiredQty
      } else {
        aggregated.set(key, { ...item })
      }
    }

    return Array.from(aggregated.values())
  } catch (err) {
    console.error('explodeBOMFromDB 失敗:', err)
    throw err
  }
}

// ══════════════════════════════════════
//  2. 前置時間偏移計算
// ══════════════════════════════════════

export function calculateLeadTimeOffset(dueDate, leadTimeDays) {
  const due = new Date(dueDate)
  const start = new Date(due)
  start.setDate(start.getDate() - (leadTimeDays || 0))
  return start.toISOString().split('T')[0]
}

// ══════════════════════════════════════
//  3. 核心 MRP 展開運算（純函式版 — 向後相容）
// ══════════════════════════════════════

export function runMRP(demandOrders, boms, stockLevels, openPOs) {
  const grossRequirements = {}

  for (const order of demandOrders) {
    const components = explodeBOM(order.product_code, order.qty, boms)
    const allItems = [
      {
        component_code: order.product_code,
        component_name: order.product_code,
        required_qty: order.qty,
        level: 0,
        parent: null,
      },
      ...components,
    ]

    for (const item of allItems) {
      const code = item.component_code
      if (!grossRequirements[code]) {
        grossRequirements[code] = { total_qty: 0, earliest_due: order.due_date, level: item.level }
      }
      grossRequirements[code].total_qty += item.required_qty
      if (new Date(order.due_date) < new Date(grossRequirements[code].earliest_due)) {
        grossRequirements[code].earliest_due = order.due_date
      }
      if (item.level > grossRequirements[code].level) {
        grossRequirements[code].level = item.level
      }
    }
  }

  const onOrderQty = {}
  for (const po of (openPOs || [])) {
    if (!onOrderQty[po.product_code]) onOrderQty[po.product_code] = 0
    onOrderQty[po.product_code] += po.qty
  }

  const plannedOrders = []
  const shortages = []

  for (const [code, req] of Object.entries(grossRequirements)) {
    const stock = stockLevels?.[code] || { on_hand: 0, safety_stock: 0 }
    const onHand = stock.on_hand || 0
    const safetyStock = stock.safety_stock || 0
    const onOrder = onOrderQty[code] || 0
    const netReq = req.total_qty + safetyStock - onHand - onOrder

    if (netReq > 0) {
      const bomEntry = boms.find(b => b.component_code === code)
      const leadTime = bomEntry?.lead_time_days || 0
      const dueDate = req.earliest_due
      const startDate = calculateLeadTimeOffset(dueDate, leadTime)

      plannedOrders.push({ product: code, qty: netReq, start_date: startDate, due_date: dueDate, level: req.level })
      shortages.push({ product: code, qty_short: netReq, earliest_need: dueDate })
    }
  }

  plannedOrders.sort((a, b) => a.level - b.level)

  return {
    plannedOrders,
    shortages,
    summary: { total_items: plannedOrders.length, shortage_count: shortages.length },
  }
}

// ══════════════════════════════════════
//  3b. Supabase-backed MRP 運算
// ══════════════════════════════════════

/**
 * 從 Supabase 讀取真實資料執行 MRP
 *
 * @param {Object} options
 *   - demandSource: 'sales_orders' | 'manual'
 *   - planningHorizon: number (days)
 *   - manualDemand: Array (for manual mode) [{sku_id, sku_code, sku_name, quantity}]
 * @returns {Promise<Array>} MRP 結果列表
 *   [{ sku_id, sku_code, sku_name, gross_requirement, on_hand, on_order,
 *      net_requirement, action: 'manufacture'|'purchase', suggested_quantity,
 *      suggested_date, bom_id }]
 */
export async function runMRPFromDB(options = {}) {
  const { demandSource = 'sales_orders', planningHorizon = 30, manualDemand = [] } = options

  try {
    // ── Step 1: Gather demand ──
    let demandBySku = {} // { sku_id: { sku_code, sku_name, quantity, due_date } }

    if (demandSource === 'sales_orders') {
      // Get open sales orders
      const { data: salesOrders, error: soErr } = await supabase
        .from('sales_orders')
        .select('*')
        .not('status', 'in', '("已完成","已取消")')

      if (soErr) throw soErr

      // Try to get sales order lines first
      const orderIds = (salesOrders || []).map(so => so.id)
      let hasLines = false

      if (orderIds.length > 0) {
        const { data: soLines, error: lineErr } = await supabase
          .from('sales_order_lines')
          .select('*, skus(id, code, name)')
          .in('order_id', orderIds)

        if (!lineErr && soLines && soLines.length > 0) {
          hasLines = true
          for (const line of soLines) {
            const skuId = line.sku_id
            const sku = line.skus || {}
            const so = salesOrders.find(s => s.id === line.order_id)
            const dueDate = so?.delivery_date || so?.due_date || so?.created_at

            if (!demandBySku[skuId]) {
              demandBySku[skuId] = {
                sku_code: sku.code || `SKU-${skuId}`,
                sku_name: sku.name || '未知品項',
                quantity: 0,
                due_date: dueDate,
              }
            }
            demandBySku[skuId].quantity += (line.quantity || 0)
            // Keep the earliest due date
            if (dueDate && new Date(dueDate) < new Date(demandBySku[skuId].due_date)) {
              demandBySku[skuId].due_date = dueDate
            }
          }
        }
      }

      // Fall back to header-level if no lines
      if (!hasLines && salesOrders) {
        for (const so of salesOrders) {
          // Use a pseudo sku_id based on product info
          const key = so.product_code || so.product_name || `SO-${so.id}`
          if (!demandBySku[key]) {
            demandBySku[key] = {
              sku_code: so.product_code || key,
              sku_name: so.product_name || key,
              quantity: 0,
              due_date: so.delivery_date || so.due_date || so.created_at,
            }
          }
          demandBySku[key].quantity += (so.quantity || so.qty || 1)
        }
      }
    } else {
      // Manual demand
      for (const item of manualDemand) {
        demandBySku[item.sku_id || item.sku_code] = {
          sku_code: item.sku_code,
          sku_name: item.sku_name,
          quantity: item.quantity || 0,
          due_date: new Date(Date.now() + planningHorizon * 86400000).toISOString().split('T')[0],
        }
      }
    }

    // ── Step 2: Check current stock ──
    const { data: stockData, error: stockErr } = await supabase
      .from('stock_levels')
      .select('*')

    if (stockErr) throw stockErr

    // Build stock map: sku_code -> { on_hand }
    const stockMap = {}
    for (const s of (stockData || [])) {
      const code = s.sku_code || s.product_code || s.item_code || s.code
      if (code) {
        if (!stockMap[code]) stockMap[code] = { on_hand: 0 }
        stockMap[code].on_hand += (s.on_hand || s.quantity || s.qty || 0)
      }
    }

    // ── Step 2b: On-order from open POs ──
    const { data: poData, error: poErr } = await supabase
      .from('purchase_orders')
      .select('*')
      .not('status', 'in', '("已完成","已取消","已關閉")')

    if (poErr) throw poErr

    const onOrderMap = {} // sku_code -> qty
    for (const po of (poData || [])) {
      if (po.items && Array.isArray(po.items)) {
        for (const item of po.items) {
          const code = item.product_code || item.code || item.sku_code
          if (code) {
            if (!onOrderMap[code]) onOrderMap[code] = 0
            onOrderMap[code] += (item.qty || item.quantity || 0)
          }
        }
      } else {
        const code = po.product_code || po.item_code || po.sku_code
        if (code) {
          if (!onOrderMap[code]) onOrderMap[code] = 0
          onOrderMap[code] += (po.quantity || po.qty || 0)
        }
      }
    }

    // ── Step 3: BOM explosion for finished goods ──
    // Load all BOMs to check which demanded SKUs have BOMs
    const { data: allBoms, error: bomErr } = await supabase
      .from('bom')
      .select('*')
      .eq('status', '使用中')

    if (bomErr) throw bomErr

    // Map product_code -> bom record
    const bomByCode = {}
    for (const bom of (allBoms || [])) {
      if (bom.product_code) bomByCode[bom.product_code] = bom
    }

    // For finished goods with a BOM, explode to raw materials
    const rawMaterialDemand = {} // sku_code -> { sku_name, quantity, source_bom_id }

    for (const [key, demand] of Object.entries(demandBySku)) {
      const bom = bomByCode[demand.sku_code]
      if (bom) {
        // This is a finished good — explode BOM
        // Use bom_lines if available, fall back to JSONB components
        const { data: bomLines } = await supabase
          .from('bom_lines')
          .select('*, skus(id, code, name, unit, cost)')
          .eq('bom_id', bom.id)
          .order('id')

        if (bomLines && bomLines.length > 0) {
          // Use structured bom_lines
          const exploded = await explodeBOMFromDB(bom.id, demand.quantity)
          for (const item of exploded) {
            if (!item.isSubAssembly) {
              const code = item.skuCode
              if (!rawMaterialDemand[code]) {
                rawMaterialDemand[code] = { sku_id: item.skuId, sku_name: item.skuName, quantity: 0, source_bom_id: bom.id }
              }
              rawMaterialDemand[code].quantity += item.requiredQty
            }
          }
        } else if (bom.components && Array.isArray(bom.components)) {
          // Fall back to JSONB components
          for (const c of bom.components) {
            const code = c.code || c.name
            if (!rawMaterialDemand[code]) {
              rawMaterialDemand[code] = { sku_name: c.name, quantity: 0, source_bom_id: bom.id }
            }
            rawMaterialDemand[code].quantity += (c.qty || 1) * demand.quantity
          }
        }
      }
    }

    // ── Step 4: Generate suggestions ──
    const results = []

    // Process finished goods demand
    for (const [key, demand] of Object.entries(demandBySku)) {
      const code = demand.sku_code
      const onHand = stockMap[code]?.on_hand || 0
      const onOrder = onOrderMap[code] || 0
      const netReq = demand.quantity - onHand - onOrder
      const hasBom = !!bomByCode[code]

      results.push({
        sku_id: typeof key === 'number' ? key : null,
        sku_code: code,
        sku_name: demand.sku_name,
        gross_requirement: demand.quantity,
        on_hand: onHand,
        on_order: onOrder,
        net_requirement: Math.max(0, netReq),
        action: hasBom ? 'manufacture' : 'purchase',
        suggested_quantity: Math.max(0, netReq),
        suggested_date: demand.due_date || new Date().toISOString().split('T')[0],
        bom_id: hasBom ? bomByCode[code].id : null,
      })
    }

    // Process raw material demand from BOM explosion
    for (const [code, demand] of Object.entries(rawMaterialDemand)) {
      // Check if already in results
      const existing = results.find(r => r.sku_code === code)
      if (existing) {
        existing.gross_requirement += demand.quantity
        existing.net_requirement = Math.max(0, existing.gross_requirement - existing.on_hand - existing.on_order)
        existing.suggested_quantity = existing.net_requirement
      } else {
        const onHand = stockMap[code]?.on_hand || 0
        const onOrder = onOrderMap[code] || 0
        const netReq = demand.quantity - onHand - onOrder

        results.push({
          sku_id: demand.sku_id || null,
          sku_code: code,
          sku_name: demand.sku_name,
          gross_requirement: Math.round(demand.quantity * 100) / 100,
          on_hand: onHand,
          on_order: onOrder,
          net_requirement: Math.max(0, Math.round(netReq * 100) / 100),
          action: 'purchase',
          suggested_quantity: Math.max(0, Math.round(netReq * 100) / 100),
          suggested_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
          bom_id: null,
          source_bom_id: demand.source_bom_id,
        })
      }
    }

    // ── Step 5: Save results ──
    if (results.length > 0) {
      const toSave = results
        .filter(r => r.net_requirement > 0)
        .map(r => ({
          product_name: r.sku_name,
          order_qty: r.gross_requirement,
          status: r.net_requirement > 0 ? '有缺料' : '無缺料',
          components: JSON.stringify([{
            name: r.sku_code,
            need: r.gross_requirement,
            stock: r.on_hand,
          }]),
        }))

      if (toSave.length > 0) {
        await supabase.from('mrp_results').insert(toSave)
      }
    }

    return results
  } catch (err) {
    console.error('runMRPFromDB 失敗:', err)
    throw err
  }
}

// ══════════════════════════════════════
//  4. 採購建議
// ══════════════════════════════════════

export function generatePurchaseSuggestions(shortages, suppliers) {
  const supplierMap = {}
  for (const s of (suppliers || [])) {
    if (!supplierMap[s.product_code]) supplierMap[s.product_code] = s
  }

  const grouped = {}

  for (const shortage of (shortages || [])) {
    const supplier = supplierMap[shortage.product] || {
      supplier_id: 'UNKNOWN',
      supplier_name: '未指定供應商',
      unit_price: 0,
      moq: 1,
    }

    const moq = supplier.moq || 1
    const orderQty = Math.ceil(shortage.qty_short / moq) * moq
    const key = supplier.supplier_id
    if (!grouped[key]) {
      grouped[key] = { supplier_id: supplier.supplier_id, supplier_name: supplier.supplier_name, items: [], total_amount: 0 }
    }

    const unitPrice = supplier.unit_price || 0
    const amount = orderQty * unitPrice

    grouped[key].items.push({
      product_code: shortage.product,
      qty: orderQty,
      unit_price: unitPrice,
      amount,
      need_date: shortage.earliest_need,
    })

    grouped[key].total_amount += amount
  }

  return Object.values(grouped)
}

// ══════════════════════════════════════
//  5. 產能需求計畫（CRP）
// ══════════════════════════════════════

export function calculateCapacityRequirements(plannedOrders, workCenters) {
  const result = []

  for (const wc of (workCenters || [])) {
    const hoursMap = {}
    for (const p of (wc.products || [])) {
      hoursMap[p.product_code] = p.hours_per_unit || 0
    }

    let requiredHours = 0
    for (const order of (plannedOrders || [])) {
      const hoursPerUnit = hoursMap[order.product] || 0
      requiredHours += order.qty * hoursPerUnit
    }

    let workDays = 1
    if (plannedOrders && plannedOrders.length > 0) {
      const dates = plannedOrders.map(o => new Date(o.start_date))
      const dueDates = plannedOrders.map(o => new Date(o.due_date))
      const earliest = new Date(Math.min(...dates))
      const latest = new Date(Math.max(...dueDates))
      const diffMs = latest - earliest
      workDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
    }

    const availableHours = (wc.available_hours_per_day || 8) * workDays
    const utilizationPct = availableHours > 0
      ? Math.round((requiredHours / availableHours) * 10000) / 100
      : 0

    result.push({
      workCenter: wc.name || wc.work_center_id,
      required_hours: Math.round(requiredHours * 100) / 100,
      available_hours: Math.round(availableHours * 100) / 100,
      utilization_pct: utilizationPct,
      overloaded: requiredHours > availableHours,
    })
  }

  return result
}
