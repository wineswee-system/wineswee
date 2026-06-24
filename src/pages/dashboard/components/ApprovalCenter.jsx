import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { usePendingApprovals } from '../../../lib/usePendingApprovals'
import LoadingSpinner from '../../../components/LoadingSpinner'
import {
  Users, Wallet, Calendar, ClipboardCheck, CalendarOff,
  ChevronRight, CheckCircle2, Inbox, FileCheck, FileText,
} from 'lucide-react'

// 已簽核 type → 路由 (對齊 GROUPS 的 route)，給 SignedView row 跳轉用
const SIGNED_TYPE_ROUTE = {
  leave: '/hr/leave', overtime: '/hr/overtime', trip: '/hr/travel',
  correction: '/hr/punch-correction', expense: '/hr/expenses',
  expense_request: '/hr/expense-requests',
  resignation: '/hr/forms/resignation', loa: '/hr/forms/loa',
  transfer: '/hr/forms/transfer', headcount: '/hr/forms/headcount',
  form_submission: '/hr/forms/submissions',
  off_request: '/hr/off-requests',
  shift_swap: '/hr/shift-swaps',
  task_confirmation: '/process/task-confirmations',
  expense_settle: '/hr/expense-requests',
  workflow: '/process/workflows',
}
const SIGNED_TYPE_LABEL = {
  leave: '請假', overtime: '加班', trip: '出差', correction: '補打卡',
  expense: '報帳', expense_request: '非經常性費用申請',
  resignation: '離職', loa: '留停', transfer: '異動', headcount: '人力需求',
  form_submission: '表單申請',
  off_request: '希望休', shift_swap: '換班',
  task_confirmation: '任務確認', expense_settle: '費用核銷(驗收)',
  workflow: '流程簽核',
}

/**
 * 簽核中心面板 — 一進儀表板看到所有跨類型的待簽
 *
 * 4 大群組（人事 / 經費 / 排班 / 任務）× 子 tab。
 * 點 row → 跳到對應 HR 頁面，自動 focus 該 row 開 detail modal。
 *
 * 對齊 LIFF Approve.jsx 結構，但 row 互動改成「導頁」而非 inline 操作
 * （因 Web HR 頁已有更完整的 ApprovalDetailModal + ApprovalActionBar）。
 */

const GROUPS = [
  {
    key: 'hr', label: '人事', icon: Users, color: 'var(--accent-cyan)',
    tabs: [
      { key: 'leave',        label: '請假',   table: 'leave_requests',     route: '/hr/leave',             pendingStatus: '待審核' },
      { key: 'overtime',     label: '加班',   table: 'overtime_requests',  route: '/hr/overtime',          pendingStatus: '待審核' },
      { key: 'trip',         label: '出差',   table: 'business_trips',     route: '/hr/travel',            pendingStatus: '待審核' },
      { key: 'correction',   label: '補打卡', table: 'clock_corrections',  route: '/hr/punch-correction',  pendingStatus: '待審核' },
      { key: 'expense',      label: '報帳',   table: 'expenses',           route: '/hr/expenses',          pendingStatus: '待審核' },
    ],
  },
  {
    key: 'finance', label: '經費', icon: Wallet, color: 'var(--accent-green)',
    tabs: [
      { key: 'expense_request', label: '申請', table: 'expense_requests', route: '/hr/expense-requests', pendingStatus: '申請中' },
      { key: 'expense_settle',  label: '核銷(驗收)', table: 'expense_requests', route: '/hr/expense-requests', pendingStatus: '待核銷' },
    ],
  },
  {
    key: 'people', label: '人事異動', icon: Calendar, color: 'var(--accent-purple)',
    tabs: [
      { key: 'resignation',   label: '離職',     table: 'resignation_requests',         route: '/hr/forms/resignation', pendingStatus: '申請中' },
      { key: 'loa',           label: '留停',     table: 'leave_of_absence_requests',    route: '/hr/forms/loa',         pendingStatus: '申請中' },
      { key: 'transfer',      label: '異動',     table: 'personnel_transfer_requests',  route: '/hr/forms/transfer',    pendingStatus: '申請中' },
      { key: 'hire_approval', label: '錄取',     table: 'offer_letters',                route: '/hr/recruitment',       pendingStatus: '待審' },
      { key: 'headcount',     label: '人力需求', table: 'headcount_requests',           route: '/hr/forms/headcount',   pendingStatus: '申請中' },
    ],
  },
  {
    key: 'schedule', label: '排班', icon: CalendarOff, color: 'var(--accent-orange)',
    tabs: [
      { key: 'off_request',        label: '希望休',     table: 'off_requests', route: '/hr/off-requests', pendingStatus: '待審核' },
      { key: 'shift_swap_peer',    label: '換班-我同意', table: 'shift_swaps',  route: '/hr/shift-swaps',  pendingStatus: '待對方同意' },
      { key: 'shift_swap_manager', label: '換班-我核准', table: 'shift_swaps',  route: '/hr/shift-swaps',  pendingStatus: '待主管核准' },
    ],
  },
  {
    key: 'task', label: '任務', icon: ClipboardCheck, color: 'var(--accent-cyan)',
    tabs: [
      { key: 'task_confirmation', label: '任務確認', table: 'task_confirmations', route: '/process/task-confirmations', pendingStatus: 'pending' },
    ],
  },
  {
    key: 'form', label: '自訂表單', icon: FileText, color: 'var(--accent-blue)',
    tabs: [
      { key: 'form_submission',         label: '表單申請', table: 'form_submissions',        route: '/hr/forms/submissions',   pendingStatus: '申請中' },
      { key: 'goods_transfer_apply',    label: '調撥-申請', table: 'goods_transfer_requests', route: '/process/transfer-requests', pendingStatus: '申請審核中' },
      { key: 'goods_transfer_receipt',  label: '調撥-驗收', table: 'goods_transfer_requests', route: '/process/transfer-requests', pendingStatus: '驗收審核中' },
    ],
  },
]

// tab.key → usePendingApprovals 的 key（核銷走 expense_settles 而非 expense_requests）
const PERM_KEY_MAP = {
  leave: 'leave_requests',
  overtime: 'overtime_requests',
  trip: 'business_trips',
  correction: 'clock_corrections',
  expense: 'expenses',
  expense_request: 'expense_requests',
  expense_settle: 'expense_settles',
  resignation:   'resignation_requests',
  loa:           'leave_of_absence_requests',
  transfer:      'personnel_transfer_requests',
  hire_approval: 'offer_letters',
  headcount:     'headcount_requests',
  form_submission: 'form_submissions',
  // 排班 / 任務（2026-06-06 migration 20260606060000 補進 RPC）
  off_request: 'off_requests',
  shift_swap_peer: 'shift_swaps',
  shift_swap_manager: 'shift_swaps',
  task_confirmation: 'task_confirmations',
  // 商品調撥（snapshot-aware，RPC 已支援）
  goods_transfer_apply:   'goods_transfer_apply_requests',
  goods_transfer_receipt: 'goods_transfer_receipt_requests',
}

// ── 待簽核 view (原 ApprovalCenter 內容 1:1 不動) ────────────────────────
function PendingApprovalsView() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { pendingByTable, loading: pendingLoading } = usePendingApprovals()
  const [activeGroup, setActiveGroup] = useState('hr')
  const [activeTab, setActiveTab] = useState('leave')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)

  const reload = async () => {
    if (!profile?.organization_id) return
    setLoading(true)
    const allTabs = GROUPS.flatMap(g => g.tabs)
    // RPC 已經幫我們算好「我這關該簽的 id 集合」(pendingByTable)，
    // 直接用 .in('id', ids) 撈 row，不再 .eq('status') 全表掃，
    // 避免細粒度 RLS 把 row 擋掉造成 badge 對得上但內容空。
    const results = await Promise.all(
      allTabs.map(t => {
        const permKey = PERM_KEY_MAP[t.key] || t.table
        const ids = pendingByTable[permKey] || []
        if (ids.length === 0) return Promise.resolve({ data: [] })
        return supabase.from(t.table)
          .select('*')
          .in('id', ids)
          .order('created_at', { ascending: false })
      })
    )
    const map = {}
    allTabs.forEach((t, i) => {
      let rows = results[i].data || []
      // shift_swap_peer / shift_swap_manager 共用 'shift_swaps' permKey，
      // 撈回後依當前 sub-tab 的 pendingStatus 再 filter
      if (t.key === 'shift_swap_peer' || t.key === 'shift_swap_manager') {
        rows = rows.filter(r => r.status === t.pendingStatus)
      }
      map[t.key] = rows
    })
    setData(map)
    setLoading(false)
  }

  useEffect(() => {
    if (pendingLoading) return
    reload()
  }, [profile?.organization_id, pendingLoading, pendingByTable]) // eslint-disable-line react-hooks/exhaustive-deps

  // 計算各 tab / group 的 count
  const tabCounts = {}
  for (const g of GROUPS) {
    for (const t of g.tabs) {
      tabCounts[t.key] = (data[t.key] || []).length
    }
  }
  const groupCounts = {}
  for (const g of GROUPS) {
    groupCounts[g.key] = g.tabs.reduce((s, t) => s + (tabCounts[t.key] || 0), 0)
  }
  const totalCount = Object.values(groupCounts).reduce((s, c) => s + c, 0)

  // 自動切到有資料的 group
  useEffect(() => {
    if (loading || totalCount === 0) return
    if (groupCounts[activeGroup] === 0) {
      const target = GROUPS.find(g => groupCounts[g.key] > 0)
      if (target) {
        setActiveGroup(target.key)
        setActiveTab(target.tabs[0].key)
      }
    }
  }, [loading, totalCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // group 切換時把 tab 設為該 group 第一個
  const changeGroup = (key) => {
    setActiveGroup(key)
    const firstTab = GROUPS.find(g => g.key === key)?.tabs[0]
    if (firstTab) setActiveTab(firstTab.key)
  }

  const activeGroupDef = GROUPS.find(g => g.key === activeGroup)
  const activeTabDef = activeGroupDef?.tabs.find(t => t.key === activeTab)
  const rows = data[activeTab] || []

  const handleRowClick = (row, tabDef) => {
    // 跳到對應 HR 頁面，帶 ?focus={id} 自動開 detail modal；審核完後 returnTo=/ 回儀表板
    navigate(`${tabDef.route}?focus=${row.id}&returnTo=/`)
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <LoadingSpinner />
      </div>
    )
  }

  if (totalCount === 0) {
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
        borderRadius: 12, padding: '60px 24px', textAlign: 'center',
      }}>
        <CheckCircle2 size={48} style={{ color: 'var(--accent-green)', marginBottom: 12 }} />
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
          🎉 太好了，你沒有待簽核的單
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
          所有跨類型的待簽都會出現在這裡
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Group tabs（橫排）*/}
      <div style={{
        display: 'flex', gap: 0,
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)',
      }}>
        {GROUPS.map(g => {
          const Icon = g.icon
          const count = groupCounts[g.key]
          const isActive = g.key === activeGroup
          return (
            <button key={g.key} onClick={() => changeGroup(g.key)} style={{
              flex: 1, padding: '12px 8px',
              background: isActive ? 'var(--bg-card)' : 'transparent',
              border: 'none', cursor: 'pointer',
              borderBottom: isActive ? `3px solid ${g.color}` : '3px solid transparent',
              color: isActive ? g.color : 'var(--text-muted)',
              fontSize: 13, fontWeight: 700,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
              position: 'relative',
              transition: 'all .15s',
            }}>
              <Icon size={20} />
              <span>{g.label}</span>
              {count > 0 && (
                <span style={{
                  position: 'absolute', top: 6, right: 8,
                  background: g.color, color: '#fff',
                  fontSize: 10, fontWeight: 700,
                  padding: '1px 6px', borderRadius: 10, minWidth: 18, textAlign: 'center',
                }}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Sub-tabs */}
      {activeGroupDef && activeGroupDef.tabs.length > 1 && (
        <div style={{
          display: 'flex', gap: 4, padding: '8px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          overflowX: 'auto',
        }}>
          {activeGroupDef.tabs.map(t => {
            const isActive = t.key === activeTab
            const cnt = tabCounts[t.key]
            return (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                padding: '6px 12px', borderRadius: 16,
                background: isActive ? activeGroupDef.color : 'transparent',
                color: isActive ? '#fff' : 'var(--text-muted)',
                border: '1px solid ' + (isActive ? activeGroupDef.color : 'var(--border-subtle)'),
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                whiteSpace: 'nowrap',
              }}>
                {t.label}
                {cnt > 0 && (
                  <span style={{
                    background: isActive ? 'rgba(255,255,255,0.25)' : activeGroupDef.color,
                    color: '#fff',
                    fontSize: 10, fontWeight: 700,
                    padding: '1px 6px', borderRadius: 8,
                  }}>{cnt}</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Row list */}
      <div style={{ padding: 16 }}>
        {rows.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            此類別目前沒有待簽核
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map(row => (
              <ApprovalRow
                key={`${activeTab}-${row.id}`}
                row={row} tabDef={activeTabDef}
                groupColor={activeGroupDef.color}
                onClick={() => handleRowClick(row, activeTabDef)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// 各表的 title / subtitle 萃取
function getRowDisplay(row, tabKey) {
  switch (tabKey) {
    case 'leave':
      return {
        title: `${row.employee} · ${row.type || '請假'}`,
        subtitle: `${row.start_date || ''} ~ ${row.end_date || row.start_date || ''}`,
      }
    case 'overtime':
      return {
        title: `${row.employee} · 加班 ${row.hours || 0}h`,
        subtitle: row.date,
      }
    case 'trip':
      return {
        title: `${row.employee} · ${row.destination || '出差'}`,
        subtitle: `${row.start_date || ''} ~ ${row.end_date || ''}`,
      }
    case 'correction':
      return {
        title: `${row.employee} · ${row.type || '補打卡'}`,
        subtitle: `${row.date || ''} ${row.correction_time || ''}`,
      }
    case 'expense':
      return {
        title: `${row.employee} · ${row.title || '費用報帳'}`,
        subtitle: `NT$ ${Number(row.amount || 0).toLocaleString()}`,
      }
    case 'expense_request':
      return {
        title: `${row.employee} · ${row.title || '費用申請'}`,
        subtitle: `NT$ ${Number(row.estimated_amount || 0).toLocaleString()}`,
      }
    case 'expense_settle':
      return {
        title: `${row.employee} · 核銷(驗收) ${row.title || ''}`,
        subtitle: `實際 NT$ ${Number(row.actual_amount || row.estimated_amount || 0).toLocaleString()}`,
      }
    case 'loa':
      return {
        title: `${row.employee?.name || '—'} · 留職停薪`,
        subtitle: `${row.start_date || ''} ~ ${row.planned_end_date || ''}（${row.reason_type || '—'}）`,
      }
    case 'off_request':
      return {
        title: `${row.employee || '—'} · 希望休`,
        subtitle: row.date || '—',
      }
    case 'shift_swap_peer':
    case 'shift_swap_manager':
      return {
        title: `換班申請 #${row.id}`,
        subtitle: `${row.source_date || ''} ↔ ${row.target_date || ''}`,
      }
    case 'task_confirmation':
      return {
        title: row.task_title || `任務 #${row.task_id || row.id}`,
        subtitle: `第 ${(row.step_order ?? 0) + 1} 關`,
      }
    case 'resignation':
      return {
        title: `${row.employee?.name || '—'} · 離職申請`,
        subtitle: `預計 ${row.planned_resign_date || '—'}`,
      }
    case 'transfer':
      return {
        title: `${row.employee?.name || '—'} · ${row.transfer_type || '人事異動'}`,
        subtitle: `生效 ${row.effective_date || '—'}`,
      }
    case 'headcount':
      return {
        title: `${row.job_title || '人力需求'} × ${row.headcount || 0} 人`,
        subtitle: row.form_no || `#${row.id}`,
      }
    case 'form_submission':
      return {
        title: row.template?.name || row.template_name || `自訂表單 #${row.id}`,
        subtitle: `申請人：${row.applicant?.name || row.applicant_name || '—'}`,
      }
    default:
      return { title: `#${row.id}`, subtitle: '' }
  }
}

function ApprovalRow({ row, tabDef, groupColor, onClick }) {
  const display = getRowDisplay(row, tabDef.key)
  const daysOpen = row.created_at
    ? Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86400000)
    : 0
  const isOverdue = daysOpen >= 3

  return (
    <div onClick={onClick} style={{
      padding: 12, borderRadius: 10,
      border: '1px solid var(--border-subtle)',
      background: 'var(--bg-secondary)',
      cursor: 'pointer',
      transition: 'border-color .12s, background .12s',
      display: 'flex', alignItems: 'center', gap: 12,
    }}
    onMouseEnter={(e) => { e.currentTarget.style.borderColor = groupColor }}
    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)' }}>
      <span style={{
        fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
        background: groupColor, color: '#fff', flexShrink: 0,
      }}>{tabDef.label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {display.title}
        </div>
        {display.subtitle && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {display.subtitle}
          </div>
        )}
      </div>
      {isOverdue && (
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-red)' }}>
          🚨 {daysOpen} 天
        </span>
      )}
      <ChevronRight size={16} color="var(--text-muted)" />
    </div>
  )
}


// ════════════════════════════════════════════════════════════════════════════
// 已簽核 view — 從 web_list_my_signed_approvals RPC 拉
// ════════════════════════════════════════════════════════════════════════════
function SignedApprovalsView() {
  const navigate = useNavigate()
  const today = new Date()
  const [yearMonth, setYearMonth] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase.rpc('web_list_my_signed_approvals', { p_year_month: yearMonth })
      .then(({ data }) => {
        if (data?.error) { console.warn('web_list_my_signed_approvals:', data.error); setList([]) }
        else setList(Array.isArray(data) ? data : [])
        setLoading(false)
      })
  }, [yearMonth])

  const handleRowClick = (row) => {
    const route = SIGNED_TYPE_ROUTE[row.source_type]
    if (route) navigate(`${route}?focus=${row.source_id}`)
  }

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 12, padding: 16 }}>
      {/* 月份切換 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{yearMonth} 我已簽核 · {list.length} 件</div>
        <input className="form-input" type="month" value={yearMonth}
          onChange={e => setYearMonth(e.target.value)}
          style={{ width: 160 }} />
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><LoadingSpinner /></div>
      ) : list.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          這個月你還沒簽核過任何單
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((row, i) => {
            const actionLabel = row.my_action === 'approved' ? '✓ 核准' : '✗ 退回'
            const actionColor = row.my_action === 'approved' ? 'var(--accent-green)' : 'var(--accent-red)'
            const typeLabel = SIGNED_TYPE_LABEL[row.source_type] || row.source_type
            return (
              <div key={`${row.source_type}-${row.source_id}-${i}`} onClick={() => handleRowClick(row)} style={{
                padding: 12, borderRadius: 10,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-secondary)',
                cursor: SIGNED_TYPE_ROUTE[row.source_type] ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                  background: row.is_extra ? 'var(--accent-orange)' : 'var(--accent-purple)',
                  color: '#fff', flexShrink: 0,
                }}>{row.is_extra ? '🪶 加簽' : typeLabel}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {row.applicant_name || '—'} · {row.summary || `#${row.source_id}`}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {row.step_label || '—'} · {row.signed_at ? new Date(row.signed_at).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                    · 整單狀態 {row.current_status || '—'}
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: actionColor }}>{actionLabel}</span>
                {SIGNED_TYPE_ROUTE[row.source_type] && <ChevronRight size={16} color="var(--text-muted)" />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


// ════════════════════════════════════════════════════════════════════════════
// Outer wrapper — 切換「待簽核 / 已簽核」最外層 tab
// ════════════════════════════════════════════════════════════════════════════
export default function ApprovalCenter() {
  const [outerTab, setOuterTab] = useState('pending')

  return (
    <div>
      {/* 外層 tab bar */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 12,
        borderBottom: '2px solid var(--border-subtle)',
      }}>
        {[
          { key: 'pending', label: '待簽核', icon: Inbox },
          { key: 'signed',  label: '已簽核', icon: FileCheck },
        ].map(t => {
          const Icon = t.icon
          const isActive = outerTab === t.key
          return (
            <button key={t.key} onClick={() => setOuterTab(t.key)} style={{
              padding: '10px 20px', border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 14, fontWeight: 700,
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
              borderBottom: isActive ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              marginBottom: -2,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <Icon size={16} />
              {t.label}
            </button>
          )
        })}
      </div>

      {outerTab === 'pending' ? <PendingApprovalsView /> : <SignedApprovalsView />}
    </div>
  )
}
