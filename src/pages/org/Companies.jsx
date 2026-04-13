import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { getCompanies, createCompany, getStores, getEmployees } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function Companies() {
  const [companies, setCompanies] = useState([])
  const [stores, setStores] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', short_name: '', tax_id: '', phone: '', status: '營運中' })

  useEffect(() => {
    Promise.all([getCompanies(), getStores(), getEmployees()]).then(([c, s, e]) => {
      setCompanies(c.data || [])
      setStores(s.data || [])
      setEmployees(e.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.name) return
    try {
      const { data, error } = await createCompany(form)
      if (error) throw error
      if (data) {
        setCompanies(prev => [...prev, data])
        setShowModal(false)
        setForm({ name: '', short_name: '', tax_id: '', phone: '', status: '營運中' })
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
            <h2><span className="header-icon">🏢</span> 公司</h2>
            <p>集團旗下公司管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增公司</button>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>公司名稱</th><th>簡稱</th><th>統一編號</th><th>電話</th><th>門市數</th><th>員工數</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {companies.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td><span className="badge badge-cyan">{c.short_name}</span></td>
                  <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{c.tax_id}</td>
                  <td>{c.phone}</td>
                  <td>{stores.filter(s => s.company === c.name).length}</td>
                  <td>{(() => { const companyStores = stores.filter(s => s.company === c.name).map(s => s.name); return employees.filter(e => companyStores.includes(e.store) && e.status === '在職').length })()}</td>
                  <td>
                    <span className={`badge ${c.status === '營運中' ? 'badge-success' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增公司" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="公司名稱 *">
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
