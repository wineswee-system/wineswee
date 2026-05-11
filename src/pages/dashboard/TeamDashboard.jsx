import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Calendar, Clock, FileCheck, AlertTriangle, Cake,
  ChevronRight, CheckCircle2, XCircle, MessageSquare,
  Building2, RefreshCw, Briefcase, Plane,
  ListChecks, Workflow as WorkflowIcon, FolderOpen, Hourglass,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'

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
// 子元件：KPI 卡片
// ──────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, suffix, color = C.cyan, colorDim = C.cyanDim, badge, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: 16, cursor: onClick ? 'pointer' : 'default',
        transition: 'transform .12s, border-color .12s',
        display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
      }}
      onMouseEnter={(e) => { if (onClick) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.borderColor = color } }}
      onMouseLeave={(e) => { if (onClick) { e.currentTarget.style.transform = ''; e.currentTarget.style.borderColor = C.border } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, background: colorDim,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color,
        }}>
          <Icon size={18} />
        </div>
        {badge && (
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 12, fontWeight: 700,
            background: C.redDim, color: C.red,
          }}>{badge}</span>
        )}
      </div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
          {value}{suffix && <span style={{ fontSize: 14, fontWeight: 500, color: C.muted, marginLeft: 4 }}>{suffix}</span>}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{label}</div>
      </div>
    </div>
  )
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

function WorkflowProgressCard({ w, tasks, days, onJump }) {
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
  const { profile, role } = useAuth()
  const navigate = useNavigate()
  const userRole = role?.name || 'office_staff'
  const isManager = userRole === 'manager'
  const isAdminPlus = ['admin', 'super_admin'].includes(userRole)

  const [tab, setTab] = useState('hr')  // 'hr' | 'process'
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
  const [alerts, setAlerts] = useState([])
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

    // 本月加班接近上限（>= 36h；46h 法定上限）
    const { data: monthOT } = await supabase.from('overtime_requests')
      .select('employee, hours').eq('status', '已核准').in('employee_id', teamIds)
      .gte('date', month + '-01').lte('date', today)
    const otSum = {}
    for (const r of monthOT || []) otSum[r.employee] = (otSum[r.employee] || 0) + Number(r.hours || 0)
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
    } catch (e) {
      console.warn('[TeamDashboard] process query failed:', e)
    }
    setProcessLoading(false)
  }, [orgId, profile?.name, team, isManager])

  useEffect(() => {
    if (tab === 'process') loadProcessData()
  }, [tab, loadProcessData, refreshTick])

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
    const pendingCount = pendingLeaves.length + pendingOvertimes.length + pendingTrips.length + pendingCorrections.length
      + pendingResignations.length + pendingLoas.length + pendingTransfers.length + pendingExpenses.length
    return { total, presentCount, leaveCount, otCount, tripCount, lateCount, pendingCount }
  }, [team, teamWithStatus, todayOvertimes, todayTrips,
      pendingLeaves, pendingOvertimes, pendingTrips, pendingCorrections,
      pendingResignations, pendingLoas, pendingTransfers, pendingExpenses])

  // ── 待簽核 unified list（排序：逾期優先 → 新到舊） ──
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
      ...pendingLeaves.map(r => ({
        id: `leave-${r.id}`, kindLabel: '請假', kindColor: C.cyan,
        title: `${r.employee} 申請 ${r.type}（${r.days || daysBetween(r.end_date, r.start_date) + 1} 天）`,
        subtitle: `${fmtDate(r.start_date)}–${fmtDate(r.end_date)} · ${r.reason || ''}`.trim(),
        daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
        target: '/hr/leave',
      })),
      ...pendingOvertimes.map(r => ({
        id: `ot-${r.id}`, kindLabel: '加班', kindColor: C.orange,
        title: `${r.employee} 加班 ${r.hours}h`,
        subtitle: `${fmtDate(r.date)} · ${r.reason || ''}`.trim(),
        daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
        target: '/hr/overtime',
      })),
      ...pendingTrips.map(r => ({
        id: `trip-${r.id}`, kindLabel: '出差', kindColor: C.blue,
        title: `${r.employee} 出差到 ${r.destination || '—'}`,
        subtitle: `${fmtDate(r.start_date)}–${fmtDate(r.end_date)} · ${r.purpose || ''}`.trim(),
        daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
        target: '/hr/travel',
      })),
      ...pendingCorrections.map(r => ({
        id: `corr-${r.id}`, kindLabel: '補打卡', kindColor: C.purple,
        title: `${r.employee} 補打卡`,
        subtitle: `${fmtDate(r.date)} · ${r.reason || ''}`.trim(),
        daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
        target: '/hr/punch-correction',
      })),
      // ── B 類 chain-based ──
      ...pendingResignations.map(r => {
        const name = empNameMap[r.employee_id] || `員工 ${r.employee_id}`
        return {
          id: `resign-${r.id}`, kindLabel: '離職', kindColor: C.red,
          title: `${name} 申請離職（${r.reason || '—'}）`,
          subtitle: `預計 ${fmtDate(r.planned_resign_date)}`,
          daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
          target: '/hr/forms/resignation', progress: progressOf(r),
        }
      }),
      ...pendingLoas.map(r => {
        const name = empNameMap[r.employee_id] || `員工 ${r.employee_id}`
        return {
          id: `loa-${r.id}`, kindLabel: '留停', kindColor: C.purple,
          title: `${name} 申請留停（${r.reason_type || '—'}）`,
          subtitle: `${fmtDate(r.start_date)}–${fmtDate(r.planned_end_date)}`,
          daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
          target: '/hr/forms/submissions', progress: progressOf(r),
        }
      }),
      ...pendingTransfers.map(r => {
        const name = empNameMap[r.employee_id] || `員工 ${r.employee_id}`
        return {
          id: `transfer-${r.id}`, kindLabel: '異動', kindColor: C.blue,
          title: `${name} ${r.transfer_type || '人事異動'}`,
          subtitle: `生效 ${fmtDate(r.effective_date)}`,
          daysOpen: daysBetween(today, r.created_at?.slice(0, 10)), created_at: r.created_at,
          target: '/hr/forms/transfer', progress: progressOf(r),
        }
      }),
      ...pendingExpenses.map(r => {
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
      chainStepsMap, team])

  const [showAllPending, setShowAllPending] = useState(false)
  const pendingDisplay = showAllPending ? pendingUnified : pendingUnified.slice(0, 5)

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

      {/* ─── Tab switcher ─── */}
      <div style={{ display: 'flex', gap: 4, background: C.bg2, padding: 4, borderRadius: 10, width: 'fit-content', border: `1px solid ${C.borderSubtle}` }}>
        <button
          onClick={() => setTab('hr')}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: tab === 'hr' ? C.card : 'transparent',
            color: tab === 'hr' ? 'var(--text-primary)' : C.muted,
            fontSize: 13, fontWeight: 600,
            boxShadow: tab === 'hr' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Users size={14} /> 人 · HR
        </button>
        <button
          onClick={() => setTab('process')}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: tab === 'process' ? C.card : 'transparent',
            color: tab === 'process' ? 'var(--text-primary)' : C.muted,
            fontSize: 13, fontWeight: 600,
            boxShadow: tab === 'process' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <WorkflowIcon size={14} /> 事 · 流程
        </button>
      </div>

      {tab === 'hr' && <>
      {/* ─── KPI Bar (HR) ─── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12,
      }}>
        <KpiCard icon={Users}         label="團隊在班"  value={kpi.presentCount} suffix={`/ ${kpi.total}`} color={C.green}  colorDim={C.greenDim} />
        <KpiCard icon={Calendar}      label="今日請假"  value={kpi.leaveCount}  color={C.cyan}   colorDim={C.cyanDim} />
        <KpiCard icon={Clock}         label="今日加班"  value={kpi.otCount}     color={C.orange} colorDim={C.orangeDim} />
        <KpiCard icon={Plane}         label="今日出差"  value={kpi.tripCount}   color={C.blue}   colorDim={C.blueDim} />
        <KpiCard icon={FileCheck}     label="待我簽核"  value={kpi.pendingCount} color={C.purple} colorDim={C.purpleDim}
                 badge={pendingUnified.some(p => p.daysOpen >= 3) ? '逾期' : null}
                 onClick={() => navigate('/process/approvals')} />
        <KpiCard icon={AlertTriangle} label="未打卡"    value={kpi.lateCount}   color={C.red}    colorDim={C.redDim} />
      </div>

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

      {/* ─── 團隊狀態 grid ─── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={16} style={{ color: C.cyan }} /> 團隊狀態
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>（{team.length} 人）</span>
          </h3>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.muted, flexWrap: 'wrap' }}>
            {Object.entries(STATUS_META).filter(([k]) => ['on','leave','sick','overtime','trip','late'].includes(k)).map(([k, m]) => (
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
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 10,
          }}>
            {teamWithStatus.map(({ emp, status }) => (
              <TeamMemberCard key={emp.id} emp={emp} status={status} />
            ))}
          </div>
        )}
      </div>
      </>}

      {tab === 'process' && <>
      {/* ─── KPI Bar (Process) ─── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12,
      }}>
        <KpiCard icon={ListChecks} label="我的待辦任務" value={processKpi.myTasks}
                 badge={processKpi.overdueTasks > 0 ? `${processKpi.overdueTasks} 逾期` : null}
                 color={C.cyan} colorDim={C.cyanDim}
                 onClick={() => navigate('/process/tasks')} />
        <KpiCard icon={WorkflowIcon} label="我發起進行中" value={processKpi.myActiveStarted}
                 color={C.blue} colorDim={C.blueDim}
                 onClick={() => navigate('/process/workflows')} />
        <KpiCard icon={Hourglass} label="流程卡關 ≥3 天" value={processKpi.overdue}
                 color={C.red} colorDim={C.redDim} />
        <KpiCard icon={FolderOpen} label="進行中專案" value={processKpi.activeProjects}
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
                    onClick={() => navigate('/process/tasks')}
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
            {activeWorkflows.slice(0, 9).map(w => {
              const today = todayStr()
              const days = w.started_at ? daysBetween(today, w.started_at.slice(0, 10)) : 0
              const tasks = wfTasksMap[w.id] || []
              return (
                <WorkflowProgressCard
                  key={w.id}
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
            {activeProjects.slice(0, 8).map(p => (
              <div key={p.id}
                onClick={() => navigate('/process/projects')}
                style={{
                  padding: 12, borderRadius: 10, border: `1px solid ${C.borderSubtle}`,
                  background: C.bg2, cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.green }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderSubtle }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{p.name}</div>
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
      `}</style>
    </div>
  )
}
