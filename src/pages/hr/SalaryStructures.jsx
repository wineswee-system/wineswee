import { useState, useEffect, useMemo } from 'react'
import { Plus, Edit2, DollarSign, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

const emptyForm = {
  employee_id: '',
  base_salary: '',
  role_allowance: '',
  meal_allowance: '',
  transport_allowance: '',
  attendance_bonus: '',
  salary_type: 'monthly',
  hourly_rate: '',
  health_ins_dependents: '0',
  effective_from: new Date().toISOString().slice(0, 10),
  year_end_bonus_months: '',
  notes: '',
}

export default function SalaryStructures() {
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
    setLoading(true)
    Promise.all([
      supabase.from('salary_structures').select('*').order('id', { ascending: false }),
      supabase.from('employees').select('id, name, department_id, store_id, departments(name), stores(name)').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
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

  useEffect(() => { loadData() }, [])

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
      role_allowance: String(s.role_allowance || ''),
      meal_allowance: String(s.meal_allowance || ''),
      transport_allowance: String(s.transport_allowance || ''),
      attendance_bonus: String(s.attendance_bonus || ''),
      salary_type: s.salary_type || 'monthly',
      hourly_rate: String(s.hourly_rate || ''),
      health_ins_dependents: String(s.health_ins_dependents || 0),
      effective_from: s.effective_from || new Date().toISOString().slice(0, 10),
      year_end_bonus_months: String(s.year_end_bonus_months || ''),
      notes: s.notes || '',
    })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    if (!form.employee_id) return alert('請選擇員工')
    const payload = {
      employee_id: Number(form.employee_id),
      base_salary: Number(form.base_salary) || 0,
      role_allowance: Number(form.role_allowance) || 0,
      meal_allowance: Number(form.meal_allowance) || 0,
      transport_allowance: Number(form.transport_allowance) || 0,
      attendance_bonus: Number(form.attendance_bonus) || 0,
      salary_type: form.salary_type,
      hourly_rate: form.salary_type === 'hourly' ? (Number(form.hourly_rate) || 0) : null,
      health_ins_dependents: Number(form.health_ins_dependents) || 0,
      effective_from: form.effective_from,
      year_end_bonus_months: Number(form.year_end_bonus_months) || 0,
      notes: form.notes || '',
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
      alert('操作失敗：' + (err.message || '未知錯誤'))
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
                {['員工', '部門', '門市', '薪資類型', '底薪', '職務津貼', '餐費津貼', '交通津貼', '全勤獎金', '生效日', '操作'].map(h => (
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
                    <td style={{ padding: '10px 14px' }}>{fmt(s.base_salary)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(s.role_allowance)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(s.meal_allowance)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(s.transport_allowance)}</td>
                    <td style={{ padding: '10px 14px' }}>{fmt(s.attendance_bonus)}</td>
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
            <select className="form-input" value={form.employee_id} onChange={e => set('employee_id', e.target.value)} disabled={!!editingId}>
              <option value="">請選擇員工</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}（{e.dept || '-'} / {e.store || '-'}）</option>)}
            </select>
          </Field>
          <Field label="薪資類型">
            <select className="form-input" value={form.salary_type} onChange={e => set('salary_type', e.target.value)}>
              <option value="monthly">月薪</option>
              <option value="hourly">時薪</option>
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="底薪">
              <input className="form-input" type="number" value={form.base_salary} onChange={e => set('base_salary', e.target.value)} placeholder="0" />
            </Field>
            {form.salary_type === 'hourly' && (
              <Field label="時薪">
                <input className="form-input" type="number" value={form.hourly_rate} onChange={e => set('hourly_rate', e.target.value)} placeholder="0" />
              </Field>
            )}
            <Field label="職務津貼">
              <input className="form-input" type="number" value={form.role_allowance} onChange={e => set('role_allowance', e.target.value)} placeholder="0" />
            </Field>
            <Field label="餐費津貼">
              <input className="form-input" type="number" value={form.meal_allowance} onChange={e => set('meal_allowance', e.target.value)} placeholder="0" />
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
            <Field label="年終獎金月數">
              <input className="form-input" type="number" value={form.year_end_bonus_months} onChange={e => set('year_end_bonus_months', e.target.value)} placeholder="0" step="0.5" />
            </Field>
          </div>
          <Field label="生效日">
            <input className="form-input" type="date" value={form.effective_from} onChange={e => set('effective_from', e.target.value)} />
          </Field>
          <Field label="備註">
            <textarea className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="備註說明..." />
          </Field>
        </Modal>
      )}
    </div>
  )
}
