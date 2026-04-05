import { useState } from 'react'
import { Building2, Users, Settings, Shield, Plus, Edit, Trash2, Globe, Database } from 'lucide-react'
import Modal, { Field } from '../../components/Modal'
import { useTenant } from '../../contexts/TenantContext'

const PLANS = ['免費', '標準', '專業', '企業']
const STATUSES = ['啟用', '暫停', '試用']
const FEATURES = ['HR', 'Finance', 'CRM', 'WMS', 'POS', 'Manufacturing']

const planColor = { '免費': 'badge-neutral', '標準': 'badge-info', '專業': 'badge-purple', '企業': 'badge-danger' }
const statusColor = { '啟用': 'badge-success', '暫停': 'badge-warning', '試用': 'badge-info' }

const initialTenants = [
  { id: 1, company: '日盛科技股份有限公司', taxId: '12345678', plan: '企業', users: 58, maxUsers: 100, storage: '12.4 GB', status: '啟用', adminEmail: 'admin@richtech.com.tw', features: ['HR', 'Finance', 'CRM', 'WMS', 'POS', 'Manufacturing'], created: '2024-06-15' },
  { id: 2, company: '美味餐飲集團', taxId: '23456789', plan: '專業', users: 24, maxUsers: 50, storage: '5.8 GB', status: '啟用', adminEmail: 'it@delicious.com.tw', features: ['HR', 'Finance', 'CRM', 'POS'], created: '2024-09-20' },
  { id: 3, company: '綠能環保有限公司', taxId: '34567890', plan: '標準', users: 12, maxUsers: 25, storage: '2.1 GB', status: '試用', adminEmail: 'manager@greeneco.com.tw', features: ['HR', 'Finance', 'WMS'], created: '2025-11-03' },
  { id: 4, company: '快捷物流股份有限公司', taxId: '45678901', plan: '免費', users: 3, maxUsers: 5, storage: '0.4 GB', status: '暫停', adminEmail: 'boss@quickship.com.tw', features: ['HR', 'Finance'], created: '2025-12-28' },
]

const emptyForm = { company: '', taxId: '', plan: '標準', maxUsers: 25, adminEmail: '', status: '啟用', features: ['HR', 'Finance'] }

export default function TenantAdmin() {
  const { tenant: activeTenant, switchTenant } = useTenant()
  const [tenants, setTenants] = useState(initialTenants)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [search, setSearch] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const toggleFeature = (feat) => {
    setForm(f => ({
      ...f,
      features: f.features.includes(feat)
        ? f.features.filter(x => x !== feat)
        : [...f.features, feat],
    }))
  }

  const openCreate = () => {
    setEditId(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  const openEdit = (t) => {
    setEditId(t.id)
    setForm({ company: t.company, taxId: t.taxId, plan: t.plan, maxUsers: t.maxUsers, adminEmail: t.adminEmail, status: t.status, features: [...t.features] })
    setShowModal(true)
  }

  const handleSubmit = () => {
    if (!form.company || !form.taxId || !form.adminEmail) return
    if (editId) {
      setTenants(prev => prev.map(t => t.id === editId ? { ...t, ...form } : t))
    } else {
      const newTenant = { id: Date.now(), ...form, users: 1, storage: '0.0 GB', created: new Date().toISOString().slice(0, 10) }
      setTenants(prev => [...prev, newTenant])
    }
    setShowModal(false)
    setForm(emptyForm)
    setEditId(null)
  }

  const handleDelete = (id) => {
    if (!confirm('確定要刪除此租戶？此操作無法復原。')) return
    setTenants(prev => prev.filter(t => t.id !== id))
  }

  const totalUsers = tenants.reduce((s, t) => s + t.users, 0)
  const totalStorage = tenants.reduce((s, t) => s + parseFloat(t.storage), 0).toFixed(1)
  const filtered = tenants.filter(t => t.company.includes(search) || t.taxId.includes(search))

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🏢</span> 租戶管理</h2>
            <p>多租戶架構管理與監控</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {activeTenant && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 12px', background: 'var(--bg-tertiary)', borderRadius: 8 }}>
                <Globe size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
                目前租戶：<strong style={{ color: 'var(--accent-cyan)' }}>{activeTenant.company}</strong>
              </span>
            )}
            <button className="btn btn-primary" onClick={openCreate}><Plus size={14} /> 新增租戶</button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label"><Building2 size={14} /> 租戶總數</div>
          <div className="stat-card-value">{tenants.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label"><Shield size={14} /> 啟用中</div>
          <div className="stat-card-value">{tenants.filter(t => t.status === '啟用').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label"><Users size={14} /> 使用者總數</div>
          <div className="stat-card-value">{totalUsers}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-amber)', '--card-accent-dim': 'var(--accent-amber-dim)' }}>
          <div className="stat-card-label"><Database size={14} /> 資料庫大小(估)</div>
          <div className="stat-card-value">{totalStorage} GB</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="card-title">租戶列表</h3>
          <input className="form-input" placeholder="搜尋公司名稱或統一編號..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 260 }} />
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>公司名稱</th>
                <th>統一編號</th>
                <th>方案</th>
                <th>使用者</th>
                <th>儲存空間</th>
                <th>狀態</th>
                <th>功能模組</th>
                <th>建立日期</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無符合條件的租戶</td></tr>
              )}
              {filtered.map(t => (
                <tr key={t.id} style={activeTenant?.id === t.id ? { background: 'var(--accent-cyan-dim)' } : {}}>
                  <td style={{ fontWeight: 600 }}>
                    <Building2 size={13} style={{ marginRight: 4, verticalAlign: -2, color: 'var(--accent-cyan)' }} />
                    {t.company}
                    {activeTenant?.id === t.id && <span style={{ fontSize: 10, color: 'var(--accent-green)', marginLeft: 6 }}>● 目前</span>}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.taxId}</td>
                  <td><span className={`badge ${planColor[t.plan] || 'badge-neutral'}`}>{t.plan}</span></td>
                  <td>{t.users} / {t.maxUsers}</td>
                  <td>{t.storage}</td>
                  <td><span className={`badge ${statusColor[t.status] || 'badge-neutral'}`}>{t.status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {t.features.map(f => <span key={f} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{f}</span>)}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.created}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost" title="切換租戶" onClick={() => switchTenant(t)} style={{ padding: '4px 6px' }}>
                        <Globe size={13} />
                      </button>
                      <button className="btn btn-ghost" title="編輯" onClick={() => openEdit(t)} style={{ padding: '4px 6px' }}>
                        <Edit size={13} />
                      </button>
                      <button className="btn btn-ghost" title="刪除" onClick={() => handleDelete(t.id)} style={{ padding: '4px 6px', color: 'var(--accent-red)' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title={editId ? '編輯租戶' : '新增租戶'} onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="公司名稱">
            <input className="form-input" value={form.company} onChange={e => set('company', e.target.value)} placeholder="例：台灣科技股份有限公司" />
          </Field>
          <Field label="統一編號">
            <input className="form-input" value={form.taxId} onChange={e => set('taxId', e.target.value)} placeholder="8 碼統一編號" maxLength={8} />
          </Field>
          <Field label="管理員 Email">
            <input className="form-input" type="email" value={form.adminEmail} onChange={e => set('adminEmail', e.target.value)} placeholder="admin@example.com" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="方案">
              <select className="form-input" value={form.plan} onChange={e => set('plan', e.target.value)}>
                {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="最大使用者數">
              <input className="form-input" type="number" value={form.maxUsers} onChange={e => set('maxUsers', parseInt(e.target.value) || 0)} min={1} />
            </Field>
          </div>
          <Field label="狀態">
            <select className="form-input" value={form.status} onChange={e => set('status', e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="功能模組">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {FEATURES.map(f => (
                <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.features.includes(f)} onChange={() => toggleFeature(f)} />
                  {f}
                </label>
              ))}
            </div>
          </Field>
        </Modal>
      )}
    </div>
  )
}
