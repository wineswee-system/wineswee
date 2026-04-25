import { useState, useEffect } from 'react'
import { Plus, ChevronDown, ChevronRight, AlertTriangle, ScanBarcode, CheckCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getEventBus } from '../../lib/events/index.js'
import { playBeep } from '../../lib/barcodeScanner'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import BarcodeInput from '../../components/BarcodeInput'

const STATUSES = ['待揀貨', '揀貨中', '已複核', '已出貨']
const CARRIERS = ['黑貓', '新竹', '郵局', '順豐', '7-11', '全家', '自取', '其他']

export default function Outbound() {
  const { profile } = useAuth()
  const [orders, setOrders] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [items, setItems] = useState({})
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ order_number: '', customer: '', carrier: CARRIERS[0], warehouse_id: '', due_date: '', status: '待揀貨', items: [{ sku_name: '', quantity: 1, unit: '個' }], notes: '' })
  const [highlightItem, setHighlightItem] = useState(null)

  useEffect(() => {
    const orgId = profile?.organization_id
    if (!orgId) { setLoading(false); return }
    Promise.all([
      supabase.from('outbound_orders').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
      supabase.from('warehouses').select('*').eq('organization_id', orgId),
      supabase.from('customers').select('id, name, credit_limit, outstanding_amount').eq('organization_id', orgId),
    ]).then(([o, w, c]) => {
      setOrders(o.data || [])
      setWarehouses(w.data || [])
      setCustomers(c.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [profile?.organization_id])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const toggleExpand = async (id) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!items[id]) {
      const { data } = await supabase.from('outbound_items').select('*').eq('outbound_order_id', id)
      setItems(prev => ({ ...prev, [id]: data || [] }))
    }
  }

  const handleSubmit = async () => {
    if (!form.order_number || !form.customer) return
    if (!profile?.organization_id) { alert('身份未載入，請重新登入'); return }
    const { data } = await supabase.from('outbound_orders').insert({
      ...form,
      warehouse_id: form.warehouse_id || null,
      organization_id: profile.organization_id,
    }).select().single()
    if (data) { setOrders(prev => [data, ...prev]); setShowModal(false); setForm({ order_number: '', customer: '', carrier: CARRIERS[0], warehouse_id: '', due_date: '', status: '待揀貨', items: [{ sku_name: '', quantity: 1, unit: '個' }], notes: '' }) }
  }

  const updateStatus = async (id, status) => {
    const { data } = await supabase.from('outbound_orders').update({ status }).eq('id', id).select().single()
    if (data) setOrders(prev => prev.map(o => o.id === id ? data : o))
  }

  const updateTracking = async (id, tracking_number) => {
    // ★ 用 commit_outbound_shipment RPC 原子完成「扣 stock_levels + 寫 audit + 更新狀態」
    //   之前只 update outbound_orders 不扣庫存 → 帳面消失
    const order = orders.find(o => o.id === id)
    const warehouseName = warehouses.find(w => w.id === order?.warehouse_id)?.name || order?.warehouse || null

    const { data: shipResult, error: shipErr } = await supabase.rpc('commit_outbound_shipment', {
      p_outbound_id: id,
      p_warehouse: warehouseName,
      p_actor: profile?.name || '系統',
    })
    if (shipErr || !shipResult?.ok) {
      alert('出貨失敗：' + (shipResult?.error || shipErr?.message || '未知'))
      return
    }
    // 更新 tracking + 重抓 order
    const { data } = await supabase.from('outbound_orders').update({ tracking_number }).eq('id', id).select().single()
    if (data) {
      setOrders(prev => prev.map(o => o.id === id ? data : o))
      // 應收帳款事件
      if (data.total_amount > 0) {
        getEventBus().publish('wms.shipment.completed', {
          shipment_id: data.id,
          customer: data.customer,
          order_ref: `OUT-${data.id}`,
          total_amount: data.total_amount,
          carrier: data.carrier,
          tracking_number,
        }, { source: 'Outbound.jsx' })
      }
    }
  }

  // CRM 信用管控：查詢客戶欠款狀態
  const getCreditWarning = (customerName) => {
    const c = customers.find(c => c.name === customerName)
    if (!c || !c.credit_limit || c.credit_limit === 0) return null
    const outstanding = c.outstanding_amount || 0
    const ratio = outstanding / c.credit_limit
    if (ratio >= 1) return { level: 'danger', msg: `⛔ 欠款 $${outstanding.toLocaleString()} 已超過信用額度 $${c.credit_limit.toLocaleString()}，建議暫停出貨` }
    if (ratio >= 0.8) return { level: 'warning', msg: `⚠ 欠款 $${outstanding.toLocaleString()} 已達信用額度 ${Math.round(ratio * 100)}%，請注意` }
    return null
  }

  // 條碼揀貨處理
  const handlePickScan = async (code) => {
    if (!expanded) return
    const orderItems = items[expanded] || []
    const matched = orderItems.find(i =>
      i.sku_code?.toLowerCase() === code.toLowerCase() && (i.picked_qty || 0) < (i.quantity || 0)
    )
    if (matched) {
      const newQty = (matched.picked_qty || 0) + 1
      const newStatus = newQty >= matched.quantity ? '已揀貨' : matched.status
      const { data } = await supabase.from('outbound_items').update({ picked_qty: newQty, status: newStatus }).eq('id', matched.id).select().single()
      if (data) {
        setItems(prev => ({ ...prev, [expanded]: prev[expanded].map(i => i.id === matched.id ? data : i) }))
      }
      setHighlightItem(matched.id)
      playBeep(true)
      setTimeout(() => setHighlightItem(null), 1500)
    } else {
      playBeep(false)
    }
  }

  // 計算揀貨進度
  const getPickProgress = (orderId) => {
    const orderItems = items[orderId] || []
    if (orderItems.length === 0) return null
    const picked = orderItems.filter(i => (i.picked_qty || 0) >= (i.quantity || 0)).length
    return { picked, total: orderItems.length }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div><h2><span className="header-icon">🚚</span> 出貨管理</h2><p>訂單揀貨、複核與出貨</p></div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增出貨單</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {[['待揀貨', 'var(--accent-orange)', 'var(--accent-orange-dim)'],
          ['揀貨中', 'var(--accent-blue)', 'var(--accent-blue-dim)'],
          ['已複核', 'var(--accent-cyan)', 'var(--accent-cyan-dim)'],
          ['已出貨', 'var(--accent-green)', 'var(--accent-green-dim)'],
        ].map(([s, accent, dim]) => (
          <div key={s} className="stat-card" style={{ '--card-accent': accent, '--card-accent-dim': dim }}>
            <div className="stat-card-label">{s}</div>
            <div className="stat-card-value">{orders.filter(o => o.status === s).length}</div>
          </div>
        ))}
      </div>

      {/* 條碼揀貨 */}
      <BarcodeInput
        onScan={handlePickScan}
        placeholder="掃描條碼揀貨（請先展開出貨單）..."
        autoLookup={false}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {orders.map(o => {
          const creditWarning = getCreditWarning(o.customer)
          return (
            <div key={o.id} className="card">
              {/* CRM 信用警告 */}
              {creditWarning && (
                <div style={{ padding: '8px 16px', background: creditWarning.level === 'danger' ? 'var(--accent-red-dim)' : 'var(--accent-orange-dim)', borderBottom: `1px solid ${creditWarning.level === 'danger' ? 'var(--accent-red)' : 'var(--accent-orange)'}`, fontSize: 12, fontWeight: 600, color: creditWarning.level === 'danger' ? 'var(--accent-red)' : 'var(--accent-orange)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={14} />
                  CRM 信用管控：{creditWarning.msg}
                </div>
              )}

              <div className="card-body" style={{ cursor: 'pointer' }} onClick={() => toggleExpand(o.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {expanded === o.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <div>
                      <div style={{ fontWeight: 700 }}>{o.order_number}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{o.customer} · {o.carrier} · 截止：{o.due_date || '-'}</div>
                      {o.tracking_number && <div style={{ fontSize: 11, color: 'var(--accent-cyan)' }}>單號：{o.tracking_number}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <select className="form-input" style={{ padding: '2px 8px', fontSize: 12 }} value={o.status} onClick={e => e.stopPropagation()} onChange={e => updateStatus(o.id, e.target.value)}>
                      {STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {expanded === o.id && (
                <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 16px' }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>物流單號：</span>
                    <input
                      className="form-input"
                      type="text"
                      style={{ width: 200, padding: '4px 8px', fontSize: 12 }}
                      defaultValue={o.tracking_number || ''}
                      placeholder="輸入後自動標記已出貨"
                      onBlur={e => e.target.value && updateTracking(o.id, e.target.value)}
                    />
                  </div>
                  {/* 揀貨進度 */}
                  {(() => {
                    const progress = getPickProgress(o.id)
                    if (!progress) return null
                    const pct = Math.round((progress.picked / progress.total) * 100)
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '8px 12px', background: pct === 100 ? 'var(--accent-green-dim)' : 'var(--bg-main)', borderRadius: 8, fontSize: 13 }}>
                        <ScanBarcode size={14} style={{ color: pct === 100 ? 'var(--accent-green)' : 'var(--accent-cyan)' }} />
                        <span>揀貨進度: <strong>{progress.picked}</strong> / {progress.total}</span>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--border-subtle)', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: pct === 100 ? 'var(--accent-green)' : 'var(--accent-cyan)', transition: 'width 0.3s' }} />
                        </div>
                        <span style={{ fontWeight: 600, color: pct === 100 ? 'var(--accent-green)' : 'var(--text-primary)' }}>{pct}%</span>
                        {pct === 100 && <CheckCircle size={14} style={{ color: 'var(--accent-green)' }} />}
                      </div>
                    )
                  })()}

                  {(items[o.id] || []).length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '8px 0' }}>尚無明細</div>
                  ) : (
                    <table className="data-table">
                      <thead><tr><th>品號</th><th>品名</th><th>應揀數量</th><th>實揀數量</th><th>儲位</th><th>狀態</th></tr></thead>
                      <tbody>
                        {items[o.id].map(item => (
                          <tr key={item.id} style={highlightItem === item.id ? { background: 'rgba(34,197,94,0.15)', transition: 'background 0.3s' } : {}}>
                            <td style={{ fontFamily: 'monospace' }}>{item.sku_code}</td>
                            <td>{item.sku_name}</td>
                            <td>{item.quantity}</td>
                            <td style={{ fontWeight: 600, color: item.picked_qty >= item.quantity ? 'var(--accent-green)' : 'var(--text-primary)' }}>{item.picked_qty}</td>
                            <td style={{ fontSize: 12 }}>{item.bin_code || '-'}</td>
                            <td><span className={`badge ${item.status === '已揀貨' ? 'badge-success' : 'badge-warning'}`}><span className="badge-dot"></span>{item.status}</span></td>
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
      </div>

      {showModal && (
        <Modal title="新增出貨單" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="訂單號 *"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="ORD-2026-001" value={form.order_number} onChange={e => set('order_number', e.target.value)} /></Field>
            <Field label="客戶 *">
              <input className="form-input" type="text" style={{ width: '100%' }} list="cust-list" placeholder="客戶名稱" value={form.customer} onChange={e => set('customer', e.target.value)} />
              <datalist id="cust-list">{customers.map(c => <option key={c.id} value={c.name} />)}</datalist>
            </Field>
          </div>
          {/* 即時信用檢查 */}
          {form.customer && (() => {
            const w = getCreditWarning(form.customer)
            return w ? (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: w.level === 'danger' ? 'var(--accent-red-dim)' : 'var(--accent-orange-dim)', fontSize: 12, fontWeight: 600, color: w.level === 'danger' ? 'var(--accent-red)' : 'var(--accent-orange)' }}>
                {w.msg}
              </div>
            ) : null
          })()}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="物流商">
              <select className="form-input" style={{ width: '100%' }} value={form.carrier} onChange={e => set('carrier', e.target.value)}>
                {CARRIERS.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="倉庫">
              <select className="form-input" style={{ width: '100%' }} value={form.warehouse_id} onChange={e => set('warehouse_id', e.target.value)}>
                <option value="">請選擇倉庫</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="截止出貨日"><input className="form-input" type="date" style={{ width: '100%' }} value={form.due_date} onChange={e => set('due_date', e.target.value)} /></Field>
          <Field label="出貨品項">
            {form.items.map((item, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
                <input className="form-input" placeholder="品名/SKU" value={item.sku_name}
                  onChange={e => set('items', form.items.map((it, j) => j === i ? { ...it, sku_name: e.target.value } : it))} />
                <input className="form-input" type="number" placeholder="數量" min="1" value={item.quantity}
                  onChange={e => set('items', form.items.map((it, j) => j === i ? { ...it, quantity: Number(e.target.value) } : it))} />
                <input className="form-input" placeholder="單位" value={item.unit}
                  onChange={e => set('items', form.items.map((it, j) => j === i ? { ...it, unit: e.target.value } : it))} />
                {form.items.length > 1 && (
                  <button onClick={() => set('items', form.items.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
                )}
              </div>
            ))}
            <button onClick={() => set('items', [...form.items, { sku_name: '', quantity: 1, unit: '個' }])}
              style={{ width: '100%', padding: 6, borderRadius: 6, border: '1px dashed var(--border-medium)', background: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>
              + 新增品項
            </button>
          </Field>
          <Field label="備註"><textarea className="form-input" style={{ width: '100%', minHeight: 50, resize: 'vertical' }} placeholder="出貨備註..." value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  )
}
