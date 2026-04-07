import { useState, useEffect } from 'react'
import {
  Users, CheckCircle, Target,
  Clock, Briefcase, CalendarCheck, DollarSign, CreditCard,
  ShoppingCart, Package, Sparkles, Bot, RefreshCw, TrendingUp
} from 'lucide-react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler
} from 'chart.js'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import { getEmployees, getTasks, getWorkflows, getAttendance, getLeaveRequests } from '../lib/db'
import { supabase } from '../lib/supabase'
import LoadingSpinner from '../components/LoadingSpinner'
import { chat, isConfigured, clearSession } from '../lib/gemini'
import Metric from '../components/ui/Metric'
import ChartCard from '../components/ui/ChartCard'
import ProgressBar from '../components/ui/ProgressBar'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import DataTable from '../components/ui/DataTable'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler)

const C = {
  cyan: '#0ea5c9', blue: '#3b82f6', purple: '#8b5cf6',
  green: '#10b981', orange: '#f59e0b', red: '#ef4444',
  pink: '#ec4899', yellow: '#eab308',
}

const chartOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: { color: '#64748b', font: { size: 11, weight: 600 }, padding: 14, usePointStyle: true, pointStyleWidth: 8 },
    },
    tooltip: {
      backgroundColor: '#fff', titleColor: '#1e293b', bodyColor: '#475569',
      borderColor: 'rgba(148,163,184,0.2)', borderWidth: 1,
      padding: 12, cornerRadius: 12,
    },
  },
}
const grid = { color: 'rgba(148,163,184,0.10)' }
const tick = { color: '#64748b', font: { size: 11 } }

const fmt = v => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)

const taskColumns = [
  { key: 'id', title: '#', width: '50px', render: v => <span style={{ color: 'var(--text-muted)' }}>{v}</span> },
  { key: 'title', title: '任務名稱', render: v => <span style={{ fontWeight: 600 }}>{v}</span> },
  {
    key: 'status', title: '狀態',
    render: v => (
      <Badge dot color={v === '已完成' ? 'green' : v === '進行中' ? 'blue' : 'orange'}>{v}</Badge>
    ),
  },
  { key: 'assignee', title: '負責人' },
  {
    key: 'priority', title: '優先度',
    render: v => <Badge color={v === '高' ? 'red' : v === '中' ? 'orange' : 'blue'} size="sm">{v || '中'}</Badge>,
  },
]

export default function Dashboard() {
  const [employees, setEmployees] = useState([])
  const [tasks, setTasks] = useState([])
  const [workflows, setWorkflows] = useState([])
  const [attendance, setAttendance] = useState([])
  const [leaves, setLeaves] = useState([])
  const [arData, setArData] = useState([])
  const [apData, setApData] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [stockLevels, setStockLevels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [aiInsight, setAiInsight] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      getEmployees(), getTasks(), getWorkflows(), getAttendance(), getLeaveRequests(),
      supabase.from('accounts_receivable').select('amount, paid_amount, status, due_date'),
      supabase.from('accounts_payable').select('amount, paid_amount, status'),
      supabase.from('opportunities').select('stage, amount'),
      supabase.from('stock_levels').select('quantity, min_qty'),
    ])
      .then(([e, t, w, a, l, ar, ap, opp, stk]) => {
        setEmployees(e.data || []); setTasks(t.data || []); setWorkflows(w.data || [])
        setAttendance(a.data || []); setLeaves(l.data || [])
        setArData(ar.data || []); setApData(ap.data || [])
        setOpportunities(opp.data || []); setStockLevels(stk.data || [])
      }).catch(err => {
        console.error('Failed to load data:', err)
        setError('資料載入失敗，請重新整理頁面')
      }).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <h3 style={{ color: 'var(--accent-red)', marginBottom: 16 }}>{error}</h3>
      <Button variant="primary" onClick={() => window.location.reload()}>重新載入</Button>
    </div>
  )

  const active = employees.filter(e => e.status === '在職').length
  const done = tasks.filter(t => t.status === '已完成').length
  const doing = tasks.filter(t => t.status === '進行中').length
  const todo = tasks.filter(t => t.status === '未開始').length
  const progress = tasks.length ? Math.round(done / tasks.length * 100) : 0
  const late = attendance.filter(a => a.status === '遲到').length
  const onLeave = leaves.filter(l => l.status === '已核准').length

  const arOutstanding = arData.reduce((s, r) => s + (Number(r.amount) || 0) - (Number(r.paid_amount) || 0), 0)
  const apOutstanding = apData.reduce((s, r) => s + (Number(r.amount) || 0) - (Number(r.paid_amount) || 0), 0)
  const pipelineValue = opportunities.filter(o => o.stage !== '輸單').reduce((s, o) => s + (Number(o.amount) || 0), 0)
  const lowStockCount = stockLevels.filter(s => (Number(s.quantity) || 0) <= (Number(s.min_qty) || 0)).length

  const now = new Date()
  const greeting = now.getHours() < 12 ? '早安' : now.getHours() < 18 ? '午安' : '晚安'

  const fetchAiInsight = async () => {
    if (!isConfigured()) return
    setAiLoading(true)
    try {
      clearSession('dashboard')
      const summary = {
        employees: { total: employees.length, active },
        attendance: { late, total: attendance.length },
        tasks: { done, doing, todo },
        leaves: { pending: leaves.filter(l => l.status === '待審核').length, approved: onLeave },
        ar: { count: arData.length, outstanding: arOutstanding },
        ap: { count: apData.length, outstanding: apOutstanding },
        inventory: { lowStock: lowStockCount },
        pipeline: { value: pipelineValue },
      }
      const result = await chat(
        `以下是今日 ERP 儀表板的數據摘要，請用 3-5 個重點條列分析洞察與建議（每條 30 字以內）：\n${JSON.stringify(summary)}`,
        'dashboard'
      )
      setAiInsight(result)
    } catch (err) {
      setAiInsight(`無法取得 AI 洞察：${err.message}`)
    } finally {
      setAiLoading(false)
    }
  }

  // Chart data
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d.toISOString().slice(0, 10)
  })
  const attByDay = last7.map(date => {
    const r = attendance.filter(a => a.date === date)
    return {
      label: `${parseInt(date.slice(5, 7))}/${parseInt(date.slice(8))}`,
      normal: r.filter(a => a.status === '正常').length,
      late: r.filter(a => a.status === '遲到').length,
    }
  })

  const deptCounts = {}
  employees.filter(e => e.status === '在職').forEach(e => {
    deptCounts[e.dept || '其他'] = (deptCounts[e.dept || '其他'] || 0) + 1
  })

  const leaveTypes = {}
  leaves.forEach(l => { leaveTypes[l.type || '其他'] = (leaveTypes[l.type || '其他'] || 0) + 1 })

  const attendRate = active > 0 ? Math.round((active - late) / active * 100) : 100
  const taskBurnRate = tasks.length > 0 ? Math.round((done + doing) / tasks.length * 100) : 0

  return (
    <div style={{ maxWidth: 1400 }}>

      {/* ═══ Welcome ═══ */}
      <div className="animate-in" style={{ marginBottom: 24 }}>
        <h1 style={{
          fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em',
          color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: 4,
        }}>
          {greeting} <span style={{ display: 'inline-block', animation: 'wave 2s ease-in-out infinite', transformOrigin: '70% 70%' }}>&#x1F44B;</span>
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </p>
      </div>

      {/* ═══ HR KPI Row ═══ */}
      <div className="dash-v2-metrics">
        <div className="animate-in animate-in-1">
          <Metric icon={Users} label="在職人數" value={active} change={`共 ${employees.length} 人`} color={C.cyan} />
        </div>
        <div className="animate-in animate-in-2">
          <Metric icon={CheckCircle} label="今日出勤" value={active - late}
            trend={late === 0 ? 'up' : 'down'} change={late === 0 ? '全員到齊' : `${late} 人遲到`}
            color={C.blue} />
        </div>
        <div className="animate-in animate-in-3">
          <Metric icon={Briefcase} label="進行中任務" value={doing}
            change={`${todo} 項未開始`} color={C.purple} />
        </div>
        <div className="animate-in animate-in-4">
          <Metric icon={CalendarCheck} label="任務完成率" value={`${progress}%`}
            trend={progress >= 50 ? 'up' : 'down'} change={`${done}/${tasks.length} 已完成`}
            color={C.green} />
        </div>
      </div>

      {/* ═══ Business KPI Row ═══ */}
      <div className="dash-v2-metrics">
        <div className="animate-in animate-in-5">
          <Metric icon={DollarSign} label="應收帳款" value={`$${fmt(arOutstanding)}`}
            change={`共 ${arData.length} 筆`} color={arOutstanding > 500000 ? C.orange : C.green} />
        </div>
        <div className="animate-in animate-in-6">
          <Metric icon={CreditCard} label="應付帳款" value={`$${fmt(apOutstanding)}`}
            change={`共 ${apData.length} 筆`} color={C.blue} />
        </div>
        <div className="animate-in animate-in-7">
          <Metric icon={ShoppingCart} label="銷售漏斗" value={`$${fmt(pipelineValue)}`}
            change={`${opportunities.filter(o => o.stage !== '輸單').length} 項機會`}
            color={C.purple} />
        </div>
        <div className="animate-in animate-in-8">
          <Metric icon={Package} label="庫存警示" value={lowStockCount}
            trend={lowStockCount > 0 ? 'down' : 'up'}
            change={lowStockCount > 0 ? '需要補貨' : '庫存充足'}
            color={lowStockCount > 0 ? C.red : C.green} />
        </div>
      </div>

      {/* ═══ AI Insights ═══ */}
      {isConfigured() && (
        <div className="ai-card dash-v2-ai animate-in animate-in-5">
          <div className="ai-card-header">
            <div className="ai-card-title">
              <Sparkles size={16} style={{ color: C.purple }} />
              AI 智慧洞察
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={aiLoading ? RefreshCw : Bot}
              onClick={fetchAiInsight}
              loading={aiLoading}
            >
              {aiLoading ? '分析中...' : aiInsight ? '重新分析' : '產生洞察'}
            </Button>
          </div>
          {aiInsight ? (
            <div className="ai-card-body">{aiInsight}</div>
          ) : (
            <div className="ai-card-placeholder">
              <Bot size={16} style={{ opacity: 0.4 }} />
              點擊「產生洞察」讓 AI 分析今日營運數據
            </div>
          )}
        </div>
      )}

      {/* ═══ Charts Row: Attendance + Task Doughnut ═══ */}
      <div className="dash-v2-charts animate-in animate-in-6">
        <ChartCard icon={TrendingUp} title="近七天出勤趨勢" height={280}>
          <Line
            data={{
              labels: attByDay.map(d => d.label),
              datasets: [
                {
                  label: '正常', data: attByDay.map(d => d.normal),
                  borderColor: C.green, backgroundColor: 'rgba(52,211,153,0.08)',
                  fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: C.green, borderWidth: 2.5,
                },
                {
                  label: '遲到', data: attByDay.map(d => d.late),
                  borderColor: C.orange, backgroundColor: 'rgba(251,146,60,0.08)',
                  fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: C.orange, borderWidth: 2.5,
                },
              ],
            }}
            options={{
              ...chartOpts,
              scales: { x: { grid, ticks: tick }, y: { beginAtZero: true, grid, ticks: { ...tick, stepSize: 1 } } },
            }}
          />
        </ChartCard>

        <ChartCard icon={Target} title="任務分佈" height={240}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}>
            <div style={{ width: 200, height: 200, position: 'relative' }}>
              <Doughnut
                data={{
                  labels: ['已完成', '進行中', '未開始'],
                  datasets: [{
                    data: [done, doing, todo],
                    backgroundColor: [C.green, C.blue, C.orange],
                    borderWidth: 0, hoverOffset: 6,
                  }],
                }}
                options={{ ...chartOpts, cutout: '70%', plugins: { ...chartOpts.plugins, legend: { display: false } } }}
              />
              <div style={{
                position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{progress}%</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>完成率</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 18, marginTop: 16 }}>
              {[{ l: '已完成', c: C.green, v: done }, { l: '進行中', c: C.blue, v: doing }, { l: '未開始', c: C.orange, v: todo }].map(i => (
                <div key={i.l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: i.c }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{i.l}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{i.v}</span>
                </div>
              ))}
            </div>
          </div>
        </ChartCard>
      </div>

      {/* ═══ Triple Row: Department + Leave + Quick Stats ═══ */}
      <div className="dash-v2-triple animate-in animate-in-7">
        <ChartCard icon={Users} title="部門人力" height={220}>
          <Bar
            data={{
              labels: Object.keys(deptCounts),
              datasets: [{
                data: Object.values(deptCounts),
                backgroundColor: [C.cyan, C.blue, C.purple, C.green, C.orange, C.pink],
                borderRadius: 8, barThickness: 28,
              }],
            }}
            options={{
              ...chartOpts,
              plugins: { ...chartOpts.plugins, legend: { display: false } },
              scales: { x: { grid: { display: false }, ticks: tick }, y: { beginAtZero: true, grid, ticks: { ...tick, stepSize: 1 } } },
            }}
          />
        </ChartCard>

        <ChartCard icon={Clock} title="假別分佈" height={220}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Doughnut
              data={{
                labels: Object.keys(leaveTypes).length > 0 ? Object.keys(leaveTypes) : ['無資料'],
                datasets: [{
                  data: Object.keys(leaveTypes).length > 0 ? Object.values(leaveTypes) : [1],
                  backgroundColor: Object.keys(leaveTypes).length > 0
                    ? [C.blue, C.purple, C.cyan, C.pink, C.yellow, C.orange]
                    : ['rgba(148,163,184,0.15)'],
                  borderWidth: 0,
                }],
              }}
              options={{ ...chartOpts, cutout: '55%', plugins: { ...chartOpts.plugins, legend: { ...chartOpts.plugins.legend, position: 'bottom' } } }}
            />
          </div>
        </ChartCard>

        {/* Quick Overview */}
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">
              <TrendingUp size={16} className="chart-card-icon" />
              <h3>快速概覽</h3>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ProgressBar label="流程完成率" value={progress} color={C.cyan} />
            <ProgressBar label="出勤率" value={attendRate} color={C.green} />
            <ProgressBar label="任務消化率" value={taskBurnRate} color={C.purple} />
          </div>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              今日數據
            </div>
            <div className="quick-stat-row">
              {[
                { label: '請假中', value: onLeave, color: C.purple },
                { label: '待審假單', value: leaves.filter(l => l.status === '待審核').length, color: C.orange },
                { label: '進行中流程', value: workflows.filter(w => w.active_instances > 0).length, color: C.cyan },
              ].map((d, i) => (
                <div key={i} className="quick-stat-item">
                  <span className="quick-stat-label">{d.label}</span>
                  <span className="quick-stat-value" style={{ color: d.color }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Recent Tasks Table ═══ */}
      <div className="animate-in animate-in-8">
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Briefcase size={16} style={{ color: C.cyan }} />
            最近任務
          </h3>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>共 {tasks.length} 項</span>
        </div>
        <DataTable columns={taskColumns} data={tasks.slice(0, 10)} emptyText="目前沒有任務" />
      </div>

    </div>
  )
}
