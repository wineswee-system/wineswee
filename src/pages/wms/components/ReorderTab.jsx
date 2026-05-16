import { useState } from 'react'
import { ShoppingCart, Loader2 } from 'lucide-react'
import { smartReorderPlan } from '../../../lib/aiInventory'
import { ResultCard } from './AIInventoryHelpers'

export default function ReorderTab({ stockLevels, suppliers }) {
  const [loading, setLoading] = useState(false)
  const [reorderResult, setReorderResult] = useState(null)

  const runReorder = async () => {
    setLoading(true)
    try {
      const lowItems = stockLevels.filter(s => s.quantity <= s.min_qty && s.min_qty > 0).map(s => ({
        sku: s.sku_code, warehouse: s.warehouse, currentStock: s.quantity, minQty: s.min_qty, urgency: s.quantity <= 0 ? 'critical' : 'warning',
      }))
      const result = await smartReorderPlan({
        alerts: lowItems.length > 0 ? lowItems : [{ sku: 'N/A', currentStock: 0, minQty: 10, urgency: 'info', note: '目前無低庫存品項' }],
        suppliers: suppliers.slice(0, 10).map(s => ({ name: s.name, rating: s.rating, paymentTerms: s.payment_terms })),
        constraints: {},
      })
      setReorderResult(result)
    } catch (e) { setReorderResult({ raw: e.message }) }
    setLoading(false)
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={runReorder} disabled={loading} style={{ marginBottom: 16 }}>
        {loading ? <Loader2 size={14} className="spin" /> : <ShoppingCart size={14} />} AI 智慧補貨分析
      </button>
      {reorderResult && !reorderResult.raw && (
        <>
          <ResultCard title="策略摘要"><p style={{ fontSize: 13 }}>{reorderResult.strategy}</p></ResultCard>
          {reorderResult.savings && (
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
              <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
                <div className="stat-card-label">採購單數</div><div className="stat-card-value">{(reorderResult.purchaseOrders || []).length}</div>
              </div>
              <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
                <div className="stat-card-label">總金額</div><div className="stat-card-value">NT${(reorderResult.totalBudgetUsed || 0).toLocaleString()}</div>
              </div>
              <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
                <div className="stat-card-label">預估節省</div><div className="stat-card-value">NT${(reorderResult.savings?.amount || 0).toLocaleString()}</div>
              </div>
            </div>
          )}
          {(reorderResult.purchaseOrders || []).map((po, i) => (
            <ResultCard key={i} title={`${po.supplier} — ${po.priority === 'urgent' ? '緊急' : '一般'}`}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>預計到貨：{po.expectedDelivery} | {po.paymentTerms} | NT${(po.totalAmount || 0).toLocaleString()}</div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>品號</th><th>數量</th><th>單價</th><th>金額</th></tr></thead>
                  <tbody>{(po.items || []).map((item, j) => (
                    <tr key={j}><td style={{ fontFamily: 'monospace' }}>{item.sku}</td><td>{item.qty}</td><td>${item.unitCost}</td><td style={{ fontWeight: 600 }}>${item.amount}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </ResultCard>
          ))}
        </>
      )}
      {reorderResult?.raw && <ResultCard title="結果"><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{reorderResult.raw}</pre></ResultCard>}
    </div>
  )
}
