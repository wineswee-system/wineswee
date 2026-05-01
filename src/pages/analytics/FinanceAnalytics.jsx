import { useState, useEffect } from 'react'
import { Download, Printer } from 'lucide-react'
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler } from 'chart.js'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import { useAuth } from '../../contexts/AuthContext'
import { getAccountsReceivable, getAccountsPayable, getBudgets, getJournalEntries } from '../../lib/db'
import { exportToCSV, exportToPDF } from '../../lib/exportUtils'
import LoadingSpinner from '../../components/LoadingSpinner'
import DateRangePicker from '../../components/DateRangePicker'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler)

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

function getMonthRange(dateRange, count = 6) {
  if (dateRange) {
    const s = new Date(dateRange.startDate)
    const e = new Date(dateRange.endDate)
    const result = []
    const cur = new Date(s.getFullYear(), s.getMonth(), 1)
    while (cur <= e) {
      result.push(cur.toISOString().slice(0, 7))
      cur.setMonth(cur.getMonth() + 1)
    }
    return result.length > 0 ? result : [new Date().toISOString().slice(0, 7)]
  }
  return Array.from({ length: count }, (_, i) => {
    const dt = new Date()
    dt.setMonth(dt.getMonth() - (count - 1 - i))
    return dt.toISOString().slice(0, 7)
  })
}

function getPrevPeriodRange(dateRange) {
  if (!dateRange) return null
  const s = new Date(dateRange.startDate)
  const e = new Date(dateRange.endDate)
  const span = e.getTime() - s.getTime()
  const prevEnd = new Date(s.getTime() - 1)
  const prevStart = new Date(prevEnd.getTime() - span)
  return { startDate: prevStart.toISOString().slice(0, 10), endDate: prevEnd.toISOString().slice(0, 10) }
}

export default function FinanceAnalytics() {
  const { profile } = useAuth()
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dateRange, setDateRange] = useState(null)
  const [showComparison, setShowComparison] = useState(false)

  useEffect(() => {
    const orgId = profile?.organization_id
    if (!orgId) { setLoading(false); return }
    Promise.all([
      getAccountsReceivable(orgId),
      getAccountsPayable(orgId),
      getBudgets(orgId),
      getJournalEntries(orgId),
    ]).then(([ar, ap, budgets, journal]) => {
      setRaw({
        ar: ar.data || [], ap: ap.data || [],
        budgets: budgets.data || [], journal: journal.data || [],
      })
    }).catch(err => {
      console.error('Failed to load finance data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
  }, [profile?.organization_id])

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  const filterByDate = (arr, range) => {
    if (!range) return arr
    return arr.filter(r => {
      const d = (r.created_at || '').slice(0, 10)
      return d >= range.startDate && d <= range.endDate
    })
  }

  const ar = filterByDate(raw.ar, dateRange)
  const ap = filterByDate(raw.ap, dateRange)
  const budgets = raw.budgets
  const prevRange = getPrevPeriodRange(dateRange)
  const prevAr = prevRange ? filterByDate(raw.ar, prevRange) : []
  const prevAp = prevRange ? filterByDate(raw.ap, prevRange) : []

  // ── KPI calculations ──
  const totalRevenue = ar.reduce((s, r) => s + (r.amount || 0), 0)
  const totalCost = ap.reduce((s, r) => s + (r.amount || 0), 0)
  const grossProfit = totalRevenue - totalCost
  const grossMargin = totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : '0.0'
  const arBalance = ar.reduce((s, r) => s + (r.amount || 0) - (r.paid_amount || 0), 0)
  const apBalance = ap.reduce((s, r) => s + (r.amount || 0) - (r.paid_amount || 0), 0)

  // ── Month labels ──
  const months = getMonthRange(dateRange, 6)
  const monthLabels = months.map(m => m.slice(5) + '月')

  // ── P&L Trend ──
  const groupByMonth = (arr, field = 'amount') => {
    const map = {}
    months.forEach(m => { map[m] = 0 })
    arr.forEach(r => { const m = (r.created_at || '').slice(0, 7); if (map[m] !== undefined) map[m] += (r[field] || 0) })
    return months.map(m => Math.round(map[m]))
  }
  const revData = groupByMonth(ar, 'amount')
  const costData = groupByMonth(ap, 'amount')
  const profitData = revData.map((v, i) => v - costData[i])

  const plDatasets = [
    { label: '營收', data: revData, borderColor: colors.cyan, backgroundColor: 'rgba(34,211,238,0.08)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: colors.cyan },
    { label: '成本', data: costData, borderColor: colors.orange, backgroundColor: 'rgba(251,146,60,0.08)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: colors.orange },
    { label: '淨利', data: profitData, borderColor: colors.green, backgroundColor: 'rgba(52,211,153,0.08)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: colors.green },
  ]
  if (showComparison && prevRange) {
    const prevMonths = getMonthRange(prevRange, months.length)
    const prevRevMap = {}; prevMonths.forEach(m => { prevRevMap[m] = 0 })
    prevAr.forEach(r => { const m = (r.created_at || '').slice(0, 7); if (prevRevMap[m] !== undefined) prevRevMap[m] += (r.amount || 0) })
    const prevRevData = prevMonths.map(m => Math.round(prevRevMap[m]))
    plDatasets.push({ label: '上期營收', data: prevRevData, borderColor: colors.cyan, borderDash: [6, 4], backgroundColor: 'transparent', tension: 0.4, pointRadius: 3, pointBackgroundColor: colors.cyan })
    const prevCostMap = {}; prevMonths.forEach(m => { prevCostMap[m] = 0 })
    prevAp.forEach(r => { const m = (r.created_at || '').slice(0, 7); if (prevCostMap[m] !== undefined) prevCostMap[m] += (r.amount || 0) })
    const prevCostData = prevMonths.map(m => Math.round(prevCostMap[m]))
    plDatasets.push({ label: '上期成本', data: prevCostData, borderColor: colors.orange, borderDash: [6, 4], backgroundColor: 'transparent', tension: 0.4, pointRadius: 3, pointBackgroundColor: colors.orange })
  }
  const plTrend = { labels: monthLabels, datasets: plDatasets }

  // ── Cash Flow Waterfall ──
  const arCollected = ar.reduce((s, r) => s + (r.paid_amount || 0), 0)
  const apPaidTotal = ap.reduce((s, r) => s + (r.paid_amount || 0), 0)
  const beginBalance = 0
  const endBalance = beginBalance + arCollected - apPaidTotal
  const cashFlowData = {
    labels: ['期初餘額', '應收回款', '應付支出', '期末餘額'],
    datasets: [
      { label: '隱藏底部', data: [0, 0, Math.max(0, endBalance), 0], backgroundColor: 'transparent', borderWidth: 0, barThickness: 36 },
      { label: '金額',
        data: [beginBalance, arCollected, -apPaidTotal, endBalance],
        backgroundColor: [colors.blue, colors.green, colors.red, endBalance >= 0 ? colors.cyan : colors.red],
        borderRadius: 6, barThickness: 36,
      },
    ],
  }

  // ── Budget vs Actual ──
  const budgetCategories = [...new Set(budgets.map(b => b.category))].slice(0, 8)
  const budgetVsActual = {
    labels: budgetCategories,
    datasets: [
      { label: '預算', data: budgetCategories.map(c => budgets.filter(b => b.category === c).reduce((s, b) => s + (b.budget_amount || 0), 0)), backgroundColor: colors.blue, borderRadius: 6, barThickness: 20 },
      { label: '實際', data: budgetCategories.map(c => budgets.filter(b => b.category === c).reduce((s, b) => s + (b.actual_amount || 0), 0)), backgroundColor: colors.orange, borderRadius: 6, barThickness: 20 },
    ],
  }

  // ── Expense Breakdown by Vendor ──
  const vendorMap = {}
  ap.forEach(r => {
    const key = r.vendor || '其他'
    vendorMap[key] = (vendorMap[key] || 0) + (r.amount || 0)
  })
  const vendorEntries = Object.entries(vendorMap).sort((a, b) => b[1] - a[1]).slice(0, 7)
  const paletteArr = [colors.cyan, colors.blue, colors.purple, colors.green, colors.orange, colors.pink, colors.yellow]
  const expenseData = {
    labels: vendorEntries.map(e => e[0]),
    datasets: [{ data: vendorEntries.map(e => Math.round(e[1])), backgroundColor: paletteArr.slice(0, vendorEntries.length), borderWidth: 0 }],
  }

  // ── AR Collection Rate ──
  const collectionByMonth = months.map(m => {
    const monthAr = ar.filter(r => (r.created_at || '').slice(0, 7) === m)
    const total = monthAr.reduce((s, r) => s + (r.amount || 0), 0)
    const paid = monthAr.reduce((s, r) => s + (r.paid_amount || 0), 0)
    return total > 0 ? Math.round((paid / total) * 100) : 0
  })
  const collectionDatasets = [
    { label: '收款率 (%)', data: collectionByMonth, borderColor: colors.cyan, backgroundColor: 'rgba(34,211,238,0.1)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: colors.cyan },
  ]
  if (showComparison && prevRange) {
    const prevMonths = getMonthRange(prevRange, months.length)
    const prevCollectionByMonth = prevMonths.map(m => {
      const monthAr = prevAr.filter(r => (r.created_at || '').slice(0, 7) === m)
      const total = monthAr.reduce((s, r) => s + (r.amount || 0), 0)
      const paid = monthAr.reduce((s, r) => s + (r.paid_amount || 0), 0)
      return total > 0 ? Math.round((paid / total) * 100) : 0
    })
    collectionDatasets.push({ label: '上期收款率', data: prevCollectionByMonth, borderColor: colors.cyan, borderDash: [6, 4], backgroundColor: 'transparent', tension: 0.4, pointRadius: 3, pointBackgroundColor: colors.cyan })
  }
  const collectionData = { labels: monthLabels, datasets: collectionDatasets }

  // ── CSV Export ──
  const handleExportCSV = () => {
    const rows = [
      { label: '總營收', value: totalRevenue },
      { label: '總成本', value: totalCost },
      { label: '毛利', value: grossProfit },
      { label: '毛利率 (%)', value: grossMargin },
      { label: '應收餘額', value: arBalance },
      { label: '應付餘額', value: apBalance },
      { label: '應收回款', value: arCollected },
      { label: '應付支出', value: apPaidTotal },
    ]
    exportToCSV(rows, [
      { key: 'label', label: '指標' },
      { key: 'value', label: '數值' },
    ], `財務分析_${new Date().toISOString().slice(0, 10)}`)
  }

  const fmt = (v) => `NT$${(v / 1000).toFixed(0)}K`

  return (
    <div className="fade-in" id="finance-analytics-page">
      <div className="page-header">
        <h2><span className="header-icon">📊</span> 財務分析</h2>
        <p>財務模組數據分析與趨勢追蹤</p>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-primary" onClick={handleExportCSV} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download size={15} /> 匯出 CSV
          </button>
          <button className="btn btn-primary" onClick={() => exportToPDF('finance-analytics-page', '財務分析')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Printer size={15} /> 列印報表
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#94a3b8', fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={showComparison} onChange={e => setShowComparison(e.target.checked)} style={{ accentColor: colors.cyan }} />
          期間比較（本期 vs 上期）
        </label>
      </div>

      {/* KPI Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {[
          { label: '總營收', value: fmt(totalRevenue), color: 'cyan' },
          { label: '總成本', value: fmt(totalCost), color: 'orange' },
          { label: '毛利', value: fmt(grossProfit), color: grossProfit >= 0 ? 'green' : 'red' },
          { label: '毛利率', value: `${grossMargin}%`, color: Number(grossMargin) >= 30 ? 'green' : 'orange' },
          { label: '應收餘額', value: fmt(arBalance), color: 'blue' },
          { label: '應付餘額', value: fmt(apBalance), color: 'purple' },
        ].map((s, i) => (
          <div key={i} className="stat-card" style={{ '--card-accent': `var(--accent-${s.color})`, '--card-accent-dim': `var(--accent-${s.color}-dim)` }}>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Row 1: P&L Trend + Cash Flow Waterfall */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">📈 損益趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Line data={plTrend} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">💰 現金流量瀑布</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar data={cashFlowData} options={{ ...chartOpts, plugins: { ...chartOpts.plugins, legend: { display: false } }, scales: { x: { stacked: true, grid: { display: false }, ticks: tickStyle }, y: { stacked: true, beginAtZero: true, grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
      </div>

      {/* Row 2: Budget vs Actual + Expense Breakdown + AR Collection */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">🎯 預算 vs 實際</div></div>
          <div style={{ height: 260, padding: '0 8px 8px' }}>
            <Bar data={budgetVsActual} options={{ ...chartOpts, scales: { x: { grid: { display: false }, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">🧾 支出結構分析</div></div>
          <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px 8px' }}>
            <Doughnut data={expenseData} options={{ ...chartOpts, cutout: '55%', plugins: { ...chartOpts.plugins, legend: { ...chartOpts.plugins.legend, position: 'bottom' } } }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">📥 應收回款率</div></div>
          <div style={{ height: 260, padding: '0 8px 8px' }}>
            <Line data={collectionData} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, max: 100, grid: gridStyle, ticks: { ...tickStyle, callback: v => v + '%' } } } }} />
          </div>
        </div>
      </div>
    </div>
  )
}
