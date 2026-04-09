import { useState, useEffect } from 'react'
import { X, Save, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { updateEmployee } from '../lib/db'

const SPECIAL_CATEGORIES = ['身心障礙者', '中低收入戶', '原住民', '中高齡者 (45+)', '長期失業者', '更生人', '獨力負擔家計者', '家庭暴力被害人', '二度就業婦女']

export default function EmployeeDetail({ employee, employees: allEmployees, stores, departments, lineUsers, onUpdate, onClose }) {
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
      supabase.from('leave_requests').select('*').eq('employee', employee.name).order('id', { ascending: false }).limit(10),
    ]).then(([sk, dep, tr, rev, sp, lv]) => {
      setSkills(sk.data || [])
      setDependents(dep.data || [])
      setTransfers(tr.data || [])
      setReviews(rev.data || [])
      setSchedPrefs(sp.data || [])
      setLeaveRecords(lv.data || [])
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
        await supabase.from('schedules').delete().eq('employee', data.name).gt('date', today)
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

  const addDependent = async () => {
    const name = prompt('眷屬姓名：')
    if (!name) return
    const relationship = prompt('關係（配偶/子女/父母）：') || ''
    try {
      const { data } = await supabase.from('employee_dependents').insert({ employee_id: employee.id, name, relationship }).select().single()
      if (data) setDependents(prev => [...prev, data])
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

  const toggleSpecial = (cat) => {
    const current = form.special_categories || []
    const next = current.includes(cat) ? current.filter(c => c !== cat) : [...current, cat]
    set('special_categories', next)
  }

  const L = { fontSize: 12, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 4, marginTop: 14 }
  const SectionTitle = ({ icon, text }) => (
    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 20, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>{icon} {text}</div>
  )

  const TABS = [
    { key: 'personal', label: '個人資訊' },
    { key: 'org', label: '組織' },
    { key: 'skills', label: '技能' },
    { key: 'schedule', label: '排班' },
    { key: 'records', label: '紀錄' },
  ]

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', width: '100vw', height: '100vh' }}
      onMouseDown={e => { if (e.target === e.currentTarget) handleClose() }}>
      <div style={{ width: '100%', maxWidth: 720, maxHeight: '90vh', background: 'var(--bg-primary)', border: '1px solid var(--border-medium)', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: 'auto' }}>

        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: employee.avatar || '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: '#fff' }}>
            {employee.name?.[0]}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{employee.name}
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', marginLeft: 8 }}>EMP-{String(employee.id).padStart(3, '0')}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{employee.position || '未設定職位'} · {employee.employment_type || '全職'}</div>
          </div>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 13 }}>
            <Save size={13} /> {saving ? '...' : '更新'}
          </button>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, padding: '0 24px' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '10px 18px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: 'transparent', color: tab === t.key ? 'var(--accent-cyan)' : 'var(--text-muted)',
              borderBottom: tab === t.key ? '2px solid var(--accent-cyan)' : '2px solid transparent',
            }}>{t.label}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>

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
                <div><div style={L}>身分證字號</div><input className="form-input" style={{ width: '100%' }} value={form.id_number || ''} onChange={e => set('id_number', e.target.value)} /></div>
              </div>
              <div><div style={L}>地址</div><input className="form-input" style={{ width: '100%' }} value={form.address || ''} onChange={e => set('address', e.target.value)} /></div>

              <SectionTitle icon="🚨" text="緊急聯絡人" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div style={L}>姓名</div><input className="form-input" style={{ width: '100%' }} value={form.emergency_name || ''} onChange={e => set('emergency_name', e.target.value)} /></div>
                <div><div style={L}>電話</div><input className="form-input" style={{ width: '100%' }} value={form.emergency_phone || ''} onChange={e => set('emergency_phone', e.target.value)} /></div>
              </div>

              <SectionTitle icon="🏦" text="銀行帳戶" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                <div><div style={L}>銀行代碼</div><input className="form-input" style={{ width: '100%' }} value={form.bank_code || '004'} onChange={e => set('bank_code', e.target.value)} /></div>
                <div><div style={L}>帳號</div><input className="form-input" style={{ width: '100%' }} value={form.bank_account || ''} onChange={e => set('bank_account', e.target.value)} /></div>
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
                    <option>全職</option><option>兼職</option><option>PT</option><option>實習</option>
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
              <div><div style={L}>門市</div>
                <select className="form-input" style={{ width: '100%' }} value={form.store || ''} onChange={e => set('store', e.target.value)}>
                  <option value="">未指派</option>
                  {(stores || []).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
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
              {[
                { key: 'labor_insurance', label: '勞工保險' },
                { key: 'health_insurance', label: '全民健康保險' },
                { key: 'pension', label: '勞工退休金' },
              ].map(ins => (
                <div key={ins.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 6, border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{ins.label}</span>
                  <label style={{ position: 'relative', width: 44, height: 24, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form[ins.key] || false} onChange={e => set(ins.key, e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                    <span style={{ position: 'absolute', inset: 0, borderRadius: 12, background: form[ins.key] ? 'var(--accent-cyan)' : 'var(--border-medium)', transition: '0.2s' }}>
                      <span style={{ position: 'absolute', top: 2, left: form[ins.key] ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: '0.2s' }} />
                    </span>
                  </label>
                </div>
              ))}

              <SectionTitle icon="💬" text="LINE 整合" />
              <div><div style={L}>綁定個人 LINE 帳號</div>
                <select className="form-input" style={{ width: '100%' }} value={form.line_user_id || ''} onChange={e => set('line_user_id', e.target.value)}>
                  <option value="">未綁定</option>
                  {(lineUsers || []).map(u => (
                    <option key={u.line_user_id} value={u.line_user_id}>
                      {u.display_name} {form.line_user_id === u.line_user_id ? '(目前綁定)' : ''}
                    </option>
                  ))}
                </select>
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

          {/* ═══ 排班 ═══ */}
          {tab === 'schedule' && (
            <>
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
                <button className="btn btn-sm btn-secondary" onClick={addDependent}><Plus size={13} /></button>
              </div>
              {dependents.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無眷屬</div>
              ) : dependents.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, border: '1px solid var(--border-subtle)', fontSize: 13 }}>
                  <span>{d.name} · {d.relationship || '—'}</span>
                  <button onClick={() => deleteDependent(d.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.5 }}><Trash2 size={13} /></button>
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
