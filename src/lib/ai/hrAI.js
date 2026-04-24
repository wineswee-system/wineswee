/**
 * HR AI Service
 *
 * AI-powered HR intelligence:
 * - Natural language HR queries (attendance, leave, payroll, headcount)
 * - Engagement survey insight generation (themes, action items)
 * - Payroll anomaly detection (overtime, deductions, compliance)
 *
 * All Gemini calls route through the gemini-proxy Edge Function so the
 * API key never reaches the browser bundle.
 */

import { supabase } from '../supabase'
import { getCached, setCache } from './aiCache'

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
 * @returns {Promise<object>} Structured response
 */
export async function queryHRNL(question, context = {}) {
  const cacheKey = `hr-nl:${question.slice(0, 60)}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const output = await invokeProxy('queryHRNL', { question, context })

  setCache(cacheKey, output, HR_TTL.NL_QUERY)
  return output
}

// ════════════════════════════════════════════════════════════
// 2. Engagement Survey Insights
// ════════════════════════════════════════════════════════════

/**
 * Generate AI insights from engagement survey results.
 * @param {object} surveyData
 * @returns {Promise<object>} AI insights
 */
export async function generateSurveyInsights(surveyData) {
  const cacheKey = `survey-insights:${surveyData.title}:${surveyData.responseCount}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const output = await invokeProxy('generateSurveyInsights', surveyData)

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

  const output = await invokeProxy('detectPayrollAnomaliesHR', { payrollRecords, month })

  setCache(cacheKey, output, HR_TTL.PAYROLL_ANOMALY)
  return output
}
