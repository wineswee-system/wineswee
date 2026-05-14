import { useState, useEffect } from 'react'
import { Plus, Search, Star, Pencil, Trash2, FileText, Building2 } from 'lucide-react'
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier, getVendorCategories, getSupplierContracts, getPurchaseOrders } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const PAYMENT_TERMS = ['COD', 'NET15', 'NET30', 'NET45', 'NET60']
const EMPTY_FORM = { name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: 'NET30', status: '合作中', tax_id: '', bank_name: '', bank_account: '', category_id: '', tags: '', notes: '' }

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([])
  const [categories, setCategories] = useState([])
  const [contracts, setContracts] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => {
    Promise.all([
      getSuppliers().then(({ data }) => data || []).catch(() => []),
      getVendorCategories().then(({ data }) => data || []).catch(() => []),
      getSupplierContracts().then(({ data }) => data || []).catch(() => []),
      getPurchaseOrders().then(({ data }) => data || []).catch(() => []),
    ]).then(([s, c, ct, o]) => {
      setSuppliers(s)
      setCategories(c)
      setContracts(ct)
      setOrders(o)
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowModal(true)
  }

  const openEdit = (s) => {
    setEditingId(s.id)
    setForm({
      name: s.name || '', contact_person: s.contact_person || '', phone: s.phone || '',
      email: s.email || '', address: s.address || '', payment_terms: s.payment_terms || 'NET30',
      status: s.status || '合作中', tax_id: s.tax_id || '', bank_name: s.bank_name || '',
      bank_account: s.bank_account || '', category_id: s.category_id || '', tags: s.tags || '', notes: s.notes || '',
    })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    if (!form.name) return
    const payload = { ...form, category_id: form.category_id || null }

    if (editingId) {
      const { data } = await updateSupplier(editingId, payload).catch(() => ({ data: null }))
      if (data) {
        setSuppliers(prev => prev.map(s => s.id === editingId ? data : s))
      } else {
        setSuppliers(prev => prev.map(s => s.id === editingId ? { ...s, ...payload } : s))
      }
    } else {
      const { data } = await createSupplier({ ...payload, rating: 3 })
      if (data) {
        setSuppliers(prev => [...prev, data])
      }
    }
    setShowModal(false)
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  const handleDelete = async (id) => {
    await deleteSupplier(id).catch(() => {})
    setSuppliers(prev => prev.filter(s => s.id !== id))
    setDeleteConfirm(null)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = suppliers.filter(s =>
    search === '' || s.name?.includes(search) || s.contact_person?.includes(search) || s.tax_id?.includes(search)
  )

  const total = suppliers.length
  const active = filtered.filter(s => s.status === '合作中').length
  const paused = filtered.filter(s => s.status === '暫停').length
  const avgRating = filtered.length > 0 ? (filtered.reduce((sum, s) => sum + (s.rating || 0), 0) / filtered.length).toFixed(1) : '0.0'

  const getContractCount = (supplier) => contracts.filter(c => c.supplier_id === supplier.id).length
  const getOrderCount = (supplier) => orders.filter(o => o.supplier === supplier.name).length
  const getCategoryName = (catId) => categories.find(c => c.id === catId)?.name || '-'

  const renderStars = (rating) => {
    const r = Math.round(rating || 0)
    return (
      <span style={{ display: 'inline-flex', gap: 2 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <Star key={i} size={14} fill={i <= r ? 'var(--accent-orange)' : 'none'} stroke={i <= r ? 'var(--accent-orange)' : 'var(--text-muted)'} />
        ))}
      </span>
    )
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📦</span> 供應商管理</h2>
            <p>供應商資料、評等與關聯管理</p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={14} /> 新增供應商</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">全部供應商</div>
          <div className="stat-card-value">{total}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">合作中</div>
          <div className="stat-card-value">{active}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">暫停</div>
          <div className="stat-card-value">{paused}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">平均評等</div>
          <div className="stat-card-value">{avgRating}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 供應商列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋供應商名稱、聯絡人、統編..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>供應商名稱</th><th>分類</th><th>統編</th><th>聯絡人</th><th>電話</th><th>付款條件</th><th>合約/PO</th><th>評等</th><th>狀態</th><th style={{ width: 90 }}>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無供應商</td></tr>}
              {filtered.map(s => {
                const cc = getContractCount(s)
                const oc = getOrderCount(s)
                return (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Building2 size={14} style={{ color: 'var(--accent-blue)' }} />
                        {s.name}
                      </div>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{getCategoryName(s.category_id)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.tax_id || '-'}</td>
                    <td>{s.contact_person}</td>
                    <td>{s.phone}</td>
                    <td><span className="badge badge-info"><span className="badge-dot"></span>{s.payment_terms}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                        {cc > 0 && <span style={{ color: 'var(--accent-green)' }}><FileText size={12} style={{ marginRight: 2 }} />{cc} 合約</span>}
                        {oc > 0 && <span style={{ color: 'var(--accent-blue)' }}><FileText size={12} style={{ marginRight: 2 }} />{oc} PO</span>}
                        {cc === 0 && oc === 0 && <span style={{ color: 'var(--text-muted)' }}>-</span>}
                      </div>
                    </td>
                    <td>{renderStars(s.rating)}</td>
                    <td>
                      <span className={`badge ${s.status === '合作中' ? 'badge-success' : s.status === '暫停' ? 'badge-warning' : 'badge-danger'}`}>
                        <span className="badge-dot"></span>{s.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => openEdit(s)}><Pencil size={13} /></button>
                        <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => setDeleteConfirm(s.id)}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {deleteConfirm && (
        <Modal title="確認刪除" onClose={() => setDeleteConfirm(null)} onSubmit={() => handleDelete(deleteConfirm)} submitLabel="刪除">
          <p style={{ color: 'var(--text-secondary)' }}>確定要刪除此供應商嗎？相關合約與採購單不會被刪除，但將失去關聯。</p>
        </Modal>
      )}

      {showModal && (
        <Modal title={editingId ? '編輯供應商' : '新增供應商'} onClose={() => { setShowModal(false); setEditingId(null) }} onSubmit={handleSubmit}>
          <Field label="供應商名稱" required>
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="供應商名稱" value={form.name} onChange={e => set('name', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="統一編號">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="12345678" value={form.tax_id} onChange={e => set('tax_id', e.target.value)} />
            </Field>
            <Field label="分類">
              <select className="form-input" style={{ width: '100%' }} value={form.category_id} onChange={e => set('category_id', e.target.value ? Number(e.target.value) : '')}>
                <option value="">未分類</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="聯絡人">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="聯絡人姓名" value={form.contact_person} onChange={e => set('contact_person', e.target.value)} />
            </Field>
            <Field label="電話">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="02-1234-5678" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </Field>
          </div>
          <Field label="Email">
            <input className="form-input" type="email" style={{ width: '100%' }} placeholder="supplier@example.com" value={form.email} onChange={e => set('email', e.target.value)} />
          </Field>
          <Field label="地址">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="供應商地址" value={form.address} onChange={e => set('address', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="付款條件">
              <select className="form-input" style={{ width: '100%' }} value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)}>
                {PAYMENT_TERMS.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                <option>合作中</option>
                <option>暫停</option>
                <option>終止</option>
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="銀行名稱">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="銀行名稱" value={form.bank_name} onChange={e => set('bank_name', e.target.value)} />
            </Field>
            <Field label="銀行帳號">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="銀行帳號" value={form.bank_account} onChange={e => set('bank_account', e.target.value)} />
            </Field>
          </div>
          <Field label="標籤">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="以逗號分隔，例：優良供應商, 本地" value={form.tags} onChange={e => set('tags', e.target.value)} />
          </Field>
          <Field label="備註">
            <textarea className="form-input" style={{ width: '100%', minHeight: 60, resize: 'vertical' }} placeholder="備註事項" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
