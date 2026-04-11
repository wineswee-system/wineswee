import { useState, useEffect, useRef } from 'react'
import { Plus, ChevronDown, ChevronRight, ScanBarcode } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { addCostLayer } from '../../lib/inventoryCosting'
import { playBeep } from '../../lib/barcodeScanner'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import BarcodeInput from '../../components/BarcodeInput'

const STATUSES = ['待到貨', '收貨中', '已完成', '異常']

export default function Inbound() {
  const [orders, setOrders] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [whFilter, setWhFilter] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [items, setItems] = useState({})
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ po_number: '', supplier: '', warehouse_id: '', expected_date: '', status: '待到貨' })
  const [scanCount, setScanCount] = useState(0)
  const [lastScannedSku, setLastScannedSku] = useState(null)
  const [highlightItem, setHighlightItem] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('inbound_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('warehouses').select('*'),
    ]).then(([o, w]) => {
      setOrders(o.data || [])
      setWarehouses(w.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const toggleExpand = async (id) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!items[id]) {
      const { data } = await supabase.from('inbound_items').select('*').eq('inbound_order_id', id)
      setItems(prev => ({ ...prev, [id]: data || [] }))
    }
  }

  const handleSubmit = async () => {
    if (!form.po_number || !form.supplier) return
    const { data } = await supabase.from('inbound_orders').insert({ ...form, warehouse_id: form.warehouse_id || null }).select().single()
    if (data) { setOrders(prev => [data, ...prev]); setShowModal(false); setForm({ po_number: '', supplier: '', warehouse_id: '', expected_date: '', status: '待到貨' }) }
  }

  const updateStatus = async (id, status) => {
    const { data } = await supabase.from('inbound_orders').update({ status }).eq('id', id).select().single()
    if (data) setOrders(prev => prev.map(o => o.id === id ? data : o))
  }

  const updateItemQty = async (orderId, itemId, qty) => {
    const { data } = await supabase.from('inbound_items').update({ received_qty: qty, status: '已收貨' }).eq('id', itemId).select().single()
    if (data) {
      setItems(prev => ({ ...prev, [orderId]: prev[orderId].map(i => i.id === itemId ? data : i) }))

      // 建立成本層：收貨時記錄進貨成本
      const order = orders.find(o => o.id === orderId)
      const warehouseId = order?.warehouse_id
      const skuId = data.sku_id
      const unitCost = data.unit_cost || data.unit_price || 0

      if (skuId && warehouseId && qty > 0 && unitCost > 0) {
        try {
          await addCostLayer(skuId, warehouseId, qty, unitCost, 'purchase', orderId, data.lot_number || null)
        } catch (err) {
          console.error('建立成本層失敗:', err)
        }
      }
    }
  }

  // 條碼掃描收貨處理
  const handleBarcodeScan = async (code, lookupResult) => {
    if (!expanded) return // 需先展開某張進貨單
    const orderItems = items[expanded] || []
    // 在展開的進貨單中尋找匹配的品項
    const matched = orderItems.find(i =>
      i.sku_code?.toLowerCase() === code.toLowerCase()
    )
    if (matched) {
      const newQty = (matched.received_qty || 0) + 1
      await updateItemQty(expanded, matched.id, newQty)
      setScanCount(prev => prev + 1)
      setLastScannedSku(matched.sku_code)
      setHighlightItem(matched.id)
      playBeep(true)
      setTimeout(() => setHighlightItem(null), 1500)
    } else {
      setLastScannedSku(null)
      playBeep(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div><h2><span className="header-icon">📦</span> 進貨管理</h2><p>採購單收貨與上架管理</p></div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增進貨單</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {[['待到貨', 'badge-warning', 'var(--accent-orange)', 'var(--accent-orange-dim)'],
          ['收貨中', 'badge-info', 'var(--accent-blue)', 'var(--accent-blue-dim)'],
          ['已完成', 'badge-success', 'var(--accent-green)', 'var(--accent-green-dim)'],
          ['異常', 'badge-danger', 'var(--accent-red)', 'var(--accent-red-dim)']
        ].map(([s, , accent, dim]) => (
          <div key={s} className="stat-card" style={{ '--card-accent': accent, '--card-accent-dim': dim }}>
            <div className="stat-card-label">{s}</div>
            <div className="stat-card-value">{orders.filter(o => o.status === s).length}</div>
          </div>
        ))}
      </div>

      {/* 條碼掃描收貨 */}
      <BarcodeInput
        onScan={handleBarcodeScan}
        placeholder="掃描條碼收貨（請先展開進貨單）..."
        autoLookup={false}
      />
      {scanCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '8px 16px', background: 'var(--accent-green-dim)', borderRadius: 8, fontSize: 13 }}>
          <ScanBarcode size={14} style={{ color: 'var(--accent-green)' }} />
          <span>已掃描 <strong>{scanCount}</strong> 次</span>
          {lastScannedSku && <span style={{ color: 'var(--accent-green)' }}>最近: {lastScannedSku}</span>}
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px', marginLeft: 'auto' }} onClick={() => { setScanCount(0); setLastScannedSku(null) }}>重置</button>
        </div>
      )}

      {/* 倉庫篩選 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setWhFilter('')} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-medium)', background: whFilter === '' ? 'var(--accent-cyan)' : 'var(--bg-card)', color: whFilter === '' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
          全部
        </button>
        {warehouses.map(w => (
          <button key={w.id} onClick={() => setWhFilter(String(w.id))} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-medium)', background: whFilter === String(w.id) ? 'var(--accent-cyan)' : 'var(--bg-card)', color: whFilter === String(w.id) ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
            {w.name}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {orders.filter(o => whFilter === '' || String(o.warehouse_id) === whFilter).map(o => (
          <div key={o.id} className="card">
            <div className="card-body" style={{ cursor: 'pointer' }} onClick={() => toggleExpand(o.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {expanded === o.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <div>
                    <div style={{ fontWeight: 700 }}>{o.po_number}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{o.supplier} · 預計到貨：{o.expected_date || '-'}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <select
                    className="form-input"
                    style={{ padding: '2px 8px', fontSize: 12 }}
                    value={o.status}
                    onClick={e => e.stopPropagation()}
                    onChange={e => updateStatus(o.id, e.target.value)}
                  >
                    {STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>
            {expanded === o.id && (
              <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 16px' }}>
                {(items[o.id] || []).length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '8px 0' }}>尚無明細</div>
                ) : (
                  <table className="data-table">
                    <thead><tr><th>品號</th><th>品名</th><th>預計數量</th><th>實收數量</th><th>指定儲位</th><th>狀態</th></tr></thead>
                    <tbody>
                      {items[o.id].map(item => (
                        <tr key={item.id} style={highlightItem === item.id ? { background: 'rgba(34,197,94,0.15)', transition: 'background 0.3s' } : {}}>
                          <td style={{ fontFamily: 'monospace' }}>{item.sku_code}</td>
                          <td>{item.sku_name}</td>
                          <td>{item.expected_qty}</td>
                          <td>
                            <input
                              className="form-input"
                              type="number"
                              style={{ width: 80, padding: '2px 6px', fontSize: 12 }}
                              defaultValue={item.received_qty}
                              onBlur={e => updateItemQty(o.id, item.id, Number(e.target.value))}
                            />
                          </td>
                          <td style={{ fontSize: 12 }}>{item.bin_code || '-'}</td>
                          <td><span className={`badge ${item.status === '已收貨' ? 'badge-success' : 'badge-warning'}`}><span className="badge-dot"></span>{item.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <Modal title="新增進貨單" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="採購單號 *"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="PO-2026-001" value={form.po_number} onChange={e => set('po_number', e.target.value)} /></Field>
            <Field label="供應商 *"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="供應商名稱" value={form.supplier} onChange={e => set('supplier', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="倉庫">
              <select className="form-input" style={{ width: '100%' }} value={form.warehouse_id} onChange={e => set('warehouse_id', e.target.value)}>
                <option value="">請選擇倉庫</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="預計到貨日"><input className="form-input" type="date" style={{ width: '100%' }} value={form.expected_date} onChange={e => set('expected_date', e.target.value)} /></Field>
          </div>
          <Field label="備註">
            <textarea className="form-input" style={{ width: '100%', minHeight: 60, resize: 'vertical' }} placeholder="進貨備註說明..."
              value={form.notes || ''} onChange={e => set('notes', e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
