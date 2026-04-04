import { useState, useEffect } from 'react'
import { Plus, Search, FileText } from 'lucide-react'
import { getSupplierContracts, createSupplierContract } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function Contracts() {
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ contract_number: '', supplier_id: '', start_date: '', end_date: '', discount_rate: '', min_order: '', status: '有效' })

  useEffect(() => {
    getSupplierContracts().then(({ data }) => { setContracts(data || []) }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.contract_number || !form.supplier_id) return
    try {
      const { data, error } = await createSupplierContract({
        ...form,
        discount_rate: parseFloat(form.discount_rate) || 0,
        min_order: parseInt(form.min_order) || 0,
      })
      if (error) throw error
      if (data) {
        setContracts(prev => [...prev, data])
        setShowModal(false)
        setForm({ contract_number: '', supplier_id: '', start_date: '', end_date: '', discount_rate: '', min_order: '', status: '有效' })
      }
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = contracts.filter(c =>
    search === '' || c.contract_number?.includes(search) || c.supplier_id?.toString().includes(search)
  )

  const today = new Date().toISOString().split('T')[0]
  const thirtyDaysLater = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  const active = filtered.filter(c => c.status === '有效').length
  const expiringSoon = filtered.filter(c => c.end_date && c.end_date >= today && c.end_date <= thirtyDaysLater).length
  const expired = filtered.filter(c => c.status === '已過期' || (c.end_date && c.end_date < today)).length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 合約管理</h2>
            <p>供應商合約與條件管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增合約</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">有效</div>
          <div className="stat-card-value">{active}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">即將到期</div>
          <div className="stat-card-value">{expiringSoon}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">已過期</div>
          <div className="stat-card-value">{expired}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><FileText size={16} /></span> 合約列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋合約..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>合約編號</th><th>供應商ID</th><th>開始日期</th><th>結束日期</th><th>折扣率</th><th>最低訂購量</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無合約</td></tr>}
              {filtered.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.contract_number}</td>
                  <td>{c.supplier_id}</td>
                  <td>{c.start_date}</td>
                  <td>{c.end_date}</td>
                  <td>{c.discount_rate != null ? `${c.discount_rate}%` : '-'}</td>
                  <td>{c.min_order != null ? c.min_order.toLocaleString() : '-'}</td>
                  <td>
                    <span className={`badge ${c.status === '有效' ? 'badge-success' : c.status === '即將到期' ? 'badge-warning' : 'badge-danger'}`}>
                      <span className="badge-dot"></span>{c.end_date && c.end_date < today ? '已過期' : c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增合約" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="合約編號 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="CTR-001" value={form.contract_number} onChange={e => set('contract_number', e.target.value)} />
            </Field>
            <Field label="供應商ID *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="供應商ID" value={form.supplier_id} onChange={e => set('supplier_id', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="開始日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </Field>
            <Field label="結束日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="折扣率 (%)">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="5" value={form.discount_rate} onChange={e => set('discount_rate', e.target.value)} />
            </Field>
            <Field label="最低訂購量">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="100" value={form.min_order} onChange={e => set('min_order', e.target.value)} />
            </Field>
          </div>
          <Field label="狀態">
            <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
              <option>有效</option>
              <option>即將到期</option>
              <option>已過期</option>
            </select>
          </Field>
        </Modal>
      )}
    </div>
  )
}
