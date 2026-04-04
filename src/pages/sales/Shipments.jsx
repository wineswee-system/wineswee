import { useState, useEffect } from 'react'
import { Plus, Search } from 'lucide-react'
import { getShipments, createShipment } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const CARRIERS = ['黑貓宅急便', '新竹物流', '超商取貨', '順豐速運', '自行配送']

export default function Shipments() {
  const [shipments, setShipments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ shipment_number: '', order_ref: '', carrier: '黑貓宅急便', tracking_number: '', destination: '', recipient: '', estimated_date: '', status: '待出貨' })

  useEffect(() => {
    getShipments().then(({ data }) => { setShipments(data || []) }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.shipment_number || !form.recipient) return
    const { data } = await createShipment(form)
    if (data) {
      setShipments(prev => [...prev, data])
      setShowModal(false)
      setForm({ shipment_number: '', order_ref: '', carrier: '黑貓宅急便', tracking_number: '', destination: '', recipient: '', estimated_date: '', status: '待出貨' })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = shipments.filter(s =>
    search === '' || s.shipment_number?.includes(search) || s.recipient?.includes(search) || s.tracking_number?.includes(search)
  )

  const pending = filtered.filter(s => s.status === '待出貨').length
  const inTransit = filtered.filter(s => s.status === '運送中').length
  const delivered = filtered.filter(s => s.status === '已簽收').length
  const now = new Date()
  const thisMonth = filtered.filter(s => {
    const d = new Date(s.created_at)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }).length

  const statusBadge = (status) => {
    const map = { '待出貨': 'badge-warning', '已攬收': 'badge-info', '運送中': 'badge-cyan', '已簽收': 'badge-success', '異常': 'badge-danger' }
    return map[status] || 'badge-info'
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🚚</span> 物流追蹤</h2>
            <p>出貨與物流狀態管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增出貨</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待出貨</div>
          <div className="stat-card-value">{pending}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">運送中</div>
          <div className="stat-card-value">{inTransit}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已簽收</div>
          <div className="stat-card-value">{delivered}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">本月出貨</div>
          <div className="stat-card-value">{thisMonth}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 出貨列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋出貨單..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>出貨單號</th><th>訂單參考</th><th>物流商</th><th>追蹤號碼</th><th>目的地</th><th>收件人</th><th>預計到貨</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無出貨記錄</td></tr>}
              {filtered.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.shipment_number}</td>
                  <td>{s.order_ref}</td>
                  <td>{s.carrier}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.tracking_number}</td>
                  <td>{s.destination}</td>
                  <td>{s.recipient}</td>
                  <td>{s.estimated_date}</td>
                  <td>
                    <span className={`badge ${statusBadge(s.status)}`}>
                      <span className="badge-dot"></span>{s.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增出貨" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="出貨單號 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="SHP-001" value={form.shipment_number} onChange={e => set('shipment_number', e.target.value)} />
            </Field>
            <Field label="訂單參考">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="SO-001" value={form.order_ref} onChange={e => set('order_ref', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="物流商">
              <select className="form-input" style={{ width: '100%' }} value={form.carrier} onChange={e => set('carrier', e.target.value)}>
                {CARRIERS.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="追蹤號碼">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="追蹤號碼" value={form.tracking_number} onChange={e => set('tracking_number', e.target.value)} />
            </Field>
          </div>
          <Field label="目的地">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="配送地址" value={form.destination} onChange={e => set('destination', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="收件人 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="收件人姓名" value={form.recipient} onChange={e => set('recipient', e.target.value)} />
            </Field>
            <Field label="預計到貨日">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.estimated_date} onChange={e => set('estimated_date', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
