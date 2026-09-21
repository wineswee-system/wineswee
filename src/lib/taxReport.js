/**
 * 台灣稅務申報引擎
 *
 * 支援報表：
 * 1. 401 營業稅申報表（銷項 / 進項 / 應納稅額）
 * 2. 各類所得扣繳彙總（generateWithholdingSummary；舊名 generate403Report 已棄用 —
 *    其內容為扣繳彙總，並非營業稅 403 兼營申報）
 * 3. 營業稅計算（標準稅率 5%）
 * 4. 民國年期別格式化
 * 5. 媒體申報檔案產生（F-B3 正式版在 vatReport.js — 本檔另 re-export）
 *
 * 除 generate401FromDB 外皆為純函式，不依賴外部狀態
 */

// F-B3 進銷項憑證檔運算（401 彙總 / 81-byte 媒體檔 / 403 兼營比例扣抵）
export {
  generate401FromVatDocs,
  generateVatMediaFile,
  MEDIA_LAYOUT,
  calculate403Deduction,
  generateMediaFile, // @deprecated pipe 格式（實作移至 vatReport.js）
} from './vatReport.js'
import { generate401FromVatDocs } from './vatReport.js'

// ══════════════════════════════════════
//  常數定義
// ══════════════════════════════════════

// 各類所得代碼對照
const INCOME_TYPE_MAP = {
  '50': '薪資所得',
  '9A': '執行業務所得',
  '9B': '稿費所得',
  '92': '租賃所得',
  '91': '權利金所得',
  '93': '競技競賽獎金',
  '94': '中獎獎金',
  '76': '退職所得',
  '5A': '兼職薪資',
}

// ══════════════════════════════════════
//  1. 401 營業稅申報
// ══════════════════════════════════════

/**
 * 產生 401 營業稅申報表
 *
 * 營業稅 = 銷項稅額 - 進項稅額
 * 若結果為正，為應繳納稅額；若為負，為留抵稅額。
 *
 * @param {Array} salesInvoices - 銷項發票（開出的發票）
 *   [{invoice_no, date, buyer_tax_id, buyer_name, amount, tax_rate}]
 * @param {Array} purchaseInvoices - 進項發票（收到的發票）
 *   [{invoice_no, date, seller_tax_id, seller_name, amount, tax_rate}]
 * @param {Object} period - 申報期別
 *   {year: number, startMonth: number, endMonth: number}
 * @returns {Object} 401 申報資料
 */
export function generate401Report(salesInvoices, purchaseInvoices, period) {
  const taxRate = 0.05 // 標準營業稅率 5%

  // ── 銷項彙總 ──
  const salesRows = []
  let salesAmount = 0
  let salesTax = 0

  for (const inv of (salesInvoices || [])) {
    const rate = inv.tax_rate ?? taxRate
    const tax = Math.round(inv.amount * rate)

    salesRows.push({
      invoice_no: inv.invoice_no,
      date: inv.date,
      buyer_tax_id: inv.buyer_tax_id || '',
      buyer_name: inv.buyer_name || '',
      amount: inv.amount,
      tax,
    })

    salesAmount += inv.amount
    salesTax += tax
  }

  // ── 進項彙總 ──
  const purchaseRows = []
  let purchaseAmount = 0
  let purchaseTax = 0

  for (const inv of (purchaseInvoices || [])) {
    const rate = inv.tax_rate ?? taxRate
    const tax = Math.round(inv.amount * rate)

    purchaseRows.push({
      invoice_no: inv.invoice_no,
      date: inv.date,
      seller_tax_id: inv.seller_tax_id || '',
      seller_name: inv.seller_name || '',
      amount: inv.amount,
      tax,
    })

    purchaseAmount += inv.amount
    purchaseTax += tax
  }

  // 應納（退）稅額
  const netTax = salesTax - purchaseTax
  const taxPayable = netTax > 0 ? netTax : 0
  const taxCredit = netTax < 0 ? Math.abs(netTax) : 0

  // 格式化期別
  const periodLabel = formatTaxPeriod(period?.year, period?.startMonth, period?.endMonth)

  return {
    period: periodLabel,
    salesAmount,
    salesTax,
    salesInvoiceCount: salesRows.length,
    purchaseAmount,
    purchaseTax,
    purchaseInvoiceCount: purchaseRows.length,
    netTax,
    taxPayable,
    taxCredit,
    rows: {
      sales: salesRows,
      purchases: purchaseRows,
    },
  }
}

// ══════════════════════════════════════
//  2. 各類所得扣繳彙總（原誤名 403）
// ══════════════════════════════════════

/**
 * 產生各類所得扣繳暨免扣繳憑單彙總
 *
 * 註：本報表為「扣繳彙總」，並非營業稅 403（兼營）申報書 —
 * 舊名 generate403Report 為命名誤導，已改名（PLAN F-B3.2）。
 *
 * @param {Array} withholdingRecords - 扣繳紀錄
 *   [{payee_id, payee_name, income_type, gross_amount, tax_withheld}]
 * @param {Object} period - 申報期別
 *   {year: number, startMonth: number, endMonth: number}
 * @returns {Object} 扣繳彙總資料
 */
export function generateWithholdingSummary(withholdingRecords, period) {
  const records = []
  const summaryByType = {} // 依所得類別彙總

  for (const rec of (withholdingRecords || [])) {
    const typeCode = rec.income_type || '50'
    const typeName = INCOME_TYPE_MAP[typeCode] || `其他(${typeCode})`

    records.push({
      payee_id: rec.payee_id,
      payee_name: rec.payee_name,
      income_type: typeCode,
      income_type_name: typeName,
      gross_amount: rec.gross_amount,
      tax_withheld: rec.tax_withheld,
    })

    // 彙總
    if (!summaryByType[typeCode]) {
      summaryByType[typeCode] = {
        income_type: typeCode,
        income_type_name: typeName,
        count: 0,
        total_gross: 0,
        total_withheld: 0,
      }
    }
    summaryByType[typeCode].count += 1
    summaryByType[typeCode].total_gross += rec.gross_amount
    summaryByType[typeCode].total_withheld += rec.tax_withheld
  }

  const totalGross = records.reduce((s, r) => s + r.gross_amount, 0)
  const totalWithheld = records.reduce((s, r) => s + r.tax_withheld, 0)

  const periodLabel = formatTaxPeriod(period?.year, period?.startMonth, period?.endMonth)

  return {
    period: periodLabel,
    records,
    summary_by_type: Object.values(summaryByType),
    summary: {
      total_records: records.length,
      total_gross: totalGross,
      total_withheld: totalWithheld,
    },
  }
}

/** @deprecated 誤名 — 內容為扣繳彙總而非營業稅 403，請改用 generateWithholdingSummary */
export const generate403Report = generateWithholdingSummary

// ══════════════════════════════════════
//  3. 營業稅計算
// ══════════════════════════════════════

/**
 * 營業稅計算（含稅 / 未稅轉換）
 *
 * 台灣營業稅標準稅率為 5%
 *
 * @param {number} amount - 未稅金額
 * @param {number} taxRate - 稅率（預設 0.05 = 5%）
 * @returns {Object} {taxableAmount, taxAmount, totalWithTax}
 */
export function calculateBusinessTax(amount, taxRate = 0.05) {
  const taxableAmount = Math.round(amount)
  const taxAmount = Math.round(taxableAmount * taxRate)
  const totalWithTax = taxableAmount + taxAmount

  return {
    taxableAmount,
    taxAmount,
    totalWithTax,
  }
}

// ══════════════════════════════════════
//  4. 民國年期別格式化
// ══════════════════════════════════════

/**
 * 將西元年月轉換為民國年期別字串
 *
 * 營業稅為雙月申報（1-2月、3-4月、5-6月...）
 *
 * @param {number} year - 西元年（例如 2026）
 * @param {number} month - 起始月份（1-12）
 * @param {number} [endMonth] - 結束月份（省略時自動取下一個月）
 * @returns {string} 民國年期別（例如 "115年01-02月"）
 */
export function formatTaxPeriod(year, month, endMonth) {
  if (!year || !month) return ''

  // 西元轉民國
  const rocYear = year - 1911

  const startStr = String(month).padStart(2, '0')
  const end = endMonth || (month % 2 === 1 ? month + 1 : month)
  const endStr = String(end).padStart(2, '0')

  if (startStr === endStr) {
    return `${rocYear}年${startStr}月`
  }

  return `${rocYear}年${startStr}-${endStr}月`
}

// ══════════════════════════════════════
//  5. 媒體申報檔案產生
//  （deprecated pipe 格式 generateMediaFile 移至 vatReport.js，
//    與正式 81-byte 版 generateVatMediaFile 併置 — 本檔頂部 re-export）
// ══════════════════════════════════════

// ══════════════════════════════════════
//  6. 401 營業稅申報 — 從資料庫產生
// ══════════════════════════════════════

/**
 * 從 Supabase 產生 401 營業稅申報表
 *
 * 資料來源優先序（F-B3）：
 * 1. vat_output_documents / vat_input_documents（正式進銷項憑證檔）— 該期別有資料時採用
 *    → 結果帶 dataSource: 'vat_documents'
 * 2. 憑證檔無資料（或表尚未建立）→ 回退舊來源 invoices + accounts_payable
 *    → 結果帶 dataSource: 'legacy'
 *
 * @param {number} year   - 西元年
 * @param {number} period - 雙月期別 (1=1-2月, 2=3-4月, 3=5-6月, 4=7-8月, 5=9-10月, 6=11-12月)
 * @param {object} supabaseClient - Supabase client instance
 * @returns {Promise<object>} 結構化 401 報表資料
 */
export async function generate401FromDB(year, period, supabaseClient) {
  // 計算日期範圍
  const startMonth = (period - 1) * 2 + 1
  const endMonth = startMonth + 1
  const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`
  const endDay = new Date(year, endMonth, 0).getDate()
  const endDate = `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`

  // ── 優先：正式進銷項憑證檔（vat_* 表；期別 int YYYYMM 奇數月）──
  const periodInt = year * 100 + startMonth
  try {
    const [outRes, inRes] = await Promise.all([
      supabaseClient.from('vat_output_documents').select('*').eq('period', periodInt),
      supabaseClient.from('vat_input_documents').select('*').eq('period', periodInt),
    ])
    const outputDocs = outRes.error ? [] : (outRes.data || [])
    const inputDocs = inRes.error ? [] : (inRes.data || [])

    if (outputDocs.length > 0 || inputDocs.length > 0) {
      const report = generate401FromVatDocs(outputDocs, inputDocs, periodInt)
      return {
        ...report,
        bimonthPeriod: period,
        startDate,
        endDate,
        dataSource: 'vat_documents',
        _raw: { outputDocs, inputDocs },
      }
    }
  } catch {
    // 憑證檔查詢失敗（表未建立等）→ 靜默回退 legacy 來源
  }

  const TAX_RATE = 0.05

  // ── 銷項：查詢 invoices (開出的發票) ──
  const { data: invoices, error: invErr } = await supabaseClient
    .from('invoices')
    .select('*')
    .gte('invoice_date', startDate)
    .lte('invoice_date', endDate)
    .neq('status', 'voided')

  if (invErr) throw new Error(`查詢銷項發票失敗：${invErr.message}`)

  // 依稅別分類
  const salesByType = { taxable: [], zeroRated: [], exempt: [] }
  for (const inv of (invoices || [])) {
    const taxType = inv.tax_type || '應稅'
    const amount = Number(inv.amount) || Number(inv.total_amount) || 0
    const entry = { ...inv, _amount: amount }

    if (taxType === '零稅率') {
      salesByType.zeroRated.push(entry)
    } else if (taxType === '免稅') {
      salesByType.exempt.push(entry)
    } else {
      salesByType.taxable.push(entry)
    }
  }

  const sumAmount = (arr) => arr.reduce((s, r) => s + r._amount, 0)

  const taxableAmount = sumAmount(salesByType.taxable)
  const zeroRatedAmount = sumAmount(salesByType.zeroRated)
  const exemptAmount = sumAmount(salesByType.exempt)
  const taxableTax = Math.round(taxableAmount * TAX_RATE)

  const sales = {
    taxable:  { count: salesByType.taxable.length,  amount: taxableAmount,  tax: taxableTax },
    zeroRated:{ count: salesByType.zeroRated.length, amount: zeroRatedAmount, tax: 0 },
    exempt:   { count: salesByType.exempt.length,    amount: exemptAmount,    tax: 0 },
    total: {
      count: (invoices || []).length,
      amount: taxableAmount + zeroRatedAmount + exemptAmount,
      tax: taxableTax,
    },
  }

  // ── 進項：查詢 accounts_payable (收到的進項發票) ──
  const { data: apRecords, error: apErr } = await supabaseClient
    .from('accounts_payable')
    .select('*')
    .gte('due_date', startDate)
    .lte('due_date', endDate)

  if (apErr) throw new Error(`查詢進項資料失敗：${apErr.message}`)

  let purchaseAmount = 0
  for (const ap of (apRecords || [])) {
    purchaseAmount += Number(ap.amount) || 0
  }
  const purchaseTax = Math.round(purchaseAmount * TAX_RATE)

  const purchases = {
    taxable: { count: (apRecords || []).length, amount: purchaseAmount, tax: purchaseTax },
    total:   { count: (apRecords || []).length, amount: purchaseAmount, tax: purchaseTax },
  }

  // ── 稅額計算 ──
  const outputTax = sales.total.tax
  const inputTax = purchases.total.tax
  const taxPayable = outputTax - inputTax
  const isRefund = taxPayable < 0

  const periodLabel = formatTaxPeriod(year, startMonth, endMonth)

  return {
    period: periodLabel,
    year,
    bimonthPeriod: period,
    startDate,
    endDate,
    sales,
    purchases,
    summary: {
      outputTax,
      inputTax,
      taxPayable,
      isRefund,
    },
    dataSource: 'legacy', // 憑證檔無資料 → 舊來源（invoices + accounts_payable）
    // 保留原始資料供明細展開
    _raw: {
      invoices: invoices || [],
      apRecords: apRecords || [],
    },
  }
}

// ══════════════════════════════════════
//  7. CSV 匯出 (稅務報表用)
// ══════════════════════════════════════

/**
 * 將 401 報表資料轉為 CSV 字串
 * @param {object} reportData - generate401FromDB 回傳的資料
 * @returns {string} CSV 字串
 */
export function taxReportToCSV(reportData) {
  const rows = []
  const { sales, purchases, summary, period, startDate, endDate } = reportData

  rows.push(`營業稅申報表 (401)`)
  rows.push(`期別,${period}`)
  rows.push(`起訖日期,${startDate} ~ ${endDate}`)
  rows.push(`產生日期,${new Date().toLocaleString('zh-TW')}`)
  rows.push(``)
  rows.push(`一、銷項`)
  rows.push(`項目,發票張數,銷售額(未稅),稅額`)
  rows.push(`應稅,${sales.taxable.count},${sales.taxable.amount},${sales.taxable.tax}`)
  rows.push(`零稅率,${sales.zeroRated.count},${sales.zeroRated.amount},${sales.zeroRated.tax}`)
  rows.push(`免稅,${sales.exempt.count},${sales.exempt.amount},${sales.exempt.tax}`)
  rows.push(`合計,${sales.total.count},${sales.total.amount},${sales.total.tax}`)
  rows.push(``)
  rows.push(`二、進項`)
  rows.push(`項目,張數,進貨額(未稅),稅額`)
  rows.push(`應稅進項,${purchases.taxable.count},${purchases.taxable.amount},${purchases.taxable.tax}`)
  rows.push(``)
  rows.push(`三、應納稅額`)
  rows.push(`銷項稅額,${summary.outputTax}`)
  rows.push(`進項稅額,${summary.inputTax}`)
  rows.push(`應納(溢付)稅額,${summary.taxPayable}`)

  return rows.join('\n')
}
