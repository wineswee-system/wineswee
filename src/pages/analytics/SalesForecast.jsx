import { useState, useEffect } from 'react'
import { TrendingUp, Target, PieChart, Download, Printer } from 'lucide-react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import { supabase } from '../../lib/supabase'
import { exportToCSV, exportToPDF } from '../../lib/exportUtils'
import LoadingSpinner from '../../components/LoadingSpinner'
import DateRangePicker from '../../components/DateRangePicker'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler)

const chartColors = {
  cyan: '#22d3ee',
  blue: '#3b82f6',
  purple: '#a78bfa',
  green: '#34d399',
  orange: '#fb923c',
  red: '#f87171',
  pink: '#f472b6',
  yellow: '#fbbf24',
}

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: { color: '#94a3b8', font: { size: 11, weight: 600 }, padding: 16, usePointStyle: true, pointStyleWidth: 8 },
    },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 55, 0.95)',
      titleColor: '#f1f5f9',
      bodyColor: '#94a3b8',
      borderColor: 'rgba(148, 163, 184, 0.15)',
      borderWidth: 1,
      padding: 12,
      cornerRadius: 10,
      titleFont: { size: 13, weight: 700 },
      bodyFont: { size: 12 },
    },
  },
}

export default function SalesForecast() {
  const [opportunities, setOpportunities] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dateRange, setDateRange] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('opportunities').select('*'),
      supabase.from('sales_orders').select('*'),
    ]).then(([opp, ord]) => {
      setOpportunities(opp.data || [])
      setOrders(ord.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
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

  const filteredOpportunities = filterByDate(opportunities)
  const filteredOrders = filterByDate(orders)

  // ── Stats ──
  const now = new Date()
  const thisMonthOrders = filteredOrders.filter(o => {
    const d = new Date(o.created_at)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  })
  const thisMonthRevenue = thisMonthOrders.reduce((sum, o) => sum + (o.total || 0), 0)

  const wonOpps = filteredOpportunities.filter(o => o.stage === '贏單')
  const totalOpps = filteredOpportunities.length
  const conversionRate = totalOpps > 0 ? Math.round(wonOpps.length / totalOpps * 100) : 0

  // Average days to close (mock: based on created_at to updated_at for won deals)
  const avgCloseDays = wonOpps.length > 0
    ? Math.round(wonOpps.reduce((sum, o) => {
        const created = new Date(o.created_at)
        const updated = new Date(o.updated_at || o.created_at)
        return sum + Math.max(1, Math.round((updated - created) / (1000 * 60 * 60 * 24)))
      }, 0) / wonOpps.length)
    : 0

  // ── Chart 1: Monthly Revenue Trend (past 6 months) ──
  const monthLabels = []
  const monthData = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const year = d.getFullYear()
    const month = d.getMonth()
    monthLabels.push(`${year}/${String(month + 1).padStart(2, '0')}`)
    const monthRevenue = filteredOrders
      .filter(o => {
        const od = new Date(o.created_at)
        return od.getFullYear() === year && od.getMonth() === month
      })
      .reduce((sum, o) => sum + (o.total || 0), 0)
    monthData.push(monthRevenue)
  }

  // Forecast next month: 3-month weighted moving average
  const forecastNext = monthData.length >= 3 && (monthData[5] + monthData[4] + monthData[3]) > 0
    ? Math.round(monthData[5] * 0.5 + monthData[4] * 0.3 + monthData[3] * 0.2)
    : Math.round(thisMonthRevenue * 1.05)

  const revenueLineData = {
    labels: monthLabels,
    datasets: [{
      label: '月度營收 (NT$)',
      data: monthData,
      borderColor: chartColors.cyan,
      backgroundColor: 'rgba(34, 211, 238, 0.1)',
      fill: true,
      tension: 0.4,
      pointRadius: 5,
      pointBackgroundColor: chartColors.cyan,
      pointBorderColor: '#0f172a',
      pointBorderWidth: 2,
    }],
  }

  // ── Chart 2: Sales Funnel Conversion ──
  const stages = ['初步接觸', '需求分析', '報價', '議價', '贏單']
  const stageCounts = stages.map(stage => filteredOpportunities.filter(o => o.stage === stage).length)

  const funnelBarData = {
    labels: stages,
    datasets: [{
      label: '商機數量',
      data: stageCounts,
      backgroundColor: [chartColors.blue, chartColors.cyan, chartColors.purple, chartColors.orange, chartColors.green],
      borderRadius: 8,
      borderSkipped: false,
      barThickness: 36,
    }],
  }

  // ── Chart 3: Customer Source Distribution ──
  const sourceMap = {}
  filteredOpportunities.forEach(o => {
    const key = o.pipeline_id || '未分類'
    sourceMap[key] = (sourceMap[key] || 0) + 1
  })
  const allSourceColors = [chartColors.cyan, chartColors.green, chartColors.purple, chartColors.orange, chartColors.pink, chartColors.blue, chartColors.yellow, chartColors.red]
  const sourceEntries = Object.entries(sourceMap).sort((a, b) => b[1] - a[1])
  const sourceLabels = sourceEntries.length > 0 ? sourceEntries.map(([k]) => k) : ['無資料']
  const sourceData = sourceEntries.length > 0 ? sourceEntries.map(([, v]) => v) : [1]
  const sourceColors = sourceLabels.map((_, i) => allSourceColors[i % allSourceColors.length])

  const sourceDoughnutData = {
    labels: sourceLabels,
    datasets: [{
      data: sourceData,
      backgroundColor: sourceColors,
      borderWidth: 0,
      hoverOffset: 6,
    }],
  }

  const handleExportCSV = () => {
    const exportData = opportunities.map(o => ({
      name: o.name || '',
      customer: o.customer_name || '',
      stage: o.stage || '',
      amount: o.amount || 0,
      probability: o.probability || 0,
      created_at: o.created_at ? o.created_at.slice(0, 10) : '',
    }))
    exportToCSV(exportData, [
      { key: 'name', label: '商機名稱' },
      { key: 'customer', label: '客戶' },
      { key: 'stage', label: '階段' },
      { key: 'amount', label: '金額' },
      { key: 'probability', label: '成交機率 (%)' },
      { key: 'created_at', label: '建立日期' },
    ], `銷售預測_商機_${new Date().toISOString().slice(0, 10)}`)
  }

  return (
    <div className="fade-in" id="sales-forecast-page">
      <div className="page-header">
        <h2><span className="header-icon">🔮</span> 銷售預測</h2>
        <p>營收趨勢分析與銷售預測</p>
        <div className="export-btn-group" style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-primary" onClick={handleExportCSV} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download size={15} /> 匯出 CSV
          </button>
          <button className="btn btn-primary" onClick={() => exportToPDF('sales-forecast-page', '銷售預測')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Printer size={15} /> 列印報表
          </button>
        </div>
      </div>

      <DateRangePicker value={dateRange} onChange={setDateRange} />

      {/* ── Stats Row ── */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">本月營收</div>
          <div className="stat-card-value">NT$ {thisMonthRevenue.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">預測下月</div>
          <div className="stat-card-value">NT$ {forecastNext.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">漏斗轉化率</div>
          <div className="stat-card-value">{conversionRate}%</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">平均成交天數</div>
          <div className="stat-card-value">{avgCloseDays} 天</div>
        </div>
      </div>

      {/* ── Charts Row 1 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Revenue Trend */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><TrendingUp size={14} /></span> 月度營收趨勢</div>
          </div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Line
              data={revenueLineData}
              options={{
                ...chartDefaults,
                scales: {
                  x: {
                    grid: { color: 'rgba(148,163,184,0.06)' },
                    ticks: { color: '#64748b', font: { size: 11 } },
                  },
                  y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(148,163,184,0.06)' },
                    ticks: {
                      color: '#64748b',
                      font: { size: 11 },
                      callback: (v) => `NT$ ${(v / 1000).toFixed(0)}K`,
                    },
                  },
                },
              }}
            />
          </div>
        </div>

        {/* Sales Funnel */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Target size={14} /></span> 銷售漏斗轉化率</div>
          </div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar
              data={funnelBarData}
              options={{
                ...chartDefaults,
                indexAxis: 'y',
                plugins: { ...chartDefaults.plugins, legend: { display: false } },
                scales: {
                  x: {
                    beginAtZero: true,
                    grid: { color: 'rgba(148,163,184,0.06)' },
                    ticks: { color: '#64748b', font: { size: 11 }, stepSize: 1 },
                  },
                  y: {
                    grid: { display: false },
                    ticks: { color: '#64748b', font: { size: 12, weight: 600 } },
                  },
                },
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Charts Row 2 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginBottom: 16 }}>
        {/* Customer Source Doughnut */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><PieChart size={14} /></span> 客戶來源分布</div>
          </div>
          <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px 8px' }}>
            <Doughnut
              data={sourceDoughnutData}
              options={{
                ...chartDefaults,
                cutout: '60%',
                plugins: {
                  ...chartDefaults.plugins,
                  legend: { ...chartDefaults.plugins.legend, position: 'bottom' },
                },
              }}
            />
          </div>
        </div>

        {/* Summary insights */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📊</span> 分析摘要</div>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ padding: 16, borderRadius: 12, background: 'rgba(34, 211, 238, 0.05)', border: '1px solid rgba(34, 211, 238, 0.1)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>總商機數</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>{totalOpps}</div>
              </div>
              <div style={{ padding: 16, borderRadius: 12, background: 'rgba(52, 211, 153, 0.05)', border: '1px solid rgba(52, 211, 153, 0.1)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>已贏單</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>{wonOpps.length}</div>
              </div>
              <div style={{ padding: 16, borderRadius: 12, background: 'rgba(167, 139, 250, 0.05)', border: '1px solid rgba(167, 139, 250, 0.1)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>總訂單數</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>{orders.length}</div>
              </div>
              <div style={{ padding: 16, borderRadius: 12, background: 'rgba(251, 146, 60, 0.05)', border: '1px solid rgba(251, 146, 60, 0.1)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>累計營收</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>NT$ {orders.reduce((s, o) => s + (o.total || 0), 0).toLocaleString()}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
