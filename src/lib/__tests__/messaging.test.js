import { describe, it, expect } from 'vitest'
import {
  MESSAGE_TEMPLATES,
  sendEmail,
  sendLINEMessage,
  sendSMS,
  sendBulkEmail,
  createCampaign,
} from '../messaging.js'

// ═════════════════════════════════════════════════════════════
describe('MESSAGE_TEMPLATES', () => {
  it('MS-05: all templates have required fields', () => {
    for (const [key, tmpl] of Object.entries(MESSAGE_TEMPLATES)) {
      expect(tmpl.name, `${key} missing name`).toBeTruthy()
      expect(tmpl.subject, `${key} missing subject`).toBeTruthy()
      expect(tmpl.body, `${key} missing body`).toBeTruthy()
    }
  })

  it('has order confirmation, shipping, and payment reminder', () => {
    expect(MESSAGE_TEMPLATES.order_confirmation).toBeDefined()
    expect(MESSAGE_TEMPLATES.shipping_notification).toBeDefined()
    expect(MESSAGE_TEMPLATES.payment_reminder).toBeDefined()
  })

  it('templates contain variable placeholders', () => {
    const tmpl = MESSAGE_TEMPLATES.order_confirmation
    expect(tmpl.subject).toContain('{{orderId}}')
    expect(tmpl.body).toContain('{{customerName}}')
    expect(tmpl.body).toContain('{{amount}}')
  })

  it('templates have LINE and SMS variants', () => {
    const tmpl = MESSAGE_TEMPLATES.order_confirmation
    expect(tmpl.line_text).toBeTruthy()
    expect(tmpl.sms_text).toBeTruthy()
  })
})

// ═════════════════════════════════════════════════════════════
// Email/SMS 通道尚未整合 — stub 現在「明確回報失敗」而非假裝成功。
// 會員 LINE 發送已改走 src/lib/comms/lineSender.js（crm-line-send）。
describe('sendEmail', () => {
  it('MS-01: 通道未設定 → 明確失敗並回傳 messageId', () => {
    const result = sendEmail('test@example.com', 'Test Subject', 'Test Body')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Email 通道尚未設定')
    expect(result.messageId).toMatch(/^MSG-/)
  })

  it('handles array of recipients (仍回報未設定)', () => {
    const result = sendEmail(['a@test.com', 'b@test.com'], 'Subject', 'Body')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Email 通道尚未設定')
  })

  it('無效 email 直接回報格式錯誤', () => {
    const result = sendEmail('not-an-email', 'Subject', 'Body')
    expect(result.success).toBe(false)
    expect(result.error).toContain('無效的 Email 地址')
  })
})

// ═════════════════════════════════════════════════════════════
describe('sendLINEMessage', () => {
  it('MS-02: 已棄用 stub → 明確失敗，導向 lineSender', () => {
    const result = sendLINEMessage('U12345', 'Hello!')
    expect(result.success).toBe(false)
    expect(result.error).toContain('lineSender')
    expect(result.messageId).toMatch(/^MSG-/)
  })
})

// ═════════════════════════════════════════════════════════════
describe('sendSMS', () => {
  it('MS-03: 通道未設定 → 明確失敗', () => {
    const result = sendSMS('0912345678', 'Your OTP is 123456')
    expect(result.success).toBe(false)
    expect(result.error).toContain('簡訊通道尚未設定')
    expect(result.messageId).toMatch(/^MSG-/)
  })

  it('手機格式錯誤優先回報格式錯誤', () => {
    const result = sendSMS('12345', 'test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('手機號碼格式不正確')
  })
})

// ═════════════════════════════════════════════════════════════
describe('sendBulkEmail', () => {
  it('MS-04: 通道未設定 → 全數失敗，不假裝成功', () => {
    const recipients = Array.from({ length: 50 }, (_, i) => ({
      email: `user${i}@test.com`,
      name: `User ${i}`,
    }))
    const template = MESSAGE_TEMPLATES.order_confirmation
    const result = sendBulkEmail(recipients, template, {
      orderId: 'ORD-001',
      amount: 'NT$1,500',
      orderDate: '2026-04-05',
      companyName: 'Test Corp',
    })
    expect(result.success).toBe(false)
    expect(result.sent).toBe(0)
    expect(result.failed).toBe(50)
  })
})

// ═════════════════════════════════════════════════════════════
describe('createCampaign', () => {
  it('creates campaign record', () => {
    const result = createCampaign(
      'Spring Sale',
      'email',
      [{ email: 'a@test.com' }],
      { subject: 'Sale!', body: 'Buy now!' },
    )
    expect(result.campaignId).toMatch(/^CMP-/)
    expect(result.name).toBe('Spring Sale')
    expect(result.type).toBe('email')
    // Without scheduledAt and with recipients, it auto-sends
    expect(['draft', 'sending', 'completed']).toContain(result.status)
  })

  it('handles scheduled campaign', () => {
    const result = createCampaign(
      'Scheduled',
      'email',
      [{ email: 'a@test.com' }],
      { subject: 'Hi', body: 'Hello' },
      '2027-05-01T09:00:00Z', // Future date
    )
    expect(result.scheduledAt).toBe('2027-05-01T09:00:00Z')
    expect(result.status).toBe('scheduled')
  })
})
