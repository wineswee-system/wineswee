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

// Export expense request as PDF (費用申請單)
export function exportExpenseRequestPdf(req) {
  if (!req) return
  const fmt = (n) => n != null ? `NT$ ${Number(n).toLocaleString()}` : '-'
  const doc = createPdf('Expense Request', `#${req.id} | ${req.created_at?.slice(0, 10) || ''}`)

  let y = 38

  // Meta info
  autoTable(doc, {
    startY: y,
    body: [
      ['Applicant', req.employee || '-', 'Department', req.department || '-'],
      ['Account', `${req.account_code || ''} ${req.account_name || ''}`, 'Store', req.store || '-'],
      ['Supplier', req.supplier || '-', 'Status', req.status || '-'],
      ['Title', { content: req.title || '-', colSpan: 3 }],
    ],
    theme: 'grid',
    bodyStyles: { fontSize: 9 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30 }, 2: { fontStyle: 'bold', cellWidth: 30 } },
  })

  // Line items
  const items = req.items || []
  if (items.length > 0) {
    const y2 = doc.lastAutoTable.finalY + 8
    doc.setFontSize(11)
    doc.setTextColor(14, 116, 144)
    doc.text('Items', 14, y2)

    autoTable(doc, {
      startY: y2 + 4,
      head: [['#', 'Item Name', 'Qty', 'Unit Price', 'Subtotal']],
      body: items.map((li, i) => [
        i + 1,
        li.name || '-',
        li.qty || 0,
        fmt(li.unit_price),
        fmt(li.subtotal),
      ]),
      foot: [['', 'Total', '', '', fmt(req.estimated_amount)]],
      theme: 'grid',
      headStyles: { fillColor: [14, 116, 144], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 10 },
      columnStyles: { 0: { cellWidth: 12 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    })
  }

  // Amount summary
  const y3 = doc.lastAutoTable.finalY + 8
  doc.setFontSize(11)
  doc.setTextColor(14, 116, 144)
  doc.text('Amount Summary', 14, y3)

  autoTable(doc, {
    startY: y3 + 4,
    body: [
      ['Estimated Amount', fmt(req.estimated_amount)],
      ['Actual Amount', fmt(req.actual_amount)],
      ['Difference', req.difference != null ? fmt(req.difference) : '-'],
    ],
    theme: 'grid',
    bodyStyles: { fontSize: 9 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 }, 1: { halign: 'right' } },
  })

  // Description
  if (req.description) {
    const y4 = doc.lastAutoTable.finalY + 8
    doc.setFontSize(9)
    doc.setTextColor(100)
    doc.text(`Notes: ${req.description}`, 14, y4, { maxWidth: 180 })
  }

  // Signature block
  const ySign = doc.lastAutoTable.finalY + 25
  doc.setDrawColor(150)
  doc.setFontSize(9)
  doc.setTextColor(80)
  const cols = [14, 75, 136]
  const labels = ['Applicant', 'Manager', 'Finance']
  cols.forEach((x, i) => {
    doc.line(x, ySign, x + 50, ySign)
    doc.text(labels[i], x + 15, ySign + 6)
  })

  doc.save(`expense-request-${req.id}.pdf`)
}
