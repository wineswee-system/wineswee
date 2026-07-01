import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, Building2 } from 'lucide-react'
import { getOrganizations, createOrganization, updateOrganization, deleteOrganization, getCompanies, getStores, getEmployees } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const PLANS = [
  { value: 'free', label: '免費版', color: 'var(--text-muted)', bg: 'var(--bg-tertiary)' },
  { value: 'starter', label: '入門版', color: 'var(--accent-cyan)', bg: 'var(--accent-cyan-dim)' },
  { value: 'pro', label: '專業版', color: 'var(--accent-purple)', bg: 'var(--accent-purple-dim)' },
  { value: 'enterprise', label: '企業版', color: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)' },
]

const STATUSES = [
  { value: 'active', label: '啟用', badge: 'badge-success' },
  { value: 'suspended', label: '暫停', badge: 'badge-warning' },
  { value: 'archived', label: '封存', badge: 'badge-danger' },
]

export default function Organizations() {
  const { hasPermission, loading: authLoading, profileReady } = useAuth()
  const isSuperAdmin = hasPermission('nav.group.super_admin')
  const [orgs, setOrgs] = useState([])
  const [companies, setCompanies] = useState([])
  const [stores, setStores] = useState([])
  const [employees, setEmployees] = useState([])
  const [subscriptions, setSubscriptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingOrg, setEditingOrg] = useState(null)
  const [form, setForm] = useState({ name: '', slug: '', tax_id: '', contact_person: '', phone: '', address: '', status: 'active', plan: 'free' })

  useEffect(() => {
    if (!isSuperAdmin) return
    Promise.all([
      getOrganizations(), getCompanies(), getStores(), getEmployees(),
      supabase.from('org_subscriptions').select('*').order('created_at', { ascending: false }),
    ]).then(([o, c, s, e, sub]) => {
      setOrgs(o.data || [])
      setCompanies(c.data || [])
      setStores(s.data || [])
      setEmployees(e.data || [])
      setSubscriptions(sub.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [isSuperAdmin])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const openCreate = () => {
    setEditingOrg(null)
    setForm({ name: '', slug: '', tax_id: '', contact_person: '', phone: '', address: '', status: 'active', plan: 'free' })
    setShowModal(true)
  }

  const openEdit = (o) => {
    setEditingOrg(o)
    setForm({
      name: o.name || '', slug: o.slug || '', tax_id: o.tax_id || '',
      contact_person: o.contact_person || '', phone: o.phone || '',
      address: o.address || '', status: o.status || 'active', plan: o.plan || 'free',
    })
    setShowModal(true)
  }

  const handleDelete = async (o) => {
    const orgCompanies = companies.filter(c => c.organization_id === o.id)
    if (orgCompanies.length > 0) { toast.error(`無法刪除：該組織下有 ${orgCompanies.length} 間公司`); return }
    if (!(await confirm({ message: `確定要刪除「${o.name}」嗎？` }))) return
    try {
      await deleteOrganization(o.id)
      setOrgs(prev => prev.filter(x => x.id !== o.id))
    } catch (err) {
      toast.error('刪除失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleSubmit = async () => {
    if (!form.name || !form.slug) return
    try {
      if (editingOrg) {
        const { data, error } = await updateOrganization(editingOrg.id, form)
        if (error) throw error
        if (data) setOrgs(prev => prev.map(o => o.id === data.id ? data : o))
      } else {
        const { data, error } = await createOrganization(form)
        if (error) throw error
        if (data) setOrgs(prev => [...prev, data])
      }
      setShowModal(false)
      setEditingOrg(null)
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (authLoading || !profileReady) return <LoadingSpinner />
  if (!isSuperAdmin) return <Navigate to="/" replace />
  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><Building2 size={20} /></span> 組織管理</h2>
            <p>多租戶組織設定（Organization &gt; Company &gt; Store &gt; Department）</p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={14} /> 新增組織</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">組織數</div>
          <div className="stat-card-value">{orgs.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">公司數</div>
          <div className="stat-card-value">{companies.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">門市數</div>
          <div className="stat-card-value">{stores.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">總員工</div>
          <div className="stat-card-value">{employees.filter(e => e.status === '在職').length}</div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>組織名稱</th><th>代碼</th><th>統一編號</th><th>聯絡人</th><th>電話</th><th>方案</th><th>公司數</th><th>門市數</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {orgs.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無組織資料</td></tr>}
              {orgs.map(o => {
                const orgCompanies = companies.filter(c => c.organization_id === o.id)
                const orgStores = stores.filter(s => s.organization_id === o.id)
                const sub = subscriptions.find(s => s.organization_id === o.id)
                const planInfo = PLANS.find(p => p.value === (sub?.plan || o.plan)) || PLANS[0]
                const statusInfo = STATUSES.find(s => s.value === o.status) || STATUSES[0]
                return (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>{o.name}</td>
                  <td><span style={{ fontFamily: 'monospace', fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', fontWeight: 600 }}>{o.slug}</span></td>
                  <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{o.tax_id || '-'}</td>
                  <td>{o.contact_person || '-'}</td>
                  <td>{o.phone || '-'}</td>
                  <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: planInfo.color, background: planInfo.bg }}>{planInfo.label}</span></td>
                  <td>{orgCompanies.length}</td>
                  <td>{orgStores.length}</td>
                  <td>
                    <span className={`badge ${statusInfo.badge}`}>
                      <span className="badge-dot"></span>{statusInfo.label}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(o)}><Pencil size={12} /></button>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(o)} style={{ color: 'var(--accent-red)' }}><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title={editingOrg ? `編輯組織 — ${editingOrg.name}` : '新增組織'} onClose={() => { setShowModal(false); setEditingOrg(null) }} onSubmit={handleSubmit} submitLabel={editingOrg ? '儲存變更' : '新增'}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="組織名稱" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：好日子餐飲集團" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="代碼 (slug)" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：haorizi-group" value={form.slug} onChange={e => set('slug', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="統一編號">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="12345678" value={form.tax_id} onChange={e => set('tax_id', e.target.value)} />
            </Field>
            <Field label="聯絡人">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="負責人姓名" value={form.contact_person} onChange={e => set('contact_person', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="電話">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="02-1234-5678" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </Field>
            <Field label="方案">
              <select className="form-input" style={{ width: '100%' }} value={form.plan} onChange={e => set('plan', e.target.value)}>
                {PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="地址">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="台北市信義區信義路五段 7 號" value={form.address} onChange={e => set('address', e.target.value)} />
          </Field>
          <Field label="狀態">
            <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </div>
  )
}
