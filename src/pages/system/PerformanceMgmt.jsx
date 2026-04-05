import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { getKpiData } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

export default function PerformanceMgmt() {
  const [kpis, setKpis] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getKpiData().then(({ data }) => {
      setKpis(data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const overallRate = kpis.length
    ? Math.round(kpis.reduce((s, k) => s + Number(k.value) / Number(k.target), 0) / kpis.length * 100)
    : 0

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon">🏆</span> 績效管理</h2>
        <p>公司 KPI 指標追蹤</p>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">達標指標</div>
          <div className="stat-card-value">{kpis.filter(k => Number(k.value) >= Number(k.target) * 0.9).length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待改善</div>
          <div className="stat-card-value">{kpis.filter(k => Number(k.value) < Number(k.target) * 0.9).length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">整體達成率</div>
          <div className="stat-card-value">{overallRate}%</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📊</span> KPI 指標</div>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {kpis.map((k, i) => {
            const pct = Math.round(Number(k.value) / Number(k.target) * 100)
            const TrendIcon = k.trend === 'up' ? TrendingUp : k.trend === 'down' ? TrendingDown : Minus
            const trendColor = k.trend === 'up' ? 'var(--accent-green)' : k.trend === 'down' ? 'var(--accent-red)' : 'var(--text-muted)'
            return (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TrendIcon size={14} style={{ color: trendColor }} />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{k.metric}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: pct >= 90 ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                      {k.value}{k.unit}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/ {k.target}{k.unit}</span>
                    <span style={{ fontSize: 11, color: pct >= 90 ? 'var(--accent-green)' : 'var(--accent-orange)' }}>{pct}%</span>
                  </div>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.min(pct, 100)}%`, background: pct >= 95 ? 'var(--accent-green)' : pct >= 80 ? 'var(--accent-cyan)' : 'var(--accent-orange)' }}></div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
