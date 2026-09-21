import { describe, it, expect } from 'vitest'
import {
  generate401Report,
  generateWithholdingSummary,
  generate403Report, // deprecated alias（應與 generateWithholdingSummary 同一函式）
  calculateBusinessTax,
  formatTaxPeriod,
  generateMediaFile,
  generate401FromVatDocs,
  generateVatMediaFile,
  MEDIA_LAYOUT,
  calculate403Deduction,
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
describe('generateWithholdingSummary（原誤名 generate403Report）', () => {
  const records = [
    { payee_id: 'A123456789', payee_name: '王小明', income_type: '50', gross_amount: 600000, tax_withheld: 30000 },
    { payee_id: 'B987654321', payee_name: '李小華', income_type: '50', gross_amount: 480000, tax_withheld: 15000 },
    { payee_id: 'C111222333', payee_name: '張顧問', income_type: '9A', gross_amount: 200000, tax_withheld: 20000 },
  ]
  const period = { year: 2026, startMonth: 1, endMonth: 12 }

  it('TR-02: correct per-employee totals', () => {
    const report = generateWithholdingSummary(records, period)
    expect(report.records).toHaveLength(3)
    expect(report.summary.total_records).toBe(3)
    expect(report.summary.total_gross).toBe(1280000)
    expect(report.summary.total_withheld).toBe(65000)
  })

  it('groups by income type', () => {
    const report = generateWithholdingSummary(records, period)
    expect(report.summary_by_type).toHaveLength(2) // 50 and 9A
    const salary = report.summary_by_type.find(s => s.income_type === '50')
    expect(salary.count).toBe(2)
    expect(salary.total_gross).toBe(1080000)
  })

  it('maps income type names', () => {
    const report = generateWithholdingSummary(records, period)
    const salary = report.records.find(r => r.income_type === '50')
    expect(salary.income_type_name).toBe('薪資所得')
  })

  it('deprecated alias generate403Report 指向同一實作', () => {
    expect(generate403Report).toBe(generateWithholdingSummary)
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

// ═════════════════════════════════════════════════════════════
//  F-B3 進銷項憑證檔（VAT-01 ~ VAT-07）
// ═════════════════════════════════════════════════════════════
describe('generate401FromVatDocs（F-B3 憑證檔）', () => {
  const PERIOD = 202605 // 115年05-06月

  const outputDocs = [
    { format_code: '35', doc_number: 'AB00000001', doc_date: '2026-05-10', counterparty_ubn: null,       amount: 10000, tax_amount: 500, tax_type: '應稅' },
    { format_code: '31', doc_number: 'AB00000002', doc_date: '2026-06-15', counterparty_ubn: '12345675', amount: 20000, tax_amount: 1000, tax_type: '應稅' },
    { format_code: '33', doc_number: 'AB00000001', doc_date: '2026-06-20', counterparty_ubn: null,       amount: -2000, tax_amount: -100, tax_type: '應稅' }, // 折讓（負額）
    { format_code: '35', doc_number: 'AB00000003', doc_date: '2026-05-25', counterparty_ubn: null,       amount: 5000,  tax_amount: 0,   tax_type: '零稅率' },
    { format_code: '35', doc_number: 'AB00000004', doc_date: '2026-05-28', counterparty_ubn: null,       amount: 3000,  tax_amount: 0,   tax_type: '免稅' },
  ]
  const inputDocs = [
    { format_code: '21', doc_number: 'CD00000001', doc_date: '2026-05-12', counterparty_ubn: '11111111', amount: 8000, tax_amount: 400, tax_type: '應稅', deduction_code: '可扣抵' },
    { format_code: '21', doc_number: 'CD00000002', doc_date: '2026-06-02', counterparty_ubn: '22222222', amount: 4000, tax_amount: 200, tax_type: '應稅', deduction_code: '不可扣抵' },
  ]

  it('VAT-01: 401 從憑證檔彙總（非 AR/AP）— 銷項/進項金額與稅額正確', () => {
    const report = generate401FromVatDocs(outputDocs, inputDocs, PERIOD)

    // 應稅銷項：10000 + 20000 − 2000（折讓沖減）
    expect(report.sales.taxable.amount).toBe(28000)
    expect(report.sales.taxable.tax).toBe(1400) // 500 + 1000 − 100
    expect(report.sales.total.amount).toBe(36000) // + 零稅率 5000 + 免稅 3000
    // 進項總額含不可扣抵（列示）
    expect(report.purchases.total.amount).toBe(12000)
    expect(report.dataSource).toBe('vat_documents')
  })

  it('VAT-02: 進項不可扣抵代號不入扣抵稅額', () => {
    const report = generate401FromVatDocs(outputDocs, inputDocs, PERIOD)
    expect(report.purchases.deductible.tax).toBe(400)
    expect(report.purchases.nonDeductible.tax).toBe(200)
    expect(report.summary.inputTax).toBe(400) // 僅可扣抵 400，不含不可扣抵 200
  })

  it('VAT-03: 零稅率/免稅分欄', () => {
    const report = generate401FromVatDocs(outputDocs, inputDocs, PERIOD)
    expect(report.sales.zeroRated.amount).toBe(5000)
    expect(report.sales.zeroRated.tax).toBe(0)
    expect(report.sales.exempt.amount).toBe(3000)
    expect(report.sales.exempt.tax).toBe(0)
  })

  it('VAT-04: 媒體檔每筆記錄長度 === 81，欄位位置符合 MEDIA_LAYOUT', () => {
    const file = generateVatMediaFile(outputDocs, inputDocs, PERIOD, '55668899')
    const lines = file.split('\n')

    expect(lines).toHaveLength(outputDocs.length + inputDocs.length)
    for (const line of lines) {
      expect(line.length).toBe(MEDIA_LAYOUT.recordLength)
      expect(line.length).toBe(81)
    }

    // 欄位規格自身一致性：起訖相連、總長 81
    let cursor = 1
    for (const f of MEDIA_LAYOUT.fields) {
      expect(f.start).toBe(cursor)
      cursor += f.length
    }
    expect(cursor - 1).toBe(MEDIA_LAYOUT.recordLength)

    // 以 MEDIA_LAYOUT 取欄位驗證第一筆（35 / 11505 / 賣方統編 / 憑證號碼 / 金額 / 課稅別）
    const pick = (line, name) => {
      const f = MEDIA_LAYOUT.fields.find(x => x.name === name)
      return line.slice(f.start - 1, f.start - 1 + f.length)
    }
    const first = lines[0]
    expect(pick(first, 'format_code')).toBe('35')
    expect(pick(first, 'roc_year_month')).toBe('11505')
    expect(pick(first, 'seller_ubn')).toBe('55668899')
    expect(pick(first, 'doc_number')).toBe('AB00000001')
    expect(pick(first, 'amount')).toBe('000000010000')
    expect(pick(first, 'tax_amount')).toBe('0000000500')
    expect(pick(first, 'tax_type_code')).toBe('1')
    expect(pick(first, 'deduction_code')).toBe('0') // 銷項固定 0

    // 折讓（第三筆）：格式 33、金額取絕對值
    const allowanceLine = lines[2]
    expect(pick(allowanceLine, 'format_code')).toBe('33')
    expect(pick(allowanceLine, 'amount')).toBe('000000002000')

    // 進項不可扣抵（最後一筆）：扣抵代號 2
    const lastInput = lines[lines.length - 1]
    expect(pick(lastInput, 'format_code')).toBe('21')
    expect(pick(lastInput, 'deduction_code')).toBe('2')
  })

  it('VAT-05: 民國年期別格式（202605 → 115年05-06月）', () => {
    const report = generate401FromVatDocs(outputDocs, inputDocs, PERIOD)
    expect(report.period).toBe('115年05-06月')
  })

  it('VAT-06: 403 兼營比例扣抵計算（不可扣抵比例）', () => {
    // 免稅 250,000 / 總銷售 1,000,000 → 不可扣抵比例 25%
    const r = calculate403Deduction(250000, 1000000, 10000)
    expect(r.nonDeductibleRatio).toBe(0.25)
    expect(r.nonDeductibleTax).toBe(2500)
    expect(r.deductibleInputTax).toBe(7500)

    // 比例取百分比整數位（捨去）：333,333 / 1,000,000 → 33%
    const r2 = calculate403Deduction(333333, 1000000, 9000)
    expect(r2.nonDeductibleRatio).toBe(0.33)
    expect(r2.nonDeductibleTax).toBe(2970)

    // 無免稅銷售 → 全額可扣抵
    const r3 = calculate403Deduction(0, 1000000, 5000)
    expect(r3.nonDeductibleTax).toBe(0)
    expect(r3.deductibleInputTax).toBe(5000)
  })

  it('VAT-07: 應納 vs 溢付留抵', () => {
    // 銷項稅 1400 > 進項稅 400 → 應納 1000
    const payable = generate401FromVatDocs(outputDocs, inputDocs, PERIOD)
    expect(payable.taxPayable).toBe(1000)
    expect(payable.taxCredit).toBe(0)
    expect(payable.summary.isRefund).toBe(false)

    // 進項稅 > 銷項稅 → 溢付留抵
    const bigInput = [
      { format_code: '21', doc_number: 'CD00000009', doc_date: '2026-05-20', amount: 100000, tax_amount: 5000, tax_type: '應稅', deduction_code: '可扣抵' },
    ]
    const credit = generate401FromVatDocs(outputDocs, bigInput, PERIOD)
    expect(credit.taxPayable).toBe(0)
    expect(credit.taxCredit).toBe(3600) // 5000 − 1400
    expect(credit.summary.isRefund).toBe(true)
  })
})
