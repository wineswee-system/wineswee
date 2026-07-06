import { useMemo, useState } from 'react'
import { ShoppingCart, Loader2, Save, Wand2, Check } from 'lucide-react'
import { useTenant } from '../../../contexts/TenantContext'
import { smartReorderPlan } from '../../../lib/aiInventory'
import { aggregateDemand, calculateSafetyStock, calculateReorderPoint } from '../../../lib/demandForecast'
import { getSkuSafetyStocks, bulkUpdateSkuSafetyStock, mapSafetyStockFields } from '../../../lib/db/safetyStock'
import { useDbQuery } from '../../../lib/hooks/useDbQuery'
import { queryClient } from '../../../lib/queryClient'
import { logger } from '../../../lib/logger'
import Badge from '../../../components/ui/Badge'
import { ResultCard } from './AIInventoryHelpers'

const FIELDS = ['safety_stock', 'reorder_point', 'reorder_qty']
const DEFAULT_LEAD_TIME_DAYS = 7
const REORDER_COVER_DAYS = 14 // 建議訂購量 = 平均日需求 × 14 天

/** 由出庫交易推導單一 SKU 的建議值（demandForecast 公式） */
function suggestForSku(txns, leadTimeDays) {
  const daily = aggregateDemand(txns, 'daily')
  if (daily.length === 0) return null
  const demands = daily.map(d => d.demand)
  const avg = demands.reduce((s, v) => s + v, 0) / demands.length
  const stdDev = Math.sqrt(demands.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / demands.length)
  const safety = calculateSafetyStock(stdDev, leadTimeDays)
  const rop = calculateReorderPoint(avg, leadTimeDays, safety)
  return {
    safety_stock: Math.round(safety),
    reorder_point: Math.round(rop),
    reorder_qty: Math.max(1, Math.round(avg * REORDER_COVER_DAYS)),
  }
}

export default function ReorderTab({ stockLevels, suppliers, transactions = [] }) {
  const { tenant } = useTenant()
  const orgId = tenant?.organization_id

  // ── 安全存量持久化（F-C3.3）──
  const { data: skus = [], isLoading: skusLoading } = useDbQuery(
    ['org', orgId, 'skuSafetyStocks'],
    () => getSkuSafetyStocks(orgId).then(r => { if (r.error) throw r.error; return r.data ?? [] }),
    { enabled: !!orgId }
  )

  const [edits, setEdits] = useState({})        // { [skuId]: { safety_stock, reorder_point, reorder_qty } }
  const [leadTime, setLeadTime] = useState(DEFAULT_LEAD_TIME_DAYS)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)  // { ok: boolean, text: string }

  // demandForecast 建議值（依出庫交易，前置時間可調）
  const suggestions = useMemo(() => {
    const bySku = {}
    for (const s of skus) {
      const txns = transactions.filter(t => t.sku === s.code && t.type === 'OUT')
      bySku[s.id] = suggestForSku(txns, leadTime)
    }
    return bySku
  }, [skus, transactions, leadTime])

  const getValue = (sku, field) => {
    const edited = edits[sku.id]?.[field]
    if (edited !== undefined) return edited
    return sku[field] ?? ''
  }

  const setValue = (skuId, field, value) => {
    setSaveMsg(null)
    setEdits(prev => ({ ...prev, [skuId]: { ...prev[skuId], [field]: value } }))
  }

  const applySuggestion = (sku) => {
    const sug = suggestions[sku.id]
    if (!sug) return
    setSaveMsg(null)
    setEdits(prev => ({ ...prev, [sku.id]: { ...prev[sku.id], ...sug } }))
  }

  const applyAllSuggestions = () => {
    setSaveMsg(null)
    setEdits(prev => {
      const next = { ...prev }
      for (const s of skus) {
        if (suggestions[s.id]) next[s.id] = { ...next[s.id], ...suggestions[s.id] }
      }
      return next
    })
  }

  // 有異動（與 DB 值不同）的列
  const dirtyRows = useMemo(() => {
    return skus
      .filter(s => edits[s.id])
      .map(s => ({ id: s.id, ...mapSafetyStockFields({ ...s, ...edits[s.id] }) }))
      .filter(row => {
        const orig = mapSafetyStockFields(skus.find(s => s.id === row.id) || {})
        return FIELDS.some(f => row[f] !== orig[f])
      })
  }, [skus, edits])

  const saveAll = async () => {
    if (dirtyRows.length === 0) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const { error } = await bulkUpdateSkuSafetyStock(dirtyRows, orgId)
      if (error) throw error
      setEdits({})
      queryClient.invalidateQueries({ queryKey: ['org', orgId, 'skuSafetyStocks'] })
      setSaveMsg({ ok: true, text: `已儲存 ${dirtyRows.length} 筆安全存量設定` })
    } catch (e) {
      logger.error('Safety stock save failed', { module: 'wms', error: e.message })
      setSaveMsg({ ok: false, text: `儲存失敗：${e.message}` })
    }
    setSaving(false)
  }

  // ── AI 智慧補貨（既有功能保留）──
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
      {/* ═══════ 安全存量設定（持久化至 skus）═══════ */}
      <ResultCard title="安全存量設定">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            前置時間（天）
            <input className="form-input" type="number" min={1} max={90} value={leadTime}
              style={{ width: 64, marginLeft: 6, padding: '2px 6px' }}
              onChange={e => setLeadTime(Math.max(1, Number(e.target.value) || DEFAULT_LEAD_TIME_DAYS))} />
          </label>
          <button className="btn btn-secondary" onClick={applyAllSuggestions} disabled={skusLoading}>
            <Wand2 size={14} /> 一鍵套用全部建議
          </button>
          <button className="btn btn-primary" onClick={saveAll} disabled={saving || dirtyRows.length === 0}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} 儲存變更{dirtyRows.length > 0 ? `（${dirtyRows.length}）` : ''}
          </button>
          {saveMsg && (
            <Badge status={saveMsg.ok ? 'success' : 'error'} dot>{saveMsg.text}</Badge>
          )}
        </div>

        {skusLoading ? (
          <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 13 }}>
            <Loader2 size={14} className="spin" style={{ display: 'inline', marginRight: 6 }} /> 載入品項中…
          </div>
        ) : skus.length === 0 ? (
          <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 13 }}>尚無啟用中品項</div>
        ) : (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>品號</th><th>品名</th><th>現有庫存</th>
                  <th>安全存量</th><th>再訂購點</th><th>建議訂購量</th>
                  <th>預測建議（安全 / 再訂 / 訂購）</th><th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {skus.map(sku => {
                  const sug = suggestions[sku.id]
                  const safety = Number(getValue(sku, 'safety_stock')) || 0
                  const belowSafety = safety > 0 && Number(sku.stock_qty || 0) < safety
                  return (
                    <tr key={sku.id}>
                      <td style={{ fontFamily: 'monospace' }}>{sku.code}</td>
                      <td>{sku.name}</td>
                      <td style={{ fontWeight: 600 }}>{Number(sku.stock_qty || 0).toLocaleString()} {sku.unit}</td>
                      {FIELDS.map(f => (
                        <td key={f}>
                          <input className="form-input" type="number" min={0}
                            style={{ width: 84, padding: '2px 6px', textAlign: 'right' }}
                            value={getValue(sku, f)}
                            onChange={e => setValue(sku.id, f, e.target.value)} />
                        </td>
                      ))}
                      <td>
                        {sug ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                              {sug.safety_stock} / {sug.reorder_point} / {sug.reorder_qty}
                            </span>
                            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => applySuggestion(sku)}>
                              <Check size={11} /> 套用
                            </button>
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>無出庫紀錄</span>
                        )}
                      </td>
                      <td>
                        {belowSafety
                          ? <Badge status="warning" dot>低於安全存量</Badge>
                          : <Badge status="success" dot>正常</Badge>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </ResultCard>

      {/* ═══════ AI 智慧補貨分析（既有功能）═══════ */}
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
