import { useState, useEffect } from 'react'
import { Download, Printer } from 'lucide-react'
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler } from 'chart.js'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import { supabase } from '../../lib/supabase'
import { calculateFunnelConversion, calculateRepPerformance } from '../../lib/crmEngine'
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

export default function SalesPerformance() {
  const [opportunities, setOpportunities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dateRange, setDateRange] = useState(null)

  useEffect(() => {
    supabase.from('opportunities').select('*')
      .then(({ data, error: err }) => {
        if (err) throw err
        setOpportunities(data || [])
      })
      .catch(err => {
        console.error('Failed to load opportunities:', err)
        setError('資料載入失敗，請重新整理頁面')
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filterByDate = (arr) => {
    if (!dateRange) return arr
    return arr.filter(r => {
      const d = (r.created_at || '').slice(0, 10)
      return d >= dateRange.startDate && d <= dateRange.endDate
    })
  }

  const filtered = filterByDate(opportunities)
  const stages = ['初步接觸', '需求分析', '報價', '議價', '贏單', '輸單']
  const reps = [...new Set(filtered.map(o => o.assignee).filter(Boolean))]
  const repPerf = calculateRepPerformance(filtered, reps).sort((a, b) => b.totalRevenue - a.totalRevenue)
  const funnelData = calculateFunnelConversion(filtered)

  // KPI calculations
  const wonOpps = filtered.filter(o => o.stage === '贏單')
  const lostOpps = filtered.filter(o => o.stage === '輸單')
  const totalDeals = filtered.length
  const wonCount = wonOpps.length
  const overallWinRate = (wonCount + lostOpps.length) > 0 ? Math.round((wonCount / (wonCount + lostOpps.length)) * 100) : 0
  const totalRevenue = wonOpps.reduce((s, o) => s + (o.amount || 0), 0)
  const avgDealSize = wonCount > 0 ? Math.round(totalRevenue / wonCount) : 0
  const avgCycleDays = wonCount > 0
    ? Math.round(wonOpps.reduce((s, o) => {
        const c = new Date(o.created_at)
        const u = new Date(o.updated_at || o.created_at)
        return s + Math.max(1, Math.round((u - c) / (1000 * 60 * 60 * 24)))
      }, 0) / wonCount)
    : 0
  const activeOpps = filtered.filter(o => !['贏單', '輸單'].includes(o.stage))
  const forecastRevenue = activeOpps.reduce((s, o) => s + (o.amount || 0), 0)

  // Chart 1: Pipeline Conversion Funnel
  const funnelChartData = {
    labels: funnelData.map(f => f.stage),
    datasets: [{
      label: '轉換率 (%)',
      data: funnelData.map(f => f.conversionRate),
      backgroundColor: [colors.blue, colors.cyan, colors.purple, colors.orange, colors.green],
      borderRadius: 8, borderSkipped: false, barThickness: 36,
    }],
  }

  // Chart 2: Win Rate by Rep (horizontal)
  const winRateData = {
    labels: repPerf.map(r => r.rep),
    datasets: [{
      label: '勝率 (%)',
      data: repPerf.map(r => r.winRate),
      backgroundColor: repPerf.map((_, i) => Object.values(colors)[i % 8]),
      borderRadius: 6, borderSkipped: false, barThickness: 24,
    }],
  }

  // Chart 3: Revenue by Rep (Doughnut)
  const revDoughnutData = {
    labels: repPerf.map(r => r.rep),
    datasets: [{
      data: repPerf.map(r => r.totalRevenue),
      backgroundColor: repPerf.map((_, i) => Object.values(colors)[i % 8]),
      borderWidth: 0, hoverOffset: 6,
    }],
  }

  // Chart 4: Deal Size Trend (monthly average)
  const now = new Date()
  const monthLabels = []
  const monthAvgDeal = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const yr = d.getFullYear(), mo = d.getMonth()
    monthLabels.push(`${yr}/${String(mo + 1).padStart(2, '0')}`)
    const monthWon = wonOpps.filter(o => {
      const od = new Date(o.created_at)
      return od.getFullYear() === yr && od.getMonth() === mo
    })
    monthAvgDeal.push(monthWon.length > 0 ? Math.round(monthWon.reduce((s, o) => s + (o.amount || 0), 0) / monthWon.length) : 0)
  }
  const dealSizeLineData = {
    labels: monthLabels,
    datasets: [{
      label: '平均成交金額 (NT$)',
      data: monthAvgDeal,
      borderColor: colors.cyan, backgroundColor: 'rgba(34,211,238,0.1)',
      fill: true, tension: 0.4, pointRadius: 5,
      pointBackgroundColor: colors.cyan, pointBorderColor: '#0f172a', pointBorderWidth: 2,
    }],
  }

  // Chart 5: Sales Cycle by Rep
  const cycleData = {
    labels: repPerf.map(r => r.rep),
    datasets: [{
      label: '平均成交天數',
      data: repPerf.map(r => {
        const repWon = wonOpps.filter(o => o.assignee === r.rep)
        if (repWon.length === 0) return 0
        return Math.round(repWon.reduce((s, o) => {
          const c = new Date(o.created_at)
          const u = new Date(o.updated_at || o.created_at)
          return s + Math.max(1, Math.round((u - c) / (1000 * 60 * 60 * 24)))
        }, 0) / repWon.length)
      }),
      backgroundColor: repPerf.map((_, i) => Object.values(colors)[i % 8]),
      borderRadius: 6, borderSkipped: false, barThickness: 28,
    }],
  }

  const handleExportCSV = () => {
    exportToCSV(repPerf.map(r => ({
      rep: r.rep, totalDeals: r.totalDeals, wonDeals: r.wonDeals,
      winRate: r.winRate, totalRevenue: r.totalRevenue, avgDealSize: r.avgDealSize,
    })), [
      { key: 'rep', label: '業務代表' }, { key: 'totalDeals', label: '總商機' },
      { key: 'wonDeals', label: '贏單數' }, { key: 'winRate', label: '勝率 (%)' },
      { key: 'totalRevenue', label: '總營收' }, { key: 'avgDealSize', label: '平均成交金額' },
    ], `銷售績效_${new Date().toISOString().slice(0, 10)}`)
  }

  return (
    <div className="fade-in" id="sales-performance-page">
      <div className="page-header">
        <h2><span className="header-icon">🏆</span> 銷售績效</h2>
        <p>業務代表績效分析與排行</p>
        <div className="export-btn-group" style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-primary" onClick={handleExportCSV} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download size={15} /> 匯出 CSV
          </button>
          <button className="btn btn-primary" onClick={() => exportToPDF('sales-performance-page', '銷售績效')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Printer size={15} /> 列印報表
          </button>
        </div>
      </div>

      <DateRangePicker value={dateRange} onChange={setDateRange} />

      {/* KPI Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">總商機數</div>
          <div className="stat-card-value">{totalDeals}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">贏單數</div>
          <div className="stat-card-value">{wonCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">整體勝率</div>
          <div className="stat-card-value">{overallWinRate}%</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">平均成交金額</div>
          <div className="stat-card-value">NT$ {avgDealSize.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">銷售週期(天)</div>
          <div className="stat-card-value">{avgCycleDays} 天</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-yellow)', '--card-accent-dim': 'var(--accent-yellow-dim)' }}>
          <div className="stat-card-label">預測營收</div>
          <div className="stat-card-value">NT$ {forecastRevenue.toLocaleString()}</div>
        </div>
      </div>

      {/* Sales Rep Leaderboard */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">📊 業務排行榜</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>排名</th><th>業務代表</th><th>總商機</th><th>贏單數</th>
                <th>勝率</th><th>總營收</th><th>平均成交金額</th>
              </tr>
            </thead>
            <tbody>
              {repPerf.map((r, i) => (
                <tr key={r.rep}>
                  <td>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{r.rep}</td>
                  <td>{r.totalDeals}</td>
                  <td>{r.wonDeals}</td>
                  <td>{r.winRate}%</td>
                  <td>NT$ {r.totalRevenue.toLocaleString()}</td>
                  <td>NT$ {r.avgDealSize.toLocaleString()}</td>
                </tr>
              ))}
              {repPerf.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>尚無資料</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts Row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">🔄 漏斗轉換率</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar data={funnelChartData} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, max: 100, grid: gridStyle, ticks: { ...tickStyle, callback: v => `${v}%` } } } }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">🎯 各業務勝率</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar data={winRateData} options={{ ...chartOpts, indexAxis: 'y', scales: { x: { beginAtZero: true, max: 100, grid: gridStyle, ticks: { ...tickStyle, callback: v => `${v}%` } }, y: { grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">💰 營收佔比</div></div>
          <div style={{ height: 280, padding: '0 8px 8px', display: 'flex', justifyContent: 'center' }}>
            <Doughnut data={revDoughnutData} options={{ ...chartOpts, cutout: '55%' }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">📈 月均成交金額趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Line data={dealSizeLineData} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: { ...tickStyle, callback: v => `NT$ ${(v / 1000).toFixed(0)}K` } } } }} />
          </div>
        </div>
      </div>

      {/* Charts Row 3 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">⏱ 各業務平均成交天數</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar data={cycleData} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: { ...tickStyle, callback: v => `${v} 天` } } } }} />
          </div>
        </div>
      </div>
    </div>
  )
}
