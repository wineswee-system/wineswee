import { useState, useEffect } from 'react'
import { Link2, TrendingUp, Users, Package, Factory, ShoppingBag, AlertTriangle, Clock, DollarSign, Truck, Download, RefreshCw } from 'lucide-react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler, RadialLinearScale } from 'chart.js'
import { Bar, Doughnut, Line, Radar } from 'react-chartjs-2'
import {
  analyzeProductProfitability,
  analyzeSupplyChainRisk,
  analyzeLaborCostPerUnit,
  analyzePromotionROI,
  analyzeWorkflowBusinessOutcomes,
  runForecastDrivenMRP,
} from '../../lib/automation'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler, RadialLinearScale)

const colors = { cyan: '#22d3ee', blue: '#3b82f6', purple: '#a78bfa', green: '#34d399', orange: '#fb923c', red: '#f87171', pink: '#f472b6', yellow: '#fbbf24' }
const chartOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#94a3b8', font: { size: 11, weight: 600 }, padding: 12, usePointStyle: true, pointStyleWidth: 8 } },
    tooltip: { backgroundColor: 'rgba(15,23,55,0.95)', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: 'rgba(148,163,184,0.15)', borderWidth: 1, padding: 12, cornerRadius: 10 },
  },
}
const gridStyle = { color: 'rgba(148,163,184,0.06)' }
const tickStyle = { color: '#64748b', font: { size: 11 } }

const TABS = [
  { key: 'profitability', label: '產品利潤', icon: DollarSign, color: colors.green },
  { key: 'customer360', label: '客戶 360', icon: Users, color: colors.blue },
  { key: 'forecast', label: '需求預測', icon: TrendingUp, color: colors.cyan },
  { key: 'supply-risk', label: '供應鏈風險', icon: AlertTriangle, color: colors.red },
  { key: 'labor-cost', label: '人工成本', icon: Factory, color: colors.orange },
  { key: 'promo-roi', label: '促銷 ROI', icon: ShoppingBag, color: colors.pink },
  { key: 'cycle-time', label: '流程效率', icon: Clock, color: colors.purple },
]

export default function CrossSystemAnalytics() {
  const [activeTab, setActiveTab] = useState('profitability')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({})
  const [customer360Name, setCustomer360Name] = useState('')
  const [customers, setCustomers] = useState([])

  useEffect(() => {
    loadAllData()
  }, [])

  const loadAllData = async () => {
    setLoading(true)
    try {
      const [profitability, supplyRisk, laborCost, promoROI, cycleTime, forecast, custList] = await Promise.all([
        analyzeProductProfitability().catch(() => null),
        analyzeSupplyChainRisk().catch(() => null),
        analyzeLaborCostPerUnit().catch(() => null),
        analyzePromotionROI().catch(() => null),
        analyzeWorkflowBusinessOutcomes().catch(() => null),
        runForecastDrivenMRP(3).catch(() => null),
        supabase.from('customers').select('name').order('name').then(r => r.data || []),
      ])
      setData({ profitability, supplyRisk, laborCost, promoROI, cycleTime, forecast })
      setCustomers(custList)
    } catch (err) {
      console.error('Cross-system analytics load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><Link2 size={20} /></span> 跨系統深度分析</h2>
            <p>連結銷售、庫存、財務、HR、製造、CRM 的整合分析</p>
          </div>
          <button className="btn btn-primary" onClick={loadAllData}><RefreshCw size={14} /> 重新載入</button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border-medium)',
              background: activeTab === tab.key ? tab.color : 'var(--bg-card)',
              color: activeTab === tab.key ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
            }}
          >
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'profitability' && <ProfitabilityTab data={data.profitability} />}
      {activeTab === 'customer360' && <Customer360Tab customers={customers} />}
      {activeTab === 'forecast' && <ForecastTab data={data.forecast} />}
      {activeTab === 'supply-risk' && <SupplyRiskTab data={data.supplyRisk} />}
      {activeTab === 'labor-cost' && <LaborCostTab data={data.laborCost} />}
      {activeTab === 'promo-roi' && <PromoROITab data={data.promoROI} />}
      {activeTab === 'cycle-time' && <CycleTimeTab data={data.cycleTime} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  Tab 1: Product Profitability (Sales + WMS + Finance)
// ═══════════════════════════════════════════════════════════
function ProfitabilityTab({ data }) {
  if (!data) return <EmptyState msg="無利潤分析資料" />
  const { byProduct, byCustomer, summary } = data

  const topProducts = byProduct.slice(0, 10)
  const productChart = {
    labels: topProducts.map(p => p.name?.slice(0, 12) || p.code),
    datasets: [
      { label: '營收', data: topProducts.map(p => p.revenue), backgroundColor: colors.cyan + '99', borderColor: colors.cyan, borderWidth: 1 },
      { label: '成本', data: topProducts.map(p => p.cogs), backgroundColor: colors.red + '99', borderColor: colors.red, borderWidth: 1 },
    ]
  }

  const marginChart = {
    labels: topProducts.map(p => p.name?.slice(0, 12) || p.code),
    datasets: [{
      label: '毛利率 %',
      data: topProducts.map(p => p.margin),
      backgroundColor: topProducts.map(p => p.margin >= 30 ? colors.green + '99' : p.margin >= 15 ? colors.yellow + '99' : colors.red + '99'),
      borderColor: topProducts.map(p => p.margin >= 30 ? colors.green : p.margin >= 15 ? colors.yellow : colors.red),
      borderWidth: 1,
    }]
  }

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <StatCard label="總營收" value={`NT$ ${summary.totalRevenue.toLocaleString()}`} color="cyan" />
        <StatCard label="總成本" value={`NT$ ${summary.totalCogs.toLocaleString()}`} color="red" />
        <StatCard label="毛利" value={`NT$ ${summary.grossProfit.toLocaleString()}`} color="green" />
        <StatCard label="毛利率" value={`${summary.margin}%`} color="blue" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>Top 10 產品 營收 vs 成本</h4>
          <div style={{ height: 300 }}>
            <Bar data={productChart} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>產品毛利率分布</h4>
          <div style={{ height: 300 }}>
            <Bar data={marginChart} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle, max: 100 } } }} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>產品利潤明細</h4>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>產品</th><th>銷量</th><th>營收</th><th>成本</th><th>毛利</th><th>毛利率</th></tr></thead>
              <tbody>
                {byProduct.slice(0, 15).map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{p.name || p.code}</td>
                    <td>{p.qty}</td>
                    <td>NT$ {p.revenue.toLocaleString()}</td>
                    <td>NT$ {p.cogs.toLocaleString()}</td>
                    <td style={{ color: p.grossProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>NT$ {p.grossProfit.toLocaleString()}</td>
                    <td><span className={`badge ${p.margin >= 30 ? 'badge-success' : p.margin >= 15 ? 'badge-warning' : 'badge-danger'}`}>{p.margin}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>客戶利潤排行</h4>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>客戶</th><th>訂單數</th><th>營收</th><th>平均客單</th><th>回收率</th></tr></thead>
              <tbody>
                {byCustomer.slice(0, 15).map((c, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td>{c.orders}</td>
                    <td>NT$ {c.revenue.toLocaleString()}</td>
                    <td>NT$ {c.avgOrderValue.toLocaleString()}</td>
                    <td><span className={`badge ${c.collectionRate >= 80 ? 'badge-success' : c.collectionRate >= 50 ? 'badge-warning' : 'badge-danger'}`}>{c.collectionRate}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════
//  Tab 2: Customer 360 (CRM + Sales + POS + Finance)
// ═══════════════════════════════════════════════════════════
function Customer360Tab({ customers }) {
  const [selected, setSelected] = useState('')
  const [c360, setC360] = useState(null)
  const [loading, setLoading] = useState(false)

  const loadCustomer = async (name) => {
    if (!name) return
    setLoading(true)
    try {
      const { getCustomer360 } = await import('../../lib/automation')
      const result = await getCustomer360(name)
      setC360(result)
    } catch (err) {
      console.error('Customer 360 failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const m = c360?.metrics

  return (
    <>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <select
            className="form-input"
            style={{ minWidth: 250 }}
            value={selected}
            onChange={e => { setSelected(e.target.value); loadCustomer(e.target.value) }}
          >
            <option value="">選擇客戶查看 360 分析...</option>
            {customers.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          {loading && <LoadingSpinner />}
        </div>
      </div>

      {c360 && m && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <StatCard label="累計營收" value={`NT$ ${m.totalRevenue.toLocaleString()}`} color="cyan" />
            <StatCard label="B2B 訂單" value={`NT$ ${m.b2bRevenue.toLocaleString()}`} color="blue" />
            <StatCard label="POS 消費" value={`NT$ ${m.posRevenue.toLocaleString()}`} color="green" />
            <StatCard label="未收帳款" value={`NT$ ${m.arOutstanding.toLocaleString()}`} color="red" />
          </div>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 12 }}>
            <StatCard label="總交易次數" value={m.totalOrders} color="purple" />
            <StatCard label="帳款回收率" value={`${m.collectionRate}%`} color="orange" />
            <StatCard label="開放工單" value={m.openTickets} color="pink" />
            <StatCard label="會員點數" value={m.loyaltyPoints.toLocaleString()} color="yellow" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
            <div className="card" style={{ padding: 20 }}>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>近期 B2B 訂單</h4>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>訂單</th><th>金額</th><th>狀態</th><th>日期</th></tr></thead>
                  <tbody>
                    {c360.salesOrders.slice(0, 10).map((o, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{o.order_number || `SO-${o.id}`}</td>
                        <td>NT$ {(o.total_amount || 0).toLocaleString()}</td>
                        <td><span className="badge badge-info">{o.status}</span></td>
                        <td>{o.created_at?.slice(0, 10)}</td>
                      </tr>
                    ))}
                    {c360.salesOrders.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無訂單</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>近期 POS 消費</h4>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>交易編號</th><th>金額</th><th>日期</th></tr></thead>
                  <tbody>
                    {c360.posTransactions.slice(0, 10).map((t, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{t.transaction_number || `POS-${t.id}`}</td>
                        <td>NT$ {(t.total || t.amount || 0).toLocaleString()}</td>
                        <td>{t.created_at?.slice(0, 10)}</td>
                      </tr>
                    ))}
                    {c360.posTransactions.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無 POS 消費</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
            <div className="card" style={{ padding: 20 }}>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>應收帳款歷史</h4>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>發票</th><th>金額</th><th>已收</th><th>狀態</th></tr></thead>
                  <tbody>
                    {c360.arRecords.slice(0, 10).map((a, i) => (
                      <tr key={i}>
                        <td>{a.invoice_number}</td>
                        <td>NT$ {(a.amount || 0).toLocaleString()}</td>
                        <td>NT$ {(a.paid_amount || 0).toLocaleString()}</td>
                        <td><span className={`badge ${a.status === '已收款' ? 'badge-success' : 'badge-warning'}`}>{a.status}</span></td>
                      </tr>
                    ))}
                    {c360.arRecords.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無應收紀錄</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>客服工單</h4>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>工單</th><th>主旨</th><th>狀態</th><th>日期</th></tr></thead>
                  <tbody>
                    {c360.tickets.slice(0, 10).map((t, i) => (
                      <tr key={i}>
                        <td>{t.ticket_number || `TK-${t.id}`}</td>
                        <td>{t.subject || t.title || '—'}</td>
                        <td><span className={`badge ${t.status === '已結案' ? 'badge-success' : 'badge-warning'}`}>{t.status}</span></td>
                        <td>{t.created_at?.slice(0, 10)}</td>
                      </tr>
                    ))}
                    {c360.tickets.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無工單</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
//  Tab 3: Forecast-Driven MRP (Sales Forecast → MRP)
// ═══════════════════════════════════════════════════════════
function ForecastTab({ data }) {
  if (!data) return <EmptyState msg="無預測資料" />
  const { forecast, summary } = data

  const chartData = {
    labels: forecast.slice(0, 12).map(f => f.sku_name?.slice(0, 10) || f.sku_code),
    datasets: [
      { label: '預測需求', data: forecast.slice(0, 12).map(f => f.quantity), backgroundColor: colors.cyan + '99', borderColor: colors.cyan, borderWidth: 1 },
      { label: '現有庫存', data: forecast.slice(0, 12).map(f => f.on_hand), backgroundColor: colors.green + '99', borderColor: colors.green, borderWidth: 1 },
      { label: '淨需求', data: forecast.slice(0, 12).map(f => f.net_requirement), backgroundColor: colors.red + '99', borderColor: colors.red, borderWidth: 1 },
    ]
  }

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <StatCard label="追蹤品項" value={summary.totalSkus} color="cyan" />
        <StatCard label="需採購品項" value={summary.needPurchase} color="red" />
        <StatCard label="總預測數量" value={summary.totalForecastQty.toLocaleString()} color="blue" />
        <StatCard label="總淨需求" value={summary.totalNetReq.toLocaleString()} color="orange" />
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>需求預測 vs 庫存 (Top 12)</h4>
        <div style={{ height: 350 }}>
          <Bar data={chartData} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle } } }} />
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>採購建議明細</h4>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>品項</th><th>月均銷量</th><th>3月預測</th><th>現有庫存</th><th>在途量</th><th>淨需求</th><th>信心度</th><th>建議</th></tr></thead>
            <tbody>
              {forecast.map((f, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{f.sku_name || f.sku_code}</td>
                  <td>{f.avg_monthly}</td>
                  <td>{f.quantity}</td>
                  <td>{f.on_hand}</td>
                  <td>{f.on_order}</td>
                  <td style={{ fontWeight: 600, color: f.net_requirement > 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>{f.net_requirement}</td>
                  <td><span className={`badge ${f.confidence === 'high' ? 'badge-success' : f.confidence === 'medium' ? 'badge-warning' : 'badge-info'}`}>{f.confidence === 'high' ? '高' : f.confidence === 'medium' ? '中' : '低'}</span></td>
                  <td><span className={`badge ${f.action === 'purchase' ? 'badge-danger' : 'badge-success'}`}>{f.action === 'purchase' ? '需採購' : '充足'}</span></td>
                </tr>
              ))}
              {forecast.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無預測數據</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════
//  Tab 4: Supply Chain Risk (Vendor + QC + Lots)
// ═══════════════════════════════════════════════════════════
function SupplyRiskTab({ data }) {
  if (!data) return <EmptyState msg="無供應鏈資料" />
  const { vendors, summary, lotsNearExpiry } = data

  const riskDist = {
    labels: ['高風險', '中風險', '低風險'],
    datasets: [{
      data: [summary.highRisk, summary.mediumRisk, summary.lowRisk],
      backgroundColor: [colors.red + 'cc', colors.yellow + 'cc', colors.green + 'cc'],
      borderWidth: 0,
    }]
  }

  const top10 = vendors.slice(0, 10)
  const radarData = {
    labels: top10.map(v => v.name?.slice(0, 8)),
    datasets: [{
      label: '風險分數',
      data: top10.map(v => v.riskScore),
      backgroundColor: colors.red + '33',
      borderColor: colors.red,
      borderWidth: 2,
      pointBackgroundColor: top10.map(v => v.riskLevel === 'high' ? colors.red : v.riskLevel === 'medium' ? colors.yellow : colors.green),
    }]
  }

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <StatCard label="供應商總數" value={summary.totalVendors} color="blue" />
        <StatCard label="高風險" value={summary.highRisk} color="red" />
        <StatCard label="中風險" value={summary.mediumRisk} color="orange" />
        <StatCard label="低風險" value={summary.lowRisk} color="green" />
        <StatCard label="即期批號" value={lotsNearExpiry} color="yellow" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>風險分布</h4>
          <div style={{ height: 280, display: 'flex', justifyContent: 'center' }}>
            <Doughnut data={riskDist} options={{ ...chartOpts, cutout: '65%' }} />
          </div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>Top 10 供應商風險雷達</h4>
          <div style={{ height: 280 }}>
            <Radar data={radarData} options={{
              ...chartOpts,
              scales: { r: { beginAtZero: true, max: 100, grid: gridStyle, ticks: { ...tickStyle, stepSize: 25 }, pointLabels: tickStyle } },
            }} />
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>供應商風險明細</h4>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>供應商</th><th>交貨分數</th><th>品質分數</th><th>QC 不合格</th><th>風險分數</th><th>風險等級</th></tr></thead>
            <tbody>
              {vendors.map((v, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{v.name}</td>
                  <td>{v.deliveryScore}</td>
                  <td>{v.qualityScore}</td>
                  <td>{v.qcFailures}</td>
                  <td style={{ fontWeight: 700 }}>{v.riskScore}</td>
                  <td><span className={`badge ${v.riskLevel === 'high' ? 'badge-danger' : v.riskLevel === 'medium' ? 'badge-warning' : 'badge-success'}`}>
                    <span className="badge-dot"></span>{v.riskLevel === 'high' ? '高' : v.riskLevel === 'medium' ? '中' : '低'}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════
//  Tab 5: Labor Cost per Unit (HR + Manufacturing)
// ═══════════════════════════════════════════════════════════
function LaborCostTab({ data }) {
  if (!data) return <EmptyState msg="無人工成本資料" />

  const moChart = {
    labels: data.moBreakdown.slice(0, 10).map(mo => mo.product?.slice(0, 10) || mo.orderNumber),
    datasets: [{
      label: '人工成本 / 單位',
      data: data.moBreakdown.slice(0, 10).map(mo => mo.laborCostPerUnit),
      backgroundColor: colors.orange + '99',
      borderColor: colors.orange,
      borderWidth: 1,
    }]
  }

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <StatCard label="總人工成本" value={`NT$ ${data.totalLaborCost.toLocaleString()}`} color="orange" />
        <StatCard label="總工時" value={`${data.totalHours} 小時`} color="blue" />
        <StatCard label="每小時成本" value={`NT$ ${data.costPerHour.toLocaleString()}`} color="cyan" />
        <StatCard label="每單位成本" value={`NT$ ${data.costPerUnit.toLocaleString()}`} color="green" />
      </div>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 12 }}>
        <StatCard label="員工人數" value={data.employeeCount} color="purple" />
        <StatCard label="總產出" value={`${data.totalUnitsProduced} 單位`} color="pink" />
        <StatCard label="月份" value={data.month} color="yellow" />
      </div>

      {data.moBreakdown.length > 0 && (
        <div className="card" style={{ padding: 20, marginTop: 16 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>製令人工成本分攤</h4>
          <div style={{ height: 300 }}>
            <Bar data={moChart} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>製令明細</h4>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>製令</th><th>產品</th><th>數量</th><th>狀態</th><th>分攤人工</th><th>單位人工</th></tr></thead>
            <tbody>
              {data.moBreakdown.map((mo, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{mo.orderNumber}</td>
                  <td>{mo.product}</td>
                  <td>{mo.quantity}</td>
                  <td><span className={`badge ${mo.status === '已完成' ? 'badge-success' : 'badge-info'}`}>{mo.status}</span></td>
                  <td>NT$ {mo.allocatedLaborCost.toLocaleString()}</td>
                  <td style={{ fontWeight: 600 }}>NT$ {mo.laborCostPerUnit.toLocaleString()}</td>
                </tr>
              ))}
              {data.moBreakdown.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>本月無製令</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════
//  Tab 6: Promotion ROI (Promotions → POS → Margin)
// ═══════════════════════════════════════════════════════════
function PromoROITab({ data }) {
  if (!data) return <EmptyState msg="無促銷 ROI 資料" />
  const { promotions, summary } = data

  const roiChart = {
    labels: promotions.slice(0, 10).map(p => p.name?.slice(0, 12)),
    datasets: [
      { label: '促銷營收', data: promotions.slice(0, 10).map(p => p.promoRevenue), backgroundColor: colors.cyan + '99', borderColor: colors.cyan, borderWidth: 1 },
      { label: '基準營收', data: promotions.slice(0, 10).map(p => p.baselineRevenue), backgroundColor: colors.blue + '33', borderColor: colors.blue, borderWidth: 1, borderDash: [4, 4] },
    ]
  }

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <StatCard label="促銷總數" value={summary.totalPromotions} color="pink" />
        <StatCard label="促銷營收" value={`NT$ ${summary.totalPromoRevenue.toLocaleString()}`} color="cyan" />
        <StatCard label="銷售提升" value={`${summary.totalSalesLift}%`} color="green" />
        <StatCard label="平均 ROI" value={`${summary.avgROI}%`} color="orange" />
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>促銷 vs 基準營收</h4>
        <div style={{ height: 300 }}>
          <Bar data={roiChart} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle } } }} />
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>促銷 ROI 明細</h4>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>促銷名稱</th><th>期間</th><th>交易數</th><th>促銷營收</th><th>基準營收</th><th>銷售提升</th><th>折扣成本</th><th>ROI</th></tr></thead>
            <tbody>
              {promotions.map((p, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td style={{ fontSize: 11 }}>{p.startDate} ~ {p.endDate}</td>
                  <td>{p.transactionCount}</td>
                  <td>NT$ {p.promoRevenue.toLocaleString()}</td>
                  <td>NT$ {p.baselineRevenue.toLocaleString()}</td>
                  <td><span className={`badge ${p.salesLift > 0 ? 'badge-success' : 'badge-danger'}`}>{p.salesLift > 0 ? '+' : ''}{p.salesLift}%</span></td>
                  <td>NT$ {p.discountCost.toLocaleString()}</td>
                  <td style={{ fontWeight: 700, color: p.roi > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{p.roi > 0 ? '+' : ''}{p.roi}%</td>
                </tr>
              ))}
              {promotions.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無促銷資料</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════
//  Tab 7: Cycle Time / Workflow Outcomes
// ═══════════════════════════════════════════════════════════
function CycleTimeTab({ data }) {
  if (!data) return <EmptyState msg="無流程效率資料" />
  const { cycleTime, tasks } = data

  const cycleChartData = {
    labels: ['訂單→出貨', '採購→入庫', '製令週期'],
    datasets: [{
      label: '平均天數',
      data: [cycleTime.orderToShip.avg, cycleTime.poToGR.avg, cycleTime.moCycle.avg],
      backgroundColor: [colors.cyan + '99', colors.orange + '99', colors.purple + '99'],
      borderColor: [colors.cyan, colors.orange, colors.purple],
      borderWidth: 1,
    }]
  }

  const taskDist = {
    labels: ['已完成', '進行中', '逾期'],
    datasets: [{
      data: [tasks.completed, tasks.total - tasks.completed - tasks.overdue, tasks.overdue],
      backgroundColor: [colors.green + 'cc', colors.blue + 'cc', colors.red + 'cc'],
      borderWidth: 0,
    }]
  }

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <StatCard label="訂單→出貨 (天)" value={`${cycleTime.orderToShip.avg} 天`} color="cyan" />
        <StatCard label="採購→入庫 (天)" value={`${cycleTime.poToGR.avg} 天`} color="orange" />
        <StatCard label="製令週期 (天)" value={`${cycleTime.moCycle.avg} 天`} color="purple" />
        <StatCard label="任務完成率" value={`${tasks.completionRate}%`} color="green" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>平均流程週期</h4>
          <div style={{ height: 300 }}>
            <Bar data={cycleChartData} options={{ ...chartOpts, indexAxis: 'y', scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>任務狀態</h4>
          <div style={{ height: 300, display: 'flex', justifyContent: 'center' }}>
            <Doughnut data={taskDist} options={{ ...chartOpts, cutout: '65%' }} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>訂單→出貨明細 (近20筆)</h4>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>客戶</th><th>天數</th></tr></thead>
              <tbody>
                {cycleTime.orderToShip.data.map((o, i) => (
                  <tr key={i}>
                    <td>{o.customer || `訂單 #${o.orderId}`}</td>
                    <td style={{ fontWeight: 600, color: o.days > 7 ? 'var(--accent-red)' : 'var(--accent-green)' }}>{o.days} 天</td>
                  </tr>
                ))}
                {cycleTime.orderToShip.data.length === 0 && <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無資料</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>採購→入庫明細 (近20筆)</h4>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>供應商</th><th>天數</th></tr></thead>
              <tbody>
                {cycleTime.poToGR.data.map((o, i) => (
                  <tr key={i}>
                    <td>{o.supplier || `PO #${o.poId}`}</td>
                    <td style={{ fontWeight: 600, color: o.days > 14 ? 'var(--accent-red)' : 'var(--accent-green)' }}>{o.days} 天</td>
                  </tr>
                ))}
                {cycleTime.poToGR.data.length === 0 && <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無資料</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════
//  Shared Components
// ═══════════════════════════════════════════════════════════
function StatCard({ label, value, color }) {
  const colorMap = {
    cyan: { accent: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)' },
    blue: { accent: 'var(--accent-blue, #3b82f6)', dim: 'var(--accent-blue-dim, rgba(59,130,246,0.1))' },
    green: { accent: 'var(--accent-green)', dim: 'var(--accent-green-dim)' },
    red: { accent: 'var(--accent-red)', dim: 'var(--accent-red-dim)' },
    orange: { accent: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
    purple: { accent: 'var(--accent-purple, #a78bfa)', dim: 'var(--accent-purple-dim, rgba(167,139,250,0.1))' },
    pink: { accent: 'var(--accent-pink, #f472b6)', dim: 'var(--accent-pink-dim, rgba(244,114,182,0.1))' },
    yellow: { accent: 'var(--accent-yellow, #fbbf24)', dim: 'var(--accent-yellow-dim, rgba(251,191,36,0.1))' },
  }
  const c = colorMap[color] || colorMap.cyan
  return (
    <div className="stat-card" style={{ '--card-accent': c.accent, '--card-accent-dim': c.dim }}>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
    </div>
  )
}

function EmptyState({ msg }) {
  return (
    <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
      <Package size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
      <p>{msg}</p>
    </div>
  )
}
