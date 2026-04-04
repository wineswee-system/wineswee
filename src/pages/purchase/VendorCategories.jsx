import { useState, useEffect } from 'react'
import { Plus, Search, Pencil, Trash2, Tag, Folder } from 'lucide-react'
import { getVendorCategories, createVendorCategory, updateVendorCategory, deleteVendorCategory } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const MOCK_CATEGORIES = [
  { id: 1, name: '原物料', code: 'RAW', description: '生產原料與素材', parent_id: null, status: '啟用' },
  { id: 2, name: '服務', code: 'SVC', description: '外包與專業服務', parent_id: null, status: '啟用' },
  { id: 3, name: '零組件', code: 'CMP', description: '組裝零件與配件', parent_id: null, status: '啟用' },
  { id: 4, name: '包材', code: 'PKG', description: '包裝材料', parent_id: 1, status: '啟用' },
  { id: 5, name: '設備', code: 'EQP', description: '機器設備與工具', parent_id: null, status: '啟用' },
  { id: 6, name: 'IT 服務', code: 'ITS', description: '資訊系統與技術服務', parent_id: 2, status: '啟用' },
]

const EMPTY_FORM = { name: '', code: '', description: '', parent_id: '', status: '啟用' }

export default function VendorCategories() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  let nextId = 100

  useEffect(() => {
    getVendorCategories()
      .then(({ data }) => { setCategories(data || []) })
      .catch(() => { setCategories(MOCK_CATEGORIES) })
      .finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowModal(true)
  }

  const openEdit = (cat) => {
    setEditingId(cat.id)
    setForm({ name: cat.name, code: cat.code, description: cat.description || '', parent_id: cat.parent_id || '', status: cat.status })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    if (!form.name || !form.code) return
    const payload = { ...form, parent_id: form.parent_id || null }

    if (editingId) {
      const { data } = await updateVendorCategory(editingId, payload).catch(() => ({ data: null }))
      if (data) {
        setCategories(prev => prev.map(c => c.id === editingId ? data : c))
      } else {
        setCategories(prev => prev.map(c => c.id === editingId ? { ...c, ...payload } : c))
      }
    } else {
      const { data } = await createVendorCategory(payload).catch(() => ({ data: null }))
      if (data) {
        setCategories(prev => [...prev, data])
      } else {
        setCategories(prev => [...prev, { ...payload, id: nextId++ }])
      }
    }
    setShowModal(false)
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  const handleDelete = async (id) => {
    await deleteVendorCategory(id).catch(() => {})
    setCategories(prev => prev.filter(c => c.id !== id))
    setDeleteConfirm(null)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = categories.filter(c =>
    search === '' || c.name?.includes(search) || c.code?.toLowerCase().includes(search.toLowerCase())
  )

  const activeCount = categories.filter(c => c.status === '啟用').length
  const subCount = categories.filter(c => c.parent_id).length
  const parentCategories = categories.filter(c => !c.parent_id)
  const getParentName = (parentId) => categories.find(c => c.id === parentId)?.name || '-'

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🏷️</span> 供應商分類</h2>
            <p>管理供應商類別與分類架構</p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={14} /> 新增分類</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">全部分類</div>
          <div className="stat-card-value">{categories.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">啟用中</div>
          <div className="stat-card-value">{activeCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">子分類</div>
          <div className="stat-card-value">{subCount}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Tag size={16} /></span> 分類列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋分類..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>代碼</th><th>名稱</th><th>說明</th><th>上層分類</th><th>狀態</th><th style={{ width: 90 }}>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無分類</td></tr>}
              {filtered.map(c => (
                <tr key={c.id}>
                  <td><span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--accent-blue)' }}>{c.code}</span></td>
                  <td style={{ fontWeight: 600 }}>
                    {c.parent_id ? <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>└</span> : <Folder size={14} style={{ marginRight: 4, color: 'var(--accent-orange)' }} />}
                    {c.name}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{c.description}</td>
                  <td>{c.parent_id ? getParentName(c.parent_id) : '-'}</td>
                  <td>
                    <span className={`badge ${c.status === '啟用' ? 'badge-success' : 'badge-danger'}`}>
                      <span className="badge-dot"></span>{c.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => openEdit(c)}><Pencil size={13} /></button>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => setDeleteConfirm(c.id)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {deleteConfirm && (
        <Modal title="確認刪除" onClose={() => setDeleteConfirm(null)} onSubmit={() => handleDelete(deleteConfirm)} submitLabel="刪除">
          <p style={{ color: 'var(--text-secondary)' }}>確定要刪除此分類嗎？此操作無法復原。</p>
        </Modal>
      )}

      {showModal && (
        <Modal title={editingId ? '編輯分類' : '新增分類'} onClose={() => { setShowModal(false); setEditingId(null) }} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="分類名稱 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：原物料" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="代碼 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：RAW" value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} />
            </Field>
          </div>
          <Field label="說明">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="分類說明" value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="上層分類">
              <select className="form-input" style={{ width: '100%' }} value={form.parent_id} onChange={e => set('parent_id', e.target.value ? Number(e.target.value) : '')}>
                <option value="">無（頂層分類）</option>
                {parentCategories.filter(c => c.id !== editingId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                <option>啟用</option>
                <option>停用</option>
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
