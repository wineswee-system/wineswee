/**
 * Integration Test: Procure-to-Pay Flow
 * PR → PO → GR → 3-Way Match → AP → JE
 *
 * Tests cross-module logic: threeWayMatch + accounting + einvoice
 */
import { describe, it, expect } from 'vitest'
import { performThreeWayMatch, calculatePriceVariance } from '../../lib/threeWayMatch.js'
import { validateJournalEntry } from '../../lib/accounting.js'
import { calculateInvoiceTax } from '../../lib/einvoice.js'

describe('Procure-to-Pay Integration', () => {
  // Simulated flow data
  const purchaseOrder = {
    poNumber: 'PO-2026-001',
    items: [
      { itemCode: 'WDG-A', description: 'Widget A', qty: 100, unitPrice: 150 },
      { itemCode: 'WDG-B', description: 'Widget B', qty: 50, unitPrice: 300 },
    ],
    total: 30000, // 100*150 + 50*300
  }

  const goodsReceipt = {
    grNumber: 'GR-2026-001',
    items: [
      { itemCode: 'WDG-A', receivedQty: 100 },
      { itemCode: 'WDG-B', receivedQty: 50 },
    ],
    receivedDate: '2026-04-05',
  }

  const supplierInvoice = {
    invoiceNumber: 'VINV-2026-001',
    items: [
      { itemCode: 'WDG-A', qty: 100, unitPrice: 150 },
      { itemCode: 'WDG-B', qty: 50, unitPrice: 300 },
    ],
    total: 30000,
  }

  it('INT-01: PO → GR → Invoice 3-way match passes', () => {
    const match = performThreeWayMatch(purchaseOrder, goodsReceipt, supplierInvoice)
    expect(match.matched).toBe(true)
    expect(match.autoApprove).toBe(true)
    expect(match.discrepancies).toHaveLength(0)
  })

  it('INT-02: price variance flagged when invoice exceeds tolerance', () => {
    const expensiveInvoice = {
      ...supplierInvoice,
      items: [
        { itemCode: 'WDG-A', qty: 100, unitPrice: 170 }, // 13% higher
        { itemCode: 'WDG-B', qty: 50, unitPrice: 300 },
      ],
      total: 32000,
    }
    const match = performThreeWayMatch(purchaseOrder, goodsReceipt, expensiveInvoice)
    expect(match.matched).toBe(false)
    expect(match.discrepancies.some(d => d.field.startsWith('price_'))).toBe(true)
  })

  it('INT-03: AP entry creates balanced journal entry (Dr Expense, Cr AP)', () => {
    const apAmount = 30000
    const taxResult = calculateInvoiceTax(
      purchaseOrder.items.map(i => ({ description: i.description, qty: i.qty, unitPrice: i.unitPrice })),
      '應稅'
    )
    const totalWithTax = taxResult.total // 30000 + 1500 = 31500

    // Create the JE that would be auto-generated
    const jeLines = [
      { account_code: '5100', account_name: '營業成本', debit: apAmount, credit: 0 },
      { account_code: '1150', account_name: '進項稅額', debit: taxResult.taxAmount, credit: 0 },
      { account_code: '2100', account_name: '應付帳款', debit: 0, credit: totalWithTax },
    ]

    const validation = validateJournalEntry(jeLines)
    expect(validation.valid).toBe(true)
    expect(validation.totalDebit).toBe(totalWithTax)
    expect(validation.totalCredit).toBe(totalWithTax)
  })

  it('INT-04: payment clears AP with balanced JE (Dr AP, Cr Cash)', () => {
    const paymentAmount = 31500 // total with tax
    const jeLines = [
      { account_code: '2100', account_name: '應付帳款', debit: paymentAmount, credit: 0 },
      { account_code: '1102', account_name: '銀行存款', debit: 0, credit: paymentAmount },
    ]
    const validation = validateJournalEntry(jeLines)
    expect(validation.valid).toBe(true)
  })

  it('INT-05: quantity mismatch detected at GR', () => {
    const shortGR = {
      ...goodsReceipt,
      items: [
        { itemCode: 'WDG-A', receivedQty: 90 }, // 10% short
        { itemCode: 'WDG-B', receivedQty: 50 },
      ],
    }
    const match = performThreeWayMatch(purchaseOrder, shortGR, supplierInvoice)
    expect(match.matched).toBe(false)
    expect(match.discrepancies.some(d => d.field.startsWith('qty_'))).toBe(true)
  })
})
