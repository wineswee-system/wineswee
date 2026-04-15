import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Download, Printer, ArrowLeftRight, Filter, X } from 'lucide-react'
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler } from 'chart.js'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import { calculateProfitability } from '../lib/automation'
import { exportToCSV, exportToPDF } from '../lib/exportUtils'
import LoadingSpinner from '../components/LoadingSpinner'
import DateRangePicker from '../components/DateRangePicker'

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

const btnToggle = (active) => ({
  padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
  background: active ? 'var(--accent-cyan)' : 'var(--bg-elevated)', color: active ? '#0f172a' : 'var(--text-secondary)',
  transition: 'all 0.15s ease',
})

export default function Analytics() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dateRange, setDateRange] = useState(null)
  const [showComparison, setShowComparison] = useState(false)
  const [deptFilter, setDeptFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [drillDown, setDrillDown] = useState(null)

  useEffect(() => {
    const month = new Date().toISOString().slice(0, 7)
    Promise.all([
      supabase.from('employees').select('*'),
      supabase.from('tasks').select('*'),
      supabase.from('attendance_records').select('*'),
      supabase.from('opportunities').select('*'),
      supabase.from('stock_levels').select('*'),
      supabase.from('accounts_receivable').select('*'),
      supabase.from('accounts_payable').select('*'),
      supabase.from('salary_records').select('*').eq('month', month),
      calculateProfitability(month),
      supabase.from('departments').select('id, name'),
    ]).then(([emp, tasks, att, opps, stock, ar, ap, sal, profit, depts]) => {
      setData({
        employees: emp.data || [], tasks: tasks.data || [], attendance: att.data || [],
        opportunities: opps.data || [], stock: stock.data || [],
        ar: ar.data || [], ap: ap.data || [], salary: sal.data || [],
        profit: profit || { revenue: 0, totalCost: 0, grossProfit: 0, grossMargin: 0 },
        departments: depts.data || [],
      })
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const handlePipelineClick = useCallback((_, elements) => {
    if (!data || !elements?.length) return
    const stages = ['初步接觸', '需求分析', '報價', '議價', '贏單', '輸單']
    const idx = elements[0].index
    const stage = stages[idx]
    const opps = data.opportunities || []
    const rows = opps.filter(o => o.stage === stage).map(o => ({ title: o.title || o.customer_name, amount: `NT$ ${(o.amount || 0).toLocaleString()}`, assignee: o.assignee || '-', date: (o.created_at || '').slice(0, 10) }))
    setDrillDown({ title: `銷售漏斗 → ${stage}（${rows.length} 筆）`, rows, columns: [{ key: 'title', label: '商機' }, { key: 'amount', label: '金額' }, { key: 'assignee', label: '負責人' }, { key: 'date', label: '建立日期' }] })
  }, [data])

  const handleARAgingClick = useCallback((_, elements) => {
    if (!data || !elements?.length) return
    const labels = ['未到期', '1-30天', '31-60天', '60天+']
    const bucketLabel = labels[elements[0].index]
    const today2 = new Date()
    const bucketFilter = (r) => {
      const days = Math.floor((today2 - new Date(r.due_date)) / 86400000)
      const amt = (r.amount || 0) - (r.paid_amount || 0)
      if (amt <= 0) return false
      if (elements[0].index === 0) return days <= 0
      if (elements[0].index === 1) return days > 0 && days <= 30
      if (elements[0].index === 2) return days > 30 && days <= 60
      return days > 60
    }
    const rows = (data.ar || []).filter(r => r.status !== '已收款').filter(bucketFilter).map(r => ({ customer: r.customer_name || '-', amount: `NT$ ${(r.amount || 0).toLocaleString()}`, balance: `NT$ ${((r.amount || 0) - (r.paid_amount || 0)).toLocaleString()}`, due: (r.due_date || '').slice(0, 10) }))
    setDrillDown({ title: `應收帳齡 → ${bucketLabel}（${rows.length} 筆）`, rows, columns: [{ key: 'customer', label: '客戶' }, { key: 'amount', label: '應收金額' }, { key: 'balance', label: '餘額' }, { key: 'due', label: '到期日' }] })
  }, [data])

  const handleStockClick = useCallback((_, elements) => {
    if (!data || !elements?.length) return
    const isLow = elements[0].index === 1
    const rows = (data.stock || []).filter(s => isLow ? (s.quantity || 0) <= (s.min_qty || 10) : (s.quantity || 0) > (s.min_qty || 10)).map(s => ({ name: s.sku_name || s.name || '-', qty: s.quantity || 0, min: s.min_qty || 10, warehouse: s.warehouse || '-' }))
    setDrillDown({ title: `庫存 → ${isLow ? '低庫存' : '正常'}（${rows.length} 筆）`, rows, columns: [{ key: 'name', label: 'SKU' }, { key: 'qty', label: '數量' }, { key: 'min', label: '安全量' }, { key: 'warehouse', label: '倉庫' }] })
  }, [data])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filterByDate = (arr, range) => {
    const r = range || dateRange
    if (!r) return arr
    return arr.filter(rec => {
      const d = (rec.created_at || '').slice(0, 10)
      return d >= r.startDate && d <= r.endDate
    })
  }

  // Previous period calculation for MoM/YoY comparison
  const getPrevRange = () => {
    if (!dateRange) return null
    const start = new Date(dateRange.startDate)
    const end = new Date(dateRange.endDate)
    const diff = end - start
    const prevEnd = new Date(start.getTime() - 86400000)
    const prevStart = new Date(prevEnd.getTime() - diff)
    return { startDate: prevStart.toISOString().slice(0, 10), endDate: prevEnd.toISOString().slice(0, 10) }
  }

  const filterByDept = (arr) => {
    if (!deptFilter) return arr
    return arr.filter(r => String(r.department_id || r.department || '') === deptFilter)
  }

  const filterByCategory = (arr) => {
    if (!categoryFilter) return arr
    return arr.filter(r => (r.category || r.sku_category || '') === categoryFilter)
  }

  const applyFilters = (arr, range) => filterByCategory(filterByDept(filterByDate(arr, range)))

  const d = {
    ...data,
    opportunities: applyFilters(data.opportunities),
    ar: applyFilters(data.ar),
    ap: applyFilters(data.ap),
    tasks: applyFilters(data.tasks),
    attendance: applyFilters(data.attendance),
  }

  // Previous period data for comparison
  const prevRange = getPrevRange()
  const prev = showComparison && prevRange ? {
    ar: filterByDate(data.ar, prevRange),
    ap: filterByDate(data.ap, prevRange),
    opportunities: filterByDate(data.opportunities, prevRange),
  } : null

  // Extract unique categories from stock
  const categories = [...new Set(data.stock.map(s => s.category || s.sku_category).filter(Boolean))]

  const activeEmp = d.employees.filter(e => e.status === '在職').length
  const totalSalary = d.salary.reduce((s, r) => s + (r.net_salary || 0), 0)
  const wonAmount = d.opportunities.filter(o => o.stage === '贏單').reduce((s, o) => s + (o.amount || 0), 0)
  const arTotal = d.ar.reduce((s, r) => s + (r.amount || 0), 0)
  const arPaid = d.ar.reduce((s, r) => s + (r.paid_amount || 0), 0)
  const apTotal = d.ap.reduce((s, r) => s + (r.amount || 0), 0)
  const apPaid = d.ap.reduce((s, r) => s + (r.paid_amount || 0), 0)
  const lowStock = d.stock.filter(s => (s.quantity || 0) <= (s.min_qty || 10)).length

  // CRM Pipeline
  const stages = ['初步接觸', '需求分析', '報價', '議價', '贏單', '輸單']
  const pipelineData = {
    labels: stages,
    datasets: [{ label: '商機數', data: stages.map(s => d.opportunities.filter(o => o.stage === s).length), backgroundColor: [colors.blue, colors.cyan, colors.purple, colors.orange, colors.green, colors.red], borderRadius: 6, barThickness: 28 }],
  }

  // AR Aging
  const today = new Date()
  const arAging = { current: 0, d30: 0, d60: 0, d90: 0 }
  d.ar.filter(r => r.status !== '已收款').forEach(r => {
    const days = Math.floor((today - new Date(r.due_date)) / 86400000)
    const amt = (r.amount || 0) - (r.paid_amount || 0)
    if (days <= 0) arAging.current += amt; else if (days <= 30) arAging.d30 += amt; else if (days <= 60) arAging.d60 += amt; else arAging.d90 += amt
  })
  const arAgingData = {
    labels: ['未到期', '1-30天', '31-60天', '60天+'],
    datasets: [{ data: [arAging.current, arAging.d30, arAging.d60, arAging.d90], backgroundColor: [colors.green, colors.yellow, colors.orange, colors.red], borderWidth: 0 }],
  }

  // Inventory Health
  const stockOk = d.stock.filter(s => (s.quantity || 0) > (s.min_qty || 10)).length
  const stockData = {
    labels: ['正常', '低庫存'],
    datasets: [{ data: [stockOk, lowStock], backgroundColor: [colors.green, colors.red], borderWidth: 0 }],
  }

  // Revenue Trend — real data from AR (revenue) and AP (cost) grouped by month
  const months = (() => {
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
    return Array.from({ length: 6 }, (_, i) => { const dt = new Date(); dt.setMonth(dt.getMonth() - (5 - i)); return dt.toISOString().slice(0, 7) })
  })()
  const revenueByMonth = {}
  const costByMonth = {}
  months.forEach(m => { revenueByMonth[m] = 0; costByMonth[m] = 0 })
  d.ar.forEach(r => { const m = (r.created_at || '').slice(0, 7); if (revenueByMonth[m] !== undefined) revenueByMonth[m] += (r.paid_amount || 0) })
  d.ap.forEach(r => { const m = (r.created_at || '').slice(0, 7); if (costByMonth[m] !== undefined) costByMonth[m] += (r.amount || 0) })

  // Previous period revenue/cost for comparison
  const prevRevenueByMonth = {}
  const prevCostByMonth = {}
  if (prev) {
    months.forEach(m => { prevRevenueByMonth[m] = 0; prevCostByMonth[m] = 0 })
    // Map previous period months to current period month slots
    const prevMonths = (() => {
      const s = new Date(prevRange.startDate)
      const e = new Date(prevRange.endDate)
      const result = []
      const cur = new Date(s.getFullYear(), s.getMonth(), 1)
      while (cur <= e) { result.push(cur.toISOString().slice(0, 7)); cur.setMonth(cur.getMonth() + 1) }
      return result
    })()
    prev.ar.forEach(r => { const m = (r.created_at || '').slice(0, 7); const idx = prevMonths.indexOf(m); if (idx >= 0 && months[idx]) prevRevenueByMonth[months[idx]] = (prevRevenueByMonth[months[idx]] || 0) + (r.paid_amount || 0) })
    prev.ap.forEach(r => { const m = (r.created_at || '').slice(0, 7); const idx = prevMonths.indexOf(m); if (idx >= 0 && months[idx]) prevCostByMonth[months[idx]] = (prevCostByMonth[months[idx]] || 0) + (r.amount || 0) })
  }

  const revTrendDatasets = [
    { label: '營收', data: months.map(m => Math.round(revenueByMonth[m])), borderColor: colors.cyan, backgroundColor: 'rgba(34,211,238,0.08)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: colors.cyan },
    { label: '成本', data: months.map(m => Math.round(costByMonth[m])), borderColor: colors.orange, backgroundColor: 'rgba(251,146,60,0.08)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: colors.orange },
  ]
  if (prev) {
    revTrendDatasets.push(
      { label: '上期營收', data: months.map(m => Math.round(prevRevenueByMonth[m] || 0)), borderColor: colors.cyan, backgroundColor: 'transparent', borderDash: [6, 4], tension: 0.4, pointRadius: 3, pointBackgroundColor: colors.cyan, fill: false },
      { label: '上期成本', data: months.map(m => Math.round(prevCostByMonth[m] || 0)), borderColor: colors.orange, backgroundColor: 'transparent', borderDash: [6, 4], tension: 0.4, pointRadius: 3, pointBackgroundColor: colors.orange, fill: false },
    )
  }
  const revTrend = { labels: months.map(m => m.slice(5) + '月'), datasets: revTrendDatasets }

  // Task Completion
  const taskData = {
    labels: ['已完成', '進行中', '未開始'],
    datasets: [{ data: [d.tasks.filter(t => t.status === '已完成').length, d.tasks.filter(t => t.status === '進行中').length, d.tasks.filter(t => t.status === '未開始').length], backgroundColor: [colors.green, colors.blue, colors.orange], borderWidth: 0 }],
  }

  const handleExportCSV = () => {
    const kpiData = [
      { label: '在職人數', value: activeEmp },
      { label: '本月薪資', value: totalSalary },
      { label: '贏單金額', value: wonAmount },
      { label: '應收餘額', value: arTotal - arPaid },
      { label: '應付餘額', value: apTotal - apPaid },
      { label: '低庫存品項', value: lowStock },
      { label: '營收', value: d.profit.revenue },
      { label: '總成本', value: d.profit.totalCost },
      { label: '毛利', value: d.profit.grossProfit },
      { label: '毛利率 (%)', value: d.profit.grossMargin },
    ]
    exportToCSV(kpiData, [
      { key: 'label', label: '指標' },
      { key: 'value', label: '數值' },
    ], `BI營運看板_${new Date().toISOString().slice(0, 10)}`)
  }

  return (
    <div className="fade-in" id="analytics-page">
      <div className="page-header">
        <h2><span className="header-icon">📈</span> BI 營運看板</h2>
        <p>跨模組數據整合分析</p>
        <div className="export-btn-group" style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-primary" onClick={handleExportCSV} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download size={15} /> 匯出 CSV
          </button>
          <button className="btn btn-primary" onClick={() => exportToPDF('analytics-page', 'BI營運看板')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Printer size={15} /> 列印報表
          </button>
        </div>
      </div>

      <DateRangePicker value={dateRange} onChange={setDateRange} />

      {/* Filters: Period Comparison + Department + Category */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btnToggle(showComparison)} onClick={() => setShowComparison(v => !v)}>
          <ArrowLeftRight size={14} style={{ marginRight: 4, verticalAlign: -2 }} /> {showComparison ? '隱藏同期比較' : '同期比較'}
        </button>
        {showComparison && dateRange && prevRange && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            上期：{prevRange.startDate} ~ {prevRange.endDate}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <Filter size={14} style={{ color: 'var(--text-muted)' }} />
          <select className="form-input" value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={{ padding: '5px 10px', fontSize: 13, minWidth: 120 }}>
            <option value="">全部部門</option>
            {(data.departments || []).map(dept => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
          </select>
          <select className="form-input" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ padding: '5px 10px', fontSize: 13, minWidth: 120 }}>
            <option value="">全部類別</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* KPI */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {[
          { label: '在職人數', value: activeEmp, color: 'cyan' },
          { label: '本月薪資', value: `NT$${(totalSalary / 1000).toFixed(0)}K`, color: 'purple' },
          { label: '贏單金額', value: `NT$${(wonAmount / 1000).toFixed(0)}K`, color: 'green' },
          { label: '應收餘額', value: `NT$${((arTotal - arPaid) / 1000).toFixed(0)}K`, color: 'orange' },
          { label: '應付餘額', value: `NT$${((apTotal - apPaid) / 1000).toFixed(0)}K`, color: 'red' },
          { label: '低庫存', value: lowStock, color: lowStock > 0 ? 'red' : 'green' },
        ].map((s, i) => (
          <div key={i} className="stat-card" style={{ '--card-accent': `var(--accent-${s.color})`, '--card-accent-dim': `var(--accent-${s.color}-dim)` }}>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Profitability */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {[
          { label: '營收', value: `NT$ ${d.profit.revenue.toLocaleString()}`, color: 'green' },
          { label: '總成本', value: `NT$ ${d.profit.totalCost.toLocaleString()}`, color: 'orange' },
          { label: '毛利', value: `NT$ ${d.profit.grossProfit.toLocaleString()}`, color: d.profit.grossProfit >= 0 ? 'cyan' : 'red' },
          { label: '毛利率', value: `${d.profit.grossMargin}%`, color: d.profit.grossMargin >= 30 ? 'green' : 'orange' },
        ].map((s, i) => (
          <div key={i} className="stat-card" style={{ '--card-accent': `var(--accent-${s.color})`, '--card-accent-dim': `var(--accent-${s.color}-dim)` }}>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">📈 營收 vs 成本趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Line data={revTrend} options={{ ...chartOpts, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: tickStyle } } }} />
          </div>
        </div>
        <div className="card" style={{ cursor: 'pointer' }}>
          <div className="card-header"><div className="card-title">📊 應收帳齡分析 <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>點擊下鑽</span></div></div>
          <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px 8px' }}>
            <Doughnut data={arAgingData} options={{ ...chartOpts, onClick: handleARAgingClick, cutout: '55%', plugins: { ...chartOpts.plugins, legend: { ...chartOpts.plugins.legend, position: 'bottom' } } }} />
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        <div className="card" style={{ cursor: 'pointer' }}>
          <div className="card-header"><div className="card-title">🤝 銷售漏斗 <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>點擊下鑽</span></div></div>
          <div style={{ height: 240, padding: '0 8px 8px' }}>
            <Bar data={pipelineData} options={{ ...chartOpts, onClick: handlePipelineClick, plugins: { ...chartOpts.plugins, legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: { ...tickStyle, stepSize: 1 } } } }} />
          </div>
        </div>
        <div className="card" style={{ cursor: 'pointer' }}>
          <div className="card-header"><div className="card-title">📦 庫存健康度 <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>點擊下鑽</span></div></div>
          <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px 8px' }}>
            <Doughnut data={stockData} options={{ ...chartOpts, onClick: handleStockClick, cutout: '55%', plugins: { ...chartOpts.plugins, legend: { ...chartOpts.plugins.legend, position: 'bottom' } } }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">⚙️ 任務完成率</div></div>
          <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px 8px' }}>
            <Doughnut data={taskData} options={{ ...chartOpts, cutout: '55%', plugins: { ...chartOpts.plugins, legend: { ...chartOpts.plugins.legend, position: 'bottom' } } }} />
          </div>
        </div>
      </div>

      {/* Drill-down Modal */}
      {drillDown && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 1000000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setDrillDown(null)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 24, maxWidth: 800, width: '90%', maxHeight: '80vh', overflow: 'auto', boxShadow: 'var(--shadow-xl)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>{drillDown.title}</h3>
              <button onClick={() => setDrillDown(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><X size={18} /></button>
            </div>
            {drillDown.rows.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>此區間無資料</p>
            ) : (
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr>{drillDown.columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
                  <tbody>
                    {drillDown.rows.map((row, i) => (
                      <tr key={i}>{drillDown.columns.map(c => <td key={c.key}>{row[c.key]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button className="btn btn-primary" onClick={() => { exportToCSV(drillDown.rows, drillDown.columns, `下鑽_${new Date().toISOString().slice(0,10)}`); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Download size={14} /> 匯出明細
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
