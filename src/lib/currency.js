/**
 * 多幣別支援模組
 * 支援匯率轉換、匯兌損益計算、貨幣格式化
 * 同時支援 Supabase 資料庫匯率查詢
 */

import { supabase } from './supabase'

// 支援的幣別與符號
export const SUPPORTED_CURRENCIES = {
  NTD: { code: 'NTD', symbol: 'NT$', name: '新台幣', decimals: 0 },
  TWD: { code: 'TWD', symbol: 'NT$', name: '新台幣', decimals: 0 },
  USD: { code: 'USD', symbol: '$', name: '美元', decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', name: '歐元', decimals: 2 },
  JPY: { code: 'JPY', symbol: '¥', name: '日圓', decimals: 0 },
  CNY: { code: 'CNY', symbol: '¥', name: '人民幣', decimals: 2 },
  GBP: { code: 'GBP', symbol: '£', name: '英鎊', decimals: 2 },
  HKD: { code: 'HKD', symbol: 'HK$', name: '港幣', decimals: 2 },
}

// 預設匯率（以 NTD/TWD 為基準，1 外幣 = X NTD）
export const DEFAULT_RATES = {
  NTD: 1,
  TWD: 1,
  USD: 32.15,
  EUR: 34.80,
  JPY: 0.215,
  CNY: 4.42,
  GBP: 40.50,
  HKD: 4.12,
}

// ─── Supabase-backed functions ────────────────────────────────

// Get all active currencies from DB
export async function getCurrencies() {
  const { data } = await supabase.from('currencies').select('*').eq('is_active', true).order('code')
  return data || []
}

// Get exchange rate from DB for a currency on a date (or latest before that date)
export async function getDbExchangeRate(fromCurrency, date = new Date()) {
  if (fromCurrency === 'NTD') return 1
  const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : date
  const { data } = await supabase.from('exchange_rates')
    .select('rate')
    .eq('from_currency', fromCurrency)
    .eq('to_currency', 'NTD')
    .lte('effective_date', dateStr)
    .order('effective_date', { ascending: false })
    .limit(1)
    .single()
  return data?.rate || null
}

// Save exchange rate to DB
export async function saveExchangeRate(fromCurrency, rate, effectiveDate) {
  const { data, error } = await supabase.from('exchange_rates').insert({
    from_currency: fromCurrency,
    to_currency: 'NTD',
    rate,
    effective_date: effectiveDate
  }).select().single()
  if (error) throw error
  return data
}

// Get all latest rates for a date from DB
export async function getExchangeRates(date) {
  const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : date
  const { data } = await supabase.from('exchange_rates')
    .select('*')
    .eq('to_currency', 'NTD')
    .lte('effective_date', dateStr)
    .order('effective_date', { ascending: false })
  // Deduplicate to get latest per currency
  const latest = {}
  ;(data || []).forEach(r => {
    if (!latest[r.from_currency]) latest[r.from_currency] = r
  })
  return Object.values(latest)
}

// Delete exchange rate from DB
export async function deleteExchangeRate(id) {
  const { error } = await supabase.from('exchange_rates').delete().eq('id', id)
  if (error) throw error
}

// Get exchange rate history from DB
export async function getExchangeRateHistory(fromCurrency) {
  let q = supabase.from('exchange_rates')
    .select('*')
    .eq('to_currency', 'NTD')
    .order('effective_date', { ascending: false })
  if (fromCurrency) q = q.eq('from_currency', fromCurrency)
  const { data } = await q
  return data || []
}

// ─── Pure functions (no DB) ───────────────────────────────────

/**
 * 查詢匯率（純函式，使用傳入的匯率表）
 * @param {string} fromCurrency
 * @param {string} toCurrency
 * @param {Object} [rates] - 匯率表（預設 DEFAULT_RATES）
 * @returns {number}
 */
export function getExchangeRate(fromCurrency, toCurrency, rates = DEFAULT_RATES) {
  if (fromCurrency === toCurrency) return 1

  const fromRate = rates[fromCurrency]
  const toRate = rates[toCurrency]

  if (fromRate == null || toRate == null) {
    throw new Error(`不支援的幣別: ${fromRate == null ? fromCurrency : toCurrency}`)
  }

  return fromRate / toRate
}

/**
 * 幣別轉換（純函式）
 */
export function convertCurrency(amount, fromCurrency, toCurrency, rates = DEFAULT_RATES) {
  const rate = getExchangeRate(fromCurrency, toCurrency, rates)
  const convertedAmount = amount * rate

  const decimals = SUPPORTED_CURRENCIES[toCurrency]?.decimals ?? 2
  const rounded = Math.round(convertedAmount * Math.pow(10, decimals)) / Math.pow(10, decimals)

  return {
    amount,
    from: fromCurrency,
    to: toCurrency,
    rate,
    convertedAmount: rounded,
  }
}

/**
 * 計算匯兌損益
 */
export function calculateExchangeDifference(originalAmount, originalRate, currentRate, currency) {
  const originalTWD = originalAmount * originalRate
  const currentTWD = originalAmount * currentRate
  const difference = currentTWD - originalTWD

  return {
    currency,
    originalAmount,
    originalRate,
    currentRate,
    originalTWD: Math.round(originalTWD),
    currentTWD: Math.round(currentTWD),
    difference: Math.round(difference),
    type: difference >= 0 ? '匯兌利益' : '匯兌損失',
  }
}

/**
 * 格式化貨幣顯示
 * @param {number} amount
 * @param {string} currencyCode - 幣別代碼 (NTD, USD, EUR, etc.)
 * @returns {string}
 */
export function formatCurrency(amount, currencyCode = 'NTD') {
  const config = SUPPORTED_CURRENCIES[currencyCode]
  if (!config) {
    return `${currencyCode} ${Number(amount || 0).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const decimals = config.decimals
  return `${config.symbol} ${Number(amount || 0).toLocaleString('zh-TW', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}
