import { useState, useEffect } from 'react'
import { Phone, Video, CheckSquare, Mail, UserPlus, Plus, Check, Clock, MapPin, MessageCircle, Share2, Headphones, FileText } from 'lucide-react'
import { getCRMActivities, createCRMActivity, updateCRMActivity } from '../../../lib/db'
import Modal, { Field } from '../../../components/Modal'

import { toast } from '../../../lib/toast'
const TYPES = [
  { value: 'call', label: '電話', icon: Phone, color: 'var(--accent-green)' },
  { value: 'meeting', label: '會議', icon: Video, color: 'var(--accent-blue)' },
  { value: 'visit', label: '到訪', icon: MapPin, color: 'var(--accent-orange)' },
  { value: 'email', label: '信件', icon: Mail, color: 'var(--accent-cyan)' },
  { value: 'line', label: 'LINE', icon: MessageCircle, color: '#06C755' },
  { value: 'chat', label: '線上客服', icon: Headphones, color: 'var(--accent-purple)' },
  { value: 'social', label: '社群互動', icon: Share2, color: '#E4405F' },
  { value: 'task', label: '任務', icon: CheckSquare, color: 'var(--accent-yellow, #f59e0b)' },
  { value: 'follow_up', label: '跟進', icon: UserPlus, color: 'var(--accent-purple)' },
  { value: 'note', label: '備註', icon: FileText, color: 'var(--text-secondary)' },
]

const STATUSES = [
  { value: 'planned', label: '計劃中' },
  { value: 'in_progress', label: '進行中' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
]

const SALES_REPS = ['王經理', '李業務', '陳主任', '張專員', '林業務']

function getTypeMeta(type) {
  return TYPES.find(t => t.value === type) || TYPES[0]
}

/**
 * Reusable activity timeline for embedding in Customer360, Pipeline, Service, etc.
 * Props: entityType, entityId
 */
export default function ActivityTimeline({ entityType, entityId }) {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ type: 'call', subject: '', assignee: '', due_date: '', description: '' })

  useEffect(() => {
    if (!entityType || !entityId) return
    getCRMActivities({ entity_type: entityType, entity_id: entityId })
      .then(({ data }) => setActivities(data || []))
      .finally(() => setLoading(false))
  }, [entityType, entityId])

  const handleAdd = async () => {
    if (!form.subject) return
    const { data, error } = await createCRMActivity({
      ...form,
      entity_type: entityType,
      entity_id: entityId,
      due_date: form.due_date || null,
      status: 'planned',
    })
    if (error) { toast.error('新增失敗'); return }
    setActivities(prev => [data, ...prev])
    setShowForm(false)
    setForm({ type: 'call', subject: '', assignee: '', due_date: '', description: '' })
  }

  const markComplete = async (id) => {
    const { data } = await updateCRMActivity(id, { status: 'completed', completed_at: new Date().toISOString() })
    if (data) setActivities(prev => prev.map(a => a.id === id ? data : a))
  }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>載入中...</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>活動紀錄 ({activities.length})</span>
        <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => setShowForm(true)}>
          <Plus size={12} /> 新增
        </button>
      </div>

      {activities.length === 0 && !showForm && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>尚無活動紀錄</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {activities.map(a => {
          const meta = getTypeMeta(a.type)
          const Icon = meta.icon
          const done = a.status === 'completed'
          return (
            <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 8px', borderRadius: 8, background: done ? 'transparent' : 'var(--glass-light)', opacity: done ? 0.6 : 1 }}>
              <Icon size={14} style={{ color: meta.color, marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, textDecoration: done ? 'line-through' : 'none' }}>{a.subject}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
                  {a.assignee && <span>{a.assignee}</span>}
                  {a.due_date && <span><Clock size={9} style={{ verticalAlign: -1 }} /> {new Date(a.due_date).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })}</span>}
                </div>
              </div>
              {!done && a.status !== 'cancelled' && (
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-green)', padding: 2 }} onClick={() => markComplete(a.id)} title="完成">
                  <Check size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {showForm && (
        <Modal title="新增活動" onClose={() => setShowForm(false)} onSubmit={handleAdd}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="類型">
              <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="負責人">
              <select className="form-input" style={{ width: '100%' }} value={form.assignee} onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))}>
                <option value="">未指派</option>
                {SALES_REPS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </div>
          <Field label="主題" required>
            <input className="form-input" style={{ width: '100%' }} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="例：跟進客戶" />
          </Field>
          <Field label="到期日">
            <input className="form-input" type="datetime-local" style={{ width: '100%' }} value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
