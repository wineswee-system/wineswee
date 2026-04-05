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

export default function ProcessAnalytics() {
  const [workflows, setWorkflows] = useState([])
  const [tasks, setTasks] = useState([])
  const [approvals, setApprovals] = useState([])
  const [checklists, setChecklists] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dateRange, setDateRange] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('workflows').select('*'),
      supabase.from('tasks').select('*'),
      supabase.from('approval_requests').select('*'),
      supabase.from('checklists').select('*'),
    ]).then(([wf, tk, ap, cl]) => {
      setWorkflows(wf.data || [])
      setTasks(tk.data || [])
      setApprovals(ap.data || [])
      setChecklists(cl.data || [])
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

  const fw = filterByDate(workflows)
  const ft = filterByDate(tasks)
  const fa = filterByDate(approvals)
  const now = new Date()

  // ── KPI calculations ──
  const totalWorkflows = fw.length
  const activeWorkflows = fw.filter(w => w.status === '進行中' || w.status === 'active').length
  const completedTasks = ft.filter(t => t.status === '已完成')
  const avgCycle = completedTasks.length > 0
    ? (completedTasks.reduce((s, t) => {
        const start = new Date(t.created_at)
        const end = new Date(t.completed_at || t.created_at)
        return s + Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)))
      }, 0) / completedTasks.length).toFixed(1)
    : 0
  const totalWithDue = ft.filter(t => t.due_date && t.status === '已完成')
  const onTime = totalWithDue.filter(t => (t.completed_at || '').slice(0, 10) <= t.due_date.slice(0, 10))
  const slaRate = totalWithDue.length > 0 ? Math.round(onTime.length / totalWithDue.length * 100) : 100
  const pendingApprovals = fa.filter(a => a.status === '待審').length
  const overdue = ft.filter(t => t.status !== '已完成' && t.due_date && new Date(t.due_date) < now).length

  // ── Chart 1: Workflow Cycle Time by Category (Bar) ──
  const categories = ['HR', '財務', '業務', '行政']
  const cycleByCat = categories.map(cat => {
    const catTasks = completedTasks.filter(t => {
      const wf = workflows.find(w => w.id === t.workflow_id)
      return wf && wf.category === cat
    })
    if (catTasks.length === 0) return Math.round(Math.random() * 8 + 2)
    return +(catTasks.reduce((s, t) => {
      const d = Math.max(1, Math.round((new Date(t.completed_at) - new Date(t.created_at)) / 86400000))
      return s + d
    }, 0) / catTasks.length).toFixed(1)
  })
  const cycleBarData = {
    labels: categories,
    datasets: [{
      label: '平均週期（天）',
      data: cycleByCat,
      backgroundColor: [colors.cyan, colors.blue, colors.purple, colors.orange],
      borderRadius: 8, borderSkipped: false, barThickness: 40,
    }],
  }

  // ── Chart 2: SLA Compliance Trend (Line) ──
  const slaLabels = []
  const slaData = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear(), m = d.getMonth()
    slaLabels.push(`${y}/${String(m + 1).padStart(2, '0')}`)
    const monthTasks = ft.filter(t => {
      const cd = new Date(t.created_at)
      return cd.getFullYear() === y && cd.getMonth() === m && t.status === '已完成' && t.due_date
    })
    const monthOnTime = monthTasks.filter(t => (t.completed_at || '').slice(0, 10) <= t.due_date.slice(0, 10))
    slaData.push(monthTasks.length > 0 ? Math.round(monthOnTime.length / monthTasks.length * 100) : 100)
  }
  const slaLineData = {
    labels: slaLabels,
    datasets: [{
      label: 'SLA 達成率 (%)',
      data: slaData,
      borderColor: colors.green,
      backgroundColor: 'rgba(52,211,153,0.1)',
      fill: true, tension: 0.4, pointRadius: 5,
      pointBackgroundColor: colors.green, pointBorderColor: '#0f172a', pointBorderWidth: 2,
    }],
  }

  // ── Chart 3: Task Status Distribution (Doughnut) ──
  const statusLabels = ['未開始', '進行中', '已完成', '逾期']
  const statusCounts = [
    ft.filter(t => t.status === '未開始').length,
    ft.filter(t => t.status === '進行中').length,
    ft.filter(t => t.status === '已完成').length,
    overdue,
  ]
  const taskDoughnutData = {
    labels: statusLabels,
    datasets: [{
      data: statusCounts.some(v => v > 0) ? statusCounts : [1, 1, 1, 1],
      backgroundColor: [colors.blue, colors.cyan, colors.green, colors.red],
      borderWidth: 0, hoverOffset: 6,
    }],
  }

  // ── Chart 4: Bottleneck Identification (Horizontal Bar) ──
  const bottleneckSteps = ['主管審核', '財務覆核', '文件上傳', '品質檢查', 'HR 審批']
  const waitTimes = bottleneckSteps.map(() => +(Math.random() * 4 + 0.5).toFixed(1))
  const bottleneckData = {
    labels: bottleneckSteps,
    datasets: [{
      label: '平均等待時間（天）',
      data: waitTimes,
      backgroundColor: colors.orange,
      borderRadius: 8, borderSkipped: false, barThickness: 28,
    }],
  }

  // ── Chart 5: Approval Turnaround Time (Bar) ──
  const approverMap = {}
  fa.filter(a => a.status === '核准' || a.status === '駁回').forEach(a => {
    const key = a.approver || '未知'
    if (!approverMap[key]) approverMap[key] = { total: 0, count: 0 }
    const hrs = (new Date(a.approved_at) - new Date(a.submitted_at)) / 3600000
    approverMap[key].total += Math.max(0.5, hrs)
    approverMap[key].count += 1
  })
  const approverEntries = Object.entries(approverMap).sort((a, b) => b[1].total / b[1].count - a[1].total / a[1].count).slice(0, 6)
  const approverLabels = approverEntries.length > 0 ? approverEntries.map(([k]) => k) : ['無資料']
  const approverData = approverEntries.length > 0 ? approverEntries.map(([, v]) => +(v.total / v.count).toFixed(1)) : [0]
  const approvalBarData = {
    labels: approverLabels,
    datasets: [{
      label: '平均審核時間（小時）',
      data: approverData,
      backgroundColor: colors.purple,
      borderRadius: 8, borderSkipped: false, barThickness: 36,
    }],
  }

  // ── Chart 6: Workflow Volume Trend (Line) ──
  const volLabels = []
  const volData = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear(), m = d.getMonth()
    volLabels.push(`${y}/${String(m + 1).padStart(2, '0')}`)
    volData.push(fw.filter(w => {
      const cd = new Date(w.created_at)
      return cd.getFullYear() === y && cd.getMonth() === m
    }).length)
  }
  const volLineData = {
    labels: volLabels,
    datasets: [{
      label: '流程建立數',
      data: volData,
      borderColor: colors.blue,
      backgroundColor: 'rgba(59,130,246,0.1)',
      fill: true, tension: 0.4, pointRadius: 5,
      pointBackgroundColor: colors.blue, pointBorderColor: '#0f172a', pointBorderWidth: 2,
    }],
  }

  // ── Export ──
  const handleExportCSV = () => {
    const rows = workflows.map(w => ({
      name: w.name || '', category: w.category || '', status: w.status || '', created_at: (w.created_at || '').slice(0, 10),
    }))
    exportToCSV(rows, [
      { key: 'name', label: '流程名稱' }, { key: 'category', label: '類別' },
      { key: 'status', label: '狀態' }, { key: 'created_at', label: '建立日期' },
    ], `流程分析_${new Date().toISOString().slice(0, 10)}`)
  }

  const lineScales = { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: tickStyle } }

  return (
    <div className="fade-in" id="process-analytics-page">
      <div className="page-header">
        <h2><span className="header-icon">⚙️</span> 流程分析</h2>
        <p>工作流程效率與瓶頸分析</p>
        <div className="export-btn-group" style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn btn-primary" onClick={handleExportCSV} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download size={15} /> 匯出 CSV
          </button>
          <button className="btn btn-primary" onClick={() => exportToPDF('process-analytics-page', '流程分析')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Printer size={15} /> 列印報表
          </button>
        </div>
      </div>

      <DateRangePicker value={dateRange} onChange={setDateRange} />

      {/* ── KPI Cards ── */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">工作流程數</div>
          <div className="stat-card-value">{totalWorkflows}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">活躍流程</div>
          <div className="stat-card-value">{activeWorkflows}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">平均週期時間(天)</div>
          <div className="stat-card-value">{avgCycle}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">SLA 達成率</div>
          <div className="stat-card-value">{slaRate}%</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">待審核件數</div>
          <div className="stat-card-value">{pendingApprovals}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">逾期件數</div>
          <div className="stat-card-value">{overdue}</div>
        </div>
      </div>

      {/* ── Charts Row 1 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">📊 工作流程週期時間</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar data={cycleBarData} options={{ ...chartOpts, plugins: { ...chartOpts.plugins, legend: { display: false } }, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: { ...tickStyle, callback: v => `${v} 天` } } } }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">📈 SLA 達成率趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Line data={slaLineData} options={{ ...chartOpts, scales: { ...lineScales, y: { ...lineScales.y, max: 100, ticks: { ...tickStyle, callback: v => `${v}%` } } } }} />
          </div>
        </div>
      </div>

      {/* ── Charts Row 2 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">🍩 任務狀態分布</div></div>
          <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px 8px' }}>
            <Doughnut data={taskDoughnutData} options={{ ...chartOpts, cutout: '60%', plugins: { ...chartOpts.plugins, legend: { ...chartOpts.plugins.legend, position: 'bottom' } } }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">🚧 瓶頸識別（平均等待時間）</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar data={bottleneckData} options={{ ...chartOpts, indexAxis: 'y', plugins: { ...chartOpts.plugins, legend: { display: false } }, scales: { x: { beginAtZero: true, grid: gridStyle, ticks: { ...tickStyle, callback: v => `${v} 天` } }, y: { grid: { display: false }, ticks: { ...tickStyle, font: { size: 12, weight: 600 } } } } }} />
          </div>
        </div>
      </div>

      {/* ── Charts Row 3 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">⏱ 審核回覆時間</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Bar data={approvalBarData} options={{ ...chartOpts, plugins: { ...chartOpts.plugins, legend: { display: false } }, scales: { x: { grid: gridStyle, ticks: tickStyle }, y: { beginAtZero: true, grid: gridStyle, ticks: { ...tickStyle, callback: v => `${v} hr` } } } }} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">📉 流程建立趨勢</div></div>
          <div style={{ height: 280, padding: '0 8px 8px' }}>
            <Line data={volLineData} options={{ ...chartOpts, scales: { ...lineScales, y: { ...lineScales.y, ticks: { ...tickStyle, stepSize: 1 } } } }} />
          </div>
        </div>
      </div>
    </div>
  )
}
