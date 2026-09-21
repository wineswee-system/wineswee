/**
 * 電子發票驗證 / 號碼工具
 * 統一編號（112 年 4 月新制檢查碼）、發票號碼、載具格式
 */

/**
 * 驗證統一編號（8 碼檢查）
 *
 * 112 年（2023）4 月新制：加權乘積和「可被 5 整除」即合法
 * （舊制為可被 10 整除 — 新制放寬使可用號碼倍增，新設立公司可能只過新制）。
 * 第 7 碼為 7 時特殊規則保留：乘積 7×4=28 → 2+8=10，可視為 10 或 1+0=1，
 * 兩種總和任一可被 5 整除即合法（程式上等價於 (sum+1) % 5 === 0）。
 *
 * @param {string} taxId - 統一編號
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateTaxId(taxId) {
  if (!taxId || typeof taxId !== 'string') {
    return { valid: false, error: '統一編號不得為空' }
  }

  const cleaned = taxId.trim()
  if (!/^\d{8}$/.test(cleaned)) {
    return { valid: false, error: '統一編號必須為 8 位數字' }
  }

  // 加權因子
  const weights = [1, 2, 1, 2, 1, 2, 4, 1]
  const digits = cleaned.split('').map(Number)

  let sum = 0
  for (let i = 0; i < 8; i++) {
    const product = digits[i] * weights[i]
    // 若乘積 >= 10，十位數與個位數相加
    sum += Math.floor(product / 10) + (product % 10)
  }

  // 新制（112.4 起）：總和可被 5 整除即合法
  if (sum % 5 === 0) return { valid: true }
  // 第 7 碼為 7 之特殊規則：另一種計法（28 → 10 → 1+0=1）差 9，(sum+1) % 5 等價
  if (digits[6] === 7 && (sum + 1) % 5 === 0) return { valid: true }

  return { valid: false, error: '統一編號驗證碼不正確' }
}

/**
 * 產生發票號碼（字軌規則）
 * 格式：2 個大寫英文字母 + 8 位數字，例如 AB12345678
 * @param {string} prefix   - 字軌前綴（2 碼英文），例如 'AB'
 * @param {number} sequence - 流水號
 * @returns {string} 發票號碼
 */
export function generateInvoiceNumber(prefix, sequence) {
  if (!prefix || prefix.length !== 2 || !/^[A-Z]{2}$/.test(prefix)) {
    throw new Error('字軌必須為 2 碼大寫英文字母')
  }
  if (sequence < 0 || sequence > 99999999) {
    throw new Error('流水號必須介於 0 ~ 99999999')
  }
  const seq = String(sequence).padStart(8, '0')
  return `${prefix}${seq}`
}

/**
 * 驗證發票號碼格式（2 碼大寫英文 + 8 位數字）
 * @param {string} num - 發票號碼，例如 'AB12345678' 或 'AB-12345678'
 * @returns {boolean}
 */
export function validateInvoiceNumber(num) {
  if (!num) return false
  return /^[A-Z]{2}-?\d{8}$/.test(num.trim())
}

/** 手機條碼載具：/ 開頭 + 7 碼（數字、大寫英文、+、-、.） */
export const MOBILE_BARCODE_RE = /^\/[0-9A-Z+\-.]{7}$/

/** 自然人憑證條碼：2 碼大寫英文 + 14 碼數字 */
export const CITIZEN_CERT_RE = /^[A-Z]{2}\d{14}$/

/**
 * 驗證手機條碼載具格式
 * @param {string} value - 例如 '/ABC1234'
 * @returns {boolean}
 */
export function validateMobileBarcode(value) {
  if (!value || typeof value !== 'string') return false
  return MOBILE_BARCODE_RE.test(value.trim().toUpperCase())
}

/**
 * 驗證自然人憑證載具格式
 * @param {string} value - 例如 'AB12345678901234'
 * @returns {boolean}
 */
export function validateCitizenCertCarrier(value) {
  if (!value || typeof value !== 'string') return false
  return CITIZEN_CERT_RE.test(value.trim().toUpperCase())
}

/**
 * 格式化載具條碼資訊
 * @param {string} type  - 載具類型: 'phone_barcode'(手機條碼), 'natural_person'(自然人憑證), 'company'(公司統編)
 * @param {string} value - 載具值
 * @returns {{ type: string, typeName: string, value: string, display: string }}
 */
export function formatCarrierBarcode(type, value) {
  const typeMap = {
    phone_barcode: { typeName: '手機條碼', prefix: '/' },
    natural_person: { typeName: '自然人憑證', prefix: '' },
    company: { typeName: '公司統編載具', prefix: '' },
  }

  const config = typeMap[type]
  if (!config) {
    return { type, typeName: '未知載具', value, display: value }
  }

  const display = config.prefix && !value.startsWith(config.prefix)
    ? `${config.prefix}${value}`
    : value

  return {
    type,
    typeName: config.typeName,
    value,
    display,
  }
}
