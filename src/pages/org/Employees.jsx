import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, UserMinus, UserPlus, Pencil, Mail, Upload, Building2, Trash2, Users } from 'lucide-react'
import { getEmployees, createEmployee, updateEmployee, inviteEmployee } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { createAssignment, rotatePrimary } from '../../lib/assignments'
import LoadingSpinner from '../../components/LoadingSpinner'
import MaskedText from '../../components/MaskedText'
import Modal, { Field } from '../../components/Modal'
import AssignmentCsvImport from '../../components/employee/AssignmentCsvImport'
import { empLabel } from '../../lib/empLabel'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'

import EmployeeFormModal from './components/EmployeeFormModal'
import ResignRehireModal from './components/ResignRehireModal'
import OffboardingModal from '../../components/OffboardingModal'
import ProxyManagementModal from '../../components/ProxyManagementModal'
import { ArrowRightLeft } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const AVATARS = ['#3b82f6', '#a78bfa', '#f472b6', '#34d399', '#fb923c', '#22d3ee', '#f87171', '#fbbf24']

const EMPLOYMENT_TYPES = [
  { value: '正職', label: '正職',   color: '#22c55e' },
  { value: '約聘', label: '約聘',   color: '#06b6d4' },
  { value: '兼職', label: '兼職',   color: '#f59e0b' },
  { value: '外籍', label: '外籍移工', color: '#a855f7' },
  { value: '派遣', label: '派遣',   color: '#f87171' },
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

const PosSelect = ({ value, onChange }) => (
  <select className="form-input" style={{ width: '100%' }} value={value} onChange={onChange}>
    <option value="">— 不選 —</option>
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
)

export default function Employees() {
  const { profile } = useAuth()
  const [offboardingFor, setOffboardingFor] = useState(null)  // { employee, date, reason }
  const [showProxyMgmt, setShowProxyMgmt] = useState(false)
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
  const [sortKey, setSortKey] = useState('')   // 欄位排序 key
  const [sortDir, setSortDir] = useState('asc') // asc | desc
  const [showModal, setShowModal] = useState(false)
  const [showResignModal, setShowResignModal] = useState(false)
  const [showRehireModal, setShowRehireModal] = useState(false)
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [resignDate, setResignDate] = useState('')
  const [resignReason, setResignReason] = useState('')
  // 注意：role 預設空字串 → handleSubmit 會 fallback 用 position 判定
  // 新加欄位（2026-05-15）：role / supervisor_id / id_number / birth_date /
  //   gender / employee_number / probation_end_date / address
  const [form, setForm] = useState({
    name: '', name_en: '', department_id: null, position: '', position_secondary: '', position_third: '',
    store_id: null, email: '', phone: '', join_date: '', status: '在職', employment_type: '正職',
    employment_category: 'regular', salary_type: 'monthly', base_salary: '', hourly_rate: '', weekly_hours: '40',
    emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relation: '',
    bank_code: '', bank_account: '',
    role: '', supervisor_id: null,
    id_number: '', birth_date: '', gender: '', employee_number: '',
    probation_end_date: '', address: '',
  })
  const navigate = useNavigate()
  const openDetail = (emp) => navigate(`/org/employees/${emp.id}`)
  const [showCsvImport, setShowCsvImport] = useState(false)
  const [pageTab, setPageTab] = useState('employees')
  const [showDeptModal, setShowDeptModal] = useState(false)
  const [editingDept, setEditingDept] = useState(null)
  const [deptForm, setDeptForm] = useState({ name: '', manager_id: '', description: '', level: '部', parent_department_id: '' })
  const setDept = (k, v) => setDeptForm(f => ({ ...f, [k]: v }))

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
      // 角色：UI 手動指定優先；沒指定則 fallback 用 position 推
      const role = form.role || posInfo?.level || 'store_staff'
      const ROLE_ID_MAP = { super_admin: 1, admin: 2, manager: 3, office_staff: 4, store_staff: 5 }
      // employment_category 屬於 salary_structures，不寫進 employees 表
      const { employment_category: _cat, ...formForEmployee } = form
      const payload = {
        ...formForEmployee,
        salary_type: _cat === 'parttime' ? 'hourly' : 'monthly',
        department_id: form.department_id ? Number(form.department_id) : null,
        store_id: form.store_id ? Number(form.store_id) : null,
        supervisor_id: form.supervisor_id ? Number(form.supervisor_id) : null,
        birth_date: form.birth_date || null,
        probation_end_date: form.probation_end_date || null,
        avatar,
        role,
        role_id: ROLE_ID_MAP[role] || 5,
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
          employment_type: data.employment_type || '正職',
          start_date: data.join_date || new Date().toISOString().slice(0, 10),
          is_active: data.status === '在職',
        })
        setForm({
          name: '', name_en: '', department_id: departments[0]?.id || null, position: '', position_secondary: '', position_third: '',
          store_id: locations[0]?.id || null, email: '', phone: '', join_date: '', status: '在職', employment_type: '正職',
          employment_category: 'regular', salary_type: 'monthly', base_salary: '', hourly_rate: '', weekly_hours: '40',
          emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relation: '',
          bank_code: '', bank_account: '',
          role: '', supervisor_id: null,
          id_number: '', birth_date: '', gender: '', employee_number: '',
          probation_end_date: '', address: '',
        })
        // Auto-start onboarding workflow if template exists
        const { data: tpl } = await supabase.from('sop_templates')
          .select('*').or('name.ilike.%新人%到職%,name.ilike.%onboarding%').limit(1).maybeSingle()
        if (tpl) {
          const storeLabel = storeName(data.store_id)
          // 先解析 org，給 instance + tasks 共用
          const { data: orgIdRes } = await supabase.rpc('current_employee_org')
          const { data: inst } = await supabase.from('workflow_instances').insert({
            template_name: tpl.name, store: storeLabel,
            status: '進行中', started_by: '系統',
            organization_id: orgIdRes ?? null,
          }).select().single()
          if (inst && tpl.steps?.length) {
            const stepRows = tpl.steps.map((s, i) => ({
              workflow_instance_id: inst.id,
              organization_id: orgIdRes ?? inst.organization_id ?? null,
              step_order: i + 1,
              step_type: 'workflow_step',
              title: s.title, description: s.description,
              role: s.role, assignee: data.name,
              store: storeLabel, status: '待處理',
            }))
            await supabase.from('tasks').insert(stepRows)
          }
        }
      }
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  // 發送邀請信
  const handleInvite = async (emp) => {
    if (!emp.email) { toast.error('此員工沒有設定 Email，請先編輯填入 Email'); return }
    if (!(await confirm({ message: `確定要發送帳號邀請信給 ${emp.name}（${emp.email}）？` }))) return
    try {
      const result = await inviteEmployee(emp.email, emp.name)
      if (result.ok) {
        toast.error(result.message)
      } else {
        toast.error('發送失敗：' + (result.error || '未知錯誤'))
      }
    } catch (err) {
      toast.error('發送失敗：' + err.message)
    }
  }

  // 離職
  const openResign = (emp) => {
    setSelectedEmp(emp)
    setResignDate(new Date().toISOString().slice(0, 10))
    setResignReason('')
    setShowResignModal(true)
  }
  // 填完離職日期+原因 → 開交接 Modal（OffboardingModal 走 resign_employee 做交接+離職）
  const handleResign = () => {
    if (!selectedEmp) return
    setOffboardingFor({ employee: selectedEmp, date: resignDate, reason: resignReason })
    setShowResignModal(false)
  }

  // 交接完成 → 補寫離職原因 + 更新本地狀態
  const handleOffboardingDone = async (result) => {
    const off = offboardingFor
    if (!off) return
    try {
      if (off.reason) {
        await supabase.from('employees').update({ resign_reason: off.reason, resign_type: 'voluntary' }).eq('id', off.employee.id)
      }
    } catch { /* 原因補寫失敗不擋流程 */ }
    setEmployees(prev => prev.map(e => e.id === off.employee.id
      ? { ...e, status: '離職', resign_date: off.date, resign_reason: off.reason, resign_type: 'voluntary' }
      : e))
    const c = result || {}
    const moved = (c.chain_steps_count || 0) + (c.snapshots_count || 0) + (c.stores_count || 0)
      + (c.depts_count || 0) + (c.sections_count || 0) + (c.extras_count || 0) + (c.tasks_count || 0) + (c.subordinates_count || 0)
    toast.success(moved > 0 ? `已離職，交接 ${moved} 項（${c.mode === 'proxy' ? '代理' : '交接'}）` : '已設為離職')
    setOffboardingFor(null)
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
          employment_type: data.employment_type || '正職',
          start_date: new Date().toISOString().slice(0, 10),
          is_active: true,
        })
      }
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = employees.filter(e =>
    !e.is_archived &&
    (statusFilter === '' || e.status === statusFilter) &&
    (typeFilter === '' || (e.employment_type || '正職') === typeFilter) &&
    (storeFilter === '' || e.store_id === Number(storeFilter)) &&
    (deptFilter === '' || e.department_id === Number(deptFilter)) &&
    (search === '' || e.name?.includes(search) || e.name_en?.toLowerCase().includes(search.toLowerCase()) || e.email?.includes(search) || e.employee_number?.includes(search))
  )

  // ── 欄位排序 ──
  // 點欄位標題：第一次升冪、再點降冪、第三次取消
  const toggleSort = (key) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc') }
    else if (sortDir === 'asc') { setSortDir('desc') }
    else { setSortKey(''); setSortDir('asc') }
  }
  const colValue = (e, key) => {
    switch (key) {
      case 'number':   return e.employee_number || `EMP-${String(e.id).padStart(3, '0')}`
      case 'name':     return e.name || ''
      case 'type':     return e.employment_type || '正職'
      case 'dept':     return deptName(e.department_id) || ''
      case 'position': return e.position || ''
      case 'store':    return storeName(e.store_id) || ''
      case 'join':     return e.join_date || ''
      case 'status':   return e.status || ''
      default:         return ''
    }
  }
  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const va = colValue(a, sortKey), vb = colValue(b, sortKey)
        const cmp = String(va).localeCompare(String(vb), 'zh-Hant', { numeric: true })
        return sortDir === 'asc' ? cmp : -cmp
      })
    : filtered

  // 可排序欄位標題（點擊切換 + 箭頭指示）
  const Th = ({ label, sk }) => {
    const active = sortKey === sk
    return (
      <th onClick={() => toggleSort(sk)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
        {label}
        <span style={{ marginLeft: 4, fontSize: 10, color: active ? 'var(--accent-cyan)' : 'var(--text-muted)', opacity: active ? 1 : 0.5 }}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </th>
    )
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">👤</span> 員工</h2>
            <p>員工基本資料管理（到職 / 離職）</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setShowProxyMgmt(true)}><ArrowRightLeft size={14} /> 代理管理</button>
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
                      onClick={() => { setEditingDept(dept); setDeptForm({ name: dept.name || '', manager_id: dept.manager_id ? String(dept.manager_id) : '', description: dept.description || '', level: dept.level || '部', parent_department_id: dept.parent_department_id ? String(dept.parent_department_id) : '' }); setShowDeptModal(true) }}>
                      <Pencil size={12} />
                    </button>
                    <button className="btn btn-sm btn-secondary" style={{ padding: '4px 6px', color: 'var(--accent-red)' }}
                      onClick={async () => { if (!(await confirm({ message: `確定刪除「${dept.name}」？` }))) return; const { error } = await supabase.from('departments').delete().eq('id', dept.id); if (error) { toast.error('刪除失敗：' + error.message) } else { setDepartments(prev => prev.filter(d => d.id !== dept.id)) } }}>
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
                      <button key={m.id} onClick={() => openDetail(m)} style={{
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
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)', cursor: 'pointer', outline: statusFilter === '在職' ? '2px solid var(--accent-green)' : 'none' }}
          onClick={() => setStatusFilter(statusFilter === '在職' ? '' : '在職')}>
          <div className="stat-card-label">在職</div>
          <div className="stat-card-value">{employees.filter(e => e.status === '在職').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)', cursor: 'pointer', outline: statusFilter === '離職' ? '2px solid var(--accent-red)' : 'none' }}
          onClick={() => setStatusFilter(statusFilter === '離職' ? '' : '離職')}>
          <div className="stat-card-label">離職</div>
          <div className="stat-card-value">{employees.filter(e => e.status === '離職').length}</div>
        </div>
        {EMPLOYMENT_TYPES.map(t => (
          <div key={t.value} className="stat-card" style={{ '--card-accent': t.color, '--card-accent-dim': t.color + '22', cursor: 'pointer', outline: typeFilter === t.value ? `2px solid ${t.color}` : 'none' }}
            onClick={() => setTypeFilter(typeFilter === t.value ? '' : t.value)}>
            <div className="stat-card-label">{t.label}</div>
            <div className="stat-card-value">{employees.filter(e => (e.employment_type || '正職') === t.value && e.status === '在職').length}</div>
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
              <tr>
                <Th label="編號" sk="number" />
                <Th label="姓名" sk="name" />
                <Th label="類型" sk="type" />
                <Th label="部門" sk="dept" />
                <Th label="職稱" sk="position" />
                <Th label="門市" sk="store" />
                <th>Email</th>
                <th>手機</th>
                <Th label="到職日" sk="join" />
                <Th label="狀態" sk="status" />
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無符合條件的員工</td></tr>}
              {sorted.map(e => {
                const empType = EMPLOYMENT_TYPES.find(t => t.value === (e.employment_type || '正職'))
                return (
                <tr key={e.id} style={{ opacity: e.status === '離職' ? 0.55 : 1, cursor: 'pointer' }} onClick={() => openDetail(e)}>
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
                  <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: (empType?.color || '#22c55e') + '22', color: empType?.color || '#22c55e' }}>{empType?.label || '正職'}</span></td>
                  <td>{deptName(e.department_id)}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {e.position && <span style={{ fontSize: 12, fontWeight: 600 }}>{e.position}</span>}
                      {e.position_secondary && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{e.position_secondary}</span>}
                      {e.position_third && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.position_third}</span>}
                      {!e.position && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
                    </div>
                  </td>
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
      <EmployeeFormModal
        open={showModal}
        onClose={() => setShowModal(false)}
        departments={departments}
        locations={locations}
        employees={employees}
        form={form}
        setForm={setForm}
        onSubmit={handleSubmit}
      />

      {/* 離職 Modal */}
      <ResignRehireModal
        mode="resign"
        open={showResignModal && !!selectedEmp}
        onClose={() => setShowResignModal(false)}
        employee={selectedEmp}
        deptName={deptName}
        resignDate={resignDate}
        setResignDate={setResignDate}
        resignReason={resignReason}
        setResignReason={setResignReason}
        onSubmit={handleResign}
      />

      {/* 代理管理 Modal */}
      {showProxyMgmt && (
        <ProxyManagementModal
          allEmployees={employees}
          currentUserEmpId={profile?.id || null}
          onClose={() => setShowProxyMgmt(false)}
        />
      )}

      {/* 離職交接 Modal（填完日期原因後出現）*/}
      {offboardingFor && (
        <OffboardingModal
          employee={offboardingFor.employee}
          pendingStatus="離職"
          pendingResignDate={offboardingFor.date}
          allEmployees={employees}
          currentUserEmpId={profile?.id || null}
          onSuccess={handleOffboardingDone}
          onCancel={() => setOffboardingFor(null)}
        />
      )}

      {/* 復職 Modal */}
      <ResignRehireModal
        mode="rehire"
        open={showRehireModal && !!selectedEmp}
        onClose={() => setShowRehireModal(false)}
        employee={selectedEmp}
        deptName={deptName}
        onSubmit={handleRehire}
      />

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
            const payload = { name: deptForm.name, manager_id: deptForm.manager_id ? parseInt(deptForm.manager_id) : null, description: deptForm.description, level: deptForm.level, parent_department_id: deptForm.parent_department_id ? parseInt(deptForm.parent_department_id) : null }
            if (editingDept) {
              const { data, error } = await supabase.from('departments').update(payload).eq('id', editingDept.id).select().single()
              if (error) { toast.error('儲存失敗：' + error.message); return }
              if (data) setDepartments(prev => prev.map(d => d.id === data.id ? data : d))
            } else {
              const { data, error } = await supabase.from('departments').insert(payload).select().single()
              if (error) { toast.error('新增失敗：' + error.message); return }
              if (data) setDepartments(prev => [...prev, data])
            }
            setShowDeptModal(false); setEditingDept(null)
          }}
          submitLabel={editingDept ? '儲存' : '新增'}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部門名稱" required><input className="form-input" type="text" style={{ width: '100%' }} value={deptForm.name} onChange={e => setDept('name', e.target.value)} /></Field>
            <Field label="層級"><select className="form-input" style={{ width: '100%' }} value={deptForm.level} onChange={e => setDept('level', e.target.value)}>
              <option value="部">部</option><option value="組">組</option><option value="課">課</option><option value="董事長">董事長室</option>
            </select></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="上級部門"><select className="form-input" style={{ width: '100%' }} value={deptForm.parent_department_id} onChange={e => setDept('parent_department_id', e.target.value)}>
              <option value="">無（頂層）</option>
              {departments.filter(d => d.id !== editingDept?.id).map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
            </select></Field>
            <Field label="部門主管">
              <SearchableSelect
                value={deptForm.manager_id || null}
                onChange={(v) => setDept('manager_id', v || '')}
                options={empOptions(employees.filter(e => e.status === '在職'), { keyBy: 'id' })}
                placeholder="搜尋員工..."
              />
            </Field>
          </div>
          <Field label="描述"><textarea className="form-input" style={{ width: '100%', height: 80 }} value={deptForm.description} onChange={e => setDept('description', e.target.value)} /></Field>
        </Modal>
      )}

      {/* 員工詳情改成獨立路由頁面 /org/employees/:id (見 EmployeeProfile.jsx) */}
    </div>
  )
}
