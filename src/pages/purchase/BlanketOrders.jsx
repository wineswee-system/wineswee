import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit3, X, FileText, ChevronDown, ChevronRight } from 'lucide-react'
import { getBlanketOrders, createBlanketOrder, updateBlanketOrder, deleteBlanketOrder, getBlanketOrderReleases, createBlanketOrderRelease, getSuppliers } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`
const STATUSES = ['有效', '已完成', '已取消']

const emptyForm = {
  bo_number: '', supplier_id: '', items: '[]', total_amount: '',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '', payment_terms: 'NET30', status: '有效', notes: '',
}

export default function BlanketOrders() {
  const [orders, setOrders] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [releases, setReleases] = useState([])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const [boRes, supRes] = await Promise.all([getBlanketOrders(), getSuppliers()])
    if (boRes.error) setError(boRes.error.message)
    else setOrders(boRes.data || [])
    setSuppliers(supRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSubmit = async () => {
    if (!form.supplier_id || !form.total_amount) return
    setSaving(true)
    const payload = {
      ...form,
      supplier_id: Number(form.supplier_id),
      total_amount: Number(form.total_amount),
    }
    if (!payload.bo_number) payload.bo_number = `BO-${Date.now().toString(36).toUpperCase()}`
    delete payload.id
    delete payload.suppliers

    if (editingId) {
      const { error } = await updateBlanketOrder(editingId, payload)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      payload.released_amount = 0
      const { error } = await createBlanketOrder(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setSaving(false)
    setShowModal(false)
    setForm(emptyForm)
    setEditingId(null)
    load()
  }

  const handleEdit = (bo) => {
    setForm({
      bo_number: bo.bo_number || '', supplier_id: String(bo.supplier_id || ''),
      items: JSON.stringify(bo.items || []), total_amount: String(bo.total_amount || ''),
      start_date: bo.start_date || '', end_date: bo.end_date || '',
      payment_terms: bo.payment_terms || 'NET30', status: bo.status || '有效', notes: bo.notes || '',
    })
    setEditingId(bo.id)
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('確定要刪除此長期採購協議？')) return
    const { error } = await deleteBlanketOrder(id)
    if (error) setError(error.message)
    else load()
  }

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    const { data } = await getBlanketOrderReleases(id)
    setReleases(data || [])
  }

  const handleRelease = async (boId) => {
    const amount = prompt('請輸入本次釋放金額：')
    if (!amount || isNaN(amount)) return
    const { error } = await createBlanketOrderRelease({
      blanket_order_id: boId,
      amount: Number(amount),
      release_date: new Date().toISOString().slice(0, 10),
    })
    if (error) { setError(error.message); return }
    // Update released_amount on blanket order
    const bo = orders.find(o => o.id === boId)
    if (bo) {
      await updateBlanketOrder(boId, { released_amount: (bo.released_amount || 0) + Number(amount) })
    }
    load()
    const { data } = await getBlanketOrderReleases(boId)
    setReleases(data || [])
  }

  const statusColor = (s) => s === '有效' ? 'var(--accent-green)' : s === '已完成' ? 'var(--accent-blue)' : 'var(--accent-red)'

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 長期採購協議</h2>
            <p>Blanket Purchase Orders — 長期合約與分批釋放</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true) }}>
            <Plus size={14} /> 新增協議
          </button>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">有效協議</div>
          <div className="stat-card-value">{orders.filter(o => o.status === '有效').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">總合約金額</div>
          <div className="stat-card-value">{fmt(orders.reduce((s, o) => s + (o.total_amount || 0), 0))}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">已釋放金額</div>
          <div className="stat-card-value">{fmt(orders.reduce((s, o) => s + (o.released_amount || 0), 0))}</div>
        </div>
      </div>

      {orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }}>尚無長期採購協議</div>
      ) : orders.map(bo => {
        const progress = bo.total_amount > 0 ? Math.round(((bo.released_amount || 0) / bo.total_amount) * 100) : 0
        return (
          <div key={bo.id} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', marginBottom: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', gap: 12 }} onClick={() => toggleExpand(bo.id)}>
              {expandedId === bo.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <FileText size={16} style={{ color: 'var(--accent-blue)' }} />
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 700, fontFamily: 'monospace', marginRight: 12 }}>{bo.bo_number}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{bo.suppliers?.name || '-'}</span>
                <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-secondary)' }}>{bo.start_date} ~ {bo.end_date || '...'}</span>
              </div>
              <div style={{ textAlign: 'right', marginRight: 12 }}>
                <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmt(bo.total_amount)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>已釋放 {progress}%</div>
              </div>
              <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: `color-mix(in srgb, ${statusColor(bo.status)} 15%, transparent)`, color: statusColor(bo.status) }}>{bo.status}</span>
              <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={e => { e.stopPropagation(); handleEdit(bo) }}><Edit3 size={13} /></button>
              <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={e => { e.stopPropagation(); handleDelete(bo.id) }}><Trash2 size={13} /></button>
            </div>

            {/* Progress bar */}
            <div style={{ padding: '0 16px 8px' }}>
              <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(progress, 100)}%`, background: 'var(--accent-green)', borderRadius: 2 }} />
              </div>
            </div>

            {expandedId === bo.id && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>釋放紀錄</span>
                  {bo.status === '有效' && (
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => handleRelease(bo.id)}>
                      <Plus size={12} /> 新增釋放
                    </button>
                  )}
                </div>
                {releases.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-secondary)', fontSize: 13 }}>尚無釋放紀錄</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>日期</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>金額</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>關聯採購單</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>備註</th>
                      </tr>
                    </thead>
                    <tbody>
                      {releases.map(r => (
                        <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 8px' }}>{r.release_date}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.amount)}</td>
                          <td style={{ padding: '6px 8px' }}>{r.purchase_orders?.po_number || '-'}</td>
                          <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{r.notes || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 480, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯協議' : '新增長期採購協議'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>供應商 *</label>
                <select value={form.supplier_id} onChange={e => set('supplier_id', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                  <option value="">請選擇</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>合約金額 *</label>
                  <input type="number" value={form.total_amount} onChange={e => set('total_amount', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>付款條件</label>
                  <input type="text" value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>開始日期</label>
                  <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>結束日期</label>
                  <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              {editingId && (
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>狀態</label>
                  <select value={form.status} onChange={e => set('status', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>備註</label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? '儲存中...' : editingId ? '更新' : '新增'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
