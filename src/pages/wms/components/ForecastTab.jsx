import { useState } from 'react'
import { TrendingUp, Loader2, AlertTriangle } from 'lucide-react'
import { aiForecastDemand } from '../../../lib/aiInventory'
import { ResultCard } from './AIInventoryHelpers'

export default function ForecastTab({ skus, transactions }) {
  const [loading, setLoading] = useState(false)
  const [forecastResult, setForecastResult] = useState(null)
  const [forecastSku, setForecastSku] = useState('')

  const runForecast = async () => {
    if (!forecastSku) return
    setLoading(true)
    try {
      const sku = skus.find(s => s.code === forecastSku) || skus[0]
      const history = []
      const txns = transactions.filter(t => t.sku === forecastSku && t.type === 'OUT')
      const byMonth = {}
      txns.forEach(t => { const m = t.date?.slice(0, 7); if (m) byMonth[m] = (byMonth[m] || 0) + Math.abs(t.qty || 0) })
      Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).forEach(([period, demand]) => history.push({ period, demand }))

      const result = await aiForecastDemand({
        skuCode: forecastSku, skuName: sku?.name,
        history: history.length > 0 ? history : [{ period: 'N/A', demand: 0 }],
        context: { category: sku?.category, currentStock: sku?.stock_qty, unitCost: sku?.unit_cost },
      })
      setForecastResult(result)
    } catch (e) { setForecastResult({ raw: e.message }) }
    setLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <select className="form-input" style={{ width: 250 }} value={forecastSku} onChange={e => setForecastSku(e.target.value)}>
          <option value="">-- 選擇商品 --</option>
          {skus.map(s => <option key={s.code} value={s.code}>{s.code} - {s.name}</option>)}
        </select>
        <button className="btn btn-primary" onClick={runForecast} disabled={loading || !forecastSku}>
          {loading ? <Loader2 size={14} className="spin" /> : <TrendingUp size={14} />} AI 預測
        </button>
      </div>
      {forecastResult && !forecastResult.raw && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
              <div className="stat-card-label">趨勢</div><div className="stat-card-value" style={{ fontSize: 14 }}>{forecastResult.trendExplanation || forecastResult.trend}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">信心水準</div><div className="stat-card-value">{Math.round((forecastResult.confidence || 0) * 100)}%</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">建議安全庫存</div><div className="stat-card-value">{forecastResult.recommendations?.safetyStock || '-'}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">建議訂購量</div><div className="stat-card-value">{forecastResult.recommendations?.suggestedOrderQty || '-'}</div>
            </div>
          </div>
          {(forecastResult.forecasts || []).length > 0 && (
            <ResultCard title="預測結果">
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>期間</th><th>預測量</th><th>下限</th><th>上限</th></tr></thead>
                  <tbody>
                    {forecastResult.forecasts.map((f, i) => (
                      <tr key={i}><td>{f.period}</td><td style={{ fontWeight: 700 }}>{f.predicted}</td><td>{f.lower}</td><td>{f.upper}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ResultCard>
          )}
          {(forecastResult.seasonalFactors || []).length > 0 && (
            <ResultCard title="季節性因素">
              <ul style={{ margin: 0, paddingLeft: 20 }}>{forecastResult.seasonalFactors.map((f, i) => <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>{f}</li>)}</ul>
            </ResultCard>
          )}
          {forecastResult.recommendations?.reasoning && (
            <ResultCard title="AI 建議"><p style={{ fontSize: 13 }}>{forecastResult.recommendations.reasoning}</p></ResultCard>
          )}
          {(forecastResult.risks || []).length > 0 && (
            <ResultCard title="風險提醒">
              {forecastResult.risks.map((r, i) => <div key={i} style={{ fontSize: 13, padding: '4px 0' }}><AlertTriangle size={12} style={{ display: 'inline', color: 'var(--accent-orange)', marginRight: 4 }} />{r}</div>)}
            </ResultCard>
          )}
        </>
      )}
      {forecastResult?.raw && <ResultCard title="結果"><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{forecastResult.raw}</pre></ResultCard>}
    </div>
  )
}
