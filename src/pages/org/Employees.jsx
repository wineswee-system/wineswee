import { useState, useEffect } from 'react'
import { Plus, Search, UserMinus, UserPlus, Pencil, Mail, Upload, Building2, Trash2, Users } from 'lucide-react'
import { getEmployees, createEmployee, updateEmployee, inviteEmployee } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { createAssignment, rotatePrimary, closeActivePrimary } from '../../lib/assignments'
import LoadingSpinner from '../../components/LoadingSpinner'
import MaskedText from '../../components/MaskedText'
import Modal, { Field } from '../../components/Modal'
import EmployeeDetail from '../../components/EmployeeDetail'
import AssignmentCsvImport from '../../components/employee/AssignmentCsvImport'

const AVATARS = ['#3b82f6', '#a78bfa', '#f472b6', '#34d399', '#fb923c', '#22d3ee', '#f87171', '#fbbf24']

const EMPLOYMENT_TYPES = [
  { value: '全職', label: '全職', color: '#22c55e' },
  { value: '兼職', label: '兼職', color: '#f59e0b' },
]

// 標準化職稱（manager = 有審核權限）
const POSITIONS = [
  { label: '總經理', level: 'admin' },
  { label: '副總經理', level: 'admin' },
  { label: '總監', level: 'manager' },
  { label: '經理', level: 'manager' },
  { label: '副理', level: 'manager' },
  { label: '主管', level: 'manager' },
  { label: '店長', level: 'manager' },
  { label: '副店長', level: 'manager' },
  { label: '組長', level: 'manager' },
  { label: '資深工程師', level: 'office_staff' },
  { label: '工程師', level: 'office_staff' },
  { label: '專員', level: 'office_staff' },
  { label: '行政助理', level: 'office_staff' },
  { label: '會計', level: 'office_staff' },
  { label: '業務代表', level: 'store_staff' },
  { label: '門市人員', level: 'store_staff' },
  { label: '收銀員', level: 'store_staff' },
  { label: '倉管人員', level: 'store_staff' },
  { label: '助理', level: 'store_staff' },
  { label: '實習生', level: 'store_staff' },
]

export default function Employees() {
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('在職')
  const [typeFilter, setTypeFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showResignModal, setShowResignModal] = useState(false)
  const [showRehireModal, setShowRehireModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [resignDate, setResignDate] = useState('')
  const [resignReason, setResignReason] = useState('')
  const [editForm, setEditForm] = useState({})
  const [form, setForm] = useState({ name: '', name_en: '', department_id: null, position: '', store_id: null, email: '', phone: '', join_date: '', status: '在職', employment_type: '全職', salary_type: 'monthly', base_salary: '', hourly_rate: '', weekly_hours: '40' })
  const [detailEmp, setDetailEmp] = useState(null)
  const [detailClickY, setDetailClickY] = useState(null)
  const [showCsvImport, setShowCsvImport] = useState(false)
  const [pageTab, setPageTab] = useState('employees')
  const [showDeptModal, setShowDeptModal] = useState(false)
  const [editingDept, setEditingDept] = useState(null)

  const deptName = (id) => departments.find(d => d.id === id)?.name || ''
  const storeName = (id) => locations.find(l => l.id === id)?.name || ''

  useEffect(() => {
    Promise.all([
      getEmployees(),
      supabase.from('departments').select('*').order('name'),
      supabase.from('stores').select('*').order('name'),
    ]).then(([e, d, l]) => {
      const depts = d.data || []
      const locs = l.data || []
      setEmployees(e.data || [])
      setDepartments(depts)
      setLocations(locs)
      setForm(f => ({ ...f, department_id: depts[0]?.id || null, store_id: locs[0]?.id || null }))
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // 新增員工
  const handleSubmit = async () => {
    if (!form.name || !form.email) return
    try {
      const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)]
      const posInfo = POSITIONS.find(p => p.label === form.position)
      const role = posInfo?.level || 'store_staff'
      const payload = {
        ...form,
        department_id: form.department_id ? Number(form.department_id) : null,
        store_id: form.store_id ? Number(form.store_id) : null,
        avatar,
        role,
      }
      const { data, error } = await createEmployee(payload)
      if (error) throw error
      if (data) {
        setEmployees(prev => [...prev, data])
        setShowModal(false)
        // Create 主要 assignment for the new hire
        await createAssignment({
          employee_id: data.id,
          department_id: data.department_id ?? null,
          store_id: data.store_id ?? null,
          position: data.position || null,
          employment_type: data.employment_type || '全職',
          start_date: data.join_date || new Date().toISOString().slice(0, 10),
          is_active: data.status === '在職',
        })
        setForm({ name: '', name_en: '', department_id: departments[0]?.id || null, position: '', store_id: locations[0]?.id || null, email: '', phone: '', join_date: '', status: '在職', employment_type: '全職', salary_type: 'monthly', base_salary: '', hourly_rate: '', weekly_hours: '40' })
        // Auto-start onboarding workflow if template exists
        const { data: tpl } = await supabase.from('sop_templates')
          .select('*').or('name.ilike.%新人%到職%,name.ilike.%onboarding%').limit(1).maybeSingle()
        if (tpl) {
          const storeLabel = storeName(data.store_id)
          const { data: inst } = await supabase.from('workflow_instances').insert({
            template_name: tpl.name, store: storeLabel,
            status: '進行中', started_by: '系統',
          }).select().single()
          if (inst && tpl.steps?.length) {
            const stepRows = tpl.steps.map((s, i) => ({
              instance_id: inst.id, step_order: i + 1,
              title: s.title, description: s.description,
              role: s.role, assignee: data.name,
              store: storeLabel, status: '待處理',
            }))
            await supabase.from('workflow_steps').insert(stepRows)
          }
        }
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  // 發送邀請信
  const handleInvite = async (emp) => {
    if (!emp.email) { alert('此員工沒有設定 Email，請先編輯填入 Email'); return }
    if (!confirm(`確定要發送帳號邀請信給 ${emp.name}（${emp.email}）？`)) return
    try {
      const result = await inviteEmployee(emp.email, emp.name)
      if (result.ok) {
        alert(result.message)
      } else {
        alert('發送失敗：' + (result.error || '未知錯誤'))
      }
    } catch (err) {
      alert('發送失敗：' + err.message)
    }
  }

  // 離職
  const openResign = (emp) => {
    setSelectedEmp(emp)
    setResignDate(new Date().toISOString().slice(0, 10))
    setResignReason('')
    setShowResignModal(true)
  }
  const handleResign = async () => {
    if (!selectedEmp) return
    try {
      const { data, error } = await updateEmployee(selectedEmp.id, {
        status: '離職',
        resign_date: resignDate,
        resign_reason: resignReason,
      })
      if (error) throw error
      if (data) {
        setEmployees(prev => prev.map(e => e.id === selectedEmp.id ? data : e))
        setShowResignModal(false)
        // Close active 主要 assignment with the resignation date
        await closeActivePrimary(data.id, resignDate)
        // Cleanup: remove future schedules, cancel pending leaves/tasks
        const today = new Date().toISOString().slice(0, 10)
        await supabase.from('schedules').delete().eq('employee_id', data.id).gt('date', today)
        await supabase.from('leave_requests').update({ status: '已取消' }).eq('employee_id', data.id).eq('status', '待審核')
        await supabase.from('tasks').update({ status: '已擱置' }).eq('assignee_id', data.id).in('status', ['未開始', '進行中'])
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  // 編輯
  const openEdit = (emp) => {
    setSelectedEmp(emp)
    setEditForm({
      name: emp.name || '', name_en: emp.name_en || '',
      department_id: emp.department_id ?? null, position: emp.position || '',
      store_id: emp.store_id ?? null, email: emp.email || '',
      phone: emp.phone || '', join_date: emp.join_date || '',
      employment_type: emp.employment_type || '全職',
      system_role: emp.role || 'store_staff',
    })
    setShowEditModal(true)
  }
  const setE = (k, v) => setEditForm(f => ({ ...f, [k]: v }))
  const handleEdit = async () => {
    if (!selectedEmp) { alert('未選擇員工'); return }
    try {
      const { system_role, join_date, department_id, store_id, ...rest } = editForm
      const role = system_role || selectedEmp.role || 'store_staff'
      // Convert empty strings to null for unique-constrained fields
      if (rest.email !== undefined) rest.email = rest.email?.trim() || null
      if (rest.phone !== undefined) rest.phone = rest.phone?.trim() || null
      if (join_date) rest.join_date = join_date
      const payload = {
        ...rest,
        role,
        department_id: department_id ? Number(department_id) : null,
        store_id: store_id ? Number(store_id) : null,
      }
      const { data, error } = await updateEmployee(selectedEmp.id, payload)
      if (error) throw error
      if (data) {
        setEmployees(prev => prev.map(e => e.id === selectedEmp.id ? data : e))
        setShowEditModal(false)
        // Rotate 主要 assignment if dept/store/position/employment_type changed
        await rotatePrimary(data.id, {
          department_id: data.department_id ?? null,
          store_id: data.store_id ?? null,
          position: data.position || null,
          employment_type: data.employment_type || '全職',
        })
      } else {
        // .single() returned no rows — try without .single()
        const { error: e2 } = await supabase.from('employees').update(payload).eq('id', selectedEmp.id)
        if (e2) throw e2
        setEmployees(prev => prev.map(e => e.id === selectedEmp.id ? { ...e, ...payload } : e))
        setShowEditModal(false)
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  // 復職
  const openRehire = (emp) => { setSelectedEmp(emp); setShowRehireModal(true) }
  const handleRehire = async () => {
    if (!selectedEmp) return
    try {
      const { data, error } = await updateEmployee(selectedEmp.id, {
        status: '在職',
        resign_date: null,
        resign_reason: null,
      })
      if (error) throw error
      if (data) {
        setEmployees(prev => prev.map(e => e.id === selectedEmp.id ? data : e))
        setShowRehireModal(false)
        // Open a fresh 主要 assignment on rehire
        await createAssignment({
          employee_id: data.id,
          department_id: data.department_id ?? null,
          store_id: data.store_id ?? null,
          position: data.position || null,
          employment_type: data.employment_type || '全職',
          start_date: new Date().toISOString().slice(0, 10),
          is_active: true,
        })
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = employees.filter(e =>
    !e.is_archived &&
    (statusFilter === '' || e.status === statusFilter) &&
    (typeFilter === '' || (e.employment_type || '全職') === typeFilter) &&
    (storeFilter === '' || e.store_id === Number(storeFilter)) &&
    (deptFilter === '' || e.department_id === Number(deptFilter)) &&
    (search === '' || e.name?.includes(search) || e.name_en?.toLowerCase().includes(search.toLowerCase()) || e.email?.includes(search) || e.employee_number?.includes(search))
  )



  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">👤</span> 員工</h2>
            <p>員工基本資料管理（到職 / 離職）</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setShowCsvImport(true)}><Upload size={14} /> 匯入指派 CSV</button>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增員工（到職）</button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', padding: 4, borderRadius: 10, width: 'fit-content', border: '1px solid var(--border-medium)' }}>
        <button onClick={() => setPageTab('employees')} style={{
          padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 6,
          background: pageTab === 'employees' ? 'var(--accent-cyan)' : 'transparent',
          color: pageTab === 'employees' ? '#fff' : 'var(--text-secondary)',
        }}>
          <Users size={14} /> 員工 ({employees.filter(e => e.status === '在職').length})
        </button>
        <button onClick={() => setPageTab('departments')} style={{
          padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 6,
          background: pageTab === 'departments' ? 'var(--accent-cyan)' : 'transparent',
          color: pageTab === 'departments' ? '#fff' : 'var(--text-secondary)',
        }}>
          <Building2 size={14} /> 部門管理 ({departments.length})
        </button>
      </div>

      {/* ══ Department Card View ══ */}
      {pageTab === 'departments' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {departments.map(dept => {
            const manager = employees.find(e => e.id === dept.manager_id)
            const members = employees.filter(e => (e.department_id === dept.id || e.dept === dept.name) && e.status === '在職')
            return (
              <div key={dept.id} className="card" style={{ padding: '18px 20px', position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Building2 size={16} style={{ color: 'var(--accent-cyan)' }} />
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{dept.name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm btn-secondary" style={{ padding: '4px 6px' }}
                      onClick={() => { setEditingDept(dept); setForm({ name: dept.name || '', manager_id: dept.manager_id || '', description: dept.description || '', level: dept.level || '部', parent_department_id: dept.parent_department_id || '' }); setShowDeptModal(true) }}>
                      <Pencil size={12} />
                    </button>
                    <button className="btn btn-sm btn-secondary" style={{ padding: '4px 6px', color: 'var(--accent-red)' }}
                      onClick={async () => { if (!confirm(`確定刪除「${dept.name}」？`)) return; const { error } = await supabase.from('departments').delete().eq('id', dept.id); if (!error) setDepartments(prev => prev.filter(d => d.id !== dept.id)) }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>主管</span>
                  <span style={{ marginLeft: 8 }}>👤 {manager?.name || dept.head || '—'}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>成員</span>
                  <span style={{ marginLeft: 8, fontWeight: 700, color: 'var(--accent-cyan)' }}>{members.length}人</span>
                </div>
                {members.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {members.slice(0, 8).map(m => (
                      <button key={m.id} onClick={ev => { setDetailClickY(ev.clientY); setDetailEmp(m) }} style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px 3px 3px',
                        borderRadius: 20, border: '1px solid var(--border-subtle)', background: 'var(--glass-light)',
                        cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
                      }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%', background: m.avatar || AVATARS[m.id % AVATARS.length],
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 700, color: '#fff',
                        }}>{m.name?.[0]}</div>
                        {m.name}
                      </button>
                    ))}
                    {members.length > 8 && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>+{members.length - 8}</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {pageTab === 'employees' && <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">在職</div>
          <div className="stat-card-value">{employees.filter(e => e.status === '在職').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">離職</div>
          <div className="stat-card-value">{employees.filter(e => e.status === '離職').length}</div>
        </div>
        {EMPLOYMENT_TYPES.map(t => (
          <div key={t.value} className="stat-card" style={{ '--card-accent': t.color, '--card-accent-dim': t.color + '22', cursor: 'pointer', outline: typeFilter === t.value ? `2px solid ${t.color}` : 'none' }}
            onClick={() => setTypeFilter(typeFilter === t.value ? '' : t.value)}>
            <div className="stat-card-label">{t.label}</div>
            <div className="stat-card-value">{employees.filter(e => (e.employment_type || '全職') === t.value && e.status === '在職').length}</div>
          </div>
        ))}
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">篩選結果</div>
          <div className="stat-card-value">{filtered.length}</div>
        </div>
      </div>

      {/* 篩選列 */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 20, padding: '14px 20px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12,
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>狀態</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 100 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">全部</option>
            <option value="在職">在職</option>
            <option value="離職">離職</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>類型</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 120 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">全部類型</option>
            {EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🏪 門市</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
            <option value="">全部門市</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🏢 部門</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">全部部門</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 員工列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋姓名、Email..." className="form-input" style={{ paddingLeft: 38 }}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>編號</th><th>姓名</th><th>類型</th><th>部門</th><th>職稱</th><th>門市</th><th>Email</th><th>手機</th><th>到職日</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無符合條件的員工</td></tr>}
              {filtered.map(e => {
                const empType = EMPLOYMENT_TYPES.find(t => t.value === (e.employment_type || '全職'))
                return (
                <tr key={e.id} style={{ opacity: e.status === '離職' ? 0.55 : 1, cursor: 'pointer' }} onClick={ev => { setDetailClickY(ev.clientY); setDetailEmp(e) }}>
                  <td><span style={{ fontFamily: 'monospace', fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 600 }}>{e.employee_number || `EMP-${String(e.id).padStart(3, '0')}`}</span></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: e.avatar, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                        {e.name?.[0]}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{e.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.name_en}</div>
                      </div>
                    </div>
                  </td>
                  <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: (empType?.color || '#22c55e') + '22', color: empType?.color || '#22c55e' }}>{empType?.label || '全職'}</span></td>
                  <td>{deptName(e.department_id)}</td>
                  <td>{e.position}</td>
                  <td>{storeName(e.store_id)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}><MaskedText value={e.email} type="email" canReveal={true} /></td>
                  <td style={{ fontSize: 12 }}><MaskedText value={e.phone} type="phone" canReveal={true} /></td>
                  <td style={{ fontSize: 12 }}>
                    {e.join_date}
                    {e.resign_date && (
                      <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>離職：{e.resign_date}</div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${e.status === '在職' ? 'badge-success' : 'badge-danger'}`}>
                      <span className="badge-dot"></span>{e.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-secondary" style={{ width: 'auto', padding: '4px 10px', fontSize: 11 }}
                        onClick={ev => { ev.stopPropagation(); openEdit(e) }}>
                        <Pencil size={12} /> 編輯
                      </button>
                      {e.email && e.status === '在職' && (
                        <button className="btn btn-sm btn-secondary" style={{ width: 'auto', padding: '4px 10px', fontSize: 11, color: 'var(--accent-cyan)' }}
                          onClick={ev => { ev.stopPropagation(); handleInvite(e) }}>
                          <Mail size={12} /> 邀請
                        </button>
                      )}
                      {e.status === '在職' ? (
                        <button className="btn btn-sm btn-secondary" style={{ width: 'auto', padding: '4px 10px', fontSize: 11, color: 'var(--accent-red)' }}
                          onClick={ev => { ev.stopPropagation(); openResign(e) }}>
                          <UserMinus size={12} /> 離職
                        </button>
                      ) : (
                        <button className="btn btn-sm btn-secondary" style={{ width: 'auto', padding: '4px 10px', fontSize: 11, color: 'var(--accent-green)' }}
                          onClick={ev => { ev.stopPropagation(); openRehire(e) }}>
                          <UserPlus size={12} /> 復職
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      </>}

      {/* 新增員工 Modal */}
      {showModal && (
        <Modal title="新增員工（到職）" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="姓名 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="王小明" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="英文姓名">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="Xiaoming Wang" value={form.name_en} onChange={e => set('name_en', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="僱用類型">
              <select className="form-input" style={{ width: '100%' }} value={form.employment_type} onChange={e => set('employment_type', e.target.value)}>
                {EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="到職日">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.join_date} onChange={e => set('join_date', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部門">
              <select className="form-input" style={{ width: '100%' }} value={form.department_id ?? ''} onChange={e => set('department_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">請選擇</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="職稱">
              <select className="form-input" style={{ width: '100%' }} value={form.position} onChange={e => {
                const pos = e.target.value
                setForm(f => {
                  const next = { ...f, position: pos }
                  if (pos && (pos.includes('門市') || pos.includes('店長'))) {
                    const ops = departments.find(d => d.name === '營運部')
                    if (ops) next.department_id = ops.id
                  }
                  return next
                })
              }}>
                <option value="">請選擇</option>
                <optgroup label="管理職">
                  {POSITIONS.filter(p => ['admin', 'manager'].includes(p.level)).map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
                </optgroup>
                <optgroup label="行政職">
                  {POSITIONS.filter(p => p.level === 'office_staff').map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
                </optgroup>
                <optgroup label="門市職">
                  {POSITIONS.filter(p => p.level === 'store_staff').map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
                </optgroup>
              </select>
            </Field>
          </div>
          <Field label="門市 / 分店">
            <select className="form-input" style={{ width: '100%' }} value={form.store_id ?? ''} onChange={e => {
              const sid = e.target.value ? Number(e.target.value) : null
              setForm(f => {
                const next = { ...f, store_id: sid }
                // 門市人員一律歸屬營運部
                if (sid) {
                  const ops = departments.find(d => d.name === '營運部')
                  if (ops) next.department_id = ops.id
                }
                return next
              })
            }}>
              <option value="">請選擇</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Email *">
            <input className="form-input" type="email" style={{ width: '100%' }} placeholder="example@company.com" value={form.email} onChange={e => set('email', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="手機">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="0912-345-678" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </Field>
          </div>

          {/* 薪資區塊 */}
          <div style={{ marginTop: 8, padding: '12px 14px', background: 'var(--glass-light)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text-secondary)' }}>💰 薪資資訊</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="計薪方式">
                <select className="form-input" style={{ width: '100%' }} value={form.salary_type} onChange={e => set('salary_type', e.target.value)}>
                  <option value="monthly">月薪制</option>
                  <option value="hourly">時薪制</option>
                </select>
              </Field>
              {form.salary_type === 'monthly' ? (
                <Field label="月底薪 (NT$)">
                  <input className="form-input" type="number" style={{ width: '100%' }} placeholder="28000" value={form.base_salary} onChange={e => set('base_salary', e.target.value)} />
                </Field>
              ) : (
                <Field label="時薪 (NT$)">
                  <input className="form-input" type="number" style={{ width: '100%' }} placeholder="183" value={form.hourly_rate} onChange={e => set('hourly_rate', e.target.value)} />
                </Field>
              )}
            </div>
            <Field label="每週工時上限">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="40" value={form.weekly_hours} onChange={e => set('weekly_hours', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}

      {/* 離職 Modal */}
      {showResignModal && selectedEmp && (
        <Modal title={`員工離職 — ${selectedEmp.name}`} onClose={() => setShowResignModal(false)} onSubmit={handleResign} submitText="確認離職">
          <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--accent-red-dim)', border: '1px solid var(--accent-red)', fontSize: 13, color: 'var(--accent-red)', marginBottom: 12 }}>
            將 <b>{selectedEmp.name}</b>（{deptName(selectedEmp.department_id)} · {selectedEmp.position}）設為離職狀態
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="離職日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={resignDate} onChange={e => setResignDate(e.target.value)} />
            </Field>
            <Field label="到職日">
              <input className="form-input" type="text" style={{ width: '100%' }} value={selectedEmp.join_date || '-'} readOnly />
            </Field>
          </div>
          <Field label="離職原因">
            <textarea className="form-input" style={{ width: '100%', height: 80, resize: 'vertical' }} placeholder="自願離職 / 合約到期 / 資遣 / 退休..."
              value={resignReason} onChange={e => setResignReason(e.target.value)} />
          </Field>
        </Modal>
      )}

      {/* 復職 Modal */}
      {showRehireModal && selectedEmp && (
        <Modal title={`員工復職 — ${selectedEmp.name}`} onClose={() => setShowRehireModal(false)} onSubmit={handleRehire} submitText="確認復職">
          <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)', fontSize: 13, color: 'var(--accent-green)' }}>
            將 <b>{selectedEmp.name}</b> 恢復為在職狀態
          </div>
          {selectedEmp.resign_date && (
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
              離職日期：{selectedEmp.resign_date}<br />
              離職原因：{selectedEmp.resign_reason || '-'}
            </div>
          )}
        </Modal>
      )}
      {/* 編輯員工 Modal */}
      {showEditModal && selectedEmp && (
        <Modal title={`編輯員工 — ${selectedEmp.name}`} onClose={() => setShowEditModal(false)} onSubmit={handleEdit} submitText="儲存變更">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="姓名">
              <input className="form-input" type="text" style={{ width: '100%' }} value={editForm.name} onChange={e => setE('name', e.target.value)} />
            </Field>
            <Field label="英文姓名">
              <input className="form-input" type="text" style={{ width: '100%' }} value={editForm.name_en} onChange={e => setE('name_en', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="僱用類型">
              <select className="form-input" style={{ width: '100%' }} value={editForm.employment_type} onChange={e => setE('employment_type', e.target.value)}>
                {EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="部門">
              <select className="form-input" style={{ width: '100%' }} value={editForm.department_id ?? ''} onChange={e => setE('department_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">請選擇</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="職稱">
              <select className="form-input" style={{ width: '100%' }} value={editForm.position} onChange={e => {
                const pos = e.target.value
                setEditForm(f => {
                  const next = { ...f, position: pos }
                  if (pos && (pos.includes('門市') || pos.includes('店長'))) {
                    const ops = departments.find(d => d.name === '營運部')
                    if (ops) next.department_id = ops.id
                  }
                  return next
                })
              }}>
                <option value="">請選擇</option>
                <optgroup label="管理職">
                  {POSITIONS.filter(p => ['admin', 'manager'].includes(p.level)).map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
                </optgroup>
                <optgroup label="行政職">
                  {POSITIONS.filter(p => p.level === 'office_staff').map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
                </optgroup>
                <optgroup label="門市職">
                  {POSITIONS.filter(p => p.level === 'store_staff').map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
                </optgroup>
              </select>
            </Field>
          </div>
          <Field label="門市 / 分店">
            <select className="form-input" style={{ width: '100%' }} value={editForm.store_id ?? ''} onChange={e => {
              const sid = e.target.value ? Number(e.target.value) : null
              setEditForm(f => {
                const next = { ...f, store_id: sid }
                // 門市人員一律歸屬營運部
                if (sid) {
                  const ops = departments.find(d => d.name === '營運部')
                  if (ops) next.department_id = ops.id
                }
                return next
              })
            }}>
              <option value="">請選擇</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Email">
            <input className="form-input" type="email" style={{ width: '100%' }} value={editForm.email} onChange={e => setE('email', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="手機">
              <input className="form-input" type="text" style={{ width: '100%' }} value={editForm.phone} onChange={e => setE('phone', e.target.value)} />
            </Field>
            <Field label="到職日">
              <input className="form-input" type="date" style={{ width: '100%' }} value={editForm.join_date} onChange={e => setE('join_date', e.target.value)} />
            </Field>
          </div>
          <Field label="系統權限">
            <select className="form-input" style={{ width: '100%' }} value={editForm.system_role} onChange={e => setE('system_role', e.target.value)}>
              <option value="store_staff">門市員工</option>
              <option value="office_staff">行政員工</option>
              <option value="manager">主管</option>
              <option value="admin">管理員</option>
              <option value="super_admin">超級管理員</option>
            </select>
          </Field>
        </Modal>
      )}

      {showCsvImport && (
        <AssignmentCsvImport
          employees={employees}
          departments={departments}
          stores={locations}
          onClose={() => setShowCsvImport(false)}
          onDone={() => {
            // refresh employee list so counts/stat cards update
            getEmployees().then(r => setEmployees(r.data || []))
          }}
        />
      )}

      {/* Department Edit Modal */}
      {showDeptModal && (
        <Modal title={editingDept ? `編輯部門 — ${editingDept.name}` : '新增部門'}
          onClose={() => { setShowDeptModal(false); setEditingDept(null) }}
          onSubmit={async () => {
            const payload = { name: form.name, manager_id: form.manager_id ? parseInt(form.manager_id) : null, description: form.description, level: form.level, parent_department_id: form.parent_department_id ? parseInt(form.parent_department_id) : null }
            if (editingDept) {
              const { data } = await supabase.from('departments').update(payload).eq('id', editingDept.id).select().single()
              if (data) setDepartments(prev => prev.map(d => d.id === data.id ? data : d))
            } else {
              const { data } = await supabase.from('departments').insert(payload).select().single()
              if (data) setDepartments(prev => [...prev, data])
            }
            setShowDeptModal(false); setEditingDept(null)
          }}
          submitLabel={editingDept ? '儲存' : '新增'}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部門名稱 *"><input className="form-input" type="text" style={{ width: '100%' }} value={form.name} onChange={e => set('name', e.target.value)} /></Field>
            <Field label="層級"><select className="form-input" style={{ width: '100%' }} value={form.level} onChange={e => set('level', e.target.value)}>
              <option value="部">部</option><option value="組">組</option><option value="課">課</option><option value="董事長">董事長室</option>
            </select></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="上級部門"><select className="form-input" style={{ width: '100%' }} value={form.parent_department_id} onChange={e => set('parent_department_id', e.target.value)}>
              <option value="">無（頂層）</option>
              {departments.filter(d => d.id !== editingDept?.id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></Field>
            <Field label="部門主管"><select className="form-input" style={{ width: '100%' }} value={form.manager_id} onChange={e => set('manager_id', e.target.value)}>
              <option value="">請選擇</option>
              {employees.filter(e => e.status === '在職').map(e => <option key={e.id} value={e.id}>{e.name}{e.position ? ` (${e.position})` : ''}</option>)}
            </select></Field>
          </div>
          <Field label="描述"><textarea className="form-input" style={{ width: '100%', height: 80 }} value={form.description} onChange={e => set('description', e.target.value)} /></Field>
        </Modal>
      )}

      {/* Employee Detail Modal */}
      {detailEmp && (
        <EmployeeDetail
          employee={detailEmp}
          employees={employees}
          stores={locations}
          departments={departments}
          clickY={detailClickY}
          onUpdate={(updated) => {
            setEmployees(prev => prev.map(e => e.id === updated.id ? updated : e))
            setDetailEmp(updated)
          }}
          onClose={() => setDetailEmp(null)}
        />
      )}
    </div>
  )
}
