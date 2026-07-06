import { describe, it, expect } from 'vitest'
import {
  rocDate7, rocPeriodLabel, periodBarcode5, buildBarcodeContent,
  code39Svg, buildQRPair, formatInvNo,
} from '../proofSlip'

const D = new Date(2026, 6, 5) // 2026-07-05（民國 115 年）

describe('證明聯日期/期別', () => {
  it('rocDate7 民國年月日 7 碼', () => {
    expect(rocDate7(D)).toBe('1150705')
  })

  it('rocPeriodLabel 雙月期別（奇數起始月）', () => {
    expect(rocPeriodLabel(D)).toBe('115年07-08月')
    expect(rocPeriodLabel(new Date(2026, 7, 1))).toBe('115年07-08月')  // 8 月同期
    expect(rocPeriodLabel(new Date(2026, 0, 1))).toBe('115年01-02月')
  })

  it('periodBarcode5 取期別偶數月', () => {
    expect(periodBarcode5(D)).toBe('11508')
    expect(periodBarcode5(new Date(2026, 7, 1))).toBe('11508')
  })

  it('buildBarcodeContent = 期別5 + 號碼10 + 隨機碼4（共 19 碼）', () => {
    const c = buildBarcodeContent(D, 'AB12345678', '0482')
    expect(c).toBe('11508AB123456780482')
    expect(c).toHaveLength(19)
  })
})

describe('Code 39 SVG', () => {
  it('輸出含起止符的 svg', () => {
    const svg = code39Svg('11508AB123456780482')
    expect(svg).toContain('<svg')
    expect(svg).toContain('<rect')
    // 21 字元（含 * 起止）× 12 模組 + 20 個字間隔 = 272 模組 × unit 2
    expect(svg).toContain('width="544"')
  })
})

describe('QR 內容', () => {
  const base = {
    invoiceNumber: 'AB12345678',
    date: D,
    randomCode: '0482',
    salesAmount: 629,
    totalAmount: 660,
    sellerTaxId: '12345678',
    items: [
      { name: '紅茶', quantity: 2, unitPrice: 30 },
      { name: '滷肉飯', quantity: 1, unitPrice: 60 },
      { name: '燙青菜', quantity: 1, unitPrice: 40 },
    ],
  }

  it('左 QR 固定 77 碼頭 + 冒號欄位', () => {
    const { left } = buildQRPair(base)
    const head = left.split(':')[0]
    // 10 + 7 + 4 + 8 + 8 + 8 + 8 + 24 = 77
    expect(head).toHaveLength(77)
    expect(head.startsWith('AB123456781150705' + '0482')).toBe(true)
    expect(head).toContain((629).toString(16).toUpperCase().padStart(8, '0'))
    expect(head).toContain((660).toString(16).toUpperCase().padStart(8, '0'))
    expect(head).toContain('00000000') // B2C 無買方統編
    // 品目筆數:總筆數:編碼
    expect(left).toContain(':3:3:1')
    // 左 QR 預設帶前 2 項
    expect(left).toContain(':紅茶:2:30')
    expect(left).toContain(':滷肉飯:1:60')
    expect(left).not.toContain('燙青菜')
  })

  it('右 QR 以 ** 開頭接續其餘品項', () => {
    const { right } = buildQRPair(base)
    expect(right.startsWith('**')).toBe(true)
    expect(right).toContain(':燙青菜:1:40')
  })

  it('B2B 帶買方統編', () => {
    const { left } = buildQRPair({ ...base, buyerTaxId: '87654321' })
    expect(left).toContain('87654321')
    expect(left.split(':')[0]).toHaveLength(77)
  })
})

describe('formatInvNo', () => {
  it('10 碼加連字號', () => {
    expect(formatInvNo('AB12345678')).toBe('AB-12345678')
    expect(formatInvNo(null)).toBe('')
  })
})
