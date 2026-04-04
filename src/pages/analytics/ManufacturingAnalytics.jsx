import { useState, useEffect } from 'react'
import { Download, Printer } from 'lucide-react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
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

export default function ManufacturingAnalytics() {
  const [orders, setOrders] = useState([])
  const [inspections, setInspections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dateRange, setDateRange] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('manufacturing_orders').select('*'),
      supabase.from('quality_inspections').select('*'),
    ]).then(([mo, qi]) => {
      setOrders(mo.data || [])
      setInspections(qi.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
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

  const fo = filterByDate(orders)
  const fi = filterByDate(inspections)

  // ── KPI Stats ──
  const totalOrders = fo.length
  const completedOrders = fo.filter(o => o.status === '完成').length
  const completionRate = totalOrders > 0 ? Math.round(completedOrders / totalOrders * 100) : 0
  const totalQty = fo.reduce((s, o) => s + (o.quantity || 0), 0)
  const goodQty = fo.reduce((s, o) => s + (o.completed_qty || 0), 0)
  const oee = totalOrders > 0 && totalQty > 0 ? Math.round((completedOrders / totalOrders) * (goodQty / totalQty) * 100) : 0
  const totalInspected = fi.reduce((s, q) => s + (q.total_qty || 0), 0)
  const totalPassed = fi.reduce((s, q) => s + (q.passed_qty || 0), 0)
  const yieldRate = totalInspected > 0 ? Math.round(totalPassed / totalInspected * 1000) / 10 : 0
  const wipCount = fo.filter(o => o.status !== '完成' && o.status !== '取消').length
  const completedWithDates = fo.filter(o => o.start_date && o.end_date)
  const avgCycle = completedWithDates.length > 0
    ? Math.round(completedWithDates.reduce((s, o) => s + Math.max(1, Math.round((new Date(o.end_date) - new Date(o.start_date)) / 86400000)), 0) / completedWithDates.length * 10) / 10
    : 0

  // ── Month helpers (past 6 months) ──
  const now = new Date()
  const monthLabels = []
  const months = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthLabels.push(`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`)
    months.push({ y: d.getFullYear(), m: d.getMonth() })
  }
  const byMonth = (arr, field = 'created_at') => months.map(({ y, m }) => arr.filter(r => { const d = new Date(r[field]); return d.getFullYear() === y && d.getMonth() === m }))

  // ── Chart 1: OEE Trend ──
  const moByMonth = byMonth(fo)
  const oeeData = moByMonth.map(group => {
    const tot = group.length
    const done = group.filter(o => o.status === '完成').length
    const tq = group.reduce((s, o) => s + (o.quantity || 0), 0)
    const gq = group.reduce((s, o) => s + (o.completed_qty || 0), 0)
    return tot > 0 && tq > 0 ? Math.round((done / tot) * (gq / tq) * 100 * 10) / 10 : 0
  })
  const oeeChartData = {
    labels: monthLabels,
    datasets: [{ label: 'OEE (%)', data: oeeData, borderColor: colors.cyan, backgroundColor: 'rgba(34,211,238,0.1)', fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: colors.cyan, pointBorderColor: '#0f172a', pointBorderWidth: 2 }],
  }

  // ── Chart 2: Yield Rate Trend ──
  const qiByMonth = byMonth(fi)
  const yieldData = qiByMonth.map(group => {
    const ti = group.reduce((s, q) => s + (q.total_qty || 0), 0)
    const tp = group.reduce((s, q) => s + (q.passed_qty || 0), 0)
    return ti > 0 ? Math.round(tp / ti * 1000) / 10 : 0
  })
  const yieldChartData = {
    labels: monthLabels,
    datasets: [{ label: '良率 (%)', data: yieldData, borderColor: colors.green, backgroundColor: 'rgba(52,211,153,0.1)', fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: colors.green, pointBorderColor: '#0f172a', pointBorderWidth: 2 }],
  }

  // ── Chart 3: WIP Value by Status ──
  const wipStatuses = ['排程中', '生產中', '待檢', '完成']
  const wipCounts = wipStatuses.map(st => fo.filter(o => o.status === st).length)
  const wipChartData = {
    labels: wipStatuses,
    datasets: [{ label: '工單數', data: wipCounts, backgroundColor: [colors.blue, colors.orange, colors.purple, colors.green], borderRadius: 8, borderSkipped: false, barThickness: 36 }],
  }

  // ── Chart 4: Defect Rate by Product ──
  const productDefects = {}
  fi.forEach(q => {
    const p = q.product || '未分類'
    if (!productDefects[p]) productDefects[p] = { total: 0, failed: 0 }
    productDefects[p].total += (q.total_qty || 0)
    productDefects[p].failed += (q.failed_qty || 0)
  })
  const defectEntries = Object.entries(productDefects).sort((a, b) => (b[1].failed / b[1].total) - (a[1].failed / a[1].total)).slice(0, 8)
  const defectChartData = {
    labels: defectEntries.map(([k]) => k),
    datasets: [{ label: '不良率 (%)', data: defectEntries.map(([, v]) => v.total > 0 ? Math.round(v.failed / v.total * 1000) / 10 : 0), backgroundColor: colors.red, borderRadius: 8, borderSkipped: false, barThickness: 28 }],
  }

  // ── Chart 5: Production Volume Trend ──
  const volumeData = moByMonth.map(group => group.filter(o => o.status === '完成').reduce((s, o) => s + (o.completed_qty || 0), 0))
  const volumeChartData = {
    labels: monthLabels,
    datasets: [{ label: '完成數量', data: volumeData, borderColor: colors.blue, backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: colors.blue, pointBorderColor: '#0f172a', pointBorderWidth: 2 }],
  }

  // ── Chart 6: Cycle Time by Month ──
  const cycleData = moByMonth.map(group => {
    const withDates = group.filter(o => o.start_date && o.end_date)
    if (withDates.length === 0) return 0
    return Math.round(withDates.reduce((s, o) => s + Math.max(1, Math.round((new Date(o.end_date) - new Date(o.start_date)) / 86400000)), 0) / withDates.length * 10) / 10
  })
  const cycleChartData = {
    labels: monthLabels,
    datasets: [{ label: '平均天數', data: cycleData, backgroundColor: colors.purple, borderRadius: 8, borderSkipped: false, barThickness: 28 }],
  }

  const lineOpts = (label) => ({ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: { ...tickStyle, callback: v => `${v}${label}` } } } })
  const barOpts = (hideL) => ({ ...chartOpts, plugins: { ...chartOpts.plugins, legend: { display: !hideL } }, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: tickStyle } } })

  const handleExportCSV = () => {
    const data = orders.map(o => ({ product: o.product || '', quantity: o.quantity || 0, completed_qty: o.completed_qty || 0, status: o.status || '', start_date: (o.start_date || '').slice(0, 10), end_date: (o.end_date || '').slice(0, 10) }))
    exportToCSV(data, [
      { key: 'product', label: '產品' }, { key: 'quantity', label: '數量' }, { key: 'completed_qty', label: '完成數量' },
      { key: 'status', label: '狀態' }, { key: 'start_date', label: '開始日期' }, { key: 'end_date', label: '結束日期' },
    ], `製造分析_${new Date().toISOString().slice(0, 10)}`)
  }

  return (
    <div className="fade-in" id="manufacturing-analytics-page">
      <div className="page-header">
        <h2><span className="header-icon">🏭</span> 製造分析</h2>
        <p>生產效率、良率與產能趨勢分析</p>
        <div className="export-btn-group" style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-primary" onClick={handleExportCSV} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={15} /> 匯出 CSV</button>
          <button className="btn btn-primary" onClick={() => exportToPDF('manufacturing-analytics-page', '製造分析')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Printer size={15} /> 列印報表</button>
        </div>
      </div>

      <DateRangePicker value={dateRange} onChange={setDateRange} />

      {/* ── KPI Cards ── */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">生產工單數</div>
          <div className="stat-card-value">{totalOrders}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">完成率</div>
          <div className="stat-card-value">{completionRate}%</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">OEE 綜效</div>
          <div className="stat-card-value">{oee}%</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">良率</div>
          <div className="stat-card-value">{yieldRate}%</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">在製品(WIP)數量</div>
          <div className="stat-card-value">{wipCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">平均生產週期(天)</div>
          <div className="stat-card-value">{avgCycle}</div>
        </div>
      </div>

      {/* ── Charts Row 1: OEE + Yield ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">📈 OEE 趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Line data={oeeChartData} options={lineOpts('%')} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">✅ 良率趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Line data={yieldChartData} options={lineOpts('%')} />
          </div>
        </div>
      </div>

      {/* ── Charts Row 2: WIP + Defect ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">🔄 在製品(WIP)狀態分布</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar data={wipChartData} options={barOpts(true)} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">⚠ 各產品不良率</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar data={defectChartData} options={barOpts(true)} />
          </div>
        </div>
      </div>

      {/* ── Charts Row 3: Volume + Cycle Time ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">📦 生產量趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Line data={volumeChartData} options={lineOpts('')} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">⏱ 生產週期趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar data={cycleChartData} options={barOpts(true)} />
          </div>
        </div>
      </div>
    </div>
  )
}
