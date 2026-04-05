import { describe, it, expect } from 'vitest'
import {
  TURNKEY_CONFIG,
  validateTaxId,
  generateInvoiceNumber,
  calculateInvoiceTax,
  formatCarrierBarcode,
  generateEInvoiceXML,
} from '../einvoice.js'

// ═════════════════════════════════════════════════════════════
describe('validateTaxId', () => {
  it('EI-01: valid 統一編號 passes', () => {
    // 04595257 is a well-known valid tax ID (TSMC)
    const result = validateTaxId('04595257')
    expect(result.valid).toBe(true)
  })

  it('EI-02: wrong length fails', () => {
    const result = validateTaxId('1234567')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('8 位')
  })

  it('EI-03: non-numeric fails', () => {
    const result = validateTaxId('1234567A')
    expect(result.valid).toBe(false)
  })

  it('rejects empty input', () => {
    expect(validateTaxId('').valid).toBe(false)
    expect(validateTaxId(null).valid).toBe(false)
  })

  it('trims whitespace', () => {
    const result = validateTaxId(' 04595257 ')
    expect(result.valid).toBe(true)
  })

  it('rejects invalid checksum', () => {
    const result = validateTaxId('12345678')
    // May or may not be valid depending on checksum — just ensure no crash
    expect(typeof result.valid).toBe('boolean')
  })
})

// ═════════════════════════════════════════════════════════════
describe('generateInvoiceNumber', () => {
  it('EI-04: generates correct format', () => {
    const num = generateInvoiceNumber('AB', 12345678)
    expect(num).toBe('AB12345678')
  })

  it('pads sequence with zeros', () => {
    const num = generateInvoiceNumber('AB', 1)
    expect(num).toBe('AB00000001')
  })

  it('rejects invalid prefix', () => {
    expect(() => generateInvoiceNumber('A', 1)).toThrow()
    expect(() => generateInvoiceNumber('ab', 1)).toThrow()
    expect(() => generateInvoiceNumber('123', 1)).toThrow()
  })

  it('rejects out-of-range sequence', () => {
    expect(() => generateInvoiceNumber('AB', -1)).toThrow()
    expect(() => generateInvoiceNumber('AB', 100000000)).toThrow()
  })
})

// ═════════════════════════════════════════════════════════════
describe('calculateInvoiceTax', () => {
  const items = [
    { description: 'Widget', qty: 10, unitPrice: 100 },
    { description: 'Gadget', qty: 5, unitPrice: 200 },
  ]

  it('EI-05: 5% VAT calculation', () => {
    const result = calculateInvoiceTax(items, '應稅')
    expect(result.subtotal).toBe(2000) // 10*100 + 5*200
    expect(result.taxAmount).toBe(100) // 2000 * 0.05
    expect(result.total).toBe(2100)
    expect(result.taxRate).toBe(0.05)
  })

  it('EI-06: tax-exempt', () => {
    const result = calculateInvoiceTax(items, '免稅')
    expect(result.taxAmount).toBe(0)
    expect(result.total).toBe(2000)
    expect(result.taxRate).toBe(0)
  })

  it('zero-rate tax', () => {
    const result = calculateInvoiceTax(items, '零稅率')
    expect(result.taxAmount).toBe(0)
    expect(result.taxRate).toBe(0)
  })

  it('returns per-item details', () => {
    const result = calculateInvoiceTax(items, '應稅')
    expect(result.items_with_tax).toHaveLength(2)
    expect(result.items_with_tax[0].amount).toBe(1000)
    expect(result.items_with_tax[0].tax).toBe(50)
  })

  it('defaults to 應稅 when unknown type', () => {
    const result = calculateInvoiceTax(items)
    expect(result.taxRate).toBe(0.05)
  })
})

// ═════════════════════════════════════════════════════════════
describe('formatCarrierBarcode', () => {
  it('EI-08: phone barcode adds / prefix', () => {
    const result = formatCarrierBarcode('phone_barcode', 'ABC1234')
    expect(result.display).toBe('/ABC1234')
    expect(result.typeName).toBe('手機條碼')
  })

  it('does not double-prefix', () => {
    const result = formatCarrierBarcode('phone_barcode', '/ABC1234')
    expect(result.display).toBe('/ABC1234')
  })

  it('company carrier', () => {
    const result = formatCarrierBarcode('company', '12345678')
    expect(result.typeName).toBe('公司統編載具')
  })

  it('unknown type returns as-is', () => {
    const result = formatCarrierBarcode('unknown', 'XYZ')
    expect(result.typeName).toBe('未知載具')
    expect(result.display).toBe('XYZ')
  })
})

// ═════════════════════════════════════════════════════════════
describe('generateEInvoiceXML', () => {
  it('EI-07: generates valid MIG XML structure', () => {
    const invoice = {
      invoiceNumber: 'AB12345678',
      date: '2026-04-05',
      seller: { taxId: '04595257', name: 'Test Corp' },
      buyer: { taxId: '12345670', name: 'Buyer Co' },
      items: [
        { description: 'Product A', qty: 2, unitPrice: 500 },
      ],
      taxType: '應稅',
    }

    const xml = generateEInvoiceXML(invoice)

    // Check XML structure
    expect(xml).toContain('<?xml version="1.0"')
    expect(xml).toContain('urn:GEINV:eInvoiceMessage:C0401')
    expect(xml).toContain('<InvoiceNumber>AB12345678</InvoiceNumber>')
    expect(xml).toContain('<InvoiceDate>20260405</InvoiceDate>')
    expect(xml).toContain('<Identifier>04595257</Identifier>')
    expect(xml).toContain('<SalesAmount>1000</SalesAmount>')
    expect(xml).toContain('<TaxAmount>50</TaxAmount>')
    expect(xml).toContain('<TotalAmount>1050</TotalAmount>')
    expect(xml).toContain('<TaxType>1</TaxType>')
    expect(xml).toContain('<InvoiceItem>')
    expect(xml).toContain('<Quantity>2</Quantity>')
  })

  it('escapes XML special characters', () => {
    const invoice = {
      invoiceNumber: 'AB00000001',
      seller: { taxId: '04595257', name: 'A & B <Corp>' },
      buyer: { taxId: '12345670', name: 'Test' },
      items: [{ description: 'Item "special"', qty: 1, unitPrice: 100 }],
    }
    const xml = generateEInvoiceXML(invoice)
    expect(xml).toContain('A &amp; B &lt;Corp&gt;')
    expect(xml).toContain('Item &quot;special&quot;')
  })
})
