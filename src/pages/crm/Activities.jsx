import { useState, useEffect, useCallback } from 'react'
import { Plus, Phone, Video, CheckSquare, Mail, UserPlus, Calendar, Clock, Check, X, Filter, ChevronLeft, ChevronRight, MapPin, MessageCircle, Share2, Headphones, FileText } from 'lucide-react'
import { getCRMActivities, createCRMActivity, updateCRMActivity, deleteCRMActivity } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { getEventBus } from '../../lib/events/index.js'

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

const emptyForm = {
  type: 'call', subject: '', description: '', assignee: '',
  due_date: '', status: 'planned', duration_minutes: '', outcome: '',
  entity_type: '', entity_id: '',
}

function getTypeMeta(type) {
  return TYPES.find(t => t.value === type) || TYPES[0]
}

function isOverdue(activity) {
  if (activity.status === 'completed' || activity.status === 'cancelled') return false
  if (!activity.due_date) return false
  return new Date(activity.due_date) < new Date()
}

function getWeekDays(baseDate) {
  const start = new Date(baseDate)
  start.setDate(start.getDate() - start.getDay()) // Sunday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return d
  })
}

export default function Activities() {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('list') // list, calendar
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [calendarDate, setCalendarDate] = useState(new Date())

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true)
    const filters = {}
    if (typeFilter) filters.type = typeFilter
    if (statusFilter) filters.status = statusFilter
    const { data, error: err } = await getCRMActivities(filters)
    if (err) { setError('載入失敗'); setLoading(false); return }
    setActivities(data || [])
    setLoading(false)
  }, [typeFilter, statusFilter])

  useEffect(() => { load() }, [load])

  const handleSubmit = async () => {
    if (!form.subject || saving) return
    setSaving(true)
    try {
      const payload = {
        ...form,
        due_date: form.due_date || null,
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
        entity_type: form.entity_type || null,
        entity_id: form.entity_id ? Number(form.entity_id) : null,
      }
      if (editingId) {
        const { data, error: err } = await updateCRMActivity(editingId, payload)
        if (err) throw err
        setActivities(prev => prev.map(a => a.id === editingId ? data : a))
      } else {
        const { data, error: err } = await createCRMActivity(payload)
        if (err) throw err
        setActivities(prev => [data, ...prev])
        const bus = getEventBus()
        await bus.publish('crm.activity.created', {
          activity_id: String(data.id),
          type: data.type,
          subject: data.subject,
          assignee: data.assignee || '',
          due_date: data.due_date || null,
          entity_type: data.entity_type || null,
          entity_id: data.entity_id ? String(data.entity_id) : null,
        })
      }
      closeModal()
    } catch (err) {
      alert('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  const closeModal = () => {
    setShowModal(false)
    setForm(emptyForm)
    setEditingId(null)
  }

  const editActivity = (a) => {
    setForm({
      type: a.type, subject: a.subject, description: a.description || '',
      assignee: a.assignee || '', due_date: a.due_date ? a.due_date.slice(0, 16) : '',
      status: a.status, duration_minutes: a.duration_minutes || '', outcome: a.outcome || '',
      entity_type: a.entity_type || '', entity_id: a.entity_id || '',
    })
    setEditingId(a.id)
    setShowModal(true)
  }

  const completeActivity = async (id) => {
    const { data, error: err } = await updateCRMActivity(id, { status: 'completed', completed_at: new Date().toISOString() })
    if (err) { alert('操作失敗'); return }
    setActivities(prev => prev.map(a => a.id === id ? data : a))
  }

  const deleteActivity = async (id) => {
    if (!confirm('確定要刪除此活動？')) return
    await deleteCRMActivity(id)
    setActivities(prev => prev.filter(a => a.id !== id))
  }

  // Stats
  const today = new Date().toISOString().slice(0, 10)
  const overdue = activities.filter(isOverdue).length
  const todayCount = activities.filter(a => a.due_date && a.due_date.slice(0, 10) === today && a.status !== 'completed' && a.status !== 'cancelled').length
  const completedCount = activities.filter(a => a.status === 'completed').length
  const plannedCount = activities.filter(a => a.status === 'planned' || a.status === 'in_progress').length

  const filterBtn = (active) => ({
    padding: '4px 12px', borderRadius: 7, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 11, fontWeight: 500,
  })

  if (loading) return <LoadingSpinner />

  // Calendar week view
  const weekDays = getWeekDays(calendarDate)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><Calendar size={20} /></span> 活動與排程</h2>
            <p>Activities — 記錄所有客戶接觸點：電話、會議、到訪、LINE、Email、社群等</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`btn ${view === 'list' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 12 }} onClick={() => setView('list')}>列表</button>
            <button className={`btn ${view === 'calendar' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 12 }} onClick={() => setView('calendar')}>週曆</button>
            <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true) }}>
              <Plus size={14} /> 新增活動
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">逾期</div><div className="stat-card-value">{overdue}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">今日待辦</div><div className="stat-card-value">{todayCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">待處理</div><div className="stat-card-value">{plannedCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已完成</div><div className="stat-card-value">{completedCount}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={14} style={{ color: 'var(--text-muted)' }} />
        <button style={filterBtn(!typeFilter)} onClick={() => setTypeFilter('')}>全部類型</button>
        {TYPES.map(t => (
          <button key={t.value} style={filterBtn(typeFilter === t.value)} onClick={() => setTypeFilter(t.value)}>
            {t.label}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: 'var(--border-medium)', margin: '0 4px' }} />
        <button style={filterBtn(!statusFilter)} onClick={() => setStatusFilter('')}>全部狀態</button>
        {STATUSES.map(s => (
          <button key={s.value} style={filterBtn(statusFilter === s.value)} onClick={() => setStatusFilter(s.value)}>
            {s.label}
          </button>
        ))}
      </div>

      {/* LIST VIEW */}
      {view === 'list' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Calendar size={16} style={{ marginRight: 6 }} /> 活動列表</div>
            <span className="badge badge-neutral">{activities.length} 筆</span>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>類型</th><th>主題</th><th>負責人</th><th>到期日</th><th>狀態</th><th>時長</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {activities.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>尚無活動紀錄</td></tr>
                )}
                {activities.map(a => {
                  const meta = getTypeMeta(a.type)
                  const Icon = meta.icon
                  const overdue_ = isOverdue(a)
                  return (
                    <tr key={a.id} style={{ opacity: a.status === 'cancelled' ? 0.5 : 1 }}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: meta.color }}>
                          <Icon size={14} /> {meta.label}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {a.subject}
                        {a.entity_type && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>({a.entity_type} #{a.entity_id})</span>}
                      </td>
                      <td>{a.assignee || '-'}</td>
                      <td style={{ color: overdue_ ? 'var(--accent-red)' : 'var(--text-secondary)', fontSize: 12, fontWeight: overdue_ ? 700 : 400 }}>
                        {a.due_date ? new Date(a.due_date).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                        {overdue_ && <span style={{ marginLeft: 4, fontSize: 10 }}>逾期</span>}
                      </td>
                      <td>
                        <span className={`badge ${a.status === 'completed' ? 'badge-success' : a.status === 'cancelled' ? 'badge-neutral' : overdue_ ? 'badge-danger' : 'badge-info'}`}>
                          <span className="badge-dot"></span>
                          {STATUSES.find(s => s.value === a.status)?.label || a.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {a.duration_minutes ? `${a.duration_minutes} 分` : '-'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {a.status !== 'completed' && a.status !== 'cancelled' && (
                            <button className="btn btn-sm" style={{ color: 'var(--accent-green)' }} onClick={() => completeActivity(a.id)} title="完成">
                              <Check size={13} />
                            </button>
                          )}
                          <button className="btn btn-sm" onClick={() => editActivity(a)} title="編輯">
                            <Clock size={13} />
                          </button>
                          <button className="btn btn-sm" style={{ color: 'var(--accent-red)' }} onClick={() => deleteActivity(a.id)} title="刪除">
                            <X size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CALENDAR VIEW */}
      {view === 'calendar' && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button className="btn btn-sm" onClick={() => { const d = new Date(calendarDate); d.setDate(d.getDate() - 7); setCalendarDate(d) }}>
              <ChevronLeft size={14} />
            </button>
            <h3 style={{ fontSize: 14 }}>
              {weekDays[0].toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })} — {weekDays[6].toLocaleDateString('zh-TW', { month: 'long', day: 'numeric' })}
            </h3>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-sm" onClick={() => setCalendarDate(new Date())}>今天</button>
              <button className="btn btn-sm" onClick={() => { const d = new Date(calendarDate); d.setDate(d.getDate() + 7); setCalendarDate(d) }}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', minHeight: 400 }}>
            {weekDays.map((day, i) => {
              const dateStr = day.toISOString().slice(0, 10)
              const dayActivities = activities.filter(a => a.due_date && a.due_date.slice(0, 10) === dateStr)
              const isToday = dateStr === today
              return (
                <div key={i} style={{ borderRight: i < 6 ? '1px solid var(--border-subtle)' : 'none', padding: 8, background: isToday ? 'var(--accent-cyan-dim, rgba(6,182,212,0.05))' : 'transparent' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: isToday ? 'var(--accent-cyan)' : 'var(--text-secondary)', textAlign: 'center' }}>
                    {['日', '一', '二', '三', '四', '五', '六'][day.getDay()]}
                    <div style={{ fontSize: 16, fontWeight: isToday ? 700 : 400 }}>{day.getDate()}</div>
                  </div>
                  {dayActivities.map(a => {
                    const meta = getTypeMeta(a.type)
                    return (
                      <div
                        key={a.id}
                        onClick={() => editActivity(a)}
                        style={{
                          padding: '4px 8px', borderRadius: 6, marginBottom: 4, cursor: 'pointer',
                          background: `${meta.color}18`, borderLeft: `3px solid ${meta.color}`,
                          fontSize: 11, lineHeight: 1.4,
                        }}
                      >
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.subject}</div>
                        {a.due_date && <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(a.due_date).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</div>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* MODAL */}
      {showModal && (
        <Modal
          title={editingId ? '編輯活動' : '新增活動'}
          onClose={closeModal}
          onSubmit={handleSubmit}
          submitLabel={saving ? '儲存中...' : editingId ? '更新' : '建立'}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="類型 *">
              <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="主題 *">
            <input className="form-input" style={{ width: '100%' }} value={form.subject} onChange={e => set('subject', e.target.value)} placeholder="例：跟客戶確認報價" />
          </Field>
          <Field label="說明">
            <textarea className="form-input" style={{ width: '100%', minHeight: 60 }} value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="負責人">
              <select className="form-input" style={{ width: '100%' }} value={form.assignee} onChange={e => set('assignee', e.target.value)}>
                <option value="">未指派</option>
                {SALES_REPS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="到期日">
              <input className="form-input" type="datetime-local" style={{ width: '100%' }} value={form.due_date} onChange={e => set('due_date', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="時長 (分鐘)">
              <input className="form-input" type="number" style={{ width: '100%' }} value={form.duration_minutes} onChange={e => set('duration_minutes', e.target.value)} placeholder="30" />
            </Field>
            <Field label="關聯實體">
              <div style={{ display: 'flex', gap: 4 }}>
                <select className="form-input" style={{ width: '45%' }} value={form.entity_type} onChange={e => set('entity_type', e.target.value)}>
                  <option value="">無</option>
                  <option value="customer">客戶</option>
                  <option value="opportunity">商機</option>
                  <option value="service_ticket">工單</option>
                </select>
                {form.entity_type && (
                  <input className="form-input" type="number" style={{ width: '50%' }} value={form.entity_id} onChange={e => set('entity_id', e.target.value)} placeholder="ID" />
                )}
              </div>
            </Field>
          </div>
          {editingId && (
            <Field label="結果/備註">
              <textarea className="form-input" style={{ width: '100%', minHeight: 40 }} value={form.outcome} onChange={e => set('outcome', e.target.value)} placeholder="通話結果、會議紀要..." />
            </Field>
          )}
        </Modal>
      )}
    </div>
  )
}
