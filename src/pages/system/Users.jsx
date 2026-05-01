import { useState, useEffect } from 'react'
import { Plus, Search, Pencil } from 'lucide-react'
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
}
const ROLES = Object.keys(ROLE_MAP)
const DEPTS = ['研發部', '行銷部', '業務部', '人資部', '財務部', '客服部', '品牌行銷部', '門市運營部', '採購部', '行政部', '倉儲部']
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
  const orgId = profile?.organization_id

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', role: '門市人員', dept: DEPTS[0] })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => { load() }, [orgId])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('employees')
      .select('id, name, email, role, dept, status, position')
      .eq('organization_id', orgId)
      .order('id')
    setUsers(data ?? [])
    setLoading(false)
  }

  const handleAdd = async () => {
    if (!form.name) return
    const { role, role_id } = ROLE_MAP[form.role]
    await supabase.from('employees').insert({
      name: form.name,
      email: form.email || null,
      role,
      role_id,
      dept: form.dept,
      organization_id: orgId,
      status: '在職',
    })
    setShowAdd(false)
    setForm({ name: '', email: '', role: '門市人員', dept: DEPTS[0] })
    load()
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

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">👥</span> 使用者管理</h2>
            <p>系統帳號與權限管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={14} /> 新增使用者</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">啟用帳號</div>
          <div className="stat-card-value">{users.filter(u => u.status === '在職').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">停用帳號</div>
          <div className="stat-card-value">{users.filter(u => u.status !== '在職').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">管理員</div>
          <div className="stat-card-value">{users.filter(u => u.role === 'admin' || u.role === 'super_admin').length}</div>
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
              <tr><th>姓名</th><th>Email</th><th>角色</th><th>部門</th><th>職稱</th><th>狀態</th><th></th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</td></tr>
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
                      <span className={`badge ${u.status === '在職' ? 'badge-success' : 'badge-neutral'}`}>
                        <span className="badge-dot"></span>{u.status ?? '—'}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-ghost" style={{ padding: '2px 8px' }}
                        onClick={() => setEditUser({ ...u, newRole: lbl })}>
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

      {showAdd && (
        <Modal title="新增使用者" onClose={() => setShowAdd(false)} onSubmit={handleAdd}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="姓名 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="王小明" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="Email">
              <input className="form-input" type="email" style={{ width: '100%' }} placeholder="user@company.com" value={form.email} onChange={e => set('email', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="角色">
              <select className="form-input" style={{ width: '100%' }} value={form.role} onChange={e => set('role', e.target.value)}>
                {ROLES.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="部門">
              <select className="form-input" style={{ width: '100%' }} value={form.dept} onChange={e => set('dept', e.target.value)}>
                {DEPTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </Field>
          </div>
        </Modal>
      )}

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
