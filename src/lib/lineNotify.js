import { supabase } from './supabase'

const LIFF_ID = import.meta.env.VITE_LIFF_ID

/**
 * Resolve a LINE user ID for an employee via employee_line_accounts.
 * @param {string|number} employeeNameOrId
 * @returns {{ lineUserId: string|null, liffId: string|null }}
 */
export async function resolveLineAccount(employeeNameOrId) {
  if (!employeeNameOrId) return { lineUserId: null, liffId: null }

  const isId = typeof employeeNameOrId === 'number'
  const col = isId ? 'employee_id' : 'employee_name'
  const { data: rows } = await supabase
    .from('v_employee_line_resolved')
    .select('*')
    .eq(col, employeeNameOrId)

  if (!rows?.length) return { lineUserId: null, liffId: LIFF_ID }

  const account =
    rows.find(r => r.channel_code === 'workflow' && r.line_user_id) ||
    rows.find(r => r.is_primary && r.line_user_id) ||
    rows.find(r => r.line_user_id)

  if (account?.line_user_id) {
    return { lineUserId: account.line_user_id, liffId: account.liff_id || LIFF_ID }
  }

  return { lineUserId: null, liffId: LIFF_ID }
}

/**
 * Drain the task_pending_notifications queue immediately.
 * Call this after any action that may insert into that table
 * (task status change, workflow deploy, cascade step trigger).
 * Fire-and-forget — errors are swallowed so they never block the UI.
 */
export async function drainNotificationQueue() {
  supabase.functions.invoke('task-reminder', { body: { mode: 'drain_queue' } }).catch(() => {})
}

async function sendLinePush(lineUserId, messages) {
  if (!lineUserId) return { ok: false, reason: 'no_user_id' }

  try {
    const { data, error } = await supabase.functions.invoke('line-push', {
      body: { to: lineUserId, messages },
    })
    if (error) throw error
    await logMessage(lineUserId, messages, data?.ok ? 'sent' : 'failed')
    return data || { ok: false }
  } catch (err) {
    console.error('[LINE] Push error:', err)
    await logMessage(lineUserId, messages, 'failed')
    return { ok: false, error: err.message }
  }
}

// LINE rejects LIFF URIs with sub-paths, so we pass the SPA route via ?to=...
// and let the LIFF's LiffDeepLinkRedirect forward to /tasks (preserving ?task=<id>).
export function getLiffTaskUrl(taskId, liffId) {
  const lid = liffId || LIFF_ID
  if (!lid) {
    return taskId
      ? `${window.location.origin}/liff/tasks?task=${taskId}`
      : `${window.location.origin}/liff/tasks`
  }
  const toParam = taskId ? `/tasks?task=${taskId}` : `/tasks`
  return `https://liff.line.me/${lid}?to=${encodeURIComponent(toParam)}`
}

/**
 * Notify a task assignee via LINE.
 * @param {string} assigneeName
 * @param {string} taskTitle
 * @param {string} instanceName
 * @param {number} taskId
 * @param {object} [extras] - { dueDate, description, notes, store }
 */
export async function notifyTaskAssignee(assigneeName, taskTitle, instanceName, taskId, extras = {}) {
  if (!assigneeName) return { ok: false, reason: 'no_assignee' }

  const account = await resolveLineAccount(assigneeName)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const liffUrl = getLiffTaskUrl(taskId, account.liffId)
  const { dueDate, description, notes, store } = extras
  const dueLabel = dueDate
    ? new Date(dueDate).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '未設定'
  const isOverdue = !!(dueDate && new Date(dueDate) < new Date())

  const bodyContents = [
    { type: 'text', text: taskTitle, weight: 'bold', size: 'md', wrap: true },
    { type: 'text', text: `到期：${dueLabel}`, size: 'xs', color: isOverdue ? '#ef4444' : '#666666', weight: isOverdue ? 'bold' : 'regular' },
    { type: 'text', text: `負責人：${assigneeName}`, size: 'xs', color: '#666666' },
  ]
  if (instanceName) {
    bodyContents.push({ type: 'text', text: `流程：${instanceName}`, size: 'xs', color: '#666666' })
  }
  if (description && String(description).trim()) {
    bodyContents.push({ type: 'separator', margin: 'sm' })
    bodyContents.push({ type: 'text', text: String(description).trim(), size: 'sm', color: '#444444', wrap: true, margin: 'sm' })
  }
  if (notes && String(notes).trim()) {
    bodyContents.push({ type: 'separator', margin: 'sm' })
    bodyContents.push({ type: 'text', text: '📌 備註', size: 'xxs', color: '#8c8c8c', margin: 'sm' })
    bodyContents.push({ type: 'text', text: String(notes).trim(), size: 'sm', color: '#444444', wrap: true })
  }
  if (store) {
    bodyContents.push({ type: 'text', text: `門市：${store}`, size: 'xs', color: '#666666', margin: 'sm' })
  }

  const messages = [{
    type: 'flex',
    altText: `${isOverdue ? '⚠️ [逾期] ' : ''}📋 任務通知：${taskTitle}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#06b6d4', paddingAll: '14px',
        contents: [
          {
            type: 'box', layout: 'horizontal', alignItems: 'center',
            contents: [
              { type: 'text', text: '📋 任務通知', color: '#FFFFFF', weight: 'bold', size: 'md', flex: 1 },
              ...(isOverdue ? [{
                type: 'box', layout: 'vertical', backgroundColor: '#ef4444', cornerRadius: '4px',
                paddingTop: '3px', paddingBottom: '3px', paddingStart: '8px', paddingEnd: '8px',
                contents: [{ type: 'text', text: '⚠️ 逾期', color: '#ffffff', size: 'xxs', weight: 'bold' }],
              }] : []),
            ],
          },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: bodyContents,
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: [{
          type: 'button', style: 'primary', color: '#06b6d4', height: 'sm',
          action: { type: 'uri', label: '📋 查看任務', uri: liffUrl },
        }],
      },
    },
  }]

  return sendLinePush(account.lineUserId, messages)
}

/**
 * Notify assignee that their task has started (status → 進行中).
 */
export async function notifyTaskStarted(assigneeName, taskTitle, instanceName, taskId) {
  if (!assigneeName) return { ok: false, reason: 'no_assignee' }

  const account = await resolveLineAccount(assigneeName)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const liffUrl = getLiffTaskUrl(taskId, account.liffId)

  const messages = [{
    type: 'flex',
    altText: `🚀 任務開始：${taskTitle}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#10b981', paddingAll: '14px',
        contents: [{ type: 'text', text: '🚀 任務開始', color: '#ffffff', weight: 'bold', size: 'md' }],
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
          style: 'primary', color: '#10b981', height: 'sm',
        }],
      },
    },
  }]

  return sendLinePush(account.lineUserId, messages)
}

/**
 * Notify for approval request.
 */
export async function notifyApproval(approverName, taskTitle, stepLabel) {
  if (!approverName) return { ok: false }

  const account = await resolveLineAccount(approverName)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const liffUrl = getLiffTaskUrl(null, account.liffId)

  const messages = [{
    type: 'flex',
    altText: `🔏 簽核請求：${taskTitle}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#8b5cf6', paddingAll: '14px',
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

  return sendLinePush(account.lineUserId, messages)
}

/**
 * Notify task due reminder.
 */
export async function notifyTaskDue(assigneeName, taskTitle, dueDate) {
  if (!assigneeName) return { ok: false }

  const account = await resolveLineAccount(assigneeName)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  return sendLinePush(account.lineUserId, [{
    type: 'text',
    text: `⏰ 提醒：「${taskTitle}」即將到期\n截止日期：${dueDate}\n\n請儘速處理！`,
  }])
}

/**
 * Notify employee about published schedule via LINE.
 */
export async function notifySchedulePublished(employeeName, dateRange, assignments) {
  if (!employeeName) return { ok: false, reason: 'no_employee' }

  const account = await resolveLineAccount(employeeName)
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
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#06b6d4', paddingAll: '14px',
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

  return sendLinePush(account.lineUserId, messages)
}

/**
 * Send to a specific LINE user ID (bypass employee lookup).
 */
export async function sendDirectPush(lineUserId, messages) {
  return sendLinePush(lineUserId, messages)
}

/**
 * 任務確認結果通知執行人（主管按完核准/駁回後推給原任務負責人）
 */
export async function notifyTaskConfirmationResult(assigneeName, taskTitle, action, notes, taskId) {
  if (!assigneeName) return { ok: false, reason: 'no_assignee' }

  const account = await resolveLineAccount(assigneeName)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const isApproved = action === 'approved'
  const liffUrl = getLiffTaskUrl(taskId, account.liffId)

  const messages = [{
    type: 'flex',
    altText: isApproved ? `✅ 任務通過：${taskTitle}` : `🔄 任務退回：${taskTitle}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: isApproved ? '#10b981' : '#ef4444',
        paddingAll: '14px',
        contents: [
          { type: 'text', text: isApproved ? '✅ 任務通過' : '🔄 任務退回', color: '#ffffff', weight: 'bold', size: 'md' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: `任務「${taskTitle}」${isApproved ? '已通過審核' : '被退回'}`, weight: 'bold', size: 'md', wrap: true },
          ...(isApproved
            ? []
            : [{ type: 'text', text: `原因：${notes || '（未填）'}`, size: 'sm', color: '#666666', wrap: true, margin: 'md' }]),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: '查看任務', uri: liffUrl },
          style: 'primary', color: isApproved ? '#10b981' : '#ef4444', height: 'sm',
        }],
      },
    },
  }]

  return sendLinePush(account.lineUserId, messages)
}

/**
 * 代班邀請 — Web 端發出後推 LINE flex card 給所有候選人
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
    await sendLinePush(account.lineUserId, [{ type: 'flex', altText: '代班邀請', contents: bubble }])
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
