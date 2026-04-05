/**
 * 採購流程模組 (Purchase Workflow Module)
 * 涵蓋：請購簽核、PO 版本控管、部分收貨、發票凍結、供應商評鑑、詢價比價
 * 純函式設計（無資料庫相依），適用於台灣中小企業 ERP
 */

// ============================================================
// 1. 請購單簽核路由 (PR Approval Routing)
// ============================================================

/** 依金額門檻決定所需簽核層級 */
const PR_APPROVAL_LEVELS = [
  { maxAmount: 10000, role: 'supervisor', label: '主管' },
  { maxAmount: 50000, role: 'manager', label: '經理' },
  { maxAmount: 200000, role: 'director', label: '處長' },
  { maxAmount: Infinity, role: 'ceo', label: '總經理' },
]

/**
 * 根據金額取得所需的簽核層級
 * @param {number} amount - 請購金額 (NTD)
 * @returns {{ maxAmount: number, role: string, label: string }} 簽核層級
 */
export function getPRApprovalLevel(amount) {
  if (typeof amount !== 'number' || amount < 0) {
    throw new Error('金額必須為非負數值')
  }
  const rounded = Math.round(amount * 100) / 100
  return PR_APPROVAL_LEVELS.find((lvl) => rounded <= lvl.maxAmount)
}

/**
 * 驗證簽核者是否具有該請購單的簽核權限
 * @param {{ amount: number }} pr - 請購單（至少含 amount）
 * @param {{ role: string, name?: string }} approver - 簽核者資訊
 * @returns {{ authorized: boolean, requiredRole: string, requiredLabel: string, reason?: string }}
 */
export function validatePRApproval(pr, approver) {
  const level = getPRApprovalLevel(pr.amount)
  const roleRank = PR_APPROVAL_LEVELS.map((l) => l.role)
  const requiredIdx = roleRank.indexOf(level.role)
  const approverIdx = roleRank.indexOf(approver.role)

  if (approverIdx === -1) {
    return {
      authorized: false,
      requiredRole: level.role,
      requiredLabel: level.label,
      reason: `簽核者角色 "${approver.role}" 不在核准層級中`,
    }
  }

  // 簽核者層級必須 >= 所需層級（index 越大權限越高）
  const authorized = approverIdx >= requiredIdx
  return {
    authorized,
    requiredRole: level.role,
    requiredLabel: level.label,
    reason: authorized
      ? undefined
      : `需要 ${level.label} 以上層級核准（目前為 ${PR_APPROVAL_LEVELS[approverIdx].label}）`,
  }
}

/**
 * 處理請購單簽核決定，回傳更新後的請購單
 * @param {object} pr - 請購單物件
 * @param {{ role: string, name: string }} approver - 簽核者
 * @param {'approved'|'rejected'} decision - 簽核決定
 * @param {string} [comments=''] - 備註
 * @returns {object} 更新後的請購單（含 approval 紀錄）
 */
export function processPRApproval(pr, approver, decision, comments = '') {
  const validation = validatePRApproval(pr, approver)
  if (!validation.authorized) {
    return {
      ...pr,
      status: pr.status, // 維持原狀
      approval: {
        success: false,
        error: validation.reason,
        timestamp: new Date().toISOString(),
      },
    }
  }

  const newStatus = decision === 'approved' ? '已核准' : '已駁回'
  return {
    ...pr,
    status: newStatus,
    approval: {
      success: true,
      decision,
      approvedBy: approver.name,
      approverRole: approver.role,
      comments,
      timestamp: new Date().toISOString(),
    },
  }
}

// ============================================================
// 2. 採購單版本控管 (PO Versioning)
// ============================================================

/**
 * 建立採購單新版本，保留歷史紀錄
 * @param {object} po - 目前的採購單
 * @param {object} changes - 欲變更的欄位 (key-value)
 * @param {string} changedBy - 變更人員
 * @param {string} reason - 變更原因
 * @returns {{ updatedPO: object, versionRecord: object }}
 */
export function createPOVersion(po, changes, changedBy, reason) {
  const currentVersion = po.version || 1
  const newVersion = currentVersion + 1

  // 快照目前版本
  const versionRecord = {
    version: currentVersion,
    snapshot: { ...po },
    changedBy,
    reason,
    changes: {},
    timestamp: new Date().toISOString(),
  }

  // 逐欄記錄差異
  for (const key of Object.keys(changes)) {
    if (key === 'version' || key === 'versionHistory') continue
    const oldVal = po[key]
    const newVal = changes[key]
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      versionRecord.changes[key] = { from: oldVal, to: newVal }
    }
  }

  // 金額欄位四捨五入
  const updatedPO = { ...po, ...changes, version: newVersion }
  if (typeof updatedPO.totalAmount === 'number') {
    updatedPO.totalAmount = Math.round(updatedPO.totalAmount * 100) / 100
  }

  return { updatedPO, versionRecord }
}

/**
 * 取得 PO 版本變更紀錄（格式化）
 * @param {object[]} versions - versionRecord 陣列
 * @returns {object[]} 格式化的變更紀錄
 */
export function getPOVersionHistory(versions) {
  return versions
    .sort((a, b) => b.version - a.version) // 最新在前
    .map((v) => ({
      version: v.version,
      changedBy: v.changedBy,
      reason: v.reason,
      timestamp: v.timestamp,
      changeCount: Object.keys(v.changes).length,
      summary: Object.entries(v.changes)
        .map(([field, { from, to }]) => `${field}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`)
        .join('；'),
    }))
}

/**
 * 比較兩個 PO 版本，回傳逐欄差異
 * @param {object} v1 - 版本 1 快照
 * @param {object} v2 - 版本 2 快照
 * @returns {object[]} 差異陣列 [{ field, v1Value, v2Value, changed }]
 */
export function comparePOVersions(v1, v2) {
  const allKeys = new Set([...Object.keys(v1), ...Object.keys(v2)])
  const diffs = []

  for (const key of allKeys) {
    if (key === 'versionHistory') continue
    const val1 = v1[key]
    const val2 = v2[key]
    const changed = JSON.stringify(val1) !== JSON.stringify(val2)
    diffs.push({ field: key, v1Value: val1, v2Value: val2, changed })
  }

  return diffs
}

// ============================================================
// 3. 部分收貨 (Partial Goods Receipt)
// ============================================================

/** 收貨容差（允許超收 2%） */
const GR_OVER_RECEIPT_TOLERANCE = 0.02

/**
 * 處理部分收貨，更新各行項 received_qty 並計算剩餘
 * @param {object} po - 採購單（含 items 陣列，每項有 itemCode, qty, received_qty）
 * @param {{ itemCode: string, qty: number }[]} receivedItems - 本次收貨明細
 * @returns {{ updatedPO: object, receipt: object }}
 */
export function processPartialGR(po, receivedItems) {
  const receiptLines = []
  const updatedItems = (po.items || []).map((item) => {
    const received = receivedItems.find((r) => r.itemCode === item.itemCode)
    if (!received) return { ...item }

    const prevReceived = item.received_qty || 0
    const newReceived = Math.round((prevReceived + received.qty) * 100) / 100
    const remaining = Math.round((item.qty - newReceived) * 100) / 100
    const maxAllowed = Math.round(item.qty * (1 + GR_OVER_RECEIPT_TOLERANCE) * 100) / 100

    if (newReceived > maxAllowed) {
      receiptLines.push({
        itemCode: item.itemCode,
        accepted: false,
        reason: `超過允收上限（已收 ${newReceived}，上限 ${maxAllowed}）`,
        receivedThisTime: 0,
      })
      return { ...item }
    }

    receiptLines.push({
      itemCode: item.itemCode,
      accepted: true,
      receivedThisTime: received.qty,
      totalReceived: newReceived,
      remaining: Math.max(remaining, 0),
    })

    return { ...item, received_qty: newReceived }
  })

  // 檢查是否有未對應到 PO 行項的收貨品項
  for (const received of receivedItems) {
    const exists = (po.items || []).some((i) => i.itemCode === received.itemCode)
    if (!exists) {
      receiptLines.push({
        itemCode: received.itemCode,
        accepted: false,
        reason: '該品項不在採購單中',
        receivedThisTime: 0,
      })
    }
  }

  return {
    updatedPO: { ...po, items: updatedItems },
    receipt: {
      poId: po.id,
      lines: receiptLines,
      timestamp: new Date().toISOString(),
    },
  }
}

/**
 * 取得 PO 各行項及整體的到貨履行率
 * @param {object} po - 採購單
 * @param {object[]} grRecords - 收貨紀錄陣列
 * @returns {{ lines: object[], overallFulfillment: number }}
 */
export function getPOFulfillmentStatus(po, grRecords) {
  // 彙總各品項的累計收貨量
  const receivedMap = {}
  for (const gr of grRecords) {
    for (const line of (gr.lines || [])) {
      if (!line.accepted) continue
      receivedMap[line.itemCode] = (receivedMap[line.itemCode] || 0) + (line.receivedThisTime || 0)
    }
  }

  let totalOrdered = 0
  let totalReceived = 0

  const lines = (po.items || []).map((item) => {
    const received = Math.round((receivedMap[item.itemCode] || 0) * 100) / 100
    const ordered = item.qty || 0
    const fulfillment = ordered > 0 ? Math.round((received / ordered) * 10000) / 100 : 0

    totalOrdered += ordered
    totalReceived += received

    return {
      itemCode: item.itemCode,
      ordered,
      received,
      remaining: Math.round(Math.max(ordered - received, 0) * 100) / 100,
      fulfillmentPercent: fulfillment,
    }
  })

  const overallFulfillment =
    totalOrdered > 0
      ? Math.round((totalReceived / totalOrdered) * 10000) / 100
      : 0

  return { lines, overallFulfillment }
}

/**
 * 判斷是否可結案（所有行項在容差內已全數收貨）
 * @param {object} po - 採購單
 * @param {object[]} grRecords - 收貨紀錄陣列
 * @returns {{ canClose: boolean, reason?: string, fulfillment: object }}
 */
export function canClosePO(po, grRecords) {
  const fulfillment = getPOFulfillmentStatus(po, grRecords)
  const tolerance = GR_OVER_RECEIPT_TOLERANCE

  const unfulfilledLines = fulfillment.lines.filter((line) => {
    const minPercent = (1 - tolerance) * 100
    return line.fulfillmentPercent < minPercent
  })

  if (unfulfilledLines.length > 0) {
    const details = unfulfilledLines
      .map((l) => `${l.itemCode}（${l.fulfillmentPercent}%）`)
      .join('、')
    return {
      canClose: false,
      reason: `以下品項尚未達到收貨門檻：${details}`,
      fulfillment,
    }
  }

  return { canClose: true, fulfillment }
}

// ============================================================
// 4. 發票凍結 (Invoice Hold on Mismatch)
// ============================================================

/** 凍結原因代碼 */
export const HOLD_REASONS = {
  PRICE_MISMATCH: { code: 'PRICE_MISMATCH', label: '價格不符' },
  QTY_MISMATCH: { code: 'QTY_MISMATCH', label: '數量不符' },
  PO_NOT_FOUND: { code: 'PO_NOT_FOUND', label: '找不到對應採購單' },
  GR_NOT_FOUND: { code: 'GR_NOT_FOUND', label: '找不到對應收貨單' },
  DUPLICATE_INVOICE: { code: 'DUPLICATE_INVOICE', label: '重複發票' },
  TAX_MISMATCH: { code: 'TAX_MISMATCH', label: '稅額不符' },
  TOTAL_MISMATCH: { code: 'TOTAL_MISMATCH', label: '總額不符' },
  VENDOR_MISMATCH: { code: 'VENDOR_MISMATCH', label: '供應商不符' },
}

/**
 * 根據三方比對結果決定凍結或放行
 * @param {{ matched: boolean, discrepancies?: object[] }} matchResult - 三方比對結果
 * @returns {{ action: 'hold'|'release', reasons: string[] }}
 */
export function evaluateInvoiceHold(matchResult) {
  if (matchResult.matched) {
    return { action: 'release', reasons: [] }
  }

  const reasons = (matchResult.discrepancies || []).map((d) => {
    // 根據差異類型對應到凍結原因
    if (d.type === 'price') return HOLD_REASONS.PRICE_MISMATCH.code
    if (d.type === 'qty') return HOLD_REASONS.QTY_MISMATCH.code
    if (d.type === 'tax') return HOLD_REASONS.TAX_MISMATCH.code
    if (d.type === 'total') return HOLD_REASONS.TOTAL_MISMATCH.code
    if (d.type === 'vendor') return HOLD_REASONS.VENDOR_MISMATCH.code
    return d.type || 'UNKNOWN'
  })

  return {
    action: 'hold',
    reasons: [...new Set(reasons)], // 去重
  }
}

/**
 * 建立發票凍結紀錄
 * @param {string} invoiceId - 發票編號
 * @param {string} reason - 凍結原因代碼（HOLD_REASONS 中的 code）
 * @param {object} matchResult - 三方比對結果
 * @returns {object} 凍結紀錄
 */
export function createHoldRecord(invoiceId, reason, matchResult) {
  const reasonInfo = Object.values(HOLD_REASONS).find((r) => r.code === reason)
  return {
    id: `HOLD-${invoiceId}-${Date.now()}`,
    invoiceId,
    reasonCode: reason,
    reasonLabel: reasonInfo ? reasonInfo.label : reason,
    matchResult,
    status: '凍結中',
    createdAt: new Date().toISOString(),
    releasedAt: null,
    releasedBy: null,
    releaseNotes: null,
  }
}

/**
 * 解除發票凍結
 * @param {object} holdRecord - 凍結紀錄
 * @param {string} approvedBy - 解除人員
 * @param {string} [notes=''] - 解除備註
 * @returns {object} 更新後的凍結紀錄
 */
export function releaseHold(holdRecord, approvedBy, notes = '') {
  if (holdRecord.status !== '凍結中') {
    return {
      ...holdRecord,
      error: `無法解除：目前狀態為「${holdRecord.status}」`,
    }
  }

  return {
    ...holdRecord,
    status: '已解除',
    releasedAt: new Date().toISOString(),
    releasedBy: approvedBy,
    releaseNotes: notes,
  }
}

// ============================================================
// 5. 供應商評鑑 (Vendor Scorecard)
// ============================================================

/** 評鑑權重 */
const SCORE_WEIGHTS = {
  onTimeDelivery: 0.4,
  quality: 0.3,
  priceCompetitiveness: 0.2,
  responsiveness: 0.1,
}

/**
 * 計算供應商綜合評分 (0-100)
 * @param {{ onTime: boolean, totalDays?: number, promisedDays?: number }[]} deliveries - 交貨紀錄
 * @param {{ totalItems: number, defectItems: number }[]} qualityRecords - 品質紀錄
 * @param {{ vendorPrice: number, marketAvg: number }[]} priceHistory - 價格歷史
 * @returns {{ totalScore: number, breakdown: object }}
 */
export function calculateVendorScore(deliveries, qualityRecords, priceHistory) {
  // --- 準時交貨率 (40%) ---
  let onTimeScore = 0
  if (deliveries.length > 0) {
    const onTimeCount = deliveries.filter((d) => d.onTime).length
    onTimeScore = Math.round((onTimeCount / deliveries.length) * 10000) / 100
  }

  // --- 品質良率 (30%) ---
  let qualityScore = 0
  if (qualityRecords.length > 0) {
    const totalItems = qualityRecords.reduce((sum, r) => sum + (r.totalItems || 0), 0)
    const defectItems = qualityRecords.reduce((sum, r) => sum + (r.defectItems || 0), 0)
    qualityScore = totalItems > 0
      ? Math.round(((totalItems - defectItems) / totalItems) * 10000) / 100
      : 0
  }

  // --- 價格競爭力 (20%) ---
  // 以市場均價為基準，越低於均價分數越高
  let priceScore = 0
  if (priceHistory.length > 0) {
    const ratios = priceHistory.map((p) => {
      if (p.marketAvg <= 0) return 1
      return p.vendorPrice / p.marketAvg
    })
    const avgRatio = ratios.reduce((sum, r) => sum + r, 0) / ratios.length
    // ratio 0.8 → 100 分, ratio 1.0 → 80 分, ratio 1.2 → 60 分
    priceScore = Math.max(0, Math.min(100, Math.round((180 - avgRatio * 100) * 100) / 100))
  }

  // --- 回應速度 (10%) ---
  // 以交貨天數 vs 承諾天數計算
  let responsivenessScore = 0
  const deliveriesWithDays = deliveries.filter(
    (d) => typeof d.totalDays === 'number' && typeof d.promisedDays === 'number'
  )
  if (deliveriesWithDays.length > 0) {
    const ratios = deliveriesWithDays.map((d) => {
      if (d.promisedDays <= 0) return 1
      return d.totalDays / d.promisedDays
    })
    const avgRatio = ratios.reduce((sum, r) => sum + r, 0) / ratios.length
    // ratio <= 1 → 滿分，ratio 2 → 0 分
    responsivenessScore = Math.max(0, Math.min(100, Math.round((200 - avgRatio * 100) * 100) / 100))
  }

  // 綜合加權分數
  const totalScore = Math.round(
    (onTimeScore * SCORE_WEIGHTS.onTimeDelivery +
      qualityScore * SCORE_WEIGHTS.quality +
      priceScore * SCORE_WEIGHTS.priceCompetitiveness +
      responsivenessScore * SCORE_WEIGHTS.responsiveness) *
      100
  ) / 100

  return {
    totalScore,
    breakdown: {
      onTimeDelivery: { score: onTimeScore, weight: SCORE_WEIGHTS.onTimeDelivery },
      quality: { score: qualityScore, weight: SCORE_WEIGHTS.quality },
      priceCompetitiveness: { score: priceScore, weight: SCORE_WEIGHTS.priceCompetitiveness },
      responsiveness: { score: responsivenessScore, weight: SCORE_WEIGHTS.responsiveness },
    },
  }
}

/**
 * 根據分數回傳 A/B/C/D/F 等級
 * @param {number} score - 綜合評分 (0-100)
 * @returns {{ grade: string, label: string }}
 */
export function getVendorRating(score) {
  if (score >= 90) return { grade: 'A', label: '優良' }
  if (score >= 80) return { grade: 'B', label: '良好' }
  if (score >= 70) return { grade: 'C', label: '合格' }
  if (score >= 60) return { grade: 'D', label: '待改善' }
  return { grade: 'F', label: '不合格' }
}

/**
 * 產生供應商趨勢分析報告
 * @param {{ id: string, name: string }} vendor - 供應商基本資料
 * @param {{ period: string, score: number }[]} scoreHistory - 各期評分
 * @returns {object} 趨勢報告
 */
export function generateVendorReport(vendor, scoreHistory) {
  if (!scoreHistory || scoreHistory.length === 0) {
    return {
      vendor,
      currentScore: null,
      currentRating: null,
      trend: '無資料',
      history: [],
    }
  }

  const sorted = [...scoreHistory].sort((a, b) => (a.period > b.period ? 1 : -1))
  const latest = sorted[sorted.length - 1]
  const currentRating = getVendorRating(latest.score)

  // 趨勢判斷：比較最近三期
  let trend = '持平'
  if (sorted.length >= 2) {
    const recent = sorted.slice(-3)
    const diffs = []
    for (let i = 1; i < recent.length; i++) {
      diffs.push(recent[i].score - recent[i - 1].score)
    }
    const avgDiff = diffs.reduce((s, d) => s + d, 0) / diffs.length
    if (avgDiff > 2) trend = '上升'
    else if (avgDiff < -2) trend = '下降'
  }

  // 統計數據
  const scores = sorted.map((s) => s.score)
  const avg = Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100
  const max = Math.max(...scores)
  const min = Math.min(...scores)

  return {
    vendor,
    currentScore: latest.score,
    currentRating,
    trend,
    statistics: { average: avg, max, min, periods: sorted.length },
    history: sorted.map((s) => ({
      period: s.period,
      score: s.score,
      rating: getVendorRating(s.score),
    })),
  }
}

// ============================================================
// 6. 詢價比價 (RFQ - Request for Quotation)
// ============================================================

/**
 * 建立詢價單，發送給多家供應商
 * @param {{ itemCode: string, description: string, qty: number }[]} items - 詢價品項
 * @param {{ id: string, name: string }[]} vendors - 受邀供應商
 * @param {string} deadline - 報價截止日 (ISO 日期字串)
 * @returns {object} RFQ 物件
 */
export function createRFQ(items, vendors, deadline) {
  if (!items || items.length === 0) {
    throw new Error('詢價品項不得為空')
  }
  if (!vendors || vendors.length === 0) {
    throw new Error('至少需選擇一家供應商')
  }

  return {
    id: `RFQ-${Date.now()}`,
    status: '詢價中',
    items: items.map((item) => ({
      ...item,
      qty: Math.round((item.qty || 0) * 100) / 100,
    })),
    vendors: vendors.map((v) => ({
      ...v,
      status: '待報價',
      quotation: null,
    })),
    deadline,
    createdAt: new Date().toISOString(),
    responses: [],
  }
}

/**
 * 評估供應商報價回覆，依價格/交期/品質排名
 * @param {{ vendorId: string, vendorName: string, items: { itemCode: string, unitPrice: number, leadDays: number, qualityScore?: number }[] }[]} responses
 * @returns {object[]} 排名後的評估結果
 */
export function evaluateRFQResponses(responses) {
  if (!responses || responses.length === 0) return []

  return responses.map((resp) => {
    const totalPrice = resp.items.reduce(
      (sum, item) => sum + Math.round((item.unitPrice || 0) * (item.qty || 1) * 100) / 100,
      0
    )
    const avgLeadDays =
      resp.items.reduce((sum, item) => sum + (item.leadDays || 0), 0) / resp.items.length
    const avgQuality =
      resp.items.reduce((sum, item) => sum + (item.qualityScore || 80), 0) / resp.items.length

    return {
      vendorId: resp.vendorId,
      vendorName: resp.vendorName,
      totalPrice: Math.round(totalPrice * 100) / 100,
      avgLeadDays: Math.round(avgLeadDays * 100) / 100,
      avgQuality: Math.round(avgQuality * 100) / 100,
      items: resp.items,
    }
  }).sort((a, b) => a.totalPrice - b.totalPrice)
}

/**
 * 以加權評分法選出最佳供應商
 * @param {object[]} evaluatedResponses - evaluateRFQResponses 的回傳結果
 * @param {{ price?: number, leadTime?: number, quality?: number }} [weights] - 權重（預設 price:0.5, leadTime:0.3, quality:0.2）
 * @returns {{ winner: object, rankings: object[] }}
 */
export function selectBestVendor(evaluatedResponses, weights = {}) {
  const w = {
    price: weights.price ?? 0.5,
    leadTime: weights.leadTime ?? 0.3,
    quality: weights.quality ?? 0.2,
  }

  if (evaluatedResponses.length === 0) {
    return { winner: null, rankings: [] }
  }

  // 正規化：找出最佳（最低價、最短交期、最高品質）作為基準
  const minPrice = Math.min(...evaluatedResponses.map((r) => r.totalPrice || 1))
  const minLead = Math.min(...evaluatedResponses.map((r) => r.avgLeadDays || 1))
  const maxQuality = Math.max(...evaluatedResponses.map((r) => r.avgQuality || 1))

  const rankings = evaluatedResponses.map((resp) => {
    // 價格分數：最低價 = 100，越高越低分
    const priceScore = minPrice > 0 ? Math.round((minPrice / (resp.totalPrice || 1)) * 10000) / 100 : 100
    // 交期分數：最短 = 100
    const leadScore = minLead > 0 ? Math.round((minLead / (resp.avgLeadDays || 1)) * 10000) / 100 : 100
    // 品質分數：直接用百分比
    const qualityScore = maxQuality > 0 ? Math.round((resp.avgQuality / maxQuality) * 10000) / 100 : 100

    const weightedScore = Math.round(
      (priceScore * w.price + leadScore * w.leadTime + qualityScore * w.quality) * 100
    ) / 100

    return {
      ...resp,
      scores: { price: priceScore, leadTime: leadScore, quality: qualityScore },
      weightedScore,
    }
  }).sort((a, b) => b.weightedScore - a.weightedScore)

  return {
    winner: rankings[0],
    rankings,
  }
}

/**
 * 將詢價單轉為採購單
 * @param {object} rfq - RFQ 物件
 * @param {object} selectedVendor - selectBestVendor 回傳的 winner（含 items, vendorId, vendorName）
 * @returns {object} 新建的採購單
 */
export function convertRFQToPO(rfq, selectedVendor) {
  if (!selectedVendor) {
    throw new Error('未選定供應商，無法轉採購單')
  }

  const items = (selectedVendor.items || []).map((item) => ({
    itemCode: item.itemCode,
    description: (rfq.items || []).find((ri) => ri.itemCode === item.itemCode)?.description || '',
    qty: Math.round((item.qty || 0) * 100) / 100,
    unitPrice: Math.round((item.unitPrice || 0) * 100) / 100,
    amount: Math.round((item.unitPrice || 0) * (item.qty || 0) * 100) / 100,
    leadDays: item.leadDays,
    received_qty: 0,
  }))

  const totalAmount = items.reduce((sum, i) => sum + i.amount, 0)

  return {
    id: `PO-${Date.now()}`,
    rfqId: rfq.id,
    vendorId: selectedVendor.vendorId,
    vendorName: selectedVendor.vendorName,
    items,
    totalAmount: Math.round(totalAmount * 100) / 100,
    status: '待核准',
    version: 1,
    createdAt: new Date().toISOString(),
  }
}

// ============================================================
// 匯出常數
// ============================================================

export { PR_APPROVAL_LEVELS, SCORE_WEIGHTS, GR_OVER_RECEIPT_TOLERANCE }
