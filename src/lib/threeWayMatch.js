/**
 * 三方比對引擎 (Three-Way Matching)
 * 比對：採購單 (PO) vs 收貨單 (GR) vs 供應商發票/應付帳款 (AP/Invoice)
 * 用途：確保付款前數量、價格、總額一致，防止錯誤或舞弊
 */
import { supabase } from './supabase'

// 容差設定：允許 1% 或 NT$10 差異（取較大者）
const TOLERANCE_PERCENT = 0.01
const TOLERANCE_AMOUNT = 10

/**
 * 檢查兩個金額是否在容差範圍內
 */
function withinTolerance(a, b) {
  const diff = Math.abs(a - b)
  const base = Math.max(Math.abs(a), Math.abs(b), 1)
  const percentThreshold = base * TOLERANCE_PERCENT
  const threshold = Math.max(percentThreshold, TOLERANCE_AMOUNT)
  return diff <= threshold
}

/**
 * 計算差異百分比
 */
function variancePercent(a, b) {
  const base = Math.max(Math.abs(a), 1)
  return ((b - a) / base) * 100
}

/**
 * 計算價格差異（向下相容舊的呼叫方式）
 */
export function calculatePriceVariance(poPrice, invoicePrice) {
  const variance = invoicePrice - poPrice
  const percentage = poPrice !== 0 ? Math.abs(variance) / poPrice : 0
  const favorable = variance < 0
  return { variance, percentage, favorable }
}

// 舊的容差常數（向下相容）
export const MATCH_TOLERANCES = {
  qty: 0.02,
  price: 0.01,
  total: 0.05,
}

/**
 * 舊版三方比對函式（物件傳入式，向下相容 GoodsReceipts.jsx / PurchaseOrders.jsx）
 */
export function performThreeWayMatchLegacy(purchaseOrder, goodsReceipt, invoice, tolerances = MATCH_TOLERANCES) {
  const discrepancies = []
  let allMatched = true

  const poItems = {}
  for (const item of (purchaseOrder.items || [])) {
    poItems[item.itemCode] = item
  }
  const grItems = {}
  for (const item of (goodsReceipt.items || [])) {
    grItems[item.itemCode] = item
  }
  const invItems = {}
  for (const item of (invoice.items || [])) {
    invItems[item.itemCode] = item
  }

  const allItemCodes = new Set([
    ...Object.keys(poItems),
    ...Object.keys(grItems),
    ...Object.keys(invItems),
  ])

  for (const itemCode of allItemCodes) {
    const po = poItems[itemCode]
    const gr = grItems[itemCode]
    const inv = invItems[itemCode]

    if (!po || !gr || !inv) {
      discrepancies.push({
        field: `item_existence_${itemCode}`,
        po_value: po ? '存在' : '缺少',
        gr_value: gr ? '存在' : '缺少',
        inv_value: inv ? '存在' : '缺少',
        variance: 'missing_item',
      })
      allMatched = false
      continue
    }

    const poQty = po.qty || 0
    const grQty = gr.receivedQty != null ? gr.receivedQty : (gr.qty || 0)
    const invQty = inv.qty || 0

    const qtyVariancePOvsGR = poQty !== 0 ? Math.abs(grQty - poQty) / poQty : (grQty === 0 ? 0 : 1)
    const qtyVariancePOvsInv = poQty !== 0 ? Math.abs(invQty - poQty) / poQty : (invQty === 0 ? 0 : 1)

    if (qtyVariancePOvsGR > tolerances.qty || qtyVariancePOvsInv > tolerances.qty) {
      discrepancies.push({
        field: `qty_${itemCode}`,
        po_value: poQty,
        gr_value: grQty,
        inv_value: invQty,
        variance: Math.max(qtyVariancePOvsGR, qtyVariancePOvsInv),
      })
      allMatched = false
    }

    const poPrice = po.unitPrice || 0
    const invPrice = inv.unitPrice || 0
    const priceVar = calculatePriceVariance(poPrice, invPrice)

    if (priceVar.percentage > tolerances.price) {
      discrepancies.push({
        field: `price_${itemCode}`,
        po_value: poPrice,
        gr_value: '-',
        inv_value: invPrice,
        variance: priceVar.percentage,
      })
      allMatched = false
    }
  }

  const poTotal = purchaseOrder.total || 0
  const invTotal = invoice.total || 0
  const totalVariance = poTotal !== 0 ? Math.abs(invTotal - poTotal) / poTotal : (invTotal === 0 ? 0 : 1)

  if (totalVariance > tolerances.total) {
    discrepancies.push({
      field: 'total',
      po_value: poTotal,
      gr_value: '-',
      inv_value: invTotal,
      variance: totalVariance,
    })
    allMatched = false
  }

  const autoApprove = allMatched && discrepancies.length === 0

  return {
    matched: allMatched,
    discrepancies,
    toleranceUsed: { ...tolerances },
    autoApprove,
  }
}

// 保留舊名稱匯出，讓現有頁面不壞
export { performThreeWayMatchLegacy as performThreeWayMatch }

/**
 * 計算 PO 的總金額（含稅、運費）
 */
function calcPOTotal(po) {
  const itemsTotal = Array.isArray(po.line_items)
    ? po.line_items.reduce((sum, li) => sum + ((parseFloat(li.qty) || 0) * (parseFloat(li.unit_price) || 0)), 0)
    : 0
  const base = po.total_amount || itemsTotal || 0
  return base + (parseFloat(po.tax) || 0) + (parseFloat(po.shipping) || 0)
}

/**
 * 計算 GR 的收貨總金額（以 PO 單價 * 收貨數量計算）
 */
function calcGRTotal(grRecords, poLineItems) {
  let total = 0
  const grItemsSummary = []
  for (const gr of grRecords) {
    const items = gr.received_items || gr.items || []
    if (Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        const code = item.product || item.itemCode || 'ITEM'
        const qty = parseFloat(item.received_qty || item.receivedQty || item.qty) || 0
        // 嘗試從 PO line items 找到對應單價
        const poItem = (poLineItems || []).find(p =>
          (p.product || p.itemCode) === code
        )
        const unitPrice = parseFloat(item.unit_price || item.unitPrice || poItem?.unit_price || poItem?.unitPrice) || 0
        total += qty * unitPrice
        grItemsSummary.push({ code, qty, unitPrice })
      }
    }
  }
  return { total, items: grItemsSummary }
}

/**
 * 執行三方比對（資料庫版本）
 * @param {number} poId - 採購單 ID
 * @returns {Object} 比對結果
 */
export async function performThreeWayMatchById(poId) {
  try {
    // 1. 取得 PO
    const { data: po, error: poErr } = await supabase
      .from('purchase_orders').select('*').eq('id', poId).maybeSingle()
    if (poErr) throw poErr
    if (!po) return { error: `找不到採購單 ID: ${poId}` }

    const poAmount = calcPOTotal(po)
    const poItems = po.line_items || []

    // 2. 取得所有對應的 GR
    const { data: grRecords, error: grErr } = await supabase
      .from('goods_receipts').select('*').eq('po_id', poId).order('id')
    if (grErr) throw grErr

    const grData = calcGRTotal(grRecords || [], poItems)
    const grTotal = grData.total || poAmount // 如果 GR 沒有明細，預設使用 PO 金額
    const grCount = (grRecords || []).length

    // 3. 取得對應的 AP
    const { data: allAP, error: apErr } = await supabase
      .from('accounts_payable').select('*').order('id', { ascending: false })
    if (apErr) throw apErr

    const poNumber = po.po_number || `PO-${String(po.id).padStart(3, '0')}`
    const matchingAPs = (allAP || []).filter(ap =>
      ap.po_id === poId ||
      ap.reference?.includes(String(poId)) ||
      ap.reference?.includes(poNumber)
    )
    const apTotal = matchingAPs.reduce((sum, ap) => sum + (parseFloat(ap.amount) || 0), 0)
    const apItems = matchingAPs

    // 4. 比對
    const discrepancies = []

    const poVsGr = {
      match: withinTolerance(poAmount, grTotal),
      variance: grTotal - poAmount,
      variancePercent: variancePercent(poAmount, grTotal),
    }
    if (!poVsGr.match) {
      discrepancies.push(`GR 總額 (NT$${grTotal.toLocaleString()}) 與 PO (NT$${poAmount.toLocaleString()}) 差異 ${poVsGr.variancePercent.toFixed(1)}%`)
    }

    const poVsAp = {
      match: withinTolerance(poAmount, apTotal),
      variance: apTotal - poAmount,
      variancePercent: variancePercent(poAmount, apTotal),
    }
    if (!poVsAp.match) {
      discrepancies.push(`AP 總額 (NT$${apTotal.toLocaleString()}) 與 PO (NT$${poAmount.toLocaleString()}) 差異 ${poVsAp.variancePercent.toFixed(1)}%`)
    }

    const grVsAp = {
      match: withinTolerance(grTotal, apTotal),
      variance: apTotal - grTotal,
      variancePercent: variancePercent(grTotal, apTotal),
    }
    if (!grVsAp.match) {
      discrepancies.push(`AP 總額 (NT$${apTotal.toLocaleString()}) 與 GR (NT$${grTotal.toLocaleString()}) 差異 ${grVsAp.variancePercent.toFixed(1)}%`)
    }

    // 品項層級比對
    if (Array.isArray(poItems) && poItems.length > 0 && grData.items.length > 0) {
      for (const poItem of poItems) {
        const code = poItem.product || poItem.itemCode || 'ITEM'
        const poQty = parseFloat(poItem.qty) || 0
        const grMatch = grData.items.filter(g => g.code === code)
        const grQty = grMatch.reduce((s, g) => s + g.qty, 0)
        if (poQty > 0 && Math.abs(grQty - poQty) > 0 && !withinTolerance(poQty, grQty)) {
          discrepancies.push(`品項 ${code}: GR 收貨 ${grQty} 件，PO 訂購 ${poQty} 件 (差異 ${(grQty - poQty)} 件)`)
        }
      }
    }

    const overallMatch = poVsGr.match && poVsAp.match && grVsAp.match
    let status = 'matched'
    if (!overallMatch) {
      const matchCount = [poVsGr.match, poVsAp.match, grVsAp.match].filter(Boolean).length
      status = matchCount >= 1 ? 'partial_match' : 'mismatch'
    }

    return {
      poId,
      poNumber,
      supplier: po.supplier,
      poAmount,
      poItems,
      grTotal,
      grItems: grData.items,
      grCount,
      apTotal,
      apItems,
      matches: {
        po_vs_gr: poVsGr,
        po_vs_ap: poVsAp,
        gr_vs_ap: grVsAp,
      },
      overallMatch,
      discrepancies,
      status,
      // 原始資料供展開明細使用
      _po: po,
      _grRecords: grRecords || [],
      _apRecords: matchingAPs,
    }
  } catch (err) {
    console.error('三方比對錯誤:', err)
    return { error: err.message || '比對過程發生錯誤' }
  }
}

/**
 * 取得日期範圍內所有 PO 的比對摘要
 */
export async function getMatchingSummary(startDate, endDate) {
  try {
    // 取得日期範圍內的 PO（有至少一筆 GR）
    let poQuery = supabase.from('purchase_orders').select('*').order('id', { ascending: false })
    if (startDate) poQuery = poQuery.gte('created_at', startDate)
    if (endDate) poQuery = poQuery.lte('created_at', endDate + 'T23:59:59')

    const { data: orders, error: poErr } = await poQuery
    if (poErr) throw poErr

    // 取得所有 GR，建立 po_id 索引
    const { data: allGR } = await supabase.from('goods_receipts').select('id, po_id').order('id')
    const grByPO = {}
    for (const gr of (allGR || [])) {
      if (!grByPO[gr.po_id]) grByPO[gr.po_id] = []
      grByPO[gr.po_id].push(gr)
    }

    // 只處理有 GR 的 PO
    const posWithGR = (orders || []).filter(po => grByPO[po.id]?.length > 0)

    // 批次執行比對
    const results = []
    for (const po of posWithGR) {
      const matchResult = await performThreeWayMatchById(po.id)
      if (!matchResult.error) {
        results.push(matchResult)
      } else {
        results.push({
          poId: po.id,
          poNumber: po.po_number || `PO-${String(po.id).padStart(3, '0')}`,
          supplier: po.supplier,
          poAmount: calcPOTotal(po),
          grTotal: 0,
          apTotal: 0,
          status: 'mismatch',
          discrepancies: [matchResult.error],
          overallMatch: false,
        })
      }
    }

    return results
  } catch (err) {
    console.error('getMatchingSummary 錯誤:', err)
    return []
  }
}
