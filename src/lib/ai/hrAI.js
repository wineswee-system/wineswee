/**
 * HR AI Service
 *
 * AI-powered HR intelligence:
 * - Natural language HR queries (attendance, leave, payroll, headcount)
 * - Engagement survey insight generation (themes, action items)
 * - Payroll anomaly detection (overtime, deductions, compliance)
 *
 * Uses Gemini 2.0-flash via @google/generative-ai.
 * Follows same patterns as crmAI.js — cache layer, JSON output, graceful fallback.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { getCached, setCache, TTL } from './aiCache'

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY

let genAI = null
function getClient() {
  if (!API_KEY || API_KEY === 'your_gemini_api_key_here') {
    throw new Error('請在 .env 設定 VITE_GEMINI_API_KEY')
  }
  if (!genAI) genAI = new GoogleGenerativeAI(API_KEY)
  return genAI
}

function getModel() {
  return getClient().getGenerativeModel({ model: 'gemini-2.0-flash' })
}

function parseJSON(text) {
  try {
    return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
  } catch {
    return null
  }
}

export function isConfigured() {
  return !!API_KEY && API_KEY !== 'your_gemini_api_key_here'
}

// TTL for HR queries
const HR_TTL = {
  NL_QUERY: 5 * 60 * 1000,         // 5 min
  SURVEY_INSIGHTS: 30 * 60 * 1000, // 30 min
  PAYROLL_ANOMALY: 10 * 60 * 1000, // 10 min
}

// ════════════════════════════════════════════════════════════
// 1. Natural Language HR Query
// ════════════════════════════════════════════════════════════

/**
 * Answer HR questions in natural language.
 * @param {string} question - User's question in Chinese or English
 * @param {object} context - HR data context
 * @param {Array} context.employees - Active employees
 * @param {Array} context.attendance - Recent attendance records
 * @param {Array} context.leaves - Recent leave requests
 * @param {Array} context.salaries - Recent salary records
 * @param {Array} context.performance - Performance reviews
 * @param {Array} context.departments - Department list
 * @returns {Promise<object>} Structured response
 */
export async function queryHRNL(question, context = {}) {
  const cacheKey = `hr-nl:${question.slice(0, 60)}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const prompt = `你是台灣中小企業的人力資源 AI 助理。使用者用自然語言查詢 HR 相關問題，你需要根據提供的資料上下文回答。

可用資料上下文：
- 在職員工（${(context.employees || []).length} 人）：${JSON.stringify((context.employees || []).slice(0, 50).map(e => ({ name: e.name, dept: e.dept, position: e.position, store: e.store, join_date: e.join_date })))}
- 出勤紀錄（近30天）：${JSON.stringify((context.attendance || []).slice(0, 100).map(a => ({ employee: a.employee, date: a.date, status: a.status, hours: a.hours })))}
- 請假紀錄（近期）：${JSON.stringify((context.leaves || []).slice(0, 50).map(l => ({ employee: l.employee, type: l.type, start_date: l.start_date, end_date: l.end_date, days: l.days, status: l.status })))}
- 薪資紀錄（最近月份）：${JSON.stringify((context.salaries || []).slice(0, 50).map(s => ({ employee: s.employee, month: s.month, base_salary: s.base_salary, net_salary: s.net_salary })))}
- 績效考核：${JSON.stringify((context.performance || []).slice(0, 30).map(p => ({ employee: p.employee, period: p.period, overall_score: p.overall_score, rating: p.rating })))}
- 部門清單：${JSON.stringify((context.departments || []).map(d => d.name))}

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

  const model = getModel()
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
  })
  const text = result.response.text()
  const output = parseJSON(text) || {
    intent: 'general',
    answer: text,
    data: [],
    chart: { type: 'none' },
    suggestions: [],
    actionable: { action: 'none', details: '' },
  }

  setCache(cacheKey, output, HR_TTL.NL_QUERY)
  return output
}

// ════════════════════════════════════════════════════════════
// 2. Engagement Survey Insights
// ════════════════════════════════════════════════════════════

/**
 * Generate AI insights from engagement survey results.
 * @param {object} surveyData
 * @param {string} surveyData.title - Survey title
 * @param {Array} surveyData.questions - Question definitions
 * @param {Array} surveyData.qAnalysis - Per-question stats (avg, count, dist)
 * @param {Array} surveyData.categories - Category averages
 * @param {number} surveyData.overallAvg - Overall score
 * @param {number|null} surveyData.enps - eNPS score
 * @param {number} surveyData.responseCount - Number of responses
 * @param {Array} surveyData.textResponses - Free-text responses [{question, answers}]
 * @returns {Promise<object>} AI insights
 */
export async function generateSurveyInsights(surveyData) {
  const cacheKey = `survey-insights:${surveyData.title}:${surveyData.responseCount}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const prompt = `你是一位專業的組織發展顧問。請分析以下員工滿意度調查結果，提供深度洞察與行動建議。

問卷標題：${surveyData.title}
回覆人數：${surveyData.responseCount}
整體滿意度：${surveyData.overallAvg} / 5
eNPS 分數：${surveyData.enps ?? '無資料'}

各維度分數：
${surveyData.categories.map(c => `- ${c.category}: ${c.avg}/5`).join('\n')}

逐題分析：
${surveyData.qAnalysis.map(q => `- "${q.text}" (${q.category}): 平均 ${q.avg}/5, 回覆 ${q.count} 人, 分佈 [1分:${q.dist[0]}, 2分:${q.dist[1]}, 3分:${q.dist[2]}, 4分:${q.dist[3]}, 5分:${q.dist[4]}]`).join('\n')}

開放式回覆：
${(surveyData.textResponses || []).map(tr => `【${tr.question}】\n${tr.answers.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}`).join('\n\n')}

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

  const model = getModel()
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
  })
  const text = result.response.text()
  const output = parseJSON(text) || { executive_summary: text, strengths: [], concerns: [], themes: [], action_items: [] }

  setCache(cacheKey, output, HR_TTL.SURVEY_INSIGHTS)
  return output
}

// ════════════════════════════════════════════════════════════
// 3. Payroll Anomaly Detection
// ════════════════════════════════════════════════════════════

/**
 * Detect anomalies in payroll batch data.
 * @param {Array} payrollRecords - Batch payroll preview data
 * @param {string} month - Payroll month (YYYY-MM)
 * @returns {Promise<object>} Anomaly report
 */
export async function detectPayrollAnomalies(payrollRecords, month) {
  const cacheKey = `payroll-anomaly:${month}:${payrollRecords.length}`
  const cached = getCached(cacheKey)
  if (cached) return cached

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

  const model = getModel()
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
  })
  const text = result.response.text()
  const output = parseJSON(text) || {
    status: 'warning',
    anomaly_count: 0,
    anomalies: [],
    compliance_issues: [],
    summary: text,
    suggestions: [],
  }

  setCache(cacheKey, output, HR_TTL.PAYROLL_ANOMALY)
  return output
}
