import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'

export default function WMSReports() {
  const [expiring, setExpiring] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [recentAdj, setRecentAdj] = useState([])
  const [inboundStats, setInboundStats] = useState([])
  const [turnoverData, setTurnoverData] = useState([])
  const [deadStock, setDeadStock] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deadStockDays, setDeadStockDays] = useState(90)
  const [activeTab, setActiveTab] = useState('alerts')

  useEffect(() => {
    Promise.all([
      // 效期預警（30天內）
      supabase.from('stock_levels').select('*, skus(code, name), bins(code)').not('expiry_date', 'is', null).lte('expiry_date', new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]).gte('expiry_date', new Date().toISOString().split('T')[0]).order('expiry_date'),
      // 庫存調整紀錄
      supabase.from('inventory_adjustments').select('*').order('created_at', { ascending: false }).limit(20),
      // 進貨統計
      supabase.from('inbound_orders').select('status').order('id'),
      // 庫存異動（計算周轉率和呆滯庫存）
      supabase.from('inventory_transactions').select('sku, date, type, qty, unit_cost').order('date', { ascending: false }),
      // 商品主檔（含庫存）
      supabase.from('skus').select('code, name, unit_cost, stock_qty').eq('status', '啟用'),
    ]).then(([exp, adj, ib, txnRes, skuRes]) => {
      setExpiring(exp.data || [])
      setRecentAdj(adj.data || [])

      const stats = {}
      ;(ib.data || []).forEach(o => { stats[o.status] = (stats[o.status] || 0) + 1 })
      setInboundStats(Object.entries(stats).map(([status, count]) => ({ status, count })))

      // 計算庫存周轉率
      const transactions = txnRes.data || []
      const skusData = skuRes.data || []
      computeTurnover(transactions, skusData)
      computeDeadStock(transactions, skusData)
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const computeTurnover = (transactions, skusData) => {
    const now = new Date()
    const yearAgo = new Date(now)
    yearAgo.setFullYear(yearAgo.getFullYear() - 1)

    // 計算每個 SKU 的年出貨量（COGS）
    const skuCOGS = {}
    for (const txn of transactions) {
      if (txn.type !== 'OUT') continue
      const d = new Date(txn.date)
      if (d < yearAgo) continue
      const sku = txn.sku
      if (!skuCOGS[sku]) skuCOGS[sku] = 0
      skuCOGS[sku] += Math.abs(txn.qty || 0) * (txn.unit_cost || 0)
    }

    const results = skusData.map(s => {
      const cogs = skuCOGS[s.code] || 0
      const avgInventory = (s.stock_qty || 0) * (s.unit_cost || 0)
      const turnoverRate = avgInventory > 0 ? Math.round((cogs / avgInventory) * 100) / 100 : 0
      const daysOfStock = turnoverRate > 0 ? Math.round(365 / turnoverRate) : 999

      return {
        sku: s.code,
        name: s.name,
        cogs: Math.round(cogs),
        inventoryValue: Math.round(avgInventory),
        turnoverRate,
        daysOfStock,
        stock_qty: s.stock_qty || 0,
      }
    }).filter(r => r.inventoryValue > 0 || r.cogs > 0)
      .sort((a, b) => a.turnoverRate - b.turnoverRate)

    setTurnoverData(results)
  }

  const computeDeadStock = (transactions, skusData) => {
    const now = new Date()
    // 找每個 SKU 最後異動日
    const lastMove = {}
    for (const txn of transactions) {
      const sku = txn.sku
      if (!lastMove[sku] || new Date(txn.date) > new Date(lastMove[sku])) {
        lastMove[sku] = txn.date
      }
    }

    const results = skusData.map(s => {
      const lastDate = lastMove[s.code]
      const daysSince = lastDate ? Math.floor((now - new Date(lastDate)) / 86400000) : Infinity
      const value = Math.round((s.stock_qty || 0) * (s.unit_cost || 0))

      let classification
      if (daysSince === Infinity) classification = 'dead'
      else if (daysSince >= 270) classification = 'dead'
      else if (daysSince >= 180) classification = 'very_slow'
      else if (daysSince >= 90) classification = 'slow'
      else classification = 'active'

      return {
        sku: s.code,
        name: s.name,
        daysSince: daysSince === Infinity ? '從未異動' : daysSince,
        stock_qty: s.stock_qty || 0,
        value,
        lastDate: lastDate || null,
        classification,
      }
    }).filter(r => r.classification !== 'active' && r.stock_qty > 0)
      .sort((a, b) => b.value - a.value)

    setDeadStock(results)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const deadStockValue = deadStock.reduce((s, d) => s + d.value, 0)
  const classColors = { dead: 'var(--accent-red)', very_slow: 'var(--accent-orange)', slow: 'var(--accent-yellow)' }
  const classLabels = { dead: '完全呆滯', very_slow: '極慢動', slow: '慢動' }

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">📈</span> 報表與分析</h2>
        <p>效期預警、庫存周轉率、呆滯分析</p>
      </div>

      {/* Tab 切換 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {[
          { key: 'alerts', label: '異常預警' },
          { key: 'turnover', label: '庫存周轉率' },
          { key: 'deadstock', label: '呆滯庫存分析' },
        ].map(tab => (
          <button key={tab.key} className={`btn ${activeTab === tab.key ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: 13 }} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
            {tab.key === 'deadstock' && deadStock.length > 0 && (
              <span className="badge badge-danger" style={{ marginLeft: 6, fontSize: 10 }}>{deadStock.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ 異常預警 Tab ═══ */}
      {activeTab === 'alerts' && (
        <>
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

          {/* 進貨狀態統計 + 庫存調整 */}
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
        </>
      )}

      {/* ═══ 庫存周轉率 Tab ═══ */}
      {activeTab === 'turnover' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🔄</span> 庫存周轉率分析（近 12 個月）</div>
            <span className="badge badge-info">{turnoverData.length} 品項</span>
          </div>
          {turnoverData.length === 0 ? (
            <div className="card-body" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>無足夠異動資料計算周轉率</div>
          ) : (
            <>
              {/* 周轉率摘要 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '12px 16px' }}>
                {[
                  { label: '高周轉 (>6)', count: turnoverData.filter(t => t.turnoverRate > 6).length, color: 'var(--accent-green)' },
                  { label: '正常 (2~6)', count: turnoverData.filter(t => t.turnoverRate >= 2 && t.turnoverRate <= 6).length, color: 'var(--accent-cyan)' },
                  { label: '偏低 (1~2)', count: turnoverData.filter(t => t.turnoverRate >= 1 && t.turnoverRate < 2).length, color: 'var(--accent-orange)' },
                  { label: '極低 (<1)', count: turnoverData.filter(t => t.turnoverRate < 1).length, color: 'var(--accent-red)' },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: 'center', padding: '8px 0' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.count}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>品號</th><th>品名</th><th>庫存量</th><th>庫存價值</th><th>年銷貨成本</th><th>周轉率</th><th>庫存天數</th></tr></thead>
                  <tbody>
                    {turnoverData.map(t => {
                      const rateColor = t.turnoverRate > 6 ? 'var(--accent-green)' : t.turnoverRate >= 2 ? 'var(--accent-cyan)' : t.turnoverRate >= 1 ? 'var(--accent-orange)' : 'var(--accent-red)'
                      return (
                        <tr key={t.sku}>
                          <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{t.sku}</td>
                          <td>{t.name}</td>
                          <td>{t.stock_qty}</td>
                          <td style={{ fontFamily: 'monospace' }}>${t.inventoryValue.toLocaleString()}</td>
                          <td style={{ fontFamily: 'monospace' }}>${t.cogs.toLocaleString()}</td>
                          <td><span style={{ fontWeight: 700, color: rateColor }}>{t.turnoverRate}</span></td>
                          <td>
                            <span className={`badge ${t.daysOfStock > 180 ? 'badge-danger' : t.daysOfStock > 90 ? 'badge-warning' : 'badge-success'}`}>
                              {t.daysOfStock >= 999 ? '∞' : `${t.daysOfStock} 天`}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ 呆滯庫存 Tab ═══ */}
      {activeTab === 'deadstock' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">💀</span> 呆滯庫存分析</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>呆滯庫存總值：</span>
              <span style={{ fontWeight: 700, color: 'var(--accent-red)', fontFamily: 'monospace' }}>${deadStockValue.toLocaleString()}</span>
            </div>
          </div>
          {deadStock.length === 0 ? (
            <div className="card-body" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>無呆滯庫存（所有品項在 90 天內有異動）</div>
          ) : (
            <>
              {/* 分類摘要 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: '12px 16px' }}>
                {[
                  { key: 'dead', label: '完全呆滯 (>270天)', color: 'var(--accent-red)' },
                  { key: 'very_slow', label: '極慢動 (180~270天)', color: 'var(--accent-orange)' },
                  { key: 'slow', label: '慢動 (90~180天)', color: 'var(--accent-yellow)' },
                ].map(c => {
                  const items = deadStock.filter(d => d.classification === c.key)
                  const val = items.reduce((s, d) => s + d.value, 0)
                  return (
                    <div key={c.key} style={{ textAlign: 'center', padding: '8px 0' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{items.length} 品項</div>
                      <div style={{ fontSize: 12, fontFamily: 'monospace', color: c.color }}>${val.toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{c.label}</div>
                    </div>
                  )
                })}
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>品號</th><th>品名</th><th>庫存量</th><th>庫存價值</th><th>最後異動</th><th>閒置天數</th><th>分類</th></tr></thead>
                  <tbody>
                    {deadStock.map(d => (
                      <tr key={d.sku}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{d.sku}</td>
                        <td>{d.name}</td>
                        <td>{d.stock_qty}</td>
                        <td style={{ fontFamily: 'monospace' }}>${d.value.toLocaleString()}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.lastDate || '-'}</td>
                        <td style={{ fontWeight: 600 }}>{d.daysSince}</td>
                        <td>
                          <span style={{ color: classColors[d.classification], fontWeight: 600, fontSize: 12 }}>
                            {classLabels[d.classification]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
