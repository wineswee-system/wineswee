import { useState, useEffect, useMemo } from 'react'
import { Plus, Edit2, DollarSign, Users, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'
import { useAuth } from '../../contexts/AuthContext'

import { toast } from '../../lib/toast'
const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

// 內建常見津貼項目，廠商可一鍵加入；也支援完全自訂
const PRESET_ALLOWANCES = [
  '夜班津貼', '主管加給', '證照津貼', '外語津貼',
  '專業加給', '危險津貼', '久任津貼', '油資補貼',
  '通訊費補助', '託兒津貼', '房屋津貼', '績效獎金',
]

const emptyForm = {
  employee_id: '',
  base_salary: '',           // 本薪（合約名義）
  base_insured: '',          // 申報底薪（投保用）— 雙基薪制
  role_allowance: '',        // 職務津貼
  supervisor_allowance: '',  // 主管加給
  meal_allowance: '',
  transport_allowance: '',
  night_shift_allowance: '', // 夜班津貼
  cross_store_allowance: '', // 跨區津貼
  attendance_bonus: '',
  salary_type: 'monthly',
  hourly_rate: '',
  health_ins_dependents: '0',
  insurance_grade_id: '',    // 投保級距 (預留 fk)
  effective_from: new Date().toISOString().slice(0, 10),
  year_end_bonus_months: '',
  notes: '',
  custom_allowances: [],     // [{name, amount}]
}

export default function SalaryStructures() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id
  const [structures, setStructures] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const loadData = () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      supabase.from('salary_structures').select('*').eq('organization_id', orgId).order('id', { ascending: false }),
      supabase.from('employees').select('id, name, name_en, dept, store, position, department_id, store_id, departments!department_id(name), stores!store_id(name)').eq('status', '在職').eq('organization_id', orgId).order('name'),
      supabase.from('departments').select('*').eq('organization_id', orgId).order('name'),
    ]).then(([s, e, d]) => {
      setStructures(s.data || [])
      setEmployees(e.data || [])
      setDepartments(d.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }

  useEffect(() => { loadData() }, [orgId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const empMap = useMemo(() => {
    const m = {}
    employees.forEach(e => { m[e.id] = e })
    return m
  }, [employees])

  const filtered = useMemo(() => {
    if (!deptFilter) return structures
    return structures.filter(s => {
      const emp = empMap[s.employee_id]
      return emp && emp.dept === deptFilter
    })
  }, [structures, deptFilter, empMap])

  // Summary cards
  const totalConfigured = new Set(structures.map(s => s.employee_id)).size
  const avgBase = structures.length > 0
    ? Math.round(structures.reduce((sum, s) => sum + (s.base_salary || 0), 0) / structures.length)
    : 0

  const openAdd = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  const openEdit = (s) => {
    setEditingId(s.id)
    setForm({
      employee_id: String(s.employee_id || ''),
      base_salary: String(s.base_salary || ''),
      base_insured: String(s.base_insured || ''),
      role_allowance: String(s.role_allowance || ''),
      supervisor_allowance: String(s.supervisor_allowance || ''),
      meal_allowance: String(s.meal_allowance || ''),
      transport_allowance: String(s.transport_allowance || ''),
      night_shift_allowance: String(s.night_shift_allowance || ''),
      cross_store_allowance: String(s.cross_store_allowance || ''),
      attendance_bonus: String(s.attendance_bonus || ''),
      salary_type: s.salary_type || 'monthly',
      hourly_rate: String(s.hourly_rate || ''),
      health_ins_dependents: String(s.health_ins_dependents || 0),
      insurance_grade_id: String(s.insurance_grade_id || ''),
      effective_from: s.effective_from || new Date().toISOString().slice(0, 10),
      year_end_bonus_months: String(s.year_end_bonus_months || ''),
      notes: s.notes || '',
      custom_allowances: Array.isArray(s.custom_allowances) ? s.custom_allowances : [],
    })
    setShowModal(true)
  }

  // 自訂津貼操作
  const addCustomAllowance = (preset) => {
    const name = preset || ''
    setForm(f => ({
      ...f,
      custom_allowances: [...(f.custom_allowances || []), { name, amount: 0 }],
    }))
  }
  const updateCustomAllowance = (idx, key, val) => {
    setForm(f => ({
      ...f,
      custom_allowances: f.custom_allowances.map((c, i) => i === idx ? { ...c, [key]: val } : c),
    }))
  }
  const removeCustomAllowance = (idx) => {
    setForm(f => ({
      ...f,
      custom_allowances: f.custom_allowances.filter((_, i) => i !== idx),
    }))
  }

  const handleSubmit = async () => {
    if (!form.employee_id) return toast.warning('請選擇員工')
    const payload = {
      employee_id: Number(form.employee_id),
      organization_id: orgId,
      base_salary: Number(form.base_salary) || 0,
      base_insured: Number(form.base_insured) || Number(form.base_salary) || 0,  // 沒填投保底薪預設等於本薪
      role_allowance: Number(form.role_allowance) || 0,
      supervisor_allowance: Number(form.supervisor_allowance) || 0,
      meal_allowance: Number(form.meal_allowance) || 0,
      transport_allowance: Number(form.transport_allowance) || 0,
      night_shift_allowance: Number(form.night_shift_allowance) || 0,
      cross_store_allowance: Number(form.cross_store_allowance) || 0,
      attendance_bonus: Number(form.attendance_bonus) || 0,
      salary_type: form.salary_type,
      // hourly_rate DB 為 NOT NULL DEFAULT 0；月薪人員直接送 0，PT 才送實際值
      hourly_rate: form.salary_type === 'hourly' ? (Number(form.hourly_rate) || 0) : 0,
      health_ins_dependents: Number(form.health_ins_dependents) || 0,
      insurance_grade_id: form.insurance_grade_id ? Number(form.insurance_grade_id) : null,
      effective_from: form.effective_from,
      year_end_bonus_months: Number(form.year_end_bonus_months) || 0,
      notes: form.notes || '',
      custom_allowances: (form.custom_allowances || [])
        .filter(c => c.name && c.name.trim())
        .map(c => ({ name: c.name.trim(), amount: Number(c.amount) || 0 })),
    }
    try {
      if (editingId) {
        const { data, error } = await supabase.from('salary_structures').update(payload).eq('id', editingId).select().single()
        if (error) throw error
        setStructures(prev => prev.map(s => s.id === editingId ? data : s))
      } else {
        const { data, error } = await supabase.from('salary_structures').insert(payload).select().single()
        if (error) throw error
        setStructures(prev => [data, ...prev])
      }
      setShowModal(false)
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>⚠ {error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>薪資結構管理</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>設定員工底薪、津貼及薪資類型</p>
          </div>
          <button className="btn btn-primary" onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={16} /> 新增薪資結構
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Users size={18} style={{ color: 'var(--accent-cyan)' }} />
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>已設定員工數</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{totalConfigured}</div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <DollarSign size={18} style={{ color: 'var(--accent-green)' }} />
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>平均底薪</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(avgBase)}</div>
        </div>
      </div>

      {/* Dept Filter */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>部門篩選：</label>
        <select className="form-input" value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={{ width: 180 }}>
          <option value="">全部部門</option>
          {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-tertiary)' }}>
                {['員工', '部門', '門市', '薪資類型', '本薪 / 投保', '主管/夜班/跨區', '職務/餐費/交通', '全勤', '其他津貼', '生效日', '操作'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>尚無薪資結構資料</td></tr>
              ) : filtered.map(s => {
                const emp = empMap[s.employee_id]
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{emp?.name || `#${s.employee_id}`}</td>
                    <td style={{ padding: '10px 14px' }}>{emp?.dept || '-'}</td>
                    <td style={{ padding: '10px 14px' }}>{emp?.store || '-'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        background: s.salary_type === 'monthly' ? 'rgba(0,200,150,0.15)' : 'rgba(0,150,255,0.15)',
                        color: s.salary_type === 'monthly' ? 'var(--accent-green)' : 'var(--accent-cyan)',
                      }}>
                        {s.salary_type === 'monthly' ? '月薪' : '時薪'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, lineHeight: 1.3 }}>
                      <div style={{ fontWeight: 600 }}>{fmt(s.base_salary)}</div>
                      <div style={{ color: 'var(--text-muted)' }}>投保 {fmt(s.base_insured || s.base_salary)}</div>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, lineHeight: 1.3 }}>
                      <div>{fmt(s.supervisor_allowance)}</div>
                      <div style={{ color: 'var(--text-muted)' }}>{fmt(s.night_shift_allowance)} / {fmt(s.cross_store_allowance)}</div>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, lineHeight: 1.3 }}>
                      <div>{fmt(s.role_allowance)}</div>
                      <div style={{ color: 'var(--text-muted)' }}>{fmt(s.meal_allowance)} / {fmt(s.transport_allowance)}</div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>{fmt(s.attendance_bonus)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      {Array.isArray(s.custom_allowances) && s.custom_allowances.length > 0 ? (
                        <div title={s.custom_allowances.map(c => `${c.name}: ${fmt(c.amount)}`).join('\n')}>
                          {fmt(s.custom_allowances.reduce((sum, c) => sum + (Number(c.amount) || 0), 0))}
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
                            ({s.custom_allowances.length} 項)
                          </span>
                        </div>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{s.effective_from || '-'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <button onClick={() => openEdit(s)} style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', padding: 4 }}>
                        <Edit2 size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal title={editingId ? '編輯薪資結構' : '新增薪資結構'} onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="員工">
            <SearchableSelect
              value={form.employee_id}
              onChange={(v) => set('employee_id', v || '')}
              options={empOptions(employees)}
              placeholder="搜尋員工姓名/部門/門市..."
              disabled={!!editingId}
            />
          </Field>
          <Field label="薪資類型">
            <select className="form-input" value={form.salary_type} onChange={e => set('salary_type', e.target.value)}>
              <option value="monthly">月薪</option>
              <option value="hourly">時薪</option>
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="本薪 (合約名義)">
              <input className="form-input" type="number" value={form.base_salary} onChange={e => set('base_salary', e.target.value)} placeholder="0" />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>合約上的薪資</div>
            </Field>
            <Field label="申報底薪 (投保用)">
              <input className="form-input" type="number" value={form.base_insured} onChange={e => set('base_insured', e.target.value)} placeholder="預設等於本薪" />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>勞健保 / 勞退提撥基準</div>
            </Field>
            {form.salary_type === 'hourly' && (
              <Field label="時薪">
                <input className="form-input" type="number" value={form.hourly_rate} onChange={e => set('hourly_rate', e.target.value)} placeholder="0" />
              </Field>
            )}
            <Field label="主管加給">
              <input className="form-input" type="number" value={form.supervisor_allowance} onChange={e => set('supervisor_allowance', e.target.value)} placeholder="0" />
            </Field>
            <Field label="職務津貼">
              <input className="form-input" type="number" value={form.role_allowance} onChange={e => set('role_allowance', e.target.value)} placeholder="0" />
            </Field>
            <Field label="夜班津貼">
              <input className="form-input" type="number" value={form.night_shift_allowance} onChange={e => set('night_shift_allowance', e.target.value)} placeholder="0" />
            </Field>
            <Field label="跨區津貼">
              <input className="form-input" type="number" value={form.cross_store_allowance} onChange={e => set('cross_store_allowance', e.target.value)} placeholder="0" />
            </Field>
            <Field label="餐費津貼">
              <input className="form-input" type="number" value={form.meal_allowance} onChange={e => set('meal_allowance', e.target.value)} placeholder="0" />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>NT$ 3,000 以下免稅</div>
            </Field>
            <Field label="交通津貼">
              <input className="form-input" type="number" value={form.transport_allowance} onChange={e => set('transport_allowance', e.target.value)} placeholder="0" />
            </Field>
            <Field label="全勤獎金">
              <input className="form-input" type="number" value={form.attendance_bonus} onChange={e => set('attendance_bonus', e.target.value)} placeholder="0" />
            </Field>
            <Field label="健保眷屬人數">
              <input className="form-input" type="number" value={form.health_ins_dependents} onChange={e => set('health_ins_dependents', e.target.value)} min="0" />
            </Field>
            <Field label="投保級距 ID (選填)">
              <input className="form-input" type="number" value={form.insurance_grade_id} onChange={e => set('insurance_grade_id', e.target.value)} placeholder="—" />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>之後接 insurance_grades 表</div>
            </Field>
            <Field label="年終獎金月數">
              <input className="form-input" type="number" value={form.year_end_bonus_months} onChange={e => set('year_end_bonus_months', e.target.value)} placeholder="0" step="0.5" />
            </Field>
          </div>
          <Field label="生效日">
            <input className="form-input" type="date" value={form.effective_from} onChange={e => set('effective_from', e.target.value)} />
          </Field>

          {/* ─── 自訂津貼 ─── */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                其他自訂津貼
              </label>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {(form.custom_allowances || []).length} 項
              </span>
            </div>

            {/* 預設快選 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {PRESET_ALLOWANCES.map(name => {
                const used = (form.custom_allowances || []).some(c => c.name === name)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => !used && addCustomAllowance(name)}
                    disabled={used}
                    style={{
                      padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: used ? 'default' : 'pointer',
                      border: '1px solid var(--border-subtle)',
                      background: used ? 'var(--bg-tertiary)' : 'transparent',
                      color: used ? 'var(--text-muted)' : 'var(--accent-cyan)',
                      opacity: used ? 0.5 : 1,
                    }}
                  >
                    {used ? '✓ ' : '+ '}{name}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => addCustomAllowance('')}
                style={{
                  padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                  border: '1px dashed var(--accent-purple)',
                  background: 'rgba(167,139,250,0.08)', color: 'var(--accent-purple)',
                }}
              >+ 完全自訂</button>
            </div>

            {/* 已加入的津貼列表 */}
            {(form.custom_allowances || []).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {form.custom_allowances.map((c, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      className="form-input"
                      placeholder="津貼名稱"
                      value={c.name}
                      onChange={e => updateCustomAllowance(idx, 'name', e.target.value)}
                      style={{ flex: 2 }}
                    />
                    <input
                      className="form-input"
                      type="number"
                      placeholder="金額"
                      value={c.amount}
                      onChange={e => updateCustomAllowance(idx, 'amount', e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => removeCustomAllowance(idx)}
                      style={{
                        background: 'transparent', border: '1px solid var(--border-subtle)',
                        color: 'var(--accent-red)', cursor: 'pointer',
                        borderRadius: 6, padding: 6, display: 'flex',
                      }}
                    ><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Field label="備註">
            <textarea className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="備註說明..." />
          </Field>
        </Modal>
      )}
    </div>
  )
}
