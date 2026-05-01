import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  Users, CheckCircle, AlertTriangle, TrendingUp, Target,
  ArrowUpRight, ArrowDownRight, Clock, Briefcase, CalendarCheck,
  DollarSign, CreditCard, ShoppingCart, Package, Sparkles,
  Bot, RefreshCw, BarChart3, PieChart, GitBranch
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
import { chartPalette, chartTextTokens } from '../lib/theme/tokens'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler)

const SectionTitle = ({ children }) => (
  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
    {children}
  </div>
)

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

// ── store_staff 員工儀表板（參考 employee-portal 設計） ──
function StaffDashboard({ profile }) {
  const [schedules, setSchedules] = useState([])
  const [attendance, setAttendance] = useState([])
  const [leaves, setLeaves] = useState([])
  const [flows, setFlows] = useState([])
  const [loading, setLoading] = useState(true)
  const [clockTime, setClockTime] = useState(new Date())
  const empName = profile?.name || ''
  const today = new Date().toISOString().slice(0, 10)
  const monthStart = today.slice(0, 7) + '-01'

  useEffect(() => {
    if (!empName) { setLoading(false); return }
    Promise.all([
      supabase.from('schedules').select('date, shift').eq('employee', empName).gte('date', monthStart).order('date'),
      supabase.from('attendance_records').select('date, clock_in, clock_out, status, hours').eq('employee', empName).gte('date', monthStart).order('date', { ascending: false }),
      supabase.from('leave_requests').select('id, type, start_date, end_date, status').eq('employee', empName).order('created_at', { ascending: false }).limit(5),
      supabase.from('workflow_instances').select('id, template_name, status, created_at').eq('started_by', empName).order('created_at', { ascending: false }).limit(5),
    ]).then(([s, a, l, f]) => {
      setSchedules(s.data || [])
      setAttendance(a.data || [])
      setLeaves(l.data || [])
      setFlows(f.data || [])
    }).finally(() => setLoading(false))
  }, [empName])

  // Live clock
  useEffect(() => {
    const timer = setInterval(() => setClockTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  if (loading) return <LoadingSpinner />

  const now = clockTime
  const greeting = now.getHours() < 12 ? '早安' : now.getHours() < 18 ? '午安' : '晚安'
  const todayShift = schedules.find(s => s.date === today)
  const workDays = schedules.filter(s => s.shift && !['休', '補休', '特休', '病', '產', '會議', '事'].includes(s.shift)).length
  const restDays = schedules.filter(s => ['休', '補休', '特休'].includes(s.shift)).length
  const totalHours = attendance.reduce((sum, a) => sum + (Number(a.hours) || 0), 0)
  const lateDays = attendance.filter(a => a.status === '遲到').length
  const pendingFlows = flows.filter(f => f.status === '進行中').length

  const quickActions = [
    { icon: '🕐', label: '打卡', path: '/hr/attendance' },
    { icon: '📅', label: '班表', path: '/hr/my-schedule' },
    { icon: '🏖️', label: '請假', path: '/hr/leave' },
    { icon: '⏰', label: '加班', path: '/hr/overtime' },
    { icon: '🔄', label: '補打卡', path: '/hr/punch-correction' },
    { icon: '💰', label: '薪資單', path: '/hr/salary' },
  ]

  return (
    <div className="fade-in" style={{ maxWidth: 1000, margin: '0 auto' }}>
      {/* Hero */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>{greeting}，{empName}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>{profile?.store} · {profile?.dept} · {profile?.position || '員工'}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        {/* ── LEFT COLUMN ── */}
        <div>
          {/* 打卡區塊 */}
          <div className="card" style={{ marginBottom: 16, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 42, fontWeight: 700, fontFamily: 'monospace', letterSpacing: 2, color: 'var(--text-primary)' }}>
              {now.toLocaleTimeString('zh-TW', { hour12: false })}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              {now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button className="btn btn-primary" style={{ padding: '12px 32px', fontSize: 15, fontWeight: 700, borderRadius: 12 }}
                onClick={() => window.location.href = '/hr/attendance'}>
                上班打卡
              </button>
            </div>
            {todayShift && (
              <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                今日班別：<span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{todayShift.shift}</span>
              </div>
            )}
          </div>

          {/* 快速操作 */}
          <div className="card" style={{ marginBottom: 16, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>快速操作</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {quickActions.map(a => (
                <button key={a.path} onClick={() => window.location.href = a.path} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  padding: '14px 8px', borderRadius: 10, border: '1px solid var(--border-light)',
                  background: 'var(--bg-card)', cursor: 'pointer', transition: 'all 0.15s',
                  fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--glass-light)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.transform = 'none' }}>
                  <span style={{ fontSize: 22 }}>{a.icon}</span>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* 本月班表月曆 */}
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
              {now.getFullYear()} 年 {now.getMonth() + 1} 月班表
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, padding: 4 }}>{d}</div>
              ))}
              {(() => {
                const firstDay = new Date(monthStart).getDay()
                const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
                const cells = []
                for (let i = 0; i < firstDay; i++) cells.push(<div key={`pad-${i}`} />)
                for (let d = 1; d <= daysInMonth; d++) {
                  const dateStr = `${today.slice(0, 7)}-${String(d).padStart(2, '0')}`
                  const sched = schedules.find(s => s.date === dateStr)
                  const isToday = dateStr === today
                  const isRest = sched && ['休', '補休', '特休'].includes(sched.shift)
                  const isPast = dateStr < today
                  cells.push(
                    <div key={d} style={{
                      textAlign: 'center', padding: '8px 2px', borderRadius: 8,
                      background: isToday ? 'rgba(34,211,238,0.15)' : isRest ? 'rgba(16,185,129,0.06)' : undefined,
                      border: isToday ? '2px solid var(--accent-cyan)' : '1px solid transparent',
                      opacity: isPast && !isToday ? 0.5 : 1,
                    }}>
                      <div style={{ fontWeight: isToday ? 700 : 500, fontSize: 11, color: isToday ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>{d}</div>
                      <div style={{ fontSize: 10, fontWeight: 600, marginTop: 2, color: isRest ? '#10b981' : sched ? 'var(--text-primary)' : 'var(--border-medium)' }}>
                        {sched?.shift || '·'}
                      </div>
                    </div>
                  )
                }
                return cells
              })()}
            </div>
          </div>

          {/* 最近出勤紀錄 */}
          {attendance.length > 0 && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>最近出勤紀錄</div>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-medium)' }}>
                    {['日期', '上班', '下班', '工時', '狀態'].map(h => (
                      <th key={h} style={{ textAlign: h === '日期' ? 'left' : 'center', padding: '6px 8px', fontSize: 11, color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {attendance.slice(0, 7).map(a => (
                    <tr key={a.date} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '8px' }}>{a.date?.slice(5)}</td>
                      <td style={{ textAlign: 'center', padding: '8px' }}>{a.clock_in?.slice(0, 5) || '-'}</td>
                      <td style={{ textAlign: 'center', padding: '8px' }}>{a.clock_out?.slice(0, 5) || '-'}</td>
                      <td style={{ textAlign: 'center', padding: '8px', fontWeight: 600 }}>{a.hours ? `${Number(a.hours).toFixed(1)}h` : '-'}</td>
                      <td style={{ textAlign: 'center', padding: '8px' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                          background: a.status === '正常' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                          color: a.status === '正常' ? '#10b981' : '#ef4444',
                        }}>{a.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div>
          {/* 本月統計 */}
          <div className="card" style={{ marginBottom: 16, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>本月統計</div>
            {[
              { label: '出勤天數', value: `${workDays} 天`, color: 'var(--accent-cyan)' },
              { label: '休假天數', value: `${restDays} 天`, color: '#10b981' },
              { label: '累計工時', value: `${totalHours.toFixed(1)}h`, color: '#3b82f6' },
              { label: '遲到次數', value: `${lateDays} 次`, color: lateDays > 0 ? '#ef4444' : '#10b981' },
            ].map(m => (
              <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{m.label}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: m.color }}>{m.value}</span>
              </div>
            ))}
          </div>

          {/* 我的申請 */}
          <div className="card" style={{ marginBottom: 16, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>我的申請</div>
            {leaves.length === 0 && flows.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>暫無申請紀錄</div>
            )}
            {leaves.map(l => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
                <span style={{ fontSize: 18 }}>🏖️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{l.type || '請假'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.start_date?.slice(5)} ~ {l.end_date?.slice(5)}</div>
                </div>
                <span style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                  background: l.status === '已核准' ? 'rgba(16,185,129,0.1)' : l.status === '待審核' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                  color: l.status === '已核准' ? '#10b981' : l.status === '待審核' ? '#f59e0b' : '#ef4444',
                }}>{l.status}</span>
              </div>
            ))}
            {flows.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
                <span style={{ fontSize: 18 }}>📋</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.template_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.created_at?.slice(0, 10)}</div>
                </div>
                <span style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                  background: f.status === '已完成' ? 'rgba(16,185,129,0.1)' : 'rgba(59,130,246,0.1)',
                  color: f.status === '已完成' ? '#10b981' : '#3b82f6',
                }}>{f.status}</span>
              </div>
            ))}
          </div>

          {/* 公告 */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>公告</div>
            {[
              { tag: '排班', title: '4月份排班表已發佈', date: '04-18' },
              { tag: '人事', title: '五一勞動節放假公告', date: '04-15' },
              { tag: '福利', title: '員工健康檢查通知', date: '04-10' },
            ].map((a, i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                    background: 'rgba(34,211,238,0.1)', color: 'var(--accent-cyan)',
                  }}>{a.tag}</span>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{a.title}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{a.date}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function AdminDashboard() {
  const monthStart = new Date().toISOString().slice(0, 7) + '-01'
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
  const [wfInstances, setWfInstances] = useState([])
  const [wfSteps, setWfSteps] = useState([])
  const [pendingCorrections, setPendingCorrections] = useState(0)
  const [pendingOT, setPendingOT] = useState(0)

  const C = useMemo(() => chartPalette(), [])
  const T = useMemo(() => chartTextTokens(), [])
  const chartOpts = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: T.tertiary, font: { size: 11, weight: 600 }, padding: 14, usePointStyle: true, pointStyleWidth: 8 },
      },
      tooltip: {
        backgroundColor: T.card, titleColor: T.primary, bodyColor: T.secondary,
        borderColor: T.border, borderWidth: 1,
        padding: 12, cornerRadius: 12,
      },
    },
  }), [T])
  const grid = useMemo(() => ({ color: T.border }), [T])
  const tick = useMemo(() => ({ color: T.tertiary, font: { size: 11 } }), [T])

  useEffect(() => {
    Promise.all([
      getEmployees(), getTasks(), getWorkflows(), getAttendance(null, { from: monthStart, columns: 'date, status, hours', orgId: profile?.organization_id }), getLeaveRequests(),
      supabase.from('accounts_receivable').select('amount, paid_amount, status, due_date'),
      supabase.from('accounts_payable').select('amount, paid_amount, status'),
      supabase.from('opportunities').select('stage, amount'),
      supabase.from('stock_levels').select('*'),
      supabase.from('workflow_instances').select('id, status').eq('status', '進行中'),
      supabase.from('tasks').select('id, status, assignee, due_date').not('workflow_instance_id', 'is', null).in('status', ['待處理', '進行中']),
      supabase.from('clock_corrections').select('id').eq('status', '待審核'),
      supabase.from('overtime_requests').select('id').eq('status', '待審核'),
    ])
      .then(([e, t, w, a, l, ar, ap, opp, stk, wfi, wfs, pc, ot]) => {
        setEmployees(e.data || []); setTasks(t.data || []); setWorkflows(w.data || [])
        setAttendance(a.data || []); setLeaves(l.data || [])
        setArData(ar.data || []); setApData(ap.data || [])
        setOpportunities(opp.data || []); setStockLevels(stk.data || [])
        setWfInstances(wfi.data || []); setWfSteps(wfs.data || [])
        setPendingCorrections(pc.data?.length || 0); setPendingOT(ot.data?.length || 0)
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

  // Today's real-time metrics
  const today = new Date().toISOString().slice(0, 10)
  const todayAttendance = attendance.filter(a => a.date === today)
  const todayClockedIn = todayAttendance.length
  const todayAttRate = active > 0 ? Math.round(todayClockedIn / active * 100) : 0
  const pendingLeaves = leaves.filter(l => l.status === '待審核').length
  const totalPending = pendingLeaves + pendingCorrections + pendingOT
  const runningWorkflows = wfInstances.length
  const overdueSteps = wfSteps.filter(s => s.due_date && s.due_date < today).length

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

      {/* ═══ Today's Real-Time KPIs ═══ */}
      <div className="dash-v2-metrics">
        <div className="animate-in animate-in-1">
          <Metric icon={Clock} label="今日出勤率" value={`${todayAttRate}%`}
            trend={todayAttRate >= 80 ? 'up' : 'down'}
            change={`${todayClockedIn}/${active} 已打卡`}
            color={todayAttRate >= 80 ? C.green : C.orange} />
        </div>
        <div className="animate-in animate-in-2">
          <Metric icon={AlertTriangle} label="待審核" value={totalPending}
            change={`假${pendingLeaves} 補${pendingCorrections} 加${pendingOT}`}
            color={totalPending > 0 ? C.orange : C.green} />
        </div>
        <div className="animate-in animate-in-3">
          <Metric icon={GitBranch} label="進行中流程" value={runningWorkflows}
            change={overdueSteps > 0 ? `${overdueSteps} 項逾期` : '無逾期'}
            trend={overdueSteps > 0 ? 'down' : 'up'}
            color={C.purple} />
        </div>
        <div className="animate-in animate-in-4">
          <Metric icon={CheckCircle} label="任務完成率" value={`${progress}%`}
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
                  borderColor: C.green, backgroundColor: `${C.green}14`,
                  fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: C.green, borderWidth: 2.5,
                },
                {
                  label: '遲到', data: attByDay.map(d => d.late),
                  borderColor: C.orange, backgroundColor: `${C.orange}14`,
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
                    : [T.border],
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

      {/* ════════ Row 5: Active Workflows ════════ */}
      {(() => {
        const activeWf = workflows.filter(w => w.status === '已啟用')
        return (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 20, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <SectionTitle><GitBranch size={16} style={{ color: C.cyan }} /> Active Workflows</SectionTitle>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>共 {activeWf.length} 個流程</span>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead><tr><th>#</th><th>流程名稱</th><th>類別</th><th>步驟數</th><th>進行中</th><th>狀態</th></tr></thead>
                <tbody>
                  {activeWf.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>尚無已啟用流程</td></tr>
                  ) : activeWf.map(w => (
                    <tr key={w.id}>
                      <td style={{ color: 'var(--text-muted)', width: 40 }}>{w.id}</td>
                      <td style={{ fontWeight: 600 }}>{w.name}</td>
                      <td><span className="badge badge-info">{w.category || '一般'}</span></td>
                      <td>{w.steps}</td>
                      <td style={{ fontWeight: 600, color: (w.active_instances || 0) > 0 ? C.cyan : 'var(--text-muted)' }}>{w.active_instances || 0}</td>
                      <td>
                        <span className={`badge ${(w.active_instances || 0) > 0 ? 'badge-warning' : 'badge-success'}`}>
                          <span className="badge-dot"></span>{(w.active_instances || 0) > 0 ? '執行中' : '閒置'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* ════════ Row 6: 流程完成度 ════════ */}
      {(() => {
        const activeFlows = workflows.filter(w => w.status === '已啟用' && (w.active_instances || 0) > 0)
        const allEnabled = workflows.filter(w => w.status === '已啟用')
        const colors = [C.cyan, C.blue, C.purple, C.green, C.orange, C.pink, C.yellow, C.red]
        const overallDone = allEnabled.filter(w => (w.active_instances || 0) === 0).length
        const overallPct = allEnabled.length ? Math.round(overallDone / allEnabled.length * 100) : 0

        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Horizontal bar chart */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 20, padding: '24px', boxShadow: 'var(--shadow-sm)' }}>
              <SectionTitle><GitBranch size={16} style={{ color: C.cyan }} /> 流程完成度</SectionTitle>
              {allEnabled.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>尚無已啟用流程</div>
              ) : (
                <div style={{ height: 280 }}>
                  <Bar
                    data={{
                      labels: allEnabled.map(w => w.name.length > 10 ? w.name.slice(0, 10) + '…' : w.name),
                      datasets: [
                        {
                          label: '進行中實例',
                          data: allEnabled.map(w => w.active_instances || 0),
                          backgroundColor: allEnabled.map((_, i) => `${colors[i % colors.length]}cc`),
                          borderRadius: 6,
                          barThickness: 22,
                        },
                        {
                          label: '總步驟數',
                          data: allEnabled.map(w => w.steps || 0),
                          backgroundColor: allEnabled.map(() => T.border),
                          borderRadius: 6,
                          barThickness: 22,
                        },
                      ],
                    }}
                    options={{
                      ...chartOpts,
                      indexAxis: 'y',
                      scales: {
                        x: { beginAtZero: true, grid, ticks: { ...tick, stepSize: 1 } },
                        y: { grid: { display: false }, ticks: { ...tick, font: { size: 11, weight: 600 } } },
                      },
                      plugins: {
                        ...chartOpts.plugins,
                        legend: { ...chartOpts.plugins.legend, position: 'bottom' },
                      },
                    }}
                  />
                </div>
              )}
            </div>

            {/* Per-flow progress list */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 20, padding: '24px', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <SectionTitle><BarChart3 size={16} style={{ color: C.purple }} /> 各流程狀態</SectionTitle>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>整體完成 {overallPct}%</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 300, overflowY: 'auto' }}>
                {allEnabled.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>尚無已啟用流程</div>
                ) : allEnabled.map((w, i) => {
                  const pct = w.steps > 0 ? Math.round(Math.max(0, w.steps - (w.active_instances || 0)) / w.steps * 100) : 100
                  const color = colors[i % colors.length]
                  return (
                    <div key={w.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{w.name}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {(w.active_instances || 0) > 0 && (
                            <span className="badge badge-info" style={{ fontSize: 10 }}>
                              <span className="badge-dot"></span>{w.active_instances} 進行中
                            </span>
                          )}
                          <span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span>
                        </div>
                      </div>
                      <div style={{ height: 6, background: 'var(--glass-strong)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${pct}%`, borderRadius: 99,
                          background: `linear-gradient(90deg, ${color}, ${color}88)`,
                          transition: 'width 1s ease',
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })()}
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

export default function Dashboard() {
  const { profile, role } = useAuth()
  const userRole = role?.name || profile?.role || 'store_staff'
  if (userRole === 'store_staff' && profile) return <StaffDashboard profile={profile} />
  return <AdminDashboard />
}
