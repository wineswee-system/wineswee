import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { usePendingApprovals } from '../../../lib/usePendingApprovals'
import LoadingSpinner from '../../../components/LoadingSpinner'
import {
  Users, Wallet, Calendar, ClipboardCheck,
  ChevronRight, CheckCircle2,
} from 'lucide-react'

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
      { key: 'leave',        label: '請假', table: 'leave_requests',     route: '/hr/leave',           pendingStatus: '待審核' },
      { key: 'overtime',     label: '加班', table: 'overtime_requests',  route: '/hr/overtime',        pendingStatus: '待審核' },
      { key: 'trip',         label: '出差', table: 'business_trips',     route: '/hr/business-travel', pendingStatus: '待審核' },
      { key: 'correction',   label: '補打卡', table: 'clock_corrections', route: '/hr/punch-correction', pendingStatus: '待審核' },
      { key: 'expense',      label: '報帳', table: 'expenses',           route: '/hr/expenses',        pendingStatus: '待審核' },
    ],
  },
  {
    key: 'finance', label: '經費', icon: Wallet, color: 'var(--accent-green)',
    tabs: [
      { key: 'expense_request', label: '申請', table: 'expense_requests', route: '/finance/expense-requests', pendingStatus: '申請中' },
      { key: 'expense_settle',  label: '核銷', table: 'expense_requests', route: '/finance/expense-requests', pendingStatus: '待核銷' },
    ],
  },
  {
    key: 'people', label: '人事異動', icon: Calendar, color: 'var(--accent-purple)',
    tabs: [
      { key: 'resignation', label: '離職', table: 'resignation_requests',         route: '/hr/resignation',  pendingStatus: '申請中' },
      { key: 'transfer',    label: '異動', table: 'personnel_transfer_requests',  route: '/hr/transfer-request', pendingStatus: '申請中' },
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
  resignation: 'resignation_requests',
  transfer: 'personnel_transfer_requests',
}

export default function ApprovalCenter() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { canApprove } = usePendingApprovals()
  const [activeGroup, setActiveGroup] = useState('hr')
  const [activeTab, setActiveTab] = useState('leave')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)

  const reload = async () => {
    if (!profile?.organization_id) return
    setLoading(true)
    const allTabs = GROUPS.flatMap(g => g.tabs)
    const results = await Promise.all(
      allTabs.map(t =>
        supabase.from(t.table)
          .select('*')
          .eq('status', t.pendingStatus)
          .eq('organization_id', profile.organization_id)
          .order('created_at', { ascending: false })
      )
    )
    const map = {}
    allTabs.forEach((t, i) => {
      const rows = results[i].data || []
      // 過濾出當前使用者可簽的單（用 tab.key → perm key 映射；核銷會走 expense_settles）
      const permKey = PERM_KEY_MAP[t.key] || t.table
      map[t.key] = rows.filter(r => canApprove(permKey, r.id))
    })
    setData(map)
    setLoading(false)
  }

  useEffect(() => { reload() }, [profile?.organization_id])

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
    // 跳到對應 HR 頁面，帶 ?focus={id} 自動開該 row 的 detail modal
    navigate(`${tabDef.route}?focus=${row.id}`)
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
              flex: 1, padding: '14px 8px',
              background: isActive ? 'var(--bg-card)' : 'transparent',
              border: 'none', cursor: 'pointer',
              borderBottom: isActive ? `3px solid ${g.color}` : '3px solid transparent',
              color: isActive ? g.color : 'var(--text-muted)',
              fontSize: 14, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'all .15s',
            }}>
              <Icon size={16} /> {g.label}
              {count > 0 && (
                <span style={{
                  background: g.color, color: '#fff',
                  fontSize: 11, fontWeight: 700,
                  padding: '2px 7px', borderRadius: 10, minWidth: 22, textAlign: 'center',
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
        title: `${row.employee} · 核銷 ${row.title || ''}`,
        subtitle: `實際 NT$ ${Number(row.actual_amount || row.estimated_amount || 0).toLocaleString()}`,
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
