import { useState } from 'react'
import { Plus, Search } from 'lucide-react'
import Modal, { Field } from '../../components/Modal'

const ROLES = ['一般用戶', '主管', 'HR 管理員', '超級管理員']
const DEPTS = ['研發部', '行銷部', '業務部', '人資部', '財務部', '客服部']
const roleColor = { '超級管理員': 'badge-danger', 'HR 管理員': 'badge-purple', '主管': 'badge-info', '一般用戶': 'badge-neutral' }

const initialUsers = [
  { id: 1, name: '曠虎', email: 'tiger@weiyo.com', role: '超級管理員', dept: '總經理室', lastLogin: '2026-04-08 09:30', status: '啟用' },
  { id: 2, name: '陳虹', email: 'hong@weiyo.com', role: '超級管理員', dept: '總經理室', lastLogin: '2026-04-08 08:55', status: '啟用' },
  { id: 3, name: '張啟達', email: 'hr@weiyo.com', role: 'HR 管理員', dept: '人資部', lastLogin: '2026-04-08 10:15', status: '啟用' },
  { id: 4, name: '洪伯嘉', email: 'aska@weiyo.com', role: '主管', dept: '總經理室', lastLogin: '2026-04-08 11:08', status: '啟用' },
  { id: 5, name: 'SNOW', email: 'snow@weiyo.com', role: '主管', dept: '總經理室', lastLogin: '2026-04-08 10:00', status: '啟用' },
  { id: 6, name: 'Dave', email: 'dave@weiyo.com', role: '主管', dept: '總經理室', lastLogin: '2026-04-07 18:10', status: '啟用' },
]

export default function Users() {
  const [users, setUsers] = useState(initialUsers)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: '一般用戶', dept: DEPTS[0] })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = () => {
    if (!form.name || !form.email) return
    const newUser = { id: Date.now(), ...form, lastLogin: '-', status: '啟用' }
    setUsers(prev => [...prev, newUser])
    setShowModal(false)
    setForm({ name: '', email: '', role: '一般用戶', dept: DEPTS[0] })
  }

  const filtered = users.filter(u =>
    u.name.includes(search) || u.email.includes(search)
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">👥</span> 使用者管理</h2>
            <p>系統帳號與權限管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增使用者</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">啟用帳號</div>
          <div className="stat-card-value">{users.filter(u => u.status === '啟用').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">停用帳號</div>
          <div className="stat-card-value">{users.filter(u => u.status === '停用').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">管理員</div>
          <div className="stat-card-value">{users.filter(u => u.role.includes('管理員')).length}</div>
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
              <tr><th>姓名</th><th>Email</th><th>角色</th><th>部門</th><th>最後登入</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.name}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{u.email}</td>
                  <td><span className={`badge ${roleColor[u.role] || 'badge-neutral'}`}>{u.role}</span></td>
                  <td>{u.dept}</td>
                  <td style={{ fontSize: 12 }}>{u.lastLogin}</td>
                  <td>
                    <span className={`badge ${u.status === '啟用' ? 'badge-success' : 'badge-neutral'}`}>
                      <span className="badge-dot"></span>{u.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增使用者" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="姓名 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="王小明" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="Email *">
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
    </div>
  )
}
