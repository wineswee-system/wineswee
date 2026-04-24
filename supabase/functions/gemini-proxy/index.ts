import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ══════════════════════════════════════════════════════════════
//  Types
// ══════════════════════════════════════════════════════════════

interface ChatMessage {
  role: 'user' | 'model'
  parts: { text: string }[]
}

interface RequestBody {
  action: string
  payload: Record<string, unknown>
}

// ══════════════════════════════════════════════════════════════
//  Gemini REST helper (same raw-fetch pattern as scheduling-ai)
// ══════════════════════════════════════════════════════════════

async function callGemini(
  apiKey: string,
  model: string,
  contents: unknown[],
  generationConfig: Record<string, unknown> = {},
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig }),
  })
  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${err}`)
  }
  const data = await response.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════
//  ERP system prompt (mirrors gemini.js ERP_SYSTEM_PROMPT)
// ══════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════
//  Nav Assistant system prompt (mirrors navAssistant/engine.js)
// ══════════════════════════════════════════════════════════════

const NAV_SYSTEM_PROMPT = `你是 SME Ops 系統的「導覽助理」，專精人資 (HR) 與工作流程 (Workflow) 模組。
你的工作：當使用者用自然語言問「怎麼做某件事」時，你要回答：
  1) 一段友善、簡短的口語說明（繁體中文）；
  2) 一組 step-by-step 指示；
  3) 對應的頁面連結（必須從知識庫挑選，不要自創路徑）；
  4) 2-3 個有用的延伸問題建議。

嚴格規則：
- 回傳 **純 JSON**，符合此 schema：
  {
    "reply": string,
    "steps": string[],
    "links": [ { "label": string, "path": string, "tip": string? } ],
    "suggestions": string[]
  }
- 回覆使用繁體中文。
- 保持簡潔：reply 不超過 2 句，steps 建議 3-6 步。`

// ══════════════════════════════════════════════════════════════
//  Action handlers
// ══════════════════════════════════════════════════════════════

// ── gemini.js: chat ──────────────────────────────────────────

async function handleChat(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const { message, history = [], systemPrompt } = payload as {
    message: string
    history?: ChatMessage[]
    systemPrompt?: string
  }

  // M-1: Always seed system prompt at conversation start; prevent stripping via history injection
  const sysText = systemPrompt === 'nav' ? NAV_SYSTEM_PROMPT : ERP_SYSTEM_PROMPT
  const seedExchange: ChatMessage[] = [
    { role: 'user', parts: [{ text: `系統指令：${sysText}` }] },
    { role: 'model', parts: [{ text: '了解，我是 SME Ops AI 助理，隨時準備協助您處理 ERP 相關問題。' }] },
  ]
  const baseHistory = history as ChatMessage[]
  const alreadySeeded = baseHistory.length >= 2 && baseHistory[0].parts[0]?.text?.startsWith('系統指令：')
  const contents: ChatMessage[] = [...(alreadySeeded ? [] : seedExchange), ...baseHistory]
  contents.push({ role: 'user', parts: [{ text: message }] })

  const responseText = await callGemini(apiKey, 'gemini-2.0-flash', contents, {
    temperature: 0.7,
    maxOutputTokens: 4096,
  })

  // Return the response text plus the updated history so the client can pass it on the next call
  const updatedHistory: ChatMessage[] = [
    ...contents,
    { role: 'model', parts: [{ text: responseText }] },
  ]
  return { text: responseText, history: updatedHistory }
}

// ── navAssistant/engine.js: navChat (JSON mode) ──────────────

async function handleNavChat(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const { message, history = [] } = payload as {
    message: string
    history?: ChatMessage[]
  }

  // M-1: Always seed system prompt; prevent stripping via history injection
  const navSeed: ChatMessage[] = [
    { role: 'user', parts: [{ text: NAV_SYSTEM_PROMPT }] },
    {
      role: 'model',
      parts: [{
        text: JSON.stringify({
          reply: '您好，我是 HR 與工作流程的導覽助理，告訴我您想做什麼，我會指引您到正確的頁面。',
          steps: [],
          links: [],
          suggestions: ['我要請特休', '怎麼補登打卡', '怎麼建立新流程'],
        }),
      }],
    },
  ]
  const navBaseHistory = history as ChatMessage[]
  const navAlreadySeeded = navBaseHistory.length >= 2 && navBaseHistory[0].parts[0]?.text === NAV_SYSTEM_PROMPT
  const contents: ChatMessage[] = [...(navAlreadySeeded ? [] : navSeed), ...navBaseHistory]
  contents.push({ role: 'user', parts: [{ text: message }] })

  const responseText = await callGemini(apiKey, 'gemini-2.0-flash', contents, {
    temperature: 0.4,
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
  })

  const updatedHistory: ChatMessage[] = [
    ...contents,
    { role: 'model', parts: [{ text: responseText }] },
  ]
  return { text: responseText, history: updatedHistory }
}

// ── gemini.js: analyzeFinancials ─────────────────────────────

async function handleAnalyzeFinancials(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const { data } = payload
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

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.2, maxOutputTokens: 4096 })
  return parseJSON(text) ?? { summary: text, metrics: [], anomalies: [], recommendations: [] }
}

// ── gemini.js: forecastDemand ────────────────────────────────

async function handleForecastDemand(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const { salesHistory, options = {} } = payload as {
    salesHistory: unknown
    options?: Record<string, unknown>
  }
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

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.2, maxOutputTokens: 4096 })
  return parseJSON(text) ?? {
    forecasts: [], seasonality: text, safetyStock: 0, purchaseTiming: '', methodology: '',
  }
}

// ── gemini.js: evaluateSupplier ──────────────────────────────

async function handleEvaluateSupplier(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const { supplierData } = payload
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

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.2, maxOutputTokens: 2048 })
  return parseJSON(text) ?? {
    overallScore: 0, grade: 'N/A', scores: {}, strengths: [], risks: [], recommendation: text,
  }
}

// ── gemini.js: detectPayrollAnomalies ────────────────────────

async function handleDetectPayrollAnomaliesGemini(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const { payrollRecords } = payload as { payrollRecords: unknown }
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

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.1, maxOutputTokens: 4096 })
  return parseJSON(text) ?? {
    status: 'unknown', anomalyCount: 0, anomalies: [], complianceIssues: [], suggestions: [text],
  }
}

// ── gemini.js: classifyDocument ──────────────────────────────

async function handleClassifyDocument(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const { textContent, docType = 'auto' } = payload as { textContent: string; docType?: string }
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

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.1, maxOutputTokens: 2048 })
  return parseJSON(text) ?? {
    documentType: 'unknown', confidence: 0, extractedFields: {}, warnings: [text],
  }
}

// ── gemini.js: generateMarketingContent ─────────────────────

async function handleGenerateMarketingContent(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const {
    purpose = 'promotion', tone = 'professional',
    industry = '一般', productName = '', targetAudience = '',
  } = payload as Record<string, string>

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

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.7, maxOutputTokens: 2048 })
  return parseJSON(text) ?? {
    subject: '', preheader: '', heading: '', body: text, cta: '', footer: '',
  }
}

// ── gemini.js: categorizeTransaction ────────────────────────

async function handleCategorizeTransaction(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const { transaction, chartOfAccounts } = payload
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

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.1, maxOutputTokens: 1024 })
  return parseJSON(text) ?? {
    accountCode: '', accountName: '', confidence: 0, reasoning: text, suggestedMemo: '',
  }
}

// ── hrAI.js: queryHRNL ───────────────────────────────────────

async function handleQueryHRNL(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const { question, context = {} } = payload as {
    question: string
    context?: Record<string, unknown[]>
  }
  const ctx = (context ?? {}) as Record<string, unknown[]>

  const prompt = `你是台灣中小企業的人力資源 AI 助理。使用者用自然語言查詢 HR 相關問題，你需要根據提供的資料上下文回答。

可用資料上下文：
- 在職員工（${(ctx.employees || []).length} 人）：${JSON.stringify((ctx.employees || []).slice(0, 50).map((e: unknown) => {
    const r = e as Record<string, unknown>
    return { name: r.name, dept: r.dept, position: r.position, store: r.store, join_date: r.join_date }
  }))}
- 出勤紀錄（近30天）：${JSON.stringify((ctx.attendance || []).slice(0, 100).map((a: unknown) => {
    const r = a as Record<string, unknown>
    return { employee: r.employee, date: r.date, status: r.status, hours: r.hours }
  }))}
- 請假紀錄（近期）：${JSON.stringify((ctx.leaves || []).slice(0, 50).map((l: unknown) => {
    const r = l as Record<string, unknown>
    return { employee: r.employee, type: r.type, start_date: r.start_date, end_date: r.end_date, days: r.days, status: r.status }
  }))}
- 薪資紀錄（最近月份）：${JSON.stringify((ctx.salaries || []).slice(0, 50).map((s: unknown) => {
    const r = s as Record<string, unknown>
    return { employee: r.employee, month: r.month, base_salary: r.base_salary, net_salary: r.net_salary }
  }))}
- 績效考核：${JSON.stringify((ctx.performance || []).slice(0, 30).map((p: unknown) => {
    const r = p as Record<string, unknown>
    return { employee: r.employee, period: r.period, overall_score: r.overall_score, rating: r.rating }
  }))}
- 部門清單：${JSON.stringify((ctx.departments || []).map((d: unknown) => (d as Record<string, unknown>).name))}

使用者問題：「${question}」

請以 JSON 格式回覆：
{
  "intent": "headcount|attendance|leave|salary|performance|turnover|general",
  "answer": "用繁體中文回答，簡潔明瞭。如果涉及數據請列出具體數字。",
  "data": [{"label": "指標名稱", "value": "數值或說明"}],
  "chart": {"type": "none|bar|pie|table", "labels": [], "values": []},
  "suggestions": ["使用者可能想繼續問的問題1", "問題2", "問題3"],
  "actionable": {"action": "none|approve_leave|review_attendance|check_overtime|schedule_review", "details": "如果有可執行的動作，說明步驟"}
}

注意：
- 計算時以上下文中的實際資料為準
- 如果資料不足以回答，誠實說明並建議使用者查看哪個功能頁面
- 金額使用 NT$ 格式
- 日期格式 YYYY-MM-DD`

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.2, maxOutputTokens: 4096 })
  return parseJSON(text) ?? {
    intent: 'general',
    answer: text,
    data: [],
    chart: { type: 'none' },
    suggestions: [],
    actionable: { action: 'none', details: '' },
  }
}

// ── hrAI.js: generateSurveyInsights ─────────────────────────

async function handleGenerateSurveyInsights(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const surveyData = payload as {
    title: string
    overallAvg: number
    enps: number | null
    responseCount: number
    categories: { category: string; avg: number }[]
    qAnalysis: { text: string; category: string; avg: number; count: number; dist: number[] }[]
    textResponses?: { question: string; answers: string[] }[]
  }

  const prompt = `你是一位專業的組織發展顧問。請分析以下員工滿意度調查結果，提供深度洞察與行動建議。

問卷標題：${surveyData.title}
回覆人數：${surveyData.responseCount}
整體滿意度：${surveyData.overallAvg} / 5
eNPS 分數：${surveyData.enps ?? '無資料'}

各維度分數：
${surveyData.categories.map(c => `- ${c.category}: ${c.avg}/5`).join('\n')}

逐題分析：
${surveyData.qAnalysis.map(q =>
    `- "${q.text}" (${q.category}): 平均 ${q.avg}/5, 回覆 ${q.count} 人, 分佈 [1分:${q.dist[0]}, 2分:${q.dist[1]}, 3分:${q.dist[2]}, 4分:${q.dist[3]}, 5分:${q.dist[4]}]`
  ).join('\n')}

開放式回覆：
${(surveyData.textResponses || []).map(tr =>
    `【${tr.question}】\n${tr.answers.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}`
  ).join('\n\n')}

請以 JSON 格式回覆：
{
  "executive_summary": "2-3 句話的主管摘要",
  "strengths": ["組織做得好的 2-3 個面向，含具體分數佐證"],
  "concerns": ["需要關注的 2-3 個面向，含具體分數佐證"],
  "themes": ["從開放式回覆中歸納出的 3-5 個主要主題"],
  "sentiment": {"positive_pct": 70, "neutral_pct": 20, "negative_pct": 10},
  "action_items": [
    {"priority": "high|medium|low", "area": "維度名稱", "action": "具體建議", "expected_impact": "預期效果"}
  ],
  "department_notes": "如有部門差異的觀察",
  "trend_warning": "如有需要注意的趨勢或風險",
  "enps_interpretation": "eNPS 分數的解讀與建議"
}`

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.3, maxOutputTokens: 4096 })
  return parseJSON(text) ?? {
    executive_summary: text, strengths: [], concerns: [], themes: [], action_items: [],
  }
}

// ── hrAI.js: detectPayrollAnomalies (HR variant) ─────────────

async function handleDetectPayrollAnomaliesHR(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const { payrollRecords, month } = payload as {
    payrollRecords: Record<string, unknown>[]
    month: string
  }

  const prompt = `你是台灣勞動法規與薪資計算專家。請檢查以下 ${month} 月份的批次薪資資料是否有異常。

薪資資料（${payrollRecords.length} 人）：
${JSON.stringify(payrollRecords.map(p => ({
    employee: p.employee,
    dept: p.dept,
    base_salary: p.base_salary,
    workDays: p.workDays,
    workHours: p.workHours,
    otHours: p.otHours,
    absenceDays: p.absenceDays,
    lateCount: p.lateCount,
    overtimePay: p.overtimePay,
    absenceDeduction: p.absenceDeduction,
    lateDeduction: p.lateDeduction,
    laborInsurance: p.laborInsurance,
    healthInsurance: p.healthInsurance,
    incomeTax: p.incomeTax,
    totalDeductions: p.totalDeductions,
    gross: p.gross,
    netSalary: p.netSalary,
  })), null, 2)}

請依據台灣勞基法檢查：
1. 加班時數異常（月上限 46 小時，須員工同意且不得強制）
2. 加班費計算是否正確（前2小時 ×1.34，第3小時起 ×1.67）
3. 勞保 / 健保扣款級距是否合理（對比底薪）
4. 同部門薪資差異是否過大（可能為資料輸入錯誤）
5. 工作天數 / 時數是否合理（月工作天數通常 20-23 天）
6. 扣薪是否超過法定限制（勞基法 §26：不得預扣工資）
7. 實領薪資是否低於基本工資（2026 年 NT$ 28,590）
8. 遲到扣款是否合理

以 JSON 格式回覆：
{
  "status": "clean|warning|critical",
  "anomaly_count": 0,
  "anomalies": [
    {
      "employee": "姓名",
      "type": "overtime_excess|deduction_error|insurance_mismatch|salary_outlier|below_minimum|attendance_abnormal",
      "severity": "high|medium|low",
      "detail": "說明異常原因",
      "suggestion": "修正建議"
    }
  ],
  "compliance_issues": ["整體合規問題，如：3 人加班超過 46 小時"],
  "summary": "整體薪資審核摘要（1-2句）",
  "suggestions": ["改善建議1", "建議2"]
}`

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.1, maxOutputTokens: 4096 })
  return parseJSON(text) ?? {
    status: 'warning', anomaly_count: 0, anomalies: [],
    compliance_issues: [], summary: text, suggestions: [],
  }
}

// ── crmAI.js: generateCampaignCopy ───────────────────────────

async function handleGenerateCampaignCopy(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const {
    channel, goal, audience, tone = '專業', productInfo = '', abVariant = false,
  } = payload as {
    channel: string; goal: string; audience: string
    tone?: string; productInfo?: string; abVariant?: boolean
  }

  const channelGuide: Record<string, string> = {
    email: '完整 Email 行銷信件，包含主旨、正文（可含簡單 HTML 段落）、CTA 按鈕文字。正文 200-400 字。',
    line: 'LINE 訊息，簡短親切，含表情符號，150 字以內。不需要主旨。',
    sms: 'SMS 簡訊，70 字以內（含 CTA 連結提示）。不需要主旨。',
  }

  const prompt = `你是台灣中小企業的行銷文案專家。請根據以下條件產生行銷文案：

通道：${channel}
規格：${channelGuide[channel] || channelGuide.email}
行銷目標：${goal}
目標受眾：${audience}
語氣風格：${tone}
${productInfo ? `產品/服務資訊：${productInfo}` : ''}

要求：
- 使用繁體中文
- 語氣要符合「${tone}」風格
- 包含明確的行動呼籲 (CTA)
- 避免垃圾郵件觸發詞（免費、中獎、點擊這裡 等）
${abVariant ? '- 同時產生 A/B 兩個版本，風格略有不同' : ''}

以 JSON 格式回覆：
{
  ${channel === 'email' ? '"subject": "Email 主旨（30字以內）",' : ''}
  "body": "訊息正文",
  "cta": "行動呼籲文字"${abVariant ? `,
  "variantB": {
    ${channel === 'email' ? '"subject": "B版主旨",' : ''}
    "body": "B版正文",
    "cta": "B版CTA"
  }` : ''}
}`

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.7, maxOutputTokens: 2048 })
  const parsed = parseJSON(text)
  if (!parsed) throw new Error('AI 回應格式錯誤')
  return parsed
}

// ── crmAI.js: generateTicketReply ────────────────────────────

async function handleGenerateTicketReply(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const {
    ticket, history = [], knowledgeBase = [], tone = '專業親切',
  } = payload as {
    ticket: Record<string, unknown>
    history?: Record<string, unknown>[]
    knowledgeBase?: { q: string; a: string }[]
    tone?: string
  }

  const historyText = (history as Record<string, unknown>[]).slice(0, 10)
    .map(h => `[${h.action}] ${h.new_value || ''} (${h.actor || '系統'})`).join('\n')
  const kbText = (knowledgeBase as { q: string; a: string }[])
    .map(k => `Q: ${k.q}\nA: ${k.a}`).join('\n\n')

  const prompt = `你是台灣中小企業的客服專員。請根據以下工單資訊草擬一封回覆：

工單資訊：
- 客戶：${ticket.customer_name || '未知'}
- 主題：${ticket.subject || ''}
- 類型：${ticket.type || ''}
- 優先度：${ticket.priority || '一般'}
- 狀態：${ticket.status || ''}
- 描述：${ticket.description || '（無描述）'}
- 管道：${ticket.channel || ''}

${historyText ? `歷史紀錄：\n${historyText}` : ''}

${kbText ? `知識庫參考：\n${kbText}` : ''}

要求：
- 使用繁體中文，語氣「${tone}」
- 開頭稱呼客戶（如有名字）
- 直接回應問題核心
- 如知識庫有相關資訊，引用作答
- 結尾提供後續聯絡方式或承諾

以 JSON 格式回覆：
{
  "reply": "完整回覆內容",
  "suggestedActions": ["建議動作1", "建議動作2"],
  "relevantKB": ["相關知識庫問題標題（如有）"],
  "sentiment": "positive/neutral/negative（客戶情緒判斷）"
}`

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.4, maxOutputTokens: 2048 })
  const parsed = parseJSON(text)
  if (!parsed) throw new Error('AI 回應格式錯誤')
  return parsed
}

// ── crmAI.js: aiLeadScore ────────────────────────────────────

async function handleAiLeadScore(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const { customer, context = {} } = payload as {
    customer: Record<string, unknown>
    context?: Record<string, unknown[]>
  }
  const ctx = (context ?? {}) as Record<string, unknown[]>

  const recentOrdersTotal = (ctx.recentOrders || []).reduce(
    (s: number, o: unknown) => s + (((o as Record<string, unknown>).total_amount as number) || 0), 0
  )

  const prompt = `你是 B2B 銷售分析專家。請評估以下客戶的潛在價值並給出 0-100 的評分：

客戶資料：
- 姓名：${customer.name || '未知'}
- 公司：${customer.company || '無'}
- 狀態：${customer.status || ''}
- 標籤：${customer.tags || '無'}
- 累計消費：NT$ ${((customer.total_spent as number) || 0).toLocaleString()}
- 信用額度：NT$ ${((customer.credit_limit as number) || 0).toLocaleString()}
- 未收帳款：NT$ ${((customer.outstanding_amount as number) || 0).toLocaleString()}
- 來源：${customer.source || '未知'}

${ctx.recentOrders?.length ? `近期訂單：${ctx.recentOrders.length} 筆，總額 NT$ ${recentOrdersTotal.toLocaleString()}` : '無近期訂單'}
${ctx.contacts?.length ? `近期互動：${ctx.contacts.length} 次` : '無近期互動'}
${ctx.tickets?.length ? `未關閉工單：${ctx.tickets.length} 張` : '無未關閉工單'}

評分標準：
- 消費歷史與金額 (0-30分)
- 互動頻率與近期活躍度 (0-25分)
- 公司規模與潛在價值 (0-20分)
- 風險因素（未收帳款、工單） (扣0-15分)
- 成長趨勢 (0-10分)

以 JSON 格式回覆：
{
  "score": 75,
  "breakdown": [
    {"label": "消費歷史", "points": 25, "maxPoints": 30},
    {"label": "互動活躍度", "points": 15, "maxPoints": 25},
    {"label": "潛在價值", "points": 15, "maxPoints": 20},
    {"label": "風險因素", "points": -5, "maxPoints": 15},
    {"label": "成長趨勢", "points": 5, "maxPoints": 10}
  ],
  "explanation": "一句話摘要此客戶的評估重點",
  "nextAction": "建議的下一步行動"
}`

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.2, maxOutputTokens: 2048 })
  const parsed = parseJSON(text) as Record<string, unknown> | null
  if (!parsed) throw new Error('AI 回應格式錯誤')
  return {
    score: Math.max(0, Math.min(100, (parsed.score as number) || 0)),
    breakdown: parsed.breakdown || [],
    explanation: parsed.explanation || '',
    nextAction: parsed.nextAction || '',
  }
}

// ── crmAI.js: nlToSegmentRules ───────────────────────────────

async function handleNlToSegmentRules(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const { description, availableFields } = payload as {
    description: string
    availableFields: { value: string; label: string; type: string }[]
  }

  const fieldsDoc = availableFields.map(f =>
    `- ${f.value} (${f.label}, 類型: ${f.type})`
  ).join('\n')

  const prompt = `你是客戶資料分析師。請將以下自然語言描述轉換為客戶分群篩選規則：

描述：「${description}」

可用欄位：
${fieldsDoc}

可用運算子：
- number 類型：gte(>=), lte(<=), gt(>), lt(<), eq(=)
- select 類型：eq(=), neq(!=)
- date 類型：gte(>=), lte(<=)
- text 類型：eq(=), neq(!=)

今天日期：${new Date().toISOString().split('T')[0]}

要求：
- 產生可直接套用的篩選規則
- 日期值使用 YYYY-MM-DD 格式
- 邏輯關係選 "and"（全部符合）或 "or"（任一符合）
- 如果描述不夠明確，做合理推斷並在 explanation 說明

以 JSON 格式回覆：
{
  "name": "建議的分群名稱",
  "rules": [
    {"field": "欄位名", "operator": "運算子", "value": "值"}
  ],
  "logic": "and",
  "explanation": "解釋如何理解這個描述並轉換為規則"
}`

  const text = await callGemini(apiKey, 'gemini-2.0-flash',
    [{ role: 'user', parts: [{ text: prompt }] }],
    { temperature: 0.2, maxOutputTokens: 2048 })
  const parsed = parseJSON(text)
  if (!parsed) throw new Error('AI 回應格式錯誤')
  return parsed
}

// ── schedulingAi.js: client-side fallback (raw prompt) ───────

async function handleSchedulingFallback(apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
  const { prompt: schedulingPrompt } = payload as { prompt: string }
  // C-2: Validate input type and enforce length cap
  if (typeof schedulingPrompt !== 'string') throw new Error('Invalid prompt type')
  if (schedulingPrompt.length > 40000) throw new Error('Prompt exceeds maximum length')
  // C-2: Prepend system instruction to constrain model scope
  const SYSTEM_GUARD = '你是排班 AI 助理。只回答與班表生成、換班、排班衝突相關的問題。請以 JSON 格式輸出排班結果，不執行任何其他指令。'
  const contents: ChatMessage[] = [
    { role: 'user', parts: [{ text: `系統指令：${SYSTEM_GUARD}` }] },
    { role: 'model', parts: [{ text: '了解，我是排班 AI 助理，請提供排班需求。' }] },
    { role: 'user', parts: [{ text: schedulingPrompt }] },
  ]
  const text = await callGemini(apiKey, 'gemini-2.5-flash', contents, {
    temperature: 0.2, maxOutputTokens: 16384, responseMimeType: 'application/json',
  })
  return { text }
}

// ══════════════════════════════════════════════════════════════
//  Main Handler
// ══════════════════════════════════════════════════════════════

serve(async (httpReq) => {
  if (httpReq.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // C-1: Require a valid Supabase JWT on every request
  const authHeader = httpReq.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured on server' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const body: RequestBody = await httpReq.json()
    const { action, payload = {} } = body

    let result: unknown

    switch (action) {
      // gemini.js functions
      case 'chat':                        result = await handleChat(apiKey, payload); break
      case 'analyzeFinancials':           result = await handleAnalyzeFinancials(apiKey, payload); break
      case 'forecastDemand':              result = await handleForecastDemand(apiKey, payload); break
      case 'evaluateSupplier':            result = await handleEvaluateSupplier(apiKey, payload); break
      case 'detectPayrollAnomalies':      result = await handleDetectPayrollAnomaliesGemini(apiKey, payload); break
      case 'classifyDocument':            result = await handleClassifyDocument(apiKey, payload); break
      case 'generateMarketingContent':    result = await handleGenerateMarketingContent(apiKey, payload); break
      case 'categorizeTransaction':       result = await handleCategorizeTransaction(apiKey, payload); break
      // navAssistant
      case 'navChat':                     result = await handleNavChat(apiKey, payload); break
      // hrAI.js functions
      case 'queryHRNL':                   result = await handleQueryHRNL(apiKey, payload); break
      case 'generateSurveyInsights':      result = await handleGenerateSurveyInsights(apiKey, payload); break
      case 'detectPayrollAnomaliesHR':    result = await handleDetectPayrollAnomaliesHR(apiKey, payload); break
      // crmAI.js functions
      case 'generateCampaignCopy':        result = await handleGenerateCampaignCopy(apiKey, payload); break
      case 'generateTicketReply':         result = await handleGenerateTicketReply(apiKey, payload); break
      case 'aiLeadScore':                 result = await handleAiLeadScore(apiKey, payload); break
      case 'nlToSegmentRules':            result = await handleNlToSegmentRules(apiKey, payload); break
      // schedulingAi.js client-side fallback
      case 'schedulingFallback':          result = await handleSchedulingFallback(apiKey, payload); break
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
    }

    return new Response(
      JSON.stringify({ data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('[gemini-proxy] Error:', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
