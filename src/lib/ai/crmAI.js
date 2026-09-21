/**
 * CRM AI Service
 *
 * Integrates Gemini AI into CRM workflows:
 * - Campaign copy generation (email/LINE/SMS)
 * - Smart ticket reply drafting
 * - AI-enhanced lead scoring
 * - Natural language → segment rules
 *
 * All Gemini calls route through the gemini-proxy Edge Function so the
 * API key never reaches the browser bundle.
 */

import { supabase } from '../supabase'
import { getCached, setCache, TTL } from './aiCache'

async function invokeProxy(action, payload) {
  const { data, error } = await supabase.functions.invoke('gemini-proxy', {
    body: { action, payload },
  })
  if (error) throw new Error(`AI 服務錯誤：${error.message || '請稍後再試'}`)
  if (data?.error) throw new Error(`AI 服務錯誤：${data.error}`)
  return data?.data
}

export function isConfigured() {
  return true
}

// ════════════════════════════════════════════════════════════
// 1. Campaign Copy Generator
// ════════════════════════════════════════════════════════════

/**
 * Generate marketing copy for campaigns.
 * @param {object} opts
 * @param {'email'|'line'|'sms'} opts.channel
 * @param {string} opts.goal - Campaign goal
 * @param {string} opts.audience - Target audience description
 * @param {string} opts.tone - Tone: 專業/親切/活潑/急迫
 * @param {string} [opts.productInfo] - Product details
 * @param {boolean} [opts.abVariant] - Generate A/B variants
 * @returns {Promise<object>} { subject, body, cta, variantB? }
 */
export async function generateCampaignCopy({ channel, goal, audience, tone = '專業', productInfo = '', abVariant = false }) {
  return invokeProxy('generateCampaignCopy', { channel, goal, audience, tone, productInfo, abVariant })
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
  return invokeProxy('generateTicketReply', { ticket, history, knowledgeBase, tone })
}

// ════════════════════════════════════════════════════════════
// 3. AI Lead Scoring
// ════════════════════════════════════════════════════════════

/**
 * Enhanced lead scoring using AI analysis.
 * @param {object} customer - Customer record
 * @param {object} [context] - Additional context
 * @returns {Promise<object>} { score, breakdown, explanation, nextAction }
 */
export async function aiLeadScore(customer, context = {}) {
  const cacheKey = `lead_score:${customer.id}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const output = await invokeProxy('aiLeadScore', { customer, context })

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
  return invokeProxy('nlToSegmentRules', { description, availableFields })
}
