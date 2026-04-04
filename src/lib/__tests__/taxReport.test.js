import { describe, it, expect } from 'vitest'
import {
  generate401Report,
  generate403Report,
  calculateBusinessTax,
  formatTaxPeriod,
  generateMediaFile,
} from '../taxReport.js'

// ═════════════════════════════════════════════════════════════
describe('generate401Report', () => {
  const sales = [
    { invoice_no: 'AB00000001', date: '2026-03-05', buyer_tax_id: '12345670', buyer_name: 'Buyer A', amount: 10000 },
    { invoice_no: 'AB00000002', date: '2026-04-10', buyer_tax_id: '87654321', buyer_name: 'Buyer B', amount: 20000 },
  ]
  const purchases = [
    { invoice_no: 'CD00000001', date: '2026-03-15', seller_tax_id: '11111111', seller_name: 'Vendor A', amount: 8000 },
  ]
  const period = { year: 2026, startMonth: 3, endMonth: 4 }

  it('TR-01: generates correct tax amounts', () => {
    const report = generate401Report(sales, purchases, period)
    expect(report.salesAmount).toBe(30000)
    expect(report.salesTax).toBe(1500) // 30000 * 0.05
    expect(report.purchaseAmount).toBe(8000)
    expect(report.purchaseTax).toBe(400) // 8000 * 0.05
    expect(report.netTax).toBe(1100) // 1500 - 400
    expect(report.taxPayable).toBe(1100)
    expect(report.taxCredit).toBe(0)
  })

  it('handles tax credit (purchases > sales)', () => {
    const report = generate401Report(
      [{ invoice_no: 'A', amount: 1000 }],
      [{ invoice_no: 'B', amount: 10000 }],
      period,
    )
    expect(report.netTax).toBeLessThan(0)
    expect(report.taxPayable).toBe(0)
    expect(report.taxCredit).toBeGreaterThan(0)
  })

  it('includes invoice counts', () => {
    const report = generate401Report(sales, purchases, period)
    expect(report.salesInvoiceCount).toBe(2)
    expect(report.purchaseInvoiceCount).toBe(1)
  })

  it('includes period label', () => {
    const report = generate401Report(sales, purchases, period)
    expect(report.period).toContain('115')
    expect(report.period).toContain('03-04')
  })

  it('handles empty invoices', () => {
    const report = generate401Report([], [], period)
    expect(report.salesAmount).toBe(0)
    expect(report.netTax).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════
describe('generate403Report', () => {
  const records = [
    { payee_id: 'A123456789', payee_name: '王小明', income_type: '50', gross_amount: 600000, tax_withheld: 30000 },
    { payee_id: 'B987654321', payee_name: '李小華', income_type: '50', gross_amount: 480000, tax_withheld: 15000 },
    { payee_id: 'C111222333', payee_name: '張顧問', income_type: '9A', gross_amount: 200000, tax_withheld: 20000 },
  ]
  const period = { year: 2026, startMonth: 1, endMonth: 12 }

  it('TR-02: correct per-employee totals', () => {
    const report = generate403Report(records, period)
    expect(report.records).toHaveLength(3)
    expect(report.summary.total_records).toBe(3)
    expect(report.summary.total_gross).toBe(1280000)
    expect(report.summary.total_withheld).toBe(65000)
  })

  it('groups by income type', () => {
    const report = generate403Report(records, period)
    expect(report.summary_by_type).toHaveLength(2) // 50 and 9A
    const salary = report.summary_by_type.find(s => s.income_type === '50')
    expect(salary.count).toBe(2)
    expect(salary.total_gross).toBe(1080000)
  })

  it('maps income type names', () => {
    const report = generate403Report(records, period)
    const salary = report.records.find(r => r.income_type === '50')
    expect(salary.income_type_name).toBe('薪資所得')
  })
})

// ═════════════════════════════════════════════════════════════
describe('calculateBusinessTax', () => {
  it('TR-03: standard 5% VAT', () => {
    const result = calculateBusinessTax(10000)
    expect(result.taxableAmount).toBe(10000)
    expect(result.taxAmount).toBe(500)
    expect(result.totalWithTax).toBe(10500)
  })

  it('custom rate', () => {
    const result = calculateBusinessTax(10000, 0.10)
    expect(result.taxAmount).toBe(1000)
  })

  it('zero amount', () => {
    const result = calculateBusinessTax(0)
    expect(result.taxAmount).toBe(0)
    expect(result.totalWithTax).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════
describe('formatTaxPeriod', () => {
  it('TR-04: converts to ROC year format', () => {
    expect(formatTaxPeriod(2026, 3, 4)).toBe('115年03-04月')
  })

  it('single month', () => {
    expect(formatTaxPeriod(2026, 1, 1)).toBe('115年01月')
  })

  it('auto-pairs odd month', () => {
    expect(formatTaxPeriod(2026, 3)).toBe('115年03-04月')
  })

  it('returns empty for missing input', () => {
    expect(formatTaxPeriod(null, null)).toBe('')
    expect(formatTaxPeriod(2026, null)).toBe('')
  })
})

// ═════════════════════════════════════════════════════════════
describe('generateMediaFile', () => {
  it('TR-05: 401 format has header, sales, purchases, footer', () => {
    const report = generate401Report(
      [{ invoice_no: 'AB00000001', date: '2026-03-05', buyer_tax_id: '12345670', amount: 10000 }],
      [{ invoice_no: 'CD00000001', date: '2026-03-15', seller_tax_id: '11111111', amount: 5000 }],
      { year: 2026, startMonth: 3, endMonth: 4 },
    )
    const file = generateMediaFile(report, '401')
    const lines = file.split('\n')

    expect(lines[0]).toMatch(/^H\|/) // Header
    expect(lines[1]).toMatch(/^S\|/) // Sales
    expect(lines[2]).toMatch(/^P\|/) // Purchase
    expect(lines[3]).toMatch(/^T\|/) // Footer
  })

  it('403 format has header, details, summary, footer', () => {
    const report = generate403Report(
      [{ payee_id: 'A123', payee_name: '王', income_type: '50', gross_amount: 600000, tax_withheld: 30000 }],
      { year: 2026, startMonth: 1, endMonth: 12 },
    )
    const file = generateMediaFile(report, '403')
    const lines = file.split('\n')

    expect(lines[0]).toMatch(/^H\|/)
    expect(lines[1]).toMatch(/^D\|/)
    expect(lines.some(l => l.startsWith('S|'))).toBe(true)
    expect(lines[lines.length - 1]).toMatch(/^T\|/)
  })
})
