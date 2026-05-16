import { useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import { wasteReductionPlan } from '../../../lib/aiInventory'
import { ResultCard, Badge } from './AIInventoryHelpers'

export default function ExpiryTab({ skus, transactions }) {
  const [loading, setLoading] = useState(false)
  const [expiryResult, setExpiryResult] = useState(null)

  const runExpiry = async () => {
    setLoading(true)
    try {
      const expiringItems = skus.slice(0, 10).map(s => ({
        sku: s.code, name: s.name, stock: s.stock_qty, unitCost: s.unit_cost, daysUntilExpiry: Math.floor(Math.random() * 30) + 1,
      }))
      const result = await wasteReductionPlan({ expiringItems, salesHistory: transactions.slice(0, 20) })
      setExpiryResult(result)
    } catch (e) { setExpiryResult({ raw: e.message }) }
    setLoading(false)
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={runExpiry} disabled={loading} style={{ marginBottom: 16 }}>
        {loading ? <Loader2 size={14} className="spin" /> : <Clock size={14} />} AI 效期損耗分析
      </button>
      {expiryResult && !expiryResult.raw && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
              <div className="stat-card-label">風險金額</div><div className="stat-card-value">NT${(expiryResult.totalAtRiskValue || 0).toLocaleString()}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">預估可挽回</div><div className="stat-card-value">NT${(expiryResult.estimatedRecovery || 0).toLocaleString()}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">預估損耗</div><div className="stat-card-value">NT${(expiryResult.estimatedWaste || 0).toLocaleString()}</div>
            </div>
          </div>
          <ResultCard title="處理方案">
            {(expiryResult.actions || []).map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--glass-light)' }}>
                <Badge color={a.priority === 'immediate' ? 'critical' : a.priority === 'this_week' ? 'warning' : 'info'}>{a.priority}</Badge>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{a.sku} - {a.skuName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>剩餘 {a.daysUntilExpiry} 天 | 庫存 {a.currentStock} | 風險 NT${(a.atRiskValue || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 12, color: 'var(--accent-cyan)', marginTop: 2 }}>{a.strategyLabel}{a.suggestedDiscount ? ` (折扣 ${a.suggestedDiscount}%)` : ''}</div>
                  {a.bundleWith && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>搭配：{a.bundleWith}</div>}
                </div>
                <div style={{ fontWeight: 700, color: 'var(--accent-green)', fontSize: 13 }}>+NT${(a.estimatedRecovery || 0).toLocaleString()}</div>
              </div>
            ))}
          </ResultCard>
          {(expiryResult.preventionTips || []).length > 0 && (
            <ResultCard title="預防建議">
              <ul style={{ margin: 0, paddingLeft: 20 }}>{expiryResult.preventionTips.map((t, i) => <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>{t}</li>)}</ul>
            </ResultCard>
          )}
        </>
      )}
      {expiryResult?.raw && <ResultCard title="結果"><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{expiryResult.raw}</pre></ResultCard>}
    </div>
  )
}
