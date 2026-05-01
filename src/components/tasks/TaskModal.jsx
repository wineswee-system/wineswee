import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Repeat, Calendar, Trash2, Activity as ActivityIcon, Copy } from 'lucide-react'
import {
  updateTask, deleteTask,
  getTaskComments, createTaskComment,
} from '../../lib/db'
import { processCommentMentions, notifyWatchers } from '../../lib/mentions'
import { describeRule, materializeNextInstance } from '../../lib/recurrence'
import TaskWatchers from './TaskWatchers'
import { empLabel } from '../../lib/empLabel'
import TaskActivity from './TaskActivity'
import { TaskCustomFieldsView } from './CustomFieldsEditor'
import MentionInput, { MentionText } from './MentionInput'

const STATUS_LIST = ['未開始', '進行中', '已完成', '已擱置']
const PRIORITY_LIST = ['低', '中', '高']

const RECURRENCE_PRESETS = [
  { value: '', label: '不重複' },
  { value: 'FREQ=DAILY', label: '每天' },
  { value: 'FREQ=WEEKLY', label: '每週' },
  { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: '工作日' },
  { value: 'FREQ=MONTHLY', label: '每月' },
]

export default function TaskModal({ task, employees = [], sections = [], currentUser, onClose, onChange, onDelete, onDuplicate }) {
  const [form, setForm] = useState({
    title: '', status: '未開始', priority: '中',
    assignee: '', assignee_id: null,
    due_date: '', section_id: '', recurrence_rule: '', description: '',
  })
  const [comments, setComments] = useState([])
  const [commentDraft, setCommentDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState('detail')
  const [activityRefresh, setActivityRefresh] = useState(0)

  useEffect(() => {
    if (!task) return
    const resolvedId = task.assignee_id
      || (task.assignee ? employees.find(e => e.name === task.assignee)?.id : null)
      || null
    setForm({
      title: task.title || '',
      status: task.status || '未開始',
      priority: task.priority || '中',
      assignee: task.assignee || '',
      assignee_id: resolvedId,
      due_date: task.due_date || '',
      section_id: task.section_id || '',
      recurrence_rule: task.recurrence_rule || '',
      description: task.description || '',
    })
    getTaskComments(task.id).then(({ data }) => setComments(data || []))
  }, [task?.id, employees])

  if (!task) return null

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const saveField = async (patch) => {
    const prevStatus = task.status
    const { data } = await updateTask(task.id, patch)
    if (!data) return

    // Recurrence: closing a recurring task spawns the next
    if (patch.status === '已完成' && prevStatus !== '已完成' && data.recurrence_rule) {
      await materializeNextInstance(task.id)
    }

    // Notify watchers
    const desc = Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(', ')
    notifyWatchers(task.id, { taskTitle: data.title, action: desc, actor: currentUser?.name }).catch(() => {})
    setActivityRefresh(k => k + 1)
    onChange?.(data)
  }

  const submitComment = async () => {
    const content = commentDraft.trim()
    if (!content) return
    setSending(true)
    try {
      const { data: c } = await createTaskComment({
        task_id: task.id,
        author: currentUser?.name || '系統',
        content,
        source: 'web',
      })
      if (c) {
        setComments(prev => [...prev, c])
        setCommentDraft('')
        // @mention fan-out
        processCommentMentions({
          taskId: task.id, commentId: c.id,
          content, authorName: currentUser?.name || '系統',
          taskTitle: task.title,
        }).catch(() => {})
        notifyWatchers(task.id, { taskTitle: task.title, action: `留言：${content.slice(0, 60)}`, actor: currentUser?.name }).catch(() => {})
        setActivityRefresh(k => k + 1)
      }
    } finally { setSending(false) }
  }

  const handleDelete = async () => {
    if (!confirm(`刪除任務「${task.title}」？`)) return
    await deleteTask(task.id)
    onDelete?.(task.id)
    onClose?.()
  }

  const overlay = (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'var(--bg-modal-overlay)', zIndex: 999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(640px, 100%)', maxHeight: '90vh',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
        borderRadius: 16, zIndex: 1000,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: 'var(--shadow-xl)',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            value={form.title}
            onChange={e => set('title', e.target.value)}
            onBlur={() => form.title !== task.title && saveField({ title: form.title })}
            style={{ flex: 1, fontSize: 15, fontWeight: 700, border: 'none', background: 'transparent', color: 'var(--text-primary)', outline: 'none' }}
          />
          {onDuplicate && (
            <button
              onClick={async () => { await onDuplicate(task); onClose?.() }}
              className="btn btn-secondary"
              title="複製此任務"
              style={{ padding: '4px 8px', color: 'var(--accent-cyan)' }}>
              <Copy size={14} />
            </button>
          )}
          <button onClick={handleDelete} className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }}><Trash2 size={14} /></button>
          <button onClick={onClose} className="btn btn-secondary" style={{ padding: '4px 8px' }}><X size={14} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', paddingLeft: 8 }}>
          {[
            { k: 'detail', label: '詳情' },
            { k: 'comments', label: `留言 (${comments.length})` },
            { k: 'activity', label: '活動' },
          ].map(t => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              style={{
                padding: '10px 14px', border: 'none', background: 'transparent',
                borderBottom: tab === t.k ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                color: tab === t.k ? 'var(--accent-cyan)' : 'var(--text-muted)',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >{t.label}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {tab === 'detail' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>狀態</label>
                  <select
                    className="form-input" style={{ width: '100%', fontSize: 12 }}
                    value={form.status}
                    onChange={e => { set('status', e.target.value); saveField({ status: e.target.value, completed_at: e.target.value === '已完成' ? new Date().toISOString() : null }) }}
                  >
                    {STATUS_LIST.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>優先級</label>
                  <select
                    className="form-input" style={{ width: '100%', fontSize: 12 }}
                    value={form.priority}
                    onChange={e => { set('priority', e.target.value); saveField({ priority: e.target.value }) }}
                  >
                    {PRIORITY_LIST.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>負責人</label>
                  <select
                    className="form-input" style={{ width: '100%', fontSize: 12 }}
                    value={form.assignee_id ? String(form.assignee_id) : (form.assignee ? `name:${form.assignee}` : '')}
                    onChange={e => {
                      const v = e.target.value
                      if (v.startsWith('name:')) return
                      const emp = employees.find(x => String(x.id) === v)
                      set('assignee_id', emp?.id || null); set('assignee', emp?.name || '')
                      saveField({ assignee_id: emp?.id || null, assignee: emp?.name || null })
                    }}
                  >
                    <option value="">未指派</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{empLabel(e)}</option>)}
                    {form.assignee && !form.assignee_id && !employees.some(e => e.name === form.assignee) && (
                      <option value={`name:${form.assignee}`} disabled>{form.assignee}（非員工）</option>
                    )}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>截止日</label>
                  <input
                    type="date" className="form-input" style={{ width: '100%', fontSize: 12 }}
                    value={form.due_date}
                    onChange={e => { set('due_date', e.target.value); saveField({ due_date: e.target.value || null }) }}
                  />
                </div>
                {sections.length > 0 && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>所在欄位</label>
                    <select
                      className="form-input" style={{ width: '100%', fontSize: 12 }}
                      value={form.section_id || ''}
                      onChange={e => { set('section_id', e.target.value || null); saveField({ section_id: e.target.value ? Number(e.target.value) : null }) }}
                    >
                      <option value="">（無）</option>
                      {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Recurrence */}
              <div style={{ padding: 10, background: 'var(--glass-light)', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                  <Repeat size={12} /> 週期性
                </div>
                <select
                  className="form-input" style={{ width: '100%', fontSize: 12 }}
                  value={form.recurrence_rule}
                  onChange={e => { set('recurrence_rule', e.target.value); saveField({ recurrence_rule: e.target.value || null }) }}
                >
                  {RECURRENCE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                {form.recurrence_rule && (
                  <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 4, fontWeight: 600 }}>
                    <Calendar size={10} style={{ display: 'inline', marginRight: 3 }} />
                    {describeRule(form.recurrence_rule)} · 完成後自動建立下次
                  </div>
                )}
              </div>

              {/* Description */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>說明</label>
                <textarea
                  className="form-input"
                  style={{ width: '100%', minHeight: 60, fontSize: 13, resize: 'vertical' }}
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  onBlur={() => form.description !== task.description && saveField({ description: form.description })}
                />
              </div>

              {/* Watchers */}
              <TaskWatchers
                taskId={task.id} employees={employees} currentUser={currentUser}
                onChange={() => setActivityRefresh(k => k + 1)}
              />

              {/* Custom fields */}
              {task.project_id && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>自訂欄位</div>
                  <TaskCustomFieldsView taskId={task.id} projectId={task.project_id} employees={employees} />
                </div>
              )}
            </div>
          )}

          {tab === 'comments' && (
            <div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {comments.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>尚無留言</div>
                ) : comments.map(c => (
                  <div key={c.id} style={{ padding: 10, background: 'var(--glass-light)', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <strong style={{ fontSize: 12, color: 'var(--accent-cyan)' }}>{c.author}</strong>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {c.source === 'line' && '📱 '}{c.created_at?.slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      <MentionText content={c.content} employees={employees} />
                    </div>
                  </div>
                ))}
              </div>

              <MentionInput
                value={commentDraft} onChange={setCommentDraft}
                employees={employees}
                onSubmit={submitComment} disabled={sending}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-primary" onClick={submitComment} disabled={sending || !commentDraft.trim()}>
                  {sending ? '送出中...' : '送出 (Ctrl+Enter)'}
                </button>
              </div>
            </div>
          )}

          {tab === 'activity' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 12 }}>
                <ActivityIcon size={14} /> 活動紀錄
              </div>
              <TaskActivity taskId={task.id} refreshKey={activityRefresh} />
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
