import { useState, useEffect, useCallback } from 'react'
import { ModalOverlay } from './Modal'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Bell, X, AlertTriangle, Clock, Package, Calendar, Check, FileText, Scale, ClipboardList } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// Each notification type maps to a route
const ROUTES = {
  leave: '/hr/leave',
  stock: '/wms/inventory',
  task: '/process/tasks',
  late: '/hr/attendance',
  correction: '/hr/punch-correction',
  overtime: '/hr/overtime',
  law_update_reminder: '/hr/labor-law-rates',
  form_submission: '/hr/forms/submissions',
  approval: '/process/approvals',
}

// 從 notifications 表 type 對應的 icon / 顏色
const DB_TYPE_META = {
  law_update_reminder: { icon: Scale,    color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)' },
  form_submission:     { icon: FileText, color: 'var(--accent-cyan)',   dim: 'var(--accent-cyan-dim)'   },
  default:             { icon: Bell,     color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)'   },
}

function getReadIds() {
  try { return JSON.parse(localStorage.getItem('sme_notif_read') || '[]') } catch { return [] }
}
function markAsRead(id) {
  const read = getReadIds()
  if (!read.includes(id)) {
    read.push(id)
    // Keep only last 200 entries
    localStorage.setItem('sme_notif_read', JSON.stringify(read.slice(-200)))
  }
}
function markAllAsRead(ids) {
  const read = getReadIds()
  const merged = [...new Set([...read, ...ids])]
  localStorage.setItem('sme_notif_read', JSON.stringify(merged.slice(-200)))
}

export default function NotificationCenter() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [readIds, setReadIds] = useState(getReadIds)
  const [loading, setLoading] = useState(false)

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    const items = []
    const today = new Date().toISOString().slice(0, 10)

    try {
      // 0. 從 notifications 表撈我自己的（cron / system 寄的，例如年度法令提醒）
      if (profile?.id) {
        const { data: dbNotifs } = await supabase
          .from('notifications')
          .select('*')
          .eq('recipient_emp_id', profile.id)
          .eq('read', false)
          .order('created_at', { ascending: false })
          .limit(20)
        for (const n of (dbNotifs || [])) {
          const meta = DB_TYPE_META[n.type] || DB_TYPE_META.default
          items.push({
            id: `db-${n.id}`,
            dbId: n.id,
            type: n.type,
            icon: meta.icon,
            color: meta.color,
            dim: meta.dim,
            title: n.title,
            desc: n.payload?.message || '',
            time: n.created_at?.slice(0, 10),
            actionUrl: n.payload?.action_url,
            isDbRecord: true,
          })
        }
      }

      const { data: leaves } = await supabase
        .from('leave_requests').select('*').eq('status', '待審核')
        .order('id', { ascending: false }).limit(5)
      if (leaves) {
        leaves.forEach(l => items.push({
          id: `leave-${l.id}`, type: 'leave', icon: Calendar,
          color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)',
          title: '待審假單',
          desc: `${l.employee} 申請${l.type || '假'}（${l.start_date}）`,
          time: l.start_date,
        }))
      }

      const { data: stocks } = await supabase.from('stock_levels').select('*').limit(100)
      if (stocks) {
        stocks.filter(s => (s.quantity || 0) <= (s.min_qty || 10)).forEach(s => items.push({
          id: `stock-${s.id}`, type: 'stock', icon: Package,
          color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)',
          title: '低庫存警示',
          desc: `${s.sku_code || '未知品項'} 剩餘 ${s.quantity} ${s.unit || '個'}`,
          time: '即時',
        }))
      }

      const { data: tasks } = await supabase
        .from('tasks').select('*').neq('status', '已完成')
        .lt('due_date', today).order('due_date').limit(5)
      if (tasks) {
        tasks.forEach(t => items.push({
          id: `task-${t.id}`, type: 'task', icon: AlertTriangle,
          color: 'var(--accent-red)', dim: 'var(--accent-red-dim)',
          title: '任務逾期',
          desc: `「${t.title}」已超過截止日（${t.due_date}）`,
          time: t.due_date,
        }))
      }

      const { data: lateRecords } = await supabase
        .from('attendance_records').select('*').eq('date', today).eq('status', '遲到').limit(5)
      if (lateRecords) {
        lateRecords.forEach(a => items.push({
          id: `late-${a.id}`, type: 'late', icon: Clock,
          color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)',
          title: '今日遲到',
          desc: `${a.employee} 於 ${a.clock_in} 打卡`,
          time: today,
        }))
      }

      // Workflow steps overdue (tasks 承載流程執行)
      const { data: overdueSteps } = await supabase
        .from('tasks').select('id, title, assignee, due_date')
        .not('workflow_instance_id', 'is', null)
        .in('status', ['待簽核', '進行中']).lt('due_date', today).limit(5)
      if (overdueSteps) {
        overdueSteps.forEach(s => items.push({
          id: `wfstep-${s.id}`, type: 'task', icon: AlertTriangle,
          color: 'var(--accent-red)', dim: 'var(--accent-red-dim)',
          title: '流程任務逾期',
          desc: `「${s.title}」(${s.assignee || '未指派'}) 截止 ${s.due_date}`,
          time: s.due_date,
        }))
      }

      // Pending clock corrections
      const { data: corrections } = await supabase
        .from('clock_corrections').select('id, employee, date').eq('status', '待審核').limit(5)
      if (corrections) {
        corrections.forEach(c => items.push({
          id: `correction-${c.id}`, type: 'late', icon: Clock,
          color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)',
          title: '補登待審核',
          desc: `${c.employee} 申請 ${c.date} 補登`,
          time: c.date,
        }))
      }

      // Pending overtime
      const { data: otReqs } = await supabase
        .from('overtime_requests').select('id, employee_id, date, employees(name)').eq('status', '待審核').limit(5)
      if (otReqs) {
        otReqs.forEach(o => items.push({
          id: `ot-${o.id}`, type: 'late', icon: Clock,
          color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)',
          title: '加班待審核',
          desc: `${o.employee} 申請 ${o.date} 加班`,
          time: o.date,
        }))
      }

      // Pending approval form steps assigned to this user (by name or position/role)
      if (profile?.name || profile?.position) {
        const orParts = []
        if (profile.name)     orParts.push(`approver.eq.${profile.name}`)
        if (profile.position) orParts.push(`role.eq.${profile.position}`)
        const { data: approvalSteps } = await supabase
          .from('approval_form_steps')
          .select('id, form_id, role, approver, approval_forms!form_id(id, title, applicant)')
          .eq('status', '待簽')
          .or(orParts.join(','))
          .limit(10)
        if (approvalSteps) {
          approvalSteps.forEach(s => {
            const form = s.approval_forms
            items.push({
              id: `approval-${s.id}`, type: 'approval', icon: ClipboardList,
              color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)',
              title: '待您簽核',
              desc: form?.title
                ? `${form.title}${form.applicant ? `（${form.applicant}）` : ''}`
                : `簽核表單 #${s.form_id}`,
              time: '',
            })
          })
        }
      }
    } catch (e) { /* ignore */ }

    setNotifications(items)
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 60000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  const unreadCount = notifications.filter(n => !readIds.includes(n.id)).length

  const handleClickItem = async (n) => {
    markAsRead(n.id)
    setReadIds(getReadIds())
    // DB-backed notifications: also flip read=true in DB
    if (n.isDbRecord && n.dbId) {
      supabase.from('notifications').update({ read: true }).eq('id', n.dbId).then(() => {
        setNotifications(prev => prev.filter(x => x.id !== n.id))
      })
    }
    setOpen(false)
    const route = n.actionUrl || ROUTES[n.type]
    if (route) navigate(route)
  }

  const handleMarkAllRead = () => {
    markAllAsRead(notifications.map(n => n.id))
    setReadIds(getReadIds())
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: 'relative',
          background: open ? 'var(--glass-strong)' : 'var(--glass-light)',
          border: `1px solid ${open ? 'var(--border-strong)' : 'var(--border-medium)'}`,
          color: open ? 'var(--accent-cyan)' : 'var(--text-secondary)',
          cursor: 'pointer', padding: '6px', borderRadius: 'var(--radius-sm)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, transition: 'all 0.2s ease',
        }}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            width: 16, height: 16, borderRadius: '50%',
            background: 'var(--accent-red)', color: '#fff',
            fontSize: 9, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(248,113,113,0.4)',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && createPortal(
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.3)' }}
          />
          <div style={{
            position: 'fixed', top: 8, left: 268, width: 380,
            maxHeight: 'calc(100vh - 16px)', zIndex: 10000,
            background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-lg)', backdropFilter: 'blur(20px)',
            boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bell size={16} style={{ color: 'var(--accent-cyan)' }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>通知中心</span>
                {unreadCount > 0 && (
                  <span style={{
                    padding: '2px 8px', borderRadius: 99,
                    background: 'var(--accent-red-dim)', color: 'var(--accent-red)',
                    fontSize: 11, fontWeight: 700,
                  }}>{unreadCount} 項未讀</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {unreadCount > 0 && (
                  <button onClick={handleMarkAllRead} style={{
                    background: 'none', border: 'none', color: 'var(--accent-cyan)',
                    cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 3,
                  }}>
                    <Check size={12} /> 全部已讀
                  </button>
                )}
                <button onClick={() => setOpen(false)} style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', padding: 4,
                }}>
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* List */}
            <div style={{
              flex: 1, overflowY: 'auto', padding: '4px 12px',
              scrollbarWidth: 'thin', scrollbarColor: 'var(--text-muted) transparent',
            }}>
              {loading && notifications.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>載入中...</div>
              ) : notifications.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>目前沒有通知</div>
                </div>
              ) : (
                notifications.map(n => {
                  const Icon = n.icon
                  const isRead = readIds.includes(n.id)
                  return (
                    <div
                      key={n.id}
                      onClick={() => handleClickItem(n)}
                      style={{
                        display: 'flex', gap: 12, padding: '12px 8px',
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer', borderRadius: 8,
                        opacity: isRead ? 0.5 : 1,
                        transition: 'all 0.15s',
                        background: isRead ? 'transparent' : 'var(--glass-light)',
                      }}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: n.dim, color: n.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon size={16} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: isRead ? 500 : 700,
                          color: 'var(--text-primary)', marginBottom: 2,
                        }}>
                          {n.title}
                          {!isRead && <span style={{
                            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                            background: n.color, marginLeft: 6, verticalAlign: 'middle',
                          }} />}
                        </div>
                        <div style={{
                          fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{n.desc}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{n.time}</div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
