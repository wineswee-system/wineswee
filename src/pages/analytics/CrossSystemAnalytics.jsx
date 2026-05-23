import { useState, useEffect } from 'react'
import { Link2, TrendingUp, Users, Factory, ShoppingBag, AlertTriangle, Clock, DollarSign, UserX, RefreshCw } from 'lucide-react'
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
import ProfitabilityTab from './components/CrossSystemProfitabilityTab'
import Customer360Tab from './components/CrossSystemCustomer360Tab'
import SupplyRiskTab from './components/CrossSystemSupplyRiskTab'
import CycleTimeTab from './components/CrossSystemCycleTimeTab'
import AttritionImpactTab from './components/CrossSystemAttritionImpactTab'
import { colors, chartOpts, gridStyle, tickStyle } from './components/crossSystemConstants'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler, RadialLinearScale)

const TABS = [
  { key: 'profitability', label: '產品利潤', icon: DollarSign, color: colors.green },
  { key: 'customer360', label: '客戶 360', icon: Users, color: colors.blue },
  { key: 'forecast', label: '需求預測', icon: TrendingUp, color: colors.cyan },
  { key: 'supply-risk', label: '供應鏈風險', icon: AlertTriangle, color: colors.red },
  { key: 'labor-cost', label: '人工成本', icon: Factory, color: colors.orange },
  { key: 'promo-roi', label: '促銷 ROI', icon: ShoppingBag, color: colors.pink },
  { key: 'cycle-time', label: '流程效率', icon: Clock, color: colors.purple },
  { key: 'attrition-impact', label: '離職資產追蹤', icon: UserX, color: colors.red },
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

      {activeTab === 'profitability' && <ProfitabilityTab data={data.profitability} StatCard={StatCard} EmptyState={EmptyState} />}
      {activeTab === 'customer360' && <Customer360Tab customers={customers} StatCard={StatCard} EmptyState={EmptyState} />}
      {activeTab === 'forecast' && <ForecastTab data={data.forecast} />}
      {activeTab === 'supply-risk' && <SupplyRiskTab data={data.supplyRisk} StatCard={StatCard} EmptyState={EmptyState} />}
      {activeTab === 'labor-cost' && <LaborCostTab data={data.laborCost} />}
      {activeTab === 'promo-roi' && <PromoROITab data={data.promoROI} />}
      {activeTab === 'cycle-time' && <CycleTimeTab data={data.cycleTime} StatCard={StatCard} EmptyState={EmptyState} />}
      {activeTab === 'attrition-impact' && <AttritionImpactTab />}
    </div>
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
