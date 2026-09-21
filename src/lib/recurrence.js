import { supabase } from './supabase'

// Minimal RRULE subset. Examples:
//   FREQ=DAILY
//   FREQ=DAILY;INTERVAL=2
//   FREQ=WEEKLY;BYDAY=MO,WE,FR
//   FREQ=MONTHLY;BYMONTHDAY=15
//   FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

export function parseRule(rule) {
  if (!rule) return null
  const parts = Object.fromEntries(
    rule.split(';').map(kv => kv.split('=').map(s => s.trim())),
  )
  return {
    freq: parts.FREQ,
    interval: Number(parts.INTERVAL || 1),
    byday: parts.BYDAY ? parts.BYDAY.split(',') : null,
    bymonthday: parts.BYMONTHDAY ? Number(parts.BYMONTHDAY) : null,
    bymonth: parts.BYMONTH ? Number(parts.BYMONTH) : null,
  }
}

export function describeRule(rule) {
  const r = parseRule(rule)
  if (!r) return ''
  const every = r.interval > 1 ? `每 ${r.interval} ` : '每'
  switch (r.freq) {
    case 'DAILY':   return `${every}天`
    case 'WEEKLY':  return r.byday
      ? `${every}週 ${r.byday.map(d => ({ SU: '日', MO: '一', TU: '二', WE: '三', TH: '四', FR: '五', SA: '六' }[d])).join('、')}`
      : `${every}週`
    case 'MONTHLY': return r.bymonthday ? `${every}月 ${r.bymonthday} 日` : `${every}月`
    case 'YEARLY':  return `${every}年 ${r.bymonth || ''}/${r.bymonthday || ''}`
    default: return rule
  }
}

function addDays(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + n); return d
}

export function nextOccurrence(rule, fromDate) {
  const r = parseRule(rule); if (!r) return null
  const base = new Date(fromDate || new Date())
  base.setHours(0, 0, 0, 0)

  if (r.freq === 'DAILY') return addDays(base, r.interval)

  if (r.freq === 'WEEKLY') {
    if (!r.byday) return addDays(base, 7 * r.interval)
    const wanted = r.byday.map(d => DAY_CODES.indexOf(d))
    for (let i = 1; i <= 7 * r.interval; i++) {
      const d = addDays(base, i)
      if (wanted.includes(d.getDay())) return d
    }
  }

  if (r.freq === 'MONTHLY') {
    const d = new Date(base)
    d.setMonth(d.getMonth() + r.interval)
    if (r.bymonthday) d.setDate(r.bymonthday)
    return d
  }

  if (r.freq === 'YEARLY') {
    const d = new Date(base)
    d.setFullYear(d.getFullYear() + r.interval)
    if (r.bymonth) d.setMonth(r.bymonth - 1)
    if (r.bymonthday) d.setDate(r.bymonthday)
    return d
  }
  return null
}

export function listOccurrences(rule, fromDate, count = 5) {
  const out = []
  let cur = fromDate || new Date()
  for (let i = 0; i < count; i++) {
    const nxt = nextOccurrence(rule, cur)
    if (!nxt) break
    out.push(nxt)
    cur = nxt
  }
  return out
}

function toISODate(d) { return d.toISOString().slice(0, 10) }

// Materialize next instance when a recurring task is completed.
// Pattern: task with recurrence_rule is a "template"; closing it spawns the next instance.
export async function materializeNextInstance(taskId) {
  const { data: parent } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle()
  if (!parent?.recurrence_rule) return null

  const basis = parent.due_date ? new Date(parent.due_date) : new Date()
  const next = nextOccurrence(parent.recurrence_rule, basis)
  if (!next) return null
  if (parent.recurrence_until && next > new Date(parent.recurrence_until)) return null

  const { id, created_at, completed_at, status, updated_at, ...rest } = parent  // eslint-disable-line no-unused-vars
  const payload = {
    ...rest,
    recurrence_parent_id: parent.recurrence_parent_id || parent.id,
    status: '未開始',
    due_date: toISODate(next),
    completed_at: null,
    last_materialized_at: new Date().toISOString(),
  }

  const { data: created } = await supabase.from('tasks').insert(payload).select().single()
  return created
}
