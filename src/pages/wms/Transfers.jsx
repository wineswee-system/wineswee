import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X, ArrowRight, Trash2, Edit3 } from 'lucide-react'
import { getWarehouseTransfers, createWarehouseTransfer, updateWarehouseTransfer, getWarehouses } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

const STATUSES = ['待出庫', '運送中', '已入庫', '已取消']

export default function Transfers() {
  const [transfers, setTransfers] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ from_warehouse_id: '', to_warehouse_id: '', requested_by: '', notes: '', items: [{ sku_name: '', quantity: 1, unit: '個' }] })
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
    const itemsSummary = form.items.filter(i => i.sku_name).map(i => `${i.sku_name} x${i.quantity} ${i.unit}`).join('、')
    const fullNotes = [itemsSummary, form.notes].filter(Boolean).join('\n')
    const { error } = await createWarehouseTransfer({
      transfer_number: `TF-${Date.now().toString(36).toUpperCase()}`,
      from_warehouse_id: Number(form.from_warehouse_id),
      to_warehouse_id: Number(form.to_warehouse_id),
      requested_by: form.requested_by || null,
      notes: fullNotes || null,
      status: '待出庫',
    })
    if (error) { setError(error.message); return }
    setShowModal(false); setForm({ from_warehouse_id: '', to_warehouse_id: '', requested_by: '', notes: '', items: [{ sku_name: '', quantity: 1, unit: '個' }] }); load()
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
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100vw', height: '100vh' }} onClick={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--border-medium)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>新增調撥單</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>來源倉庫 *</label>
                  <select value={form.from_warehouse_id} onChange={e => setForm(f => ({ ...f, from_warehouse_id: e.target.value }))} className="form-input" style={{ width: '100%' }}>
                    <option value="">請選擇</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>目的倉庫 *</label>
                  <select value={form.to_warehouse_id} onChange={e => setForm(f => ({ ...f, to_warehouse_id: e.target.value }))} className="form-input" style={{ width: '100%' }}>
                    <option value="">請選擇</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>申請人</label>
                <input type="text" placeholder="申請人姓名" value={form.requested_by} onChange={e => setForm(f => ({ ...f, requested_by: e.target.value }))} className="form-input" style={{ width: '100%' }} />
              </div>

              {/* Transfer items */}
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>調撥品項</label>
                {form.items.map((item, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
                    <input className="form-input" placeholder="品名/SKU" value={item.sku_name}
                      onChange={e => setForm(f => ({ ...f, items: f.items.map((it, j) => j === i ? { ...it, sku_name: e.target.value } : it) }))} />
                    <input className="form-input" type="number" placeholder="數量" min="1" value={item.quantity}
                      onChange={e => setForm(f => ({ ...f, items: f.items.map((it, j) => j === i ? { ...it, quantity: Number(e.target.value) } : it) }))} />
                    <input className="form-input" placeholder="單位" value={item.unit}
                      onChange={e => setForm(f => ({ ...f, items: f.items.map((it, j) => j === i ? { ...it, unit: e.target.value } : it) }))} />
                    <button onClick={() => setForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }))}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
                      <X size={16} />
                    </button>
                  </div>
                ))}
                <button onClick={() => setForm(f => ({ ...f, items: [...f.items, { sku_name: '', quantity: 1, unit: '個' }] }))}
                  style={{ width: '100%', padding: 6, borderRadius: 6, border: '1px dashed var(--border-medium)', background: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>
                  + 新增品項
                </button>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>備註</label>
                <textarea placeholder="備註" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="form-input" style={{ width: '100%', resize: 'vertical' }} />
              </div>
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
