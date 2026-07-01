import { useState, useEffect, useCallback } from 'react'
import { Building2, Users, Settings, Shield, Plus, Edit, Trash2, Globe, Database, RefreshCw } from 'lucide-react'
import Modal, { Field } from '../../components/Modal'
import { useTenant } from '../../contexts/TenantContext'
import { useAuth } from '../../contexts/AuthContext'
import { getTenants, createTenantRecord, updateTenantRecord, deleteTenantRecord } from '../../lib/db'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const PLANS = ['免費', '標準', '專業', '企業']
const STATUSES = ['啟用', '暫停', '試用']
const FEATURES = ['HR', 'Finance', 'CRM', 'WMS', 'POS', 'Manufacturing']

const planColor = { '免費': 'badge-neutral', '標準': 'badge-info', '專業': 'badge-purple', '企業': 'badge-danger' }
const statusColor = { '啟用': 'badge-success', '暫停': 'badge-warning', '試用': 'badge-info' }

const emptyForm = { name: '', tax_id: '', plan: '標準', max_users: 25, admin_email: '', status: '啟用', features: ['HR', 'Finance'] }

export default function TenantAdmin() {
  const { tenant: activeTenant, switchTenant } = useTenant()
  const { hasPermission } = useAuth()
  const isSuperAdmin = hasPermission('nav.group.super_admin')
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchTenants = useCallback(async () => {
    if (!isSuperAdmin) return
    setLoading(true)
    const { data, error } = await getTenants()
    if (!error && data) setTenants(data)
    setLoading(false)
  }, [isSuperAdmin])

  useEffect(() => { fetchTenants() }, [fetchTenants])

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
    setForm({
      name: t.name || '',
      tax_id: t.tax_id || '',
      plan: t.plan || '標準',
      max_users: t.max_users || 25,
      admin_email: t.admin_email || '',
      status: t.status || '啟用',
      features: Array.isArray(t.features) ? [...t.features] : ['HR', 'Finance'],
    })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    if (!form.name || !form.tax_id || !form.admin_email) return
    setSaving(true)
    const slug = form.tax_id.toLowerCase().replace(/[^a-z0-9]/g, '')
    const payload = { ...form, slug, is_active: form.status === '啟用' }

    if (editId) {
      const { error } = await updateTenantRecord(editId, payload)
      if (error) { toast.error('儲存失敗，請稍後再試'); setSaving(false); return }
    } else {
      const { error } = await createTenantRecord(payload)
      if (error) { toast.error('新增失敗，請稍後再試'); setSaving(false); return }
    }
    setSaving(false)
    setShowModal(false)
    setForm(emptyForm)
    setEditId(null)
    fetchTenants()
  }

  const handleDelete = async (id) => {
    if (activeTenant?.id === id) { toast.error('無法刪除目前使用中的租戶，請先切換租戶後再操作。'); return }
    if (!(await confirm({ message: '確定要刪除此租戶？此操作無法復原。' }))) return
    const { error } = await deleteTenantRecord(id)
    if (error) { toast.error('刪除失敗，請稍後再試'); return }
    fetchTenants()
  }

  if (!isSuperAdmin) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
      <Shield size={48} style={{ color: 'var(--accent-red)' }} />
      <h2>超級管理員專屬</h2>
      <p style={{ color: 'var(--text-secondary)' }}>此頁面僅限超級管理員存取</p>
    </div>
  )

  const filtered = tenants.filter(t =>
    (t.name || '').includes(search) || (t.tax_id || '').includes(search)
  )

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
                目前租戶：<strong style={{ color: 'var(--accent-cyan)' }}>{activeTenant.name}</strong>
              </span>
            )}
            <button className="btn btn-secondary" onClick={fetchTenants} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> 重新整理</button>
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
          <div className="stat-card-label"><Users size={14} /> 使用者上限合計</div>
          <div className="stat-card-value">{tenants.reduce((s, t) => s + (t.max_users || 0), 0)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-yellow)', '--card-accent-dim': 'var(--accent-yellow-dim)' }}>
          <div className="stat-card-label"><Database size={14} /> 方案分佈</div>
          <div className="stat-card-value" style={{ fontSize: 14 }}>
            {PLANS.map(p => {
              const c = tenants.filter(t => t.plan === p).length
              return c > 0 ? `${p}:${c}` : null
            }).filter(Boolean).join(' / ') || '-'}
          </div>
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
                <th>使用者上限</th>
                <th>狀態</th>
                <th>功能模組</th>
                <th>建立日期</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>載入中...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無符合條件的租戶</td></tr>
              )}
              {!loading && filtered.map(t => (
                <tr key={t.id} style={activeTenant?.id === t.id ? { background: 'var(--accent-cyan-dim)' } : {}}>
                  <td style={{ fontWeight: 600 }}>
                    <Building2 size={13} style={{ marginRight: 4, verticalAlign: -2, color: 'var(--accent-cyan)' }} />
                    {t.name}
                    {activeTenant?.id === t.id && <span style={{ fontSize: 10, color: 'var(--accent-green)', marginLeft: 6 }}>● 目前</span>}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.tax_id}</td>
                  <td><span className={`badge ${planColor[t.plan] || 'badge-neutral'}`}>{t.plan}</span></td>
                  <td>{t.max_users}</td>
                  <td><span className={`badge ${statusColor[t.status] || 'badge-neutral'}`}>{t.status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {(t.features || []).map(f => <span key={f} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{f}</span>)}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.created_at?.slice(0, 10)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost" title="切換租戶" onClick={async () => { const r = await switchTenant(t); if (r?.error) toast.error(`切換失敗：${r.error}`) }} style={{ padding: '4px 6px' }}>
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
            <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="例：台灣科技股份有限公司" />
          </Field>
          <Field label="統一編號">
            <input className="form-input" value={form.tax_id} onChange={e => set('tax_id', e.target.value)} placeholder="8 碼統一編號" maxLength={8} />
          </Field>
          <Field label="管理員 Email">
            <input className="form-input" type="email" value={form.admin_email} onChange={e => set('admin_email', e.target.value)} placeholder="admin@example.com" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="方案">
              <select className="form-input" value={form.plan} onChange={e => set('plan', e.target.value)}>
                {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="最大使用者數">
              <input className="form-input" type="number" value={form.max_users} onChange={e => set('max_users', parseInt(e.target.value) || 0)} min={1} />
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
