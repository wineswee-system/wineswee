import { describe, it, expect } from 'vitest'
import { parseTableQR } from '../tableQR'

describe('parseTableQR', () => {
  it('parses a full table QR url', () => {
    const r = parseTableQR('https://pos.example.com/menu/12/34?token=abc-123')
    expect(r).toEqual({ storeId: '12', tableId: '34', token: 'abc-123' })
  })

  it('parses a bare path without token', () => {
    const r = parseTableQR('/menu/12/34')
    expect(r).toEqual({ storeId: '12', tableId: '34', token: null })
  })

  it('accepts uuid ids and trailing slash', () => {
    const r = parseTableQR('https://x.tw/menu/0a1b2c3d-e4f5-6789-abcd-ef0123456789/55/?token=t')
    expect(r?.storeId).toBe('0a1b2c3d-e4f5-6789-abcd-ef0123456789')
    expect(r?.tableId).toBe('55')
  })

  it('rejects product barcodes and unrelated urls', () => {
    expect(parseTableQR('4710088412345')).toBeNull()
    expect(parseTableQR('https://x.tw/pos/terminal')).toBeNull()
    expect(parseTableQR('https://x.tw/menu/12')).toBeNull()
    expect(parseTableQR('')).toBeNull()
    expect(parseTableQR(null)).toBeNull()
  })
})
