import { describe, it, expect } from 'vitest'
import {
  GATEWAY_CONFIG,
  PAYMENT_METHODS,
  createPaymentRequest,
  verifyPaymentCallback,
  processRefund,
  getPaymentStatus,
} from '../payment.js'

const order = {
  orderId: 'ORD-001',
  amount: 1500,
  currency: 'TWD',
  description: 'Test Order',
  customerEmail: 'test@example.com',
}

// ═════════════════════════════════════════════════════════════
describe('GATEWAY_CONFIG & PAYMENT_METHODS', () => {
  it('has ecpay and line_pay configs', () => {
    expect(GATEWAY_CONFIG.ecpay).toBeDefined()
    expect(GATEWAY_CONFIG.line_pay).toBeDefined()
  })

  it('has 5 payment methods', () => {
    expect(PAYMENT_METHODS.length).toBe(5)
    const codes = PAYMENT_METHODS.map(m => m.code)
    expect(codes).toContain('credit_card')
    expect(codes).toContain('line_pay')
    expect(codes).toContain('cash')
  })
})

// ═════════════════════════════════════════════════════════════
describe('createPaymentRequest', () => {
  it('POS-U01: ECPay credit card request', () => {
    const result = createPaymentRequest(order, 'credit_card')
    expect(result.paymentId).toMatch(/^PAY-/)
    expect(result.redirectUrl).toBeTruthy()
    expect(result.formData).toBeDefined()
    expect(result.formData.TotalAmount).toBe(1500)
    expect(result.formData.ChoosePayment).toBe('Credit')
    expect(result.status).toBe('pending')
  })

  it('POS-U02: LINE Pay request', () => {
    const result = createPaymentRequest(order, 'line_pay')
    expect(result.paymentId).toMatch(/^PAY-/)
    expect(result.redirectUrl).toContain('line.me')
    expect(result.formData.amount).toBe(1500)
    expect(result.formData.currency).toBe('TWD')
    expect(result.status).toBe('pending')
  })

  it('cash payment — no redirect', () => {
    const result = createPaymentRequest(order, 'cash')
    expect(result.redirectUrl).toBeNull()
    expect(result.status).toBe('pending_confirmation')
  })

  it('bank transfer — virtual account', () => {
    const result = createPaymentRequest(order, 'bank_transfer')
    expect(result.formData.bankCode).toBeTruthy()
    expect(result.formData.amount).toBe(1500)
    expect(result.status).toBe('awaiting_transfer')
  })

  it('unsupported method returns error', () => {
    const result = createPaymentRequest(order, 'bitcoin')
    expect(result.status).toBe('error')
  })

  it('each request has unique paymentId', () => {
    const r1 = createPaymentRequest(order, 'cash')
    const r2 = createPaymentRequest(order, 'cash')
    expect(r1.paymentId).not.toBe(r2.paymentId)
  })
})

// ═════════════════════════════════════════════════════════════
describe('verifyPaymentCallback', () => {
  it('POS-U03: ECPay success callback', () => {
    const result = verifyPaymentCallback({
      RtnCode: '1',
      MerchantTradeNo: 'PAY123',
      TradeAmt: '1500',
      TradeNo: 'TXN456',
      RtnMsg: 'Success',
    }, 'ecpay')
    expect(result.verified).toBe(true)
    expect(result.status).toBe('completed')
    expect(result.amount).toBe(1500)
  })

  it('ECPay failed callback', () => {
    const result = verifyPaymentCallback({ RtnCode: '0', RtnMsg: 'Failed' }, 'ecpay')
    expect(result.status).toBe('failed')
  })

  it('LINE Pay success callback', () => {
    const result = verifyPaymentCallback({
      returnCode: '0000',
      orderId: 'PAY789',
      transactionId: 'LTXN123',
    }, 'line_pay')
    expect(result.verified).toBe(true)
    expect(result.status).toBe('completed')
  })

  it('POS-U04: unknown gateway', () => {
    const result = verifyPaymentCallback({}, 'unknown')
    expect(result.verified).toBe(false)
    expect(result.status).toBe('unknown')
  })
})

// ═════════════════════════════════════════════════════════════
describe('processRefund', () => {
  it('POS-U05: creates refund request', () => {
    const result = processRefund('PAY-123', 500, 'Customer request')
    expect(result.success).toBe(true)
    expect(result.refundId).toMatch(/^REF-/)
    expect(result.paymentId).toBe('PAY-123')
    expect(result.amount).toBe(500)
    expect(result.reason).toBe('Customer request')
    expect(result.status).toBe('refund_pending')
  })
})

// ═════════════════════════════════════════════════════════════
describe('getPaymentStatus', () => {
  it('POS-U06: returns status', () => {
    const result = getPaymentStatus('PAY-123')
    expect(result.paymentId).toBe('PAY-123')
    expect(result.status).toBeTruthy()
    expect(result.details).toBeDefined()
  })
})
