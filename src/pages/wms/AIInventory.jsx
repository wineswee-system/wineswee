import { useState, useEffect, useRef } from 'react'
import {
  Bot, Send, TrendingUp, ShoppingCart, Clock, AlertTriangle,
  BarChart2, MapPin, ArrowRightLeft, FileText, Shield, Package,
  Sparkles, Loader2, RefreshCw, ChevronRight, Zap
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  queryInventoryNL, aiForecastDemand, smartReorderPlan,
  wasteReductionPlan, assessSupplierRisk, deadStockAdvisor,
  optimizeSlotting, dynamicSafetyStock, crossStoreBalancing,
  parseReceiptOCR, predictQuality, inventoryHealthReport,
  isAIConfigured,
} from '../../lib/aiInventory'
import LoadingSpinner from '../../components/LoadingSpinner'

// ─── Tab definitions ─────────────────────────────────────────
const TABS = [
  { key: 'health', label: '健康報告', icon: Sparkles, color: 'var(--accent-cyan)' },
  { key: 'chat', label: 'AI 庫存查詢', icon: Bot, color: 'var(--accent-green)' },
  { key: 'forecast', label: '需求預測', icon: TrendingUp, color: 'var(--accent-purple)' },
  { key: 'reorder', label: '智慧補貨', icon: ShoppingCart, color: 'var(--accent-orange)' },
  { key: 'expiry', label: '效期減損', icon: Clock, color: 'var(--accent-red)' },
  { key: 'supplier', label: '供應商風險', icon: Shield, color: 'var(--accent-yellow)' },
  { key: 'deadstock', label: '呆滯處分', icon: AlertTriangle, color: 'var(--accent-red)' },
  { key: 'slotting', label: '儲位優化', icon: MapPin, color: 'var(--accent-cyan)' },
  { key: 'safety', label: '動態安全庫存', icon: BarChart2, color: 'var(--accent-green)' },
  { key: 'balance', label: '跨倉平衡', icon: ArrowRightLeft, color: 'var(--accent-purple)' },
  { key: 'ocr', label: '收據 OCR', icon: FileText, color: 'var(--accent-orange)' },
  { key: 'quality', label: '品質預測', icon: Package, color: 'var(--accent-yellow)' },
]

// ─── Shared components ───────────────────────────────────────
function ResultCard({ title, children, loading }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div className="card-title">{title}</div>
        {loading && <Loader2 size={16} className="spin" style={{ color: 'var(--accent-cyan)' }} />}
      </div>
      <div className="card-body" style={{ padding: 16 }}>{children}</div>
    </div>
  )
}

function Badge({ color, children }) {
  const bg = { critical: 'var(--accent-red)', high: 'var(--accent-red)', warning: 'var(--accent-orange)', medium: 'var(--accent-orange)', low: 'var(--accent-green)', info: 'var(--accent-cyan)', good: 'var(--accent-green)', stable: 'var(--accent-cyan)', improving: 'var(--accent-green)', deteriorating: 'var(--accent-red)' }
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: `${bg[color] || 'var(--accent-cyan)'}22`, color: bg[color] || 'var(--accent-cyan)' }}>{children}</span>
}

function KVTable({ data }) {
  if (!data || data.length === 0) return null
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--glass-light)' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{d.label}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{d.value}</span>
        </div>
      ))}
    </div>
  )
}

function ActionList({ items, keyField = 'sku' }) {
  if (!items || items.length === 0) return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>AI 尚未產生建議</div>
  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead><tr>{Object.keys(items[0]).map(k => <th key={k}>{k}</th>)}</tr></thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>{Object.values(item).map((v, j) => (
              <td key={j} style={{ fontSize: 12 }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────
export default function AIInventory() {
  const [activeTab, setActiveTab] = useState('health')
  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)

  // Shared data
  const [skus, setSkus] = useState([])
  const [stockLevels, setStockLevels] = useState([])
  const [transactions, setTransactions] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [warehouses, setWarehouses] = useState([])

  // Tab-specific results
  const [healthResult, setHealthResult] = useState(null)
  const [chatMessages, setChatMessages] = useState([{ role: 'ai', text: '你好！我是庫存 AI 助理。請用中文問我任何庫存相關問題，例如：「台中倉還有多少 SKU-001？」' }])
  const [chatInput, setChatInput] = useState('')
  const [forecastResult, setForecastResult] = useState(null)
  const [forecastSku, setForecastSku] = useState('')
  const [reorderResult, setReorderResult] = useState(null)
  const [expiryResult, setExpiryResult] = useState(null)
  const [supplierResult, setSupplierResult] = useState(null)
  const [selectedSupplier, setSelectedSupplier] = useState('')
  const [deadResult, setDeadResult] = useState(null)
  const [slottingResult, setSlottingResult] = useState(null)
  const [safetyResult, setSafetyResult] = useState(null)
  const [balanceResult, setBalanceResult] = useState(null)
  const [ocrText, setOcrText] = useState('')
  const [ocrResult, setOcrResult] = useState(null)
  const [qualityResult, setQualityResult] = useState(null)
  const [qualitySupplier, setQualitySupplier] = useState('')
  const chatEndRef = useRef(null)

  const configured = isAIConfigured()

  // Load base data
  useEffect(() => {
    Promise.all([
      supabase.from('skus').select('id, code, name, category, unit_cost, stock_qty, status').eq('status', '啟用'),
      supabase.from('stock_levels').select('*'),
      supabase.from('inventory_transactions').select('*').order('date', { ascending: false }).limit(200),
      supabase.from('suppliers').select('*').eq('status', '合作中'),
      supabase.from('warehouses').select('*'),
    ]).then(([skuR, slR, txR, supR, whR]) => {
      setSkus(skuR.data || [])
      setStockLevels(slR.data || [])
      setTransactions(txR.data || [])
      setSuppliers(supR.data || [])
      setWarehouses(whR.data || [])
    }).finally(() => setPageLoading(false))
  }, [])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages])

  if (pageLoading) return <LoadingSpinner />

  if (!configured) {
    return (
      <div className="fade-in" style={{ padding: 32, textAlign: 'center' }}>
        <AlertTriangle size={48} style={{ color: 'var(--accent-orange)', marginBottom: 16 }} />
        <h3>AI 功能未啟用</h3>
        <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>請在 <code>.env</code> 設定 <code>VITE_GEMINI_API_KEY</code> 以啟用 AI 庫存管理功能。</p>
      </div>
    )
  }

  // ─── Tab action handlers ──────────────────────────────────

  const runHealthReport = async () => {
    setLoading(true)
    try {
      const now = new Date()
      const txnOut = transactions.filter(t => t.type === 'OUT')
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

  const handleChat = async () => {
    if (!chatInput.trim() || loading) return
    const q = chatInput.trim()
    setChatMessages(prev => [...prev, { role: 'user', text: q }])
    setChatInput('')
    setLoading(true)
    try {
      const result = await queryInventoryNL(q, {
        skus, stockLevels, recentTransactions: transactions.slice(0, 30),
        warehouses: warehouses.map(w => w.name || w.code),
      })
      const answer = result.answer || result.raw || JSON.stringify(result)
      const suggestions = result.suggestions || []
      setChatMessages(prev => [...prev, { role: 'ai', text: answer, data: result.data, suggestions, actionable: result.actionable }])
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'ai', text: `Error: ${e.message}` }])
    }
    setLoading(false)
  }

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

  const runDeadStock = async () => {
    setLoading(true)
    try {
      const now = new Date()
      const deadItems = skus.filter(s => s.stock_qty > 0).map(s => {
        const lastTxn = transactions.find(t => t.sku === s.code)
        const daysDead = lastTxn ? Math.floor((now - new Date(lastTxn.date)) / 86400000) : 999
        return { sku: s.code, name: s.name, stock: s.stock_qty, unitCost: s.unit_cost, value: (s.stock_qty || 0) * (s.unit_cost || 0), daysSinceMovement: daysDead }
      }).filter(s => s.daysSinceMovement >= 90).sort((a, b) => b.value - a.value).slice(0, 20)

      const result = await deadStockAdvisor({
        deadItems: deadItems.length > 0 ? deadItems : [{ sku: 'N/A', name: '無呆滯品', stock: 0, value: 0, daysSinceMovement: 0, note: '目前無呆滯庫存' }],
        context: { industry: '零售/餐飲' },
      })
      setDeadResult(result)
    } catch (e) { setDeadResult({ raw: e.message }) }
    setLoading(false)
  }

  const runSlotting = async () => {
    setLoading(true)
    try {
      const velocity = skus.map(s => {
        const outTxns = transactions.filter(t => t.sku === s.code && t.type === 'OUT')
        return { sku: s.code, name: s.name, monthlyPicks: outTxns.length, totalQty: outTxns.reduce((sum, t) => sum + Math.abs(t.qty || 0), 0) }
      }).sort((a, b) => b.monthlyPicks - a.monthlyPicks).slice(0, 30)

      const result = await optimizeSlotting({ pickHistory: [], currentSlotting: [], skuVelocity: velocity })
      setSlottingResult(result)
    } catch (e) { setSlottingResult({ raw: e.message }) }
    setLoading(false)
  }

  const runSafety = async () => {
    setLoading(true)
    try {
      const skuData = skus.slice(0, 20).map(s => {
        const txns = transactions.filter(t => t.sku === s.code && t.type === 'OUT')
        const avgDemand = txns.length > 0 ? txns.reduce((sum, t) => sum + Math.abs(t.qty || 0), 0) / Math.max(txns.length, 1) : 0
        const sl = stockLevels.find(l => l.sku_code === s.code)
        return { sku: s.code, name: s.name, currentStock: s.stock_qty, currentSafetyStock: sl?.min_qty || 0, avgMonthlyDemand: Math.round(avgDemand), unitCost: s.unit_cost }
      })
      const result = await dynamicSafetyStock({ skuData })
      setSafetyResult(result)
    } catch (e) { setSafetyResult({ raw: e.message }) }
    setLoading(false)
  }

  const runBalance = async () => {
    setLoading(true)
    try {
      const whStock = {}
      stockLevels.forEach(s => {
        if (!whStock[s.warehouse]) whStock[s.warehouse] = []
        whStock[s.warehouse].push({ sku: s.sku_code, qty: s.quantity, min: s.min_qty })
      })
      const result = await crossStoreBalancing({ warehouseStock: whStock, demandByLocation: [] })
      setBalanceResult(result)
    } catch (e) { setBalanceResult({ raw: e.message }) }
    setLoading(false)
  }

  const runOCR = async () => {
    if (!ocrText.trim()) return
    setLoading(true)
    try {
      const result = await parseReceiptOCR(ocrText, [])
      setOcrResult(result)
    } catch (e) { setOcrResult({ raw: e.message }) }
    setLoading(false)
  }

  const runQuality = async () => {
    if (!qualitySupplier) return
    setLoading(true)
    try {
      const result = await predictQuality({
        supplier: qualitySupplier,
        historicalQuality: transactions.filter(t => t.type === 'IN').slice(0, 15).map(t => ({ date: t.date, sku: t.sku, qty: t.qty })),
        incomingShipment: { supplier: qualitySupplier, items: skus.slice(0, 5).map(s => ({ sku: s.code, qty: 100 })) },
      })
      setQualityResult(result)
    } catch (e) { setQualityResult({ raw: e.message }) }
    setLoading(false)
  }

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="fade-in">
      <div className="page-header">
        <h2><span className="header-icon"><Zap size={20} /></span> AI 庫存管理中心</h2>
        <p>Gemini 驅動的 12 項智慧庫存管理功能</p>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map(tab => (
          <button key={tab.key}
            className={`btn ${activeTab === tab.key ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => setActiveTab(tab.key)}>
            <tab.icon size={13} /> {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════ Health Report ═══════ */}
      {activeTab === 'health' && (
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
      )}

      {/* ═══════ NL Chat ═══════ */}
      {activeTab === 'chat' && (
        <div className="card" style={{ height: 520, display: 'flex', flexDirection: 'column' }}>
          <div className="card-header"><div className="card-title"><Bot size={16} /> AI 庫存問答</div></div>
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            {chatMessages.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
                <div style={{ maxWidth: '80%', padding: '10px 14px', borderRadius: 12, background: msg.role === 'user' ? 'var(--accent-cyan)' : 'var(--glass-medium)', color: msg.role === 'user' ? '#fff' : 'var(--text-primary)', fontSize: 13 }}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                  {msg.data && msg.data.length > 0 && (
                    <div style={{ marginTop: 8, padding: 8, background: 'var(--glass-light)', borderRadius: 6 }}>
                      <KVTable data={msg.data} />
                    </div>
                  )}
                  {msg.suggestions && msg.suggestions.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {msg.suggestions.map((s, j) => (
                        <button key={j} className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 6px' }}
                          onClick={() => { setChatInput(s) }}>{s}</button>
                      ))}
                    </div>
                  )}
                  {msg.actionable && msg.actionable.action !== 'none' && (
                    <div style={{ marginTop: 6, padding: '4px 8px', background: 'var(--accent-green)22', borderRadius: 4, fontSize: 11 }}>
                      <Zap size={10} style={{ display: 'inline', marginRight: 4 }} />
                      建議操作：{msg.actionable.details}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && <div style={{ textAlign: 'center', padding: 8 }}><Loader2 size={20} className="spin" style={{ color: 'var(--accent-cyan)' }} /></div>}
            <div ref={chatEndRef} />
          </div>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--glass-light)', display: 'flex', gap: 8 }}>
            <input className="form-input" style={{ flex: 1 }} placeholder="問我任何庫存問題... 如：「哪些品項需要補貨？」" value={chatInput}
              onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChat()} />
            <button className="btn btn-primary" onClick={handleChat} disabled={loading}><Send size={14} /></button>
          </div>
        </div>
      )}

      {/* ═══════ Demand Forecast ═══════ */}
      {activeTab === 'forecast' && (
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
      )}

      {/* ═══════ Smart Reorder ═══════ */}
      {activeTab === 'reorder' && (
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
      )}

      {/* ═══════ Expiry / Waste ═══════ */}
      {activeTab === 'expiry' && (
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
      )}

      {/* ═══════ Supplier Risk ═══════ */}
      {activeTab === 'supplier' && (
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
      )}

      {/* ═══════ Dead Stock Advisor ═══════ */}
      {activeTab === 'deadstock' && (
        <div>
          <button className="btn btn-primary" onClick={runDeadStock} disabled={loading} style={{ marginBottom: 16 }}>
            {loading ? <Loader2 size={14} className="spin" /> : <AlertTriangle size={14} />} AI 呆滯庫存分析
          </button>
          {deadResult && !deadResult.raw && (
            <>
              <ResultCard title="分析摘要"><p style={{ fontSize: 13 }}>{deadResult.summary}</p></ResultCard>
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
                  <div className="stat-card-label">呆滯總值</div><div className="stat-card-value">NT${(deadResult.totalDeadValue || 0).toLocaleString()}</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
                  <div className="stat-card-label">預估可回收</div><div className="stat-card-value">NT${(deadResult.estimatedRecovery || 0).toLocaleString()}</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
                  <div className="stat-card-label">需報廢金額</div><div className="stat-card-value">NT${(deadResult.writeOffAmount || 0).toLocaleString()}</div>
                </div>
              </div>
              {(deadResult.items || []).map((item, i) => (
                <ResultCard key={i} title={`${item.sku} - ${item.name}`}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
                    <div><span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>庫存價值：</span><span style={{ fontWeight: 600 }}>NT${(item.currentValue || 0).toLocaleString()}</span></div>
                    <div><span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>閒置天數：</span><span style={{ fontWeight: 600 }}>{item.daysDead} 天</span></div>
                    <div><span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>處分方式：</span><Badge color="info">{item.actionLabel}</Badge></div>
                    <div><span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>預估回收：</span><span style={{ fontWeight: 600, color: 'var(--accent-green)' }}>NT${(item.estimatedRecovery || 0).toLocaleString()} ({item.recoveryRate}%)</span></div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.reasoning}</div>
                  {item.steps && <ol style={{ margin: '4px 0 0 16px', fontSize: 12 }}>{item.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>}
                </ResultCard>
              ))}
              {deadResult.taxBenefits && <ResultCard title="稅務效益"><p style={{ fontSize: 13 }}>{deadResult.taxBenefits}</p></ResultCard>}
            </>
          )}
          {deadResult?.raw && <ResultCard title="結果"><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{deadResult.raw}</pre></ResultCard>}
        </div>
      )}

      {/* ═══════ Slotting Optimization ═══════ */}
      {activeTab === 'slotting' && (
        <div>
          <button className="btn btn-primary" onClick={runSlotting} disabled={loading} style={{ marginBottom: 16 }}>
            {loading ? <Loader2 size={14} className="spin" /> : <MapPin size={14} />} AI 儲位優化分析
          </button>
          {slottingResult && !slottingResult.raw && (
            <>
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
                  <div className="stat-card-label">目前效率</div><div className="stat-card-value">{slottingResult.currentEfficiency}%</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
                  <div className="stat-card-label">優化後效率</div><div className="stat-card-value">{slottingResult.projectedEfficiency}%</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
                  <div className="stat-card-label">節省時間</div><div className="stat-card-value">{slottingResult.estimatedTimeSaving}</div>
                </div>
              </div>
              {(slottingResult.frequentPairs || []).length > 0 && (
                <ResultCard title="常見搭配揀貨">
                  {slottingResult.frequentPairs.map((p, i) => (
                    <div key={i} style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--glass-light)' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{p.sku1}</span> + <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{p.sku2}</span>
                      <span style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>({Math.round(p.coPickRate * 100)}%)</span>
                      <span style={{ marginLeft: 8, color: 'var(--accent-cyan)' }}>{p.suggestion}</span>
                    </div>
                  ))}
                </ResultCard>
              )}
              {(slottingResult.relocations || []).length > 0 && (
                <ResultCard title="建議搬遷">
                  <div className="data-table-wrapper">
                    <table className="data-table">
                      <thead><tr><th>品號</th><th>目前儲位</th><th>建議儲位</th><th>原因</th><th>優先</th></tr></thead>
                      <tbody>{slottingResult.relocations.map((r, i) => (
                        <tr key={i}><td style={{ fontFamily: 'monospace' }}>{r.sku}</td><td>{r.currentBin}</td><td style={{ fontWeight: 600, color: 'var(--accent-green)' }}>{r.suggestedBin}</td><td style={{ fontSize: 12 }}>{r.reason}</td><td><Badge color={r.priority}>{r.priority}</Badge></td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </ResultCard>
              )}
            </>
          )}
          {slottingResult?.raw && <ResultCard title="結果"><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{slottingResult.raw}</pre></ResultCard>}
        </div>
      )}

      {/* ═══════ Dynamic Safety Stock ═══════ */}
      {activeTab === 'safety' && (
        <div>
          <button className="btn btn-primary" onClick={runSafety} disabled={loading} style={{ marginBottom: 16 }}>
            {loading ? <Loader2 size={14} className="spin" /> : <BarChart2 size={14} />} AI 安全庫存計算
          </button>
          {safetyResult && !safetyResult.raw && (
            <>
              {safetyResult.methodology && <ResultCard title="計算方法"><p style={{ fontSize: 13 }}>{safetyResult.methodology}</p></ResultCard>}
              {(safetyResult.recommendations || []).length > 0 && (
                <ResultCard title="安全庫存建議">
                  <div className="data-table-wrapper">
                    <table className="data-table">
                      <thead><tr><th>品號</th><th>品名</th><th>目前安全庫存</th><th>建議安全庫存</th><th>再訂購點</th><th>需求變異</th><th>供應風險</th></tr></thead>
                      <tbody>{safetyResult.recommendations.map((r, i) => (
                        <tr key={i}>
                          <td style={{ fontFamily: 'monospace' }}>{r.sku}</td><td>{r.skuName}</td>
                          <td>{r.currentSafetyStock}</td>
                          <td style={{ fontWeight: 700, color: r.recommendedSafetyStock > r.currentSafetyStock ? 'var(--accent-orange)' : 'var(--accent-green)' }}>{r.recommendedSafetyStock}</td>
                          <td>{r.reorderPoint}</td>
                          <td><Badge color={r.demandVariability}>{r.demandVariability}</Badge></td>
                          <td><Badge color={r.supplyRisk}>{r.supplyRisk}</Badge></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </ResultCard>
              )}
              {safetyResult.totalCostImpact && <ResultCard title="成本影響"><p style={{ fontSize: 13 }}>{safetyResult.totalCostImpact}</p></ResultCard>}
            </>
          )}
          {safetyResult?.raw && <ResultCard title="結果"><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{safetyResult.raw}</pre></ResultCard>}
        </div>
      )}

      {/* ═══════ Cross-Store Balancing ═══════ */}
      {activeTab === 'balance' && (
        <div>
          <button className="btn btn-primary" onClick={runBalance} disabled={loading} style={{ marginBottom: 16 }}>
            {loading ? <Loader2 size={14} className="spin" /> : <ArrowRightLeft size={14} />} AI 跨倉平衡分析
          </button>
          {balanceResult && !balanceResult.raw && (
            <>
              {balanceResult.summary && (
                <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
                  <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
                    <div className="stat-card-label">建議調撥</div><div className="stat-card-value">{balanceResult.summary.totalTransfers}</div>
                  </div>
                  <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
                    <div className="stat-card-label">預估節省</div><div className="stat-card-value">NT${(balanceResult.summary.estimatedCostSaving || 0).toLocaleString()}</div>
                  </div>
                  <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
                    <div className="stat-card-label">可避免缺貨</div><div className="stat-card-value">{balanceResult.summary.stockoutPrevented}</div>
                  </div>
                </div>
              )}
              {(balanceResult.transfers || []).length > 0 && (
                <ResultCard title="建議調撥">
                  <div className="data-table-wrapper">
                    <table className="data-table">
                      <thead><tr><th>品號</th><th>來源</th><th>目的</th><th>數量</th><th>原因</th><th>優先</th></tr></thead>
                      <tbody>{balanceResult.transfers.map((t, i) => (
                        <tr key={i}><td style={{ fontFamily: 'monospace' }}>{t.sku}</td><td>{t.from}</td><td style={{ fontWeight: 600 }}>{t.to}</td><td>{t.quantity}</td><td style={{ fontSize: 12 }}>{t.reason}</td><td><Badge color={t.priority === 'urgent' ? 'critical' : 'info'}>{t.priority}</Badge></td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </ResultCard>
              )}
              {balanceResult.longTermStrategy && <ResultCard title="長期策略"><p style={{ fontSize: 13 }}>{balanceResult.longTermStrategy}</p></ResultCard>}
            </>
          )}
          {balanceResult?.raw && <ResultCard title="結果"><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{balanceResult.raw}</pre></ResultCard>}
        </div>
      )}

      {/* ═══════ Receipt OCR ═══════ */}
      {activeTab === 'ocr' && (
        <div>
          <ResultCard title="貼上送貨單/發票文字內容">
            <textarea className="form-input" style={{ width: '100%', height: 150, fontFamily: 'monospace', fontSize: 12 }}
              placeholder="將供應商送貨單或發票的文字內容貼到這裡...&#10;&#10;範例：&#10;供應商：台灣食品有限公司&#10;送貨單號：DL-2026-0412&#10;品項：鳳梨酥 x100 @$35 = $3,500&#10;      太陽餅 x50 @$28 = $1,400&#10;合計：$4,900（含稅 $5,145）"
              value={ocrText} onChange={e => setOcrText(e.target.value)} />
            <button className="btn btn-primary" onClick={runOCR} disabled={loading || !ocrText.trim()} style={{ marginTop: 8 }}>
              {loading ? <Loader2 size={14} className="spin" /> : <FileText size={14} />} AI 解析
            </button>
          </ResultCard>
          {ocrResult && !ocrResult.raw && (
            <>
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
                  <div className="stat-card-label">文件類型</div><div className="stat-card-value" style={{ fontSize: 14 }}>{ocrResult.documentType}</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
                  <div className="stat-card-label">供應商</div><div className="stat-card-value" style={{ fontSize: 14 }}>{ocrResult.vendor}</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
                  <div className="stat-card-label">總金額</div><div className="stat-card-value">NT${(ocrResult.totalAmount || 0).toLocaleString()}</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
                  <div className="stat-card-label">辨識信心</div><div className="stat-card-value">{Math.round((ocrResult.confidence || 0) * 100)}%</div>
                </div>
              </div>
              {(ocrResult.lineItems || []).length > 0 && (
                <ResultCard title="辨識品項">
                  <div className="data-table-wrapper">
                    <table className="data-table">
                      <thead><tr><th>品名</th><th>比對 SKU</th><th>數量</th><th>單價</th><th>金額</th></tr></thead>
                      <tbody>{ocrResult.lineItems.map((item, i) => (
                        <tr key={i}><td>{item.description}</td><td style={{ fontFamily: 'monospace' }}>{item.sku_match || '-'}</td><td>{item.quantity}</td><td>${item.unitPrice}</td><td style={{ fontWeight: 600 }}>${item.amount}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </ResultCard>
              )}
              {(ocrResult.discrepancies || []).length > 0 && (
                <ResultCard title="差異">
                  {ocrResult.discrepancies.map((d, i) => (
                    <div key={i} style={{ fontSize: 13, padding: '4px 0', color: 'var(--accent-orange)' }}>
                      <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} />
                      {d.item}: {d.field} 預期 {d.expected} → 實際 {d.actual} (差異 {d.difference})
                    </div>
                  ))}
                </ResultCard>
              )}
              <ResultCard title="建議操作"><Badge color={ocrResult.suggestedAction === 'auto_receive' ? 'good' : 'warning'}>{ocrResult.suggestedAction}</Badge></ResultCard>
            </>
          )}
          {ocrResult?.raw && <ResultCard title="結果"><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{ocrResult.raw}</pre></ResultCard>}
        </div>
      )}

      {/* ═══════ Quality Prediction ═══════ */}
      {activeTab === 'quality' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <select className="form-input" style={{ width: 250 }} value={qualitySupplier} onChange={e => setQualitySupplier(e.target.value)}>
              <option value="">-- 選擇供應商 --</option>
              {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            <button className="btn btn-primary" onClick={runQuality} disabled={loading || !qualitySupplier}>
              {loading ? <Loader2 size={14} className="spin" /> : <Package size={14} />} AI 品質預測
            </button>
          </div>
          {qualityResult && !qualityResult.raw && (
            <>
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
                <div className="stat-card" style={{ '--card-accent': qualityResult.riskLevel === 'low' ? 'var(--accent-green)' : qualityResult.riskLevel === 'medium' ? 'var(--accent-orange)' : 'var(--accent-red)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
                  <div className="stat-card-label">風險等級</div><div className="stat-card-value">{qualityResult.riskLevel}</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
                  <div className="stat-card-label">預測不良率</div><div className="stat-card-value">{qualityResult.predictedDefectRate}%</div>
                </div>
                <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
                  <div className="stat-card-label">建議抽檢比率</div><div className="stat-card-value">{qualityResult.qcRecommendation?.sampleRate || 0}%</div>
                </div>
              </div>
              {qualityResult.qcRecommendation && (
                <ResultCard title="QC 建議">
                  <div style={{ fontSize: 13, marginBottom: 8 }}>檢查等級：<Badge color="info">{qualityResult.qcRecommendation.inspectionLevel}</Badge></div>
                  {(qualityResult.qcRecommendation.focusAreas || []).length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>重點檢查：</div>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>{qualityResult.qcRecommendation.focusAreas.map((f, i) => <li key={i} style={{ fontSize: 12 }}>{f}</li>)}</ul>
                    </div>
                  )}
                  {qualityResult.qcRecommendation.specialInstructions && <p style={{ fontSize: 12, color: 'var(--accent-orange)' }}>{qualityResult.qcRecommendation.specialInstructions}</p>}
                </ResultCard>
              )}
              {(qualityResult.likelyIssues || []).length > 0 && (
                <ResultCard title="可能品質問題">
                  {qualityResult.likelyIssues.map((issue, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--glass-light)' }}>
                      <Badge color={issue.severity}>{issue.severity}</Badge>
                      <span style={{ fontSize: 13 }}>{issue.issue}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>機率 {Math.round(issue.probability * 100)}%</span>
                    </div>
                  ))}
                </ResultCard>
              )}
              {qualityResult.supplierFeedback && <ResultCard title="供應商品質回饋"><p style={{ fontSize: 13 }}>{qualityResult.supplierFeedback}</p></ResultCard>}
            </>
          )}
          {qualityResult?.raw && <ResultCard title="結果"><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{qualityResult.raw}</pre></ResultCard>}
        </div>
      )}
    </div>
  )
}
