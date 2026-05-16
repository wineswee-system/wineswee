import { useState } from 'react'
import { Shield, Loader2 } from 'lucide-react'
import { assessSupplierRisk } from '../../../lib/aiInventory'
import { ResultCard, Badge } from './AIInventoryHelpers'

export default function SupplierTab({ suppliers, transactions }) {
  const [loading, setLoading] = useState(false)
  const [supplierResult, setSupplierResult] = useState(null)
  const [selectedSupplier, setSelectedSupplier] = useState('')

  const runSupplierRisk = async () => {
    if (!selectedSupplier) return
    setLoading(true)
    try {
      const supplier = suppliers.find(s => s.name === selectedSupplier) || { name: selectedSupplier }
      const result = await assessSupplierRisk({
        supplier,
        deliveryHistory: transactions.filter(t => t.type === 'IN').slice(0, 20).map(t => ({ date: t.date, sku: t.sku, qty: t.qty })),
        qualityRecords: [], returnHistory: [],
      })
      setSupplierResult(result)
    } catch (e) { setSupplierResult({ raw: e.message }) }
    setLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <select className="form-input" style={{ width: 250 }} value={selectedSupplier} onChange={e => setSelectedSupplier(e.target.value)}>
          <option value="">-- 選擇供應商 --</option>
          {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <button className="btn btn-primary" onClick={runSupplierRisk} disabled={loading || !selectedSupplier}>
          {loading ? <Loader2 size={14} className="spin" /> : <Shield size={14} />} 評估風險
        </button>
      </div>
      {supplierResult && !supplierResult.raw && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
            <div className="stat-card" style={{ '--card-accent': supplierResult.riskLevel === 'low' ? 'var(--accent-green)' : supplierResult.riskLevel === 'medium' ? 'var(--accent-orange)' : 'var(--accent-red)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">風險等級</div><div className="stat-card-value">{supplierResult.riskLevel}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">綜合評分</div><div className="stat-card-value">{supplierResult.overallScore}/100</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
              <div className="stat-card-label">準時率</div><div className="stat-card-value">{supplierResult.metrics?.onTimeRate || 0}%</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">品質合格率</div><div className="stat-card-value">{supplierResult.metrics?.qualityPassRate || 0}%</div>
            </div>
          </div>
          {(supplierResult.riskFactors || []).length > 0 && (
            <ResultCard title="風險因子">
              {supplierResult.riskFactors.map((rf, i) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--glass-light)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Badge color={rf.severity}>{rf.severity}</Badge>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{rf.factor}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{rf.detail}</div>
                  <div style={{ fontSize: 12, color: 'var(--accent-green)', marginTop: 2 }}>緩解：{rf.mitigation}</div>
                </div>
              ))}
            </ResultCard>
          )}
          <ResultCard title="建議"><p style={{ fontSize: 13 }}>{supplierResult.recommendation}</p></ResultCard>
        </>
      )}
      {supplierResult?.raw && <ResultCard title="結果"><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{supplierResult.raw}</pre></ResultCard>}
    </div>
  )
}
