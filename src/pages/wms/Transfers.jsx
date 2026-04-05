import { useState, useEffect } from 'react'
import { Plus, X, ArrowRight, Trash2, Edit3 } from 'lucide-react'
import { getWarehouseTransfers, createWarehouseTransfer, updateWarehouseTransfer, getWarehouses } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

const STATUSES = ['待出庫', '運送中', '已入庫', '已取消']

export default function Transfers() {
  const [transfers, setTransfers] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ from_warehouse_id: '', to_warehouse_id: '', requested_by: '', notes: '' })
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true)
    const [tRes, wRes] = await Promise.all([getWarehouseTransfers(), getWarehouses()])
    setTransfers(tRes.data || [])
    setWarehouses(wRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!form.from_warehouse_id || !form.to_warehouse_id) return
    if (form.from_warehouse_id === form.to_warehouse_id) { setError('來源與目的倉庫不能相同'); return }
    const { error } = await createWarehouseTransfer({
      transfer_number: `TF-${Date.now().toString(36).toUpperCase()}`,
      from_warehouse_id: Number(form.from_warehouse_id),
      to_warehouse_id: Number(form.to_warehouse_id),
      requested_by: form.requested_by || null,
      notes: form.notes || null,
      status: '待出庫',
    })
    if (error) { setError(error.message); return }
    setShowModal(false); setForm({ from_warehouse_id: '', to_warehouse_id: '', requested_by: '', notes: '' }); load()
  }

  const advanceStatus = async (t) => {
    const nextMap = { '待出庫': '運送中', '運送中': '已入庫' }
    const next = nextMap[t.status]
    if (!next) return
    const update = { status: next }
    if (next === '運送中') update.shipped_date = new Date().toISOString().slice(0, 10)
    if (next === '已入庫') update.received_date = new Date().toISOString().slice(0, 10)
    await updateWarehouseTransfer(t.id, update)
    load()
  }

  const cancel = async (t) => {
    if (!confirm('確定取消此調撥？')) return
    await updateWarehouseTransfer(t.id, { status: '已取消' })
    load()
  }

  const whName = (id) => warehouses.find(w => w.id === id)?.name || '-'
  const statusColor = (s) => { switch (s) { case '待出庫': return '#fbbf24'; case '運送中': return '#3b82f6'; case '已入���': return '#34d399'; case '已取消': return '#f87171'; default: return '#94a3b8' } }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔄</span> 倉庫調撥</h2>
            <p>Warehouse Transfers — 倉間調撥作業</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增調撥</button>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>調撥單號</th>
              <th>來源倉庫</th>
              <th></th>
              <th>目的倉庫</th>
              <th>申請人</th>
              <th>申請日</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {transfers.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無調撥紀錄</td></tr>
            ) : transfers.map(t => (
              <tr key={t.id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{t.transfer_number}</td>
                <td>{whName(t.from_warehouse_id)}</td>
                <td><ArrowRight size={14} style={{ color: 'var(--text-secondary)' }} /></td>
                <td>{whName(t.to_warehouse_id)}</td>
                <td>{t.requested_by || '-'}</td>
                <td>{t.requested_date}</td>
                <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: `color-mix(in srgb, ${statusColor(t.status)} 15%, transparent)`, color: statusColor(t.status) }}>{t.status}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(t.status === '待出庫' || t.status === '運送中') && (
                      <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => advanceStatus(t)}>
                        {t.status === '待出庫' ? '出庫' : '入庫'}
                      </button>
                    )}
                    {t.status === '待出庫' && (
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => cancel(t)}><X size={13} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 400, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>新增調撥單</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>來源倉庫 *</label>
                <select value={form.from_warehouse_id} onChange={e => setForm(f => ({ ...f, from_warehouse_id: e.target.value }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                  <option value="">請選擇</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>目的倉庫 *</label>
                <select value={form.to_warehouse_id} onChange={e => setForm(f => ({ ...f, to_warehouse_id: e.target.value }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                  <option value="">請選擇</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                </select>
              </div>
              <input type="text" placeholder="申請人" value={form.requested_by} onChange={e => setForm(f => ({ ...f, requested_by: e.target.value }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              <textarea placeholder="備註" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreate}>建立</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
