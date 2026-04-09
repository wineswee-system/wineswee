import { supabase } from './supabase'

const LINE_API_URL = 'https://api.line.me/v2/bot/message/push'
const CHANNEL_TOKEN = import.meta.env.VITE_LINE_CHANNEL_TOKEN
const LIFF_ID = import.meta.env.VITE_LIFF_ID

/**
 * Send a LINE push message to a user.
 * @param {string} lineUserId - LINE user ID
 * @param {object[]} messages - LINE message objects
 */
export async function sendLinePush(lineUserId, messages) {
  if (!CHANNEL_TOKEN || !lineUserId) {
    console.warn('[LINE] Missing token or userId, logging only')
    await logMessage(lineUserId, messages)
    return { ok: false, reason: 'missing_config' }
  }

  try {
    const res = await fetch(LINE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CHANNEL_TOKEN}`,
      },
      body: JSON.stringify({ to: lineUserId, messages }),
    })
    const ok = res.ok
    if (!ok) {
      const err = await res.json().catch(() => ({}))
      console.error('[LINE] Push failed:', err)
    }
    await logMessage(lineUserId, messages, ok ? 'sent' : 'failed')
    return { ok }
  } catch (err) {
    console.error('[LINE] Push error:', err)
    await logMessage(lineUserId, messages, 'failed')
    return { ok: false, error: err.message }
  }
}

/**
 * Get the LIFF task page URL
 */
export function getLiffTaskUrl(stepId) {
  if (LIFF_ID) {
    return `https://liff.line.me/${LIFF_ID}/task`
  }
  return `${window.location.origin}/liff/task`
}

/**
 * Notify a task assignee via LINE.
 * Looks up the employee's line_user_id and sends a push message.
 */
export async function notifyTaskAssignee(assigneeName, taskTitle, instanceName, stepId) {
  if (!assigneeName) return { ok: false, reason: 'no_assignee' }

  // Look up employee's LINE user ID
  const { data: emp } = await supabase.from('employees')
    .select('line_user_id').eq('name', assigneeName).maybeSingle()

  if (!emp?.line_user_id) {
    console.warn(`[LINE] Employee "${assigneeName}" has no line_user_id`)
    return { ok: false, reason: 'no_line_user_id' }
  }

  const liffUrl = getLiffTaskUrl(stepId)

  const messages = [{
    type: 'flex',
    altText: `📋 新任務：${taskTitle}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#06b6d4',
        paddingAll: '14px',
        contents: [{
          type: 'text', text: '📋 任務通知',
          color: '#ffffff', weight: 'bold', size: 'md',
        }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: taskTitle, weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: instanceName || '', size: 'sm', color: '#8c8c8c' },
          { type: 'separator', margin: 'md' },
          {
            type: 'box', layout: 'horizontal', margin: 'md',
            contents: [
              { type: 'text', text: '負責人', size: 'sm', color: '#8c8c8c', flex: 0 },
              { type: 'text', text: assigneeName, size: 'sm', align: 'end', weight: 'bold' },
            ],
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        paddingAll: '12px',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: '查看任務', uri: liffUrl },
          style: 'primary', color: '#06b6d4',
          height: 'sm',
        }],
      },
    },
  }]

  return sendLinePush(emp.line_user_id, messages)
}

/**
 * Notify for approval request
 */
export async function notifyApproval(approverName, taskTitle, stepLabel) {
  if (!approverName) return { ok: false }

  const { data: emp } = await supabase.from('employees')
    .select('line_user_id').eq('name', approverName).maybeSingle()

  if (!emp?.line_user_id) return { ok: false, reason: 'no_line_user_id' }

  const liffUrl = getLiffTaskUrl()

  const messages = [{
    type: 'flex',
    altText: `🔏 簽核請求：${taskTitle}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#8b5cf6',
        paddingAll: '14px',
        contents: [{
          type: 'text', text: '🔏 簽核請求',
          color: '#ffffff', weight: 'bold', size: 'md',
        }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: taskTitle, weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: `等待您的審核：${stepLabel || ''}`, size: 'sm', color: '#8c8c8c', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        paddingAll: '12px',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: '前往審核', uri: liffUrl },
          style: 'primary', color: '#8b5cf6',
          height: 'sm',
        }],
      },
    },
  }]

  return sendLinePush(emp.line_user_id, messages)
}

/**
 * Notify task due reminder
 */
export async function notifyTaskDue(assigneeName, taskTitle, dueDate) {
  if (!assigneeName) return { ok: false }

  const { data: emp } = await supabase.from('employees')
    .select('line_user_id').eq('name', assigneeName).maybeSingle()

  if (!emp?.line_user_id) return { ok: false, reason: 'no_line_user_id' }

  const messages = [{
    type: 'text',
    text: `⏰ 提醒：「${taskTitle}」即將到期\n截止日期：${dueDate}\n\n請儘速處理！`,
  }]

  return sendLinePush(emp.line_user_id, messages)
}

// Log to DB
async function logMessage(recipient, messages, status = 'logged') {
  try {
    await supabase.from('message_logs').insert({
      channel: 'LINE',
      recipient: recipient || 'unknown',
      subject: messages?.[0]?.altText || messages?.[0]?.text || 'LINE push',
      body: JSON.stringify(messages),
      status,
    })
  } catch (e) {
    console.error('[LINE] Log failed:', e)
  }
}
