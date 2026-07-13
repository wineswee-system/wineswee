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

const PRIO_COLOR = { '高': '#dc2626', '中': '#f59e0b', '低': '#10b981', default: '#6b7280' }
const PRIO_BG    = { '高': '#FEF2F2', '中': '#FEF3C7', '低': '#D1FAE5', default: '#F3F4F6' }

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

// ─── Typed task notification ──────────────────────────────────────────────────
// All body sections are data-driven — fields render only when their data exists.
//
// extras.formBindings   Array<{ label, required_status?, description?, form_id? }>
// extras.approvalRequired  boolean
// extras.completedTasks    Array<string>  (names of completed predecessor tasks)
// instanceName (3rd arg)   → subtitle in header (workflow / project context)

function _detectTaskType(extras) {
  if (extras.formBindings?.length > 0) return 'forms'
  if (extras.approvalRequired) return 'approval'
  return 'normal'
}

const _TASK_STYLES = {
  normal:   { bg: LC.brand,    icon: '📋', label: '任務通知' },
  forms:    { bg: LC.brand,    icon: '📋', label: '任務通知（含表單）' },
  approval: { bg: LC.approval, icon: '🔏', label: '簽核任務' },
}

function _buildTypedHeader(type, instanceName, isOverdue) {
  const s = _TASK_STYLES[type] || _TASK_STYLES.normal
  const mainRow = [
    { type: 'text', text: `${s.icon} ${s.label}`, color: '#FFFFFF', weight: 'bold', size: 'md', flex: 1 },
    ...(isOverdue ? [{
      type: 'box', layout: 'vertical', backgroundColor: LC.danger, cornerRadius: '4px',
      paddingTop: '3px', paddingBottom: '3px', paddingStart: '8px', paddingEnd: '8px',
      contents: [{ type: 'text', text: '⚠️ 逾期', color: '#ffffff', size: 'xxs', weight: 'bold' }],
    }] : []),
  ]
  const rows = [{ type: 'box', layout: 'horizontal', alignItems: 'center', contents: mainRow }]
  if (instanceName?.trim()) {
    rows.push({ type: 'text', text: instanceName.trim(), color: '#FFFFFFCC', size: 'xs', margin: 'xs', wrap: true, maxLines: 1 })
  }
  return { type: 'box', layout: 'vertical', backgroundColor: s.bg, paddingAll: '14px', contents: rows }
}

const ATTACH_ICON = (name) => {
  const ext = name?.split('.').pop()?.toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️'
  if (ext === 'pdf') return '📕'
  if (['xlsx', 'xls', 'csv'].includes(ext)) return '📊'
  if (['docx', 'doc'].includes(ext)) return '📝'
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️'
  return '📄'
}

function _buildTypedBody(taskTitle, taskId, assigneeName, department, store, dueDate, description, notes, isOverdue, extras = {}) {
  const shortId = taskId ? `#${String(taskId).slice(0, 6)}` : null
  const dueLabel = dueDate
    ? new Date(dueDate).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '未設定'
  const infoLine = [assigneeName, department, store].filter(Boolean).join('  |  ')

  const contents = [
    ...(shortId ? [{ type: 'text', text: shortId, size: 'xxs', color: '#CCCCCC' }] : []),
    {
      type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center',
      contents: [
        { type: 'text', text: taskTitle, weight: 'bold', size: 'sm', wrap: true, flex: 1, color: '#111827' },
        ...(extras.priority ? [{
          type: 'box', layout: 'vertical', flex: 0,
          backgroundColor: PRIO_BG[extras.priority] || PRIO_BG.default,
          cornerRadius: '10px', paddingTop: '2px', paddingBottom: '2px', paddingStart: '8px', paddingEnd: '8px',
          contents: [{ type: 'text', text: extras.priority, size: 'xxs', color: PRIO_COLOR[extras.priority] || PRIO_COLOR.default, weight: 'bold' }],
        }] : []),
      ],
    },
    {
      type: 'text', text: `到期：${dueLabel}`, size: 'sm', wrap: true,
      color: isOverdue ? LC.danger : LC.muted,
      weight: isOverdue ? 'bold' : 'regular',
    },
    { type: 'text', text: infoLine, size: 'sm', color: LC.muted, wrap: true },
  ]

  if (extras.approvalRequired) {
    contents.push({ type: 'separator', margin: 'sm' })
    contents.push({
      type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'sm', paddingAll: '8px', cornerRadius: '4px',
      contents: [
        { type: 'text', text: '⚠️', size: 'sm', flex: 0 },
        { type: 'text', text: '完成後需主管簽核', size: 'sm', color: LC.approval, flex: 1, wrap: true, weight: 'bold' },
      ],
    })
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

  const attachments = Array.isArray(extras.attachments) ? extras.attachments : []
  if (attachments.length > 0) {
    contents.push({ type: 'separator', margin: 'sm' })
    contents.push({ type: 'text', text: `📎 附件（${attachments.length}）`, size: 'sm', color: LC.dark, weight: 'bold', margin: 'sm' })
    for (const a of attachments.slice(0, 5)) {
      contents.push({
        type: 'box', layout: 'horizontal', spacing: 'sm',
        contents: [
          { type: 'text', text: ATTACH_ICON(a.file_name), size: 'sm', flex: 0 },
          { type: 'text', text: a.file_name || '附件', size: 'sm', color: LC.dark, wrap: true, flex: 1 },
        ],
      })
    }
    if (attachments.length > 5) {
      contents.push({ type: 'text', text: `...共 ${attachments.length} 個附件`, size: 'xs', color: LC.soft, margin: 'xs' })
    }
  }

  const formBindings = Array.isArray(extras.formBindings) ? extras.formBindings : []
  if (formBindings.length > 0) {
    contents.push({ type: 'separator', margin: 'sm' })
    contents.push({ type: 'text', text: `📋 需完成表單（${formBindings.length}）`, size: 'sm', color: LC.dark, weight: 'bold', margin: 'sm' })
    for (const b of formBindings) {
      contents.push({
        type: 'box', layout: 'horizontal', spacing: 'sm',
        contents: [
          { type: 'text', text: '•', size: 'sm', color: LC.brand, flex: 0 },
          { type: 'text', text: b.label || '未命名表單', size: 'sm', color: LC.dark, wrap: true, flex: 1 },
        ],
      })
    }
  }

  const completedTasks = Array.isArray(extras.completedTasks) ? extras.completedTasks : []
  if (completedTasks.length > 0) {
    contents.push({ type: 'separator', margin: 'sm' })
    contents.push({ type: 'text', text: `✅ 前置已完成：${completedTasks.join('、')}`, size: 'xs', color: LC.soft, wrap: true, margin: 'sm' })
  }

  return contents
}

function _buildTypedFooter(liffUrl, taskId, approvalRequired, approvalUrl, formBindings) {
  const hasForms = Array.isArray(formBindings) && formBindings.length > 0
  if (hasForms && !approvalRequired) {
    return {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
      contents: [{
        type: 'button', style: 'primary', height: 'sm', color: LC.brand,
        action: { type: 'uri', label: '查看任務 / 填表單', uri: liffUrl },
      }],
    }
  }
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

// One carousel bubble per form — renders whatever fields are present on the binding
function _buildFormBubble(binding, index, total, instanceName, liffUrl) {
  const bodyContents = [
    { type: 'text', text: binding.label || '未命名表單', weight: 'bold', size: 'sm', wrap: true },
  ]
  if (binding.required_status) {
    bodyContents.push({ type: 'text', text: `需達狀態：${binding.required_status}`, size: 'sm', color: LC.muted })
  }
  if (binding.description && String(binding.description).trim()) {
    bodyContents.push({ type: 'separator', margin: 'sm' })
    bodyContents.push({ type: 'text', text: String(binding.description).trim(), size: 'sm', color: LC.dark, wrap: true, margin: 'sm' })
  }

  const formUrl = binding.form_id
    ? `${liffUrl}${liffUrl.includes('?') ? '&' : '?'}form=${binding.form_id}`
    : liffUrl

  const headerRows = [
    { type: 'text', text: `📄 表單 ${index + 1} / ${total}`, color: '#FFFFFF', weight: 'bold', size: 'sm' },
  ]
  if (instanceName?.trim()) {
    headerRows.push({ type: 'text', text: instanceName.trim(), color: '#FFFFFFCC', size: 'xs', margin: 'xs', wrap: true, maxLines: 1 })
  }

  return {
    type: 'bubble', size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: LC.brand, paddingAll: '14px',
      contents: headerRows,
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
      contents: bodyContents,
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '14px',
      contents: [{
        type: 'button', style: 'primary', height: 'sm', color: LC.brand,
        action: { type: 'uri', label: '填寫表單', uri: formUrl },
      }],
    },
  }
}

/**
 * Notify a task assignee via LINE.
 * @param {string} assigneeName
 * @param {string} taskTitle
 * @param {string} instanceName  - workflow / project name shown as subtitle in header
 * @param {number} taskId
 * @param {object} [extras] - { dueDate, description, notes, store, department,
 *                              approvalRequired, formBindings, completedTasks }
 *   formBindings:   Array<{ label, required_status?, description?, form_id? }>
 *   completedTasks: Array<string>  names of completed predecessor tasks (cascade)
 */
export async function notifyTaskAssignee(assigneeName, taskTitle, instanceName, taskId, extras = {}) {
  if (!assigneeName) return { ok: false, reason: 'no_assignee' }

  const account = await resolveLineAccount(assigneeName)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const { dueDate, description, notes, store, approvalRequired, formBindings } = extras
  const department = extras.department || await resolveEmployeeDept(assigneeName)

  // Fetch attachments from DB if not provided and taskId is available
  let attachments = Array.isArray(extras.attachments) ? extras.attachments : null
  if (attachments === null && taskId) {
    const { data } = await supabase
      .from('task_attachments')
      .select('file_name, storage_path')
      .eq('task_id', taskId)
      .order('id')
    attachments = data || []
  }
  attachments = attachments || []
  const isOverdue = !!(dueDate && new Date(dueDate) < new Date())
  const liffUrl = getLiffTaskUrl(taskId, account.liffId)
  const approvalUrl = approvalRequired ? buildLiffTaskUrl(taskId, account.liffId, 'request_approval') : null

  const type = _detectTaskType(extras)
  const typeSuffix = type === 'forms' ? '（含表單）' : type === 'approval' ? '（待簽核）' : ''

  const taskBubble = {
    type: 'bubble', size: 'kilo',
    header: _buildTypedHeader(type, instanceName, isOverdue),
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
      contents: _buildTypedBody(taskTitle, taskId, assigneeName, department, store, dueDate, description, notes, isOverdue, { ...extras, attachments }),
    },
    footer: _buildTypedFooter(liffUrl, taskId, approvalRequired, approvalUrl, formBindings),
  }

  const hasForms = Array.isArray(formBindings) && formBindings.length > 0
  const contents = hasForms
    ? {
        type: 'carousel',
        contents: [
          taskBubble,
          ...formBindings.map((b, i) => _buildFormBubble(b, i, formBindings.length, instanceName, liffUrl)),
        ],
      }
    : taskBubble

  const messages = [{
    type: 'flex',
    altText: `${isOverdue ? '⚠️ [逾期] ' : ''}📋 任務通知${typeSuffix}：${taskTitle}`,
    contents,
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
 * 通知某人：他被安排到某專案（彙總卡，一人一則）。
 * @param {string} assigneeName
 * @param {object} project - { id, name, dept, store }
 * @param {number} taskCount - 他在此專案的任務數
 */
export async function notifyProjectMember(assigneeName, project, taskCount) {
  if (!assigneeName || !project) return { ok: false, reason: 'no_input' }
  const account = await resolveLineAccount(assigneeName)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }
  const liffUrl = getLiffTaskUrl(null, account.liffId) // LIFF 我的任務
  const sub = [project.dept, project.store].filter(Boolean).join(' · ')
  const messages = [{
    type: 'flex',
    altText: `📁 你被安排到專案：${project.name}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: LC.brand, paddingAll: '14px',
        contents: [{ type: 'text', text: '📁 專案任務安排', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: [
          { type: 'text', text: project.name, weight: 'bold', size: 'sm', wrap: true, color: '#111827' },
          ...(sub ? [{ type: 'text', text: sub, size: 'xs', color: '#6B7280', wrap: true }] : []),
          { type: 'box', layout: 'baseline', margin: 'md', contents: [
            { type: 'text', text: '👤 你被安排', size: 'xs', color: '#6B7280', flex: 0 },
            { type: 'text', text: `${taskCount} 項任務`, size: 'sm', weight: 'bold', color: LC.brand, margin: 'sm' },
          ] },
          { type: 'text', text: '請前往查看並開始處理', size: 'xs', color: '#6B7280', margin: 'sm', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{ type: 'button', style: 'primary', color: LC.brand, height: 'sm',
          action: { type: 'uri', label: '前往查看', uri: liffUrl } }],
      },
    },
  }]
  return sendLinePush(account.lineUserId, messages)
}

/**
 * 專案成員通知（聚合）：專案內每個被指派任務的人各發一則彙總，一人一則、去重。
 * 聚合+去重+站內通知由 RPC notify_project_members(SECURITY DEFINER)處理（繞 RLS），
 * 此處只依回傳名單逐人發 LINE 彙總卡。
 * @param {object} project - { id, name, store }
 * @param {object} [opts]  - { force } force=true 強制重發（手動按鈕用）
 */
export async function notifyProjectMembers(project, { force = false } = {}) {
  if (!project?.id) return { notified: 0, reason: 'no_project' }
  const { data, error } = await supabase.rpc('notify_project_members', {
    p_project_id: project.id, p_force: force,
  })
  if (error || !Array.isArray(data)) return { notified: 0, error }
  // 站內通知已由 RPC 寫入；逐人發 LINE 彙總卡
  for (const row of data) {
    await notifyProjectMember(row.employee_name, project, row.task_count).catch(() => {})
  }
  return { notified: data.length }
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
    const headerContents = [
      { type: 'text', text: task.isOverdue ? '⚠️ 任務逾期' : '⏰ 今日到期', color: '#ffffff', weight: 'bold', size: 'sm' },
      ...(task.instanceName ? [{ type: 'text', text: task.instanceName, color: '#FFFFFFCC', size: 'xs', margin: 'xs', wrap: true, maxLines: 1 }] : []),
    ]
    return {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        backgroundColor: task.isOverdue ? LC.danger : LC.warning,
        contents: headerContents,
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: buildTaskBody(task.title, assigneeName, department, task.store, '', task.due_date, task.description, task.notes, task.isOverdue),
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
 * @param {{
 *   candidateName, round, scheduledAt, location, candidateId?,
 *   jobTitle?, jobDept?, source?, phone?, email?,
 *   resumeUrl?, candidateStage?, note?, interviewSeq?, previousScore?
 * }} info
 */
export async function notifyInterviewScheduled(interviewerEmployeeId, info) {
  if (!interviewerEmployeeId) return { ok: false, reason: 'no_interviewer_id' }
  const account = await resolveLineAccount(interviewerEmployeeId)
  if (!account.lineUserId) return { ok: false, reason: 'no_line_user_id' }

  const {
    candidateName, round, scheduledAt, location, candidateId,
    jobTitle, jobDept, source, phone, email,
    resumeUrl, candidateStage, note, interviewSeq, previousScore,
  } = info

  const fmtDt = (iso) => iso
    ? new Date(iso).toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short',
      })
    : '—'

  // 兩欄 row：label 左固定，value 右可換行
  const row = (label, value, opts = {}) => ({
    type: 'box', layout: 'horizontal', spacing: 'sm', margin: opts.margin || 'sm',
    contents: [
      { type: 'text', text: label, size: 'xs', color: LC.muted, flex: 2 },
      { type: 'text', text: value || '—', size: 'sm',
        color: opts.color || LC.dark, flex: 5, wrap: true,
        weight: opts.weight || 'regular' },
    ],
  })

  const bodyContents = []

  // ── 標題列：候選人 + 階段 ──
  bodyContents.push({
    type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'sm',
    contents: [
      { type: 'text', text: candidateName || '—', weight: 'bold', size: 'lg', color: LC.dark, flex: 1, wrap: true },
      ...(candidateStage ? [{
        type: 'text', text: candidateStage, size: 'xxs', color: LC.brand, weight: 'bold',
        align: 'end', flex: 0,
      }] : []),
    ],
  })
  if (interviewSeq) {
    bodyContents.push({ type: 'text', text: `第 ${interviewSeq} 次面試`, size: 'xs', color: LC.soft, margin: 'xs' })
  }
  bodyContents.push({ type: 'separator', margin: 'md' })

  // ── 面試資訊 ──
  bodyContents.push(row('輪次', round))
  bodyContents.push(row('時間', fmtDt(scheduledAt), { color: LC.brand, weight: 'bold' }))
  if (location) bodyContents.push(row('地點', location))

  // ── 職缺資訊 ──
  if (jobTitle || jobDept || source) {
    bodyContents.push({ type: 'separator', margin: 'md' })
    if (jobTitle) bodyContents.push(row('職缺', jobTitle, { weight: 'bold' }))
    if (jobDept)  bodyContents.push(row('部門', jobDept))
    if (source)   bodyContents.push(row('來源', source))
  }

  // ── 聯絡資訊 ──
  if (phone || email) {
    bodyContents.push({ type: 'separator', margin: 'md' })
    if (phone) bodyContents.push(row('電話', phone))
    if (email) bodyContents.push(row('Email', email))
  }

  // ── 前次評分 ──
  if (previousScore != null && previousScore !== '') {
    bodyContents.push({ type: 'separator', margin: 'md' })
    bodyContents.push(row('前次評分', String(previousScore), { color: LC.brand, weight: 'bold' }))
  }

  // ── 安排者備註 ──
  if (note) {
    bodyContents.push({ type: 'separator', margin: 'md' })
    bodyContents.push({
      type: 'box', layout: 'vertical', paddingAll: '8px', cornerRadius: '6px',
      backgroundColor: '#F9FAFB',
      contents: [
        { type: 'text', text: '📝 安排者備註', size: 'xxs', color: LC.muted, weight: 'bold' },
        { type: 'text', text: note, size: 'sm', color: LC.dark, wrap: true, margin: 'xs' },
      ],
    })
  }

  bodyContents.push({
    type: 'text', text: '請準時出席並準備面試評核',
    size: 'xxs', color: LC.muted, wrap: true, margin: 'md', align: 'center',
  })

  // ── footer ──
  const lid = account.liffId || LIFF_ID
  const candidateLiffUrl = (() => {
    const path = candidateId ? `/recruitment?candidate=${candidateId}` : '/recruitment'
    if (!lid) return `${(typeof window !== 'undefined' ? window.location.origin : '')}/liff${path}`
    return `https://liff.line.me/${lid}?to=${encodeURIComponent(path)}`
  })()

  const footerButtons = [{
    type: 'button',
    action: { type: 'uri', label: '查看應徵資料', uri: candidateLiffUrl },
    style: 'primary', color: LC.brand, height: 'sm',
  }]
  if (resumeUrl) {
    footerButtons.push({
      type: 'button',
      action: { type: 'uri', label: '📄 看履歷', uri: resumeUrl },
      style: 'secondary', height: 'sm',
    })
  }
  if (phone) {
    footerButtons.push({
      type: 'button',
      action: { type: 'uri', label: `📞 ${phone}`, uri: `tel:${phone.replace(/[^\d+]/g, '')}` },
      style: 'secondary', height: 'sm',
    })
  }

  const messages = [{
    type: 'flex',
    altText: `📅 面試通知：${candidateName} ${round}${jobTitle ? ' (' + jobTitle + ')' : ''}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: LC.brand, paddingAll: '14px',
        contents: [
          { type: 'text', text: '📅 面試通知', color: '#ffffff', weight: 'bold', size: 'md' },
          ...(jobTitle ? [{ type: 'text', text: jobTitle, color: '#FFFFFFCC', size: 'xs', margin: 'xs' }] : []),
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        contents: bodyContents,
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: footerButtons,
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
