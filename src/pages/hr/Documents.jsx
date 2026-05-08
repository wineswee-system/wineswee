import { useState, useEffect } from 'react'
import { Upload, Download, Search, Trash2 } from 'lucide-react'
import { getDocuments, deleteDocument } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { useAuth } from '../../contexts/AuthContext'

const CATEGORIES = ['報告', '制度規章', '表單', '合約範本', '教育訓練', '其他']

export default function Documents() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'PDF', size: '', uploader: '', category: CATEGORIES[0], url: '', notes: '' })

  useEffect(() => {
    if (!orgId) { setLoading(false); return }
    getDocuments(orgId).then(({ data }) => {
      setDocs(data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }, [orgId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleUpload = async () => {
    if (!form.name) return
    const { data } = await supabase.from('documents').insert({
      name: form.name,
      type: form.type,
      size: form.size,
      uploader: form.uploader || '管理員',
      upload_date: new Date().toISOString().slice(0, 10),
      category: form.category,
      url: form.url || null,
      notes: form.notes || null,
      organization_id: orgId,
    }).select().single()
    if (data) {
      setDocs(prev => [data, ...prev])
      setShowModal(false)
      setForm({ name: '', type: 'PDF', size: '', uploader: '', category: CATEGORIES[0], url: '', notes: '' })
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('確定刪除此文件？')) return
    await deleteDocument(id)
    setDocs(prev => prev.filter(d => d.id !== id))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  const filtered = docs.filter(d =>
    search === '' || d.name?.toLowerCase().includes(search.toLowerCase()) || d.category?.includes(search)
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📁</span> 文件管理</h2>
            <p>公司文件、合約與表單管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Upload size={14} /> 上傳文件</button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📄</span> 文件列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋文件..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>文件名稱</th><th>格式</th><th>大小</th><th>上傳者</th><th>上傳日期</th><th>分類</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無文件</td></tr>}
              {filtered.map(d => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>
                    <span style={{ marginRight: 8 }}>{d.type === 'PDF' ? '📕' : d.type === 'DOCX' ? '📘' : d.type === 'XLSX' ? '📗' : '📄'}</span>
                    {d.name}
                  </td>
                  <td><span className="badge badge-neutral">{d.type}</span></td>
                  <td style={{ color: 'var(--text-muted)' }}>{d.size}</td>
                  <td>{d.uploader}</td>
                  <td>{d.upload_date}</td>
                  <td><span className="badge badge-cyan">{d.category}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-secondary"><Download size={12} /></a>}
                      <button className="btn btn-sm btn-secondary" style={{ color: 'var(--accent-red)' }} onClick={() => handleDelete(d.id)}><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="上傳文件" onClose={() => setShowModal(false)} onSubmit={handleUpload}>
          <Field label="文件名稱 *">
            <input className="form-input" style={{ width: '100%' }} placeholder="例：2026 Q1 技術報告" value={form.name} onChange={e => set('name', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="格式">
              <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
                <option>PDF</option><option>DOCX</option><option>XLSX</option><option>PPTX</option><option>JPG</option><option>PNG</option><option>其他</option>
              </select>
            </Field>
            <Field label="檔案大小">
              <input className="form-input" style={{ width: '100%' }} placeholder="例：5.1 MB" value={form.size} onChange={e => set('size', e.target.value)} />
            </Field>
            <Field label="分類">
              <select className="form-input" style={{ width: '100%' }} value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="上傳者">
              <input className="form-input" style={{ width: '100%' }} placeholder="姓名" value={form.uploader} onChange={e => set('uploader', e.target.value)} />
            </Field>
            <Field label="檔案連結 (URL)">
              <input className="form-input" style={{ width: '100%' }} placeholder="https://..." value={form.url} onChange={e => set('url', e.target.value)} />
            </Field>
          </div>
          <Field label="備註">
            <textarea className="form-input" style={{ width: '100%', minHeight: 60, resize: 'vertical' }} placeholder="文件備註..." value={form.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
