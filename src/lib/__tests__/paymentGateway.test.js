/**
 * F-D1 信用卡收單 = 中國信託（與 ECPay 脫鉤）— paymentGateway 單元測試
 * PG-01 credit_card 路由改走 ctbc_edc 登錄（不再導 ECPay 表單）
 * PG-02 EDC 登錄必填卡別/末四碼/授權碼驗證
 * PG-03 線上收單走 ctbc-card-checkout、金鑰不出現於前端 payload
 * PG-04 付款方式與發票開立解耦（invoice_status 維持 'pending' 由 issue-invoice 補開）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  inserts: [],
  insertResult: { data: { id: 'pay-1', invoice_status: 'pending' }, error: null },
}))

vi.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: (...args) => h.invoke(...args) },
    from: (table) => ({
      insert: (row) => {
        h.inserts.push({ table, row })
        return {
          select: () => ({ single: () => Promise.resolve(h.insertResult) }),
        }
      },
    }),
  },
}))

import {
  processPayment,
  recordEdcPayment,
  validateEdcFields,
  EDC_CARD_BRANDS,
  getPaymentMethods,
} from '../paymentGateway.js'

beforeEach(() => {
  h.invoke.mockReset()
  h.inserts.length = 0
  h.insertResult = { data: { id: 'pay-1', invoice_status: 'pending' }, error: null }
})

const validEdc = { card_brand: 'VISA', card_last4: '1234', auth_code: 'A1B2C3' }

// ═════════════════════════════════════════════════════════════
describe('PG-01: credit_card → 中信 EDC 登錄模式（不再導 ECPay）', () => {
  it('returns edc_log mode with CTBC acquirer and required fields', async () => {
    const result = await processPayment('credit_card', 880, 'POS-1')
    expect(result.success).toBe(true)
    expect(result.mode).toBe('edc_log')
    expect(result.acquirer).toBe('CTBC')
    expect(result.requiredFields).toEqual(['card_brand', 'card_last4', 'auth_code'])
    expect(result.status).toBe('completed')
  })

  it('does NOT invoke any gateway edge function (no ECPay redirect)', async () => {
    const result = await processPayment('credit_card', 880, 'POS-1')
    expect(h.invoke).not.toHaveBeenCalled()
    expect(result.gatewayAction).toBeUndefined()
    expect(result.gatewayParams).toBeUndefined()
  })

  it('ecpay method stays untouched as legacy backup (still hits ecpay-checkout)', async () => {
    h.invoke.mockResolvedValue({ data: { simulated: true, merchantTradeNo: 'X1' }, error: null })
    const result = await processPayment('ecpay', 100, 'O-1')
    expect(h.invoke).toHaveBeenCalledTimes(1)
    expect(h.invoke.mock.calls[0][0]).toBe('ecpay-checkout')
    expect(result.status).toBe('pending_confirmation')
  })

  it('line_pay stays untouched (still hits linepay-checkout)', async () => {
    h.invoke.mockResolvedValue({ data: { simulated: true }, error: null })
    await processPayment('line_pay', 100, 'O-2')
    expect(h.invoke.mock.calls[0][0]).toBe('linepay-checkout')
  })

  it('cash stays untouched (no gateway, completed)', async () => {
    const result = await processPayment('cash', 100, 'O-3')
    expect(result.status).toBe('completed')
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('getPaymentMethods still lists credit_card', () => {
    const keys = getPaymentMethods().map(m => m.key)
    expect(keys).toContain('credit_card')
    expect(keys).toContain('ecpay')
  })
})

// ═════════════════════════════════════════════════════════════
describe('PG-02: EDC 登錄欄位驗證', () => {
  it('accepts all valid card brands', () => {
    expect(EDC_CARD_BRANDS).toEqual(['VISA', 'MasterCard', 'JCB', 'AMEX', '國內卡'])
    for (const brand of EDC_CARD_BRANDS) {
      expect(validateEdcFields({ ...validEdc, card_brand: brand })).toEqual([])
    }
  })

  it('rejects unknown card brand', () => {
    const errors = validateEdcFields({ ...validEdc, card_brand: 'UnionPay' })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('卡別')
  })

  it('rejects bad last4 (non-digit / wrong length)', () => {
    expect(validateEdcFields({ ...validEdc, card_last4: '12a4' }).length).toBeGreaterThan(0)
    expect(validateEdcFields({ ...validEdc, card_last4: '123' }).length).toBeGreaterThan(0)
    expect(validateEdcFields({ ...validEdc, card_last4: '12345' }).length).toBeGreaterThan(0)
    expect(validateEdcFields({ ...validEdc, card_last4: '' }).length).toBeGreaterThan(0)
  })

  it('rejects bad auth code (too short / too long / symbols)', () => {
    expect(validateEdcFields({ ...validEdc, auth_code: 'A1B' }).length).toBeGreaterThan(0)
    expect(validateEdcFields({ ...validEdc, auth_code: 'A1B2C3D4E' }).length).toBeGreaterThan(0)
    expect(validateEdcFields({ ...validEdc, auth_code: 'AB-12' }).length).toBeGreaterThan(0)
  })

  it('recordEdcPayment throws on invalid fields and writes nothing', async () => {
    await expect(recordEdcPayment({
      organization_id: 1, store_id: 1, order_id: 'txn-1', amount: 500,
      card_brand: 'VISA', card_last4: '12', auth_code: 'A1B2',
    })).rejects.toThrow(/末四碼/)
    expect(h.inserts.length).toBe(0)
  })

  it('recordEdcPayment throws on non-positive amount', async () => {
    await expect(recordEdcPayment({
      organization_id: 1, store_id: 1, order_id: 'txn-1', amount: 0, ...validEdc,
    })).rejects.toThrow(/金額/)
  })

  it('recordEdcPayment writes pos_payments with gateway=ctbc_edc', async () => {
    const result = await recordEdcPayment({
      organization_id: 1, store_id: 2, order_id: 'txn-9', amount: 880, ...validEdc,
    })
    expect(h.inserts.length).toBe(1)
    expect(h.inserts[0].table).toBe('pos_payments')
    const row = h.inserts[0].row
    expect(row.gateway).toBe('ctbc_edc')
    expect(row.acquirer).toBe('CTBC')
    expect(row.payment_method).toBe('card')
    expect(row.card_brand).toBe('VISA')
    expect(row.card_last4).toBe('1234')
    expect(row.auth_code).toBe('A1B2C3')
    expect(row.amount).toBe(880)
    expect(result.success).toBe(true)
    expect(result.paymentId).toBe('pay-1')
  })
})

// ═════════════════════════════════════════════════════════════
describe('PG-03: 線上收單走 ctbc-card-checkout（金鑰不出前端）', () => {
  it('credit_card + {online:true} invokes ctbc-card-checkout', async () => {
    h.invoke.mockResolvedValue({ data: { simulated: true, merchantTradeNo: 'POS1' }, error: null })
    const result = await processPayment('credit_card', 1500, 'POS-1', { online: true })
    expect(h.invoke).toHaveBeenCalledTimes(1)
    expect(h.invoke.mock.calls[0][0]).toBe('ctbc-card-checkout')
    expect(result.status).toBe('pending_confirmation')
    expect(result.simulated).toBe(true)
    expect(result.acquirer).toBe('CTBC')
  })

  it('frontend payload contains no merchant secrets (MAC key 等只在 edge secrets)', async () => {
    h.invoke.mockResolvedValue({ data: { simulated: true, merchantTradeNo: 'POS1' }, error: null })
    await processPayment('credit_card', 1500, 'POS-1', { online: true })
    const { body } = h.invoke.mock.calls[0][1]
    const keys = Object.keys(body).map(k => k.toLowerCase())
    for (const forbidden of ['mac', 'key', 'secret', 'merchant_id', 'terminal']) {
      expect(keys.some(k => k.includes(forbidden)), `payload 不應含 ${forbidden}`).toBe(false)
    }
    expect(body.orderId).toBe('POS-1')
    expect(body.amount).toBe(1500)
  })

  it('real gateway mode returns form-post action/params for 中信授權頁', async () => {
    h.invoke.mockResolvedValue({
      data: {
        simulated: false,
        merchantTradeNo: 'POS1',
        action: 'https://ctbc.example/auth',
        params: { lidm: 'POS1', macValue: 'ABC' },
      },
      error: null,
    })
    const result = await processPayment('credit_card', 1500, 'POS-1', { online: true })
    expect(result.gatewayAction).toBe('https://ctbc.example/auth')
    expect(result.gatewayParams).toEqual({ lidm: 'POS1', macValue: 'ABC' })
    expect(result.status).toBe('pending_confirmation')
  })
})

// ═════════════════════════════════════════════════════════════
describe('PG-04: 付款方式與發票開立解耦', () => {
  it('recordEdcPayment does NOT set invoice_status (DB default pending → issue-invoice 補開)', async () => {
    await recordEdcPayment({
      organization_id: 1, store_id: 2, order_id: 'txn-9', amount: 880, ...validEdc,
    })
    const row = h.inserts[0].row
    expect(Object.prototype.hasOwnProperty.call(row, 'invoice_status')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(row, 'invoice_number')).toBe(false)
  })

  it('returns invoiceStatus=pending so issue-invoice picks it up regardless of method', async () => {
    const result = await recordEdcPayment({
      organization_id: 1, store_id: 2, order_id: 'txn-9', amount: 880, ...validEdc,
    })
    expect(result.invoiceStatus).toBe('pending')
  })
})
