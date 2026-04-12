import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const LIFF_ID = import.meta.env.VITE_LIFF_ID

/**
 * Send a LINE push message via Supabase Edge Function (server-side, no CORS issue).
 */
async function sendLinePush(lineUserId, messages) {
  if (!lineUserId) return { ok: false, reason: 'no_user_id' }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/line-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
      },
      body: JSON.stringify({ to: lineUserId, messages }),
    })
    const data = await res.json()
    await logMessage(lineUserId, messages, data.ok ? 'sent' : 'failed')
    return data
  } catch (err) {
    console.error('[LINE] Push error:', err)
    await logMessage(lineUserId, messages, 'failed')
    return { ok: false, error: err.message }
  }
}

/**
 * LIFF task page URL
 */
export function getLiffTaskUrl(stepId) {
  const base = LIFF_ID ? `https://liff.line.me/${LIFF_ID}/task` : `${window.location.origin}/liff/task`
  return stepId ? `${base}?step=${stepId}` : base
}

/**
 * Notify a task assignee via LINE.
 */
export async function notifyTaskAssignee(assigneeName, taskTitle, instanceName, stepId) {
  if (!assigneeName) return { ok: false, reason: 'no_assignee' }

  const { data: emp } = await supabase.from('employees')
    .select('line_user_id').eq('name', assigneeName).maybeSingle()

  if (!emp?.line_user_id) return { ok: false, reason: 'no_line_user_id' }

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
        contents: [{ type: 'text', text: '📋 任務通知', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
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
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: '查看任務', uri: liffUrl },
          style: 'primary', color: '#06b6d4', height: 'sm',
        }],
      },
    },
  }]

  return sendLinePush(emp.line_user_id, messages)
}

/**
 * Notify for approval request — looks up employee by name (not role).
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
        contents: [{ type: 'text', text: '🔏 簽核請求', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: taskTitle, weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: `等待您的審核：${stepLabel || ''}`, size: 'sm', color: '#8c8c8c', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: '前往審核', uri: liffUrl },
          style: 'primary', color: '#8b5cf6', height: 'sm',
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

  return sendLinePush(emp.line_user_id, [{
    type: 'text',
    text: `⏰ 提醒：「${taskTitle}」即將到期\n截止日期：${dueDate}\n\n請儘速處理！`,
  }])
}

/**
 * Notify employee about published schedule via LINE.
 * @param {string} employeeName
 * @param {string} dateRange - e.g. "2026-04-13 ~ 2026-04-19"
 * @param {Array} assignments - [{ date, shift, actual_start, actual_end }]
 */
export async function notifySchedulePublished(employeeName, dateRange, assignments) {
  if (!employeeName) return { ok: false, reason: 'no_employee' }

  const { data: emp } = await supabase.from('employees')
    .select('line_user_id').eq('name', employeeName).maybeSingle()

  if (!emp?.line_user_id) return { ok: false, reason: 'no_line_user_id' }

  const dayLabels = ['日', '一', '二', '三', '四', '五', '六']
  const lines = assignments.slice(0, 7).map(a => {
    const dow = dayLabels[new Date(a.date).getDay()]
    const time = a.actual_start && a.actual_end
      ? `${a.actual_start.slice(0, 5)}~${a.actual_end.slice(0, 5)}`
      : ''
    return `${a.date.slice(5)} (${dow}) ${a.shift}${time ? ' ' + time : ''}`
  })

  const liffUrl = LIFF_ID
    ? `https://liff.line.me/${LIFF_ID}/my-schedule`
    : `${window.location.origin}/hr/my-schedule`

  const messages = [{
    type: 'flex',
    altText: `📋 班表已發布：${dateRange}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#06b6d4',
        paddingAll: '14px',
        contents: [{ type: 'text', text: '📋 班表通知', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        contents: [
          { type: 'text', text: `${dateRange} 班表已發布`, weight: 'bold', size: 'md', wrap: true },
          { type: 'separator', margin: 'md' },
          ...lines.map(line => ({ type: 'text', text: line, size: 'sm', color: '#555555', margin: 'sm' })),
          ...(assignments.length > 7 ? [{ type: 'text', text: `...共 ${assignments.length} 天`, size: 'xs', color: '#aaaaaa', margin: 'sm' }] : []),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: '查看完整班表', uri: liffUrl },
          style: 'primary', color: '#06b6d4', height: 'sm',
        }],
      },
    },
  }]

  return sendLinePush(emp.line_user_id, messages)
}

async function logMessage(recipient, messages, status = 'logged') {
  try {
    await supabase.from('message_logs').insert({
      channel: 'LINE',
      recipient: recipient || 'unknown',
      subject: messages?.[0]?.altText || messages?.[0]?.text || 'LINE push',
      body: JSON.stringify(messages),
      status,
    })
  } catch (e) { /* silent */ }
}
