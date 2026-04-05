import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'

export default function WMSOverview() {
  const [warehouses, setWarehouses] = useState([])
  const [warehouseStats, setWarehouseStats] = useState({})
  const [selectedWh, setSelectedWh] = useState(null)
  const [inbound, setInbound] = useState([])
  const [outbound, setOutbound] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('warehouses').select('*').order('id'),
      supabase.from('inbound_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('outbound_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('stock_levels').select('warehouse_id, quantity'),
    ]).then(([wh, ib, ob, st]) => {
      const whs = wh.data || []
      const ibs = ib.data || []
      const obs = ob.data || []
      const sts = st.data || []

      // 計算每個倉庫的統計
      const stats = {}
      whs.forEach(w => {
        stats[w.id] = {
          pendingInbound: ibs.filter(o => o.warehouse_id === w.id && o.status === '待到貨').length,
          activeInbound: ibs.filter(o => o.warehouse_id === w.id && o.status === '收貨中').length,
          pendingOutbound: obs.filter(o => o.warehouse_id === w.id && o.status === '待揀貨').length,
          shippedToday: obs.filter(o => o.warehouse_id === w.id && o.status === '已出貨').length,
          stockItems: sts.filter(s => s.warehouse_id === w.id).length,
          totalQty: sts.filter(s => s.warehouse_id === w.id).reduce((acc, s) => acc + (s.quantity || 0), 0),
        }
      })

      setWarehouses(whs)
      setWarehouseStats(stats)
      setInbound(ibs)
      setOutbound(obs)
      if (whs.length > 0) setSelectedWh(whs[0].id)
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const filteredInbound = selectedWh
    ? inbound.filter(o => o.warehouse_id === selectedWh)
    : inbound
  const filteredOutbound = selectedWh
    ? outbound.filter(o => o.warehouse_id === selectedWh)
    : outbound

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">🏭</span> WMS 倉庫管理</h2>
        <p>各分店倉庫進出貨與庫存總覽</p>
      </div>

      {/* 各倉庫卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginBottom: 24 }}>
        {warehouses.map(wh => {
          const s = warehouseStats[wh.id] || {}
          const isSelected = selectedWh === wh.id
          return (
            <div
              key={wh.id}
              className="card"
              style={{ cursor: 'pointer', border: isSelected ? '2px solid var(--accent-cyan)' : '1px solid var(--border-medium)', transition: 'all 0.15s' }}
              onClick={() => setSelectedWh(wh.id)}
            >
              <div className="card-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{wh.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{wh.code} · {wh.manager}</div>
                  </div>
                  <span className={`badge ${wh.status === '啟用' ? 'badge-success' : 'badge-neutral'}`}>
                    <span className="badge-dot"></span>{wh.status}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 8, background: 'var(--glass-light)' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-orange)' }}>{s.pendingInbound || 0}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>待到貨</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 8, background: 'var(--glass-light)' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-cyan)' }}>{s.pendingOutbound || 0}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>待揀貨</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 8, background: 'var(--glass-light)' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-green)' }}>{(s.totalQty || 0).toLocaleString()}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>在庫總數</div>
                  </div>
                </div>

                {(s.activeInbound > 0) && (
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span className="badge-dot" style={{ background: 'var(--accent-blue)', width: 6, height: 6, borderRadius: '50%', display: 'inline-block' }}></span>
                    收貨中 {s.activeInbound} 筆進貨單
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 選定倉庫的詳細資料 */}
      {selectedWh && (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
            📍 {warehouses.find(w => w.id === selectedWh)?.name} — 詳細紀錄
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">📦</span> 進貨單</div>
                <span className="badge badge-neutral">{filteredInbound.length} 筆</span>
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>採購單號</th><th>供應商</th><th>預計到貨</th><th>狀態</th></tr></thead>
                  <tbody>
                    {filteredInbound.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無資料</td></tr>}
                    {filteredInbound.slice(0, 8).map(o => (
                      <tr key={o.id}>
                        <td style={{ fontWeight: 600 }}>{o.po_number}</td>
                        <td>{o.supplier}</td>
                        <td style={{ fontSize: 12 }}>{o.expected_date || '-'}</td>
                        <td><span className={`badge ${o.status === '已完成' ? 'badge-success' : o.status === '收貨中' ? 'badge-info' : 'badge-warning'}`}><span className="badge-dot"></span>{o.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">🚚</span> 出貨單</div>
                <span className="badge badge-neutral">{filteredOutbound.length} 筆</span>
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>訂單號</th><th>客戶</th><th>物流商</th><th>狀態</th></tr></thead>
                  <tbody>
                    {filteredOutbound.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無資料</td></tr>}
                    {filteredOutbound.slice(0, 8).map(o => (
                      <tr key={o.id}>
                        <td style={{ fontWeight: 600 }}>{o.order_number}</td>
                        <td>{o.customer}</td>
                        <td>{o.carrier}</td>
                        <td><span className={`badge ${o.status === '已出貨' ? 'badge-success' : o.status === '揀貨中' ? 'badge-info' : 'badge-warning'}`}><span className="badge-dot"></span>{o.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
