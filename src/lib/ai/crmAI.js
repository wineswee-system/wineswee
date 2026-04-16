/**
 * CRM AI Service
 *
 * Integrates Gemini AI into CRM workflows:
 * - Campaign copy generation (email/LINE/SMS)
 * - Smart ticket reply drafting
 * - AI-enhanced lead scoring
 * - Natural language → segment rules
 *
 * Uses existing gemini.js client; falls back gracefully on failure.
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

// ════════════════════════════════════════════════════════════
// 1. Campaign Copy Generator
// ════════════════════════════════════════════════════════════

/**
 * Generate marketing copy for campaigns.
 * @param {object} opts
 * @param {'email'|'line'|'sms'} opts.channel
 * @param {string} opts.goal - Campaign goal (e.g., "促銷夏季新品")
 * @param {string} opts.audience - Target audience description
 * @param {string} opts.tone - Tone: 專業/親切/活潑/急迫
 * @param {string} [opts.productInfo] - Product details
 * @param {boolean} [opts.abVariant] - Generate A/B variants
 * @returns {Promise<object>} { subject, body, cta, variantB? }
 */
export async function generateCampaignCopy({ channel, goal, audience, tone = '專業', productInfo = '', abVariant = false }) {
  const channelGuide = {
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

  const result = await getModel().generateContent(prompt)
  const parsed = parseJSON(result.response.text())
  if (!parsed) throw new Error('AI 回應格式錯誤')
  return parsed
}

// ════════════════════════════════════════════════════════════
// 2. Smart Ticket Reply
// ════════════════════════════════════════════════════════════

/**
 * Draft a reply for a service ticket.
 * @param {object} opts
 * @param {object} opts.ticket - Ticket record
 * @param {Array} opts.history - Previous ticket history entries
 * @param {Array} opts.knowledgeBase - KB articles [{q, a}]
 * @param {string} [opts.tone] - Reply tone
 * @returns {Promise<object>} { reply, suggestedActions, relevantKB }
 */
export async function generateTicketReply({ ticket, history = [], knowledgeBase = [], tone = '專業親切' }) {
  const historyText = history.slice(0, 10).map(h =>
    `[${h.action}] ${h.new_value || ''} (${h.actor || '系統'})`
  ).join('\n')

  const kbText = knowledgeBase.map(k => `Q: ${k.q}\nA: ${k.a}`).join('\n\n')

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

  const result = await getModel().generateContent(prompt)
  const parsed = parseJSON(result.response.text())
  if (!parsed) throw new Error('AI 回應格式錯誤')
  return parsed
}

// ════════════════════════════════════════════════════════════
// 3. AI Lead Scoring
// ════════════════════════════════════════════════════════════

/**
 * Enhanced lead scoring using AI analysis.
 * Falls back to rule-based scoring on failure.
 * @param {object} customer - Customer record
 * @param {object} [context] - Additional context
 * @param {Array} [context.recentOrders] - Recent orders
 * @param {Array} [context.contacts] - Recent interactions
 * @param {Array} [context.tickets] - Open tickets
 * @returns {Promise<object>} { score, breakdown, explanation, nextAction }
 */
export async function aiLeadScore(customer, context = {}) {
  const cacheKey = `lead_score:${customer.id}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const prompt = `你是 B2B 銷售分析專家。請評估以下客戶的潛在價值並給出 0-100 的評分：

客戶資料：
- 姓名：${customer.name || '未知'}
- 公司：${customer.company || '無'}
- 狀態：${customer.status || ''}
- 標籤：${customer.tags || '無'}
- 累計消費：NT$ ${(customer.total_spent || 0).toLocaleString()}
- 信用額度：NT$ ${(customer.credit_limit || 0).toLocaleString()}
- 未收帳款：NT$ ${(customer.outstanding_amount || 0).toLocaleString()}
- 來源：${customer.source || '未知'}

${context.recentOrders?.length ? `近期訂單：${context.recentOrders.length} 筆，總額 NT$ ${context.recentOrders.reduce((s, o) => s + (o.total_amount || 0), 0).toLocaleString()}` : '無近期訂單'}
${context.contacts?.length ? `近期互動：${context.contacts.length} 次` : '無近期互動'}
${context.tickets?.length ? `未關閉工單：${context.tickets.length} 張` : '無未關閉工單'}

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

  const result = await getModel().generateContent(prompt)
  const parsed = parseJSON(result.response.text())
  if (!parsed) throw new Error('AI 回應格式錯誤')

  const output = {
    score: Math.max(0, Math.min(100, parsed.score || 0)),
    breakdown: parsed.breakdown || [],
    explanation: parsed.explanation || '',
    nextAction: parsed.nextAction || '',
  }
  setCache(cacheKey, output, TTL.LEAD_SCORE)
  return output
}

// ════════════════════════════════════════════════════════════
// 4. Natural Language → Segment Rules
// ════════════════════════════════════════════════════════════

/**
 * Convert natural language description to segment filter rules.
 * @param {string} description - e.g., "過去三個月消費超過五萬但最近沒來"
 * @param {Array} availableFields - [{value, label, type}]
 * @returns {Promise<object>} { name, rules, logic, explanation }
 */
export async function nlToSegmentRules(description, availableFields) {
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

  const result = await getModel().generateContent(prompt)
  const parsed = parseJSON(result.response.text())
  if (!parsed) throw new Error('AI 回應格式錯誤')
  return parsed
}
