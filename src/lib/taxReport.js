/**
 * 台灣稅務申報引擎
 *
 * 支援報表：
 * 1. 401 營業稅申報表（銷項 / 進項 / 應納稅額）
 * 2. 403 各類所得扣繳暨免扣繳憑單申報
 * 3. 營業稅計算（標準稅率 5%）
 * 4. 民國年期別格式化
 * 5. 媒體申報檔案產生
 *
 * 所有函式皆為純函式，不依賴外部狀態
 */

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
//  2. 403 各類所得扣繳申報
// ══════════════════════════════════════

/**
 * 產生 403 各類所得扣繳暨免扣繳憑單申報
 *
 * @param {Array} withholdingRecords - 扣繳紀錄
 *   [{payee_id, payee_name, income_type, gross_amount, tax_withheld}]
 * @param {Object} period - 申報期別
 *   {year: number, startMonth: number, endMonth: number}
 * @returns {Object} 403 申報資料
 */
export function generate403Report(withholdingRecords, period) {
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
// ══════════════════════════════════════

/**
 * 產生媒體申報格式字串（結構化文字檔）
 *
 * 401 格式：固定欄位寬度，每行一張發票
 * 403 格式：固定欄位寬度，每行一筆扣繳紀錄
 *
 * @param {Object} report - generate401Report 或 generate403Report 的結果
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
    // ── 403 各類所得扣繳媒體申報格式 ──

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

// ══════════════════════════════════════
//  6. 401 營業稅申報 — 從資料庫產生
// ══════════════════════════════════════

/**
 * 從 Supabase 產生 401 營業稅申報表
 * 自動查詢 invoices + accounts_payable，依稅別分類彙總
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

// ── 輔助函式 ──

/**
 * 字串右補空白至指定長度（媒體申報固定欄寬用）
 */
function padRight(str, len) {
  const s = String(str || '')
  return s.length >= len ? s.substring(0, len) : s + ' '.repeat(len - s.length)
}
