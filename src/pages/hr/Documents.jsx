import { useState, useEffect } from 'react'
import { Upload, Download, Search, Trash2 } from 'lucide-react'
import { getDocuments, deleteDocument } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

export default function Documents() {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getDocuments().then(({ data }) => {
      setDocs(data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const handleDelete = async (id) => {
    await deleteDocument(id)
    setDocs(prev => prev.filter(d => d.id !== id))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📁</span> 文件管理</h2>
            <p>公司文件、合約與表單管理</p>
          </div>
          <button className="btn btn-primary"><Upload size={14} /> 上傳文件</button>
        </div>
      </div>
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📄</span> 文件列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋文件..." className="form-input" style={{ paddingLeft: 38 }} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>文件名稱</th><th>格式</th><th>大小</th><th>上傳者</th><th>上傳日期</th><th>分類</th><th>操作</th></tr></thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id}>
                  <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16 }}>{d.type === 'PDF' ? '📕' : d.type === 'DOCX' ? '📘' : '📗'}</span>
                    {d.name}
                  </td>
                  <td><span className="badge badge-neutral">{d.type}</span></td>
                  <td>{d.size}</td>
                  <td>{d.uploader}</td>
                  <td>{d.upload_date}</td>
                  <td><span className="badge badge-cyan">{d.category}</span></td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm btn-secondary"><Download size={12} /></button>
                    <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(d.id)}><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
