import DOMPurify from 'dompurify'
import { supabase } from './supabase'
import { resolveLineAccount, getLiffTaskUrl } from './lineNotify'

// Matches @員工姓名 or @username — CJK, latin, underscore, hyphen allowed.
// Stops at whitespace, punctuation (besides . _ -), or end of input.
const MENTION_RE = /@([\p{L}\p{N}_\-.]+)/gu

export function extractMentionNames(text) {
  if (!text) return []
  const names = new Set()
  let m
  while ((m = MENTION_RE.exec(text)) !== null) names.add(m[1])
  return [...names]
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function renderMentionsHTML(text, employees = []) {
  if (!text) return ''
  const escaped = text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const raw = escaped.replace(MENTION_RE, (match, name) => {
    const safeName = escapeHtml(name)
    const emp = employees.find(e => e.name === name)
    const color = emp ? 'var(--accent-cyan)' : 'var(--text-muted)'
    const bg = emp ? 'color-mix(in srgb, var(--accent-cyan) 15%, transparent)' : 'transparent'
    return `<span style="color:${color};background:${bg};padding:1px 4px;border-radius:3px;font-weight:600">@${safeName}</span>`
  })
  // Defense-in-depth: pass through DOMPurify even though the string is already manually escaped
  return DOMPurify.sanitize(raw, { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['style'] })
}

async function resolveMentionsToEmployees(names) {
  if (!names.length) return []
  const { data } = await supabase
    .from('employees')
    .select('id, name, email')
    .in('name', names)
    .eq('status', '在職')
  return data || []
}

export async function processCommentMentions({ taskId, commentId, content, authorName, taskTitle }) {
  const names = extractMentionNames(content)
  if (!names.length) return { mentioned: [], notified: 0 }

  const employees = await resolveMentionsToEmployees(names)
  if (!employees.length) return { mentioned: [], notified: 0 }

  const rows = employees.map(e => ({
    task_id: taskId,
    comment_id: commentId,
    mentioned_employee_id: e.id,
    mentioned_name: e.name,
    mentioned_by: authorName || '系統',
  }))
  const { data: inserted } = await supabase.from('task_mentions').insert(rows).select()

  let notified = 0
  for (const e of employees) {
    const ok = await sendMentionNotification({
      employeeName: e.name,
      taskId,
      taskTitle,
      mentionedBy: authorName || '系統',
      snippet: content.slice(0, 120),
    })
    if (ok) {
      const rec = (inserted || []).find(r => r.mentioned_employee_id === e.id)
      if (rec) {
        await supabase.from('task_mentions')
          .update({ notified: true, notified_at: new Date().toISOString() })
          .eq('id', rec.id)
      }
      notified++
    }
  }

  return { mentioned: employees, notified }
}

async function sendMentionNotification({ employeeName, taskId, taskTitle, mentionedBy, snippet }) {
  const account = await resolveLineAccount(employeeName)
  if (!account.lineUserId) return false

  const liffUrl = getLiffTaskUrl(taskId, account.liffId)
  const messages = [{
    type: 'flex',
    altText: `💬 ${mentionedBy} 提到你：${taskTitle}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#f59e0b', paddingAll: '14px',
        contents: [{ type: 'text', text: '💬 你被提到了', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        contents: [
          { type: 'text', text: taskTitle, weight: 'bold', size: 'md', wrap: true },
          { type: 'text', text: `${mentionedBy}：${snippet}`, size: 'sm', color: '#475569', wrap: true, margin: 'sm' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{
          type: 'button', style: 'primary', color: '#f59e0b', height: 'sm',
          action: { type: 'uri', label: '查看留言', uri: liffUrl },
        }],
      },
    },
  }]

  try {
    const { data, error } = await supabase.functions.invoke('line-push', {
      body: { to: account.lineUserId, messages },
    })
    if (error) throw error
    return !!data?.ok
  } catch {
    return false
  }
}

export async function notifyWatchers(taskId, { taskTitle, action, actor }) {
  const { data: watchers } = await supabase
    .from('task_watchers')
    .select('employee_id, employees:employee_id(name)')
    .eq('task_id', taskId)

  if (!watchers?.length) return 0

  let sent = 0
  for (const w of watchers) {
    const name = w.employees?.name
    if (!name || name === actor) continue
    const account = await resolveLineAccount(name)
    if (!account.lineUserId) continue

    const liffUrl = getLiffTaskUrl(taskId, account.liffId)
    const messages = [{
      type: 'text',
      text: `🔔 關注的任務有更新\n「${taskTitle}」\n${actor || '系統'}：${action}\n${liffUrl}`,
    }]
    try {
      const { data } = await supabase.functions.invoke('line-push', {
        body: { to: account.lineUserId, messages },
      })
      if (data?.ok) sent++
    } catch { /* swallow */ }
  }
  return sent
}
