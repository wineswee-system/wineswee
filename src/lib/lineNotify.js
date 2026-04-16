import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const LIFF_ID = import.meta.env.VITE_LIFF_ID

/**
 * Resolve a LINE user ID + channel for an employee.
 * Tries: specific channelCode → primary account → any active account → legacy employees.line_user_id
 * @param {string} employeeName
 * @param {string} [channelCode] - e.g. 'sme-ops', 'wines'. If omitted, uses primary or default.
 * @returns {{ lineUserId: string|null, channelCode: string|null, liffId: string|null }}
 */
async function resolveLineAccount(employeeNameOrId, channelCode) {
  if (!employeeNameOrId) return { lineUserId: null, channelCode: null, liffId: null }

  const isId = typeof employeeNameOrId === 'number'

  // Try multi-OA mapping first
  let query = supabase.from('v_employee_line_resolved')
    .select('*')

  if (isId) {
    query = query.eq('employee_id', employeeNameOrId)
  } else {
    query = query.eq('employee_name', employeeNameOrId)
  }

  if (channelCode) {
    query = query.eq('channel_code', channelCode)
  } else {
    query = query.order('is_primary', { ascending: false })
  }

  const { data: accounts } = await query.limit(1).maybeSingle()

  if (accounts?.line_user_id) {
    return {
      lineUserId: accounts.line_user_id,
      channelCode: accounts.channel_code,
      liffId: accounts.liff_id || LIFF_ID,
    }
  }

  // Fallback: legacy employees.line_user_id
  let empQuery = supabase.from('employees').select('line_user_id')
  if (isId) {
    empQuery = empQuery.eq('id', employeeNameOrId)
  } else {
    empQuery = empQuery.eq('name', employeeNameOrId)
  }
  const { data: emp } = await empQuery.maybeSingle()

  return {
    lineUserId: emp?.line_user_id || null,
    channelCode: null,
    liffId: LIFF_ID,
  }
}

/**
 * Send a LINE push message via Supabase Edge Function.
 * If channelCode is provided, the Edge Function routes to the correct channel token.
 */
async function sendLinePush(lineUserId, messages, channelCode) {
  if (!lineUserId) return { ok: false, reason: 'no_user_id' }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/line-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
      },
      body: JSON.stringify({ to: lineUserId, messages, channelCode }),
    })
    const data = await res.json()
    await logMessage(lineUserId, messages, data.ok ? 'sent' : 'failed', channelCode)
    return data
  } catch (err) {
    console.error('[LINE] Push error:', err)
    await logMessage(lineUserId, messages, 'failed', channelCode)
    return { ok: false, error: err.message }
  }
}

/**
 * LIFF task page URL — uses the channel's LIFF ID if available.
 */
export function getLiffTaskUrl(taskId, liffId) {
  const lid = liffId || LIFF_ID
  const base = lid ? `https://liff.line.me/${lid}/task` : `${window.location.origin}/liff/task`
  return taskId ? `${base}?task=${taskId}` : base
}

/**
 * Notify a task assignee via LINE.
 * @param {string} assigneeName
 * @param {string} taskTitle
 * @param {string} instanceName
 * @param {number} taskId
 * @param {string} [channelCode] - specific OA to use, or auto-resolve
 */
export async function notifyTaskAssignee(assigneeName, taskTitle, instanceName, taskId, channelCode) {
  if (!assigneeName) return { ok: false, reason: 'no_assignee' }

  const account = await resolveLineAccount(assigneeName, channelCode)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const liffUrl = getLiffTaskUrl(taskId, account.liffId)

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

  return sendLinePush(account.lineUserId, messages, account.channelCode)
}

/**
 * Notify for approval request.
 */
export async function notifyApproval(approverName, taskTitle, stepLabel, channelCode) {
  if (!approverName) return { ok: false }

  const account = await resolveLineAccount(approverName, channelCode)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const liffUrl = getLiffTaskUrl(null, account.liffId)

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

  return sendLinePush(account.lineUserId, messages, account.channelCode)
}

/**
 * Notify task due reminder.
 */
export async function notifyTaskDue(assigneeName, taskTitle, dueDate, channelCode) {
  if (!assigneeName) return { ok: false }

  const account = await resolveLineAccount(assigneeName, channelCode)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  return sendLinePush(account.lineUserId, [{
    type: 'text',
    text: `⏰ 提醒：「${taskTitle}」即將到期\n截止日期：${dueDate}\n\n請儘速處理！`,
  }], account.channelCode)
}

/**
 * Notify employee about published schedule via LINE.
 */
export async function notifySchedulePublished(employeeName, dateRange, assignments, channelCode) {
  if (!employeeName) return { ok: false, reason: 'no_employee' }

  const account = await resolveLineAccount(employeeName, channelCode)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const dayLabels = ['日', '一', '二', '三', '四', '五', '六']
  const lines = assignments.slice(0, 7).map(a => {
    const dow = dayLabels[new Date(a.date).getDay()]
    const time = a.actual_start && a.actual_end
      ? `${a.actual_start.slice(0, 5)}~${a.actual_end.slice(0, 5)}`
      : ''
    return `${a.date.slice(5)} (${dow}) ${a.shift}${time ? ' ' + time : ''}`
  })

  const lid = account.liffId || LIFF_ID
  const liffUrl = lid
    ? `https://liff.line.me/${lid}/my-schedule`
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

  return sendLinePush(account.lineUserId, messages, account.channelCode)
}

/**
 * Send to a specific LINE user ID on a specific channel (bypass employee lookup).
 */
export async function sendDirectPush(lineUserId, messages, channelCode) {
  return sendLinePush(lineUserId, messages, channelCode)
}

/**
 * Get all LINE accounts for an employee.
 */
export async function getEmployeeLineAccounts(employeeNameOrId) {
  let query = supabase.from('v_employee_line_resolved')
    .select('*')
    .order('is_primary', { ascending: false })

  if (typeof employeeNameOrId === 'number') {
    query = query.eq('employee_id', employeeNameOrId)
  } else {
    query = query.eq('employee_name', employeeNameOrId)
  }
  const { data } = await query
  return data || []
}

async function logMessage(recipient, messages, status = 'logged', channelCode) {
  try {
    await supabase.from('message_logs').insert({
      channel: 'LINE',
      recipient: recipient || 'unknown',
      subject: messages?.[0]?.altText || messages?.[0]?.text || 'LINE push',
      body: JSON.stringify(messages),
      status,
      metadata: channelCode ? { line_channel: channelCode } : undefined,
    })
  } catch (e) { /* silent */ }
}
