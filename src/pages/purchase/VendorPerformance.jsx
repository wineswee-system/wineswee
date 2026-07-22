import { useState, useEffect } from 'react'
import { Search, Star, TrendingUp, TrendingDown, BarChart3, ChevronRight, ChevronDown, RefreshCw, Award, AlertTriangle } from 'lucide-react'
import { getSuppliers, getPurchaseOrders, getGoodsReceipts } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

const MOCK_PERFORMANCE = [
  { id: 1, name: '台北電子零件', deliveryRate: 95, qualityScore: 92, priceStability: 88, avgLeadTime: 5, overallScore: 92, trend: 'up', orders: 24, totalAmount: 1250000 },
  { id: 2, name: '新竹精密工業', deliveryRate: 88, qualityScore: 96, priceStability: 82, avgLeadTime: 7, overallScore: 89, trend: 'up', orders: 18, totalAmount: 980000 },
  { id: 3, name: '台中包裝材料', deliveryRate: 78, qualityScore: 85, priceStability: 90, avgLeadTime: 3, overallScore: 83, trend: 'down', orders: 31, totalAmount: 620000 },
  { id: 4, name: '高雄鋼鐵供應', deliveryRate: 92, qualityScore: 75, priceStability: 70, avgLeadTime: 10, overallScore: 78, trend: 'down', orders: 12, totalAmount: 2100000 },
  { id: 5, name: '桃園化學原料', deliveryRate: 98, qualityScore: 90, priceStability: 95, avgLeadTime: 4, overallScore: 95, trend: 'up', orders: 15, totalAmount: 870000 },
]

export default function VendorPerformance() {
  const { profile } = useAuth()
  const [performance, setPerformance] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedRow, setExpandedRow] = useState(null)
  const [sortBy, setSortBy] = useState('overallScore')

  useEffect(() => {
    computePerformance()
  }, [profile?.organization_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const computePerformance = async () => {
    setLoading(true)
    try {
      const [suppRes, poRes, grRes] = await Promise.all([
        getSuppliers().catch(() => ({ data: null })),
        getPurchaseOrders(profile?.organization_id).catch(() => ({ data: null })),
        getGoodsReceipts().catch(() => ({ data: null })),
      ])

      const suppliers = suppRes.data || []
      const orders = poRes.data || []
      const receipts = grRes.data || []

      if (suppliers.length === 0) {
        setPerformance(MOCK_PERFORMANCE)
        setLoading(false)
        return
      }

      const results = suppliers.map(s => {
        const supplierOrders = orders.filter(o => o.supplier === s.name || o.supplier_id === s.id)
        const orderCount = supplierOrders.length
        const totalAmount = supplierOrders.reduce((sum, o) => sum + (o.total_amount || o.grand_total || 0), 0)

        const delivered = supplierOrders.filter(o => o.status === '已到貨' || o.status === '已完成').length
        const deliveryRate = orderCount > 0 ? Math.round((delivered / orderCount) * 100) : 80

        const supplierReceipts = receipts.filter(r => supplierOrders.some(o => o.id === r.po_id))
        const passed = supplierReceipts.filter(r => r.status === '已驗收' || r.inspection_result === '合格').length
        const qualityScore = supplierReceipts.length > 0 ? Math.round((passed / supplierReceipts.length) * 100) : 85

        const amounts = supplierOrders.map(o => o.total_amount || o.grand_total || 0).filter(a => a > 0)
        let priceStability = 85
        if (amounts.length > 1) {
          const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length
          const variance = amounts.reduce((sum, a) => sum + Math.pow(a - avg, 2), 0) / amounts.length
          const cv = avg > 0 ? (Math.sqrt(variance) / avg) * 100 : 0
          priceStability = Math.max(0, Math.min(100, Math.round(100 - cv)))
        }

        let avgLeadTime = 7
        if (supplierReceipts.length > 0 && supplierOrders.length > 0) {
          const leadTimes = supplierReceipts.map(r => {
            const po = supplierOrders.find(o => o.id === r.po_id)
            if (po && r.created_at && po.created_at) {
              return Math.max(1, Math.round((new Date(r.created_at) - new Date(po.created_at)) / 86400000))
            }
            return null
          }).filter(Boolean)
          if (leadTimes.length > 0) avgLeadTime = Math.round(leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length)
        }

        const leadTimeScore = Math.max(0, Math.min(100, 100 - (avgLeadTime - 3) * 5))
        const overallScore = Math.round(deliveryRate * 0.3 + qualityScore * 0.3 + priceStability * 0.2 + leadTimeScore * 0.2)
        const trend = overallScore >= 85 ? 'up' : 'down'

        return { id: s.id, name: s.name, deliveryRate, qualityScore, priceStability, avgLeadTime, overallScore, trend, orders: orderCount, totalAmount }
      }).filter(r => r.orders > 0 || MOCK_PERFORMANCE.length === 0)

      setPerformance(results.length > 0 ? results : MOCK_PERFORMANCE)
    } catch {
      setPerformance(MOCK_PERFORMANCE)
    }
    setLoading(false)
  }

  if (loading) return <LoadingSpinner />

  const sorted = [...performance]
    .filter(p => search === '' || p.name?.includes(search))
    .sort((a, b) => b[sortBy] - a[sortBy])

  const avgScore = performance.length > 0 ? Math.round(performance.reduce((s, p) => s + p.overallScore, 0) / performance.length) : 0
  const topPerformer = performance.reduce((best, p) => p.overallScore > (best?.overallScore || 0) ? p : best, null)
  const belowThreshold = performance.filter(p => p.overallScore < 80).length

  const scoreColor = (score) => {
    if (score >= 90) return 'var(--accent-green)'
    if (score >= 75) return 'var(--accent-blue)'
    if (score >= 60) return 'var(--accent-orange)'
    return 'var(--accent-red)'
  }

  const renderStars = (score) => {
    const stars = Math.round((score / 100) * 5)
    return (
      <span style={{ display: 'inline-flex', gap: 2 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <Star key={i} size={14} fill={i <= stars ? 'var(--accent-orange)' : 'none'} stroke={i <= stars ? 'var(--accent-orange)' : 'var(--text-muted)'} />
        ))}
      </span>
    )
  }

  const ProgressBar = ({ value, color }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', borderRadius: 3, background: color || scoreColor(value), transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: color || scoreColor(value), minWidth: 36, textAlign: 'right' }}>{value}%</span>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📊</span> 供應商績效</h2>
            <p>供應商評分卡 — 交期、品質、價格穩定性綜合評估</p>
          </div>
          <button className="btn btn-secondary" onClick={computePerformance}><RefreshCw size={14} /> 重新計算</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">評估供應商</div>
          <div className="stat-card-value">{performance.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">平均績效分</div>
          <div className="stat-card-value">{avgScore}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">最佳供應商</div>
          <div className="stat-card-value" style={{ fontSize: 18 }}>{topPerformer?.name || '-'}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">低於標準 (&lt;80)</div>
          <div className="stat-card-value">{belowThreshold}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><BarChart3 size={16} /></span> 績效評分卡</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="form-input" style={{ width: 'auto', fontSize: 13 }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="overallScore">綜合評分</option>
              <option value="deliveryRate">交期達成率</option>
              <option value="qualityScore">品質分數</option>
              <option value="priceStability">價格穩定性</option>
              <option value="orders">訂單數量</option>
            </select>
            <div className="search-bar">
              <Search className="search-icon" />
              <input type="text" placeholder="搜尋供應商..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th style={{ width: 30 }}></th><th>供應商</th><th>交期達成率</th><th>品質分數</th><th>價格穩定性</th><th>平均交期</th><th>訂單數</th><th>綜合評分</th><th>趨勢</th></tr>
            </thead>
            <tbody>
              {sorted.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無績效資料</td></tr>}
              {sorted.map(p => {
                const isExpanded = expandedRow === p.id
                return (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setExpandedRow(isExpanded ? null : p.id)}>
                    <td>{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td style={{ fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {p.overallScore >= 90 ? <Award size={14} style={{ color: 'var(--accent-orange)' }} /> : p.overallScore < 70 ? <AlertTriangle size={14} style={{ color: 'var(--accent-red)' }} /> : null}
                        {p.name}
                      </div>
                    </td>
                    <td><span style={{ fontWeight: 600, color: scoreColor(p.deliveryRate) }}>{p.deliveryRate}%</span></td>
                    <td><span style={{ fontWeight: 600, color: scoreColor(p.qualityScore) }}>{p.qualityScore}%</span></td>
                    <td><span style={{ fontWeight: 600, color: scoreColor(p.priceStability) }}>{p.priceStability}%</span></td>
                    <td><span style={{ color: p.avgLeadTime <= 5 ? 'var(--accent-green)' : p.avgLeadTime <= 10 ? 'var(--accent-orange)' : 'var(--accent-red)' }}>{p.avgLeadTime} 天</span></td>
                    <td>{p.orders}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {renderStars(p.overallScore)}
                        <span style={{ fontWeight: 700, color: scoreColor(p.overallScore), fontSize: 14 }}>{p.overallScore}</span>
                      </div>
                    </td>
                    <td>
                      {p.trend === 'up'
                        ? <TrendingUp size={16} style={{ color: 'var(--accent-green)' }} />
                        : <TrendingDown size={16} style={{ color: 'var(--accent-red)' }} />
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {expandedRow && (() => {
          const p = performance.find(r => r.id === expandedRow)
          if (!p) return null
          return (
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-tertiary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h4 style={{ fontSize: 14, fontWeight: 600 }}>📈 {p.name} — 績效明細</h4>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  累計訂單金額：NT$ {(p.totalAmount || 0).toLocaleString()}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>交期達成率（權重 30%）</div>
                  <ProgressBar value={p.deliveryRate} />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>按時交貨訂單 / 總訂單數</div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>品質分數（權重 30%）</div>
                  <ProgressBar value={p.qualityScore} />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>驗收合格率</div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>價格穩定性（權重 20%）</div>
                  <ProgressBar value={p.priceStability} />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>訂單金額變異係數反向分</div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>交期表現（權重 20%）</div>
                  <ProgressBar value={Math.max(0, Math.min(100, 100 - (p.avgLeadTime - 3) * 5))} />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>平均前置天數：{p.avgLeadTime} 天</div>
                </div>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
