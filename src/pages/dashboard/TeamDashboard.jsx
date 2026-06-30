import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Calendar, Clock, FileCheck, AlertTriangle, Cake,
  ChevronRight, CheckCircle2, XCircle, MessageSquare,
  Building2, RefreshCw, Briefcase, Plane,
  ListChecks, Workflow as WorkflowIcon, FolderOpen, Hourglass,
  TrendingUp, PieChart as PieIcon, Sparkles, Bot,
} from 'lucide-react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler,
} from 'chart.js'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import LoadingSpinner from '../../components/LoadingSpinner'
import { chartPalette, chartTextTokens } from '../../lib/theme/tokens'
import KpiCard from './components/KpiCard'
import DashboardAiChat from './components/DashboardAiChat'
import DashboardCharts from './components/DashboardCharts'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler)

// ──────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10)
const monthStr = () => new Date().toISOString().slice(0, 7)
const greetingNow = () => {
  const h = new Date().getHours()
  return h < 5 ? '夜深了' : h < 12 ? '早安' : h < 18 ? '午安' : '晚安'
}
const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000)
const fmtDate = (d) => {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

// 顏色 token
const C = {
  cyan: 'var(--accent-cyan)',
  cyanDim: 'var(--accent-cyan-dim)',
  green: 'var(--accent-green)',
  greenDim: 'var(--accent-green-dim)',
  orange: 'var(--accent-orange)',
  orangeDim: 'var(--accent-orange-dim)',
  red: 'var(--accent-red)',
  redDim: 'var(--accent-red-dim)',
  purple: 'var(--accent-purple)',
  purpleDim: 'rgba(167,139,250,0.15)',
  blue: 'var(--accent-blue)',
  blueDim: 'var(--accent-blue-dim)',
  muted: 'var(--text-muted)',
  card: 'var(--bg-card)',
  bg2: 'var(--bg-secondary)',
  border: 'var(--border-medium)',
  borderSubtle: 'var(--border-subtle)',
}

// ──────────────────────────────────────────────
// 子元件：待簽核 row
// ──────────────────────────────────────────────
function PendingRow({ item, onClick }) {
  const isOverdue = item.daysOpen >= 3
  const p = item.progress
  const pct = p && p.total > 0 ? Math.round((p.current / p.total) * 100) : 0
  return (
    <div
      onClick={() => onClick?.(item)}
      style={{
        padding: 12, borderRadius: 10, border: `1px solid ${C.borderSubtle}`,
        background: C.bg2, cursor: 'pointer',
        transition: 'border-color .12s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.cyan }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderSubtle }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
          background: item.kindColor + '20', color: item.kindColor, flexShrink: 0,
        }}>{item.kindLabel}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {item.title}
          </div>
          {item.subtitle && (
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{item.subtitle}</div>
          )}
          {p && p.total > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <div style={{
                flex: 1, height: 4, borderRadius: 2, background: C.borderSubtle, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', width: `${pct}%`, background: item.kindColor,
                  transition: 'width .3s',
                }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: item.kindColor, minWidth: 30, textAlign: 'right' }}>
                {p.current}/{p.total} 關
              </span>
            </div>
          )}
        </div>
        {isOverdue && (
          <span style={{ fontSize: 10, fontWeight: 700, color: C.red, flexShrink: 0 }}>
            🚨 {item.daysOpen}天
          </span>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// 子元件：團隊狀態徽章
// ──────────────────────────────────────────────
const STATUS_META = {
  on:       { icon: '🟢', label: '在班',    color: C.green },
  leave:    { icon: '🌴', label: '休假中',  color: C.cyan },
  sick:     { icon: '🏥', label: '請假中',  color: C.orange },
  overtime: { icon: '⚡', label: '加班中',  color: C.purple },
  trip:     { icon: '✈️', label: '出差中',  color: C.blue },
  late:     { icon: '🔴', label: '未打卡',  color: C.red },
  off:      { icon: '⚪', label: '休息日',  color: C.muted },
  unknown:  { icon: '⚫', label: '未排班',  color: C.muted },
}

function TeamMemberCard({ emp, status }) {
  const meta = STATUS_META[status] || STATUS_META.unknown
  const initial = (emp.name || '?').charAt(0)
  return (
    <div title={`${emp.name} · ${meta.label}`} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      padding: 10, borderRadius: 10, background: C.card, border: `1px solid ${C.borderSubtle}`,
      minWidth: 88, position: 'relative',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: '50%', background: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 700, fontSize: 18, position: 'relative',
      }}>
        {initial}
        <span style={{
          position: 'absolute', bottom: -2, right: -2, fontSize: 14,
          width: 20, height: 20, background: C.card, border: `1px solid ${meta.color}`,
          borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{meta.icon}</span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {emp.name}
      </div>
      <div style={{ fontSize: 10, color: meta.color, fontWeight: 600 }}>{meta.label}</div>
    </div>
  )
}

// ──────────────────────────────────────────────
// 子元件：流程進度卡（可展開看每關）
// ──────────────────────────────────────────────
const TASK_STATUS_META = {
  '已完成': { icon: '✓', color: C.green, bg: C.greenDim },
  '進行中': { icon: '▶', color: C.blue, bg: C.blueDim },
  '待簽核': { icon: '◐', color: C.orange, bg: C.orangeDim },
  '待處理': { icon: '○', color: C.muted, bg: C.bg2 },
  '已擱置': { icon: '⏸', color: C.red, bg: C.redDim },
}

function WorkflowProgressCard({ w, tasks, days, onJump, index }) {
  const [expanded, setExpanded] = useState(false)
  const total = tasks.length
  const done = tasks.filter(t => t.status === '已完成').length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const current = tasks.find(t => ['進行中', '待簽核'].includes(t.status))
  const currentStep = current?.step_order ?? (done > 0 ? done : 1)
  const stuck = days >= 3
  const allDone = total > 0 && done === total

  return (
    <div style={{
      padding: 12, borderRadius: 10, border: `1px solid ${C.borderSubtle}`,
      background: C.bg2, transition: 'border-color .12s',
    }}>
      {/* header — 點 toggle expand */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {index != null && (
              <span style={{ color: 'var(--text-muted)', fontWeight: 600, marginRight: 6 }}>#{index}</span>
            )}
            {w.template_name || '未命名流程'}
          </div>
          <ChevronRight size={14} style={{
            color: C.muted, flexShrink: 0,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform .15s',
          }} />
        </div>

        {/* 進度條 */}
        {total > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              flex: 1, height: 6, borderRadius: 3, background: C.borderSubtle, overflow: 'hidden',
              position: 'relative',
            }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                background: allDone ? C.green : C.blue, transition: 'width .3s',
              }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: allDone ? C.green : C.blue, minWidth: 36, textAlign: 'right' }}>
              {done}/{total}
            </span>
          </div>
        )}

        {/* meta */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, gap: 8 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            發起：{w.started_by || '—'}
          </span>
          <span style={{ color: stuck ? C.red : C.muted, fontWeight: stuck ? 700 : 500, flexShrink: 0 }}>
            {stuck && '🚨 '}已 {days} 天
          </span>
        </div>

        {/* 當前關卡 */}
        {current && !expanded && (
          <div style={{
            marginTop: 2, padding: '6px 8px', borderRadius: 6,
            background: TASK_STATUS_META[current.status]?.bg || C.bg2,
            fontSize: 11, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ color: TASK_STATUS_META[current.status]?.color, fontWeight: 700 }}>
              第 {currentStep} 關
            </span>
            <span style={{ color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {current.title}
            </span>
            {current.assignee && (
              <span style={{ color: C.muted, flexShrink: 0 }}>· {current.assignee}</span>
            )}
          </div>
        )}
      </div>

      {/* 展開：每關細節 */}
      {expanded && total > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tasks.map(t => {
            const meta = TASK_STATUS_META[t.status] || TASK_STATUS_META['待處理']
            const overdue = t.due_date && t.status !== '已完成' && t.due_date < todayStr()
            return (
              <div key={t.id} style={{
                padding: '6px 8px', borderRadius: 6,
                background: meta.bg,
                fontSize: 11, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: meta.color, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                }}>{t.step_order}</span>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                  </span>
                  {t.assignee && (
                    <span style={{ color: C.muted, fontSize: 10 }}>{t.assignee}</span>
                  )}
                </div>
                <span style={{ color: meta.color, fontWeight: 700, fontSize: 10, flexShrink: 0 }}>
                  {t.status}
                </span>
                {overdue && (
                  <span style={{ color: C.red, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>逾期</span>
                )}
              </div>
            )
          })}
          <button
            onClick={(e) => { e.stopPropagation(); onJump?.() }}
            style={{
              marginTop: 4, width: '100%', background: 'transparent',
              border: `1px solid ${C.borderSubtle}`, borderRadius: 6,
              padding: '6px 8px', cursor: 'pointer',
              fontSize: 11, color: C.cyan, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}
          >
            前往流程頁 <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────
// 主元件
// ──────────────────────────────────────────────
export default function TeamDashboard() {
  const { profile, role, hasPermission } = useAuth()
  const navigate = useNavigate()
  const userRole = role?.name || 'office_staff'
  const isManager = userRole === 'manager'
  const isAdminPlus = ['admin', 'super_admin'].includes(userRole)
  // 儀表板分頁可見性（admin 可在權限頁逐人調；super_admin 永遠 true；
  // manager/admin/super_admin 角色預設已含 nav.dashboard.*）
  const canSeeHr = hasPermission('nav.dashboard.hr')
  const canSeeProcess = hasPermission('nav.dashboard.process')

  // 「待我簽核」用 web_list_my_pending_approval_ids RPC 過濾，
  // 只算當前 chain step 真的指派給我的單，跟 /process/approvals 頁面口徑一致
  const { canApprove } = usePendingApprovals()

  const [tab, setTab] = useState('hr')  // 'hr' | 'process'
  // 實際顯示的分頁：先看選的 tab 有沒有權限，沒有就退到另一個有權限的
  const effectiveTab = (tab === 'process' && canSeeProcess) ? 'process'
    : (tab === 'hr' && canSeeHr) ? 'hr'
    : canSeeHr ? 'hr' : canSeeProcess ? 'process' : null
  const [stores, setStores] = useState([])
  const [storeFilter, setStoreFilter] = useState(null)  // admin 才會用
  const [team, setTeam] = useState([])
  // ── process tab data ──
  const [myTasks, setMyTasks] = useState([])
  const [activeWorkflows, setActiveWorkflows] = useState([])
  const [wfTasksMap, setWfTasksMap] = useState({})  // wf_instance_id -> tasks[]
  const [activeProjects, setActiveProjects] = useState([])
  const [processLoading, setProcessLoading] = useState(false)
  const [attendance, setAttendance] = useState([])
  const [todayLeaves, setTodayLeaves] = useState([])
  const [todayOvertimes, setTodayOvertimes] = useState([])
  const [todayTrips, setTodayTrips] = useState([])
  const [pendingLeaves, setPendingLeaves] = useState([])
  const [pendingOvertimes, setPendingOvertimes] = useState([])
  const [pendingTrips, setPendingTrips] = useState([])
  const [pendingCorrections, setPendingCorrections] = useState([])
  const [pendingResignations, setPendingResignations] = useState([])
  const [pendingLoas, setPendingLoas] = useState([])
  const [pendingTransfers, setPendingTransfers] = useState([])
  const [pendingExpenses, setPendingExpenses] = useState([])
  const [chainStepsMap, setChainStepsMap] = useState({})  // chain_id -> step count
  // ── Phase 1+2 補充：月累計、昨日對比、近 7 天 ──
  const [monthLeaveDays, setMonthLeaveDays] = useState(0)
  const [monthOtHours, setMonthOtHours] = useState(0)
  const [monthTripCount, setMonthTripCount] = useState(0)
  const [yesterdayLateCount, setYesterdayLateCount] = useState(0)
  const [last7Att, setLast7Att] = useState([])  // [{date, normal, late, leave}]
  const [taskStatusDist, setTaskStatusDist] = useState({})  // status -> count
  const [alerts, setAlerts] = useState([])
  const [hrStats, setHrStats] = useState(null)   // fn_hr_analytics（離職率/加班/薪資）
  const [hrDash, setHrDash] = useState(null)      // get_hr_dashboard（到期風險）
  const [loading, setLoading] = useState(true)
  const [refreshTick, setRefreshTick] = useState(0)

  const orgId = profile?.organization_id

  // ── 計算 scope（manager 鎖 store；admin 可選） ──
  const scopeStoreId = useMemo(() => {
    if (isManager) return profile?.store_id || null
    if (isAdminPlus) return storeFilter || null  // null = 全公司
    return null
  }, [isManager, isAdminPlus, profile?.store_id, storeFilter])

  // ── 載 stores（admin 才需要） ──
  useEffect(() => {
    if (!isAdminPlus || !orgId) return
    supabase.from('stores').select('id, name').eq('organization_id', orgId).order('name')
      .then(({ data }) => setStores(data || []))
  }, [isAdminPlus, orgId])

  // ── 主資料載入 ──
  const loadAll = useCallback(async () => {
    if (!orgId) return
    setLoading(true)

    // employees in scope — 用 * 抓全欄位避免 schema drift 造成 400
    // （demo DB 跟 migration files 對不上是常事，select * 拿到啥算啥）
    let empQ = supabase.from('employees')
      .select('*')
      .eq('organization_id', orgId)
      .eq('status', '在職')
      .order('name')
    if (scopeStoreId) empQ = empQ.eq('store_id', scopeStoreId)
    const { data: empData, error: empErr } = await empQ
    if (empErr) {
      console.warn('[TeamDashboard] employees query failed:', empErr)
      // try without status filter (避免 status 欄位值不對)
      const { data: retryData } = await supabase.from('employees')
        .select('id, name, store_id, store, dept, position')
        .eq('organization_id', orgId)
      console.warn('[TeamDashboard] employees retry data:', retryData)
    }
    const teamData = empData || []
    setTeam(teamData)
    const teamIds = teamData.map(e => e.id)

    if (teamIds.length === 0) {
      setAttendance([]); setTodayLeaves([]); setTodayOvertimes([]); setTodayTrips([])
      setPendingLeaves([]); setPendingOvertimes([]); setPendingTrips([]); setPendingCorrections([])
      setPendingResignations([]); setPendingLoas([]); setPendingTransfers([]); setPendingExpenses([])
      setChainStepsMap({})
      setAlerts([]); setLoading(false); return
    }

    const today = todayStr()
    const month = monthStr()

    // 今日 attendance
    const { data: attData } = await supabase.from('attendance_records')
      .select('employee_id, employee, clock_in, clock_out, status, hours, date')
      .eq('date', today).in('employee_id', teamIds)
    setAttendance(attData || [])

    // 今日生效中的假
    const { data: leavesOnToday } = await supabase.from('leave_requests')
      .select('id, employee_id, employee, type, start_date, end_date, status')
      .eq('status', '已核准')
      .in('employee_id', teamIds)
      .lte('start_date', today).gte('end_date', today)
    setTodayLeaves(leavesOnToday || [])

    // 今日有 OT 紀錄（已核准）
    const { data: otToday } = await supabase.from('overtime_requests')
      .select('id, employee_id, employee, date, hours, status')
      .eq('status', '已核准').eq('date', today).in('employee_id', teamIds)
    setTodayOvertimes(otToday || [])

    // 今日出差
    const { data: tripToday } = await supabase.from('business_trips')
      .select('id, employee_id, employee, start_date, end_date, status')
      .eq('status', '已核准')
      .in('employee_id', teamIds)
      .lte('start_date', today).gte('end_date', today)
    setTodayTrips(tripToday || [])

    // 待簽核 — 不嚴格做「指派給我」(那要解 chain step)，先列「我 scope 內的待審核」
    const [pl, po, pt, pc] = await Promise.all([
      supabase.from('leave_requests').select('id, employee, type, start_date, end_date, days, reason, created_at').eq('status', '待審核').in('employee_id', teamIds).order('created_at', { ascending: false }).limit(20),
      supabase.from('overtime_requests').select('id, employee, date, hours, reason, created_at').eq('status', '待審核').in('employee_id', teamIds).order('created_at', { ascending: false }).limit(20),
      supabase.from('business_trips').select('id, employee, start_date, end_date, destination, purpose, created_at').eq('status', '待審核').in('employee_id', teamIds).order('created_at', { ascending: false }).limit(20),
      supabase.from('clock_corrections').select('id, employee, date, reason, created_at').eq('status', '待審核').in('employee_id', teamIds).order('created_at', { ascending: false }).limit(20),
    ])
    setPendingLeaves(pl.data || [])
    setPendingOvertimes(po.data || [])
    setPendingTrips(pt.data || [])
    setPendingCorrections(pc.data || [])

    // ── HR B 類（chain-based）── 離職 / 留停 / 異動 / 費用申請
    const [pr, plo, ptr, per] = await Promise.all([
      supabase.from('resignation_requests')
        .select('id, employee_id, planned_resign_date, reason, status, current_step, approval_chain_id, created_at')
        .eq('status', '申請中').in('employee_id', teamIds)
        .order('created_at', { ascending: false }).limit(15),
      supabase.from('leave_of_absence_requests')
        .select('id, employee_id, start_date, planned_end_date, reason_type, status, current_step, approval_chain_id, created_at')
        .eq('status', '申請中').in('employee_id', teamIds)
        .order('created_at', { ascending: false }).limit(15),
      supabase.from('personnel_transfer_requests')
        .select('id, employee_id, transfer_type, effective_date, status, current_step, approval_chain_id, created_at')
        .eq('status', '申請中').in('employee_id', teamIds)
        .order('created_at', { ascending: false }).limit(15),
      supabase.from('expense_requests')
        .select('id, employee_id, employee, title, estimated_amount, status, current_step, approval_chain_id, created_at')
        .eq('status', '申請中').in('employee_id', teamIds)
        .order('created_at', { ascending: false }).limit(15),
    ])
    setPendingResignations(pr.data || [])
    setPendingLoas(plo.data || [])
    setPendingTransfers(ptr.data || [])
    setPendingExpenses(per.data || [])

    // 撈所有出現的 chain，算每條有幾關
    const chainIds = [...new Set([
      ...(pr.data || []).map(r => r.approval_chain_id),
      ...(plo.data || []).map(r => r.approval_chain_id),
      ...(ptr.data || []).map(r => r.approval_chain_id),
      ...(per.data || []).map(r => r.approval_chain_id),
    ].filter(Boolean))]
    if (chainIds.length > 0) {
      const { data: chains } = await supabase.from('approval_chains')
        .select('id, approval_chain_steps(id)')
        .in('id', chainIds)
      const map = {}
      for (const c of chains || []) {
        map[c.id] = (c.approval_chain_steps || []).length
      }
      setChainStepsMap(map)
    } else {
      setChainStepsMap({})
    }

    // ── 警示 ──
    const al = []

    // 試用期 7 天內到期（預設試用期 3 個月，從 join_date 推算）
    const soon = new Date()
    soon.setDate(soon.getDate() + 7)
    const soonStr = soon.toISOString().slice(0, 10)
    teamData.filter(e => e.join_date).forEach(e => {
      const probEnd = new Date(e.join_date)
      probEnd.setMonth(probEnd.getMonth() + 3)
      const probEndStr = probEnd.toISOString().slice(0, 10)
      if (probEndStr >= today && probEndStr <= soonStr) {
        al.push({
          type: 'probation', icon: '📅', color: C.orange,
          text: `試用期到期：${e.name}（${fmtDate(probEndStr)}）`,
        })
      }
    })

    // 本月加班接近上限（>= 36h；46h 法定上限）+ 本月累計
    const { data: monthOT } = await supabase.from('overtime_requests')
      .select('employee, hours').eq('status', '已核准').in('employee_id', teamIds)
      .gte('date', month + '-01').lte('date', today)
    const otSum = {}
    for (const r of monthOT || []) otSum[r.employee] = (otSum[r.employee] || 0) + Number(r.hours || 0)
    setMonthOtHours((monthOT || []).reduce((s, r) => s + Number(r.hours || 0), 0))

    // 本月請假累計 / 出差累計
    const [{ data: monthLeave }, { data: monthTrip }] = await Promise.all([
      supabase.from('leave_requests').select('days')
        .eq('status', '已核准').in('employee_id', teamIds)
        .gte('start_date', month + '-01'),
      supabase.from('business_trips').select('id')
        .eq('status', '已核准').in('employee_id', teamIds)
        .gte('start_date', month + '-01'),
    ])
    setMonthLeaveDays((monthLeave || []).reduce((s, r) => s + Number(r.days || 0), 0))
    setMonthTripCount((monthTrip || []).length)

    // 昨日未打卡（vs 今日對比）— 簡單算法：在職 - 昨日有 attendance 紀錄的人數
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)
    const { data: yAtt } = await supabase.from('attendance_records')
      .select('employee_id').eq('date', yesterdayStr).in('employee_id', teamIds)
    setYesterdayLateCount(Math.max(0, teamData.length - (yAtt || []).length))

    // 近 7 天出勤趨勢
    const last7Start = new Date()
    last7Start.setDate(last7Start.getDate() - 6)
    const { data: weekAtt } = await supabase.from('attendance_records')
      .select('date, status').gte('date', last7Start.toISOString().slice(0, 10))
      .lte('date', today).in('employee_id', teamIds)
    const days7 = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const ds = d.toISOString().slice(0, 10)
      const rows = (weekAtt || []).filter(a => a.date === ds)
      days7.push({
        date: ds,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        normal: rows.filter(a => ['正常', '補登'].includes(a.status)).length,
        late: rows.filter(a => a.status === '遲到').length,
      })
    }
    // 加每日請假人數（從 leave_requests 算今日生效）
    const { data: weekLeaves } = await supabase.from('leave_requests')
      .select('start_date, end_date').eq('status', '已核准').in('employee_id', teamIds)
      .lte('start_date', today).gte('end_date', last7Start.toISOString().slice(0, 10))
    for (const day of days7) {
      day.leave = (weekLeaves || []).filter(l => l.start_date <= day.date && l.end_date >= day.date).length
    }
    setLast7Att(days7)
    Object.entries(otSum).filter(([, h]) => h >= 36).forEach(([emp, h]) =>
      al.push({
        type: 'ot_cap', icon: '💸', color: h >= 46 ? C.red : C.orange,
        text: `加班接近上限：${emp} 本月 ${h.toFixed(1)}h（上限 46h）`,
      })
    )

    // 本週生日（MM-DD 落在這 7 天）
    const thisWeek = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() + i)
      thisWeek.push(d.toISOString().slice(5, 10))  // MM-DD
    }
    teamData.filter(e => e.birthday && thisWeek.includes(e.birthday.slice(5, 10)))
      .forEach(e => al.push({
        type: 'birthday', icon: '🎂', color: C.purple,
        text: `生日：${e.name}（${fmtDate(e.birthday)}）`,
      }))

    // ── HR 戰情：離職率/加班/薪資(fn_hr_analytics) + 到期風險(get_hr_dashboard) ──
    // 失敗不影響既有儀表板
    try {
      const { data: hs } = await supabase.rpc('fn_hr_analytics', { p_org_id: orgId })
      setHrStats(hs || null)
    } catch (e) { console.warn('[dashboard] fn_hr_analytics:', e) }
    try {
      const { data: hd } = await supabase.rpc('get_hr_dashboard', { p_org: orgId })
      setHrDash(hd || null)
    } catch (e) { console.warn('[dashboard] get_hr_dashboard:', e) }

    setAlerts(al)
    setLoading(false)
  }, [orgId, scopeStoreId])

  useEffect(() => { loadAll() }, [loadAll, refreshTick])

  // ── process tab 資料：只在第一次切到 process tab 或 refresh 時 load ──
  const loadProcessData = useCallback(async () => {
    if (!orgId || !profile?.name) return
    setProcessLoading(true)
    const today = todayStr()
    const teamNames = team.map(e => e.name).filter(Boolean)

    try {
      // 我的待辦任務（assignee = 我，未完成）
      const { data: tasksData } = await supabase.from('tasks')
        .select('*')
        .eq('assignee', profile.name)
        .neq('status', '已完成')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(20)
      setMyTasks(tasksData || [])

      // 進行中流程（status = 進行中），scope by assignee/started_by 在 team 內 (若 manager)
      let wfQ = supabase.from('workflow_instances')
        .select('*')
        .eq('status', '進行中')
        .order('started_at', { ascending: false })
        .limit(30)
      // manager 才 scope；admin 看全公司
      if (isManager && teamNames.length > 0) {
        wfQ = wfQ.or(`started_by.in.(${teamNames.map(n => `"${n}"`).join(',')}),assignee.in.(${teamNames.map(n => `"${n}"`).join(',')})`)
      }
      const { data: wfData } = await wfQ
      setActiveWorkflows(wfData || [])

      // 批次撈所有 active wf 的 tasks，算進度
      if (wfData && wfData.length > 0) {
        const wfIds = wfData.map(w => w.id)
        const { data: allTasks } = await supabase.from('tasks')
          .select('id, workflow_instance_id, step_order, title, assignee, assignee_id, status, due_date, completed_at')
          .in('workflow_instance_id', wfIds)
          .order('step_order', { ascending: true })
        const map = {}
        for (const t of allTasks || []) {
          if (!map[t.workflow_instance_id]) map[t.workflow_instance_id] = []
          map[t.workflow_instance_id].push(t)
        }
        setWfTasksMap(map)
      } else {
        setWfTasksMap({})
      }

      // 進行中專案
      const { data: prjData } = await supabase.from('projects')
        .select('*')
        .eq('status', '進行中')
        .order('created_at', { ascending: false })
        .limit(20)
      setActiveProjects(prjData || [])

      // 任務狀態分佈（scope = team 的 task）
      const teamIds = team.map(e => e.id)
      if (teamIds.length > 0) {
        const { data: allTasks } = await supabase.from('tasks')
          .select('status').in('assignee_id', teamIds).limit(2000)
        const dist = {}
        for (const t of allTasks || []) dist[t.status] = (dist[t.status] || 0) + 1
        setTaskStatusDist(dist)
      } else {
        setTaskStatusDist({})
      }
    } catch (e) {
      console.warn('[TeamDashboard] process query failed:', e)
    }
    setProcessLoading(false)
  }, [orgId, profile?.name, team, isManager])

  useEffect(() => {
    if (effectiveTab === 'process') loadProcessData()
  }, [effectiveTab, loadProcessData, refreshTick])

  // ── 自動 refresh (每 60 秒) ──
  useEffect(() => {
    const t = setInterval(() => setRefreshTick(x => x + 1), 60000)
    return () => clearInterval(t)
  }, [])

  // ── 流程 KPI / list 計算 ──
  const processKpi = useMemo(() => {
    const today = todayStr()
    const myActiveStarted = activeWorkflows.filter(w => w.started_by === profile?.name).length
    const overdue = activeWorkflows.filter(w => {
      if (!w.started_at) return false
      return daysBetween(today, w.started_at.slice(0, 10)) >= 3
    }).length
    const overdueTasks = myTasks.filter(t => t.due_date && t.due_date < today).length
    return {
      myTasks: myTasks.length,
      myActiveStarted,
      activeWfTotal: activeWorkflows.length,
      overdue,
      overdueTasks,
      activeProjects: activeProjects.length,
    }
  }, [activeWorkflows, myTasks, activeProjects, profile?.name])

  // ── 計算今日狀態 per emp ──
  const teamWithStatus = useMemo(() => {
    const attByEmp = new Map(attendance.map(a => [a.employee_id, a]))
    const leaveByEmp = new Map(todayLeaves.map(l => [l.employee_id, l]))
    const otByEmp = new Map(todayOvertimes.map(o => [o.employee_id, o]))
    const tripByEmp = new Map(todayTrips.map(t => [t.employee_id, t]))
    const hourNow = new Date().getHours()

    return team.map(emp => {
      let status = 'unknown'
      if (tripByEmp.has(emp.id)) status = 'trip'
      else if (leaveByEmp.has(emp.id)) {
        const t = leaveByEmp.get(emp.id).type
        status = ['病假', '事假'].includes(t) ? 'sick' : 'leave'
      } else if (attByEmp.has(emp.id)) {
        const a = attByEmp.get(emp.id)
        if (a.clock_in && !a.clock_out) status = 'on'
        else if (a.clock_in && a.clock_out) status = 'on'  // 已下班但今天有出勤
        else status = 'unknown'
      } else if (otByEmp.has(emp.id) && hourNow >= 18) {
        status = 'overtime'
      } else if (hourNow >= 10) {
        // 過了 10 點還沒打卡 → 未打卡警示
        status = 'late'
      }
      return { emp, status }
    })
  }, [team, attendance, todayLeaves, todayOvertimes, todayTrips])

  // ── KPI 計算 ──
  const kpi = useMemo(() => {
    const total = team.length
    const presentCount = teamWithStatus.filter(t => ['on', 'overtime'].includes(t.status)).length
    const leaveCount = teamWithStatus.filter(t => ['leave', 'sick'].includes(t.status)).length
    const otCount = todayOvertimes.length
    const tripCount = todayTrips.length
    const lateCount = teamWithStatus.filter(t => t.status === 'late').length

    // ★ 「待我簽核」改用 canApprove() 嚴格過濾 → 跟 /process/approvals 同口徑
    //   原本拿 team scope 內全部「待審核/申請中」直接加總會多算
    //   （管理員看到底下員工的單，但不一定輪到他簽）
    const myPendingLeaves       = pendingLeaves.filter(p => canApprove('leave_requests', p.id))
    const myPendingOvertimes    = pendingOvertimes.filter(p => canApprove('overtime_requests', p.id))
    const myPendingTrips        = pendingTrips.filter(p => canApprove('business_trips', p.id))
    const myPendingCorrections  = pendingCorrections.filter(p => canApprove('clock_corrections', p.id))
    const myPendingResignations = pendingResignations.filter(p => canApprove('resignation_requests', p.id))
    const myPendingLoas         = pendingLoas.filter(p => canApprove('leave_of_absence_requests', p.id))
    const myPendingTransfers    = pendingTransfers.filter(p => canApprove('personnel_transfer_requests', p.id))
    const myPendingExpenses     = pendingExpenses.filter(p => canApprove('expense_requests', p.id))

    const pendingCount = myPendingLeaves.length + myPendingOvertimes.length + myPendingTrips.length
      + myPendingCorrections.length + myPendingResignations.length + myPendingLoas.length
      + myPendingTransfers.length + myPendingExpenses.length

    const attendRate = total > 0 ? Math.round((presentCount + leaveCount + tripCount) / total * 100) : 0

    // 平均待簽天數：用過濾後的 allPending 算
    const todayStrLocal = todayStr()
    const allPending = [
      ...myPendingLeaves, ...myPendingOvertimes, ...myPendingTrips, ...myPendingCorrections,
      ...myPendingResignations, ...myPendingLoas, ...myPendingTransfers, ...myPendingExpenses,
    ]
    const avgPendingDays = allPending.length > 0
      ? Math.round(allPending.reduce((s, p) => s + daysBetween(todayStrLocal, p.created_at?.slice(0, 10)), 0) / allPending.length)
      : 0
    return { total, presentCount, leaveCount, otCount, tripCount, lateCount, pendingCount, attendRate, avgPendingDays }
  }, [team, teamWithStatus, todayOvertimes, todayTrips,
      pendingLeaves, pendingOvertimes, pendingTrips, pendingCorrections,
      pendingResignations, pendingLoas, pendingTransfers, pendingExpenses,
      canApprove])

  // ── 待簽核 unified list（排序：逾期優先 → 新到舊） ──
  // 同樣套 canApprove 過濾，保證列出的卡片都是「真的輪到我簽」的
  const pendingUnified = useMemo(() => {
    const today = todayStr()
    const empNameMap = Object.fromEntries(team.map(e => [e.id, e.name]))
    // chain progress：current_step 是 0-indexed (剛建= 0 表示等第 1 關)，顯示加 1
    const progressOf = (r) => {
      const total = chainStepsMap[r.approval_chain_id] || 0
      if (total === 0) return null
      const current = Math.min((r.current_step ?? 0) + 1, total)
      return { current, total }
    }
    const items = [
      ...pendingLeaves.filter(p => canApprove('leave_requests', p.id)).map(r => ({
        id: `leave-${r.id}`, kindLabel: '請假', kindColor: C.cyan,
        title: `${r.employee} 申請 ${r.type}（${r.days || daysBetween(r.end_date, r.start_date) + 1} 天）`,
        subtitle: `${fmtDate(r.start_date)}–${fmtDate(r.end_date)} · ${r.reason || ''}`.trim(),
        daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
        target: '/hr/leave',
      })),
      ...pendingOvertimes.filter(p => canApprove('overtime_requests', p.id)).map(r => ({
        id: `ot-${r.id}`, kindLabel: '加班', kindColor: C.orange,
        title: `${r.employee} 加班 ${r.hours}h`,
        subtitle: `${fmtDate(r.date)} · ${r.reason || ''}`.trim(),
        daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
        target: '/hr/overtime',
      })),
      ...pendingTrips.filter(p => canApprove('business_trips', p.id)).map(r => ({
        id: `trip-${r.id}`, kindLabel: '出差', kindColor: C.blue,
        title: `${r.employee} 出差到 ${r.destination || '—'}`,
        subtitle: `${fmtDate(r.start_date)}–${fmtDate(r.end_date)} · ${r.purpose || ''}`.trim(),
        daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
        target: '/hr/travel',
      })),
      ...pendingCorrections.filter(p => canApprove('clock_corrections', p.id)).map(r => ({
        id: `corr-${r.id}`, kindLabel: '補打卡', kindColor: C.purple,
        title: `${r.employee} 補打卡`,
        subtitle: `${fmtDate(r.date)} · ${r.reason || ''}`.trim(),
        daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
        target: '/hr/punch-correction',
      })),
      // ── B 類 chain-based ──
      ...pendingResignations.filter(p => canApprove('resignation_requests', p.id)).map(r => {
        const name = empNameMap[r.employee_id] || `員工 ${r.employee_id}`
        return {
          id: `resign-${r.id}`, kindLabel: '離職', kindColor: C.red,
          title: `${name} 申請離職（${r.reason || '—'}）`,
          subtitle: `預計 ${fmtDate(r.planned_resign_date)}`,
          daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
          target: '/hr/forms/resignation', progress: progressOf(r),
        }
      }),
      ...pendingLoas.filter(p => canApprove('leave_of_absence_requests', p.id)).map(r => {
        const name = empNameMap[r.employee_id] || `員工 ${r.employee_id}`
        return {
          id: `loa-${r.id}`, kindLabel: '留停', kindColor: C.purple,
          title: `${name} 申請留停（${r.reason_type || '—'}）`,
          subtitle: `${fmtDate(r.start_date)}–${fmtDate(r.planned_end_date)}`,
          daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
          target: '/hr/forms/submissions', progress: progressOf(r),
        }
      }),
      ...pendingTransfers.filter(p => canApprove('personnel_transfer_requests', p.id)).map(r => {
        const name = empNameMap[r.employee_id] || `員工 ${r.employee_id}`
        return {
          id: `transfer-${r.id}`, kindLabel: '異動', kindColor: C.blue,
          title: `${name} ${r.transfer_type || '人事異動'}`,
          subtitle: `生效 ${fmtDate(r.effective_date)}`,
          daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
          target: '/hr/forms/transfer', progress: progressOf(r),
        }
      }),
      ...pendingExpenses.filter(p => canApprove('expense_requests', p.id)).map(r => {
        const name = r.employee || empNameMap[r.employee_id] || `員工 ${r.employee_id}`
        return {
          id: `expense-${r.id}`, kindLabel: '費用', kindColor: C.green,
          title: `${name}：${r.title || '費用申請'}`,
          subtitle: `預估 NT$ ${Number(r.estimated_amount || 0).toLocaleString()}`,
          daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
          target: '/hr/expense-requests', progress: progressOf(r),
        }
      }),
    ]
    items.sort((a, b) => b.daysOpen - a.daysOpen)
    return items
  }, [pendingLeaves, pendingOvertimes, pendingTrips, pendingCorrections,
      pendingResignations, pendingLoas, pendingTransfers, pendingExpenses,
      chainStepsMap, team, canApprove])

  const [showAllPending, setShowAllPending] = useState(false)
  const pendingDisplay = showAllPending ? pendingUnified : pendingUnified.slice(0, 5)

  // ── Phase 2：chart 顏色 / options ──
  const chartC = useMemo(() => chartPalette(), [])
  const chartT = useMemo(() => chartTextTokens(), [])
  const chartOpts = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: chartT.tertiary, font: { size: 11, weight: 600 }, padding: 12, usePointStyle: true, pointStyleWidth: 8 },
      },
      tooltip: {
        backgroundColor: chartT.card, titleColor: chartT.primary, bodyColor: chartT.secondary,
        borderColor: chartT.border, borderWidth: 1, padding: 10, cornerRadius: 8,
      },
    },
  }), [chartT])
  // 部門人力分佈（從 team 算）
  const deptCounts = useMemo(() => {
    const m = {}
    for (const e of team) m[e.dept || '未分類'] = (m[e.dept || '未分類'] || 0) + 1
    return m
  }, [team])

  if (loading && team.length === 0) return <LoadingSpinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ─── Header ─── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
            {greetingNow()}，{profile?.name || '主管'}
          </h2>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
            {new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            {isManager && profile?.store && <> · {profile.store}</>}
            {isAdminPlus && scopeStoreId && stores.find(s => s.id === scopeStoreId) && <> · {stores.find(s => s.id === scopeStoreId).name}</>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isAdminPlus && (
            <select
              className="form-input"
              value={storeFilter || ''}
              onChange={e => setStoreFilter(e.target.value ? Number(e.target.value) : null)}
              style={{ fontSize: 13, padding: '6px 10px', minWidth: 140 }}
            >
              <option value="">全公司</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button
            onClick={() => setRefreshTick(x => x + 1)}
            title="重新整理"
            style={{
              background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8,
              padding: 8, cursor: 'pointer', color: C.muted,
            }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ─── Tab switcher（只顯示有權限的分頁；兩個都只剩一個就不必切換）─── */}
      {(canSeeHr || canSeeProcess) && (canSeeHr && canSeeProcess) && (
      <div style={{ display: 'flex', gap: 4, background: C.bg2, padding: 4, borderRadius: 10, width: 'fit-content', border: `1px solid ${C.borderSubtle}` }}>
        {canSeeHr && (
        <button
          onClick={() => setTab('hr')}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: effectiveTab === 'hr' ? C.card : 'transparent',
            color: effectiveTab === 'hr' ? 'var(--text-primary)' : C.muted,
            fontSize: 13, fontWeight: 600,
            boxShadow: effectiveTab === 'hr' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Users size={14} /> 人 · HR
        </button>
        )}
        {canSeeProcess && (
        <button
          onClick={() => setTab('process')}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: effectiveTab === 'process' ? C.card : 'transparent',
            color: effectiveTab === 'process' ? 'var(--text-primary)' : C.muted,
            fontSize: 13, fontWeight: 600,
            boxShadow: effectiveTab === 'process' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <WorkflowIcon size={14} /> 事 · 流程
        </button>
        )}
      </div>
      )}

      {!canSeeHr && !canSeeProcess && (
        <div style={{ padding: '60px 24px', textAlign: 'center', color: C.muted }}>
          <p style={{ fontSize: 14 }}>你的角色尚未開放任何戰情儀表板分頁。如需檢視，請聯繫管理員於「系統設定 → 權限」開通。</p>
        </div>
      )}

      {effectiveTab === 'hr' && <>
      {/* ─── KPI Bar (HR) ─── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12,
      }}>
        <KpiCard icon={Users} label="團隊在班" value={kpi.presentCount} suffix={`/ ${kpi.total}`}
                 sub={`出勤率 ${kpi.attendRate}%`}
                 color={C.green} colorDim={C.greenDim} />
        <KpiCard icon={Calendar} label="今日請假" value={kpi.leaveCount}
                 sub={monthLeaveDays > 0 ? `本月累計 ${monthLeaveDays} 天` : '本月零請假'}
                 color={C.cyan} colorDim={C.cyanDim}
                 onClick={() => navigate('/hr/leave')} />
        <KpiCard icon={Clock} label="今日加班" value={kpi.otCount}
                 sub={monthOtHours > 0 ? `本月累計 ${monthOtHours.toFixed(1)}h` : '本月零加班'}
                 color={C.orange} colorDim={C.orangeDim}
                 onClick={() => navigate('/hr/overtime')} />
        <KpiCard icon={Plane} label="今日出差" value={kpi.tripCount}
                 sub={monthTripCount > 0 ? `本月 ${monthTripCount} 人次` : '本月零出差'}
                 color={C.blue} colorDim={C.blueDim}
                 onClick={() => navigate('/hr/travel')} />
        <KpiCard icon={FileCheck} label="待我簽核" value={kpi.pendingCount}
                 sub={kpi.avgPendingDays > 0 ? `平均待簽 ${kpi.avgPendingDays} 天` : null}
                 subColor={kpi.avgPendingDays >= 3 ? C.red : C.muted}
                 color={C.purple} colorDim={C.purpleDim}
                 badge={pendingUnified.some(p => p.daysOpen >= 3) ? '逾期' : null}
                 onClick={() => navigate('/process/approvals')} />
        <KpiCard icon={AlertTriangle} label="未打卡" value={kpi.lateCount}
                 sub={(() => {
                   const diff = kpi.lateCount - yesterdayLateCount
                   if (diff === 0) return `與昨日相同`
                   return diff > 0 ? `比昨日 +${diff}` : `比昨日 ${diff}`
                 })()}
                 subColor={kpi.lateCount > yesterdayLateCount ? C.red : C.green}
                 color={C.red} colorDim={C.redDim}
                 onClick={() => navigate('/hr/attendance')} />
        <KpiCard icon={TrendingUp} label="滾動離職率"
                 value={hrStats?.attrition?.rate_pct != null ? hrStats.attrition.rate_pct : '—'}
                 suffix={hrStats?.attrition?.rate_pct != null ? '%' : ''}
                 sub={hrStats?.attrition?.ytd_terms != null ? `今年離職 ${hrStats.attrition.ytd_terms} 人` : '近 12 個月'}
                 color={(hrStats?.attrition?.rate_pct ?? 0) > 10 ? C.red : (hrStats?.attrition?.rate_pct ?? 0) > 5 ? C.orange : C.green}
                 colorDim={(hrStats?.attrition?.rate_pct ?? 0) > 10 ? C.redDim : (hrStats?.attrition?.rate_pct ?? 0) > 5 ? C.orangeDim : C.greenDim}
                 onClick={() => navigate('/analytics/HRAnalytics')} />
      </div>

      {/* ─── AI 智慧洞察（Gemini）─── */}
      <DashboardAiChat
        scopeStoreId={scopeStoreId}
        stores={stores}
        kpi={kpi}
        monthLeaveDays={monthLeaveDays}
        monthOtHours={monthOtHours}
        monthTripCount={monthTripCount}
        pendingUnified={pendingUnified}
        alerts={alerts}
        activeWorkflows={activeWorkflows}
      />

      {/* ─── 待簽核 + 警示（main + side） ─── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
        gap: 16,
      }} className="dash-two-col">
        {/* 待簽核 */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileCheck size={16} style={{ color: C.purple }} /> 待簽核
              {pendingUnified.length > 0 && (
                <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>({pendingUnified.length})</span>
              )}
            </h3>
            <button
              onClick={() => navigate('/process/approvals')}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: C.cyan, display: 'flex', alignItems: 'center', gap: 4 }}>
              全部 <ChevronRight size={12} />
            </button>
          </div>

          {pendingUnified.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
              <CheckCircle2 size={28} style={{ color: C.green, marginBottom: 8 }} /><br />
              🎉 今日無待簽案件
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pendingDisplay.map(item => (
                  <PendingRow key={item.id} item={item} onClick={() => navigate(item.target)} />
                ))}
              </div>
              {pendingUnified.length > 5 && (
                <button
                  onClick={() => setShowAllPending(s => !s)}
                  style={{ marginTop: 10, width: '100%', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 8, padding: 8, cursor: 'pointer', fontSize: 12, color: C.muted }}>
                  {showAllPending ? '收起' : `展開全部 ${pendingUnified.length} 筆`}
                </button>
              )}
            </>
          )}
        </div>

        {/* 警示 */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <h3 style={{ margin: 0, marginBottom: 12, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} style={{ color: C.orange }} /> 警示
            {alerts.length > 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>({alerts.length})</span>
            )}
          </h3>
          {alerts.length === 0 ? (
            <div style={{ padding: '20px 8px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
              ✅ 一切正常
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alerts.slice(0, 6).map((a, i) => (
                <div key={i} style={{
                  padding: '8px 10px', borderRadius: 8,
                  background: C.bg2, border: `1px solid ${C.borderSubtle}`,
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12,
                }}>
                  <span style={{ fontSize: 16 }}>{a.icon}</span>
                  <span style={{ color: a.color, fontWeight: 500, flex: 1 }}>{a.text}</span>
                </div>
              ))}
              {alerts.length > 6 && (
                <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 4 }}>
                  還有 {alerts.length - 6} 則
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── 到期提醒（特休/外籍證件;有資料才顯示，避免空卡）─── */}
      {(hrDash?.leave_expiry?.people > 0 || hrDash?.permit_expiry?.people > 0) && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>⏰ 到期提醒</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {hrDash?.leave_expiry?.people > 0 && (
              <div onClick={() => navigate('/hr/leave-balances')} style={{ cursor: 'pointer', padding: 12, borderRadius: 8, background: C.bg2 }}>
                <div style={{ fontSize: 13, color: C.muted }}>特休將到期</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: hrDash.leave_expiry.crit > 0 ? C.red : C.orange }}>
                  {hrDash.leave_expiry.people} 人 · {hrDash.leave_expiry.total_days} 天
                </div>
                <div style={{ fontSize: 12, color: C.muted }}>{hrDash.thresholds?.leave_warn} 天內到期</div>
              </div>
            )}
            {hrDash?.permit_expiry?.people > 0 && (
              <div onClick={() => navigate('/hr/foreign-workers')} style={{ cursor: 'pointer', padding: 12, borderRadius: 8, background: C.bg2 }}>
                <div style={{ fontSize: 13, color: C.muted }}>外籍證件將到期</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: hrDash.permit_expiry.crit > 0 ? C.red : C.orange }}>
                  {hrDash.permit_expiry.people} 人
                </div>
                <div style={{ fontSize: 12, color: C.muted }}>{hrDash.thresholds?.permit_warn} 天內</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── 薪資成本（僅有薪資權限者，後端 RPC 沒回就不顯示）─── */}
      {hrDash?.salary_cost && (() => {
        const sc = hrDash.salary_cost
        const delta = sc.last_total > 0 ? ((sc.this_total - sc.last_total) / sc.last_total) * 100 : null
        const otPct = sc.this_total > 0 ? (sc.ot_total / sc.this_total) * 100 : 0
        const maxDept = Math.max(1, ...(sc.by_dept || []).map(d => Number(d.total) || 0))
        return (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>💰 薪資成本（{sc.month}）</div>
              <button onClick={() => navigate('/hr/salary')} style={{ background: 'transparent', border: 'none', color: C.cyan, cursor: 'pointer', fontSize: 13 }}>明細 ›</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 12, marginBottom: (sc.by_dept || []).length ? 14 : 0 }}>
              <div style={{ padding: 12, borderRadius: 8, background: C.bg2 }}>
                <div style={{ fontSize: 13, color: C.muted }}>本月人事成本（實領）</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>NT$ {Math.round(sc.this_total).toLocaleString()}</div>
                {delta != null && (
                  <div style={{ fontSize: 12, color: delta > 0 ? C.red : C.green }}>
                    比上月 {delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%
                  </div>
                )}
              </div>
              <div style={{ padding: 12, borderRadius: 8, background: C.bg2 }}>
                <div style={{ fontSize: 13, color: C.muted }}>加班費佔比</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: otPct > 15 ? C.orange : 'var(--text-primary)' }}>{otPct.toFixed(1)}%</div>
                <div style={{ fontSize: 12, color: C.muted }}>加班費 NT$ {Math.round(sc.ot_total).toLocaleString()}</div>
              </div>
            </div>
            {(sc.by_dept || []).slice(0, 6).map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 90, fontSize: 12, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.dept}</div>
                <div style={{ flex: 1, height: 8, background: C.bg2, borderRadius: 4 }}>
                  <div style={{ width: `${(Number(d.total) / maxDept) * 100}%`, height: '100%', background: C.cyan, borderRadius: 4 }} />
                </div>
                <div style={{ width: 90, fontSize: 12, textAlign: 'right' }}>NT$ {Math.round(Number(d.total)).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* ─── 本月加班 Top（fn_hr_analytics）─── */}
      {hrStats?.overtime?.top_overtimers?.length > 0 && (() => {
        const ot = hrStats.overtime
        const maxH = Math.max(1, ...ot.top_overtimers.map(o => Number(o.hours) || 0))
        return (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>🔥 本月加班 Top{ot.this_month_total_hours != null ? `（共 ${Number(ot.this_month_total_hours).toFixed(0)}h）` : ''}</div>
              <button onClick={() => navigate('/hr/overtime')} style={{ background: 'transparent', border: 'none', color: C.cyan, cursor: 'pointer', fontSize: 13 }}>明細 ›</button>
            </div>
            {ot.top_overtimers.slice(0, 5).map((o, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 90, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.name}</div>
                <div style={{ flex: 1, height: 8, background: C.bg2, borderRadius: 4 }}>
                  <div style={{ width: `${(Number(o.hours) / maxH) * 100}%`, height: '100%', background: Number(o.hours) >= 46 ? C.red : C.orange, borderRadius: 4 }} />
                </div>
                <div style={{ width: 56, fontSize: 12, textAlign: 'right', color: Number(o.hours) >= 46 ? C.red : 'var(--text-primary)' }}>{Number(o.hours).toFixed(1)}h</div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* ─── 簽核效率：我的待簽分佈 + 卡關 ─── */}
      {pendingUnified.length > 0 && (() => {
        const byKind = {}
        for (const p of pendingUnified) {
          if (!byKind[p.kindLabel]) byKind[p.kindLabel] = { count: 0, color: p.kindColor, target: p.target, maxDays: 0 }
          byKind[p.kindLabel].count += 1
          byKind[p.kindLabel].maxDays = Math.max(byKind[p.kindLabel].maxDays, p.daysOpen || 0)
        }
        const maxStuck = Math.max(0, ...pendingUnified.map(p => p.daysOpen || 0))
        return (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                📋 待簽分佈（{pendingUnified.length} 件）
                {maxStuck >= 3 && <span style={{ marginLeft: 8, fontSize: 12, color: C.red }}>最久卡 {maxStuck} 天</span>}
              </div>
              <button onClick={() => navigate('/process/approvals')} style={{ background: 'transparent', border: 'none', color: C.cyan, cursor: 'pointer', fontSize: 13 }}>全部 ›</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries(byKind).map(([k, v]) => (
                <div key={k} onClick={() => navigate(v.target)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: C.bg2, border: `1px solid ${v.maxDays >= 3 ? C.red : C.borderSubtle}` }}>
                  <span style={{ fontSize: 13 }}>{k}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: v.color }}>{v.count}</span>
                  {v.maxDays >= 3 && <span style={{ fontSize: 11, color: C.red }}>🔴{v.maxDays}天</span>}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ─── 流動率：近 12 月離職趨勢 ─── */}
      {hrStats?.attrition?.by_month?.length > 0 && (() => {
        const bm = hrStats.attrition.by_month
        const maxC = Math.max(1, ...bm.map(m => Number(m.count) || 0))
        return (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>📉 近 12 月離職趨勢</div>
              <button onClick={() => navigate('/analytics/HRAnalytics')} style={{ background: 'transparent', border: 'none', color: C.cyan, cursor: 'pointer', fontSize: 13 }}>分析 ›</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 90 }}>
              {bm.map((m, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, color: C.muted }}>{Number(m.count) || 0}</div>
                  <div style={{ width: '70%', height: `${(Number(m.count) / maxC) * 60}px`, minHeight: Number(m.count) > 0 ? 3 : 0, background: C.cyan, borderRadius: 3 }} />
                  <div style={{ fontSize: 9, color: C.muted }}>{String(m.month).slice(5)}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ─── Charts row：近 7 天出勤 + 部門人力 ─── */}
      <DashboardCharts last7Att={last7Att} deptCounts={deptCounts} />

      {/* ─── 團隊狀態 grid ─── */}
      {/* 顯示規則：
       *   - manager → 看自己 store（人數少，全列出含 unknown）
       *   - admin/super_admin 有選 store → 看該 store 的（全列出含 unknown）
       *   - admin/super_admin 沒選 store → 全公司視角，只列「異常」(休假/請假/出差/加班中/未打卡)
       *     原因：全公司 N 十人 punch grid 是噪音；GM 想看誰異常，不是看誰正常
       */}
      {(() => {
        const showAll = isManager || (isAdminPlus && scopeStoreId)
        // 全公司視角時排除 'late'：未打卡有專屬 KPI（紅卡），點 KPI 可下鑽 /hr/attendance
        // 這邊只列「在班的特殊狀態」(休假/請假/加班中/出差)，避免 dashboard 被未打卡淹沒
        const visible = showAll
          ? teamWithStatus
          : teamWithStatus.filter(t => ['leave', 'sick', 'overtime', 'trip'].includes(t.status))
        const title = showAll ? '團隊狀態' : '今日特殊狀態'
        const countLabel = showAll ? `${team.length} 人` : `${visible.length} 人`
        return (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={16} style={{ color: C.cyan }} /> {title}
                <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>（{countLabel}）</span>
              </h3>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.muted, flexWrap: 'wrap' }}>
                {Object.entries(STATUS_META)
                  .filter(([k]) => showAll
                    ? ['on','leave','sick','overtime','trip','late'].includes(k)
                    : ['leave','sick','overtime','trip'].includes(k))
                  .map(([k, m]) => (
                    <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span>{m.icon}</span>{m.label}
                    </span>
                  ))}
              </div>
            </div>

            {team.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
                尚無團隊成員
              </div>
            ) : visible.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
                ✅ 今日無人請假／出差／加班
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                gap: 10,
              }}>
                {visible.map(({ emp, status }) => (
                  <TeamMemberCard key={emp.id} emp={emp} status={status} />
                ))}
              </div>
            )}
          </div>
        )
      })()}
      </>}

      {effectiveTab === 'process' && <>
      {/* ─── KPI Bar (Process) ─── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12,
      }}>
        <KpiCard icon={ListChecks} label="我的待辦任務" value={processKpi.myTasks}
                 sub={processKpi.overdueTasks > 0 ? `逾期 ${processKpi.overdueTasks} 件` : '無逾期'}
                 subColor={processKpi.overdueTasks > 0 ? C.red : C.green}
                 badge={processKpi.overdueTasks > 0 ? `${processKpi.overdueTasks} 逾期` : null}
                 color={C.cyan} colorDim={C.cyanDim}
                 onClick={() => navigate('/process/tasks')} />
        <KpiCard icon={WorkflowIcon} label="進行中流程" value={processKpi.activeWfTotal}
                 sub={processKpi.myActiveStarted > 0 ? `我發起 ${processKpi.myActiveStarted}` : null}
                 color={C.blue} colorDim={C.blueDim}
                 onClick={() => navigate('/process/workflows')} />
        <KpiCard icon={Hourglass} label="流程卡關 ≥3 天" value={processKpi.overdue}
                 sub={processKpi.overdue > 0 ? '需追蹤' : '一切順暢'}
                 subColor={processKpi.overdue > 0 ? C.red : C.green}
                 color={C.red} colorDim={C.redDim} />
        <KpiCard icon={FolderOpen} label="進行中專案" value={processKpi.activeProjects}
                 sub={processKpi.activeProjects > 0 ? null : '無進行中專案'}
                 color={C.green} colorDim={C.greenDim}
                 onClick={() => navigate('/process/projects')} />
      </div>

      {/* ─── 我的待辦任務 + 卡關流程（main + side） ─── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
        gap: 16,
      }} className="dash-two-col">
        {/* 我的待辦任務 */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ListChecks size={16} style={{ color: C.cyan }} /> 我的待辦任務
              {myTasks.length > 0 && (
                <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>({myTasks.length})</span>
              )}
            </h3>
            <button onClick={() => navigate('/process/tasks')}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: C.cyan, display: 'flex', alignItems: 'center', gap: 4 }}>
              全部 <ChevronRight size={12} />
            </button>
          </div>

          {processLoading ? <LoadingSpinner /> : myTasks.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
              <CheckCircle2 size={28} style={{ color: C.green, marginBottom: 8 }} /><br />
              🎉 沒有待辦任務
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {myTasks.slice(0, 8).map(t => {
                const today = todayStr()
                const overdue = t.due_date && t.due_date < today
                const due = t.due_date ? daysBetween(t.due_date, today) : null
                return (
                  <div key={t.id}
                    onClick={() => navigate(
                      t.workflow_instance_id && hasPermission('nav.project.work') ? `/process/workflows?focus=${t.workflow_instance_id}`
                      : t.project_id && hasPermission('nav.project.work') ? `/process/projects?project=${t.project_id}`
                      : `/process/tasks?focus=${t.id}`
                    )}
                    style={{
                      padding: 12, borderRadius: 10, border: `1px solid ${C.borderSubtle}`,
                      background: C.bg2, cursor: 'pointer',
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.cyan }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderSubtle }}
                  >
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, flexShrink: 0,
                      background: t.priority === '高' ? C.redDim : t.priority === '低' ? C.greenDim : C.orangeDim,
                      color: t.priority === '高' ? C.red : t.priority === '低' ? C.green : C.orange,
                    }}>{t.priority || '中'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: 'flex', gap: 8 }}>
                        {t.workflow && <span>📋 {t.workflow}</span>}
                        {!t.workflow && t.project_id && <span>🗂 專案任務</span>}
                        <span>狀態：{t.status}</span>
                      </div>
                    </div>
                    {t.due_date && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, flexShrink: 0,
                        color: overdue ? C.red : due <= 3 ? C.orange : C.muted,
                      }}>
                        {overdue ? `🚨 逾期 ${Math.abs(due)}天` : `⏰ ${fmtDate(t.due_date)}`}
                      </span>
                    )}
                  </div>
                )
              })}
              {myTasks.length > 8 && (
                <div style={{ textAlign: 'center', fontSize: 11, color: C.muted, marginTop: 4 }}>
                  還有 {myTasks.length - 8} 個任務 → 看全部
                </div>
              )}
            </div>
          )}
        </div>

        {/* 卡關流程 */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <h3 style={{ margin: 0, marginBottom: 12, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Hourglass size={16} style={{ color: C.red }} /> 卡關提示
          </h3>
          {(() => {
            const today = todayStr()
            const stuck = activeWorkflows.filter(w => w.started_at && daysBetween(today, w.started_at.slice(0, 10)) >= 3)
            if (stuck.length === 0) return (
              <div style={{ padding: '20px 8px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
                ✅ 沒有卡關流程
              </div>
            )
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {stuck.slice(0, 6).map(w => {
                  const days = daysBetween(today, w.started_at.slice(0, 10))
                  const tasks = wfTasksMap[w.id] || []
                  const total = tasks.length
                  const done = tasks.filter(t => t.status === '已完成').length
                  const current = tasks.find(t => ['進行中', '待簽核'].includes(t.status))
                  return (
                    <div key={w.id}
                      onClick={() => navigate('/process/workflows')}
                      style={{
                        padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                        background: C.bg2, border: `1px solid ${C.borderSubtle}`,
                        fontSize: 12, transition: 'border-color .12s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.red }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderSubtle }}
                    >
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                        {w.template_name || '未命名流程'}
                      </div>
                      {current && (
                        <div style={{ color: C.orange, fontSize: 11, marginBottom: 2 }}>
                          卡在第 {current.step_order}/{total} 關：{current.title}
                          {current.assignee && <span style={{ color: C.muted }}> · 等 {current.assignee}</span>}
                        </div>
                      )}
                      <div style={{ color: C.muted, fontSize: 11, display: 'flex', gap: 6, justifyContent: 'space-between' }}>
                        <span>發起：{w.started_by || '—'}{total > 0 && ` · ${done}/${total}`}</span>
                        <span style={{ color: days >= 7 ? C.red : C.orange, fontWeight: 700 }}>
                          🚨 {days} 天
                        </span>
                      </div>
                    </div>
                  )
                })}
                {stuck.length > 6 && (
                  <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 4 }}>
                    還有 {stuck.length - 6} 個
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      </div>

      {/* ─── 任務狀態分佈 doughnut ─── */}
      {Object.keys(taskStatusDist).length > 0 && (() => {
        const total = Object.values(taskStatusDist).reduce((a, b) => a + b, 0)
        const done = taskStatusDist['已完成'] || 0
        const pct = total > 0 ? Math.round(done / total * 100) : 0
        const labels = Object.keys(taskStatusDist)
        const data = Object.values(taskStatusDist)
        const colorMap = {
          '已完成': chartC.green, '進行中': chartC.blue,
          '待簽核': chartC.orange, '待處理': chartC.purple,
          '已擱置': chartC.red,
        }
        return (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
            <h3 style={{ margin: 0, marginBottom: 12, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <PieIcon size={16} style={{ color: C.purple }} /> 任務狀態分佈
              <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>（共 {total}）</span>
            </h3>
            <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ width: 180, height: 180, position: 'relative', flexShrink: 0 }}>
                <Doughnut
                  data={{
                    labels,
                    datasets: [{
                      data,
                      backgroundColor: labels.map(l => colorMap[l] || chartC.cyan),
                      borderWidth: 0, hoverOffset: 6,
                    }],
                  }}
                  options={{ ...chartOpts, cutout: '68%', plugins: { ...chartOpts.plugins, legend: { display: false } } }}
                />
                <div style={{
                  position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{pct}%</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>完成率</div>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {labels.map((l, i) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: colorMap[l] || chartC.cyan, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{l}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{data[i]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ─── 進行中流程 list ─── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <WorkflowIcon size={16} style={{ color: C.blue }} /> 進行中流程
            {activeWorkflows.length > 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>({activeWorkflows.length})</span>
            )}
          </h3>
          <button onClick={() => navigate('/process/workflows')}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: C.cyan, display: 'flex', alignItems: 'center', gap: 4 }}>
            全部 <ChevronRight size={12} />
          </button>
        </div>

        {processLoading ? <LoadingSpinner /> : activeWorkflows.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
            目前沒有進行中流程
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {activeWorkflows.slice(0, 9).map((w, i) => {
              const today = todayStr()
              const days = w.started_at ? daysBetween(today, w.started_at.slice(0, 10)) : 0
              const tasks = wfTasksMap[w.id] || []
              return (
                <WorkflowProgressCard
                  key={w.id}
                  index={i + 1}
                  w={w}
                  tasks={tasks}
                  days={days}
                  onJump={() => navigate('/process/workflows')}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* ─── 進行中專案 ─── */}
      {activeProjects.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FolderOpen size={16} style={{ color: C.green }} /> 進行中專案
              <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>({activeProjects.length})</span>
            </h3>
            <button onClick={() => navigate('/process/projects')}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: C.cyan, display: 'flex', alignItems: 'center', gap: 4 }}>
              全部 <ChevronRight size={12} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {activeProjects.slice(0, 8).map((p, i) => (
              <div key={p.id}
                onClick={() => navigate('/process/projects')}
                style={{
                  padding: 12, borderRadius: 10, border: `1px solid ${C.borderSubtle}`,
                  background: C.bg2, cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.green }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderSubtle }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  <span style={{ color: C.muted, fontWeight: 600, marginRight: 6 }}>#{i + 1}</span>
                  {p.name}
                </div>
                {p.description && (
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4,
                    overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  }}>{p.description}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      </>}

      {/* RWD 微調 */}
      <style>{`
        @media (max-width: 768px) {
          .dash-two-col { grid-template-columns: 1fr !important; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
