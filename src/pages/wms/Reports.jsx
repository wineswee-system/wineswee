import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'

export default function WMSReports() {
  const [expiring, setExpiring] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [recentAdj, setRecentAdj] = useState([])
  const [inboundStats, setInboundStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      // 效期預警（30天內）
      supabase.from('stock_levels').select('*, skus(code, name), bins(code)').not('expiry_date', 'is', null).lte('expiry_date', new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]).gte('expiry_date', new Date().toISOString().split('T')[0]).order('expiry_date'),
      // 庫存調整紀錄
      supabase.from('inventory_adjustments').select('*').order('created_at', { ascending: false }).limit(20),
      // 進貨統計
      supabase.from('inbound_orders').select('status').order('id'),
    ]).then(([exp, adj, ib]) => {
      setExpiring(exp.data || [])
      setRecentAdj(adj.data || [])
      // 統計各狀態數量
      const stats = {}
      ;(ib.data || []).forEach(o => { stats[o.status] = (stats[o.status] || 0) + 1 })
      setInboundStats(Object.entries(stats).map(([status, count]) => ({ status, count })))
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">📈</span> 異常與報表</h2>
        <p>效期預警、庫存異常與統計報表</p>
      </div>

      {/* 效期預警 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">⚠️</span> 效期預警（30天內）</div>
          {expiring.length > 0 && <span className="badge badge-danger">{expiring.length} 筆</span>}
        </div>
        {expiring.length === 0 ? (
          <div className="card-body" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>無效期預警商品</div>
        ) : (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>品號</th><th>品名</th><th>儲位</th><th>數量</th><th>效期</th><th>剩餘天數</th></tr></thead>
              <tbody>
                {expiring.map(s => {
                  const daysLeft = Math.round((new Date(s.expiry_date) - new Date()) / (1000 * 60 * 60 * 24))
                  return (
                    <tr key={s.id}>
                      <td style={{ fontFamily: 'monospace' }}>{s.skus?.code}</td>
                      <td>{s.skus?.name}</td>
                      <td>{s.bins?.code}</td>
                      <td>{s.quantity}</td>
                      <td>{s.expiry_date}</td>
                      <td>
                        <span className={`badge ${daysLeft <= 7 ? 'badge-danger' : 'badge-warning'}`}>
                          {daysLeft} 天
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 進貨狀態統計 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📦</span> 進貨單狀態統計</div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {inboundStats.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center' }}>尚無資料</div>}
            {inboundStats.map(({ status, count }) => {
              const color = status === '已完成' ? 'var(--accent-green)' : status === '收貨中' ? 'var(--accent-cyan)' : status === '異常' ? 'var(--accent-red)' : 'var(--accent-orange)'
              return (
                <div key={status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13 }}>{status}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 80, height: 6, borderRadius: 3, background: 'var(--glass-light)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(100, count * 10)}%`, background: color, borderRadius: 3 }} />
                    </div>
                    <span style={{ fontWeight: 700, color }}>{count}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📝</span> 近期庫存調整</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>品號</th><th>調整量</th><th>原因</th></tr></thead>
              <tbody>
                {recentAdj.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無紀錄</td></tr>}
                {recentAdj.slice(0, 8).map(a => (
                  <tr key={a.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{a.sku_code}</td>
                    <td style={{ fontWeight: 700, color: a.quantity > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {a.quantity > 0 ? '+' : ''}{a.quantity}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{a.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
