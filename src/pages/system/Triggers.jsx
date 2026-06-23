import { useState, useEffect } from 'react'
import { Plus, Play, Pause, Pencil, X, ChevronRight, Zap } from 'lucide-react'
import { getTriggers, updateTrigger } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { toast } from '../../lib/toast'

const TYPES = ['排程', '事件']

const CONDITION_FIELDS = [
  { v: 'task_status',   label: '任務狀態' },
  { v: 'task_priority', label: '任務優先級' },
  { v: 'task_assignee', label: '負責人' },
  { v: 'task_due_date', label: '截止日期' },
  { v: 'project_id',    label: '所屬專案' },
  { v: 'form_status',   label: '表單狀態' },
]
const CONDITION_OPS = [
  { v: 'equals',     label: '等於' },
  { v: 'not_equals', label: '不等於' },
  { v: 'contains',   label: '包含' },
  { v: 'is_empty',   label: '為空' },
  { v: 'gte',        label: '大於或等於' },
  { v: 'passed',     label: '已超過' },
]
const ACTION_TYPES = [
  { v: 'send_notification', label: '發送通知' },
  { v: 'update_task',       label: '更新任務狀態' },
  { v: 'create_task',       label: '建立新任務' },
  { v: 'send_line',         label: '發送 LINE 訊息' },
  { v: 'assign_task',       label: '指派任務' },
  { v: 'escalate_approval', label: '上呈簽核' },
]

function TriggerBuilder({ trigger, onClose, onSaved }) {
  const [conditions, setConditions] = useState(trigger.conditions_json || [])
  const [actions, setActions] = useState(trigger.actions_json || [])
  const [saving, setSaving] = useState(false)

  const addCondition = () => setConditions(c => [...c, { field: 'task_status', op: 'equals', value: '' }])
  const addAction = () => setActions(a => [...a, { type: 'send_notification', target: 'assignee', message: '' }])
  const updCond = (i, key, val) => setConditions(c => c.map((x, idx) => idx === i ? { ...x, [key]: val } : x))
  const updAction = (i, key, val) => setActions(a => a.map((x, idx) => idx === i ? { ...x, [key]: val } : x))

  const save = async () => {
    setSaving(true)
    const { data, error } = await supabase.from('triggers')
      .update({ conditions_json: conditions, actions_json: actions }).eq('id', trigger.id)
      .select().single()
    if (error) { toast.error('儲存失敗'); setSaving(false); return }
    toast.success('觸發器已更新')
    onSaved(data)
    setSaving(false)
  }

  const blockStyle = { background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10, padding: '12px 16px', position: 'relative' }
  const labelStyle = { fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 16, padding: 24, width: '90vw', maxWidth: 820, maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--border-medium)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Zap size={18} style={{ color: 'var(--accent-cyan)' }} />
            <span style={{ fontWeight: 700, fontSize: 16 }}>視覺觸發器編輯 — {trigger.name}</span>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        {/* IF */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-orange)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            🔍 條件（IF）<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>— 所有條件同時成立才執行</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {conditions.map((c, i) => (
              <div key={i} style={{ ...blockStyle, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                {i > 0 && <div style={{ position: 'absolute', top: -14, left: 20, fontSize: 11, fontWeight: 700, color: 'var(--accent-orange)', background: 'var(--bg-secondary)', padding: '0 6px' }}>AND</div>}
                <div style={{ flex: 1, minWidth: 130 }}>
                  <div style={labelStyle}>欄位</div>
                  <select className="form-input" style={{ fontSize: 12 }} value={c.field} onChange={e => updCond(i, 'field', e.target.value)}>
                    {CONDITION_FIELDS.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 110 }}>
                  <div style={labelStyle}>運算子</div>
                  <select className="form-input" style={{ fontSize: 12 }} value={c.op} onChange={e => updCond(i, 'op', e.target.value)}>
                    {CONDITION_OPS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                </div>
                {c.op !== 'is_empty' && (
                  <div style={{ flex: 2, minWidth: 140 }}>
                    <div style={labelStyle}>值</div>
                    <input className="form-input" style={{ fontSize: 12 }} placeholder="輸入值…" value={c.value} onChange={e => updCond(i, 'value', e.target.value)} />
                  </div>
                )}
                <button onClick={() => setConditions(conds => conds.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 6, flexShrink: 0 }}><X size={14} /></button>
              </div>
            ))}
            {conditions.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 12px' }}>（無條件 — 觸發排程或事件時直接執行動作）</div>}
          </div>
          <button className="btn btn-secondary" style={{ fontSize: 12, marginTop: 8 }} onClick={addCondition}>+ 新增條件</button>
        </div>

        <div style={{ textAlign: 'center', margin: '8px 0', color: 'var(--accent-cyan)' }}>
          <ChevronRight style={{ transform: 'rotate(90deg)' }} size={24} />
        </div>

        {/* THEN */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            ⚡ 動作（THEN）<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>— 條件成立時依序執行</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {actions.map((a, i) => (
              <div key={i} style={{ ...blockStyle, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 11, position: 'absolute', top: -10, left: 14, background: 'var(--bg-secondary)', padding: '0 6px', color: 'var(--text-muted)', fontWeight: 700 }}>步驟 {i + 1}</div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={labelStyle}>動作類型</div>
                  <select className="form-input" style={{ fontSize: 12 }} value={a.type} onChange={e => updAction(i, 'type', e.target.value)}>
                    {ACTION_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={labelStyle}>對象</div>
                  <input className="form-input" style={{ fontSize: 12 }} placeholder="assignee / admin…" value={a.target || ''} onChange={e => updAction(i, 'target', e.target.value)} />
                </div>
                <div style={{ flex: 2, minWidth: 180 }}>
                  <div style={labelStyle}>訊息 / 參數</div>
                  <input className="form-input" style={{ fontSize: 12 }} placeholder="通知內容或設定值…" value={a.message || ''} onChange={e => updAction(i, 'message', e.target.value)} />
                </div>
                <button onClick={() => setActions(acts => acts.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 6, flexShrink: 0 }}><X size={14} /></button>
              </div>
            ))}
            {actions.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 12px' }}>（尚未設定動作）</div>}
          </div>
          <button className="btn btn-secondary" style={{ fontSize: 12, marginTop: 8 }} onClick={addAction}>+ 新增動作</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? '儲存中…' : '✓ 儲存觸發器'}</button>
        </div>
      </div>
    </div>
  )
}

export default function Triggers() {
  const [triggers, setTriggers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', type: TYPES[0], schedule: '', action: '' })
  const [builderTrigger, setBuilderTrigger] = useState(null)

  useEffect(() => {
    getTriggers().then(({ data }) => { setTriggers(data || []) }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const toggleStatus = async (t) => {
    const newStatus = t.status === '啟用' ? '停用' : '啟用'
    const { data } = await updateTrigger(t.id, { status: newStatus })
    if (data) setTriggers(prev => prev.map(x => x.id === t.id ? data : x))
  }

  const handleSubmit = async () => {
    if (!form.name || !form.action) return
    const { data } = await supabase.from('triggers').insert({ ...form, status: '停用' }).select().single()
    if (data) {
      setTriggers(prev => [...prev, data])
      setShowModal(false)
      setForm({ name: '', type: TYPES[0], schedule: '', action: '' })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const formatTime = (ts) => ts ? new Date(ts).toLocaleString('zh-TW') : '-'

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">⚡</span> 觸發器</h2>
            <p>自動化觸發規則管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增觸發器</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">啟用中</div>
          <div className="stat-card-value">{triggers.filter(t => t.status === '啟用').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">已停用</div>
          <div className="stat-card-value">{triggers.filter(t => t.status === '停用').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總計</div>
          <div className="stat-card-value">{triggers.length}</div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>名稱</th><th>類型</th><th>排程</th><th>動作</th><th>最後執行</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {triggers.map(t => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td><span className={`badge ${t.type === '排程' ? 'badge-info' : 'badge-purple'}`}>{t.type}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.schedule}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {t.conditions_json?.length > 0 && <span style={{ color: 'var(--accent-orange)', marginRight: 4 }}>🔍 {t.conditions_json.length}條件</span>}
                    {t.actions_json?.length > 0 && <span style={{ color: 'var(--accent-cyan)' }}>⚡ {t.actions_json.length}動作</span>}
                    {!t.conditions_json?.length && !t.actions_json?.length && (t.action || '—')}
                  </td>
                  <td style={{ fontSize: 12 }}>{formatTime(t.last_run)}</td>
                  <td><span className={`badge ${t.status === '啟用' ? 'badge-success' : 'badge-neutral'}`}><span className="badge-dot"></span>{t.status}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => toggleStatus(t)} style={{ marginRight: 6 }}>
                      {t.status === '啟用' ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                    <button className="btn btn-sm btn-secondary" title="視覺編輯" onClick={() => setBuilderTrigger(t)}>
                      <Pencil size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {builderTrigger && (
        <TriggerBuilder
          trigger={builderTrigger}
          onClose={() => setBuilderTrigger(null)}
          onSaved={(updated) => {
            setTriggers(prev => prev.map(t => t.id === updated.id ? updated : t))
            setBuilderTrigger(null)
          }}
        />
      )}

      {showModal && (
        <Modal title="新增觸發器" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="名稱" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="每日打卡提醒" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="類型">
              <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
                {TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="排程 (Cron)">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="0 9 * * 1-5" value={form.schedule} onChange={e => set('schedule', e.target.value)} />
          </Field>
          <Field label="執行動作" required>
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="發送打卡提醒通知" value={form.action} onChange={e => set('action', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
