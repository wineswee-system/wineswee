import { useState, useEffect, useCallback } from 'react'
import {
  Building2, Users, Shield, Plus, Edit, Trash2, Globe, RefreshCw,
  Search, ChevronDown, ChevronUp, Package, Eye, Settings, Check, X
} from 'lucide-react'
import Modal, { Field } from '../../components/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { getTenants, createTenantRecord, updateTenantRecord, deleteTenantRecord, getTenantEmployees } from '../../lib/db'

import { confirm } from '../../lib/confirm'
const PLANS = ['免費', '標準', '專業', '企業']
const STATUSES = ['啟用', '暫停', '試用']
const ALL_MODULES = [
  { key: 'HR', label: '人力資源', color: '#a78bfa' },
  { key: 'Finance', label: '財務會計', color: '#fbbf24' },
  { key: 'CRM', label: '客戶管理', color: '#3b82f6' },
  { key: 'Sales', label: '銷售管理', color: '#22d3ee' },
  { key: 'POS', label: '收銀系統', color: '#f472b6' },
  { key: 'WMS', label: '倉儲管理', color: '#34d399' },
  { key: 'Purchase', label: '採購管理', color: '#fb923c' },
  { key: 'Manufacturing', label: '製造管理', color: '#64748b' },
  { key: 'Analytics', label: '數據分析', color: '#e879f9' },
  { key: 'Process', label: '流程管理', color: '#06b6d4' },
  { key: 'Integration', label: '外部整合', color: '#84cc16' },
  { key: 'AI', label: 'AI 助手', color: '#f43f5e' },
]

const planLimits = { '免費': 5, '標準': 25, '專業': 100, '企業': 999 }
const planColor = { '免費': 'badge-neutral', '標準': 'badge-info', '專業': 'badge-purple', '企業': 'badge-danger' }
const statusColor = { '啟用': 'badge-success', '暫停': 'badge-warning', '試用': 'badge-info' }

const emptyForm = {
  name: '', tax_id: '', plan: '標準', max_users: 25, admin_email: '',
  status: '啟用', features: ['HR', 'Finance'],
  contact_name: '', contact_phone: '', address: '', notes: ''
}

export default function OrgManagement() {
  const { isSuperAdmin } = useAuth()
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [expandedOrg, setExpandedOrg] = useState(null)
  const [orgUsers, setOrgUsers] = useState({})
  const [filterPlan, setFilterPlan] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const fetchTenants = useCallback(async () => {
    setLoading(true)
    const { data, error } = await getTenants()
    if (!error && data) setTenants(data)
    setLoading(false)
  }, [])

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
      contact_name: t.contact_name || '',
      contact_phone: t.contact_phone || '',
      address: t.address || '',
      notes: t.notes || '',
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
      if (error) { console.error('Update error:', error); setSaving(false); return }
    } else {
      const { error } = await createTenantRecord(payload)
      if (error) { console.error('Create error:', error); setSaving(false); return }
    }
    setSaving(false)
    setShowModal(false)
    setForm(emptyForm)
    setEditId(null)
    fetchTenants()
  }

  const handleDelete = async (id) => {
    if (!(await confirm({ message: '確定要刪除此組織？所有關聯資料將一併刪除，此操作無法復原。' }))) return
    const { error } = await deleteTenantRecord(id)
    if (error) { console.error('Delete error:', error); return }
    fetchTenants()
  }

  const toggleExpand = async (tenantId) => {
    if (expandedOrg === tenantId) {
      setExpandedOrg(null)
      return
    }
    setExpandedOrg(tenantId)
    if (!orgUsers[tenantId]) {
      const { data } = await getTenantEmployees(tenantId)
      setOrgUsers(prev => ({ ...prev, [tenantId]: data || [] }))
    }
  }

  const filtered = tenants.filter(t => {
    const matchSearch = !search || (t.name || '').includes(search) || (t.tax_id || '').includes(search) || (t.admin_email || '').includes(search)
    const matchPlan = !filterPlan || t.plan === filterPlan
    const matchStatus = !filterStatus || t.status === filterStatus
    return matchSearch && matchPlan && matchStatus
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

  const activeCount = tenants.filter(t => t.status === '啟用').length
  const totalUsers = tenants.reduce((s, t) => s + (t.max_users || 0), 0)
  const totalModules = tenants.reduce((s, t) => s + (t.features?.length || 0), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><Shield size={22} /></span> 組織管理</h2>
            <p>超級管理員 — 管理所有組織、方案與模組配置</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-secondary" onClick={fetchTenants} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> 重新整理
            </button>
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={14} /> 新增組織
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label"><Building2 size={14} /> 組織總數</div>
          <div className="stat-card-value">{tenants.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label"><Check size={14} /> 啟用中</div>
          <div className="stat-card-value">{activeCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label"><Users size={14} /> 使用者上限合計</div>
          <div className="stat-card-value">{totalUsers}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-amber)', '--card-accent-dim': 'var(--accent-amber-dim)' }}>
          <div className="stat-card-label"><Package size={14} /> 模組啟用合計</div>
          <div className="stat-card-value">{totalModules}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="form-input"
              placeholder="搜尋組織名稱、統一編號、Email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 32, width: '100%' }}
            />
          </div>
          <select className="form-input" value={filterPlan} onChange={e => setFilterPlan(e.target.value)} style={{ width: 120 }}>
            <option value="">全部方案</option>
            {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="form-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 120 }}>
            <option value="">全部狀態</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Org Table */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">組織列表 ({filtered.length})</h3>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>組織名稱</th>
                <th>統一編號</th>
                <th>管理員</th>
                <th>方案</th>
                <th>使用者上限</th>
                <th>狀態</th>
                <th>啟用模組</th>
                <th>建立日期</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>載入中...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無符合條件的組織</td></tr>
              )}
              {!loading && filtered.map(t => (
                <>
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => toggleExpand(t.id)}>
                    <td>
                      {expandedOrg === t.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      <Building2 size={13} style={{ marginRight: 4, verticalAlign: -2, color: 'var(--accent-cyan)' }} />
                      {t.name}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.tax_id}</td>
                    <td style={{ fontSize: 12 }}>{t.admin_email}</td>
                    <td><span className={`badge ${planColor[t.plan] || 'badge-neutral'}`}>{t.plan}</span></td>
                    <td>{t.max_users}</td>
                    <td><span className={`badge ${statusColor[t.status] || 'badge-neutral'}`}>{t.status}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {(t.features || []).map(f => {
                          const mod = ALL_MODULES.find(m => m.key === f)
                          return (
                            <span key={f} style={{
                              fontSize: 10, padding: '1px 6px', borderRadius: 4,
                              background: mod ? mod.color + '22' : 'var(--bg-tertiary)',
                              color: mod ? mod.color : 'var(--text-secondary)',
                              border: `1px solid ${mod ? mod.color + '44' : 'transparent'}`
                            }}>{f}</span>
                          )
                        })}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.created_at?.slice(0, 10)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-ghost" title="編輯" onClick={() => openEdit(t)} style={{ padding: '4px 6px' }}>
                          <Edit size={13} />
                        </button>
                        <button className="btn btn-ghost" title="刪除" onClick={() => handleDelete(t.id)} style={{ padding: '4px 6px', color: 'var(--accent-red)' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedOrg === t.id && (
                    <tr key={`${t.id}-detail`}>
                      <td colSpan={10} style={{ background: 'var(--bg-secondary)', padding: '12px 24px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                          <div>
                            <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>組織資訊</h4>
                            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                              <div><strong>聯絡人：</strong>{t.contact_name || '-'}</div>
                              <div><strong>電話：</strong>{t.contact_phone || '-'}</div>
                              <div><strong>地址：</strong>{t.address || '-'}</div>
                              <div><strong>備註：</strong>{t.notes || '-'}</div>
                            </div>
                          </div>
                          <div>
                            <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>
                              <Users size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                              使用者 ({orgUsers[t.id]?.length || 0} / {t.max_users})
                            </h4>
                            {orgUsers[t.id]?.length > 0 ? (
                              <div style={{ maxHeight: 150, overflow: 'auto', fontSize: 12 }}>
                                {orgUsers[t.id].map(u => (
                                  <div key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', borderBottom: '1px solid var(--border-color)' }}>
                                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-cyan)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600 }}>
                                      {u.name?.[0]}
                                    </div>
                                    <span style={{ fontWeight: 500 }}>{u.name}</span>
                                    <span style={{ color: 'var(--text-muted)' }}>{u.email}</span>
                                    <span className={`badge ${u.role === 'admin' ? 'badge-purple' : 'badge-neutral'}`} style={{ fontSize: 10 }}>{u.role || '一般'}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>尚無使用者資料</div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <Modal title={editId ? '編輯組織' : '新增組織'} onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="組織名稱" required>
            <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="例：台灣科技股份有限公司" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="統一編號" required>
              <input className="form-input" value={form.tax_id} onChange={e => set('tax_id', e.target.value)} placeholder="8 碼統一編號" maxLength={8} />
            </Field>
            <Field label="管理員 Email" required>
              <input className="form-input" type="email" value={form.admin_email} onChange={e => set('admin_email', e.target.value)} placeholder="admin@example.com" />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="聯絡人">
              <input className="form-input" value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="主要聯絡人姓名" />
            </Field>
            <Field label="聯絡電話">
              <input className="form-input" value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} placeholder="02-1234-5678" />
            </Field>
          </div>
          <Field label="地址">
            <input className="form-input" value={form.address} onChange={e => set('address', e.target.value)} placeholder="公司地址" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <Field label="方案">
              <select className="form-input" value={form.plan} onChange={e => { set('plan', e.target.value); set('max_users', planLimits[e.target.value] || 25) }}>
                {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="最大使用者數">
              <input className="form-input" type="number" value={form.max_users} onChange={e => set('max_users', parseInt(e.target.value) || 0)} min={1} />
            </Field>
            <Field label="狀態">
              <select className="form-input" value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="啟用模組">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {ALL_MODULES.map(m => (
                <label key={m.key} style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer',
                  padding: '6px 10px', borderRadius: 6,
                  background: form.features.includes(m.key) ? m.color + '18' : 'transparent',
                  border: `1px solid ${form.features.includes(m.key) ? m.color + '55' : 'var(--border-color)'}`,
                  transition: 'all 0.15s'
                }}>
                  <input type="checkbox" checked={form.features.includes(m.key)} onChange={() => toggleFeature(m.key)} />
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="備註">
            <textarea className="form-input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="其他備註資訊..." />
          </Field>
        </Modal>
      )}
    </div>
  )
}
