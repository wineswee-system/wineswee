/**
 * 訊息發送模組 (Email / LINE / SMS)
 * 統一訊息發送介面，支援多管道通知與行銷活動
 *
 * ⚠️ 注意：此模組的 email / SMS 為 placeholder，實際不會發送。
 *    LINE 推播通知請使用 lineNotify.js（透過 Supabase Edge Function 真正發送）。
 *    此模組主要用於 CRM 行銷活動的訊息記錄（寫入 message_logs 表）。
 */

import { supabase } from './supabase'

// ── Channel Abstraction ──────────────────────────────────────
// Pluggable channel configurations (read from env or DB)
const CHANNELS = {
  email: {
    name: 'Email',
    icon: 'Mail',
    configured: !!import.meta.env.VITE_SMTP_HOST,
    config: {
      host: import.meta.env.VITE_SMTP_HOST || '',
      port: import.meta.env.VITE_SMTP_PORT || 587,
      user: import.meta.env.VITE_SMTP_USER || '',
    }
  },
  sms: {
    name: 'SMS 簡訊',
    icon: 'MessageSquare',
    configured: !!import.meta.env.VITE_SMS_API_KEY,
    config: {
      provider: 'mitake', // Taiwan SMS provider
      apiKey: import.meta.env.VITE_SMS_API_KEY || '',
    }
  },
  line: {
    name: 'LINE',
    icon: 'MessageCircle',
    configured: !!import.meta.env.VITE_LINE_CHANNEL_TOKEN,
    config: {
      channelToken: import.meta.env.VITE_LINE_CHANNEL_TOKEN || '',
      channelSecret: import.meta.env.VITE_LINE_CHANNEL_SECRET || '',
    }
  }
}

/** 取得所有通道清單 */
export function getChannels() {
  return Object.entries(CHANNELS).map(([key, val]) => ({ key, ...val }))
}

/** 檢查通道是否已設定 */
export function isChannelConfigured(channel) {
  return CHANNELS[channel]?.configured || false
}

/**
 * 統一發送訊息（抽象層 — 記錄到 DB，生產環境會呼叫對應 provider）
 */
export async function sendMessage(channel, recipient, subject, body, options = {}) {
  const ch = CHANNELS[channel]
  if (!ch) throw new Error(`Unknown channel: ${channel}`)

  const record = {
    channel,
    recipient,
    subject: subject || '',
    body,
    status: ch.configured ? 'queued' : 'simulated',
    campaign_id: options.campaignId || null,
    customer_id: options.customerId || null,
    sent_at: new Date().toISOString(),
    metadata: options.metadata || {}
  }

  // In production with real config:
  // if (channel === 'email') await sendEmailViaProvider(recipient, subject, body);
  // if (channel === 'sms') await sendSMSViaProvider(recipient, body);
  // if (channel === 'line') await sendLINEViaProvider(recipient, body);

  const { data, error } = await supabase.from('message_logs').insert(record).select().single()
  if (error) {
    console.warn('Message logged (simulated):', record)
    return { ...record, id: `SIM-${Date.now()}`, status: 'simulated' }
  }

  return { ...data, status: ch.configured ? 'sent' : 'simulated' }
}

/**
 * 批次發送活動訊息給多位收件人
 */
export async function sendCampaignMessages(channel, recipients, subject, body, campaignId) {
  const results = []
  for (const recipient of recipients) {
    try {
      const addr = recipient.email || recipient.phone || recipient.lineUserId || recipient.line_id || ''
      const result = await sendMessage(channel, addr, subject, body, {
        campaignId,
        customerId: recipient.id
      })
      results.push({ ...result, success: true })
    } catch (err) {
      results.push({ recipient, success: false, error: err.message })
    }
  }

  return {
    total: recipients.length,
    sent: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results
  }
}

/**
 * 查詢發送紀錄
 */
export async function getMessageHistory(filters = {}) {
  let query = supabase.from('message_logs').select('*').order('sent_at', { ascending: false })
  if (filters.channel) query = query.eq('channel', filters.channel)
  if (filters.campaignId) query = query.eq('campaign_id', filters.campaignId)
  if (filters.customerId) query = query.eq('customer_id', filters.customerId)
  if (filters.limit) query = query.limit(filters.limit)
  const { data } = await query
  return data || []
}

// 常用訊息範本
export const MESSAGE_TEMPLATES = {
  order_confirmation: {
    name: '訂單確認',
    subject: '訂單確認通知 - 訂單編號 {{orderId}}',
    body: `親愛的 {{customerName}} 您好，

感謝您的訂購！您的訂單已成功建立。

訂單編號：{{orderId}}
訂單金額：{{amount}}
訂單日期：{{orderDate}}

我們將盡快為您處理出貨，届時會再通知您。

如有任何問題，請隨時與我們聯繫。

{{companyName}} 敬上`,
    line_text: '✅ 訂單確認\n訂單編號：{{orderId}}\n金額：{{amount}}\n感謝您的訂購！',
    sms_text: '【{{companyName}}】訂單{{orderId}}已成立，金額{{amount}}。',
  },
  shipping_notification: {
    name: '出貨通知',
    subject: '出貨通知 - 訂單 {{orderId}} 已出貨',
    body: `親愛的 {{customerName}} 您好，

您的訂單已出貨！

訂單編號：{{orderId}}
物流公司：{{carrier}}
追蹤編號：{{trackingNumber}}
預計送達：{{estimatedDelivery}}

您可透過以下連結查詢物流進度：
{{trackingUrl}}

{{companyName}} 敬上`,
    line_text: '📦 出貨通知\n訂單：{{orderId}}\n物流：{{carrier}}\n追蹤碼：{{trackingNumber}}',
    sms_text: '【{{companyName}}】訂單{{orderId}}已出貨，追蹤碼{{trackingNumber}}。',
  },
  payment_reminder: {
    name: '付款提醒',
    subject: '付款提醒 - 訂單 {{orderId}}',
    body: `親愛的 {{customerName}} 您好，

提醒您，以下訂單尚未完成付款：

訂單編號：{{orderId}}
應付金額：{{amount}}
付款期限：{{dueDate}}

請於期限內完成付款，以免影響出貨時程。

如已完成付款，請忽略此通知。

{{companyName}} 敬上`,
    line_text: '⏰ 付款提醒\n訂單：{{orderId}}\n金額：{{amount}}\n期限：{{dueDate}}\n請儘速完成付款。',
    sms_text: '【{{companyName}}】訂單{{orderId}}尚未付款，金額{{amount}}，期限{{dueDate}}。',
  },
}

/**
 * 替換範本中的變數
 * @param {string} template - 含 {{variable}} 的範本字串
 * @param {Object} data     - 變數對應值
 * @returns {string}
 */
function renderTemplate(template, data) {
  if (!template) return ''
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return data[key] != null ? String(data[key]) : `{{${key}}}`
  })
}

/**
 * 產生訊息識別碼
 */
function generateMessageId() {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).substring(2, 8)
  return `MSG-${ts}-${rand}`.toUpperCase()
}

/**
 * 發送 Email
 * @param {string|string[]} to  - 收件人 email（可為陣列）
 * @param {string} subject      - 主旨
 * @param {string} body         - 內容（支援 HTML）
 * @param {Object} [options]    - { cc, bcc, replyTo, attachments, from, smtpConfig }
 * @returns {{ success: boolean, messageId: string, error?: string }}
 */
export function sendEmail(to, subject, body, options = {}) {
  // TODO: 實際整合 SMTP (nodemailer) 或 SendGrid API
  // 參考設定：
  // const smtpConfig = options.smtpConfig || {
  //   host: 'smtp.gmail.com', port: 587,
  //   auth: { user: '', pass: '' }
  // }

  const messageId = generateMessageId()
  const recipients = Array.isArray(to) ? to : [to]

  // 驗證 email 格式
  const invalidEmails = recipients.filter(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  if (invalidEmails.length > 0) {
    return {
      success: false,
      messageId,
      error: `無效的 Email 地址: ${invalidEmails.join(', ')}`,
    }
  }

  console.log(`[Email] 發送至 ${recipients.join(', ')} | 主旨: ${subject}`)

  return {
    success: true,
    messageId,
    channel: 'email',
    to: recipients,
    subject,
    sentAt: new Date().toISOString(),
  }
}

/**
 * 發送 LINE 訊息
 * @param {string} userId   - LINE User ID
 * @param {string|Object} message - 文字訊息或 Flex Message 物件
 * @param {Object} [options] - { type: 'text'|'flex'|'image', channelAccessToken, altText }
 * @returns {{ success: boolean, messageId: string, error?: string }}
 */
export function sendLINEMessage(userId, message, options = {}) {
  // TODO: 實際整合 LINE Messaging API
  // POST https://api.line.me/v2/bot/message/push
  // Headers: { Authorization: `Bearer ${options.channelAccessToken}` }

  const messageId = generateMessageId()

  if (!userId) {
    return { success: false, messageId, error: 'LINE User ID 不得為空' }
  }

  const type = options.type || (typeof message === 'string' ? 'text' : 'flex')

  let payload
  if (type === 'text') {
    payload = { type: 'text', text: message }
  } else if (type === 'flex') {
    payload = {
      type: 'flex',
      altText: options.altText || '您有一則新通知',
      contents: typeof message === 'object' ? message : { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: message }] } },
    }
  } else if (type === 'image') {
    payload = {
      type: 'image',
      originalContentUrl: message,
      previewImageUrl: options.previewUrl || message,
    }
  }

  console.log(`[LINE] 發送至 ${userId} | 類型: ${type}`)

  return {
    success: true,
    messageId,
    channel: 'line',
    userId,
    type,
    payload,
    sentAt: new Date().toISOString(),
  }
}

/**
 * 發送簡訊 (SMS)
 * @param {string} phoneNumber - 手機號碼（台灣格式 09xxxxxxxx）
 * @param {string} message     - 簡訊內容（70字以內為 1 則）
 * @param {Object} [options]   - { provider: 'mitake'|'every8d', apiConfig }
 * @returns {{ success: boolean, messageId: string, error?: string }}
 */
export function sendSMS(phoneNumber, message, options = {}) {
  // TODO: 實際整合三竹簡訊 (Mitake) 或 Every8d API
  // 三竹 API: https://smsapi.mitake.com.tw/api/mtk/SmSend
  // Every8d: https://oms.every8d.com/API21/HTTP/sendSMS.ashx

  const messageId = generateMessageId()

  // 驗證手機號碼格式
  const cleaned = phoneNumber.replace(/[\s-]/g, '')
  if (!/^09\d{8}$/.test(cleaned) && !/^\+886\d{9}$/.test(cleaned)) {
    return { success: false, messageId, error: '手機號碼格式不正確（請使用 09xxxxxxxx）' }
  }

  // 檢查簡訊長度
  const charCount = message.length
  const smsCount = Math.ceil(charCount / 70) // 中文 70 字 = 1 則

  console.log(`[SMS] 發送至 ${cleaned} | ${charCount} 字 (${smsCount} 則)`)

  return {
    success: true,
    messageId,
    channel: 'sms',
    phoneNumber: cleaned,
    charCount,
    smsCount,
    sentAt: new Date().toISOString(),
  }
}

/**
 * 批次發送 Email（行銷活動用）
 * @param {Array} recipients - [{email, name, ...customData}]
 * @param {string} template  - MESSAGE_TEMPLATES 的 key 或自訂範本字串
 * @param {Object} data      - 範本共用變數
 * @returns {{ success: boolean, total: number, sent: number, failed: number, results: Array }}
 */
export function sendBulkEmail(recipients, template, data = {}) {
  const messageId = generateMessageId()

  // 解析範本
  const tmpl = MESSAGE_TEMPLATES[template]
  const subjectTmpl = tmpl ? tmpl.subject : (data.subject || '通知')
  const bodyTmpl = tmpl ? tmpl.body : (typeof template === 'string' && template.length > 30 ? template : '通知內容')

  const results = []
  let sent = 0
  let failed = 0

  for (const recipient of recipients) {
    const mergedData = { ...data, ...recipient, customerName: recipient.name }
    const subject = renderTemplate(subjectTmpl, mergedData)
    const body = renderTemplate(bodyTmpl, mergedData)

    const result = sendEmail(recipient.email, subject, body)
    results.push({ email: recipient.email, ...result })

    if (result.success) sent++
    else failed++
  }

  return {
    success: failed === 0,
    campaignMessageId: messageId,
    total: recipients.length,
    sent,
    failed,
    results,
  }
}

/**
 * 建立行銷活動
 * @param {string} name        - 活動名稱
 * @param {string} type        - 'email' | 'line' | 'sms' | 'multi'
 * @param {Array}  recipients  - 收件人清單
 * @param {Object} content     - { subject, body, template, lineMessage, smsMessage }
 * @param {string} [scheduledAt] - 排程發送時間 (ISO string)，null = 立即發送
 * @returns {{ campaignId: string, name: string, type: string, status: string, recipientCount: number, scheduledAt: string|null }}
 */
export function createCampaign(name, type, recipients, content, scheduledAt = null) {
  const campaignId = `CMP-${Date.now().toString(36).toUpperCase()}`

  // 判斷狀態
  const now = new Date()
  let status = 'draft'
  if (scheduledAt) {
    const scheduled = new Date(scheduledAt)
    status = scheduled > now ? 'scheduled' : 'sending'
  }

  // 若為立即發送且有收件人，模擬發送
  const sendResults = []
  if (!scheduledAt && recipients.length > 0) {
    status = 'sending'

    if (type === 'email' || type === 'multi') {
      const emailResult = sendBulkEmail(recipients, content.template || content.body, content)
      sendResults.push({ channel: 'email', ...emailResult })
    }

    if (type === 'line' || type === 'multi') {
      for (const r of recipients.filter(r => r.lineUserId)) {
        const msg = content.lineMessage || content.body || '行銷活動通知'
        const result = sendLINEMessage(r.lineUserId, msg)
        sendResults.push({ channel: 'line', ...result })
      }
    }

    if (type === 'sms' || type === 'multi') {
      for (const r of recipients.filter(r => r.phone)) {
        const msg = content.smsMessage || content.body?.substring(0, 70) || '行銷活動通知'
        const result = sendSMS(r.phone, msg)
        sendResults.push({ channel: 'sms', ...result })
      }
    }

    status = 'completed'
  }

  return {
    campaignId,
    name,
    type,
    status,
    recipientCount: recipients.length,
    scheduledAt,
    createdAt: now.toISOString(),
    sendResults: sendResults.length > 0 ? sendResults : undefined,
  }
}
