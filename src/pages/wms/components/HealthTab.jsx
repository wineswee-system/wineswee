import { useState } from 'react'
import { Sparkles, Loader2, ChevronRight } from 'lucide-react'
import { inventoryHealthReport } from '../../../lib/aiInventory'
import { ResultCard, Badge } from './AIInventoryHelpers'

export default function HealthTab({ skus, stockLevels, transactions, suppliers }) {
  const [loading, setLoading] = useState(false)
  const [healthResult, setHealthResult] = useState(null)

  const runHealthReport = async () => {
    setLoading(true)
    try {
      const now = new Date()
      const lowStock = stockLevels.filter(s => s.quantity <= s.min_qty && s.min_qty > 0)

      const result = await inventoryHealthReport({
        totalSkus: skus.length,
        totalValue: skus.reduce((s, k) => s + (k.unit_cost || 0) * (k.stock_qty || 0), 0),
        lowStockCount: lowStock.length,
        overstockCount: 0,
        expiringCount: 0,
        deadStockCount: skus.filter(s => {
          const lastTxn = transactions.find(t => t.sku === s.code)
          return !lastTxn || (now - new Date(lastTxn.date)) / 86400000 > 90
        }).length,
        avgTurnover: 0,
        recentAnomalies: [],
        supplierSummary: suppliers.slice(0, 10).map(s => ({ name: s.name, rating: s.rating })),
      })
      setHealthResult(result)
    } catch (e) { setHealthResult({ raw: e.message }) }
    setLoading(false)
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={runHealthReport} disabled={loading} style={{ marginBottom: 16 }}>
        {loading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} 產生庫存健康報告
      </button>
      {healthResult && !healthResult.raw && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
            <div className="stat-card" style={{ '--card-accent': healthResult.grade === 'A' ? 'var(--accent-green)' : healthResult.grade === 'B' ? 'var(--accent-cyan)' : 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">健康評分</div>
              <div className="stat-card-value">{healthResult.healthScore}/100</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
              <div className="stat-card-label">等級</div>
              <div className="stat-card-value">{healthResult.grade}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">待處理問題</div>
              <div className="stat-card-value">{(healthResult.topIssues || []).length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">預估節省</div>
              <div className="stat-card-value" style={{ fontSize: 14 }}>{healthResult.estimatedSavings || '-'}</div>
            </div>
          </div>
          <ResultCard title="摘要"><p>{healthResult.summary}</p></ResultCard>
          {(healthResult.topIssues || []).length > 0 && (
            <ResultCard title="重要問題">
              {healthResult.topIssues.map((issue, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--glass-light)' }}>
                  <Badge color={issue.severity}>{issue.severity}</Badge>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{issue.issue}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{issue.impact}</div>
                    <div style={{ fontSize: 12, color: 'var(--accent-cyan)', marginTop: 2 }}><ChevronRight size={10} style={{ display: 'inline' }} /> {issue.action}</div>
                  </div>
                </div>
              ))}
            </ResultCard>
          )}
          {(healthResult.kpis || []).length > 0 && (
            <ResultCard title="KPIs">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {healthResult.kpis.map((kpi, i) => (
                  <div key={i} style={{ padding: 12, borderRadius: 8, background: 'var(--glass-light)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{kpi.name}</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{kpi.current}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <Badge color={kpi.status}>{kpi.status}</Badge>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>目標: {kpi.target}</span>
                    </div>
                  </div>
                ))}
              </div>
            </ResultCard>
          )}
          {(healthResult.quickWins || []).length > 0 && (
            <ResultCard title="快速改善項目">
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {healthResult.quickWins.map((w, i) => <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>{w}</li>)}
              </ul>
            </ResultCard>
          )}
        </>
      )}
      {healthResult?.raw && <ResultCard title="結果"><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{healthResult.raw}</pre></ResultCard>}
    </div>
  )
}
