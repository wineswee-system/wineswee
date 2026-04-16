import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Edit3, X, Truck, Package } from 'lucide-react'
import { getSubcontracts, createSubcontract, updateSubcontract, deleteSubcontract, getSuppliers, getManufacturingOrders } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`
const STATUSES = ['已發出', '加工中', '已收回', '已結案']

const emptyForm = {
  sc_number: '', supplier_id: '', mo_id: '', operation_name: '',
  cost: '', issue_date: new Date().toISOString().slice(0, 10),
  expected_return_date: '', status: '已發出', notes: '',
}

export default function Subcontracting() {
  const [contracts, setContracts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const [scRes, supRes, moRes] = await Promise.all([
      getSubcontracts(), getSuppliers(), getManufacturingOrders(),
    ])
    if (scRes.error) setError(scRes.error.message)
    else setContracts(scRes.data || [])
    setSuppliers(supRes.data || [])
    setOrders(moRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSubmit = async () => {
    if (!form.supplier_id || !form.operation_name) return
    setSaving(true)
    const payload = {
      ...form,
      supplier_id: Number(form.supplier_id) || null,
      mo_id: form.mo_id ? Number(form.mo_id) : null,
      cost: Number(form.cost) || 0,
    }
    if (!payload.sc_number) payload.sc_number = `SC-${Date.now().toString(36).toUpperCase()}`
    delete payload.id
    delete payload.suppliers

    if (editingId) {
      const { error } = await updateSubcontract(editingId, payload)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      const { error } = await createSubcontract(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setSaving(false)
    setShowModal(false)
    setForm(emptyForm)
    setEditingId(null)
    load()
  }

  const handleEdit = (sc) => {
    setForm({
      sc_number: sc.sc_number || '', supplier_id: String(sc.supplier_id || ''),
      mo_id: String(sc.mo_id || ''), operation_name: sc.operation_name || '',
      cost: String(sc.cost || ''), issue_date: sc.issue_date || '',
      expected_return_date: sc.expected_return_date || '', status: sc.status || '已發出',
      notes: sc.notes || '',
    })
    setEditingId(sc.id)
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('確定刪除？')) return
    await deleteSubcontract(id)
    load()
  }

  const handleReceive = async (sc) => {
    await updateSubcontract(sc.id, { status: '已收回', actual_return_date: new Date().toISOString().slice(0, 10) })
    load()
  }

  const statusColor = (s) => {
    switch (s) { case '已發出': return '#fbbf24'; case '加工中': return '#3b82f6'; case '已收回': return '#34d399'; case '已結案': return '#94a3b8'; default: return '#94a3b8' }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔧</span> 託外加工</h2>
            <p>Subcontracting — 外包工序管理、材料發放與收回</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditingId(null); setShowModal(true) }}>
            <Plus size={14} /> 新增託外單
          </button>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        {STATUSES.map(s => (
          <div key={s} className="stat-card" style={{ '--card-accent': statusColor(s), '--card-accent-dim': `color-mix(in srgb, ${statusColor(s)} 15%, transparent)` }}>
            <div className="stat-card-label">{s}</div>
            <div className="stat-card-value">{contracts.filter(c => c.status === s).length}</div>
          </div>
        ))}
      </div>

      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>託外單號</th>
              <th>供應商</th>
              <th>製令</th>
              <th>工序</th>
              <th style={{ textAlign: 'right' }}>費用</th>
              <th>發出日</th>
              <th>預計回廠</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無託外加工紀錄</td></tr>
            ) : contracts.map(sc => (
              <tr key={sc.id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{sc.sc_number}</td>
                <td>{sc.suppliers?.name || '-'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{orders.find(o => o.id === sc.mo_id)?.mo_number || '-'}</td>
                <td>{sc.operation_name}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(sc.cost)}</td>
                <td>{sc.issue_date}</td>
                <td>{sc.expected_return_date || '-'}</td>
                <td>
                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: `color-mix(in srgb, ${statusColor(sc.status)} 15%, transparent)`, color: statusColor(sc.status) }}>{sc.status}</span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(sc.status === '已發出' || sc.status === '加工中') && (
                      <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => handleReceive(sc)}>收回</button>
                    )}
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => handleEdit(sc)}><Edit3 size={13} /></button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(sc.id)}><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 480, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editingId ? '編輯託外單' : '新增託外加工'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>加工廠商 *</label>
                <select value={form.supplier_id} onChange={e => set('supplier_id', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                  <option value="">請選擇</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>關聯製令</label>
                  <select value={form.mo_id} onChange={e => set('mo_id', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    <option value="">選填</option>
                    {orders.map(o => <option key={o.id} value={o.id}>{o.mo_number} - {o.product_name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>工序名稱 *</label>
                  <input type="text" value={form.operation_name} onChange={e => set('operation_name', e.target.value)} placeholder="例：電鍍處理" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>費用</label>
                  <input type="number" value={form.cost} onChange={e => set('cost', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>發出日期</label>
                  <input type="date" value={form.issue_date} onChange={e => set('issue_date', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>預計回廠</label>
                  <input type="date" value={form.expected_return_date} onChange={e => set('expected_return_date', e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
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
        </ModalOverlay>
      )}
    </div>
  )
}
