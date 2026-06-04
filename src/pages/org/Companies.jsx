import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { getCompanies, createCompany, updateCompany, deleteCompany, getStores, getEmployees } from '../../lib/db'
import { useOrgId } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
export default function Companies() {
  const orgId = useOrgId()
  const [companies, setCompanies] = useState([])
  const [stores, setStores] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingCompany, setEditingCompany] = useState(null)
  const [form, setForm] = useState({ name: '', short_name: '', tax_id: '', phone: '', address: '', status: '營運中' })

  useEffect(() => {
    Promise.all([getCompanies(orgId), getStores(orgId), getEmployees(orgId)]).then(([c, s, e]) => {
      setCompanies(c.data || [])
      setStores(s.data || [])
      setEmployees(e.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [orgId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const openCreate = () => {
    setEditingCompany(null)
    setForm({ name: '', short_name: '', tax_id: '', phone: '', address: '', status: '營運中', organization_id: orgId })
    setShowModal(true)
  }

  const openEdit = (c) => {
    setEditingCompany(c)
    setForm({ name: c.name || '', short_name: c.short_name || '', tax_id: c.tax_id || '', phone: c.phone || '', address: c.address || '', status: c.status || '營運中' })
    setShowModal(true)
  }

  const handleDelete = async (c) => {
    const storeCount = stores.filter(s => s.company_id === c.id).length
    if (storeCount > 0) { toast.error(`無法刪除：該公司下有 ${storeCount} 間門市`); return }
    if (!(await confirm({ message: `確定要刪除「${c.name}」嗎？` }))) return
    try {
      await deleteCompany(c.id)
      setCompanies(prev => prev.filter(x => x.id !== c.id))
    } catch (err) {
      toast.error('刪除失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleSubmit = async () => {
    if (!form.name) return
    try {
      if (editingCompany) {
        const { data, error } = await updateCompany(editingCompany.id, form)
        if (error) throw error
        if (data) setCompanies(prev => prev.map(c => c.id === data.id ? data : c))
      } else {
        const { data, error } = await createCompany(form)
        if (error) throw error
        if (data) setCompanies(prev => [...prev, data])
      }
      setShowModal(false)
      setEditingCompany(null)
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🏢</span> 公司</h2>
            <p>集團旗下公司管理</p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={14} /> 新增公司</button>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>公司名稱</th><th>簡稱</th><th>統一編號</th><th>電話</th><th>門市數</th><th>員工數</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {companies.map(c => {
                const companyStores = stores.filter(s =>
                  s.company_id === c.id ||
                  (c.organization_id && s.organization_id === c.organization_id && !s.company_id)
                )
                const storeIds = new Set(companyStores.map(s => s.id))
                const empCount = employees.filter(e =>
                  e.status === '在職' && (
                    storeIds.has(e.store_id) ||
                    (c.organization_id && e.organization_id === c.organization_id && !e.store_id)
                  )
                ).length
                return (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td><span className="badge badge-cyan">{c.short_name}</span></td>
                  <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{c.tax_id}</td>
                  <td>{c.phone}</td>
                  <td>{companyStores.length}</td>
                  <td>{empCount}</td>
                  <td>
                    <span className={`badge ${c.status === '營運中' ? 'badge-success' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{c.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(c)}><Pencil size={12} /></button>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(c)} style={{ color: 'var(--accent-red)' }}><Trash2 size={12} /></button>
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
        <Modal title={editingCompany ? `編輯公司 — ${editingCompany.name}` : '新增公司'} onClose={() => { setShowModal(false); setEditingCompany(null) }} onSubmit={handleSubmit} submitLabel={editingCompany ? '儲存變更' : '新增'}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="公司名稱" required>
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="XX股份有限公司" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="簡稱">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="XX公司" value={form.short_name} onChange={e => set('short_name', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="統一編號">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="12345678" value={form.tax_id} onChange={e => set('tax_id', e.target.value)} />
            </Field>
            <Field label="電話">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="02-1234-5678" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </Field>
          </div>
          <Field label="地址">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="台北市信義區信義路五段 7 號" value={form.address} onChange={e => set('address', e.target.value)} />
          </Field>
          <Field label="狀態">
            <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
              <option>營運中</option>
              <option>籌備中</option>
              <option>已停業</option>
            </select>
          </Field>
        </Modal>
      )}
    </div>
  )
}
