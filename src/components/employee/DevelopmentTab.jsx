import { useState, useEffect } from 'react'
import { Plus, Trash2, CheckCircle, Clock, BookOpen, Wrench, Users } from 'lucide-react'
import { getEmployeeDevelopmentPlans, createDevelopmentPlan, updateDevelopmentPlan, deleteDevelopmentPlan } from '../../lib/db'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const SKILL_TYPES = [
  { value: 'hard', label: '硬技能', icon: '🔧', color: 'var(--accent-cyan)' },
  { value: 'soft', label: '軟技能', icon: '🤝', color: 'var(--accent-purple)' },
]

const LEVELS = ['基礎', '中級', '進階', '專家']

const STATUS_MAP = {
  '規劃中': { color: 'var(--text-muted)', bg: 'var(--bg-secondary)' },
  '進行中': { color: 'var(--accent-cyan)', bg: 'var(--accent-cyan-dim)' },
  '已完成': { color: 'var(--accent-green)', bg: 'var(--accent-green-dim)' },
  '已取消': { color: 'var(--accent-red)', bg: 'var(--accent-red-dim)' },
}

const EMPTY_FORM = {
  skill_name: '', skill_type: 'hard', current_level: '基礎', target_level: '中級',
  course_name: '', course_provider: '', status: '規劃中', start_date: '', target_date: '', notes: '',
}

export default function DevelopmentTab({ employee }) {
  const [plans, setPlans] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [filter, setFilter] = useState('')

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!employee?.id) return
    getEmployeeDevelopmentPlans(employee.id).then(({ data }) => setPlans(data || []))
  }, [employee?.id])

  const handleAdd = async () => {
    if (!form.skill_name) return toast.warning('請填寫技能名稱')
    const { data, error } = await createDevelopmentPlan({ ...form, employee_id: employee.id })
    if (error) { console.error('Save failed:', error); return toast.error('儲存失敗，請稍後再試') }
    setPlans(prev => [data, ...prev])
    setShowForm(false)
    setForm(EMPTY_FORM)
  }

  const handleStatusChange = async (id, status) => {
    const updates = { status }
    if (status === '已完成') updates.completed_date = new Date().toISOString().slice(0, 10)
    const { data, error } = await updateDevelopmentPlan(id, updates)
    if (!error) setPlans(prev => prev.map(p => p.id === id ? data : p))
  }

  const handleDelete = async (id) => {
    if (!(await confirm({ message: '確定刪除此發展計畫？' }))) return
    await deleteDevelopmentPlan(id)
    setPlans(prev => prev.filter(p => p.id !== id))
  }

  const filtered = filter ? plans.filter(p => p.skill_type === filter) : plans
  const hardCount = plans.filter(p => p.skill_type === 'hard').length
  const softCount = plans.filter(p => p.skill_type === 'soft').length
  const completedCount = plans.filter(p => p.status === '已完成').length
  const inProgressCount = plans.filter(p => p.status === '進行中').length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>📚 能力發展</div>
        <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setShowForm(!showForm)}>
          <Plus size={12} /> 新增計畫
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[
          { label: '硬技能', count: hardCount, icon: '🔧', color: 'var(--accent-cyan)' },
          { label: '軟技能', count: softCount, icon: '🤝', color: 'var(--accent-purple)' },
          { label: '進行中', count: inProgressCount, icon: '📖', color: 'var(--accent-orange)' },
          { label: '已完成', count: completedCount, icon: '✅', color: 'var(--accent-green)' },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, padding: '8px 10px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.icon} {s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.count}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {[{ value: '', label: '全部' }, ...SKILL_TYPES].map(t => (
          <button key={t.value} onClick={() => setFilter(t.value)} style={{
            padding: '4px 12px', borderRadius: 14, border: '1px solid',
            borderColor: filter === t.value ? 'var(--accent-cyan)' : 'var(--border-subtle)',
            background: filter === t.value ? 'var(--accent-cyan-dim)' : 'transparent',
            cursor: 'pointer', fontSize: 11, color: filter === t.value ? 'var(--accent-cyan)' : 'var(--text-muted)',
          }}>
            {t.icon || '📋'} {t.label}
          </button>
        ))}
      </div>

      {/* Add Form */}
      {showForm && (
        <div style={{ padding: 14, background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--accent-cyan)', marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>技能名稱 *</label>
              <input className="form-input" style={{ width: '100%', fontSize: 12 }} value={form.skill_name} onChange={e => setF('skill_name', e.target.value)} placeholder="例：Python、領導力" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>類型</label>
              <select className="form-input" style={{ width: '100%', fontSize: 12 }} value={form.skill_type} onChange={e => setF('skill_type', e.target.value)}>
                {SKILL_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>目前等級</label>
              <select className="form-input" style={{ width: '100%', fontSize: 12 }} value={form.current_level} onChange={e => setF('current_level', e.target.value)}>
                {LEVELS.map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>目標等級</label>
              <select className="form-input" style={{ width: '100%', fontSize: 12 }} value={form.target_level} onChange={e => setF('target_level', e.target.value)}>
                {LEVELS.map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>課程名稱</label>
              <input className="form-input" style={{ width: '100%', fontSize: 12 }} value={form.course_name} onChange={e => setF('course_name', e.target.value)} placeholder="例：Python 進階班" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>課程提供方</label>
              <input className="form-input" style={{ width: '100%', fontSize: 12 }} value={form.course_provider} onChange={e => setF('course_provider', e.target.value)} placeholder="例：Hahow、內訓" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>開始日期</label>
              <input type="date" className="form-input" style={{ width: '100%', fontSize: 12 }} value={form.start_date} onChange={e => setF('start_date', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>目標完成日</label>
              <input type="date" className="form-input" style={{ width: '100%', fontSize: 12 }} value={form.target_date} onChange={e => setF('target_date', e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>備註</label>
            <input className="form-input" style={{ width: '100%', fontSize: 12 }} value={form.notes} onChange={e => setF('notes', e.target.value)} placeholder="學習目標或備註..." />
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setShowForm(false)}>取消</button>
            <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={handleAdd}>新增</button>
          </div>
        </div>
      )}

      {/* Plans list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24, fontSize: 13 }}>
          尚無發展計畫，點擊「新增計畫」開始規劃
        </div>
      ) : filtered.map(plan => {
        const st = STATUS_MAP[plan.status] || STATUS_MAP['規劃中']
        const isHard = plan.skill_type === 'hard'
        const currentIdx = LEVELS.indexOf(plan.current_level)
        const targetIdx = LEVELS.indexOf(plan.target_level)
        const pct = targetIdx > 0 ? Math.round((currentIdx / targetIdx) * 100) : 0

        return (
          <div key={plan.id} style={{
            padding: '12px 14px', marginBottom: 8, borderRadius: 10,
            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
            borderLeft: `3px solid ${isHard ? 'var(--accent-cyan)' : 'var(--accent-purple)'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{plan.skill_name}</span>
                  <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, color: isHard ? 'var(--accent-cyan)' : 'var(--accent-purple)', background: isHard ? 'var(--accent-cyan-dim)' : 'var(--accent-purple-dim)' }}>
                    {isHard ? '🔧 硬技能' : '🤝 軟技能'}
                  </span>
                  <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, color: st.color, background: st.bg }}>
                    {plan.status}
                  </span>
                </div>
                {plan.course_name && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                    📖 {plan.course_name} {plan.course_provider && `· ${plan.course_provider}`}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {plan.status !== '已完成' && (
                  <select className="form-input" style={{ fontSize: 10, padding: '2px 4px', width: 70 }}
                    value={plan.status} onChange={e => handleStatusChange(plan.id, e.target.value)}>
                    <option value="規劃中">規劃中</option>
                    <option value="進行中">進行中</option>
                    <option value="已完成">已完成</option>
                    <option value="已取消">已取消</option>
                  </select>
                )}
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }} onClick={() => handleDelete(plan.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* Level progress */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, marginBottom: 4 }}>
              <span style={{ color: 'var(--text-muted)' }}>{plan.current_level}</span>
              <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--border-subtle)', overflow: 'hidden' }}>
                <div style={{
                  width: plan.status === '已完成' ? '100%' : `${pct}%`,
                  height: '100%', borderRadius: 3,
                  background: plan.status === '已完成' ? 'var(--accent-green)' : isHard ? 'var(--accent-cyan)' : 'var(--accent-purple)',
                }} />
              </div>
              <span style={{ fontWeight: 600 }}>{plan.target_level}</span>
            </div>

            {/* Dates */}
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
              {plan.start_date && <span>開始：{plan.start_date}</span>}
              {plan.target_date && <span>目標：{plan.target_date}</span>}
              {plan.completed_date && <span style={{ color: 'var(--accent-green)' }}>完成：{plan.completed_date}</span>}
            </div>
            {plan.notes && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{plan.notes}</div>}
          </div>
        )
      })}
    </div>
  )
}
