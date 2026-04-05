import { useState, useEffect } from 'react'
import { Plus, Search, Factory } from 'lucide-react'
import { getManufacturingOrders, createManufacturingOrder, updateManufacturingOrder } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const STATUS_BADGE = {
  '待生產': 'badge-warning',
  '生產中': 'badge-info',
  '已完工': 'badge-success',
  '已取消': 'badge-danger',
}

const PRIORITY_BADGE = {
  '高': 'badge-danger',
  '中': 'badge-warning',
  '低': 'badge-info',
}

export default function ManufacturingOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ mo_number: '', product_name: '', quantity: '', completed_qty: '0', defect_qty: '0', start_date: '', due_date: '', priority: '中', status: '待生產', assigned_to: '' })

  useEffect(() => {
    getManufacturingOrders().then(({ data }) => { setOrders(data || []) }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.mo_number || !form.product_name) return
    const { data } = await createManufacturingOrder({
      ...form,
      quantity: parseInt(form.quantity) || 0,
      completed_qty: parseInt(form.completed_qty) || 0,
      defect_qty: parseInt(form.defect_qty) || 0,
    })
    if (data) {
      setOrders(prev => [...prev, data])
      setShowModal(false)
      setForm({ mo_number: '', product_name: '', quantity: '', completed_qty: '0', defect_qty: '0', start_date: '', due_date: '', priority: '中', status: '待生產', assigned_to: '' })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = orders.filter(o =>
    search === '' || o.mo_number?.includes(search) || o.product_name?.includes(search)
  )

  const pending = filtered.filter(o => o.status === '待生產').length
  const inProgress = filtered.filter(o => o.status === '生產中').length
  const completed = filtered.filter(o => o.status === '已完工').length
  const totalQty = filtered.reduce((sum, o) => sum + (o.completed_qty || 0), 0)
  const totalDefect = filtered.reduce((sum, o) => sum + (o.defect_qty || 0), 0)
  const defectRate = totalQty > 0 ? ((totalDefect / totalQty) * 100).toFixed(1) : '0.0'

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">�icing</span> 製令管理</h2>
            <p>生產工單追蹤與管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增製令</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待生產</div>
          <div className="stat-card-value">{pending}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">生產中</div>
          <div className="stat-card-value">{inProgress}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已完工</div>
          <div className="stat-card-value">{completed}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">不良率</div>
          <div className="stat-card-value">{defectRate}%</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Factory size={16} /></span> 製令列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋製令..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>製令編號</th><th>產品名稱</th><th>數量</th><th>已完成</th><th>不良數</th><th>開始日期</th><th>交期</th><th>優先級</th><th>狀態</th><th>負責人</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無製令</td></tr>}
              {filtered.map(o => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>{o.mo_number}</td>
                  <td>{o.product_name}</td>
                  <td>{(o.quantity || 0).toLocaleString()}</td>
                  <td>{(o.completed_qty || 0).toLocaleString()}</td>
                  <td style={{ color: o.defect_qty > 0 ? 'var(--accent-red)' : undefined }}>{o.defect_qty || 0}</td>
                  <td>{o.start_date}</td>
                  <td>{o.due_date}</td>
                  <td>
                    <span className={`badge ${PRIORITY_BADGE[o.priority] || 'badge-info'}`}>
                      <span className="badge-dot"></span>{o.priority}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[o.status] || 'badge-info'}`}>
                      <span className="badge-dot"></span>{o.status}
                    </span>
                  </td>
                  <td>{o.assigned_to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增製令" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="製令編號 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="MO-001" value={form.mo_number} onChange={e => set('mo_number', e.target.value)} />
            </Field>
            <Field label="產品名稱 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="產品A" value={form.product_name} onChange={e => set('product_name', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="數量">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="100" value={form.quantity} onChange={e => set('quantity', e.target.value)} />
            </Field>
            <Field label="已完成">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.completed_qty} onChange={e => set('completed_qty', e.target.value)} />
            </Field>
            <Field label="不良數">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.defect_qty} onChange={e => set('defect_qty', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="開始日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </Field>
            <Field label="交期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.due_date} onChange={e => set('due_date', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="優先級">
              <select className="form-input" style={{ width: '100%' }} value={form.priority} onChange={e => set('priority', e.target.value)}>
                <option>高</option>
                <option>中</option>
                <option>低</option>
              </select>
            </Field>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                <option>待生產</option>
                <option>生產中</option>
                <option>已完工</option>
                <option>已取消</option>
              </select>
            </Field>
            <Field label="負責人">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="王大明" value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
