import { useState, useEffect, useCallback } from 'react'
import {
  Users, Shield, Search, RefreshCw, Edit, UserCog, Building2,
  Check, X, Key, Mail, ChevronDown
} from 'lucide-react'
import Modal, { Field } from '../../components/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { getTenants, getAllEmployees, updateEmployeeRole, getTenantEmployees } from '../../lib/db'

const ROLES = ['super_admin', 'admin', 'manager', 'user']
const ROLE_LABELS = { super_admin: '超級管理員', admin: '管理員', manager: '主管', user: '一般使用者' }
const ROLE_COLORS = { super_admin: 'badge-danger', admin: 'badge-purple', manager: 'badge-info', user: 'badge-neutral' }
const STATUS_OPTIONS = ['在職', '離職', '停用']

export default function UserConfig() {
  const { hasPermission } = useAuth()
  const isSuperAdmin = hasPermission('nav.group.super_admin')
  const [tenants, setTenants] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterTenant, setFilterTenant] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [form, setForm] = useState({ role: '', status: '', position: '', department: '' })
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [tenantsRes, employeesRes] = await Promise.all([getTenants(), getAllEmployees()])
    if (tenantsRes.data) setTenants(tenantsRes.data)
    if (employeesRes.data) setEmployees(employeesRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const openEdit = (emp) => {
    setEditUser(emp)
    setForm({
      role: emp.role || 'user',
      status: emp.status || '在職',
      position: emp.position || '',
      department: emp.dept || '',
    })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    if (!editUser) return
    setSaving(true)
    const { error } = await updateEmployeeRole(editUser.id, form)
    if (error) { console.error('Update error:', error); setSaving(false); return }
    setSaving(false)
    setShowModal(false)
    setEditUser(null)
    fetchData()
  }

  const filtered = employees.filter(e => {
    const matchSearch = !search ||
      (e.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (e.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (e.employee_id || '').toLowerCase().includes(search.toLowerCase())
    const matchTenant = !filterTenant || String(e.organization_id) === filterTenant
    const matchRole = !filterRole || e.role === filterRole
    return matchSearch && matchTenant && matchRole
  })

  if (!isSuperAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
        <Shield size={48} style={{ color: 'var(--accent-red)' }} />
        <h2>超級管理員專屬</h2>
        <p style={{ color: 'var(--text-secondary)' }}>此頁面僅限超級管理員存取</p>
      </div>
    )
  }

  const superAdminCount = employees.filter(e => e.role === 'super_admin').length
  const adminCount = employees.filter(e => e.role === 'admin').length
  const activeCount = employees.filter(e => e.status === '在職').length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><UserCog size={22} /></span> 使用者配置</h2>
            <p>超級管理員 — 跨組織使用者角色與權限管理</p>
          </div>
          <button className="btn btn-secondary" onClick={fetchData} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> 重新整理
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label"><Users size={14} /> 使用者總數</div>
          <div className="stat-card-value">{employees.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label"><Check size={14} /> 在職中</div>
          <div className="stat-card-value">{activeCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label"><Shield size={14} /> 超級管理員</div>
          <div className="stat-card-value">{superAdminCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label"><Key size={14} /> 組織管理員</div>
          <div className="stat-card-value">{adminCount}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="form-input"
              placeholder="搜尋姓名、Email、員工編號..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 32, width: '100%' }}
            />
          </div>
          <select className="form-input" value={filterTenant} onChange={e => setFilterTenant(e.target.value)} style={{ width: 180 }}>
            <option value="">全部組織</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="form-input" value={filterRole} onChange={e => setFilterRole(e.target.value)} style={{ width: 140 }}>
            <option value="">全部角色</option>
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
      </div>

      {/* User Table */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">使用者列表 ({filtered.length})</h3>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>Email</th>
                <th>員工編號</th>
                <th>所屬組織</th>
                <th>角色</th>
                <th>職稱</th>
                <th>部門</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>載入中...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無符合條件的使用者</td></tr>
              )}
              {!loading && filtered.map(e => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: e.role === 'super_admin' ? 'var(--accent-red)' : 'var(--accent-cyan)',
                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700
                      }}>
                        {e.name?.[0]}
                      </div>
                      {e.name}
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}><Mail size={11} style={{ marginRight: 3, verticalAlign: -1 }} />{e.email}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.employee_id || '-'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                      <Building2 size={11} style={{ color: 'var(--accent-cyan)' }} />
                      {e.organizations?.name || `#${e.organization_id}`}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${ROLE_COLORS[e.role] || 'badge-neutral'}`}>
                      {ROLE_LABELS[e.role] || e.role || '一般'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{e.position || '-'}</td>
                  <td style={{ fontSize: 12 }}>{e.department || '-'}</td>
                  <td>
                    <span className={`badge ${e.status === '在職' ? 'badge-success' : e.status === '離職' ? 'badge-neutral' : 'badge-warning'}`}>
                      {e.status || '在職'}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-ghost" title="編輯角色" onClick={() => openEdit(e)} style={{ padding: '4px 6px' }}>
                      <Edit size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {showModal && editUser && (
        <Modal title={`編輯使用者 — ${editUser.name}`} onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ padding: '8px 0 16px', display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid var(--border-color)', marginBottom: 16 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--accent-cyan)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700
            }}>
              {editUser.name?.[0]}
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>{editUser.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{editUser.email}</div>
            </div>
          </div>
          <Field label="角色">
            <select className="form-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            {form.role === 'super_admin' && (
              <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}>
                <Shield size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
                超級管理員擁有跨組織最高權限，請謹慎指派
              </div>
            )}
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="職稱">
              <input className="form-input" value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} />
            </Field>
            <Field label="部門">
              <input className="form-input" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
            </Field>
          </div>
          <Field label="狀態">
            <select className="form-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </div>
  )
}
