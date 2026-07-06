/**
 * F-B3 401 申報正規化 — 進銷項憑證檔運算（純函式）
 *
 * 1. generate401FromVatDocs — 從 vat_output_documents / vat_input_documents 彙總 401
 *    （依 tax_type 分欄；進項「不可扣抵」不入扣抵稅額）
 * 2. generateVatMediaFile   — 財政部進銷項媒體申報檔（固定長度 81 bytes/筆）
 * 3. MEDIA_LAYOUT           — 媒體檔欄位規格（起迄位置可測試）
 * 4. calculate403Deduction  — 403 兼營比例扣抵法（不可扣抵比例）
 *
 * TODO(fia-verify)：媒體檔版面以「營業人使用媒體申報作業要點」為基礎自訂實作，
 * 正式上線前須以財政部「申報媒體檔案審核系統」實測通過（PLAN 四/4.4 外部驗收）。
 */
import { formatTaxPeriod } from './taxReport.js'
import { TAX_TYPE_CODES } from './einvoice/constants.js'

// ══════════════════════════════════════
//  媒體檔版面規格（固定長度 81 bytes/筆）
// ══════════════════════════════════════

/**
 * 進銷項媒體申報檔版面（每筆 81 bytes，1-based 起始位置）
 *
 * ┌────┬──────────────────┬────┬──────┬─────────────────────────────────────────────┐
 * │ 位置 │ 欄位              │ 長度 │ 補齊  │ 說明                                        │
 * ├────┼──────────────────┼────┼──────┼─────────────────────────────────────────────┤
 * │ 1-2  │ format_code      │ 2  │ 左補0 │ 格式代號（進項 21-29／銷項 31-38）            │
 * │ 3-7  │ roc_year_month   │ 5  │ 左補0 │ 民國年月 YYYMM（例 11507 = 115年7月）         │
 * │ 8-15 │ seller_ubn       │ 8  │ 右補空 │ 申報營業人統一編號                            │
 * │16-23 │ counterparty_ubn │ 8  │ 右補空 │ 交易對象統編（B2C 無統編 → 空白）             │
 * │24-33 │ doc_number       │ 10 │ 右補空 │ 憑證號碼（字軌 2 碼 + 流水 8 碼）             │
 * │34-45 │ amount           │ 12 │ 左補0 │ 銷售額/進貨額（未稅，整數，取絕對值 —          │
 * │      │                  │    │      │ 折讓以格式代號 33/25 表意負向）               │
 * │46-55 │ tax_amount       │ 10 │ 左補0 │ 營業稅額（整數，取絕對值）                    │
 * │ 56   │ tax_type_code    │ 1  │  —   │ 課稅別：1 應稅／2 零稅率／3 免稅              │
 * │ 57   │ deduction_code   │ 1  │  —   │ 扣抵代號：進項 1 可扣抵／2 不可扣抵；銷項 0    │
 * │58-81 │ filler           │ 24 │ 右補空 │ 保留欄位（空白）                              │
 * └────┴──────────────────┴────┴──────┴─────────────────────────────────────────────┘
 */
export const MEDIA_LAYOUT = {
  recordLength: 81,
  fields: [
    { name: 'format_code',      start: 1,  length: 2,  pad: 'zero-left',   desc: '格式代號（進項21-29／銷項31-38）' },
    { name: 'roc_year_month',   start: 3,  length: 5,  pad: 'zero-left',   desc: '民國年月 YYYMM' },
    { name: 'seller_ubn',       start: 8,  length: 8,  pad: 'space-right', desc: '申報營業人統一編號' },
    { name: 'counterparty_ubn', start: 16, length: 8,  pad: 'space-right', desc: '交易對象統一編號（B2C 空白）' },
    { name: 'doc_number',       start: 24, length: 10, pad: 'space-right', desc: '憑證號碼（字軌2碼+流水8碼）' },
    { name: 'amount',           start: 34, length: 12, pad: 'zero-left',   desc: '未稅金額（整數、絕對值；折讓以格式代號表意）' },
    { name: 'tax_amount',       start: 46, length: 10, pad: 'zero-left',   desc: '營業稅額（整數、絕對值）' },
    { name: 'tax_type_code',    start: 56, length: 1,  pad: 'zero-left',   desc: '課稅別 1應稅/2零稅率/3免稅' },
    { name: 'deduction_code',   start: 57, length: 1,  pad: 'zero-left',   desc: '扣抵代號 進項:1可扣抵/2不可扣抵；銷項:0' },
    { name: 'filler',           start: 58, length: 24, pad: 'space-right', desc: '保留欄位（空白）' },
  ],
}

// ── 補齊工具 ──
const padZeroLeft = (v, len) => String(v ?? '').replace(/\D/g, '').slice(-len).padStart(len, '0')
const padSpaceRight = (v, len) => String(v ?? '').slice(0, len).padEnd(len, ' ')

/** 期別正規化：int 202607（奇數月 YYYYMM）或 {year, startMonth, endMonth} */
function normalizePeriod(period) {
  if (period && typeof period === 'object') {
    const { year, startMonth, endMonth } = period
    return { year, startMonth, endMonth: endMonth || startMonth + 1 }
  }
  const p = Number(period) || 0
  const year = Math.floor(p / 100)
  const startMonth = p % 100
  return { year, startMonth, endMonth: startMonth + 1 }
}

/** 民國年月 YYYMM（例 2026-07 → '11507'） */
function rocYearMonth(year, month) {
  return `${String(year - 1911).padStart(3, '0')}${String(month).padStart(2, '0')}`
}

// ══════════════════════════════════════
//  1. 401 申報 — 從進銷項憑證檔彙總
// ══════════════════════════════════════

const emptyBucket = () => ({ count: 0, amount: 0, tax: 0 })

/**
 * 從進銷項憑證檔產生 401 申報彙總（正式資料來源，非 AR/AP）
 *
 * - 銷項依 tax_type 分欄（應稅/零稅率/免稅）；折讓（負額/格式 33）自然沖減
 * - 進項僅 deduction_code='可扣抵' 計入扣抵稅額；不可扣抵列示但不扣抵
 *
 * @param {Array} outputDocs - vat_output_documents rows
 * @param {Array} inputDocs  - vat_input_documents rows
 * @param {number|Object} period - 期別 int YYYYMM（奇數月）或 {year, startMonth, endMonth}
 * @returns {Object} 401 報表（與 generate401FromDB 同形狀 + taxPayable/taxCredit/dataSource）
 */
export function generate401FromVatDocs(outputDocs = [], inputDocs = [], period) {
  const { year, startMonth, endMonth } = normalizePeriod(period)

  // ── 銷項：依課稅別分欄 ──
  const salesBuckets = { '應稅': emptyBucket(), '零稅率': emptyBucket(), '免稅': emptyBucket() }
  for (const doc of outputDocs) {
    const b = salesBuckets[doc.tax_type] || salesBuckets['應稅']
    b.count += 1
    b.amount += Number(doc.amount) || 0
    b.tax += Number(doc.tax_amount) || 0
  }

  const sales = {
    taxable:   salesBuckets['應稅'],
    zeroRated: { ...salesBuckets['零稅率'], tax: 0 },
    exempt:    { ...salesBuckets['免稅'], tax: 0 },
    total: {
      count: outputDocs.length,
      amount: salesBuckets['應稅'].amount + salesBuckets['零稅率'].amount + salesBuckets['免稅'].amount,
      tax: salesBuckets['應稅'].tax,
    },
  }

  // ── 進項：可扣抵 / 不可扣抵 ──
  const deductible = emptyBucket()
  const nonDeductible = emptyBucket()
  for (const doc of inputDocs) {
    const b = doc.deduction_code === '不可扣抵' ? nonDeductible : deductible
    b.count += 1
    b.amount += Number(doc.amount) || 0
    b.tax += Number(doc.tax_amount) || 0
  }

  const purchases = {
    taxable: deductible, // 舊 UI 形狀相容（應稅進項 = 可扣抵）
    deductible,
    nonDeductible,
    total: {
      count: inputDocs.length,
      amount: deductible.amount + nonDeductible.amount,
      tax: deductible.tax, // 扣抵稅額僅計可扣抵
    },
  }

  const outputTax = sales.total.tax
  const inputTax = purchases.total.tax
  const netTax = outputTax - inputTax

  return {
    period: formatTaxPeriod(year, startMonth, endMonth),
    year,
    sales,
    purchases,
    summary: {
      outputTax,
      inputTax,
      taxPayable: netTax,      // 與 generate401FromDB 同義（含正負號）
      isRefund: netTax < 0,
    },
    taxPayable: netTax > 0 ? netTax : 0, // 應納稅額
    taxCredit: netTax < 0 ? Math.abs(netTax) : 0, // 溢付留抵稅額
    dataSource: 'vat_documents',
  }
}

// ══════════════════════════════════════
//  2. 進銷項媒體申報檔（固定長度 81 bytes/筆）
// ══════════════════════════════════════

/** 單一憑證 → 81 bytes 固定長度記錄（依 MEDIA_LAYOUT） */
function buildMediaRecord(doc, sellerUbn, fallbackYm) {
  const d = doc.doc_date ? new Date(doc.doc_date) : null
  const ym = d && !Number.isNaN(d.getTime())
    ? rocYearMonth(d.getFullYear(), d.getMonth() + 1)
    : fallbackYm

  const isInput = String(doc.format_code || '').startsWith('2')
  const deductionDigit = isInput ? (doc.deduction_code === '不可扣抵' ? '2' : '1') : '0'

  const record =
    padZeroLeft(doc.format_code, 2) +                                    // 1-2   格式代號
    padZeroLeft(ym, 5) +                                                 // 3-7   民國年月
    padSpaceRight(sellerUbn, 8) +                                        // 8-15  營業人統編
    padSpaceRight(doc.counterparty_ubn || '', 8) +                       // 16-23 對象統編
    padSpaceRight(doc.doc_number || '', 10) +                            // 24-33 憑證號碼
    padZeroLeft(Math.abs(Math.round(Number(doc.amount) || 0)), 12) +     // 34-45 未稅金額
    padZeroLeft(Math.abs(Math.round(Number(doc.tax_amount) || 0)), 10) + // 46-55 稅額
    (TAX_TYPE_CODES[doc.tax_type] || '1') +                              // 56    課稅別
    deductionDigit +                                                     // 57    扣抵代號
    ' '.repeat(24)                                                       // 58-81 保留欄位

  if (record.length !== MEDIA_LAYOUT.recordLength) {
    throw new Error(`媒體檔記錄長度錯誤：${record.length}（應為 ${MEDIA_LAYOUT.recordLength}）`)
  }
  return record
}

/**
 * 產生財政部進銷項媒體申報檔（每筆 81 bytes；銷項在前、進項在後）
 *
 * TODO(fia-verify)：正式申報前以財政部「申報媒體檔案審核系統」實測版面。
 *
 * @param {Array} outputDocs - 銷項憑證（vat_output_documents rows）
 * @param {Array} inputDocs  - 進項憑證（vat_input_documents rows）
 * @param {number|Object} period - 期別 int YYYYMM 或 {year, startMonth}
 * @param {string} sellerUbn - 申報營業人統一編號（8 碼）
 * @returns {string} 換行分隔之固定長度記錄
 */
export function generateVatMediaFile(outputDocs = [], inputDocs = [], period, sellerUbn) {
  const { year, startMonth } = normalizePeriod(period)
  const fallbackYm = rocYearMonth(year, startMonth)

  const lines = []
  for (const doc of outputDocs) lines.push(buildMediaRecord(doc, sellerUbn, fallbackYm))
  for (const doc of inputDocs) lines.push(buildMediaRecord(doc, sellerUbn, fallbackYm))
  return lines.join('\n')
}

// ══════════════════════════════════════
//  3. 403 兼營比例扣抵法
// ══════════════════════════════════════

/**
 * 403 兼營營業人比例扣抵法（當期不可扣抵比例）
 *
 * 依「兼營營業人營業稅額計算辦法」：
 *   不可扣抵比例 = 免稅銷售淨額 ÷ 全部銷售淨額（計算至百分比整數位，小數點以下不計）
 *   不可扣抵進項稅額 = 進項稅額 × 不可扣抵比例
 *
 * @param {number} exemptSales - 免稅銷售額
 * @param {number} totalSales  - 全部銷售額
 * @param {number} inputTax    - 當期進項稅額（可扣抵憑證合計）
 * @returns {{nonDeductibleRatio: number, nonDeductibleTax: number, deductibleInputTax: number}}
 */
export function calculate403Deduction(exemptSales, totalSales, inputTax) {
  const exempt = Number(exemptSales) || 0
  const total = Number(totalSales) || 0
  const tax = Math.round(Number(inputTax) || 0)

  if (total <= 0 || exempt <= 0) {
    return { nonDeductibleRatio: 0, nonDeductibleTax: 0, deductibleInputTax: tax }
  }

  // 百分比整數位、小數點以下不計（無條件捨去）
  const ratio = Math.floor((exempt / total) * 100) / 100
  const nonDeductibleTax = Math.round(tax * ratio)

  return {
    nonDeductibleRatio: ratio,
    nonDeductibleTax,
    deductibleInputTax: tax - nonDeductibleTax,
  }
}

// ══════════════════════════════════════
//  4. 舊版媒體申報檔（deprecated pipe 格式）
// ══════════════════════════════════════

/** 字串右補空白至指定長度（舊版媒體申報固定欄寬用） */
function padRight(str, len) {
  const s = String(str || '')
  return s.length >= len ? s.substring(0, len) : s + ' '.repeat(len - s.length)
}

/**
 * 產生媒體申報格式字串（結構化文字檔）
 *
 * @deprecated 自訂 pipe 分隔格式，未對齊財政部規範 — 進銷項媒體申報請改用
 * generateVatMediaFile（固定長度 81 bytes/筆）。本函式保留供舊頁面過渡。
 *
 * 401 格式：pipe 分隔，每行一張發票
 * 403 格式：pipe 分隔，每行一筆扣繳紀錄
 *
 * @param {Object} report - generate401Report 或 generateWithholdingSummary 的結果
 * @param {string} type - 報表類型 ('401' | '403')
 * @returns {string} 媒體申報格式字串
 */
export function generateMediaFile(report, type) {
  const lines = []

  if (type === '401') {
    // ── 401 營業稅媒體申報格式 ──
    // 檔頭：期別、銷項總額、進項總額、應納稅額
    lines.push(
      `H|${report.period}|${report.salesAmount}|${report.salesTax}|${report.purchaseAmount}|${report.purchaseTax}|${report.netTax}`
    )
    // 銷項明細
    for (const row of (report.rows?.sales || [])) {
      lines.push(
        `S|${row.invoice_no}|${row.date}|${padRight(row.buyer_tax_id, 8)}|${row.amount}|${row.tax}`
      )
    }
    // 進項明細
    for (const row of (report.rows?.purchases || [])) {
      lines.push(
        `P|${row.invoice_no}|${row.date}|${padRight(row.seller_tax_id, 8)}|${row.amount}|${row.tax}`
      )
    }
    // 檔尾
    lines.push(
      `T|${report.salesInvoiceCount || 0}|${report.purchaseInvoiceCount || 0}|${report.taxPayable}|${report.taxCredit || 0}`
    )
  } else if (type === '403') {
    // ── 各類所得扣繳彙總媒體申報格式（沿用舊 type 代碼 '403'）──
    // 檔頭
    lines.push(
      `H|${report.period}|${report.summary?.total_records || 0}|${report.summary?.total_gross || 0}|${report.summary?.total_withheld || 0}`
    )
    // 明細
    for (const rec of (report.records || [])) {
      lines.push(
        `D|${padRight(rec.payee_id, 10)}|${padRight(rec.payee_name, 20)}|${rec.income_type}|${rec.gross_amount}|${rec.tax_withheld}`
      )
    }
    // 各類別小計
    for (const st of (report.summary_by_type || [])) {
      lines.push(
        `S|${st.income_type}|${st.income_type_name}|${st.count}|${st.total_gross}|${st.total_withheld}`
      )
    }
    // 檔尾
    lines.push(
      `T|${report.summary?.total_records || 0}|${report.summary?.total_gross || 0}|${report.summary?.total_withheld || 0}`
    )
  }

  return lines.join('\n')
}
