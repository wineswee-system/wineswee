import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { getDepartments, createDepartment } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function Departments() {
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', head: '', description: '' })

  useEffect(() => {
    getDepartments().then(({ data }) => { setDepartments(data || []) }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.name) return
    try {
      const { data, error } = await createDepartment({ ...form, member_count: 0 })
      if (error) throw error
      if (data) {
        setDepartments(prev => [...prev, data])
        setShowModal(false)
        setForm({ name: '', head: '', description: '' })
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🗂️</span> 部門</h2>
            <p>公司部門設定與管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增部門</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">部門數</div>
          <div className="stat-card-value">{departments.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">總人數</div>
          <div className="stat-card-value">{departments.reduce((s, d) => s + (d.member_count || 0), 0)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">平均人數</div>
          <div className="stat-card-value">
            {departments.length ? Math.round(departments.reduce((s, d) => s + (d.member_count || 0), 0) / departments.length) : 0}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>部門名稱</th><th>部門主管</th><th>人數</th><th>描述</th></tr>
            </thead>
            <tbody>
              {departments.map(d => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>{d.name}</td>
                  <td>{d.head}</td>
                  <td>{d.member_count ?? 0}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{d.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增部門" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部門名稱 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：研發部" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="部門主管">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="主管姓名" value={form.head} onChange={e => set('head', e.target.value)} />
            </Field>
          </div>
          <Field label="部門描述">
            <textarea className="form-input" style={{ width: '100%', height: 80, resize: 'vertical' }} placeholder="部門職責說明" value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
