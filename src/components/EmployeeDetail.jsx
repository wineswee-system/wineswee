import { useState, useEffect } from 'react'
import { ModalOverlay } from './Modal'
import { createPortal } from 'react-dom'
import { X, Save, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { updateEmployee } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import PersonalityTab from './employee/PersonalityTab'
import DevelopmentTab from './employee/DevelopmentTab'

// Mask sensitive fields for non-admin users
const maskId = (v) => v ? v.slice(0, 3) + '****' + v.slice(-2) : ''
const maskBank = (v) => v ? '****' + v.slice(-4) : ''

const SPECIAL_CATEGORIES = ['身心障礙者', '中低收入戶', '原住民', '中高齡者 (45+)', '長期失業者', '更生人', '獨力負擔家計者', '家庭暴力被害人', '二度就業婦女']

export default function EmployeeDetail({ employee, employees: allEmployees, stores, departments, onUpdate, onClose }) {
  const { isAdmin } = useAuth()
  const [tab, setTab] = useState('personal')
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  // Sub-data
  const [skills, setSkills] = useState([])
  const [dependents, setDependents] = useState([])
  const [transfers, setTransfers] = useState([])
  const [reviews, setReviews] = useState([])
  const [schedPrefs, setSchedPrefs] = useState([])
  const [leaveRecords, setLeaveRecords] = useState([])
  const [availability, setAvailability] = useState([])
  const [onboardingTasks, setOnboardingTasks] = useState([])

  // Inline add
  const [newSkill, setNewSkill] = useState('')
  const [newSkillLevel, setNewSkillLevel] = useState('基礎')

  useEffect(() => {
    if (!employee) return
    setForm({ ...employee })
    setIsDirty(false)
    // Load sub-data
    Promise.all([
      supabase.from('employee_skills').select('*').eq('employee_id', employee.id).order('id'),
      supabase.from('employee_dependents').select('*').eq('employee_id', employee.id).order('id'),
      supabase.from('employee_transfers').select('*').eq('employee_id', employee.id).order('transfer_date', { ascending: false }),
      supabase.from('employee_reviews').select('*').eq('employee_id', employee.id).order('review_date', { ascending: false }),
      supabase.from('employee_schedule_prefs').select('*').eq('employee_id', employee.id).order('id'),
      supabase.from('leave_requests').select('*').eq('employee_id', employee.id).order('id', { ascending: false }).limit(10),
      supabase.from('employee_availability').select('*').eq('employee_id', employee.id).order('day_of_week'),
      supabase.from('tasks').select('*').eq('assignee_id', employee.id).in('status', ['未開始', '進行中', '待處理']).order('created_at', { ascending: false }),
    ]).then(([sk, dep, tr, rev, sp, lv, av, ob]) => {
      setSkills(sk.data || [])
      setDependents(dep.data || [])
      setTransfers(tr.data || [])
      setReviews(rev.data || [])
      setSchedPrefs(sp.data || [])
      setLeaveRecords(lv.data || [])
      setAvailability(av.data || [])
      setOnboardingTasks(ob.data || [])
    })
  }, [employee?.id])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  if (!employee) return null

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setIsDirty(true) }

  const handleSave = async () => {
    setSaving(true)
    // Check if store changed
    const storeChanged = form.store !== employee.store && employee.store && form.store
    const { data, error } = await updateEmployee(employee.id, form)
    if (error) { alert('儲存失敗：' + error.message); setSaving(false); return }
    if (data) {
      onUpdate(data); setIsDirty(false)
      // If store changed, remove future schedules (shifts may not exist at new store)
      if (storeChanged) {
        const today = new Date().toISOString().slice(0, 10)
        await supabase.from('schedules').delete().eq('employee_id', data.id).gt('date', today)
        alert(`已調至${form.store}，未來排班已清除，請重新排班`)
      }
    }
    setSaving(false)
  }

  const handleClose = () => {
    if (isDirty && !confirm('有未儲存的變更，確定離開？')) return
    onClose()
  }

  // Sub-data handlers
  const addSkill = async () => {
    if (!newSkill.trim()) return
    try {
      const { data } = await supabase.from('employee_skills').insert({ employee_id: employee.id, skill_name: newSkill.trim(), level: newSkillLevel }).select().single()
      if (data) { setSkills(prev => [...prev, data]); setNewSkill('') }
    } catch (e) { alert('新增失敗') }
  }

  const deleteSkill = async (id) => {
    try {
      await supabase.from('employee_skills').delete().eq('id', id)
      setSkills(prev => prev.filter(s => s.id !== id))
    } catch (e) { alert('刪除失敗') }
  }

  const [showDepForm, setShowDepForm] = useState(false)
  const [depForm, setDepForm] = useState({ name: '', relationship: '配偶', id_number: '', birth_date: '', health_ins: false })

  const addDependent = async () => {
    if (!depForm.name) return
    try {
      const { data } = await supabase.from('employee_dependents').insert({
        employee_id: employee.id, name: depForm.name, relationship: depForm.relationship,
        id_number: depForm.id_number || null, birth_date: depForm.birth_date || null,
        health_ins: depForm.health_ins,
      }).select().single()
      if (data) {
        setDependents(prev => [...prev, data])
        setDepForm({ name: '', relationship: '配偶', id_number: '', birth_date: '', health_ins: false })
        setShowDepForm(false)
      }
    } catch (e) { alert('新增失敗') }
  }

  const deleteDependent = async (id) => {
    try {
      await supabase.from('employee_dependents').delete().eq('id', id)
      setDependents(prev => prev.filter(d => d.id !== id))
    } catch (e) { alert('刪除失敗') }
  }

  const addReview = async () => {
    const score = prompt('評分（1-5）：')
    if (!score) return
    const notes = prompt('評語：') || ''
    try {
      const { data } = await supabase.from('employee_reviews').insert({
        employee_id: employee.id, review_date: new Date().toISOString().slice(0, 10),
        reviewer: '管理員', score: Number(score), notes,
      }).select().single()
      if (data) setReviews(prev => [data, ...prev])
    } catch (e) { alert('新增失敗') }
  }

  const addTransfer = async () => {
    const to_store = prompt('調到哪個門市：')
    if (!to_store) return
    const reason = prompt('調動原因：') || ''
    try {
      const { data } = await supabase.from('employee_transfers').insert({
        employee_id: employee.id, transfer_date: new Date().toISOString().slice(0, 10),
        from_store: employee.store, to_store, from_dept: employee.dept, from_position: employee.position, reason,
      }).select().single()
      if (data) setTransfers(prev => [data, ...prev])
    } catch (e) { alert('新增失敗') }
  }

  const addSchedPref = async () => {
    const notes = prompt('排班偏好（例如：週六不排晚班）：')
    if (!notes) return
    try {
      const { data } = await supabase.from('employee_schedule_prefs').insert({
        employee_id: employee.id, pref_type: 'note', notes,
      }).select().single()
      if (data) setSchedPrefs(prev => [...prev, data])
    } catch (e) { alert('新增失敗') }
  }

  const deleteSchedPref = async (id) => {
    await supabase.from('employee_schedule_prefs').delete().eq('id', id)
    setSchedPrefs(prev => prev.filter(p => p.id !== id))
  }

  const DAYS = ['一', '二', '三', '四', '五', '六', '日']
  const AVAIL_STATUS = ['可排班', '偏好', '偏不排', '不可']
  const AVAIL_COLORS = { '可排班': '#22c55e', '偏好': '#3b82f6', '偏不排': '#f59e0b', '不可': '#ef4444' }

  const setAvail = async (dayIdx, status) => {
    const existing = availability.find(a => a.day_of_week === dayIdx)
    if (existing) {
      const { data } = await supabase.from('employee_availability').update({ status }).eq('id', existing.id).select().single()
      if (data) setAvailability(prev => prev.map(a => a.id === data.id ? data : a))
    } else {
      const { data } = await supabase.from('employee_availability').insert({ employee_id: employee.id, day_of_week: dayIdx, status }).select().single()
      if (data) setAvailability(prev => [...prev, data])
    }
  }

  const setAvailShift = async (dayIdx, shift) => {
    const existing = availability.find(a => a.day_of_week === dayIdx)
    if (existing) {
      const { data } = await supabase.from('employee_availability').update({ preferred_shift: shift }).eq('id', existing.id).select().single()
      if (data) setAvailability(prev => prev.map(a => a.id === data.id ? data : a))
    }
  }

  const toggleSpecial = (cat) => {
    const current = form.special_categories || []
    const next = current.includes(cat) ? current.filter(c => c !== cat) : [...current, cat]
    set('special_categories', next)
  }

  const L = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }
  const SectionTitle = ({ icon, text }) => (
    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginTop: 22, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 15 }}>{icon}</span> {text}
    </div>
  )

  const TABS = [
    { key: 'personal', label: '個人資訊', icon: '👤' },
    { key: 'org', label: '組織', icon: '🏢' },
    { key: 'skills', label: '技能', icon: '🏷️' },
    { key: 'personality', label: '性格分析', icon: '🧬' },
    { key: 'development', label: '能力發展', icon: '📚' },
    { key: 'schedule', label: '排班', icon: '📅' },
    { key: 'records', label: '紀錄', icon: '📋' },
  ]

  const empTypeColor = (form.employment_type || '全職') === '全職' ? '#22c55e' : '#f59e0b'
  const statusColor = (form.status || '在職') === '在職' ? '#22c55e' : form.status === '留職停薪' ? '#f59e0b' : '#ef4444'

  const QuickInfo = ({ icon, label, value }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 12 }}>{icon}</span>
      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{value || '—'}</span>
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', justifyContent: 'flex-end' }}
      onMouseDown={e => { if (e.target === e.currentTarget) handleClose() }}>
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        onMouseDown={handleClose} />

      {/* Panel */}
      <div style={{
        position: 'relative', width: '100%', maxWidth: 760, height: '100vh',
        background: 'var(--bg-primary)', borderLeft: '1px solid var(--border-medium)',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 0.25s ease-out',
      }}>

        {/* Header */}
        <div style={{ flexShrink: 0, background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-primary) 100%)', borderBottom: '1px solid var(--border-subtle)' }}>
          {/* Top bar: close + save */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px 0' }}>
            <button onClick={handleClose} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: '4px 0' }}>
              <X size={16} /> 關閉
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {isDirty && <span style={{ fontSize: 11, color: 'var(--accent-orange)', fontWeight: 600 }}>未儲存變更</span>}
              <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 12, padding: '6px 16px', borderRadius: 8 }}>
                <Save size={12} /> {saving ? '儲存中...' : '儲存'}
              </button>
            </div>
          </div>

          {/* Profile row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px 0' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14, background: employee.avatar || '#8b5cf6',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 800, color: '#fff',
              boxShadow: `0 4px 12px ${(employee.avatar || '#8b5cf6')}44`,
            }}>
              {employee.name?.[0]}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2 }}>{employee.name}</span>
                {employee.name_en && <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>{employee.name_en}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 700 }}>EMP-{String(employee.id).padStart(3, '0')}</span>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: empTypeColor + '18', color: empTypeColor, fontWeight: 700 }}>{form.employment_type || '全職'}</span>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: statusColor + '18', color: statusColor, fontWeight: 700 }}>{form.status || '在職'}</span>
              </div>
            </div>
          </div>

          {/* Quick info bar */}
          <div style={{ display: 'flex', gap: 16, padding: '12px 24px 14px', overflowX: 'auto', flexWrap: 'wrap' }}>
            <QuickInfo icon="💼" value={employee.position || '未設定'} />
            <QuickInfo icon="🏪" value={employee.store || '未指派'} />
            <QuickInfo icon="🏢" value={employee.dept || '未指派'} />
            {employee.join_date && <QuickInfo icon="📅" value={`到職 ${employee.join_date}`} />}
            {employee.phone && <QuickInfo icon="📱" value={employee.phone} />}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, padding: '0 24px', overflowX: 'auto' }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                padding: '10px 16px', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: 'transparent', display: 'flex', alignItems: 'center', gap: 5,
                color: tab === t.key ? 'var(--accent-cyan)' : 'var(--text-muted)',
                borderBottom: tab === t.key ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                transition: 'color 0.15s, border-color 0.15s',
                whiteSpace: 'nowrap',
              }}>
                <span style={{ fontSize: 13 }}>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 32px' }}>

        {/* Slide-in animation */}
        <style>{`@keyframes slideInRight { from { transform: translateX(100%); opacity: 0.5; } to { transform: translateX(0); opacity: 1; } }`}</style>

          {/* ═══ 個人資訊 ═══ */}
          {tab === 'personal' && (
            <>
              <SectionTitle icon="👤" text="姓名" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div style={L}>姓</div><input className="form-input" style={{ width: '100%' }} value={form.last_name || ''} onChange={e => set('last_name', e.target.value)} /></div>
                <div><div style={L}>名</div><input className="form-input" style={{ width: '100%' }} value={form.first_name || ''} onChange={e => set('first_name', e.target.value)} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div style={L}>英文名</div><input className="form-input" style={{ width: '100%' }} value={form.name_en || ''} onChange={e => set('name_en', e.target.value)} /></div>
                <div><div style={L}>職等</div><input className="form-input" style={{ width: '100%' }} value={form.grade || ''} onChange={e => set('grade', e.target.value)} placeholder="M1/S3" /></div>
              </div>

              <SectionTitle icon="📋" text="個人資料" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div style={L}>出生日期</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.birth_date || ''} onChange={e => set('birth_date', e.target.value)} /></div>
                <div><div style={L}>性別</div>
                  <select className="form-input" style={{ width: '100%' }} value={form.gender || ''} onChange={e => set('gender', e.target.value)}>
                    <option value="">— 請選擇 —</option><option>男</option><option>女</option><option>其他</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div style={L}>國籍</div><input className="form-input" style={{ width: '100%' }} value={form.nationality || 'TW'} onChange={e => set('nationality', e.target.value)} /></div>
                <div><div style={L}>身分證字號</div><input className="form-input" style={{ width: '100%' }} value={isAdmin ? (form.id_number || '') : maskId(form.id_number)} onChange={e => set('id_number', e.target.value)} readOnly={!isAdmin} /></div>
              </div>
              <div><div style={L}>地址</div><input className="form-input" style={{ width: '100%' }} value={form.address || ''} onChange={e => set('address', e.target.value)} /></div>

              <SectionTitle icon="🚨" text="緊急聯絡人" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div style={L}>姓名</div><input className="form-input" style={{ width: '100%' }} value={form.emergency_name || ''} onChange={e => set('emergency_name', e.target.value)} /></div>
                <div><div style={L}>電話</div><input className="form-input" style={{ width: '100%' }} value={form.emergency_phone || ''} onChange={e => set('emergency_phone', e.target.value)} /></div>
              </div>

              <SectionTitle icon="🏦" text="銀行帳戶" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                <div><div style={L}>銀行代碼</div><input className="form-input" style={{ width: '100%' }} value={form.bank_code || '004'} onChange={e => set('bank_code', e.target.value)} readOnly={!isAdmin} /></div>
                <div><div style={L}>帳號</div><input className="form-input" style={{ width: '100%' }} value={isAdmin ? (form.bank_account || '') : maskBank(form.bank_account)} onChange={e => set('bank_account', e.target.value)} readOnly={!isAdmin} /></div>
              </div>

              <SectionTitle icon="🏷️" text="特殊身分類別" />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {SPECIAL_CATEGORIES.map(cat => (
                  <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={(form.special_categories || []).includes(cat)} onChange={() => toggleSpecial(cat)} />
                    {cat}
                  </label>
                ))}
              </div>
            </>
          )}

          {/* ═══ 組織 ═══ */}
          {tab === 'org' && (
            <>
              <SectionTitle icon="💼" text="僱用資訊" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div style={L}>類型</div>
                  <select className="form-input" style={{ width: '100%' }} value={form.employment_type || '全職'} onChange={e => set('employment_type', e.target.value)}>
                    <option>全職</option><option>兼職</option>
                  </select>
                </div>
                <div><div style={L}>狀態</div>
                  <select className="form-input" style={{ width: '100%' }} value={form.status || '在職'} onChange={e => set('status', e.target.value)}>
                    <option>在職</option><option>離職</option><option>留職停薪</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div style={L}>電話</div><input className="form-input" style={{ width: '100%' }} value={form.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
                <div><div style={L}>入職日期</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.join_date || ''} onChange={e => set('join_date', e.target.value)} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div style={L}>試用期結束</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.probation_end || ''} onChange={e => set('probation_end', e.target.value)} /></div>
                <div><div style={L}>離職日期</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.resign_date || ''} onChange={e => set('resign_date', e.target.value)} /></div>
              </div>
              <div><div style={L}>離職原因</div><textarea className="form-input" style={{ width: '100%', minHeight: 50, resize: 'vertical' }} value={form.resign_reason || ''} onChange={e => set('resign_reason', e.target.value)} /></div>

              <SectionTitle icon="🏪" text="門市 / 公司 / 部門" />
              <div><div style={L}>主要門市</div>
                <select className="form-input" style={{ width: '100%' }} value={form.store || ''} onChange={e => set('store', e.target.value)}>
                  <option value="">未指派</option>
                  {(stores || []).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={L}>可支援門市（跨店排班）</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(stores || []).filter(s => s.name !== form.store).map(s => {
                    const checked = (form.additional_stores || []).includes(s.name)
                    return (
                      <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', padding: '4px 8px', borderRadius: 6, background: checked ? 'var(--accent-cyan-dim)' : 'var(--glass-light)', border: `1px solid ${checked ? 'rgba(6,182,212,0.3)' : 'var(--border-subtle)'}` }}>
                        <input type="checkbox" checked={checked} onChange={() => {
                          const current = form.additional_stores || []
                          set('additional_stores', checked ? current.filter(n => n !== s.name) : [...current, s.name])
                        }} style={{ width: 14, height: 14 }} />
                        {s.name}
                      </label>
                    )
                  })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>勾選的門市會在「找人代班」時優先顯示此員工</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div style={L}>部門</div>
                  <select className="form-input" style={{ width: '100%' }} value={form.dept || ''} onChange={e => set('dept', e.target.value)}>
                    <option value="">— 未指派 —</option>
                    {(departments || []).map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
                <div><div style={L}>直屬主管</div>
                  <select className="form-input" style={{ width: '100%' }} value={form.supervisor || ''} onChange={e => set('supervisor', e.target.value)}>
                    <option value="">— 未指派 —</option>
                    {(allEmployees || []).filter(e => e.id !== employee.id && e.status === '在職').map(e => (
                      <option key={e.id} value={e.name}>{e.name} — {e.position || e.dept}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div><div style={L}>職位</div><input className="form-input" style={{ width: '100%' }} value={form.position || ''} onChange={e => set('position', e.target.value)} placeholder="輸入或選擇職位" /></div>

              <SectionTitle icon="💰" text="薪資" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div style={L}>計薪方式</div>
                  <select className="form-input" style={{ width: '100%' }} value={form.salary_type || 'monthly'} onChange={e => set('salary_type', e.target.value)}>
                    <option value="monthly">月薪制</option>
                    <option value="hourly">時薪制</option>
                  </select>
                </div>
                {(form.salary_type || 'monthly') === 'monthly' ? (
                  <div><div style={L}>月底薪 (NT$)</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="例：28000" value={form.base_salary || ''} onChange={e => set('base_salary', e.target.value)} /></div>
                ) : (
                  <div><div style={L}>時薪 (NT$)</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="例：183" value={form.hourly_rate || ''} onChange={e => set('hourly_rate', e.target.value)} /></div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div style={L}>每週工時上限</div><input className="form-input" type="number" style={{ width: '100%' }} value={form.weekly_hours || 40} onChange={e => set('weekly_hours', e.target.value)} /></div>
                {(form.salary_type || 'monthly') === 'monthly' && (
                  <div><div style={L}>月底薪換算時薪</div>
                    <div className="form-input" style={{ width: '100%', background: 'var(--glass-light)', color: 'var(--text-muted)' }}>
                      NT$ {form.base_salary ? Math.round(Number(form.base_salary) / 30 / 8) : '—'} /hr
                    </div>
                  </div>
                )}
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginTop: 14, marginBottom: 6 }}>津貼</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div><div style={L}>伙食津貼</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.meal_allowance || ''} onChange={e => set('meal_allowance', e.target.value)} /></div>
                <div><div style={L}>交通津貼</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.transport_allowance || ''} onChange={e => set('transport_allowance', e.target.value)} /></div>
                <div><div style={L}>住房津貼</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.housing_allowance || ''} onChange={e => set('housing_allowance', e.target.value)} /></div>
              </div>

              <SectionTitle icon="🏥" text="勞健保" />

              {/* 勞工保險 */}
              <div style={{ padding: '12px 14px', background: 'var(--bg-card)', borderRadius: 10, marginBottom: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: form.labor_insurance ? 10 : 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>勞工保險</span>
                  <label style={{ position: 'relative', width: 44, height: 24, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.labor_insurance || false} onChange={e => set('labor_insurance', e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                    <span style={{ position: 'absolute', inset: 0, borderRadius: 12, background: form.labor_insurance ? 'var(--accent-cyan)' : 'var(--border-medium)', transition: '0.2s' }}>
                      <span style={{ position: 'absolute', top: 2, left: form.labor_insurance ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: '0.2s' }} />
                    </span>
                  </label>
                </div>
                {form.labor_insurance && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>投保級距</div>
                      <input className="form-input" type="number" style={{ width: '100%' }} placeholder="27600" value={form.labor_ins_grade || ''} onChange={e => set('labor_ins_grade', e.target.value)} />
                    </div>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>加保日期</div>
                      <input className="form-input" type="date" style={{ width: '100%' }} value={form.labor_ins_start || ''} onChange={e => set('labor_ins_start', e.target.value)} />
                    </div>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>退保日期</div>
                      <input className="form-input" type="date" style={{ width: '100%' }} value={form.labor_ins_end || ''} onChange={e => set('labor_ins_end', e.target.value)} />
                    </div>
                  </div>
                )}
              </div>

              {/* 全民健康保險 */}
              <div style={{ padding: '12px 14px', background: 'var(--bg-card)', borderRadius: 10, marginBottom: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: form.health_insurance ? 10 : 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>全民健康保險</span>
                  <label style={{ position: 'relative', width: 44, height: 24, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.health_insurance || false} onChange={e => set('health_insurance', e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                    <span style={{ position: 'absolute', inset: 0, borderRadius: 12, background: form.health_insurance ? 'var(--accent-cyan)' : 'var(--border-medium)', transition: '0.2s' }}>
                      <span style={{ position: 'absolute', top: 2, left: form.health_insurance ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: '0.2s' }} />
                    </span>
                  </label>
                </div>
                {form.health_insurance && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>投保級距</div>
                      <input className="form-input" type="number" style={{ width: '100%' }} placeholder="27600" value={form.health_ins_grade || ''} onChange={e => set('health_ins_grade', e.target.value)} />
                    </div>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>加保日期</div>
                      <input className="form-input" type="date" style={{ width: '100%' }} value={form.health_ins_start || ''} onChange={e => set('health_ins_start', e.target.value)} />
                    </div>
                  </div>
                )}
              </div>

              {/* 勞工退休金 */}
              <div style={{ padding: '12px 14px', background: 'var(--bg-card)', borderRadius: 10, marginBottom: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: form.pension ? 10 : 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>勞工退休金</span>
                  <label style={{ position: 'relative', width: 44, height: 24, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.pension || false} onChange={e => set('pension', e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                    <span style={{ position: 'absolute', inset: 0, borderRadius: 12, background: form.pension ? 'var(--accent-cyan)' : 'var(--border-medium)', transition: '0.2s' }}>
                      <span style={{ position: 'absolute', top: 2, left: form.pension ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: '0.2s' }} />
                    </span>
                  </label>
                </div>
                {form.pension && (
                  <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>提繳率 (%)</div>
                    <input className="form-input" type="number" style={{ width: '100%' }} placeholder="6" value={form.pension_rate || 6} onChange={e => set('pension_rate', e.target.value)} />
                  </div>
                )}
              </div>

              <SectionTitle icon="💬" text="LINE 整合" />
              <div style={{ padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12, color: 'var(--text-muted)' }}>
                LINE 帳號綁定請至「組織管理 → LINE 整合」管理，或由員工在 LINE 輸入 <code>/註冊 姓名</code> 自助綁定。
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, marginTop: 10, border: '1px solid var(--border-subtle)' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>LINE 管理員權限</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>開啟後可在 LINE 使用管理指令</div>
                </div>
                <label style={{ position: 'relative', width: 44, height: 24, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.line_admin || false} onChange={e => set('line_admin', e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                  <span style={{ position: 'absolute', inset: 0, borderRadius: 12, background: form.line_admin ? 'var(--accent-cyan)' : 'var(--border-medium)', transition: '0.2s' }}>
                    <span style={{ position: 'absolute', top: 2, left: form.line_admin ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: '0.2s' }} />
                  </span>
                </label>
              </div>
            </>
          )}

          {/* ═══ 技能 ═══ */}
          {tab === 'skills' && (
            <>
              <SectionTitle icon="🏷️" text="技能 / 證照" />
              {skills.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>尚未新增技能</div>}
              {skills.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{s.skill_name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-cyan" style={{ fontSize: 11 }}>{s.level}</span>
                    <button onClick={() => deleteSkill(s.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.5 }}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input className="form-input" style={{ flex: 1, fontSize: 13 }} placeholder="新增技能 (例如: 拉花、咖啡師)" value={newSkill} onChange={e => setNewSkill(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSkill()} />
                <select className="form-input" style={{ fontSize: 13, width: 80 }} value={newSkillLevel} onChange={e => setNewSkillLevel(e.target.value)}>
                  <option>基礎</option><option>中級</option><option>進階</option><option>專家</option>
                </select>
                <button className="btn btn-sm btn-primary" onClick={addSkill}><Plus size={13} /></button>
              </div>

              <SectionTitle icon="🔑" text="開 / 關店" />
              <div style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.can_open || false} onChange={e => set('can_open', e.target.checked)} /> 可開店
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.can_close || false} onChange={e => set('can_close', e.target.checked)} /> 可關店
                </label>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>AI 排班會優先安排有開/關店能力的員工於營業起始或結束時段</div>

              <SectionTitle icon="⭐" text="排班優先級" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {[
                  { value: 1, label: '最優先', color: '#ef4444', desc: '王牌員工，優先排熱門時段' },
                  { value: 2, label: '優先', color: '#f59e0b', desc: '表現優秀' },
                  { value: 3, label: '一般', color: '#06b6d4', desc: '預設' },
                  { value: 4, label: '低', color: '#94a3b8', desc: '新進/訓練中' },
                  { value: 5, label: '最低', color: '#cbd5e1', desc: '備用人力' },
                ].map(p => (
                  <button key={p.value} onClick={() => set('schedule_priority', p.value)} title={p.desc} style={{
                    flex: 1, padding: '8px 4px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: (form.schedule_priority || 3) === p.value ? p.color : 'var(--bg-card)',
                    color: (form.schedule_priority || 3) === p.value ? '#fff' : 'var(--text-muted)',
                    fontSize: 12, fontWeight: 700,
                    outline: (form.schedule_priority || 3) === p.value ? `2px solid ${p.color}` : '1px solid var(--border-subtle)',
                  }}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                AI 排班會根據優先級決定排班順序，優先級高的員工會先被排入尖峰時段
              </div>
            </>
          )}

          {/* ═══ 性格分析 ═══ */}
          {tab === 'personality' && <PersonalityTab employee={employee} />}

          {/* ═══ 能力發展 ═══ */}
          {tab === 'development' && <DevelopmentTab employee={employee} />}

          {/* ═══ 排班 ═══ */}
          {tab === 'schedule' && (
            <>
              <SectionTitle icon="📅" text="每週可排班時間" />
              <div style={{ background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--glass-light)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700 }}>星期</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700 }}>狀態</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700 }}>偏好班別</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map((day, idx) => {
                      const av = availability.find(a => a.day_of_week === idx)
                      const status = av?.status || '可排班'
                      return (
                        <tr key={idx} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '6px 12px', fontWeight: 600 }}>週{day}</td>
                          <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                              {AVAIL_STATUS.map(s => (
                                <button key={s} onClick={() => setAvail(idx, s)} style={{
                                  padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                                  background: status === s ? AVAIL_COLORS[s] + '22' : 'transparent',
                                  color: status === s ? AVAIL_COLORS[s] : 'var(--text-muted)',
                                  outline: status === s ? `1.5px solid ${AVAIL_COLORS[s]}` : '1px solid var(--border-subtle)',
                                }}>{s}</button>
                              ))}
                            </div>
                          </td>
                          <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                            <select className="form-input" style={{ fontSize: 11, padding: '2px 6px', width: 'auto', minWidth: 80 }}
                              value={av?.preferred_shift || ''} onChange={e => setAvailShift(idx, e.target.value)}>
                              <option value="">—</option>
                              <option value="早班">早班</option>
                              <option value="午班">午班</option>
                              <option value="晚班">晚班</option>
                              <option value="全天">全天</option>
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>AI 排班會參考此設定，避免在「不可」的時段安排班表</div>

              <SectionTitle icon="📋" text="請假 / 排除日期" />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className="btn btn-sm btn-secondary" onClick={() => {}}><Plus size={13} /></button>
              </div>
              {leaveRecords.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無請假紀錄</div>
              ) : leaveRecords.map(lv => (
                <div key={lv.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, border: '1px solid var(--border-subtle)', fontSize: 13 }}>
                  <span>{lv.type} · {lv.start_date} · {lv.days}天</span>
                  <span className={`badge ${lv.status === '已核准' ? 'badge-success' : lv.status === '已駁回' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: 11 }}>{lv.status}</span>
                </div>
              ))}

              <SectionTitle icon="📅" text="排班偏好" />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className="btn btn-sm btn-secondary" onClick={addSchedPref}><Plus size={13} /></button>
              </div>
              {schedPrefs.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無排班偏好</div>
              ) : schedPrefs.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, border: '1px solid var(--border-subtle)', fontSize: 13 }}>
                  <span>{p.notes || p.pref_type}</span>
                  <button onClick={() => deleteSchedPref(p.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.5 }}><Trash2 size={13} /></button>
                </div>
              ))}
            </>
          )}

          {/* ═══ 紀錄 ═══ */}
          {tab === 'records' && (
            <>
              {/* 到職任務 */}
              {onboardingTasks.length > 0 && (() => {
                const completed = onboardingTasks.filter(t => t.status === '已完成').length
                const total = onboardingTasks.length
                const pct = total > 0 ? Math.round(completed / total * 100) : 0
                return (
                  <>
                    <SectionTitle icon="📝" text={`到職 / 工作流程任務 (${completed}/${total})`} />
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                        <span>完成進度</span><span>{pct}%</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--glass-light)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 3, background: pct === 100 ? '#22c55e' : 'var(--accent-cyan)', width: `${pct}%`, transition: 'width 0.3s' }} />
                      </div>
                    </div>
                    {onboardingTasks.map(t => (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, border: '1px solid var(--border-subtle)', fontSize: 13 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16 }}>{t.status === '已完成' ? '✅' : t.status === '進行中' ? '🔄' : '⬜'}</span>
                          <div>
                            <div style={{ fontWeight: 600 }}>{t.title}</div>
                            {t.workflow_instances?.template_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.workflow_instances.template_name}</div>}
                          </div>
                        </div>
                        <span className={`badge ${t.status === '已完成' ? 'badge-success' : t.status === '進行中' ? 'badge-warning' : 'badge-cyan'}`} style={{ fontSize: 11 }}>
                          {t.status}
                        </span>
                      </div>
                    ))}
                  </>
                )
              })()}

              <SectionTitle icon="🎯" text="績效評估" />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className="btn btn-sm btn-secondary" onClick={addReview}><Plus size={13} /></button>
              </div>
              {reviews.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無紀錄</div>
              ) : reviews.map(r => (
                <div key={r.id} style={{ padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 6, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{r.review_date} · {r.reviewer}</span>
                    <span style={{ color: 'var(--accent-orange)', fontWeight: 700 }}>{'⭐'.repeat(r.score || 0)}</span>
                  </div>
                  {r.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{r.notes}</div>}
                </div>
              ))}

              <SectionTitle icon="👥" text={`眷屬 (${dependents.length})`} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className="btn btn-sm btn-secondary" onClick={() => setShowDepForm(!showDepForm)}><Plus size={13} /></button>
              </div>
              {showDepForm && (
                <div style={{ padding: 14, background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--accent-cyan)', marginBottom: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>姓名 *</div>
                      <input className="form-input" style={{ width: '100%', fontSize: 12 }} placeholder="眷屬姓名" value={depForm.name} onChange={e => setDepForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>關係</div>
                      <select className="form-input" style={{ width: '100%', fontSize: 12 }} value={depForm.relationship} onChange={e => setDepForm(f => ({ ...f, relationship: e.target.value }))}>
                        <option>配偶</option><option>子女</option><option>父</option><option>母</option><option>其他</option>
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>身分證字號</div>
                      <input className="form-input" style={{ width: '100%', fontSize: 12 }} placeholder="選填" value={depForm.id_number} onChange={e => setDepForm(f => ({ ...f, id_number: e.target.value }))} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>出生日期</div>
                      <input className="form-input" type="date" style={{ width: '100%', fontSize: 12 }} value={depForm.birth_date} onChange={e => setDepForm(f => ({ ...f, birth_date: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={depForm.health_ins} onChange={e => setDepForm(f => ({ ...f, health_ins: e.target.checked }))} />
                      加保健保（眷屬附加）
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => setShowDepForm(false)} style={{ fontSize: 11 }}>取消</button>
                      <button className="btn btn-sm btn-primary" onClick={addDependent} style={{ fontSize: 11 }}>新增</button>
                    </div>
                  </div>
                </div>
              )}
              {dependents.length === 0 && !showDepForm ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無眷屬</div>
              ) : dependents.map(d => (
                <div key={d.id} style={{ padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                      <span className="badge badge-cyan" style={{ fontSize: 11 }}>{d.relationship || '—'}</span>
                      {d.health_ins && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#22c55e22', color: '#22c55e', fontWeight: 600 }}>健保</span>}
                    </div>
                    <button onClick={() => deleteDependent(d.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.5 }}><Trash2 size={13} /></button>
                  </div>
                  {(d.id_number || d.birth_date) && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {d.id_number && <span>ID: {d.id_number.slice(0, 3)}***</span>}
                      {d.id_number && d.birth_date && <span> · </span>}
                      {d.birth_date && <span>生日: {d.birth_date}</span>}
                    </div>
                  )}
                </div>
              ))}

              <SectionTitle icon="📦" text={`異動紀錄 (${transfers.length})`} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className="btn btn-sm btn-secondary" onClick={addTransfer}><Plus size={13} /></button>
              </div>
              {transfers.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無異動紀錄</div>
              ) : transfers.map(t => (
                <div key={t.id} style={{ padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 6, border: '1px solid var(--border-subtle)', fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>{t.transfer_date}</div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                    {t.from_store || '—'} → {t.to_store || '—'}
                    {t.reason && <span> · {t.reason}</span>}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
