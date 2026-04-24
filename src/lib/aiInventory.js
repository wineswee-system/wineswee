/**
 * AI 庫存智慧引擎
 *
 * 整合 Gemini AI 提供 12 項智慧庫存管理功能：
 * 1. 自然語言庫存查詢（NL Inventory Query）
 * 2. AI 需求預測（Demand Forecasting）
 * 3. 智慧補貨助理（Smart Reorder）
 * 4. 效期與損耗減少（Expiry & Waste Reduction）
 * 5. 供應商風險評分（Supplier Risk Scoring）
 * 6. 呆滯庫存處理建議（Dead Stock Advisor）
 * 7. 智慧儲位優化（Slotting Optimization）
 * 8. 動態安全庫存（Dynamic Safety Stock）
 * 9. 跨店庫存平衡（Cross-Store Balancing）
 * 10. 收據 OCR 自動建檔（Receipt OCR）
 * 11. 品質預測（Quality Prediction）
 * 12. 視覺盤點（Visual Stock Count — camera placeholder）
 */

import { supabase } from './supabase'

function parseJSON(text) {
  try {
    return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
  } catch {
    return null
  }
}

// Route all Gemini calls through the server-side proxy so the API key
// never reaches the browser bundle.
async function ask(prompt) {
  const { data, error } = await supabase.functions.invoke('gemini-proxy', {
    body: { action: 'chat', payload: { message: prompt, history: [] } },
  })
  if (error) throw new Error(`AI 服務錯誤：${error.message || '請稍後再試'}`)
  if (data?.error) throw new Error(`AI 服務錯誤：${data.error}`)
  return data?.data?.text ?? ''
}

async function askJSON(prompt) {
  const text = await ask(prompt)
  return parseJSON(text) || { raw: text }
}

// ══════════════════════════════════════════════
//  1. 自然語言庫存查詢（NL Inventory Query）
// ══════════════════════════════════════════════

/**
 * 用自然語言查詢庫存，AI 解析意圖並產生結構化查詢
 *
 * @param {string} question - 使用者問題（中文）
 * @param {Object} context - 可用資料上下文
 * @returns {Object} { intent, answer, data, suggestions }
 */
export async function queryInventoryNL(question, context = {}) {
  const prompt = `你是台灣中小企業的倉儲管理 AI 助理。使用者用自然語言查詢庫存相關問題。

可用資料上下文：
- 商品清單：${JSON.stringify((context.skus || []).slice(0, 50).map(s => ({ code: s.code, name: s.name, stock: s.stock_qty, cost: s.unit_cost })))}
- 庫存水位：${JSON.stringify((context.stockLevels || []).slice(0, 50).map(s => ({ sku: s.sku_code, warehouse: s.warehouse, qty: s.quantity, min: s.min_qty })))}
- 近期異動：${JSON.stringify((context.recentTransactions || []).slice(0, 30).map(t => ({ sku: t.sku, date: t.date, type: t.type, qty: t.qty })))}
- 批號資料：${JSON.stringify((context.lots || []).slice(0, 20))}
- 倉庫清單：${JSON.stringify(context.warehouses || [])}

使用者問題：「${question}」

請以 JSON 格式回覆：
{
  "intent": "stock_query|expiry_check|movement_history|reorder_alert|lot_trace|warehouse_summary|general",
  "answer": "用繁體中文回答，數字用千分位格式",
  "data": [{"label": "欄位", "value": "值"}],
  "suggestions": ["後續可以問的問題1", "後續可以問的問題2"],
  "actionable": {"action": "none|reorder|transfer|adjust|markdown", "details": "具體可執行的建議"}
}`

  return askJSON(prompt)
}

// ══════════════════════════════════════════════
//  2. AI 需求預測（Demand Forecasting）
// ══════════════════════════════════════════════

/**
 * AI 增強的需求預測 — 考慮節日、天氣、促銷等外部因素
 *
 * @param {Object} params
 * @param {string} params.skuCode - 品號
 * @param {Array} params.history - 歷史銷售 [{period, demand}]
 * @param {Object} params.context - 附加上下文
 * @returns {Object} 預測結果
 */
export async function aiForecastDemand({ skuCode, skuName, history, context = {} }) {
  const prompt = `作為台灣零售/餐飲業需求預測專家，分析以下商品的銷售歷史並預測未來需求。

商品：${skuCode} - ${skuName || ''}
歷史需求（依月份）：
${JSON.stringify(history, null, 2)}

附加資訊：
- 商品分類：${context.category || '未知'}
- 目前庫存：${context.currentStock || 0}
- 單位成本：${context.unitCost || 0}
- 今天日期：${new Date().toISOString().slice(0, 10)}

請考慮以下台灣特有因素：
1. 農曆節日（春節、中秋、端午）
2. 百貨週年慶（10-11月）
3. 夏季飲品旺季（6-9月）
4. 歲末年終（12-1月）
5. 近期趨勢是上升還是下降

以 JSON 格式回覆：
{
  "forecasts": [{"period": "YYYY-MM", "predicted": 0, "lower": 0, "upper": 0}],
  "trend": "increasing|stable|decreasing",
  "trendExplanation": "趨勢說明",
  "seasonalFactors": ["影響因素1", "影響因素2"],
  "confidence": 0.0,
  "recommendations": {
    "suggestedReorderDate": "YYYY-MM-DD",
    "suggestedOrderQty": 0,
    "safetyStock": 0,
    "reasoning": "建議理由"
  },
  "risks": ["風險1", "風險2"]
}`

  return askJSON(prompt)
}

// ══════════════════════════════════════════════
//  3. 智慧補貨助理（Smart Reorder）
// ══════════════════════════════════════════════

/**
 * AI 分析多個品項的補貨需求，產生最佳採購策略
 *
 * @param {Object} params
 * @param {Array} params.alerts - 低庫存警示
 * @param {Array} params.suppliers - 供應商資料
 * @param {Object} params.constraints - 預算/空間限制
 * @returns {Object} 最佳化採購計畫
 */
export async function smartReorderPlan({ alerts, suppliers, constraints = {} }) {
  const prompt = `作為採購策略顧問，分析以下低庫存品項並產生最佳採購計畫。

低庫存品項：
${JSON.stringify(alerts, null, 2)}

可用供應商：
${JSON.stringify(suppliers, null, 2)}

限制條件：
- 本月採購預算：${constraints.budget ? `NT$${constraints.budget.toLocaleString()}` : '無限制'}
- 倉庫剩餘容量：${constraints.warehouseCapacity || '充足'}
- 現金流狀況：${constraints.cashFlow || '正常'}

請考慮：
1. 依供應商合併訂單以節省運費
2. 是否有批量折扣機會
3. 供應商交期可靠度
4. 付款條件最佳化（NET30 vs 即付）
5. 緊急程度排序（critical 先處理）

以 JSON 格式回覆：
{
  "strategy": "總體策略說明",
  "purchaseOrders": [
    {
      "supplier": "供應商名稱",
      "priority": "urgent|normal|can_wait",
      "items": [{"sku": "品號", "qty": 0, "unitCost": 0, "amount": 0}],
      "totalAmount": 0,
      "expectedDelivery": "YYYY-MM-DD",
      "paymentTerms": "付款條件",
      "notes": "備註"
    }
  ],
  "totalBudgetUsed": 0,
  "savings": {"amount": 0, "methods": ["節省方式"]},
  "deferrable": [{"sku": "品號", "reason": "可以延後的原因", "deferUntil": "YYYY-MM-DD"}],
  "risks": ["採購風險"]
}`

  return askJSON(prompt)
}

// ══════════════════════════════════════════════
//  4. 效期與損耗減少引擎（Expiry & Waste Reduction）
// ══════════════════════════════════════════════

/**
 * AI 分析即將到期商品並產生損耗減少策略
 *
 * @param {Object} params
 * @param {Array} params.expiringItems - 即將到期品項
 * @param {Array} params.salesHistory - 銷售歷史
 * @returns {Object} 損耗減少方案
 */
export async function wasteReductionPlan({ expiringItems, salesHistory = [], currentPromotions = [] }) {
  const prompt = `作為食品/零售業損耗管理顧問，分析以下即將到期商品並制定損耗減少策略。

即將到期商品：
${JSON.stringify(expiringItems, null, 2)}

近期銷售速度：
${JSON.stringify(salesHistory.slice(0, 20), null, 2)}

目前進行中的促銷：
${JSON.stringify(currentPromotions, null, 2)}

請制定損耗減少方案：
1. 每個品項的建議處理方式（促銷折扣、組合銷售、員工福利、捐贈、報廢）
2. 建議折扣幅度
3. 預估可挽回的金額
4. 優先執行順序

以 JSON 格式回覆：
{
  "summary": "損耗分析摘要",
  "totalAtRiskValue": 0,
  "estimatedRecovery": 0,
  "estimatedWaste": 0,
  "actions": [
    {
      "sku": "品號",
      "skuName": "品名",
      "daysUntilExpiry": 0,
      "currentStock": 0,
      "atRiskValue": 0,
      "strategy": "markdown|bundle|employee_benefit|donate|scrap",
      "strategyLabel": "策略說明",
      "suggestedDiscount": 0,
      "estimatedRecovery": 0,
      "priority": "immediate|this_week|next_week",
      "bundleWith": "可搭配的商品（若為組合銷售）"
    }
  ],
  "preventionTips": ["未來預防建議"]
}`

  return askJSON(prompt)
}

// ══════════════════════════════════════════════
//  5. 供應商風險評分（Supplier Risk Scoring）
// ══════════════════════════════════════════════

/**
 * AI 綜合評估供應商風險
 *
 * @param {Object} params
 * @param {Object} params.supplier - 供應商基本資料
 * @param {Array} params.deliveryHistory - 交貨歷史
 * @param {Array} params.qualityRecords - 品質紀錄
 * @param {Array} params.returnHistory - 退貨紀錄
 * @returns {Object} 風險評估報告
 */
export async function assessSupplierRisk({ supplier, deliveryHistory = [], qualityRecords = [], returnHistory = [] }) {
  const prompt = `作為供應鏈風險分析師，評估以下供應商的風險等級。

供應商資料：
${JSON.stringify(supplier, null, 2)}

交貨紀錄（近 12 個月）：
${JSON.stringify(deliveryHistory.slice(0, 30), null, 2)}

品質紀錄：
${JSON.stringify(qualityRecords.slice(0, 20), null, 2)}

退貨紀錄：
${JSON.stringify(returnHistory.slice(0, 20), null, 2)}

請評估：
1. 交期可靠度（準時率、平均延遲天數）
2. 品質穩定度（合格率、退貨率）
3. 價格穩定度
4. 集中度風險（是否為唯一供應商）
5. 整體風險等級

以 JSON 格式回覆：
{
  "supplier": "${supplier.name || ''}",
  "riskLevel": "low|medium|high|critical",
  "overallScore": 0,
  "metrics": {
    "onTimeRate": 0,
    "avgDelayDays": 0,
    "qualityPassRate": 0,
    "returnRate": 0,
    "priceVariance": 0
  },
  "riskFactors": [
    {"factor": "風險因子", "severity": "high|medium|low", "detail": "說明", "mitigation": "緩解措施"}
  ],
  "trend": "improving|stable|deteriorating",
  "recommendation": "建議",
  "alternativeAction": "如果風險太高的替代方案"
}`

  return askJSON(prompt)
}

// ══════════════════════════════════════════════
//  6. 呆滯庫存處理建議（Dead Stock Advisor）
// ══════════════════════════════════════════════

/**
 * AI 產生呆滯庫存的處理方案
 *
 * @param {Object} params
 * @param {Array} params.deadItems - 呆滯品項
 * @param {Object} params.context - 公司上下文
 * @returns {Object} 處理方案
 */
export async function deadStockAdvisor({ deadItems, context = {} }) {
  const prompt = `作為庫存處分顧問，為以下呆滯庫存品項制定最佳處理方案。

呆滯品項：
${JSON.stringify(deadItems, null, 2)}

公司資訊：
- 產業：${context.industry || '零售/餐飲'}
- 有電商通路：${context.hasEcommerce ? '是' : '否'}
- 有員工福利需求：${context.hasEmployeeBenefit ? '是' : '否'}

每個品項請建議最佳處分方式，並計算各方案的 ROI。

以 JSON 格式回覆：
{
  "summary": "呆滯庫存分析摘要",
  "totalDeadValue": 0,
  "estimatedRecovery": 0,
  "writeOffAmount": 0,
  "items": [
    {
      "sku": "品號",
      "name": "品名",
      "currentValue": 0,
      "daysDead": 0,
      "recommendedAction": "discount_sale|bundle|return_to_supplier|donate|liquidate|write_off",
      "actionLabel": "處分方式",
      "estimatedRecovery": 0,
      "recoveryRate": 0,
      "reasoning": "建議理由",
      "steps": ["執行步驟1", "執行步驟2"],
      "deadline": "建議執行期限"
    }
  ],
  "taxBenefits": "捐贈或報廢可抵稅金額說明",
  "preventionPlan": ["未來如何避免呆滯庫存"]
}`

  return askJSON(prompt)
}

// ══════════════════════════════════════════════
//  7. 智慧儲位優化（Slotting Optimization）
// ══════════════════════════════════════════════

/**
 * AI 分析揀貨模式，建議最佳儲位配置
 *
 * @param {Object} params
 * @param {Array} params.pickHistory - 揀貨歷史
 * @param {Array} params.currentSlotting - 目前儲位配置
 * @param {Array} params.skuVelocity - SKU 周轉速度
 * @returns {Object} 儲位優化建議
 */
export async function optimizeSlotting({ pickHistory = [], currentSlotting = [], skuVelocity = [] }) {
  const prompt = `作為倉庫佈局優化顧問，分析揀貨模式並建議最佳儲位配置。

揀貨歷史（近 30 天）：
${JSON.stringify(pickHistory.slice(0, 50), null, 2)}

目前儲位配置：
${JSON.stringify(currentSlotting.slice(0, 30), null, 2)}

SKU 周轉速度排名：
${JSON.stringify(skuVelocity.slice(0, 30), null, 2)}

請分析：
1. 哪些 SKU 經常一起被揀取（關聯性分析）
2. 高周轉品項是否在最佳位置（靠近出貨區）
3. 走動路徑是否可以優化
4. 季節性調整建議

以 JSON 格式回覆：
{
  "currentEfficiency": 0,
  "projectedEfficiency": 0,
  "estimatedTimeSaving": "預估節省時間百分比",
  "frequentPairs": [{"sku1": "", "sku2": "", "coPickRate": 0, "suggestion": "建議放在相鄰儲位"}],
  "relocations": [
    {
      "sku": "品號",
      "skuName": "品名",
      "currentBin": "目前儲位",
      "suggestedBin": "建議儲位",
      "reason": "搬遷原因",
      "priority": "high|medium|low"
    }
  ],
  "zoneOptimization": [{"zone": "區域", "suggestion": "建議"}],
  "seasonalTips": ["季節性調整建議"]
}`

  return askJSON(prompt)
}

// ══════════════════════════════════════════════
//  8. 動態安全庫存（Dynamic Safety Stock）
// ══════════════════════════════════════════════

/**
 * AI 動態計算每個 SKU 的最佳安全庫存水位
 *
 * @param {Object} params
 * @param {Array} params.skuData - SKU 資料含歷史
 * @returns {Object} 安全庫存建議
 */
export async function dynamicSafetyStock({ skuData }) {
  const prompt = `作為庫存管理專家，為以下品項計算最佳安全庫存水位。

品項資料：
${JSON.stringify(skuData.slice(0, 30), null, 2)}

請考慮：
1. 需求變異性（標準差越大，安全庫存越高）
2. 供應商交期可靠度
3. 缺貨成本 vs 持有成本
4. 服務水準目標（95%）
5. 台灣特有的供應鏈風險（颱風季、春節工廠停工）

以 JSON 格式回覆：
{
  "methodology": "計算方法說明",
  "recommendations": [
    {
      "sku": "品號",
      "skuName": "品名",
      "currentSafetyStock": 0,
      "recommendedSafetyStock": 0,
      "reorderPoint": 0,
      "maxStock": 0,
      "reasoning": "調整理由",
      "demandVariability": "low|medium|high",
      "supplyRisk": "low|medium|high",
      "costImpact": "持有成本變化說明"
    }
  ],
  "totalCostImpact": "整體庫存持有成本影響",
  "seasonalAdjustments": [{"period": "期間", "adjustment": "調整建議"}]
}`

  return askJSON(prompt)
}

// ══════════════════════════════════════════════
//  9. 跨店庫存平衡（Cross-Store Balancing）
// ══════════════════════════════════════════════

/**
 * AI 分析各倉庫/門市庫存分佈，建議調撥方案
 *
 * @param {Object} params
 * @param {Array} params.warehouseStock - 各倉庫庫存
 * @param {Array} params.demandByLocation - 各點需求
 * @returns {Object} 調撥建議
 */
export async function crossStoreBalancing({ warehouseStock, demandByLocation = [] }) {
  const prompt = `作為供應鏈平衡顧問，分析以下各倉庫/門市庫存分佈並建議最佳調撥方案。

各倉庫庫存：
${JSON.stringify(warehouseStock, null, 2)}

各點需求預估：
${JSON.stringify(demandByLocation, null, 2)}

請分析：
1. 哪些品項在某些倉庫過剩、其他倉庫不足
2. 調撥的成本效益（運費 vs 缺貨損失）
3. 調撥優先順序
4. 長期分配策略建議

以 JSON 格式回覆：
{
  "imbalances": [
    {
      "sku": "品號",
      "skuName": "品名",
      "overstockedAt": [{"warehouse": "倉庫", "excess": 0}],
      "understockedAt": [{"warehouse": "倉庫", "shortage": 0}]
    }
  ],
  "transfers": [
    {
      "sku": "品號",
      "from": "來源倉庫",
      "to": "目的倉庫",
      "quantity": 0,
      "reason": "調撥原因",
      "priority": "urgent|normal",
      "estimatedCost": 0,
      "estimatedBenefit": 0
    }
  ],
  "summary": {
    "totalTransfers": 0,
    "estimatedCostSaving": 0,
    "stockoutPrevented": 0
  },
  "longTermStrategy": "長期分配策略建議"
}`

  return askJSON(prompt)
}

// ══════════════════════════════════════════════
//  10. 收據 OCR 自動建檔（Receipt OCR）
// ══════════════════════════════════════════════

/**
 * AI 解析供應商送貨單/發票文字，自動比對 PO
 *
 * @param {string} ocrText - OCR 擷取的文字內容
 * @param {Array} openPOs - 待驗收的 PO 清單
 * @returns {Object} 擷取結果與 PO 比對
 */
export async function parseReceiptOCR(ocrText, openPOs = []) {
  const prompt = `作為文件辨識專家，解析以下供應商送貨單/發票內容，並與待驗收採購單比對。

文件內容：
${ocrText}

待驗收採購單：
${JSON.stringify(openPOs.slice(0, 10), null, 2)}

請擷取並比對：
1. 供應商名稱
2. 發票/送貨單號
3. 日期
4. 各品項明細（品名、數量、單價、金額）
5. 與哪張 PO 對應
6. 數量/金額差異

以 JSON 格式回覆：
{
  "documentType": "invoice|delivery_note|receipt",
  "vendor": "供應商名稱",
  "documentNumber": "單號",
  "date": "YYYY-MM-DD",
  "lineItems": [
    {"description": "品名", "sku_match": "比對到的SKU", "quantity": 0, "unitPrice": 0, "amount": 0}
  ],
  "totalAmount": 0,
  "taxAmount": 0,
  "matchedPO": "PO-XXXX",
  "discrepancies": [
    {"item": "品名", "field": "qty|price|amount", "expected": 0, "actual": 0, "difference": 0}
  ],
  "confidence": 0.0,
  "warnings": ["需注意事項"],
  "suggestedAction": "auto_receive|review_required|reject"
}`

  return askJSON(prompt)
}

// ══════════════════════════════════════════════
//  11. 品質預測（Quality Prediction）
// ══════════════════════════════════════════════

/**
 * AI 預測進貨品質，建議 QC 策略
 *
 * @param {Object} params
 * @param {string} params.supplier - 供應商
 * @param {Array} params.historicalQuality - 歷史品質紀錄
 * @param {Object} params.incomingShipment - 即將到貨的批次
 * @returns {Object} 品質預測與 QC 建議
 */
export async function predictQuality({ supplier, historicalQuality = [], incomingShipment = {} }) {
  const prompt = `作為品質管理顧問，根據歷史資料預測即將到貨批次的品質，並建議 QC 策略。

供應商：${supplier}

歷史品質紀錄：
${JSON.stringify(historicalQuality.slice(0, 20), null, 2)}

即將到貨批次：
${JSON.stringify(incomingShipment, null, 2)}

請預測：
1. 預估不良率
2. 最可能出現的品質問題
3. 建議抽檢比率
4. 特別需要檢查的項目

以 JSON 格式回覆：
{
  "predictedDefectRate": 0,
  "confidence": 0.0,
  "riskLevel": "low|medium|high",
  "likelyIssues": [{"issue": "可能問題", "probability": 0, "severity": "high|medium|low"}],
  "qcRecommendation": {
    "inspectionLevel": "skip|sample|full",
    "sampleRate": 0,
    "focusAreas": ["重點檢查項目"],
    "specialInstructions": "特殊指示"
  },
  "historicalPattern": "歷史品質趨勢說明",
  "supplierFeedback": "建議回饋給供應商的品質改善事項"
}`

  return askJSON(prompt)
}

// ══════════════════════════════════════════════
//  12. 綜合庫存健康報告
// ══════════════════════════════════════════════

/**
 * AI 產生綜合庫存健康報告
 *
 * @param {Object} data - 所有庫存相關資料
 * @returns {Object} 健康報告
 */
export async function inventoryHealthReport(data) {
  const prompt = `作為庫存管理顧問，綜合分析以下資料並產生庫存健康報告。

庫存概況：
- 總品項數：${data.totalSkus || 0}
- 總庫存價值：NT$${(data.totalValue || 0).toLocaleString()}
- 低庫存品項：${data.lowStockCount || 0}
- 過剩品項：${data.overstockCount || 0}
- 即將到期：${data.expiringCount || 0}
- 呆滯品項：${data.deadStockCount || 0}
- 平均周轉率：${data.avgTurnover || 0}

近期異常：
${JSON.stringify(data.recentAnomalies || [], null, 2)}

供應商狀況：
${JSON.stringify(data.supplierSummary || [], null, 2)}

請產生綜合健康報告：

以 JSON 格式回覆：
{
  "healthScore": 0,
  "grade": "A|B|C|D|F",
  "summary": "一句話總結",
  "topIssues": [
    {"issue": "問題", "severity": "critical|warning|info", "impact": "影響金額或說明", "action": "建議行動"}
  ],
  "kpis": [
    {"name": "指標名稱", "current": 0, "target": 0, "status": "good|warning|critical", "trend": "up|stable|down"}
  ],
  "quickWins": ["立即可以執行的改善1", "立即可以執行的改善2"],
  "monthlyPlan": ["本月重點工作1", "本月重點工作2"],
  "estimatedSavings": "預估改善後可節省的金額"
}`

  return askJSON(prompt)
}

export function isAIConfigured() {
  return true
}
