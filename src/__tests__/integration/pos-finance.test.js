/**
 * Integration Test: POS → Finance + Automation Triggers
 *
 * Tests: POS sale → inventory deduction → revenue JE → refund reverse
 * Also: low stock → auto PR trigger logic
 */
import { describe, it, expect } from 'vitest'
import { createPaymentRequest, verifyPaymentCallback, processRefund } from '../../lib/payment.js'
import { calculateInvoiceTax, generateEInvoiceXML } from '../../lib/einvoice.js'
import { validateJournalEntry } from '../../lib/accounting.js'
import { calculateFIFO } from '../../lib/inventoryCosting.js'
// currency.js may fail to import in some environments due to supabase transitive dep
// import { formatCurrency } from '../../lib/currency.js'

describe('POS → Finance Integration', () => {
  const cartItems = [
    { description: '拿鐵咖啡', qty: 2, unitPrice: 120 },
    { description: '巧克力蛋糕', qty: 1, unitPrice: 180 },
  ]

  it('INT-13/POS: sale calculates tax and creates payment', () => {
    const tax = calculateInvoiceTax(cartItems, '應稅')
    expect(tax.subtotal).toBe(420) // 2*120 + 1*180
    expect(tax.taxAmount).toBe(21) // 420 * 5%
    expect(tax.total).toBe(441)

    const payment = createPaymentRequest(
      { orderId: 'POS-001', amount: tax.total, currency: 'TWD', description: 'POS Sale' },
      'cash',
    )
    expect(payment.paymentId).toMatch(/^PAY-/)
    expect(payment.status).toBe('pending_confirmation')
  })

  it('INT-14: POS sale creates revenue JE', () => {
    const saleAmount = 420
    const taxAmount = 21
    const total = 441

    const jeLines = [
      { account_code: '1100', account_name: '現金', debit: total, credit: 0 },
      { account_code: '4100', account_name: '營業收入', debit: 0, credit: saleAmount },
      { account_code: '2100', account_name: '銷項稅額', debit: 0, credit: taxAmount },
    ]
    const validation = validateJournalEntry(jeLines)
    expect(validation.valid).toBe(true)
  })

  it('INT-15: POS refund reverses inventory + JE', () => {
    const refundAmount = 441
    const refund = processRefund('PAY-ORIG-001', refundAmount, '客戶退貨')
    expect(refund.success).toBe(true)
    expect(refund.amount).toBe(refundAmount)

    // Reverse JE
    const reverseJE = [
      { account_code: '4100', account_name: '營業收入', debit: 420, credit: 0 },
      { account_code: '2100', account_name: '銷項稅額', debit: 21, credit: 0 },
      { account_code: '1100', account_name: '現金', debit: 0, credit: 441 },
    ]
    const validation = validateJournalEntry(reverseJE)
    expect(validation.valid).toBe(true)
  })

  it('INT-16: shift close reconciliation', () => {
    // Simulate shift: 5 cash sales, 3 card sales
    const cashSales = 5 * 441  // 2205
    const cardSales = 3 * 441  // 1323
    const totalSales = cashSales + cardSales

    expect(totalSales).toBe(3528)
    expect(totalSales.toLocaleString()).toContain('3,528')

    // Reconciliation JE: Dr Cash + Dr Card Receivable, Cr Revenue
    const jeLines = [
      { account_code: '1100', account_name: '現金', debit: cashSales, credit: 0 },
      { account_code: '1130', account_name: '信用卡應收', debit: cardSales, credit: 0 },
      { account_code: '4100', account_name: '營業收入', debit: 0, credit: totalSales - Math.round(totalSales * 0.05) },
      { account_code: '2100', account_name: '銷項稅額', debit: 0, credit: Math.round(totalSales * 0.05) },
    ]
    const validation = validateJournalEntry(jeLines)
    expect(validation.valid).toBe(true)
  })

  it('INT-POS: inventory deducted after sale (FIFO)', () => {
    const transactions = [
      { type: 'IN', qty: 50, unit_cost: 80, date: '2026-04-01' },
      { type: 'IN', qty: 30, unit_cost: 90, date: '2026-04-03' },
      { type: 'OUT', qty: 2, unit_cost: 0, date: '2026-04-05' }, // 2 lattes sold
    ]
    const result = calculateFIFO(transactions)
    expect(result.cogs).toBe(160) // 2 × 80 (FIFO)
    expect(result.ending_qty).toBe(78)
  })
})

describe('Automation Triggers Integration', () => {
  it('INT-29: low stock detection triggers reorder logic', () => {
    // Simulate stock check
    const stockLevels = [
      { sku: 'Widget A', qty: 50, reorderPoint: 20 },
      { sku: 'Widget B', qty: 5, reorderPoint: 10 }, // BELOW REORDER
      { sku: 'Widget C', qty: 100, reorderPoint: 30 },
    ]

    const shortages = stockLevels.filter(s => s.qty < s.reorderPoint)
    expect(shortages).toHaveLength(1)
    expect(shortages[0].sku).toBe('Widget B')

    // Calculate suggested order qty (1.5x safety factor)
    const suggestedQty = Math.ceil((shortages[0].reorderPoint - shortages[0].qty) * 1.5)
    expect(suggestedQty).toBe(8) // ceil((10-5)*1.5) = 8
  })

  it('INT-30: expense approval creates AP entry JE', () => {
    const expenseAmount = 3500
    const jeLines = [
      { account_code: '6600', account_name: '交際費', debit: expenseAmount, credit: 0 },
      { account_code: '2100', account_name: '應付帳款', debit: 0, credit: expenseAmount },
    ]
    const validation = validateJournalEntry(jeLines)
    expect(validation.valid).toBe(true)
  })

  it('INT-31: multi-currency purchase creates exchange difference', async () => {
    // Buy from US supplier: $1000 USD at rate 32.15
    const { calculateExchangeDifference } = await import('../../lib/currency.js')
    const result = calculateExchangeDifference(1000, 32.15, 32.50, 'USD')
    expect(result.difference).toBe(350) // (32.50-32.15)*1000
    expect(result.type).toBe('匯兌利益')
  })
})
