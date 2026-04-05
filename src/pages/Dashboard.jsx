import { useState, useEffect } from 'react'
import { Users, CheckCircle, AlertTriangle, TrendingUp, Target, ArrowUpRight, ArrowDownRight, Clock, Briefcase, CalendarCheck, DollarSign, CreditCard, ShoppingCart, Package, Sparkles, Bot, RefreshCw, BarChart3, PieChart } from 'lucide-react'
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler } from 'chart.js'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import { getEmployees, getTasks, getWorkflows, getAttendance, getLeaveRequests } from '../lib/db'
import { supabase } from '../lib/supabase'
import LoadingSpinner from '../components/LoadingSpinner'
import { chat, isConfigured, clearSession } from '../lib/gemini'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler)

const C = { cyan: '#0ea5c9', blue: '#3b82f6', purple: '#8b5cf6', green: '#10b981', orange: '#f59e0b', red: '#ef4444', pink: '#ec4899', yellow: '#eab308' }

// Detect light theme
const isLight = () => document.documentElement.getAttribute('data-theme') === 'light'

const chartOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#64748b', font: { size: 11, weight: 600 }, padding: 14, usePointStyle: true, pointStyleWidth: 8 } },
    tooltip: { backgroundColor: '#fff', titleColor: '#1e293b', bodyColor: '#475569', borderColor: 'rgba(148,163,184,0.2)', borderWidth: 1, padding: 12, cornerRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' },
  },
}
const grid = { color: 'rgba(148,163,184,0.10)' }
const tick = { color: '#64748b', font: { size: 11 } }

// ── Reusable mini components ──
const KpiCard = ({ icon: Icon, label, value, change, changeType, sub, accent }) => (
  <div style={{
    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 20,
    padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 18,
    transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)', cursor: 'default',
    boxShadow: 'var(--shadow-sm)',
  }}
    onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 8px 30px ${accent}18`; e.currentTarget.style.transform = 'translateY(-2px)' }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'translateY(0)' }}
  >
    <div style={{
      width: 56, height: 56, borderRadius: 16, flexShrink: 0,
      background: `${accent}14`, color: accent,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 4px 14px ${accent}12`,
    }}>
      <Icon size={26} strokeWidth={2.2} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, letterSpacing: '0.02em' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, letterSpacing: '-0.03em' }}>{value}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        {change !== undefined && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 700,
            color: changeType === 'up' ? C.green : changeType === 'down' ? C.red : 'var(--text-muted)',
          }}>
            {changeType === 'up' ? <ArrowUpRight size={12} /> : changeType === 'down' ? <ArrowDownRight size={12} /> : null}
            {change}
          </span>
        )}
        {sub && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</span>}
      </div>
    </div>
  </div>
)

const SectionTitle = ({ children }) => (
  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
    {children}
  </div>
)

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
      }).finally(() => {
        setLoading(false)
      })
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const active = employees.filter(e => e.status === '在職').length
  const done = tasks.filter(t => t.status === '已完成').length
  const doing = tasks.filter(t => t.status === '進行中').length
  const todo = tasks.filter(t => t.status === '未開始').length
  const progress = tasks.length ? Math.round(done / tasks.length * 100) : 0
  const late = attendance.filter(a => a.status === '遲到').length
  const onLeave = leaves.filter(l => l.status === '已核准').length

  const now = new Date()
  const greeting = now.getHours() < 12 ? '早安' : now.getHours() < 18 ? '午安' : '晚安'

  const fetchAiInsight = async () => {
    if (!isConfigured()) return
    setAiLoading(true)
    try {
      clearSession('dashboard')
      const summary = {
        employees: { total: employees.length, active: employees.filter(e => e.status === '在職').length },
        attendance: { late: attendance.filter(a => a.status === '遲到').length, total: attendance.length },
        tasks: { done: tasks.filter(t => t.status === '已完成').length, doing: tasks.filter(t => t.status === '進行中').length, todo: tasks.filter(t => t.status === '未開始').length },
        leaves: { pending: leaves.filter(l => l.status === '待審核').length, approved: leaves.filter(l => l.status === '已核准').length },
        ar: { count: arData.length, outstanding: arData.reduce((s, r) => s + (Number(r.amount) || 0) - (Number(r.paid_amount) || 0), 0) },
        ap: { count: apData.length, outstanding: apData.reduce((s, r) => s + (Number(r.amount) || 0) - (Number(r.paid_amount) || 0), 0) },
        inventory: { lowStock: stockLevels.filter(s => (Number(s.quantity) || 0) <= (Number(s.min_qty) || 0)).length },
        pipeline: { value: opportunities.filter(o => o.stage !== '輸單').reduce((s, o) => s + (Number(o.amount) || 0), 0) },
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
  const last7 = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d.toISOString().slice(0, 10) })
  const attByDay = last7.map(date => {
    const r = attendance.filter(a => a.date === date)
    return { label: `${parseInt(date.slice(5, 7))}/${parseInt(date.slice(8))}`, normal: r.filter(a => a.status === '正常').length, late: r.filter(a => a.status === '遲到').length }
  })

  const deptCounts = {}
  employees.filter(e => e.status === '在職').forEach(e => { deptCounts[e.dept || '其他'] = (deptCounts[e.dept || '其他'] || 0) + 1 })

  const leaveTypes = {}
  leaves.forEach(l => { leaveTypes[l.type || '其他'] = (leaveTypes[l.type || '其他'] || 0) + 1 })

  return (
    <div className="fade-in" style={{ maxWidth: 1400 }}>

      {/* ════════ Row 1: Welcome ════════ */}
      <div className="dash-welcome" style={{ marginBottom: 28 }}>
        <h1>{greeting} 👋</h1>
        <p>{now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
      </div>

      {/* ════════ Row 2: KPI Cards ════════ */}
      <div className="dash-kpi-grid">
        <KpiCard icon={Users} label="在職人數" value={active} change={`共 ${employees.length} 人`} sub="" accent={C.cyan} />
        <KpiCard icon={CheckCircle} label="今日出勤" value={active - late} changeType={late === 0 ? 'up' : 'down'} change={late === 0 ? '全員到齊' : `${late} 人遲到`} accent={C.blue} />
        <KpiCard icon={Briefcase} label="進行中任務" value={doing} change={`${todo} 項未開始`} sub="" accent={C.purple} />
        <KpiCard icon={CalendarCheck} label="任務完成率" value={`${progress}%`} changeType={progress >= 50 ? 'up' : 'down'} change={`${done}/${tasks.length} 已完成`} accent={C.green} />
      </div>

      {/* ════════ Row 2b: Business KPI Cards ════════ */}
      {(() => {
        const arTotal = arData.reduce((s, r) => s + (Number(r.amount) || 0), 0)
        const arPaid = arData.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0)
        const arOutstanding = arTotal - arPaid
        const apTotal = apData.reduce((s, r) => s + (Number(r.amount) || 0), 0)
        const apPaid = apData.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0)
        const apOutstanding = apTotal - apPaid
        const pipelineValue = opportunities
          .filter(o => o.stage !== '輸單')
          .reduce((s, o) => s + (Number(o.amount) || 0), 0)
        const lowStockCount = stockLevels.filter(s => (Number(s.quantity) || 0) <= (Number(s.min_qty) || 0)).length
        const fmt = v => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)
        return (
          <div className="dash-kpi-grid-2">
            <KpiCard icon={DollarSign} label="應收帳款" value={`$${fmt(arOutstanding)}`} change={`共 ${arData.length} 筆`} sub="" accent={arOutstanding > 500000 ? C.orange : C.green} />
            <KpiCard icon={CreditCard} label="應付帳款" value={`$${fmt(apOutstanding)}`} change={`共 ${apData.length} 筆`} sub="" accent={C.blue} />
            <KpiCard icon={ShoppingCart} label="銷售漏斗" value={`$${fmt(pipelineValue)}`} change={`${opportunities.filter(o => o.stage !== '輸單').length} 項機會`} sub="" accent={C.purple} />
            <KpiCard icon={Package} label="庫存警示" value={lowStockCount} changeType={lowStockCount > 0 ? 'down' : 'up'} change={lowStockCount > 0 ? '需要補貨' : '庫存充足'} accent={lowStockCount > 0 ? C.red : C.green} />
          </div>
        )
      })()}

      {/* ════════ AI Insights ════════ */}
      {isConfigured() && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 20, padding: '24px', marginBottom: 0, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <SectionTitle><Sparkles size={16} style={{ color: C.purple }} /> AI 智慧洞察</SectionTitle>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={fetchAiInsight}
              disabled={aiLoading}
            >
              {aiLoading ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Bot size={12} />}
              {aiLoading ? '分析中...' : aiInsight ? '重新分析' : '產生洞察'}
            </button>
          </div>
          {aiInsight ? (
            <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
              {aiInsight}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              點擊「產生洞察」讓 AI 分析今日營運數據
            </div>
          )}
        </div>
      )}

      {/* ════════ Row 3: Attendance Chart + Task Doughnut ════════ */}
      <div className="dash-charts-row">
        {/* Attendance */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 20, padding: '24px', boxShadow: 'var(--shadow-sm)' }}>
          <SectionTitle><TrendingUp size={16} style={{ color: C.cyan }} /> 近七天出勤趨勢</SectionTitle>
          <div style={{ height: 280 }}>
            <Line
              data={{
                labels: attByDay.map(d => d.label),
                datasets: [
                  { label: '正常', data: attByDay.map(d => d.normal), borderColor: C.green, backgroundColor: 'rgba(52,211,153,0.08)', fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: C.green, borderWidth: 2.5 },
                  { label: '遲到', data: attByDay.map(d => d.late), borderColor: C.orange, backgroundColor: 'rgba(251,146,60,0.08)', fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: C.orange, borderWidth: 2.5 },
                ],
              }}
              options={{ ...chartOpts, scales: { x: { grid, ticks: tick }, y: { beginAtZero: true, grid, ticks: { ...tick, stepSize: 1 } } } }}
            />
          </div>
        </div>

        {/* Task doughnut */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <SectionTitle><Target size={16} style={{ color: C.blue }} /> 任務分佈</SectionTitle>
          <div style={{ width: 200, height: 200, position: 'relative', marginTop: 8 }}>
            <Doughnut
              data={{ labels: ['已完成', '進行中', '未開始'], datasets: [{ data: [done, doing, todo], backgroundColor: [C.green, C.blue, C.orange], borderWidth: 0, hoverOffset: 6 }] }}
              options={{ ...chartOpts, cutout: '68%', plugins: { ...chartOpts.plugins, legend: { display: false } } }}
            />
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{progress}%</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>完成率</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, marginTop: 20 }}>
            {[{ l: '已完成', c: C.green, v: done }, { l: '進行中', c: C.blue, v: doing }, { l: '未開始', c: C.orange, v: todo }].map(i => (
              <div key={i.l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: i.c }} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{i.l}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{i.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ════════ Row 4: Dept Bar + Leave Pie + Progress ════════ */}
      <div className="dash-triple-row">
        {/* Department */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 20, padding: '24px', boxShadow: 'var(--shadow-sm)' }}>
          <SectionTitle><Users size={16} style={{ color: C.purple }} /> 部門人力</SectionTitle>
          <div style={{ height: 220 }}>
            <Bar
              data={{ labels: Object.keys(deptCounts), datasets: [{ data: Object.values(deptCounts), backgroundColor: [C.cyan, C.blue, C.purple, C.green, C.orange, C.pink], borderRadius: 8, barThickness: 28 }] }}
              options={{ ...chartOpts, plugins: { ...chartOpts.plugins, legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: tick }, y: { beginAtZero: true, grid, ticks: { ...tick, stepSize: 1 } } } }}
            />
          </div>
        </div>

        {/* Leave types */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <SectionTitle><Clock size={16} style={{ color: C.pink }} /> 假別分佈</SectionTitle>
          <div style={{ width: '100%', height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Doughnut
              data={{
                labels: Object.keys(leaveTypes).length > 0 ? Object.keys(leaveTypes) : ['無資料'],
                datasets: [{ data: Object.keys(leaveTypes).length > 0 ? Object.values(leaveTypes) : [1], backgroundColor: Object.keys(leaveTypes).length > 0 ? [C.blue, C.purple, C.cyan, C.pink, C.yellow, C.orange] : ['rgba(148,163,184,0.15)'], borderWidth: 0 }],
              }}
              options={{ ...chartOpts, cutout: '55%', plugins: { ...chartOpts.plugins, legend: { ...chartOpts.plugins.legend, position: 'bottom' } } }}
            />
          </div>
        </div>

        {/* Flow progress */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 20, padding: '24px', boxShadow: 'var(--shadow-sm)' }}>
          <SectionTitle>📊 快速概覽</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
            {[
              { label: '流程完成率', value: progress, color: C.cyan },
              { label: '出勤率', value: active > 0 ? Math.round((active - late) / active * 100) : 100, color: C.green },
              { label: '任務消化率', value: tasks.length > 0 ? Math.round((done + doing) / tasks.length * 100) : 0, color: C.purple },
            ].map((p, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: p.color }}>{p.value}%</span>
                </div>
                <div style={{ height: 8, background: 'var(--glass-strong)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${p.value}%`, borderRadius: 99, background: `linear-gradient(90deg, ${p.color}, ${p.color}88)`, transition: 'width 1s ease' }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>今日數據</div>
            {[
              { label: '請假中', value: onLeave, color: C.purple },
              { label: '待審假單', value: leaves.filter(l => l.status === '待審核').length, color: C.orange },
              { label: '進行中流程', value: workflows.filter(w => w.active_instances > 0).length, color: C.cyan },
            ].map((d, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{d.label}</span>
                <span style={{ fontWeight: 700, color: d.color }}>{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ════════ Row 5: Recent Tasks ════════ */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 20, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionTitle>📋 最近任務</SectionTitle>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>共 {tasks.length} 項</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>#</th><th>任務名稱</th><th>狀態</th><th>負責人</th><th>優先度</th></tr></thead>
            <tbody>
              {tasks.slice(0, 10).map(t => (
                <tr key={t.id}>
                  <td style={{ color: 'var(--text-muted)', width: 40 }}>{t.id}</td>
                  <td style={{ fontWeight: 600 }}>{t.title}</td>
                  <td>
                    <span className={`badge ${t.status === '已完成' ? 'badge-success' : t.status === '進行中' ? 'badge-info' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{t.status}
                    </span>
                  </td>
                  <td>{t.assignee}</td>
                  <td>
                    <span className={`badge ${t.priority === '高' ? 'badge-danger' : t.priority === '中' ? 'badge-warning' : 'badge-info'}`}>
                      {t.priority || '中'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
