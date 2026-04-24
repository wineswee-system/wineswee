/**
 * Gemini AI 服務模組
 *
 * 所有 Gemini API 呼叫都通過 Supabase Edge Function (gemini-proxy) 進行，
 * 確保 API 金鑰不暴露在瀏覽器端。
 *
 * 對外 API 與原版相同，呼叫端無需修改。
 */

import { supabase } from './supabase'

// In-memory history map so each session accumulates context client-side,
// then the full history is passed to the stateless edge function each call.
const chatHistories = new Map()

// ─── Helper ─────────────────────────────────────────────────

async function invokeProxy(action, payload) {
  const { data, error } = await supabase.functions.invoke('gemini-proxy', {
    body: { action, payload },
  })
  if (error) throw new Error(`AI 服務錯誤：${error.message || '請稍後再試'}`)
  if (data?.error) throw new Error(`AI 服務錯誤：${data.error}`)
  return data?.data
}

// ─── Core chat function ─────────────────────────────────────

/**
 * Send a message to Gemini and get a response.
 * Maintains conversation history per sessionId (client-side Map).
 */
export async function chat(userMessage, sessionId = 'default') {
  const history = chatHistories.get(sessionId) || []

  const result = await invokeProxy('chat', {
    message: userMessage,
    history,
  })

  // Persist the updated history returned by the edge function
  if (result?.history) {
    chatHistories.set(sessionId, result.history)
  }

  return result?.text ?? ''
}

/** Clear a chat session to start fresh */
export function clearSession(sessionId = 'default') {
  chatHistories.delete(sessionId)
}

// ─── ERP-specific AI functions ──────────────────────────────

/**
 * Analyze financial data and provide insights
 */
export async function analyzeFinancials(data) {
  return invokeProxy('analyzeFinancials', { data })
}

/**
 * Predict demand / sales forecast
 */
export async function forecastDemand(salesHistory, options = {}) {
  return invokeProxy('forecastDemand', { salesHistory, options })
}

/**
 * Score and classify a supplier based on performance data
 */
export async function evaluateSupplier(supplierData) {
  return invokeProxy('evaluateSupplier', { supplierData })
}

/**
 * Detect anomalies in payroll data
 */
export async function detectPayrollAnomalies(payrollRecords) {
  return invokeProxy('detectPayrollAnomalies', { payrollRecords })
}

/**
 * Classify and extract data from a document (invoice, receipt, contract)
 */
export async function classifyDocument(textContent, docType = 'auto') {
  return invokeProxy('classifyDocument', { textContent, docType })
}

/**
 * Generate marketing email content using AI
 */
export async function generateMarketingContent(options = {}) {
  return invokeProxy('generateMarketingContent', options)
}

/**
 * Categorize a bank transaction for reconciliation
 */
export async function categorizeTransaction(transaction, chartOfAccounts) {
  return invokeProxy('categorizeTransaction', { transaction, chartOfAccounts })
}

/** Key is now server-side — always returns true */
export function isConfigured() {
  return true
}
