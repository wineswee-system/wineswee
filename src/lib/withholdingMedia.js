/**
 * F-B4 各類所得憑單資料電子申報 — 媒體申報檔（固定長度/筆）
 *
 * 對齊財政部「各類所得憑單（含信託）資料電子申報」固定欄寬格式的自訂實作，
 * 版面規格集中在 WITHHOLDING_MEDIA_LAYOUT（同 vatReport.js MEDIA_LAYOUT 慣例，
 * 起迄位置可測試）。與 generateWithholdingSummary（扣繳彙總）並存 — 純新增，
 * 不取代任何既有函式；列印版仍走 withholdingCertificate.js。
 *
 * 欄位長度一律以 **byte** 計（Big5 申報媒體慣例：CJK 一字 = 2 bytes），
 * 中文姓名以 big5PadRight 依 byte 數補齊/截斷，確保每筆記錄 byte 長度固定。
 *
 * TODO(ntbsa-verify)：正式申報前須以國稅局「各類所得憑單資料電子申報系統
 * 審核程式」實測版面通過（PLAN F-B4.1 外部驗收）。
 */

// ══════════════════════════════════════
//  版面規格（每筆 120 bytes，1-based byte 起始位置）
// ══════════════════════════════════════

/**
 * 各類所得憑單媒體檔版面（每筆 120 bytes）
 *
 * ┌───────┬───────────────┬────┬──────┬───────────────────────────────────────────┐
 * │ 位置   │ 欄位           │ 長度 │ 補齊  │ 說明                                       │
 * ├───────┼───────────────┼────┼──────┼───────────────────────────────────────────┤
 * │ 1-2    │ format_code   │ 2  │ 左補0 │ 格式代別（50 薪資／9A 執行業務／9B 稿費／92 租賃…）│
 * │ 3-10   │ filer_ubn     │ 8  │ 右補空 │ 扣繳單位統一編號                             │
 * │ 11-13  │ roc_year      │ 3  │ 左補0 │ 所得年度（民國 3 碼，例 115）                 │
 * │ 14-23  │ payee_id      │ 10 │ 右補空 │ 所得人統一編（證）號                          │
 * │ 24-43  │ payee_name    │ 20 │ 右補空 │ 所得人姓名（byte 計長，CJK 一字 2 bytes）      │
 * │ 44-55  │ gross_amount  │ 12 │ 左補0 │ 給付總額（整數，取絕對值）                    │
 * │ 56-65  │ tax_withheld  │ 10 │ 左補0 │ 扣繳稅額（整數）                             │
 * │ 66-75  │ nhi_premium   │ 10 │ 左補0 │ 二代健保補充保費（代扣，整數）                 │
 * │ 76-120 │ filler        │ 45 │ 右補空 │ 保留欄位（空白）                             │
 * └───────┴───────────────┴────┴──────┴───────────────────────────────────────────┘
 */
export const WITHHOLDING_MEDIA_LAYOUT = {
  recordLength: 120, // bytes（CJK 一字 = 2 bytes）
  fields: [
    { name: 'format_code',  start: 1,   length: 2,  pad: 'zero-left',   desc: '格式代別（50/9A/9B/92…）' },
    { name: 'filer_ubn',    start: 3,   length: 8,  pad: 'space-right', desc: '扣繳單位統一編號' },
    { name: 'roc_year',     start: 11,  length: 3,  pad: 'zero-left',   desc: '所得年度（民國 3 碼）' },
    { name: 'payee_id',     start: 14,  length: 10, pad: 'space-right', desc: '所得人統一編（證）號' },
    { name: 'payee_name',   start: 24,  length: 20, pad: 'space-right', desc: '所得人姓名（byte 計長，CJK=2）' },
    { name: 'gross_amount', start: 44,  length: 12, pad: 'zero-left',   desc: '給付總額（整數、絕對值）' },
    { name: 'tax_withheld', start: 56,  length: 10, pad: 'zero-left',   desc: '扣繳稅額（整數）' },
    { name: 'nhi_premium',  start: 66,  length: 10, pad: 'zero-left',   desc: '二代健保補充保費（整數）' },
    { name: 'filler',       start: 76,  length: 45, pad: 'space-right', desc: '保留欄位（空白）' },
  ],
}

// ══════════════════════════════════════
//  byte 計長工具（Big5：ASCII 1 byte、CJK 等非 ASCII 2 bytes）
// ══════════════════════════════════════

/**
 * 字串 byte 長度（CJK/全形一字計 2 bytes — Big5 媒體檔慣例）
 * @param {string} str
 * @returns {number}
 */
export function big5ByteLength(str) {
  let len = 0
  for (const ch of String(str ?? '')) {
    len += ch.codePointAt(0) > 0x7f ? 2 : 1
  }
  return len
}

/**
 * 依 byte 長度右補空白（超長時以「不切壞一個 CJK 字」為原則截斷，缺口補空白）
 * @param {string} str
 * @param {number} byteLen - 目標 byte 長度
 * @returns {string} byte 長度必為 byteLen
 */
export function big5PadRight(str, byteLen) {
  let out = ''
  let used = 0
  for (const ch of String(str ?? '')) {
    const w = ch.codePointAt(0) > 0x7f ? 2 : 1
    if (used + w > byteLen) break // CJK 塞不下就整字捨去（不切半字）
    out += ch
    used += w
  }
  return out + ' '.repeat(byteLen - used)
}

/** 數字左補 0（取絕對值整數；超長取尾端 — 對齊 vatReport padZeroLeft 慣例） */
const padZeroLeft = (v, len) => {
  const n = Math.abs(Math.round(Number(v) || 0))
  return String(n).slice(-len).padStart(len, '0')
}

/** ASCII 欄位右補空白（統編/證號等不含 CJK 的欄位） */
const padSpaceRight = (v, len) => String(v ?? '').slice(0, len).padEnd(len, ' ')

/** 代碼欄位左補 0（保留英數 — 格式代別含字母如 9A/9B/5A，不可走數字化） */
const padCodeLeft = (v, len) => String(v ?? '').trim().slice(0, len).padStart(len, '0')

/**
 * 依版面規格自記錄字串取出欄位值（byte-aware slice，供測試/除錯用）
 * @param {string} record - 單筆固定長度記錄
 * @param {string} fieldName - WITHHOLDING_MEDIA_LAYOUT.fields 之 name
 * @returns {string}
 */
export function sliceMediaField(record, fieldName) {
  const f = WITHHOLDING_MEDIA_LAYOUT.fields.find(x => x.name === fieldName)
  if (!f) throw new Error(`未知欄位：${fieldName}`)
  let out = ''
  let bytePos = 1 // 1-based
  for (const ch of String(record)) {
    const w = ch.codePointAt(0) > 0x7f ? 2 : 1
    if (bytePos >= f.start && bytePos < f.start + f.length) out += ch
    bytePos += w
    if (bytePos >= f.start + f.length) break
  }
  return out
}

// ══════════════════════════════════════
//  媒體檔產生
// ══════════════════════════════════════

/** 單筆憑單 → 120-byte 固定長度記錄（依 WITHHOLDING_MEDIA_LAYOUT） */
function buildRecord(rec, rocYear, filerUbn) {
  const record =
    padCodeLeft(rec.format_code || rec.income_type || '50', 2) + // 1-2    格式代別
    padSpaceRight(filerUbn, 8) +                                 // 3-10   扣繳單位統編
    padZeroLeft(rocYear, 3) +                                    // 11-13  所得年度（民國）
    padSpaceRight(rec.payee_id || '', 10) +                      // 14-23  所得人統一編（證）號
    big5PadRight(rec.payee_name || '', 20) +                     // 24-43  所得人姓名（byte 計長）
    padZeroLeft(rec.gross_amount, 12) +                          // 44-55  給付總額
    padZeroLeft(rec.tax_withheld, 10) +                          // 56-65  扣繳稅額
    padZeroLeft(rec.nhi_premium, 10) +                           // 66-75  二代健保補充保費
    ' '.repeat(45)                                               // 76-120 保留欄位

  const byteLen = big5ByteLength(record)
  if (byteLen !== WITHHOLDING_MEDIA_LAYOUT.recordLength) {
    throw new Error(`媒體檔記錄長度錯誤：${byteLen} bytes（應為 ${WITHHOLDING_MEDIA_LAYOUT.recordLength}）`)
  }
  return record
}

/**
 * 產生各類所得憑單媒體申報檔（每筆 120 bytes、一張憑單一筆）
 *
 * TODO(ntbsa-verify)：正式申報前以國稅局審核程式實測版面。
 *
 * @param {Array<{format_code?:string, income_type?:string, payee_id:string,
 *   payee_name:string, gross_amount:number, tax_withheld:number,
 *   nhi_premium?:number}>} records - 憑單記錄（一人一格式一筆）
 * @param {{year:number, filerUbn:string}} opts - 所得年度（西元）+ 扣繳單位統編
 * @returns {string} 換行分隔之固定長度記錄
 */
export function generateWithholdingMediaFile(records, { year, filerUbn } = {}) {
  if (!year) throw new Error('缺少所得年度（year）')
  const rocYear = year - 1911

  return (records || [])
    .map(rec => buildRecord(rec, rocYear, filerUbn || ''))
    .join('\n')
}
