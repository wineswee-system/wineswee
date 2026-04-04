import { useState, useEffect } from 'react'
import { Download, Printer } from 'lucide-react'
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler } from 'chart.js'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import { supabase } from '../../lib/supabase'
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

export default function HRAnalytics() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dateRange, setDateRange] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('employees').select('*'),
      supabase.from('overtime_records').select('*'),
      supabase.from('leave_records').select('*'),
      supabase.from('recruitment').select('*'),
    ]).then(([emp, ot, leave, recruit]) => {
      setData({
        employees: emp.data || [],
        overtime: ot.data || [],
        leave: leave.data || [],
        recruitment: recruit.data || [],
      })
    }).catch(err => {
      console.error('Failed to load HR data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filterByDate = (arr, field = 'created_at') => {
    if (!dateRange) return arr
    return arr.filter(r => {
      const d = (r[field] || r.created_at || '').slice(0, 10)
      return d >= dateRange.startDate && d <= dateRange.endDate
    })
  }

  const d = {
    employees: data.employees,
    overtime: filterByDate(data.overtime, 'date'),
    leave: filterByDate(data.leave, 'start_date'),
    recruitment: filterByDate(data.recruitment),
  }

  // KPI calculations
  const activeEmp = d.employees.filter(e => e.status === '在職').length
  const totalEmp = d.employees.length
  const now = new Date()
  const thisMonth = now.toISOString().slice(0, 7)
  const terminated = d.employees.filter(e => e.status === '離職' && (e.termination_date || '').slice(0, 7) === thisMonth).length
  const turnoverRate = totalEmp > 0 ? ((terminated / totalEmp) * 100).toFixed(1) : '0.0'
  const monthOTHours = d.overtime.filter(r => (r.date || '').slice(0, 7) === thisMonth).reduce((s, r) => s + (r.hours || 0), 0)
  const monthOTCost = d.overtime.filter(r => (r.date || '').slice(0, 7) === thisMonth).reduce((s, r) => s + (r.amount || 0), 0)
  const totalLeaveDays = d.leave.reduce((s, r) => s + (r.days || 0), 0)
  const leaveUtilization = activeEmp > 0 ? (totalLeaveDays / activeEmp).toFixed(1) : '0'
  const openPositions = d.recruitment.filter(r => r.stage !== '到職').length

  // Last 6 months helper
  const months = Array.from({ length: 6 }, (_, i) => {
    const dt = new Date(); dt.setMonth(dt.getMonth() - (5 - i)); return dt.toISOString().slice(0, 7)
  })
  const monthLabels = months.map(m => m.slice(5) + '月')

  // Headcount Trend — count employees hired on or before each month-end who are still active
  const headcountData = {
    labels: monthLabels,
    datasets: [{
      label: '在職人數', data: months.map(m => {
        const end = new Date(m + '-01'); end.setMonth(end.getMonth() + 1); end.setDate(0)
        const endStr = end.toISOString().slice(0, 10)
        return data.employees.filter(e => (e.hire_date || '') <= endStr && (e.status === '在職' || (e.termination_date || '') > endStr)).length
      }),
      borderColor: colors.cyan, backgroundColor: 'rgba(34,211,238,0.08)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: colors.cyan,
    }],
  }

  // Turnover Rate Trend
  const turnoverData = {
    labels: monthLabels,
    datasets: [{
      label: '離職率 (%)', data: months.map(m => {
        const total = data.employees.filter(e => (e.hire_date || '').slice(0, 7) <= m).length
        const termed = data.employees.filter(e => e.status === '離職' && (e.termination_date || '').slice(0, 7) === m).length
        return total > 0 ? parseFloat(((termed / total) * 100).toFixed(1)) : 0
      }),
      borderColor: colors.red, backgroundColor: 'rgba(248,113,113,0.08)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: colors.red,
    }],
  }

  // Overtime Cost Trend
  const otHoursByMonth = {}; const otCostByMonth = {}
  months.forEach(m => { otHoursByMonth[m] = 0; otCostByMonth[m] = 0 })
  data.overtime.forEach(r => {
    const m = (r.date || '').slice(0, 7)
    if (otHoursByMonth[m] !== undefined) { otHoursByMonth[m] += (r.hours || 0); otCostByMonth[m] += (r.amount || 0) }
  })
  const overtimeData = {
    labels: monthLabels,
    datasets: [
      { label: '加班時數', data: months.map(m => otHoursByMonth[m]), backgroundColor: colors.blue + '99', borderRadius: 6, barThickness: 20, yAxisID: 'y' },
      { label: '加班費用', data: months.map(m => otCostByMonth[m]), backgroundColor: colors.orange + '99', borderRadius: 6, barThickness: 20, yAxisID: 'y1' },
    ],
  }

  // Leave Utilization by type (Doughnut)
  const leaveByType = {}
  data.leave.forEach(r => { const t = r.leave_type || '其他'; leaveByType[t] = (leaveByType[t] || 0) + (r.days || 0) })
  const leaveLabels = Object.keys(leaveByType)
  const leaveColors = [colors.blue, colors.green, colors.purple, colors.orange, colors.pink, colors.yellow, colors.cyan, colors.red]
  const leaveData = {
    labels: leaveLabels,
    datasets: [{ data: leaveLabels.map(t => leaveByType[t]), backgroundColor: leaveLabels.map((_, i) => leaveColors[i % leaveColors.length]), borderWidth: 0 }],
  }

  // Department Headcount
  const deptCount = {}
  data.employees.filter(e => e.status === '在職').forEach(e => { const dep = e.department || '未分類'; deptCount[dep] = (deptCount[dep] || 0) + 1 })
  const deptLabels = Object.keys(deptCount)
  const deptData = {
    labels: deptLabels,
    datasets: [{ label: '人數', data: deptLabels.map(d => deptCount[d]), backgroundColor: deptLabels.map((_, i) => leaveColors[i % leaveColors.length]), borderRadius: 6, barThickness: 28 }],
  }

  // Recruitment Funnel
  const recruitStages = ['投遞', '面試', '錄取', '到職']
  const recruitData = {
    labels: recruitStages,
    datasets: [{ label: '人數', data: recruitStages.map(s => d.recruitment.filter(r => r.stage === s).length), backgroundColor: [colors.blue, colors.purple, colors.orange, colors.green], borderRadius: 6, barThickness: 28 }],
  }

  const handleExportCSV = () => {
    const kpiRows = [
      { label: '在職人數', value: activeEmp },
      { label: '月離職率 (%)', value: turnoverRate },
      { label: '本月加班時數', value: monthOTHours },
      { label: '加班費用', value: monthOTCost },
      { label: '人均請假天數', value: leaveUtilization },
      { label: '招募中職位', value: openPositions },
    ]
    exportToCSV(kpiRows, [
      { key: 'label', label: '指標' },
      { key: 'value', label: '數值' },
    ], `人資分析_${new Date().toISOString().slice(0, 10)}`)
  }

  return (
    <div className="fade-in" id="hr-analytics-page">
      <div className="page-header">
        <h2><span className="header-icon">👥</span> 人資分析</h2>
        <p>人力資源數據整合分析</p>
        <div className="export-btn-group" style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-primary" onClick={handleExportCSV} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download size={15} /> 匯出 CSV
          </button>
          <button className="btn btn-primary" onClick={() => exportToPDF('hr-analytics-page', '人資分析')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Printer size={15} /> 列印報表
          </button>
        </div>
      </div>

      <DateRangePicker value={dateRange} onChange={setDateRange} />

      {/* KPI */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {[
          { label: '在職人數', value: activeEmp, color: 'cyan' },
          { label: '月離職率', value: `${turnoverRate}%`, color: parseFloat(turnoverRate) > 5 ? 'red' : 'green' },
          { label: '本月加班時數', value: `${monthOTHours}h`, color: 'blue' },
          { label: '加班費用', value: `NT$${(monthOTCost / 1000).toFixed(0)}K`, color: 'orange' },
          { label: '請假利用率', value: `${leaveUtilization}天/人`, color: 'purple' },
          { label: '招募中職位', value: openPositions, color: openPositions > 0 ? 'yellow' : 'green' },
        ].map((s, i) => (
          <div key={i} className="stat-card" style={{ '--card-accent': `var(--accent-${s.color})`, '--card-accent-dim': `var(--accent-${s.color}-dim)` }}>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Charts Row 1 — Headcount & Turnover */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">📈 在職人數趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Line data={headcountData} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: { ...tickStyle, stepSize: 1 } } } }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">📉 離職率趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Line data={turnoverData} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
      </div>

      {/* Charts Row 2 — Overtime & Leave */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">⏰ 加班時數與費用趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar data={overtimeData} options={{ ...chartOpts, scales: { x: { grid: { display: false }, ticks: tickStyle }, y: { beginAtZero: true, position: 'left', grid: gridStyle, ticks: tickStyle, title: { display: true, text: '時數', color: '#64748b' } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: tickStyle, title: { display: true, text: '費用 (NT$)', color: '#64748b' } } } }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">🏖️ 請假類型分布</div></div>
          <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px 8px' }}>
            <Doughnut data={leaveData} options={{ ...chartOpts, cutout: '55%', plugins: { ...chartOpts.plugins, legend: { ...chartOpts.plugins.legend, position: 'bottom' } } }} />
          </div>
        </div>
      </div>

      {/* Charts Row 3 — Department & Recruitment */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">🏢 部門人數分布</div></div>
          <div style={{ height: 260, padding: '0 8px 8px' }}>
            <Bar data={deptData} options={{ ...chartOpts, plugins: { ...chartOpts.plugins, legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: { ...tickStyle, stepSize: 1 } } } }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">🎯 招募漏斗</div></div>
          <div style={{ height: 260, padding: '0 8px 8px' }}>
            <Bar data={recruitData} options={{ ...chartOpts, plugins: { ...chartOpts.plugins, legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: { ...tickStyle, stepSize: 1 } } } }} />
          </div>
        </div>
      </div>
    </div>
  )
}
