/**
 * 條碼工具（F-C4 條碼主檔，PLAN_fin-tax-inv_2026-07-04 三/F-C4）— 純函式，POS/WMS 共用
 *
 * - GTIN-13（EAN-13）檢查碼驗證/計算
 * - 台灣秤重碼解析：13 碼、'2' 開頭
 *   版位（共 13 碼）：flag(1)='2' ＋ 部門/類別碼(1) ＋ 品號(5) ＋ 價格或重量(5) ＋ 檢查碼(1)
 *   （計畫載明 品號 5 碼＋值 5 碼；第 2 碼為台灣 POS 慣用之部門碼，湊滿 13 碼）
 *   末碼沿用 EAN-13 檢查碼演算法。
 * - classifyBarcode / resolveScan：掃碼分類與 SKU 解析（lookupFn 由呼叫端注入，本檔不碰 DB）
 *
 * 裝置端監聽/相機掃描在 src/lib/barcodeScanner.js（職責分離：本檔只做字串解析）。
 */

const DIGITS_13 = /^\d{13}$/
const STORE_CODE = /^[0-9A-Za-z][0-9A-Za-z-]{2,31}$/ // 店內碼：3~32 位英數（含 -）

/**
 * 計算 GTIN-13 檢查碼
 * @param {string} prefix12 — 前 12 碼數字
 * @returns {number|null} 檢查碼 0-9；輸入不合法回傳 null
 */
export function computeGTIN13CheckDigit(prefix12) {
  if (typeof prefix12 !== 'string' || !/^\d{12}$/.test(prefix12)) return null
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += Number(prefix12[i]) * (i % 2 === 0 ? 1 : 3) // 奇數位 ×1、偶數位 ×3（自左起）
  }
  return (10 - (sum % 10)) % 10
}

/**
 * 驗證 GTIN-13（EAN-13）檢查碼
 * @param {string} code — 13 碼數字
 * @returns {boolean}
 */
export function validateGTIN13(code) {
  if (typeof code !== 'string' || !DIGITS_13.test(code)) return false
  return computeGTIN13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

/**
 * 解析台灣秤重碼（'2' 開頭 13 碼）
 * @param {string} code — 13 碼數字
 * @param {'price'|'weight'} [mode='price'] — 值欄位語意：
 *   - 'price'：內含金額（整數元），例如 '01250' → 1250 元
 *   - 'weight'：內含重量（公克 → 回傳公斤），例如 '01250' → 1.25 kg
 * @returns {{itemCode: string|null, value: number|null, mode: string, valid: boolean,
 *            flag: string|null, deptCode: string|null, checkDigit: number|null}}
 */
export function parseScaleBarcode(code, mode = 'price') {
  const invalid = { itemCode: null, value: null, mode, valid: false, flag: null, deptCode: null, checkDigit: null }
  if (typeof code !== 'string' || !DIGITS_13.test(code) || code[0] !== '2') return invalid
  if (!validateGTIN13(code)) return invalid // 檢查碼被竄改 → 整筆不可信

  const raw = Number(code.slice(7, 12))
  return {
    flag: code[0],
    deptCode: code[1],
    itemCode: code.slice(2, 7),                              // 5 碼品號
    value: mode === 'weight' ? Math.round(raw) / 1000 : raw, // weight：公克 → kg（3 位小數）
    mode,
    valid: true,
    checkDigit: Number(code[12]),
  }
}

/**
 * 條碼分類
 * @param {string} code
 * @returns {'GTIN-13'|'店內碼'|'秤重碼'|'unknown'}
 */
export function classifyBarcode(code) {
  if (typeof code !== 'string' || code.trim() === '') return 'unknown'
  const c = code.trim()
  if (DIGITS_13.test(c) && validateGTIN13(c)) {
    return c[0] === '2' ? '秤重碼' : 'GTIN-13'
  }
  if (DIGITS_13.test(c)) return 'unknown' // 13 碼但檢查碼錯：多半是刷錯/竄改，不當店內碼
  if (STORE_CODE.test(c)) return '店內碼'
  return 'unknown'
}

/**
 * 掃碼解析：秤重碼 → 解析品號＋內含金額後以品號查 SKU；其餘直接以條碼查
 * @param {string} code — 掃入的原始條碼
 * @param {(barcode: string) => Promise<Object|null>} lookupFn — 條碼/品號 → SKU 查詢（注入，例如 lookupByBarcode）
 * @param {{scaleMode?: 'price'|'weight'}} [options] — 秤重碼值欄位語意（F&B 預設內含金額）
 * @returns {Promise<{type: string, sku: Object|null, found: boolean, raw: string,
 *                    embeddedPrice: number|null, embeddedWeight: number|null, scale: Object|null}>}
 */
export async function resolveScan(code, lookupFn, { scaleMode = 'price' } = {}) {
  const raw = typeof code === 'string' ? code.trim() : ''
  const type = classifyBarcode(raw)
  const base = { type, raw, sku: null, found: false, embeddedPrice: null, embeddedWeight: null, scale: null }

  if (type === 'unknown') return base

  if (type === '秤重碼') {
    const scale = parseScaleBarcode(raw, scaleMode)
    if (!scale.valid) return { ...base, scale }
    const sku = (await lookupFn(scale.itemCode)) || null
    return {
      ...base,
      sku,
      found: !!sku,
      scale,
      embeddedPrice: scaleMode === 'price' ? scale.value : null,
      embeddedWeight: scaleMode === 'weight' ? scale.value : null,
    }
  }

  const sku = (await lookupFn(raw)) || null
  return { ...base, sku, found: !!sku }
}
