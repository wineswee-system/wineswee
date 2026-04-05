/**
 * Gemini AI 服務模組
 *
 * 整合 Google Gemini API，提供 ERP 智慧助理功能：
 * - 聊天對話（Agent Console）
 * - ERP 資料分析與洞察
 * - 文件摘要與分類
 * - 異常偵測建議
 */

import { GoogleGenerativeAI } from '@google/generative-ai'

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY

let genAI = null
let chatSessions = new Map()

function getClient() {
  if (!API_KEY || API_KEY === 'your_gemini_api_key_here') {
    throw new Error('請在 .env 設定 VITE_GEMINI_API_KEY')
  }
  if (!genAI) {
    genAI = new GoogleGenerativeAI(API_KEY)
  }
  return genAI
}

// ─── System prompt for ERP assistant ────────────────────────
const ERP_SYSTEM_PROMPT = `你是 SME Ops AI 助理，一個專為台灣中小企業 ERP 系統設計的智慧助手。

你的能力包括：
- 分析財務資料（應收帳款、應付帳款、損益表、資產負債表）
- 人力資源管理（出勤、薪資、排班、勞基法合規）
- 庫存與倉儲管理（庫存水位、成本計算、MRP）
- 採購管理（供應商評估、三方比對、採購建議）
- 銷售與 CRM（客戶分析、銷售預測、行銷活動）
- 製造管理（BOM、生產排程、品質檢驗）
- 台灣法規合規（勞基法、營業稅 401 表、扣繳 403 表、電子發票）

回應規則：
1. 使用繁體中文回應
2. 數字使用千分位格式（例：NT$1,234,567）
3. 回應簡潔實用，直接給出建議或分析
4. 如果涉及法規，引用具體法條
5. 提供可執行的建議，不只是描述問題
6. 如果資料不足，說明需要哪些額外資訊`

// ─── Core chat function ─────────────────────────────────────

/**
 * Send a message to Gemini and get a response.
 * Maintains conversation history per sessionId.
 */
export async function chat(userMessage, sessionId = 'default') {
  const client = getClient()
  const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' })

  if (!chatSessions.has(sessionId)) {
    const chatSession = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: `系統指令：${ERP_SYSTEM_PROMPT}` }],
        },
        {
          role: 'model',
          parts: [{ text: '了解，我是 SME Ops AI 助理，隨時準備協助您處理 ERP 相關問題。' }],
        },
      ],
    })
    chatSessions.set(sessionId, chatSession)
  }

  const session = chatSessions.get(sessionId)
  const result = await session.sendMessage(userMessage)
  return result.response.text()
}

/** Clear a chat session to start fresh */
export function clearSession(sessionId = 'default') {
  chatSessions.delete(sessionId)
}

// ─── ERP-specific AI functions ──────────────────────────────

/**
 * Analyze financial data and provide insights
 */
export async function analyzeFinancials(data) {
  const client = getClient()
  const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const prompt = `作為 ERP 財務分析師，分析以下財務資料並提供洞察：

${JSON.stringify(data, null, 2)}

請提供：
1. 關鍵指標摘要
2. 異常或需要注意的項目
3. 改善建議
4. 與上期比較的趨勢（如有資料）

以 JSON 格式回覆：
{
  "summary": "整體摘要",
  "metrics": [{"name": "指標名", "value": "數值", "status": "good/warning/critical"}],
  "anomalies": ["異常項目..."],
  "recommendations": ["建議..."]
}`

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  try {
    return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, ''))
  } catch {
    return { summary: text, metrics: [], anomalies: [], recommendations: [] }
  }
}

/**
 * Predict demand / sales forecast
 */
export async function forecastDemand(salesHistory, options = {}) {
  const client = getClient()
  const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const prompt = `作為需求預測分析師，根據以下銷售歷史資料預測未來需求：

銷售歷史：
${JSON.stringify(salesHistory, null, 2)}

預測期間：${options.periods || 3} 期
產品類別：${options.category || '全部'}

請提供：
1. 各期預測數量與金額
2. 預測信心水準
3. 季節性因素分析
4. 建議安全庫存水位
5. 採購建議時間點

以 JSON 格式回覆：
{
  "forecasts": [{"period": "期間", "quantity": 0, "revenue": 0, "confidence": 0.0}],
  "seasonality": "季節性分析",
  "safetyStock": 0,
  "purchaseTiming": "建議",
  "methodology": "使用的方法說明"
}`

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  try {
    return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, ''))
  } catch {
    return { forecasts: [], seasonality: text, safetyStock: 0, purchaseTiming: '', methodology: '' }
  }
}

/**
 * Score and classify a supplier based on performance data
 */
export async function evaluateSupplier(supplierData) {
  const client = getClient()
  const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const prompt = `評估以下供應商的表現：

${JSON.stringify(supplierData, null, 2)}

請評估以下面向（各 0-100 分）：
1. 交期準確率
2. 品質合格率
3. 價格競爭力
4. 服務回應速度
5. 整體合作穩定度

以 JSON 格式回覆：
{
  "overallScore": 0,
  "grade": "A/B/C/D",
  "scores": {"delivery": 0, "quality": 0, "pricing": 0, "responsiveness": 0, "stability": 0},
  "strengths": ["優勢..."],
  "risks": ["風險..."],
  "recommendation": "建議"
}`

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  try {
    return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, ''))
  } catch {
    return { overallScore: 0, grade: 'N/A', scores: {}, strengths: [], risks: [], recommendation: text }
  }
}

/**
 * Detect anomalies in payroll data
 */
export async function detectPayrollAnomalies(payrollRecords) {
  const client = getClient()
  const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const prompt = `檢查以下薪資資料是否有異常：

${JSON.stringify(payrollRecords, null, 2)}

請檢查：
1. 加班時數異常（超過勞基法上限 46 小時/月）
2. 薪資計算錯誤（勞保/健保/勞退扣款是否正確）
3. 同部門薪資差異是否合理
4. 請假與出勤矛盾
5. 其他統計異常

以 JSON 格式回覆：
{
  "status": "clean/warning/critical",
  "anomalyCount": 0,
  "anomalies": [{"employee": "姓名", "type": "類型", "severity": "high/medium/low", "detail": "說明"}],
  "complianceIssues": ["合規問題..."],
  "suggestions": ["改善建議..."]
}`

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  try {
    return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, ''))
  } catch {
    return { status: 'unknown', anomalyCount: 0, anomalies: [], complianceIssues: [], suggestions: [text] }
  }
}

/**
 * Classify and extract data from a document (invoice, receipt, contract)
 */
export async function classifyDocument(textContent, docType = 'auto') {
  const client = getClient()
  const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const prompt = `分析以下文件內容並擷取結構化資料：

文件類型提示：${docType}
文件內容：
${textContent}

請辨識文件類型並擷取關鍵欄位，以 JSON 格式回覆：
{
  "documentType": "invoice/receipt/contract/purchase_order/other",
  "confidence": 0.0,
  "extractedFields": {
    "vendor": "",
    "date": "",
    "totalAmount": 0,
    "taxAmount": 0,
    "invoiceNumber": "",
    "lineItems": [{"description": "", "quantity": 0, "unitPrice": 0, "amount": 0}]
  },
  "warnings": ["需注意事項..."]
}`

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  try {
    return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, ''))
  } catch {
    return { documentType: 'unknown', confidence: 0, extractedFields: {}, warnings: [text] }
  }
}

/**
 * Generate marketing email content using AI
 * (Replaces rule-based aiTemplateEngine for actual content generation)
 */
export async function generateMarketingContent(options = {}) {
  const client = getClient()
  const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const { purpose = 'promotion', tone = 'professional', industry = '一般', productName = '', targetAudience = '' } = options

  const prompt = `產生一封行銷 Email，條件如下：
- 目的：${purpose}
- 語氣：${tone}
- 產業：${industry}
- 產品/服務：${productName}
- 目標受眾：${targetAudience}

請產生：
{
  "subject": "Email 主旨（30字以內）",
  "preheader": "預覽文字（50字以內）",
  "heading": "標題",
  "body": "正文（HTML 格式）",
  "cta": "行動呼籲按鈕文字",
  "footer": "頁尾文字"
}`

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  try {
    return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, ''))
  } catch {
    return { subject: '', preheader: '', heading: '', body: text, cta: '', footer: '' }
  }
}

/**
 * Categorize a bank transaction for reconciliation
 */
export async function categorizeTransaction(transaction, chartOfAccounts) {
  const client = getClient()
  const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const prompt = `將以下銀行交易分類到適當的會計科目：

交易資料：
${JSON.stringify(transaction, null, 2)}

可用會計科目：
${JSON.stringify(chartOfAccounts, null, 2)}

以 JSON 格式回覆：
{
  "accountCode": "科目代碼",
  "accountName": "科目名稱",
  "confidence": 0.0,
  "reasoning": "分類原因",
  "suggestedMemo": "建議備註"
}`

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  try {
    return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, ''))
  } catch {
    return { accountCode: '', accountName: '', confidence: 0, reasoning: text, suggestedMemo: '' }
  }
}

/** Check if the Gemini API key is configured */
export function isConfigured() {
  return !!API_KEY && API_KEY !== 'your_gemini_api_key_here'
}
