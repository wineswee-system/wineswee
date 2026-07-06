/**
 * MIG 4.1 電子發票測試（PLAN F-B1 · MIG-01 ~ MIG-07）
 * 由 shim（../einvoice.js）匯入 — 同時驗證重構後既有匯入路徑不破。
 */
import { describe, it, expect } from 'vitest'
import {
  MIG_VERSION,
  MESSAGE_TYPES,
  buildF0401Xml,
  buildF0501Xml,
  buildF0701Xml,
  buildD0401Xml,
  buildD0501Xml,
  selectMessageType,
  resolveVoidAction,
  validateTaxId,
  validateMobileBarcode,
  validateCitizenCertCarrier,
  formatCarrierBarcode,
} from '../einvoice.js'
import { buildF0401Xml as buildF0401FromIndex } from '../einvoice/index.js'

const seller = { taxId: '04595257', name: '測試商店' }

const baseInvoice = {
  invoiceNumber: 'AB12345678',
  invoiceDate: '2026-07-04',
  invoiceTime: '12:00:00',
  seller,
  buyer: { taxId: '', name: '消費者' },
  items: [
    { description: '拿鐵', quantity: 2, unitPrice: 120 },
    { description: '可頌', quantity: 1, unitPrice: 65 },
  ],
  taxType: '應稅',
}

/** 從 XML 抓單一節點文字 */
function textOf(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return m ? m[1] : null
}

/** DOMParser 解析（jsdom 環境）並確認 well-formed + root namespace */
function parseRoot(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  expect(doc.querySelector('parsererror')).toBeNull()
  return doc.documentElement
}

// ═════════════════════════════════════════════════════════════
describe('MIG-01: F0401 開立 — 4.1 namespace 與必要節點', () => {
  it('root 為 Invoice、namespace 為 F0401:4.1', () => {
    const xml = buildF0401Xml(baseInvoice)
    const root = parseRoot(xml)
    expect(root.tagName).toBe('Invoice')
    expect(root.namespaceURI).toBe(`urn:GEINV:eInvoiceMessage:F0401:${MIG_VERSION}`)
    expect(xml).toContain('urn:GEINV:eInvoiceMessage:F0401:4.1')
    expect(xml).not.toContain(':3.2')
  })

  it('含 Main / Details / Amount 三段與必要欄位', () => {
    const xml = buildF0401Xml(baseInvoice)
    expect(xml).toContain('<Main>')
    expect(xml).toContain('<Details>')
    expect(xml).toContain('<Amount>')
    expect(textOf(xml, 'InvoiceNumber')).toBe('AB12345678')
    expect(textOf(xml, 'InvoiceDate')).toBe('20260704')
    expect(textOf(xml, 'InvoiceTime')).toBe('12:00:00')
    expect(xml).toContain('<Identifier>04595257</Identifier>') // Seller
    expect(textOf(xml, 'InvoiceType')).toBe('07')
    expect(textOf(xml, 'DonateMark')).toBe('0')
    expect(textOf(xml, 'PrintMark')).toBe('Y') // 無載具 → 列印
    expect(textOf(xml, 'TaxType')).toBe('1')
    expect(textOf(xml, 'TaxRate')).toBe('0.05')
  })

  it('Details 品項含 Description/Quantity/UnitPrice/Amount/SequenceNumber', () => {
    const xml = buildF0401Xml(baseInvoice)
    expect(xml).toContain('<ProductItem>')
    expect(xml).toContain('<Description>拿鐵</Description>')
    expect(xml).toContain('<Quantity>2</Quantity>')
    expect(xml).toContain('<UnitPrice>120</UnitPrice>')
    expect(xml).toContain('<Amount>240</Amount>')
    expect(xml).toContain('<SequenceNumber>1</SequenceNumber>')
    expect(xml).toContain('<SequenceNumber>2</SequenceNumber>')
  })

  it('金額為整數：SalesAmount / TaxAmount / TotalAmount', () => {
    const xml = buildF0401Xml(baseInvoice)
    expect(textOf(xml, 'SalesAmount')).toBe('305') // 240 + 65
    expect(textOf(xml, 'TaxAmount')).toBe('15')    // round(305 * 0.05)
    expect(textOf(xml, 'TotalAmount')).toBe('320')
  })

  it('載具發票：CarrierType / CarrierId1 / CarrierId2、PrintMark=N', () => {
    const xml = buildF0401Xml({
      ...baseInvoice,
      carrierType: '3J0002',
      carrierId1: '/ABC1234',
    })
    expect(textOf(xml, 'CarrierType')).toBe('3J0002')
    expect(textOf(xml, 'CarrierId1')).toBe('/ABC1234')
    expect(textOf(xml, 'CarrierId2')).toBe('/ABC1234')
    expect(textOf(xml, 'PrintMark')).toBe('N')
  })

  it('欄位順序固定（deterministic）— 同輸入產出完全相同', () => {
    expect(buildF0401Xml(baseInvoice)).toBe(buildF0401Xml(baseInvoice))
    // Main 欄位順序：InvoiceNumber → InvoiceDate → InvoiceTime → Seller → Buyer → InvoiceType
    const xml = buildF0401Xml(baseInvoice)
    const order = ['<InvoiceNumber>', '<InvoiceDate>', '<InvoiceTime>', '<Seller>', '<Buyer>', '<InvoiceType>']
      .map(t => xml.indexOf(t))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('shim 與 einvoice/index.js 匯出同一 builder', () => {
    expect(buildF0401FromIndex).toBe(buildF0401Xml)
  })
})

// ═════════════════════════════════════════════════════════════
describe('MIG-02: F0501 作廢 / F0701 註銷欄位', () => {
  const voidParams = {
    invoiceNumber: 'AB12345678',
    invoiceDate: '2026-07-04',
    buyerId: '0000000000',
    sellerId: '04595257',
    cancelDate: '2026-07-04',
    cancelTime: '13:00:00',
    cancelReason: '交易作廢',
  }

  it('F0501: CancelInvoice root + 4.1 namespace + 必要欄位', () => {
    const xml = buildF0501Xml(voidParams)
    const root = parseRoot(xml)
    expect(root.tagName).toBe('CancelInvoice')
    expect(root.namespaceURI).toBe('urn:GEINV:eInvoiceMessage:F0501:4.1')
    expect(textOf(xml, 'CancelInvoiceNumber')).toBe('AB12345678')
    expect(textOf(xml, 'InvoiceDate')).toBe('20260704')
    expect(textOf(xml, 'BuyerId')).toBe('0000000000')
    expect(textOf(xml, 'SellerId')).toBe('04595257')
    expect(textOf(xml, 'CancelDate')).toBe('20260704')
    expect(textOf(xml, 'CancelTime')).toBe('13:00:00')
    expect(textOf(xml, 'CancelReason')).toBe('交易作廢')
  })

  it('F0701: VoidInvoice root + 4.1 namespace + 必要欄位', () => {
    const xml = buildF0701Xml({
      invoiceNumber: 'AB12345678',
      invoiceDate: '2026-07-04',
      buyerId: '0000000000',
      sellerId: '04595257',
      voidDate: '2026-07-05',
      voidTime: '09:30:00',
      voidReason: '買賣雙方合意註銷',
    })
    const root = parseRoot(xml)
    expect(root.tagName).toBe('VoidInvoice')
    expect(root.namespaceURI).toBe('urn:GEINV:eInvoiceMessage:F0701:4.1')
    expect(textOf(xml, 'VoidInvoiceNumber')).toBe('AB12345678')
    expect(textOf(xml, 'VoidDate')).toBe('20260705')
    expect(textOf(xml, 'VoidTime')).toBe('09:30:00')
    expect(textOf(xml, 'VoidReason')).toBe('買賣雙方合意註銷')
  })
})

// ═════════════════════════════════════════════════════════════
describe('MIG-03: D0401 / D0501 折讓含原發票號碼', () => {
  const allowance = {
    allowanceNumber: 'AL00000001',
    allowanceDate: '2026-07-10',
    seller,
    buyer: { taxId: '', name: '消費者' },
    originalInvoiceNumber: 'AB12345678',
    originalInvoiceDate: '2026-07-04',
    taxType: '應稅',
    items: [
      { description: '拿鐵', quantity: 1, unitPrice: 120 },
    ],
  }

  it('D0401: Allowance root + 4.1 namespace + 每行 OriginalInvoiceNumber', () => {
    const xml = buildD0401Xml(allowance)
    const root = parseRoot(xml)
    expect(root.tagName).toBe('Allowance')
    expect(root.namespaceURI).toBe('urn:GEINV:eInvoiceMessage:D0401:4.1')
    expect(textOf(xml, 'AllowanceNumber')).toBe('AL00000001')
    expect(textOf(xml, 'AllowanceDate')).toBe('20260710')
    expect(textOf(xml, 'AllowanceType')).toBe('2') // 預設賣方開立
    expect(xml).toContain('<AllowanceItem>')
    expect(textOf(xml, 'OriginalInvoiceNumber')).toBe('AB12345678')
    expect(textOf(xml, 'OriginalInvoiceDate')).toBe('20260704')
    expect(textOf(xml, 'OriginalDescription')).toBe('拿鐵')
    expect(textOf(xml, 'Tax')).toBe('6')          // round(120 * 0.05)
    expect(textOf(xml, 'TaxAmount')).toBe('6')
    expect(textOf(xml, 'TotalAmount')).toBe('120')
  })

  it('D0401: item 層可覆寫原發票號（多發票合併折讓）', () => {
    const xml = buildD0401Xml({
      ...allowance,
      items: [
        { description: 'A', quantity: 1, unitPrice: 100, originalInvoiceNumber: 'AB11111111' },
        { description: 'B', quantity: 1, unitPrice: 50 },
      ],
    })
    expect(xml).toContain('<OriginalInvoiceNumber>AB11111111</OriginalInvoiceNumber>')
    expect(xml).toContain('<OriginalInvoiceNumber>AB12345678</OriginalInvoiceNumber>')
  })

  it('D0501: CancelAllowance root + 帶原發票號碼', () => {
    const xml = buildD0501Xml({
      allowanceNumber: 'AL00000001',
      allowanceDate: '2026-07-10',
      buyerId: '0000000000',
      sellerId: '04595257',
      cancelDate: '2026-07-11',
      cancelTime: '10:00:00',
      cancelReason: '折讓開立錯誤',
      originalInvoiceNumber: 'AB12345678',
    })
    const root = parseRoot(xml)
    expect(root.tagName).toBe('CancelAllowance')
    expect(root.namespaceURI).toBe('urn:GEINV:eInvoiceMessage:D0501:4.1')
    expect(textOf(xml, 'CancelAllowanceNumber')).toBe('AL00000001')
    expect(textOf(xml, 'CancelReason')).toBe('折讓開立錯誤')
    expect(xml).toContain('AB12345678') // 原發票號碼可追溯
  })
})

// ═════════════════════════════════════════════════════════════
describe('MIG-04: 統一編號新制檢查碼（112.4 起 %5）', () => {
  it('新制專屬號碼（sum=5，舊制 %10 會拒絕）通過', () => {
    // '00000005'：加權和 = 5×1 = 5 → 5 % 5 == 0（舊制 5 % 10 != 0）
    expect(validateTaxId('00000005').valid).toBe(true)
  })

  it('舊制號碼（sum=40，%10==0）仍然通過', () => {
    // '04595257'（台積電）：加權和 = 40
    expect(validateTaxId('04595257').valid).toBe(true)
  })

  it('第 7 碼為 7 的特殊規則：兩種計算任一 %5==0 即合法', () => {
    // '00000074'：sum=14 不整除，但 7×4=28 → 視為 1 時 sum=5 → 合法
    expect(validateTaxId('00000074').valid).toBe(true)
  })

  it('檢查碼錯誤拒絕', () => {
    // '00000001'：加權和 = 1
    const r = validateTaxId('00000001')
    expect(r.valid).toBe(false)
    expect(r.error).toContain('驗證碼')
  })

  it('9 碼拒絕', () => {
    const r = validateTaxId('123456789')
    expect(r.valid).toBe(false)
    expect(r.error).toContain('8 位')
  })

  it('7 碼 / 非數字 / 空值拒絕', () => {
    expect(validateTaxId('1234567').valid).toBe(false)
    expect(validateTaxId('1234567A').valid).toBe(false)
    expect(validateTaxId('').valid).toBe(false)
    expect(validateTaxId(null).valid).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════
describe('MIG-05: 載具格式', () => {
  it('手機條碼：/ 開頭 + 7 碼', () => {
    expect(validateMobileBarcode('/ABC1234')).toBe(true)
    expect(validateMobileBarcode('/AB+.-12')).toBe(true)
    expect(validateMobileBarcode('ABC1234')).toBe(false)   // 缺 /
    expect(validateMobileBarcode('/ABC123')).toBe(false)   // 僅 6 碼
    expect(validateMobileBarcode('/ABC12345')).toBe(false) // 8 碼
    expect(validateMobileBarcode('')).toBe(false)
    expect(validateMobileBarcode(null)).toBe(false)
  })

  it('自然人憑證：2 碼大寫英文 + 14 碼數字', () => {
    expect(validateCitizenCertCarrier('AB12345678901234')).toBe(true)
    expect(validateCitizenCertCarrier('A112345678901234')).toBe(false)
    expect(validateCitizenCertCarrier('AB1234567890123')).toBe(false) // 13 碼數字
    expect(validateCitizenCertCarrier('')).toBe(false)
  })

  it('formatCarrierBarcode：手機條碼自動補 /、不重複補', () => {
    expect(formatCarrierBarcode('phone_barcode', 'ABC1234').display).toBe('/ABC1234')
    expect(formatCarrierBarcode('phone_barcode', '/ABC1234').display).toBe('/ABC1234')
  })
})

// ═════════════════════════════════════════════════════════════
describe('MIG-06: 金額四捨五入一致性（Total = Sales + Free + Zero + Tax）', () => {
  function assertAmountConsistency(xml) {
    const sales = Number(textOf(xml, 'SalesAmount'))
    const free = Number(textOf(xml, 'FreeTaxSalesAmount'))
    const zero = Number(textOf(xml, 'ZeroTaxSalesAmount'))
    const tax = Number(textOf(xml, 'TaxAmount'))
    const total = Number(textOf(xml, 'TotalAmount'))
    expect(Number.isInteger(sales)).toBe(true)
    expect(Number.isInteger(tax)).toBe(true)
    expect(Number.isInteger(total)).toBe(true)
    expect(total).toBe(sales + free + zero + tax)
  }

  it('應稅：畸零單價仍收斂為整數且總額一致', () => {
    const xml = buildF0401Xml({
      ...baseInvoice,
      items: [
        { description: 'A', quantity: 3, unitPrice: 33.33 }, // 99.99 → 100
        { description: 'B', quantity: 1, unitPrice: 17.5 },  // 17.5 → 18（四捨五入）
        { description: 'C', quantity: 7, unitPrice: 9.9 },   // 69.3 → 69
      ],
    })
    assertAmountConsistency(xml)
  })

  it('零稅率：TaxAmount=0、銷售額歸 ZeroTaxSalesAmount', () => {
    const xml = buildF0401Xml({ ...baseInvoice, taxType: '零稅率' })
    expect(textOf(xml, 'TaxType')).toBe('2')
    expect(Number(textOf(xml, 'TaxAmount'))).toBe(0)
    expect(Number(textOf(xml, 'ZeroTaxSalesAmount'))).toBe(305)
    expect(Number(textOf(xml, 'SalesAmount'))).toBe(0)
    assertAmountConsistency(xml)
  })

  it('免稅：銷售額歸 FreeTaxSalesAmount', () => {
    const xml = buildF0401Xml({ ...baseInvoice, taxType: '免稅' })
    expect(textOf(xml, 'TaxType')).toBe('3')
    expect(Number(textOf(xml, 'FreeTaxSalesAmount'))).toBe(305)
    assertAmountConsistency(xml)
  })

  it('D0401 折讓：TotalAmount = 各行 Amount 合計、TaxAmount = 各行 Tax 合計', () => {
    const xml = buildD0401Xml({
      allowanceNumber: 'AL00000002',
      allowanceDate: '2026-07-10',
      seller,
      originalInvoiceNumber: 'AB12345678',
      originalInvoiceDate: '2026-07-04',
      taxType: '應稅',
      items: [
        { description: 'A', quantity: 3, unitPrice: 33.33 },
        { description: 'B', quantity: 1, unitPrice: 17.5 },
      ],
    })
    const total = Number(textOf(xml, 'TotalAmount'))
    const lineSum = [...xml.matchAll(/<AllowanceItem>[\s\S]*?<Amount>(\d+)<\/Amount>/g)]
      .map(m => Number(m[1]))
      .reduce((s, n) => s + n, 0)
    expect(lineSum).toBeGreaterThan(0)
    expect(total).toBe(lineSum)
    const taxSum = [...xml.matchAll(/<Tax>(\d+)<\/Tax>/g)].map(m => Number(m[1])).reduce((s, n) => s + n, 0)
    expect(Number(textOf(xml, 'TaxAmount'))).toBe(taxSum)
  })
})

// ═════════════════════════════════════════════════════════════
describe('MIG-07: 訊息別選擇', () => {
  it('B2C 存證：F0401 / F0501 / F0701', () => {
    expect(selectMessageType({ action: 'issue' })).toBe('F0401')
    expect(selectMessageType({ action: 'cancel' })).toBe('F0501')
    expect(selectMessageType({ action: 'void' })).toBe('F0701')
  })

  it('折讓（B2C/存證共用 D 系列）：D0401 / D0501', () => {
    expect(selectMessageType({ action: 'allowance' })).toBe('D0401')
    expect(selectMessageType({ action: 'cancelAllowance' })).toBe('D0501')
  })

  it('B2B 存證（二階段預留）：C0401 / C0501 / C0701', () => {
    expect(selectMessageType({ action: 'issue', channel: 'b2b-storage' })).toBe('C0401')
    expect(selectMessageType({ action: 'cancel', channel: 'b2b-storage' })).toBe('C0501')
    expect(selectMessageType({ action: 'void', channel: 'b2b-storage' })).toBe('C0701')
  })

  it('B2B 交換（二階段預留）：A0101 / A0201、折讓 B0101 / B0201', () => {
    expect(selectMessageType({ action: 'issue', channel: 'b2b-exchange' })).toBe('A0101')
    expect(selectMessageType({ action: 'cancel', channel: 'b2b-exchange' })).toBe('A0201')
    expect(selectMessageType({ action: 'allowance', channel: 'b2b-exchange' })).toBe('B0101')
    expect(selectMessageType({ action: 'cancelAllowance', channel: 'b2b-exchange' })).toBe('B0201')
  })

  it('不支援的組合擲出錯誤', () => {
    expect(() => selectMessageType({ action: 'void', channel: 'b2b-exchange' })).toThrow()
    expect(() => selectMessageType({ action: 'issue', channel: 'edi' })).toThrow()
  })

  it('resolveVoidAction：同日 → 作廢(cancel)、跨日 → 折讓(allowance)', () => {
    expect(resolveVoidAction('2026-07-04', '2026-07-04')).toBe('cancel')
    expect(resolveVoidAction('2026-07-04', '2026-07-05')).toBe('allowance')
  })

  it('MESSAGE_TYPES 常數與 selector 一致', () => {
    expect(MESSAGE_TYPES.B2C_STORE.issue).toBe('F0401')
    expect(MESSAGE_TYPES.ALLOWANCE.issue).toBe('D0401')
  })
})
