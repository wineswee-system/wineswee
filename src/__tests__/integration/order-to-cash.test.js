/**
 * Integration Test: Order-to-Cash Flow
 * Quote → SO → Ship → Invoice (E-Invoice) → AR → JE → Payment
 *
 * Tests cross-module logic: einvoice + accounting
 */
import { describe, it, expect } from 'vitest'
import { calculateInvoiceTax, validateTaxId, generateInvoiceNumber, generateEInvoiceXML } from '../../lib/einvoice.js'
import { validateJournalEntry, generateTrialBalance, generateProfitLoss } from '../../lib/accounting.js'

describe('Order-to-Cash Integration', () => {
  const orderItems = [
    { description: '產品 A', qty: 10, unitPrice: 1000 },
    { description: '產品 B', qty: 5, unitPrice: 2000 },
  ]

  it('INT-06: quotation line items calculate correctly', () => {
    const taxResult = calculateInvoiceTax(orderItems, '應稅')
    expect(taxResult.subtotal).toBe(20000) // 10*1000 + 5*2000
    expect(taxResult.taxAmount).toBe(1000) // 5% VAT
    expect(taxResult.total).toBe(21000)
    expect(taxResult.items_with_tax).toHaveLength(2)
  })

  it('INT-07: SO → shipment → AR creates balanced JE (Dr AR, Cr Revenue)', () => {
    const shipmentTotal = 20000
    const jeLines = [
      { account_code: '1130', account_name: '應收帳款', debit: shipmentTotal, credit: 0 },
      { account_code: '4100', account_name: '營業收入', debit: 0, credit: shipmentTotal },
    ]
    const validation = validateJournalEntry(jeLines)
    expect(validation.valid).toBe(true)
  })

  it('INT-08: invoice generates valid e-invoice XML', () => {
    const invoiceNumber = generateInvoiceNumber('AB', 1)
    expect(invoiceNumber).toBe('AB00000001')

    const taxIdValid = validateTaxId('04595257')
    expect(taxIdValid.valid).toBe(true)

    const xml = generateEInvoiceXML({
      invoiceNumber,
      date: '2026-04-05',
      seller: { taxId: '04595257', name: 'SME Corp' },
      buyer: { taxId: '12345670', name: 'Customer Co' },
      items: orderItems,
      taxType: '應稅',
    })

    expect(xml).toContain('<InvoiceNumber>AB00000001</InvoiceNumber>')
    expect(xml).toContain('<SalesAmount>20000</SalesAmount>')
    expect(xml).toContain('<TaxAmount>1000</TaxAmount>')
    expect(xml).toContain('<TotalAmount>21000</TotalAmount>')
  })

  it('INT-09: payment clears AR and posts JE', () => {
    const paymentAmount = 21000
    const jeLines = [
      { account_code: '1102', account_name: '銀行存款', debit: paymentAmount, credit: 0 },
      { account_code: '1130', account_name: '應收帳款', debit: 0, credit: paymentAmount },
    ]
    const validation = validateJournalEntry(jeLines)
    expect(validation.valid).toBe(true)
  })

  it('INT-10: full cycle reflects in P&L', () => {
    const accounts = [
      { code: '1100', name: '現金', type: '資產' },
      { code: '1130', name: '應收帳款', type: '資產' },
      { code: '4100', name: '營業收入', type: '收入' },
      { code: '5100', name: '銷貨成本', type: '銷貨成本' },
    ]
    // Simulate: sold 20K revenue, 8K COGS
    const journalLines = [
      { account_code: '1130', debit: 20000, credit: 0 },
      { account_code: '4100', debit: 0, credit: 20000 },
      { account_code: '5100', debit: 8000, credit: 0 },
      { account_code: '1100', debit: 0, credit: 8000 },
    ]
    const tb = generateTrialBalance(accounts, journalLines)
    const pl = generateProfitLoss(tb, '2026-04')

    expect(pl.grossProfit).toBe(12000) // 20000 - 8000
    expect(pl.netIncome).toBe(12000)
  })
})
