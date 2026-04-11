import { useState, useEffect } from 'react'
import { Search, Package, Plus } from 'lucide-react'
import { getInventoryLots } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function Lots() {
  const [lots, setLots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ lot_number: '', sku_code: '', sku_name: '', quantity: '', warehouse: '', location_code: '', expiry_date: '', notes: '' })

  useEffect(() => {
    getInventoryLots().then(({ data }) => { setLots(data || []) }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗')
    }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.lot_number || !form.sku_code) return
    const { data } = await supabase.from('inventory_lots').insert({
      lot_number: form.lot_number, sku_id: form.sku_code,
      quantity: Number(form.quantity) || 0, warehouse: form.warehouse,
      location_code: form.location_code, expiry_date: form.expiry_date || null,
      received_date: new Date().toISOString().slice(0, 10), status: '正常',
    }).select().single()
    if (data) {
      setLots(prev => [data, ...prev])
      setShowModal(false)
      setForm({ lot_number: '', sku_code: '', sku_name: '', quantity: '', warehouse: '', location_code: '', expiry_date: '', notes: '' })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  const filtered = lots.filter(l =>
    search === '' || l.lot_number?.includes(search) || l.sku_id?.toString().includes(search)
  )

  const today = new Date().toISOString().split('T')[0]
  const thirtyDaysLater = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  const expiringSoon = filtered.filter(l => l.expiry_date && l.expiry_date >= today && l.expiry_date <= thirtyDaysLater).length
  const expired = filtered.filter(l => l.expiry_date && l.expiry_date < today).length
  const isExpired = (date) => date && date < today
  const isExpiringSoon = (date) => date && date >= today && date <= thirtyDaysLater

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📦</span> 批號追蹤</h2>
            <p>庫存批號與效期管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增批號</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總批號數</div>
          <div className="stat-card-value">{filtered.length}</div>
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
          <div className="card-title"><span className="card-title-icon"><Package size={16} /></span> 批號列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋批號..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>批號</th><th>SKU</th><th>數量</th><th>倉庫</th><th>儲位</th><th>效期</th><th>入庫日</th><th>狀態</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無批號資料</td></tr>}
              {filtered.map(l => (
                <tr key={l.id} style={isExpired(l.expiry_date) ? { background: 'rgba(239,68,68,0.08)' } : undefined}>
                  <td style={{ fontWeight: 600 }}>{l.lot_number}</td>
                  <td>{l.sku_id}</td>
                  <td>{(l.quantity || 0).toLocaleString()}</td>
                  <td>{l.warehouse}</td>
                  <td>{l.location_code}</td>
                  <td style={{ color: isExpired(l.expiry_date) ? 'var(--accent-red)' : isExpiringSoon(l.expiry_date) ? 'var(--accent-orange)' : undefined, fontWeight: isExpired(l.expiry_date) ? 600 : undefined }}>
                    {l.expiry_date}
                  </td>
                  <td>{l.received_date}</td>
                  <td>
                    <span className={`badge ${isExpired(l.expiry_date) ? 'badge-danger' : isExpiringSoon(l.expiry_date) ? 'badge-warning' : 'badge-success'}`}>
                      <span className="badge-dot"></span>{isExpired(l.expiry_date) ? '已過期' : isExpiringSoon(l.expiry_date) ? '即將到期' : '正常'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增批號" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="批號 *"><input className="form-input" style={{ width: '100%' }} placeholder="LOT-2026-001" value={form.lot_number} onChange={e => set('lot_number', e.target.value)} /></Field>
            <Field label="SKU 代碼 *"><input className="form-input" style={{ width: '100%' }} placeholder="SKU001" value={form.sku_code} onChange={e => set('sku_code', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="數量"><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.quantity} onChange={e => set('quantity', e.target.value)} /></Field>
            <Field label="倉庫"><input className="form-input" style={{ width: '100%' }} placeholder="台北倉" value={form.warehouse} onChange={e => set('warehouse', e.target.value)} /></Field>
            <Field label="儲位"><input className="form-input" style={{ width: '100%' }} placeholder="A-01-01" value={form.location_code} onChange={e => set('location_code', e.target.value)} /></Field>
          </div>
          <Field label="效期"><input className="form-input" type="date" style={{ width: '100%' }} value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  )
}
