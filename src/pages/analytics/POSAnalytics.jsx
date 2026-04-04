import { useState, useEffect } from 'react'
import { Download, Printer } from 'lucide-react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import { supabase } from '../../lib/supabase'
import { exportToCSV, exportToPDF } from '../../lib/exportUtils'
import LoadingSpinner from '../../components/LoadingSpinner'
import DateRangePicker from '../../components/DateRangePicker'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler)

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

export default function POSAnalytics() {
  const [transactions, setTransactions] = useState([])
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dateRange, setDateRange] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('pos_transactions').select('*'),
      supabase.from('pos_shifts').select('*'),
    ]).then(([txRes, shRes]) => {
      setTransactions(txRes.data || [])
      setShifts(shRes.data || [])
    }).catch(err => {
      console.error('Failed to load POS data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => setLoading(false))
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

  const filtered = filterByDate(transactions)
  const completed = filtered.filter(t => t.status === 'completed')
  const refunded = filtered.filter(t => t.status === 'refunded')

  // ── KPI ──
  const totalRevenue = completed.reduce((s, t) => s + (t.total || 0), 0)
  const txCount = completed.length
  const avgTicket = txCount > 0 ? Math.round(totalRevenue / txCount) : 0
  const refundCount = refunded.length
  const refundAmount = refunded.reduce((s, t) => s + (t.total || 0), 0)
  const today = new Date().toISOString().slice(0, 10)
  const todayRevenue = completed.filter(t => (t.created_at || '').slice(0, 10) === today).reduce((s, t) => s + (t.total || 0), 0)

  const fmt = (n) => n.toLocaleString('zh-TW')

  const kpis = [
    { label: '總營業額', value: `NT$ ${fmt(totalRevenue)}`, color: colors.cyan },
    { label: '交易筆數', value: fmt(txCount), color: colors.blue },
    { label: '平均客單價', value: `NT$ ${fmt(avgTicket)}`, color: colors.purple },
    { label: '退貨筆數', value: fmt(refundCount), color: colors.red },
    { label: '退貨金額', value: `NT$ ${fmt(refundAmount)}`, color: colors.orange },
    { label: '今日營收', value: `NT$ ${fmt(todayRevenue)}`, color: colors.green },
  ]

  // ── Chart 1: Daily Sales Trend ──
  const dailyMap = {}
  completed.forEach(t => {
    const d = (t.created_at || '').slice(0, 10)
    dailyMap[d] = (dailyMap[d] || 0) + (t.total || 0)
  })
  const dailyLabels = Object.keys(dailyMap).sort()
  const dailySalesData = {
    labels: dailyLabels,
    datasets: [{
      label: '每日營業額 (NT$)',
      data: dailyLabels.map(d => dailyMap[d]),
      borderColor: colors.cyan,
      backgroundColor: 'rgba(34,211,238,0.10)',
      fill: true, tension: 0.4, pointRadius: 3,
      pointBackgroundColor: colors.cyan, pointBorderColor: '#0f172a', pointBorderWidth: 2,
    }],
  }

  // ── Chart 2: Hourly Sales Heatmap ──
  const hourlyTotals = Array(24).fill(0)
  completed.forEach(t => {
    const h = new Date(t.created_at).getHours()
    hourlyTotals[h] += (t.total || 0)
  })
  const hourlyBarData = {
    labels: Array.from({ length: 24 }, (_, i) => `${i}時`),
    datasets: [{
      label: '時段營業額 (NT$)',
      data: hourlyTotals,
      backgroundColor: hourlyTotals.map((v, i) => i >= 11 && i <= 13 || i >= 17 && i <= 19 ? colors.cyan : colors.blue),
      borderRadius: 6, borderSkipped: false,
    }],
  }

  // ── Chart 3: Top 10 Products ──
  const productMap = {}
  completed.forEach(t => {
    ;(t.items || []).forEach(item => {
      const name = item.name || item.product_name || '未知商品'
      productMap[name] = (productMap[name] || 0) + (item.quantity || 1)
    })
  })
  const topProducts = Object.entries(productMap).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const topProductsData = {
    labels: topProducts.map(p => p[0]),
    datasets: [{
      label: '銷售數量',
      data: topProducts.map(p => p[1]),
      backgroundColor: [colors.cyan, colors.blue, colors.purple, colors.green, colors.orange, colors.pink, colors.yellow, colors.red, colors.cyan, colors.blue],
      borderRadius: 6, borderSkipped: false,
    }],
  }

  // ── Chart 4: Payment Method Breakdown ──
  const paymentMap = { '現金': 0, '信用卡': 0, 'LINE Pay': 0, '行動支付': 0 }
  completed.forEach(t => {
    const method = t.payment_method || '現金'
    if (method in paymentMap) paymentMap[method] += (t.total || 0)
    else paymentMap['現金'] += (t.total || 0)
  })
  const paymentLabels = Object.keys(paymentMap)
  const paymentData = {
    labels: paymentLabels,
    datasets: [{
      data: paymentLabels.map(k => paymentMap[k]),
      backgroundColor: [colors.green, colors.blue, colors.cyan, colors.purple],
      borderWidth: 0, hoverOffset: 8,
    }],
  }

  // ── Chart 5: Avg Transaction Value Trend (Monthly) ──
  const monthlyAvg = {}
  completed.forEach(t => {
    const m = (t.created_at || '').slice(0, 7)
    if (!monthlyAvg[m]) monthlyAvg[m] = { sum: 0, count: 0 }
    monthlyAvg[m].sum += (t.total || 0)
    monthlyAvg[m].count += 1
  })
  const avgMonthLabels = Object.keys(monthlyAvg).sort()
  const avgTxData = {
    labels: avgMonthLabels,
    datasets: [{
      label: '平均客單價 (NT$)',
      data: avgMonthLabels.map(m => Math.round(monthlyAvg[m].sum / monthlyAvg[m].count)),
      borderColor: colors.purple,
      backgroundColor: 'rgba(167,139,250,0.10)',
      fill: true, tension: 0.4, pointRadius: 4,
      pointBackgroundColor: colors.purple, pointBorderColor: '#0f172a', pointBorderWidth: 2,
    }],
  }

  // ── Chart 6: Peak Hours (Transaction Count) ──
  const hourlyCounts = Array(24).fill(0)
  completed.forEach(t => {
    const h = new Date(t.created_at).getHours()
    hourlyCounts[h] += 1
  })
  const peakHoursData = {
    labels: Array.from({ length: 24 }, (_, i) => `${i}時`),
    datasets: [{
      label: '交易筆數',
      data: hourlyCounts,
      backgroundColor: colors.orange,
      borderRadius: 6, borderSkipped: false,
    }],
  }

  // ── Export ──
  const handleCSV = () => {
    const rows = completed.map(t => ({ date: (t.created_at || '').slice(0, 10), total: t.total, payment: t.payment_method, status: t.status }))
    exportToCSV(rows, [
      { key: 'date', label: '日期' }, { key: 'total', label: '金額' },
      { key: 'payment', label: '付款方式' }, { key: 'status', label: '狀態' },
    ], 'POS分析報表')
  }

  const lineOpts = { ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle } } }
  const barOpts = { ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle } } }
  const hBarOpts = { ...chartOpts, indexAxis: 'y', scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { grid: gridStyle, ticks: tickStyle } } }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>🛒 POS 分析</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleCSV}><Download size={15} style={{ marginRight: 4 }} />匯出 CSV</button>
          <button className="btn btn-primary" onClick={() => exportToPDF('POS分析報表')}><Printer size={15} style={{ marginRight: 4 }} />列印 PDF</button>
        </div>
      </div>

      <DateRangePicker onChange={setDateRange} />

      <div className="stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16 }}>
        {kpis.map(k => (
          <div key={k.label} className="stat-card" style={{ borderTop: `3px solid ${k.color}` }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="card">
          <div className="card-header"><h3 className="card-title">每日營業額趨勢</h3></div>
          <div style={{ height: 280 }}><Line data={dailySalesData} options={lineOpts} /></div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="card-title">時段營業額分佈</h3></div>
          <div style={{ height: 280 }}><Bar data={hourlyBarData} options={barOpts} /></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="card">
          <div className="card-header"><h3 className="card-title">熱銷商品 Top 10</h3></div>
          <div style={{ height: 320 }}><Bar data={topProductsData} options={hBarOpts} /></div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="card-title">付款方式佔比</h3></div>
          <div style={{ height: 320 }}><Doughnut data={paymentData} options={chartOpts} /></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="card">
          <div className="card-header"><h3 className="card-title">平均客單價趨勢（月）</h3></div>
          <div style={{ height: 280 }}><Line data={avgTxData} options={lineOpts} /></div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="card-title">尖峰時段分析</h3></div>
          <div style={{ height: 280 }}><Bar data={peakHoursData} options={barOpts} /></div>
        </div>
      </div>
    </div>
  )
}
