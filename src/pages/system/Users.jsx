import { useState, useEffect } from 'react'
import { Search, Pencil, UserCog, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Modal, { Field } from '../../components/Modal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

const ROLE_MAP = {
  '門市人員':   { role: 'store_staff',  role_id: 5 },
  '行政人員':   { role: 'office_staff', role_id: 4 },
  '主管':       { role: 'manager',      role_id: 3 },
  'HR 管理員':  { role: 'admin',        role_id: 2 },
  '超級管理員': { role: 'super_admin',  role_id: 1 },
}
const ROLE_LABEL = {
  store_staff:  '門市人員',
  office_staff: '行政人員',
  manager:      '主管',
  admin:        'HR 管理員',
  super_admin:  '超級管理員',
  // legacy：舊資料把所有人都標 'employee'，視為行政人員顯示
  employee:     '行政人員',
}
const ROLES = Object.keys(ROLE_MAP)
const roleColor = {
  '超級管理員': 'badge-danger',
  'HR 管理員':  'badge-purple',
  '主管':       'badge-info',
  '行政人員':   'badge-neutral',
  '門市人員':   'badge-neutral',
}

const toLabel = r => ROLE_LABEL[r] ?? r ?? '—'

export default function Users() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const orgId = profile?.organization_id

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editUser, setEditUser] = useState(null)

  useEffect(() => { load() }, [orgId])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('employees')
      .select('id, name, email, role, dept, status, position')
      .eq('organization_id', orgId)
      .eq('status', '在職')          // 只列在職 — 離職的自動失權
      .order('id')
    setUsers(data ?? [])
    setLoading(false)
  }

  const handleEditRole = async () => {
    if (!editUser) return
    const { role, role_id } = ROLE_MAP[editUser.newRole]
    await supabase.from('employees').update({ role, role_id }).eq('id', editUser.id)
    setEditUser(null)
    load()
  }

  const filtered = users.filter(u =>
    (u.name ?? '').includes(search) || (u.email ?? '').includes(search)
  )

  // 角色統計（legacy 'employee' 視為 office_staff）
  const adminCount    = users.filter(u => u.role === 'admin' || u.role === 'super_admin').length
  const managerCount  = users.filter(u => u.role === 'manager').length
  const staffCount    = users.filter(u => ['store_staff', 'office_staff', 'employee'].includes(u.role) || !u.role).length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><UserCog size={20} /></span> 角色與權限</h2>
            <p>指派在職員工的系統權限 · 員工資料新增 / 離職請至「<a onClick={() => navigate('/org/employees')} style={{ color: 'var(--accent-cyan)', cursor: 'pointer', textDecoration: 'underline' }}>員工管理</a>」</p>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate('/org/employees')}>
            到員工管理 <ArrowRight size={14} />
          </button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">在職員工</div>
          <div className="stat-card-value">{users.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">管理員</div>
          <div className="stat-card-value">{adminCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">主管</div>
          <div className="stat-card-value">{managerCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">一般員工</div>
          <div className="stat-card-value">{staffCount}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 帳號列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋使用者..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>姓名</th><th>Email</th><th>角色</th><th>部門</th><th>職稱</th><th></th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                  沒有符合的員工
                </td></tr>
              ) : filtered.map(u => {
                const lbl = toLabel(u.role)
                return (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.name}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{u.email ?? '—'}</td>
                    <td><span className={`badge ${roleColor[lbl] ?? 'badge-neutral'}`}>{lbl}</span></td>
                    <td>{u.dept ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{u.position ?? '—'}</td>
                    <td>
                      <button className="btn btn-ghost" style={{ padding: '2px 8px' }}
                        onClick={() => setEditUser({ ...u, newRole: lbl })}
                        title="變更角色">
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editUser && (
        <Modal title={`編輯角色 — ${editUser.name}`} onClose={() => setEditUser(null)} onSubmit={handleEditRole}>
          <Field label="角色">
            <select className="form-input" style={{ width: '100%' }}
              value={editUser.newRole}
              onChange={e => setEditUser(u => ({ ...u, newRole: e.target.value }))}>
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </div>
  )
}
