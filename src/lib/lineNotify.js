import { supabase } from './supabase'

const LIFF_ID = import.meta.env.VITE_LIFF_ID

/**
 * Resolve a LINE user ID + channel for an employee via employee_line_accounts.
 * @param {string|number} employeeNameOrId
 * @param {string} [channelCode] - e.g. 'workflow'. If omitted, picks primary.
 * @returns {{ lineUserId: string|null, channelCode: string|null, liffId: string|null }}
 */
export async function resolveLineAccount(employeeNameOrId, channelCode) {
  if (!employeeNameOrId) return { lineUserId: null, channelCode: null, liffId: null }

  const isId = typeof employeeNameOrId === 'number'
  let query = supabase.from('v_employee_line_resolved').select('*')

  if (isId) query = query.eq('employee_id', employeeNameOrId)
  else query = query.eq('employee_name', employeeNameOrId)

  if (channelCode) query = query.eq('channel_code', channelCode)
  else query = query.order('is_primary', { ascending: false })

  const { data: account } = await query.limit(1).maybeSingle()

  if (account?.line_user_id) {
    return {
      lineUserId: account.line_user_id,
      channelCode: account.channel_code,
      liffId: account.liff_id || LIFF_ID,
    }
  }

  return { lineUserId: null, channelCode: null, liffId: LIFF_ID }
}

/**
 * Send a LINE push message via Supabase Edge Function.
 * If channelCode is provided, the Edge Function routes to the correct channel token.
 */
async function sendLinePush(lineUserId, messages, channelCode) {
  if (!lineUserId) return { ok: false, reason: 'no_user_id' }

  try {
    const { data, error } = await supabase.functions.invoke('line-push', {
      body: { to: lineUserId, messages, channelCode },
    })
    if (error) throw error
    await logMessage(lineUserId, messages, data?.ok ? 'sent' : 'failed', channelCode)
    return data || { ok: false }
  } catch (err) {
    console.error('[LINE] Push error:', err)
    await logMessage(lineUserId, messages, 'failed', channelCode)
    return { ok: false, error: err.message }
  }
}

/**
 * LIFF task page URL — uses the channel's LIFF ID if available.
 */
// LINE rejects LIFF URIs with sub-paths, so we pass the SPA route via ?to=...
// and let the LIFF's LiffDeepLinkRedirect forward to /tasks (preserving ?task=<id>).
export function getLiffTaskUrl(taskId, liffId) {
  const lid = liffId || LIFF_ID
  if (!lid) {
    // Dev / preview fallback — local SPA build under /liff/...
    return taskId
      ? `${window.location.origin}/liff/tasks?task=${taskId}`
      : `${window.location.origin}/liff/tasks`
  }
  const toParam = taskId
    ? `/tasks?task=${taskId}`
    : `/tasks`
  return `https://liff.line.me/${lid}?to=${encodeURIComponent(toParam)}`
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
    ? `https://liff.line.me/${lid}?to=${encodeURIComponent('/my-schedule')}`
    : `${window.location.origin}/liff/my-schedule`

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
 * 代班邀請 — Web 端發出後推 LINE flex card 給所有候選人
 * @param {Array<{empId:number, name:string}>} candidates
 * @param {{ shift_date:string, shift_label:string, absent_emp_name:string, reason?:string }} info
 */
export async function notifyCoverInvitationFromWeb(candidates, info) {
  const liffBase = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : ''
  const url = liffBase ? `${liffBase}?to=${encodeURIComponent('/cover-invitations')}` : '/cover-invitations'
  const bubble = {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#f59e0b', paddingAll: '14px',
      contents: [{ type: 'text', text: '🆘 代班邀請', color: '#ffffff', weight: 'bold', size: 'md' }],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
      contents: [
        { type: 'text', text: `${info.shift_date} ${info.shift_label}`, weight: 'bold', size: 'lg', wrap: true },
        { type: 'text', text: `代 ${info.absent_emp_name || '同事'} 的班`, size: 'sm', color: '#8c8c8c', wrap: true },
        ...(info.reason ? [{ type: 'text', text: info.reason, size: 'xs', color: '#a8a8a8', wrap: true, margin: 'sm' }] : []),
        { type: 'text', text: '先搶先贏！', size: 'xs', color: '#f59e0b', weight: 'bold', margin: 'sm' },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '12px',
      contents: [{
        type: 'button',
        action: { type: 'uri', label: '我可以接', uri: url },
        style: 'primary', color: '#f59e0b', height: 'sm',
      }],
    },
  }
  for (const c of candidates) {
    const account = await resolveLineAccount(c.empId || c.name)
    if (!account.lineUserId) continue
    await sendLinePush(account.lineUserId, [{ type: 'flex', altText: '代班邀請', contents: bubble }], account.channelCode)
  }
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
