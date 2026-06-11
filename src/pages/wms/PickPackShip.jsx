import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { createPortal } from 'react-dom'
import { Plus, X, CheckCircle, Package, Truck, ClipboardList } from 'lucide-react'
import { getPickLists, createPickList, updatePickList, getPackLists, createPackList, updatePackList, getSalesOrders, getWarehouses } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useOrgId } from '../../contexts/AuthContext'

const PICK_STATUSES = ['待揀貨', '揀貨中', '已完成']
const PACK_STATUSES = ['待包裝', '包裝中', '已完成']

export default function PickPackShip() {
  const orgId = useOrgId()
  const [pickLists, setPickLists] = useState([])
  const [packLists, setPackLists] = useState([])
  const [salesOrders, setSalesOrders] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('pick') // pick | pack
  const [showCreatePick, setShowCreatePick] = useState(false)
  const [pickForm, setPickForm] = useState({ sales_order_id: '', warehouse_id: '', picker: '' })

  const load = async () => {
    setLoading(true)
    const [pickRes, packRes, soRes, whRes] = await Promise.all([
      getPickLists(orgId), getPackLists(orgId), getSalesOrders(orgId), getWarehouses(orgId),
    ])
    setPickLists(pickRes.data || [])
    setPackLists(packRes.data || [])
    setSalesOrders(soRes.data || [])
    setWarehouses(whRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [orgId])

  const handleCreatePick = async () => {
    if (!pickForm.sales_order_id) return
    const so = salesOrders.find(o => o.id === Number(pickForm.sales_order_id))
    const items = (so?.items || []).map(item => ({
      sku_code: item.code || item.name,
      name: item.name,
      qty_ordered: item.qty || 1,
      qty_picked: 0,
      bin_code: '',
    }))
    const pickNumber = `PK-${Date.now().toString(36).toUpperCase()}`
    const { error } = await createPickList({
      pick_number: pickNumber,
      sales_order_id: Number(pickForm.sales_order_id),
      warehouse_id: pickForm.warehouse_id ? Number(pickForm.warehouse_id) : null,
      picker: pickForm.picker || null,
      status: '待揀貨',
      items,
    })
    if (error) { setError(error.message); return }
    setShowCreatePick(false)
    setPickForm({ sales_order_id: '', warehouse_id: '', picker: '' })
    load()
  }

  const startPicking = async (pick) => {
    await updatePickList(pick.id, { status: '揀貨中', started_at: new Date().toISOString() })
    load()
  }

  const completePicking = async (pick) => {
    // Mark all items as fully picked
    const items = (pick.items || []).map(i => ({ ...i, qty_picked: i.qty_ordered }))
    await updatePickList(pick.id, { status: '已完成', items, completed_at: new Date().toISOString() })
    // Auto-create pack list
    const packNumber = `PK-${pick.pick_number?.replace('PK-', 'PA-') || Date.now().toString(36).toUpperCase()}`
    await createPackList({
      pack_number: packNumber,
      pick_list_id: pick.id,
      status: '待包裝',
      boxes: [{ box_number: 'BOX-1', items: items.map(i => ({ sku_code: i.sku_code, qty: i.qty_picked })), weight: 0, dimensions: '' }],
    })
    load()
  }

  const completePacking = async (pack) => {
    await updatePackList(pack.id, { status: '已完成', completed_at: new Date().toISOString() })
    load()
  }

  const statusColor = (s) => {
    if (s.includes('待')) return '#fbbf24'
    if (s.includes('中')) return '#3b82f6'
    if (s.includes('完成')) return '#34d399'
    return '#94a3b8'
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📦</span> 揀貨 / 包裝 / 出貨</h2>
            <p>Pick / Pack / Ship — 出庫作業流程管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreatePick(true)}>
            <Plus size={14} /> 建立揀貨單
          </button>
        </div>
      </div>

      {error && <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button></div>}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': '#fbbf24', '--card-accent-dim': 'rgba(251,191,36,0.15)' }}>
          <div className="stat-card-label">待揀貨</div>
          <div className="stat-card-value">{pickLists.filter(p => p.status === '待揀貨').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">揀貨中</div>
          <div className="stat-card-value">{pickLists.filter(p => p.status === '揀貨中').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待包裝</div>
          <div className="stat-card-value">{packLists.filter(p => p.status === '待包裝').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已完成</div>
          <div className="stat-card-value">{pickLists.filter(p => p.status === '已完成').length + packLists.filter(p => p.status === '已完成').length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', padding: 4, borderRadius: 8, width: 'fit-content', border: '1px solid var(--border)' }}>
        <button onClick={() => setTab('pick')} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: tab === 'pick' ? 'var(--accent-blue)' : 'transparent', color: tab === 'pick' ? '#fff' : 'var(--text-secondary)' }}>
          <ClipboardList size={13} style={{ marginRight: 4, verticalAlign: -2 }} /> 揀貨單 ({pickLists.length})
        </button>
        <button onClick={() => setTab('pack')} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: tab === 'pack' ? 'var(--accent-blue)' : 'transparent', color: tab === 'pack' ? '#fff' : 'var(--text-secondary)' }}>
          <Package size={13} style={{ marginRight: 4, verticalAlign: -2 }} /> 包裝單 ({packLists.length})
        </button>
      </div>

      {tab === 'pick' && (
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>揀貨單號</th>
                <th>銷售訂單</th>
                <th>倉庫</th>
                <th>揀貨員</th>
                <th>品項數</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {pickLists.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無揀貨單</td></tr>
              ) : pickLists.map(pick => {
                const so = salesOrders.find(o => o.id === pick.sales_order_id)
                const wh = warehouses.find(w => w.id === pick.warehouse_id)
                const items = pick.items || []
                return (
                  <tr key={pick.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{pick.pick_number}</td>
                    <td>{so?.order_number || '-'}</td>
                    <td>{wh?.name || '-'}</td>
                    <td>{pick.picker || '-'}</td>
                    <td>{items.length}</td>
                    <td>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: `color-mix(in srgb, ${statusColor(pick.status)} 15%, transparent)`, color: statusColor(pick.status) }}>{pick.status}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {pick.status === '待揀貨' && (
                          <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => startPicking(pick)}>開始揀貨</button>
                        )}
                        {pick.status === '揀貨中' && (
                          <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => completePicking(pick)}>
                            <CheckCircle size={12} /> 完成
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'pack' && (
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>包裝單號</th>
                <th>揀貨單</th>
                <th>包裝員</th>
                <th>箱數</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {packLists.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>尚無包裝單</td></tr>
              ) : packLists.map(pack => (
                <tr key={pack.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{pack.pack_number}</td>
                  <td>{pack.pick_lists?.pick_number || '-'}</td>
                  <td>{pack.packer || '-'}</td>
                  <td>{(pack.boxes || []).length}</td>
                  <td>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: `color-mix(in srgb, ${statusColor(pack.status)} 15%, transparent)`, color: statusColor(pack.status) }}>{pack.status}</span>
                  </td>
                  <td>
                    {(pack.status === '待包裝' || pack.status === '包裝中') && (
                      <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => completePacking(pack)}>
                        <CheckCircle size={12} /> 完成包裝
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Pick Modal */}
      {showCreatePick && (
        <ModalOverlay onClose={() => setShowCreatePick(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 420, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>建立揀貨單</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowCreatePick(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>銷售訂單 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
                <select value={pickForm.sales_order_id} onChange={e => setPickForm(f => ({ ...f, sales_order_id: e.target.value }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                  <option value="">請選擇</option>
                  {salesOrders.filter(o => o.shipping_status !== '已出貨').map(o => (
                    <option key={o.id} value={o.id}>{o.order_number} - {o.customer}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>倉庫</label>
                <select value={pickForm.warehouse_id} onChange={e => setPickForm(f => ({ ...f, warehouse_id: e.target.value }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                  <option value="">預設倉庫</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>揀貨員</label>
                <input type="text" value={pickForm.picker} onChange={e => setPickForm(f => ({ ...f, picker: e.target.value }))} placeholder="選填" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowCreatePick(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreatePick}>建立</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
