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
describe('sendEmail', () => {
  it('MS-01: sends email and returns messageId', () => {
    const result = sendEmail('test@example.com', 'Test Subject', 'Test Body')
    expect(result.success).toBe(true)
    expect(result.messageId).toMatch(/^MSG-/)
  })

  it('handles array of recipients', () => {
    const result = sendEmail(['a@test.com', 'b@test.com'], 'Subject', 'Body')
    expect(result.success).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════
describe('sendLINEMessage', () => {
  it('MS-02: formats LINE message', () => {
    const result = sendLINEMessage('U12345', 'Hello!')
    expect(result.success).toBe(true)
    expect(result.messageId).toMatch(/^MSG-/)
  })
})

// ═════════════════════════════════════════════════════════════
describe('sendSMS', () => {
  it('MS-03: formats SMS', () => {
    const result = sendSMS('0912345678', 'Your OTP is 123456')
    expect(result.success).toBe(true)
    expect(result.messageId).toMatch(/^MSG-/)
  })
})

// ═════════════════════════════════════════════════════════════
describe('sendBulkEmail', () => {
  it('MS-04: batches bulk email', () => {
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
    expect(result.success).toBe(true)
    expect(result.sent).toBe(50)
    expect(result.failed).toBe(0)
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
