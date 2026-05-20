import { supabase } from './supabase'
import { logger } from './logger'

const LIFF_ID = import.meta.env.VITE_LIFF_ID

// Hex colors for LINE Flex Message payloads — cannot use CSS vars in external API JSON
const LC = {
  brand:    '#06b6d4',
  success:  '#10b981',
  warning:  '#f59e0b',
  danger:   '#ef4444',
  approval: '#8b5cf6',
  muted:    '#666666',
  dark:     '#444444',
  soft:     '#8c8c8c',
}

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

/**
 * Drain the quiet-hours queue (normally handled by the 00:00 UTC daily cron).
 * Can be called manually as an escape hatch.
 */
export async function drainQuietQueue() {
  supabase.functions.invoke('task-reminder', { body: { mode: 'drain_quiet_queue' } }).catch(() => {})
}

// Taiwan = UTC+8. Quiet hours: 20:00–07:59 Taiwan = 12:00–23:59 UTC.
function isQuietHours() {
  return new Date().getUTCHours() >= 12
}

// Next 8am Taiwan = next 00:00 UTC
function nextMorning8amUTC() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString()
}

async function queueForMorning(lineUserId, messages) {
  try {
    await supabase.from('notification_quiet_queue').insert({
      line_user_id: lineUserId,
      messages,
      send_after: nextMorning8amUTC(),
    })
    await logMessage(lineUserId, messages, 'queued_quiet')
    return { ok: true, queued: true }
  } catch (err) {
    logger.error('[LINE] Quiet queue error', { module: 'lineNotify', err: err?.message })
    return { ok: false, error: err.message }
  }
}

async function sendLinePush(lineUserId, messages) {
  if (!lineUserId) return { ok: false, reason: 'no_user_id' }

  if (isQuietHours()) return queueForMorning(lineUserId, messages)

  try {
    const { data, error } = await supabase.functions.invoke('line-push', {
      body: { to: lineUserId, messages },
    })
    if (error) throw error
    await logMessage(lineUserId, messages, data?.ok ? 'sent' : 'failed')
    return data || { ok: false }
  } catch (err) {
    logger.error('[LINE] Push error', { module: 'lineNotify', err: err?.message })
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

function buildLiffTaskUrl(taskId, liffId, action) {
  const lid = liffId || LIFF_ID
  const toParam = taskId
    ? `/tasks?task=${taskId}${action ? `&action=${action}` : ''}`
    : `/tasks${action ? `?action=${action}` : ''}`
  if (!lid) return `${window.location.origin}/liff${toParam}`
  return `https://liff.line.me/${lid}?to=${encodeURIComponent(toParam)}`
}

async function resolveEmployeeDept(name) {
  if (!name) return ''
  const { data } = await supabase.from('employees').select('dept').eq('name', name).maybeSingle()
  return data?.dept || ''
}

function buildTaskBody(taskTitle, assigneeName, department, store, instanceName, dueDate, description, notes, isOverdue) {
  const dueLabel = dueDate
    ? new Date(dueDate).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '未設定'
  const infoLine = [assigneeName, department, store].filter(Boolean).join('  |  ')

  const contents = [
    { type: 'text', text: taskTitle, weight: 'bold', size: 'sm', wrap: true },
    {
      type: 'text', text: `到期：${dueLabel}`, size: 'sm', wrap: true,
      color: isOverdue ? LC.danger : LC.muted,
      weight: isOverdue ? 'bold' : 'regular',
    },
    { type: 'text', text: infoLine, size: 'sm', color: LC.muted, wrap: true },
  ]
  if (instanceName) {
    contents.push({ type: 'text', text: `流程：${instanceName}`, size: 'sm', color: LC.muted })
  }
  if (description && String(description).trim()) {
    contents.push({ type: 'separator', margin: 'sm' })
    contents.push({ type: 'text', text: String(description).trim(), size: 'sm', color: LC.dark, wrap: true, margin: 'sm' })
  }
  if (notes && String(notes).trim()) {
    contents.push({ type: 'separator', margin: 'sm' })
    contents.push({ type: 'text', text: '📌 備註', size: 'sm', color: LC.soft, margin: 'sm' })
    contents.push({ type: 'text', text: String(notes).trim(), size: 'sm', color: LC.dark, wrap: true })
  }
  return contents
}

function buildTaskFooter(liffUrl, taskId, approvalRequired, approvalUrl) {
  const primaryAction = approvalRequired
    ? { type: 'uri', label: '請求簽核', uri: approvalUrl }
    : { type: 'postback', label: '回報完成', data: `action=complete&type=task&id=${taskId}`, displayText: '回報完成' }
  return {
    type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
    contents: [
      {
        type: 'button', style: 'primary', height: 'sm',
        color: approvalRequired ? LC.warning : LC.success,
        action: primaryAction,
      },
      {
        type: 'button', style: 'secondary', height: 'sm',
        action: { type: 'uri', label: '查看任務', uri: liffUrl },
      },
    ],
  }
}

/**
 * Notify a task assignee via LINE.
 * @param {string} assigneeName
 * @param {string} taskTitle
 * @param {string} instanceName
 * @param {number} taskId
 * @param {object} [extras] - { dueDate, description, notes, store, department, approvalRequired }
 */
export async function notifyTaskAssignee(assigneeName, taskTitle, instanceName, taskId, extras = {}) {
  if (!assigneeName) return { ok: false, reason: 'no_assignee' }

  const account = await resolveLineAccount(assigneeName)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const { dueDate, description, notes, store, approvalRequired } = extras
  const department = extras.department || await resolveEmployeeDept(assigneeName)
  const isOverdue = !!(dueDate && new Date(dueDate) < new Date())
  const liffUrl = getLiffTaskUrl(taskId, account.liffId)
  const approvalUrl = approvalRequired ? buildLiffTaskUrl(taskId, account.liffId, 'request_approval') : null

  const messages = [{
    type: 'flex',
    altText: `${isOverdue ? '⚠️ [逾期] ' : ''}📋 任務通知：${taskTitle}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: LC.brand, paddingAll: '14px',
        contents: [{
          type: 'box', layout: 'horizontal', alignItems: 'center',
          contents: [
            { type: 'text', text: '📋 任務通知', color: '#FFFFFF', weight: 'bold', size: 'md', flex: 1 },
            ...(isOverdue ? [{
              type: 'box', layout: 'vertical', backgroundColor: LC.danger, cornerRadius: '4px',
              paddingTop: '3px', paddingBottom: '3px', paddingStart: '8px', paddingEnd: '8px',
              contents: [{ type: 'text', text: '⚠️ 逾期', color: '#ffffff', size: 'xxs', weight: 'bold' }],
            }] : []),
          ],
        }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: buildTaskBody(taskTitle, assigneeName, department, store, instanceName, dueDate, description, notes, isOverdue),
      },
      footer: buildTaskFooter(liffUrl, taskId, approvalRequired, approvalUrl),
    },
  }]

  return sendLinePush(account.lineUserId, messages)
}

/**
 * Notify assignee that their task has started (status → 進行中).
 * @param {object} [extras] - { dueDate, description, notes, store, department, approvalRequired }
 */
export async function notifyTaskStarted(assigneeName, taskTitle, instanceName, taskId, extras = {}) {
  if (!assigneeName) return { ok: false, reason: 'no_assignee' }

  const account = await resolveLineAccount(assigneeName)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const { dueDate, description, notes, store, approvalRequired } = extras
  const department = extras.department || await resolveEmployeeDept(assigneeName)
  const isOverdue = !!(dueDate && new Date(dueDate) < new Date())
  const liffUrl = getLiffTaskUrl(taskId, account.liffId)
  const approvalUrl = approvalRequired ? buildLiffTaskUrl(taskId, account.liffId, 'request_approval') : null

  const messages = [{
    type: 'flex',
    altText: `🚀 任務開始：${taskTitle}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: LC.brand, paddingAll: '14px',
        contents: [{ type: 'text', text: '🚀 任務開始', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: buildTaskBody(taskTitle, assigneeName, department, store, instanceName, dueDate, description, notes, isOverdue),
      },
      footer: buildTaskFooter(liffUrl, taskId, approvalRequired, approvalUrl),
    },
  }]

  return sendLinePush(account.lineUserId, messages)
}

/**
 * Send a single carousel push to one assignee covering all their due/overdue tasks.
 * @param {string} assigneeName
 * @param {Array} tasks - each: { id, title, due_date, description, notes, store, isOverdue, approvalRequired, instanceName? }
 */
export async function notifyTaskDailySummary(assigneeName, tasks) {
  if (!assigneeName || !tasks?.length) return { ok: false, reason: 'no_tasks' }

  const account = await resolveLineAccount(assigneeName)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const department = await resolveEmployeeDept(assigneeName)
  const overdueCount = tasks.filter(t => t.isOverdue).length
  const dueCount = tasks.length - overdueCount

  const parts = []
  if (overdueCount) parts.push(`逾期 ${overdueCount} 個`)
  if (dueCount) parts.push(`今日到期 ${dueCount} 個`)
  const altText = `📋 待處理任務提醒：共 ${tasks.length} 筆${parts.length ? `（${parts.join('、')}）` : ''}`

  const bubbles = tasks.slice(0, 10).map(task => {
    const liffUrl = getLiffTaskUrl(task.id, account.liffId)
    const approvalUrl = task.approvalRequired ? buildLiffTaskUrl(task.id, account.liffId, 'request_approval') : null
    return {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        backgroundColor: task.isOverdue ? LC.danger : LC.warning,
        contents: [{ type: 'text', text: task.isOverdue ? '⚠️ 任務逾期' : '⏰ 今日到期', color: '#ffffff', weight: 'bold', size: 'sm' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: buildTaskBody(task.title, assigneeName, department, task.store, task.instanceName || '', task.due_date, task.description, task.notes, task.isOverdue),
      },
      footer: buildTaskFooter(liffUrl, task.id, task.approvalRequired, approvalUrl),
    }
  })

  const messages = [{
    type: 'flex',
    altText,
    contents: { type: 'carousel', contents: bubbles },
  }]

  return sendLinePush(account.lineUserId, messages)
}

/**
 * Notify for approval request.
 * @param {object} [extras] - { category, store, chainName, approvedSteps: [{name, actedAt}], pendingSteps: [{name}] }
 */
export async function notifyApproval(approverName, taskTitle, stepLabel, extras = {}) {
  if (!approverName) return { ok: false }

  const account = await resolveLineAccount(approverName)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const liffUrl = getLiffTaskUrl(null, account.liffId)
  const { category, store, department, workflow, project, chainName, description, approvedSteps, pendingSteps } = extras

  const fmtTime = (iso) => iso
    ? new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''

  const infoLine = [category, store, department].filter(Boolean).join('  ·  ')
  const projectLine = [workflow, project].filter(Boolean).join('  ·  ')

  const bodyContents = [
    { type: 'text', text: taskTitle, weight: 'bold', size: 'sm', wrap: true },
    { type: 'text', text: `等待您的審核：${stepLabel || ''}`, size: 'sm', color: LC.soft, wrap: true },
  ]
  if (infoLine) {
    bodyContents.push({ type: 'text', text: infoLine, size: 'sm', color: LC.muted, margin: 'sm' })
  }
  if (projectLine) {
    bodyContents.push({ type: 'text', text: projectLine, size: 'sm', color: LC.muted })
  }
  if (chainName) {
    bodyContents.push({ type: 'text', text: chainName, size: 'sm', color: LC.muted })
  }
  if (description?.trim()) {
    bodyContents.push({ type: 'text', text: description.trim(), size: 'sm', color: LC.dark, wrap: true, margin: 'xs' })
  }
  if (approvedSteps && approvedSteps.length > 0) {
    bodyContents.push({ type: 'separator', margin: 'md' })
    bodyContents.push({ type: 'text', text: '已核准', size: 'sm', color: LC.soft, weight: 'bold', margin: 'sm' })
    for (const s of approvedSteps) {
      bodyContents.push({
        type: 'box', layout: 'horizontal', margin: 'xs',
        contents: [
          { type: 'text', text: '✅', size: 'sm', flex: 0 },
          { type: 'text', text: s.name || '—', size: 'sm', color: LC.success, weight: 'bold', flex: 3, margin: 'sm' },
          { type: 'text', text: fmtTime(s.actedAt), size: 'sm', color: LC.soft, align: 'end', flex: 4 },
        ],
      })
    }
  }
  if (pendingSteps && pendingSteps.length > 0) {
    bodyContents.push({ type: 'separator', margin: 'md' })
    bodyContents.push({ type: 'text', text: '排隊待審', size: 'sm', color: LC.soft, weight: 'bold', margin: 'sm' })
    for (const s of pendingSteps) {
      bodyContents.push({
        type: 'box', layout: 'horizontal', margin: 'xs',
        contents: [
          { type: 'text', text: '○', size: 'sm', flex: 0, color: LC.soft },
          { type: 'text', text: s.name || '—', size: 'sm', color: LC.soft, flex: 3, margin: 'sm' },
        ],
      })
    }
  }

  const messages = [{
    type: 'flex',
    altText: `🔏 簽核請求：${taskTitle}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: LC.approval, paddingAll: '14px',
        contents: [{ type: 'text', text: '🔏 簽核請求', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: bodyContents,
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: '前往審核', uri: liffUrl },
          style: 'primary', color: LC.approval, height: 'sm',
        }],
      },
    },
  }]

  return sendLinePush(account.lineUserId, messages)
}

/**
 * Notify task due reminder.
 * @param {object} [extras] - { taskId, description, notes, store, department, approvalRequired, instanceName }
 */
export async function notifyTaskDue(assigneeName, taskTitle, dueDate, extras = {}) {
  if (!assigneeName) return { ok: false }

  const account = await resolveLineAccount(assigneeName)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const { taskId, description, notes, store, approvalRequired, instanceName } = extras
  const department = extras.department || await resolveEmployeeDept(assigneeName)
  const isOverdue = !!(dueDate && new Date(dueDate) < new Date())
  const liffUrl = getLiffTaskUrl(taskId, account.liffId)
  const approvalUrl = approvalRequired ? buildLiffTaskUrl(taskId, account.liffId, 'request_approval') : null

  const messages = [{
    type: 'flex',
    altText: `⏰ 任務即將到期：${taskTitle}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: LC.warning, paddingAll: '14px',
        contents: [{ type: 'text', text: '⏰ 任務到期提醒', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: buildTaskBody(taskTitle, assigneeName, department, store, instanceName, dueDate, description, notes, isOverdue),
      },
      footer: buildTaskFooter(liffUrl, taskId, approvalRequired, approvalUrl),
    },
  }]

  return sendLinePush(account.lineUserId, messages)
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
        type: 'box', layout: 'vertical', backgroundColor: LC.brand, paddingAll: '14px',
        contents: [{ type: 'text', text: '📋 班表通知', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        contents: [
          { type: 'text', text: `${dateRange} 班表已發布`, weight: 'bold', size: 'sm', wrap: true },
          { type: 'separator', margin: 'md' },
          ...lines.map(line => ({ type: 'text', text: line, size: 'sm', color: LC.dark, margin: 'sm' })),
          ...(assignments.length > 7 ? [{ type: 'text', text: `...共 ${assignments.length} 天`, size: 'sm', color: LC.soft, margin: 'sm' }] : []),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: '查看完整班表', uri: liffUrl },
          style: 'primary', color: LC.brand, height: 'sm',
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
        backgroundColor: isApproved ? LC.success : LC.danger,
        paddingAll: '14px',
        contents: [
          { type: 'text', text: isApproved ? '✅ 任務通過' : '🔄 任務退回', color: '#ffffff', weight: 'bold', size: 'md' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: `任務「${taskTitle}」${isApproved ? '已通過審核' : '被退回'}`, weight: 'bold', size: 'sm', wrap: true },
          ...(isApproved
            ? []
            : [{ type: 'text', text: `原因：${notes || '（未填）'}`, size: 'sm', color: LC.muted, wrap: true, margin: 'md' }]),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: '查看任務', uri: liffUrl },
          style: 'primary', color: isApproved ? LC.success : LC.danger, height: 'sm',
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
      type: 'box', layout: 'vertical', backgroundColor: LC.warning, paddingAll: '14px',
      contents: [{ type: 'text', text: '🆘 代班邀請', color: '#ffffff', weight: 'bold', size: 'md' }],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
      contents: [
        { type: 'text', text: `${info.shift_date} ${info.shift_label}`, weight: 'bold', size: 'sm', wrap: true },
        { type: 'text', text: `代 ${info.absent_emp_name || '同事'} 的班`, size: 'sm', color: LC.soft, wrap: true },
        ...(info.reason ? [{ type: 'text', text: info.reason, size: 'sm', color: LC.soft, wrap: true, margin: 'sm' }] : []),
        { type: 'text', text: '先搶先贏！', size: 'sm', color: LC.warning, weight: 'bold', margin: 'sm' },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '12px',
      contents: [{
        type: 'button',
        action: { type: 'uri', label: '我可以接', uri: url },
        style: 'primary', color: LC.warning, height: 'sm',
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
 * 面試通知 — 推給被安排為面試官的員工
 * @param {number} interviewerEmployeeId
 * @param {{ candidateName, round, scheduledAt, location }} info
 */
export async function notifyInterviewScheduled(interviewerEmployeeId, info) {
  if (!interviewerEmployeeId) return { ok: false, reason: 'no_interviewer_id' }
  const account = await resolveLineAccount(interviewerEmployeeId)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const { candidateName, round, scheduledAt, location } = info
  const fmtDt = (iso) => iso
    ? new Date(iso).toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short',
      })
    : '—'

  const bodyContents = [
    { type: 'text', text: `候選人：${candidateName || '—'}`, weight: 'bold', size: 'sm', wrap: true },
    { type: 'text', text: `輪次：${round || '—'}`, size: 'sm', color: LC.soft, margin: 'sm' },
    { type: 'text', text: `時間：${fmtDt(scheduledAt)}`, size: 'sm', color: LC.dark, margin: 'sm' },
  ]
  if (location) {
    bodyContents.push({ type: 'text', text: `地點：${location}`, size: 'sm', color: LC.dark, margin: 'xs' })
  }
  bodyContents.push({
    type: 'text', text: '您已被安排為此場面試的面試官，請準時出席。',
    size: 'xs', color: LC.muted, wrap: true, margin: 'md',
  })

  const messages = [{
    type: 'flex',
    altText: `📅 面試通知：${candidateName} ${round}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: LC.brand, paddingAll: '14px',
        contents: [{ type: 'text', text: '📅 面試通知', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        contents: bodyContents,
      },
    },
  }]

  return sendLinePush(account.lineUserId, messages)
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
