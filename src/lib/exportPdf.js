import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// Common PDF setup with Chinese-friendly font
function createPdf(title, subtitle) {
  const doc = new jsPDF()
  // Header
  doc.setFontSize(18)
  doc.setTextColor(14, 116, 144) // cyan-ish
  doc.text(title, 14, 20)
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(subtitle || `Generated: ${new Date().toLocaleString('zh-TW')}`, 14, 28)
  doc.setDrawColor(200)
  doc.line(14, 31, 196, 31)
  return doc
}

// Export attendance records
export function exportAttendancePdf(records, filters = {}) {
  const doc = createPdf('Attendance Report', `Date: ${filters.date || 'All'} | Dept: ${filters.dept || 'All'}`)

  const head = [['#', 'Employee', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Status']]
  const body = records.map((r, i) => [
    i + 1,
    r.employee || '-',
    r.date || '-',
    r.clock_in || '-',
    r.clock_out || '-',
    r.hours ? `${r.hours}h` : '-',
    r.status || '-',
  ])

  autoTable(doc, {
    startY: 36,
    head,
    body,
    theme: 'grid',
    headStyles: { fillColor: [14, 116, 144], fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  })

  const normal = records.filter(r => r.status === '正常').length
  const late = records.filter(r => r.status === '遲到').length
  const y = doc.lastAutoTable.finalY + 10
  doc.setFontSize(9)
  doc.setTextColor(80)
  doc.text(`Total: ${records.length} | Normal: ${normal} | Late: ${late}`, 14, y)

  doc.save(`attendance-report-${filters.date || 'all'}.pdf`)
}

// Export salary records
export function exportSalaryPdf(records, month) {
  const doc = createPdf('Salary Report', `Month: ${month}`)

  const head = [['#', 'Employee', 'Base', 'Allowance', 'OT', 'Bonus', 'Deductions', 'Insurance', 'Net']]
  const body = records.map((r, i) => {
    const deductions = (r.absence_deduction || 0) + (r.late_deduction || 0) + (r.other_deduction || 0)
    return [
      i + 1,
      r.employee || '-',
      (r.base_salary || 0).toLocaleString(),
      (r.allowance || 0).toLocaleString(),
      (r.overtime || 0).toLocaleString(),
      (r.bonus || 0).toLocaleString(),
      deductions > 0 ? `-${deductions.toLocaleString()}` : '0',
      (r.insurance || 0).toLocaleString(),
      (r.net_salary || 0).toLocaleString(),
    ]
  })

  autoTable(doc, {
    startY: 36,
    head,
    body,
    theme: 'grid',
    headStyles: { fillColor: [5, 150, 105], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: { 8: { fontStyle: 'bold' } },
  })

  const totalNet = records.reduce((s, r) => s + (r.net_salary || 0), 0)
  const y = doc.lastAutoTable.finalY + 10
  doc.setFontSize(9)
  doc.setTextColor(80)
  doc.text(`Employees: ${records.length} | Total Net: NT$ ${totalNet.toLocaleString()}`, 14, y)

  doc.save(`salary-report-${month}.pdf`)
}

// Export trial balance
export function exportTrialBalancePdf(trialData, asOfDate, totals = {}) {
  const doc = createPdf('Trial Balance', `As of: ${asOfDate}`)

  const head = [['Account Code', 'Account Name', 'Type', 'Debit Balance', 'Credit Balance']]
  const body = trialData.map(r => [
    r.account_code || '-',
    r.account_name || '-',
    r.type || '-',
    r.debit_balance > 0 ? `NT$ ${r.debit_balance.toLocaleString()}` : '-',
    r.credit_balance > 0 ? `NT$ ${r.credit_balance.toLocaleString()}` : '-',
  ])

  autoTable(doc, {
    startY: 36,
    head,
    body,
    theme: 'grid',
    headStyles: { fillColor: [14, 116, 144], fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 28 },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
    foot: [[
      '', '', 'Total',
      `NT$ ${(totals.totalDebit || 0).toLocaleString()}`,
      `NT$ ${(totals.totalCredit || 0).toLocaleString()}`,
    ]],
    footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 9 },
  })

  const y = doc.lastAutoTable.finalY + 10
  doc.setFontSize(10)
  const balanced = totals.isBalanced
  doc.setTextColor(balanced ? 34 : 239, balanced ? 197 : 68, balanced ? 94 : 68)
  doc.text(balanced ? 'Balanced' : `NOT Balanced — Difference: NT$ ${Math.abs((totals.totalDebit || 0) - (totals.totalCredit || 0)).toLocaleString()}`, 14, y)

  doc.save(`trial-balance-${asOfDate}.pdf`)
}

// Export 401 tax report
export function exportTaxReportPdf(reportData) {
  const { period, startDate, endDate, sales, purchases, summary } = reportData
  const doc = createPdf(
    '401 Tax Report',
    `Period: ${period} (${startDate} ~ ${endDate}) | Generated: ${new Date().toLocaleString('zh-TW')}`
  )

  const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

  // Section 1 - Sales / Output
  autoTable(doc, {
    startY: 36,
    head: [['Item', 'Invoice Count', 'Sales Amount (Pre-tax)', 'Tax']],
    body: [
      ['Taxable (5%)', sales.taxable.count, fmt(sales.taxable.amount), fmt(sales.taxable.tax)],
      ['Zero-rated', sales.zeroRated.count, fmt(sales.zeroRated.amount), '0'],
      ['Exempt', sales.exempt.count, fmt(sales.exempt.amount), '0'],
    ],
    foot: [['Total', sales.total.count, fmt(sales.total.amount), fmt(sales.total.tax)]],
    theme: 'grid',
    headStyles: { fillColor: [14, 116, 144], fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 9 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  })

  // Section 2 - Purchases / Input
  const y2 = doc.lastAutoTable.finalY + 12
  doc.setFontSize(11)
  doc.setTextColor(14, 116, 144)
  doc.text('Purchases (Input)', 14, y2)

  autoTable(doc, {
    startY: y2 + 4,
    head: [['Item', 'Count', 'Purchase Amount (Pre-tax)', 'Tax']],
    body: [
      ['Taxable Input', purchases.taxable.count, fmt(purchases.taxable.amount), fmt(purchases.taxable.tax)],
    ],
    foot: [['Total', purchases.total.count, fmt(purchases.total.amount), fmt(purchases.total.tax)]],
    theme: 'grid',
    headStyles: { fillColor: [5, 150, 105], fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 9 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  })

  // Section 3 - Tax Summary
  const y3 = doc.lastAutoTable.finalY + 12
  doc.setFontSize(11)
  doc.setTextColor(14, 116, 144)
  doc.text('Tax Summary', 14, y3)

  autoTable(doc, {
    startY: y3 + 4,
    head: [['Item', 'Amount']],
    body: [
      ['Output Tax', fmt(summary.outputTax)],
      ['Input Tax', fmt(summary.inputTax)],
      [summary.isRefund ? 'Tax Refund (Credit)' : 'Tax Payable', fmt(Math.abs(summary.taxPayable))],
    ],
    theme: 'grid',
    headStyles: { fillColor: [100, 116, 139], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' } },
  })

  doc.save(`401-tax-report-${startDate}-${endDate}.pdf`)
}

// Export expense request as PDF — 台灣公司「簽呈」格式（HTML + 瀏覽器列印，中文完美顯示）
//
// opts:
//   companyName  公司名稱（標題用，例：威耀時代股份有限公司）
//   logoUrl      公司 LOGO URL（標題左側；可不傳）
export function exportExpenseRequestPdf(req, opts = {}) {
  if (!req) return
  const companyName = opts.companyName || ''
  const logoUrl = opts.logoUrl || ''

  const fmt = (n) => n != null ? `NT$ ${Number(n).toLocaleString()}` : '-'
  const dateStr = req.created_at
    ? new Date(req.created_at).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/')
    : ''

  const rawItems = req.items
  const items = Array.isArray(rawItems) ? rawItems : (typeof rawItems === 'string' ? (() => { try { return JSON.parse(rawItems) } catch { return [] } })() : [])

  const itemsRows = items.length > 0 ? items.map((li, i) => `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${escapeHtml(li.name || '-')}</td>
      <td style="text-align:right">${escapeHtml(String(li.qty ?? 0))}</td>
      <td style="text-align:right;font-family:monospace">${fmt(li.unit_price)}</td>
      <td style="text-align:right;font-family:monospace;font-weight:600">${fmt(li.subtotal)}</td>
    </tr>
  `).join('') : ''

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>簽呈 #${req.id}</title>
<style>
  @page { size: A4 portrait; margin: 18mm 18mm 22mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", "Heiti TC", sans-serif;
    margin: 0; padding: 0; color: #111; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    font-size: 13px; line-height: 1.55;
  }
  .toolbar { position: fixed; top: 12px; right: 12px; z-index: 999; }
  .toolbar button {
    padding: 10px 20px; background: #0e7490; color: #fff; border: none;
    border-radius: 8px; font-size: 14px; cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-family: inherit; font-weight: 600;
  }
  .toolbar button:hover { background: #155e75; }
  .page { padding: 16px 24px; max-width: 760px; margin: 0 auto; }
  .header-row { display: flex; align-items: center; gap: 16px; margin-bottom: 18px; }
  .logo { width: 60px; height: 60px; object-fit: contain; flex-shrink: 0; }
  .title-area { flex: 1; text-align: center; }
  .company-name { font-size: 22px; font-weight: 700; letter-spacing: 4px; margin: 0; }
  .doc-no { font-size: 11px; color: #888; margin-top: 4px; }
  table.meta {
    width: 100%; border-collapse: collapse; margin-bottom: 18px;
    border: 1.5px solid #333;
  }
  table.meta td {
    border: 1px solid #333; padding: 8px 12px; font-size: 13px;
  }
  table.meta td.label {
    width: 16%; background: #f5f5f5; font-weight: 700; text-align: center;
  }
  table.meta td.value { width: 34%; }
  .section { margin: 14px 0; }
  .section-title {
    font-weight: 700; font-size: 14px; margin-bottom: 6px;
  }
  .section-body {
    padding-left: 28px; min-height: 22px; white-space: pre-wrap;
  }
  table.items {
    width: calc(100% - 28px); margin-left: 28px; border-collapse: collapse;
    margin-top: 6px; font-size: 12px;
  }
  table.items th, table.items td { border: 1px solid #999; padding: 5px 8px; }
  table.items th { background: #eef4f7; font-weight: 600; text-align: center; }
  table.items tfoot td { font-weight: 700; background: #fafafa; }
  table.amount {
    width: calc(100% - 28px); margin-left: 28px; border-collapse: collapse;
    margin-top: 6px; font-size: 13px;
  }
  table.amount td { border: 1px solid #999; padding: 6px 12px; }
  table.amount td.label { background: #f5f5f5; font-weight: 600; width: 40%; }
  table.amount td.value { text-align: right; font-family: monospace; }
  .closing { text-align: left; margin-top: 24px; font-weight: 600; }
  .signatures {
    margin-top: 40px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
  }
  .sig-cell { text-align: center; }
  .sig-line {
    border-top: 1px solid #333; margin-top: 36px; padding-top: 6px;
    font-size: 12px; color: #555;
  }
  .footer-meta {
    margin-top: 28px; font-size: 10px; color: #aaa; text-align: center;
    border-top: 1px dashed #ddd; padding-top: 8px;
  }
  @media print { .toolbar { display: none; } .page { padding: 0; } }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨️ 列印 / 另存為 PDF</button></div>
  <div class="page">
    <div class="header-row">
      ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="logo" onerror="this.style.display='none'" />` : '<div class="logo"></div>'}
      <div class="title-area">
        <div class="company-name">${escapeHtml(companyName || '　　　　')} 簽呈</div>
        <div class="doc-no">文件編號 #${req.id}　|　狀態：${escapeHtml(req.status || '-')}</div>
      </div>
      <div style="width:60px"></div>
    </div>

    <table class="meta">
      <tr>
        <td class="label">呈文單位</td><td class="value">${escapeHtml(req.department || '-')}</td>
        <td class="label">呈文者</td><td class="value">${escapeHtml(req.employee || '-')}</td>
      </tr>
      <tr>
        <td class="label">呈文日期</td><td class="value">${escapeHtml(dateStr || '-')}</td>
        <td class="label">副本</td><td class="value">${escapeHtml(req.store || '')}</td>
      </tr>
    </table>

    <div class="section">
      <div class="section-title">一、主旨</div>
      <div class="section-body">${escapeHtml(req.title || '-')}</div>
    </div>

    <div class="section">
      <div class="section-title">二、說明</div>
      <div class="section-body">${escapeHtml(req.description || '-')}${req.supplier ? `\n供應商：${escapeHtml(req.supplier)}` : ''}${req.account_code ? `\n會計科目：${escapeHtml(req.account_code)}　${escapeHtml(req.account_name || '')}` : ''}</div>
    </div>

    ${items.length > 0 ? `
    <div class="section">
      <div class="section-title">三、品項明細</div>
      <table class="items">
        <thead>
          <tr><th style="width:8%">#</th><th>品名</th><th style="width:12%">數量</th><th style="width:18%">單價</th><th style="width:20%">小計</th></tr>
        </thead>
        <tbody>${itemsRows}</tbody>
        <tfoot>
          <tr><td colspan="4" style="text-align:right">合計</td><td style="text-align:right;font-family:monospace">${fmt(req.estimated_amount)}</td></tr>
        </tfoot>
      </table>
    </div>
    ` : ''}

    <div class="section">
      <div class="section-title">${items.length > 0 ? '四' : '三'}、金額</div>
      <table class="amount">
        <tr><td class="label">預估金額</td><td class="value">${fmt(req.estimated_amount)}</td></tr>
        ${req.actual_amount != null ? `<tr><td class="label">實際金額</td><td class="value">${fmt(req.actual_amount)}</td></tr>` : ''}
        ${req.difference != null && req.difference !== 0 ? `<tr><td class="label">差異</td><td class="value" style="color:${req.difference > 0 ? '#b91c1c' : '#15803d'}">${req.difference > 0 ? '+' : ''}${fmt(req.difference)}</td></tr>` : ''}
      </table>
    </div>

    ${req.notes ? `
    <div class="section">
      <div class="section-title">${items.length > 0 ? '五' : '四'}、核銷備註</div>
      <div class="section-body">${escapeHtml(req.notes)}</div>
    </div>
    ` : ''}

    ${req.reject_reason ? `
    <div class="section" style="color:#b91c1c">
      <div class="section-title">駁回原因</div>
      <div class="section-body">${escapeHtml(req.reject_reason)}</div>
    </div>
    ` : ''}

    <div class="closing">以上，呈請核示。</div>

    <div class="signatures">
      <div class="sig-cell"><div class="sig-line">呈文者</div></div>
      <div class="sig-cell"><div class="sig-line">主管核示</div></div>
      <div class="sig-cell"><div class="sig-line">財務核章</div></div>
    </div>

    <div class="footer-meta">
      列印時間：${escapeHtml(new Date().toLocaleString('zh-TW'))}　|　由 SME Ops System 產生
    </div>
  </div>
  <script>
    window.addEventListener('load', () => setTimeout(() => window.print(), 300))
  </script>
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) {
    alert('請允許彈出視窗，才能匯出 PDF')
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
}

// ══════════════════════════════════════
//  排班月曆 PDF — 用瀏覽器列印（中文字完美顯示，無需內嵌字型）
// ══════════════════════════════════════

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const fmtDateLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * 匯出排班月曆 PDF（傳統月曆排版，7欄 × 5-6列）
 * 用新分頁 + 瀏覽器列印對話框，使用者選「另存 PDF」即可
 *
 * @param {Object} opts
 * @param {string} opts.storeName     門市名稱（顯示在標題）
 * @param {string} opts.yearMonth     '2026-04'
 * @param {string[]} opts.monthDates  ['2026-04-01', ...]
 * @param {Array} opts.schedules      [{employee, date, shift, actual_start, actual_end}]
 * @param {Set<string>} [opts.holidaySet]  國定假日日期集合
 */
export function exportScheduleCalendarPdf({ storeName, yearMonth, monthDates, schedules, holidaySet }) {
  if (!monthDates || monthDates.length === 0) {
    alert('沒有可匯出的排班資料')
    return
  }

  const monthStart = new Date(monthDates[0])
  const monthEnd = new Date(monthDates[monthDates.length - 1])

  // 月曆從週日開始，往前補到該週週日，往後補到最後一週週六
  const firstCell = new Date(monthStart)
  firstCell.setDate(firstCell.getDate() - firstCell.getDay())
  const lastCell = new Date(monthEnd)
  lastCell.setDate(lastCell.getDate() + (6 - lastCell.getDay()))

  // 切成週
  const weeks = []
  let cur = new Date(firstCell)
  while (cur <= lastCell) {
    const week = []
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cur))
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }

  // 依日期分組排班
  const isAbsenceShift = (s) => !s || s === '休' || s === '病' || s === '事' || s === '特休' || s === '事假'
  const byDate = {}
  for (const s of schedules || []) {
    if (!byDate[s.date]) byDate[s.date] = []
    byDate[s.date].push(s)
  }

  // 排序：每日的班次依開始時間排
  for (const date of Object.keys(byDate)) {
    byDate[date].sort((a, b) => (a.actual_start || '').localeCompare(b.actual_start || ''))
  }

  const buildCell = (day) => {
    const dateStr = fmtDateLocal(day)
    const isOtherMonth = day < monthStart || day > monthEnd
    const isHol = holidaySet?.has?.(dateStr)
    const dow = day.getDay()
    const isWeekend = dow === 0 || dow === 6

    const dayEntries = (byDate[dateStr] || []).filter(e => !isAbsenceShift(e.shift))

    const classes = []
    if (isOtherMonth) classes.push('other-month')
    if (isHol) classes.push('holiday')
    else if (isWeekend) classes.push('weekend')

    const dateNum = day.getDate()
    const numColor = isHol || dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''

    return `
      <td class="${classes.join(' ')}">
        <div class="date-num ${numColor}">
          <span>${dateNum}</span>
          ${isHol ? '<span class="tag">假</span>' : ''}
        </div>
        ${isOtherMonth ? '' : dayEntries.map(e => `
          <div class="entry"><span class="name">${escapeHtml(e.employee)}</span><span class="shift">${escapeHtml(e.shift)}</span></div>
        `).join('')}
        ${!isOtherMonth && dayEntries.length > 0 ? `<div class="summary">共 ${dayEntries.length} 人</div>` : ''}
      </td>
    `
  }

  const totalWorkingPersonDays = Object.values(byDate)
    .reduce((sum, arr) => sum + arr.filter(e => !isAbsenceShift(e.shift)).length, 0)

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>排班月曆 ${escapeHtml(yearMonth)}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", "Heiti TC", sans-serif;
    margin: 0; padding: 12px; color: #111; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; padding: 0 4px; }
  .header h1 { margin: 0; font-size: 18px; color: #0e7490; }
  .header .meta { color: #666; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th {
    background: #0e7490; color: #fff; padding: 6px 4px;
    font-size: 11px; text-align: center; border: 1px solid #0e7490;
    font-weight: 600;
  }
  thead th.sun { background: #b91c1c; border-color: #b91c1c; }
  thead th.sat { background: #1d4ed8; border-color: #1d4ed8; }
  tbody td {
    border: 1px solid #d4d4d4; padding: 4px 5px;
    vertical-align: top; height: 32mm;
    font-size: 9px; line-height: 1.35;
    overflow: hidden; word-break: break-all;
  }
  tbody td.other-month { background: #fafafa; color: #ccc; }
  tbody td.weekend { background: #f8fafc; }
  tbody td.holiday { background: #fef2f2; }
  .date-num {
    font-weight: 700; font-size: 13px; margin-bottom: 4px;
    display: flex; justify-content: space-between; align-items: baseline;
    border-bottom: 1px dotted #e5e5e5; padding-bottom: 2px;
  }
  .date-num.sun { color: #b91c1c; }
  .date-num.sat { color: #1d4ed8; }
  .date-num .tag { font-size: 8px; color: #b91c1c; font-weight: 600; padding: 1px 4px; background: #fee2e2; border-radius: 3px; }
  .entry { display: flex; justify-content: space-between; gap: 4px; padding: 1px 0; }
  .entry .name { color: #111; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry .shift { color: #0e7490; font-family: ui-monospace, "SF Mono", Consolas, monospace; flex-shrink: 0; font-weight: 600; }
  .summary { font-size: 8px; color: #888; margin-top: 3px; text-align: right; font-style: italic; }
  .footer { margin-top: 8px; display: flex; justify-content: space-between; color: #999; font-size: 10px; padding: 0 4px; }
  .toolbar { position: fixed; top: 12px; right: 12px; z-index: 999; }
  .toolbar button {
    padding: 10px 20px; background: #0e7490; color: #fff; border: none;
    border-radius: 8px; font-size: 14px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-family: inherit; font-weight: 600;
  }
  .toolbar button:hover { background: #155e75; }
  @media print { .toolbar { display: none; } body { padding: 0; } }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨️ 列印 / 另存為 PDF</button></div>
  <div class="header">
    <h1>${escapeHtml(storeName || '全部門市')} 排班月曆 — ${escapeHtml(yearMonth)}</h1>
    <div class="meta">列印時間：${escapeHtml(new Date().toLocaleString('zh-TW'))}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th class="sun">週日</th><th>週一</th><th>週二</th><th>週三</th><th>週四</th><th>週五</th><th class="sat">週六</th>
      </tr>
    </thead>
    <tbody>
      ${weeks.map(week => `<tr>${week.map(buildCell).join('')}</tr>`).join('')}
    </tbody>
  </table>
  <div class="footer">
    <span>本月總出勤人次：${totalWorkingPersonDays}</span>
    <span>由 SME Ops System 產生</span>
  </div>
  <script>
    // 開啟後自動跳列印對話框
    window.addEventListener('load', () => setTimeout(() => window.print(), 300))
  </script>
</body>
</html>`

  // 開新分頁顯示月曆，順便自動跳列印對話框
  const win = window.open('', '_blank')
  if (!win) {
    alert('請允許彈出視窗，才能匯出 PDF')
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
}
