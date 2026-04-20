import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import {
  Clock, CalendarDays, CalendarOff, Timer, RefreshCw, Wallet, CalendarHeart,
  Workflow, LogIn, LogOut, Bell, Megaphone, Users, Zap, Receipt, Plane,
  ArrowLeftRight, Plus, ChevronLeft, ChevronRight, BarChart3, Fingerprint,
  MapPin, Download, User, Phone, Mail, Lock, Heart, Landmark, Info, Send,
  CheckCircle2, AlertCircle, X
} from 'lucide-react'

// ── Helpers ──
const fmt = n => (n || 0).toLocaleString()
const statusBadge = (s) => {
  const map = {
    '待審核': 'bg-amber-50 text-amber-700', '已核准': 'bg-green-50 text-green-700',
    '已駁回': 'bg-red-50 text-red-700', '進行中': 'bg-blue-50 text-blue-700',
    '已完成': 'bg-green-50 text-green-700', '未開始': 'bg-gray-100 text-gray-500',
    pending: 'bg-amber-50 text-amber-700', approved: 'bg-green-50 text-green-700',
    rejected: 'bg-red-50 text-red-700',
  }
  const label = { pending: '待審核', approved: '已核准', rejected: '已駁回' }
  const cls = map[s] || 'bg-gray-100 text-gray-500'
  return <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 }} className={cls}>{label[s] || s}</span>
}

export default function EmployeePortal() {
  const { user, profile } = useAuth()
  const [emp, setEmp] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('home')

  // Data
  const [schedules, setSchedules] = useState([])
  const [leaveBalances, setLeaveBalances] = useState([])
  const [leaveHistory, setLeaveHistory] = useState([])
  const [otHistory, setOtHistory] = useState([])
  const [attendance, setAttendance] = useState([])
  const [tasks, setTasks] = useState([])
  const [announcements] = useState([
    { tag: '排班', title: '4月份排班表已發佈', date: '2026-04-18', pinned: true },
    { tag: '人事', title: '五一勞動節放假公告', date: '2026-04-15' },
    { tag: '福利', title: '員工健康檢查通知', date: '2026-04-10' },
    { tag: '訓練', title: '新品上市教育訓練報名', date: '2026-04-08' },
  ])

  // Clock
  const [clockedIn, setClockedIn] = useState(false)
  const [clockTime, setClockTime] = useState('')
  const [clockDate, setClockDate] = useState('')
  const clockRef = useRef(null)

  useEffect(() => {
    loadEmployee()
    const tick = () => {
      const now = new Date()
      setClockTime(now.toLocaleTimeString('zh-TW', { hour12: false }))
      setClockDate(now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }))
    }
    tick()
    clockRef.current = setInterval(tick, 1000)
    return () => clearInterval(clockRef.current)
  }, [])

  const loadEmployee = async () => {
    setLoading(true)
    try {
      // Get current employee via view
      const email = user?.email || profile?.email
      let empData = null

      if (email) {
        const { data } = await supabase.from('v_employees_current').select('*').eq('email', email).maybeSingle()
        empData = data
      }
      if (!empData && profile?.id) {
        const { data } = await supabase.from('v_employees_current').select('*').eq('id', profile.id).maybeSingle()
        empData = data
      }
      if (!empData) {
        // Fallback: get first super_admin
        const { data } = await supabase.from('v_employees_current').select('*').eq('role', 'super_admin').limit(1).maybeSingle()
        empData = data
      }

      if (empData) {
        setEmp(empData)
        await loadData(empData.id, empData.name)
      }
    } catch (e) {
      console.error('Failed to load employee:', e)
    } finally {
      setLoading(false)
    }
  }

  const loadData = async (empId, empName) => {
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`

    const [sched, lb, lh, ot, att, tsk] = await Promise.all([
      supabase.from('schedules').select('*').eq('employee_id', empId).gte('date', monthStart).lte('date', monthEnd).order('date'),
      supabase.from('leave_balances').select('*').eq('employee_id', empId),
      supabase.from('leave_requests').select('*').or(`employee_id.eq.${empId},employee.eq.${empName}`).order('id', { ascending: false }).limit(10),
      supabase.from('overtime_requests').select('*').or(`employee_id.eq.${empId},employee.eq.${empName}`).order('id', { ascending: false }).limit(10),
      supabase.from('attendance_records').select('*').or(`employee_id.eq.${empId},employee.eq.${empName}`).gte('date', monthStart).order('date'),
      supabase.from('v_tasks_expanded').select('*').eq('assignee_id', empId).order('created_at', { ascending: false }).limit(10),
    ])

    setSchedules(sched.data || [])
    setLeaveBalances(lb.data || [])
    setLeaveHistory(lh.data || [])
    setOtHistory(ot.data || [])
    setAttendance(att.data || [])
    setTasks(tsk.data || [])

    // Check if clocked in today
    const today = now.toISOString().slice(0, 10)
    const todayAtt = (att.data || []).find(a => a.date === today)
    if (todayAtt?.clock_in && !todayAtt?.clock_out) setClockedIn(true)
  }

  const handleClockIn = async () => {
    if (!emp) return
    try {
      const { data, error } = await supabase.functions.invoke('clock-in', {
        body: { employee_id: emp.id, action: 'clock_in' }
      })
      if (error) throw error
      setClockedIn(true)
      alert('上班打卡成功！')
      loadData(emp.id, emp.name)
    } catch (e) {
      alert('打卡失敗：' + (e.message || '未知錯誤'))
    }
  }

  const handleClockOut = async () => {
    if (!emp) return
    try {
      const { data, error } = await supabase.functions.invoke('clock-in', {
        body: { employee_id: emp.id, action: 'clock_out' }
      })
      if (error) throw error
      setClockedIn(false)
      alert('下班打卡成功！')
      loadData(emp.id, emp.name)
    } catch (e) {
      alert('打卡失敗：' + (e.message || '未知錯誤'))
    }
  }

  if (loading) return <div style={{ padding: 48, textAlign: 'center' }}>載入中...</div>
  if (!emp) return <div style={{ padding: 48, textAlign: 'center', color: '#ef4444' }}>找不到員工資料</div>

  const C = { card: { background: '#fff', borderRadius: 16, padding: 22, boxShadow: '0 1px 3px rgba(0,0,0,.06)', border: '1px solid #e8e8e3', marginBottom: 16 } }
  const today = new Date().toISOString().slice(0, 10)
  const todaySchedule = schedules.find(s => s.date === today)
  const todayAtt = attendance.find(a => a.date === today)
  const workDays = attendance.filter(a => a.clock_in).length
  const totalHours = attendance.reduce((s, a) => s + (a.total_hours || a.hours || 0), 0)
  const pendingFlows = [...leaveHistory.filter(l => l.status === '待審核'), ...otHistory.filter(o => o.status === '待審核')]

  // ── Sidebar tabs ──
  const tabs = [
    { key: 'home', icon: <Zap size={18} />, label: '首頁' },
    { key: 'clock', icon: <Clock size={18} />, label: '打卡' },
    { key: 'schedule', icon: <CalendarDays size={18} />, label: '班表' },
    { key: 'attendance', icon: <BarChart3 size={18} />, label: '出勤紀錄' },
    { key: 'leave', icon: <CalendarOff size={18} />, label: '請假' },
    { key: 'overtime', icon: <Timer size={18} />, label: '加班' },
    { key: 'salary', icon: <Wallet size={18} />, label: '薪資單' },
    { key: 'flows', icon: <Workflow size={18} />, label: '流程中心' },
    { key: 'profile', icon: <User size={18} />, label: '個人資料' },
  ]

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f6f7f5' }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: '#fff', borderRight: '1px solid #e8e8e3', padding: '16px 12px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px', background: '#f6f7f5', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent-cyan, #22d3ee)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>{emp.name?.[0]}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.name}</div>
            <div style={{ fontSize: 11, color: '#8a8c83' }}>{emp.dept || emp.current_department_name} · {emp.position}</div>
          </div>
        </div>

        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8,
            border: 'none', background: tab === t.key ? 'rgba(34,211,238,0.1)' : 'transparent',
            color: tab === t.key ? '#0ea5e9' : '#55574f', fontWeight: tab === t.key ? 600 : 500,
            fontSize: 14, cursor: 'pointer', marginBottom: 2, width: '100%', textAlign: 'left',
          }}>
            {t.icon} {t.label}
            {t.key === 'flows' && pendingFlows.length > 0 && (
              <span style={{ marginLeft: 'auto', background: '#ef4444', color: '#fff', fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>{pendingFlows.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
        {tab === 'home' && (
          <div>
            {/* Hero */}
            <div style={{ ...C.card, padding: '28px 28px 24px', background: 'linear-gradient(135deg, #fff 0%, #f0fdf4 100%)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, color: '#8a8c83' }}>{new Date().getHours() < 12 ? '早安' : new Date().getHours() < 18 ? '午安' : '晚安'}</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{emp.name}</div>
                  <div style={{ fontSize: 14, color: '#55574f', marginTop: 4 }}>{emp.dept} · {emp.position} · {emp.employee_number}</div>
                  <div style={{ display: 'flex', gap: 28, marginTop: 16, flexWrap: 'wrap' }}>
                    <div><div style={{ fontSize: 11, color: '#8a8c83', textTransform: 'uppercase', letterSpacing: 1 }}>本月出勤</div><div style={{ fontSize: 20, fontWeight: 700 }}>{workDays}<span style={{ fontSize: 13, color: '#8a8c83', marginLeft: 2 }}>天</span></div></div>
                    <div><div style={{ fontSize: 11, color: '#8a8c83', textTransform: 'uppercase', letterSpacing: 1 }}>累計工時</div><div style={{ fontSize: 20, fontWeight: 700 }}>{totalHours.toFixed(1)}<span style={{ fontSize: 13, color: '#8a8c83', marginLeft: 2 }}>小時</span></div></div>
                    <div><div style={{ fontSize: 11, color: '#8a8c83', textTransform: 'uppercase', letterSpacing: 1 }}>待審核</div><div style={{ fontSize: 20, fontWeight: 700 }}>{pendingFlows.length}<span style={{ fontSize: 13, color: '#8a8c83', marginLeft: 2 }}>筆</span></div></div>
                    <div><div style={{ fontSize: 11, color: '#8a8c83', textTransform: 'uppercase', letterSpacing: 1 }}>今日班次</div><div style={{ fontSize: 20, fontWeight: 700 }}>{todaySchedule?.shift || '休'}</div></div>
                  </div>
                </div>
                <div style={{ background: '#f6f7f5', border: '1px solid #e8e8e3', borderRadius: 12, padding: '18px 22px', minWidth: 240, textAlign: 'center' }}>
                  <div style={{ fontSize: 36, fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: -1, fontFamily: 'monospace' }}>{clockTime}</div>
                  <div style={{ fontSize: 12, color: '#8a8c83', marginTop: 4 }}>{clockDate}</div>
                  <div style={{ marginTop: 14 }}>
                    {clockedIn ? (
                      <button onClick={handleClockOut} style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                        下班打卡
                      </button>
                    ) : (
                      <button onClick={handleClockIn} style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                        上班打卡
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#8a8c83', marginTop: 8 }}>
                    {clockedIn ? `✅ 已上班 · ${todayAtt?.clock_in || ''}` : '⚪ 尚未打卡'}
                  </div>
                </div>
              </div>
            </div>

            {/* Quick actions */}
            <div style={C.card}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8c83', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>⚡ 快速操作</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                {[
                  { icon: <Fingerprint size={20} />, label: '打卡', tab: 'clock' },
                  { icon: <CalendarOff size={20} />, label: '請假', tab: 'leave' },
                  { icon: <Timer size={20} />, label: '加班', tab: 'overtime' },
                  { icon: <RefreshCw size={20} />, label: '補打卡', tab: 'attendance' },
                  { icon: <Wallet size={20} />, label: '薪資單', tab: 'salary' },
                  { icon: <CalendarHeart size={20} />, label: '排休', tab: 'schedule' },
                ].map(a => (
                  <button key={a.label} onClick={() => setTab(a.tab)} style={{
                    padding: '14px 8px', borderRadius: 10, border: '1px solid #e8e8e3', background: '#fff',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    cursor: 'pointer', fontSize: 12, fontWeight: 500, color: '#55574f',
                  }}>{a.icon} {a.label}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
              <div>
                {/* Flow center */}
                <div style={C.card}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8c83', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>📋 流程中心</div>
                  {pendingFlows.length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', color: '#8a8c83', fontSize: 13 }}>🎉 目前沒有待審核的流程</div>
                  ) : pendingFlows.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #e8e8e3' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{f.leave_type || f.type || '加班'} 申請</div>
                        <div style={{ fontSize: 12, color: '#8a8c83' }}>{f.start_date || f.date} · {f.days ? f.days + '天' : f.hours + '小時'}</div>
                      </div>
                      {statusBadge(f.status)}
                    </div>
                  ))}
                </div>

                {/* Tasks */}
                {tasks.length > 0 && (
                  <div style={C.card}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8c83', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>✅ 我的任務</div>
                    {tasks.slice(0, 5).map(t => (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #f0f0ec' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{t.title}</div>
                          <div style={{ fontSize: 11, color: '#8a8c83' }}>到期：{t.due_date || '未設定'}</div>
                        </div>
                        {statusBadge(t.status)}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                {/* Announcements */}
                <div style={C.card}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8c83', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>📢 公告</div>
                  {announcements.map((a, i) => (
                    <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid #f0f0ec', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        {a.pinned && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#fee2e2', color: '#ef4444', fontWeight: 600 }}>置頂</span>}
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#e0f2fe', color: '#0284c7', fontWeight: 600 }}>{a.tag}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{a.title}</div>
                      <div style={{ fontSize: 11, color: '#8a8c83' }}>{a.date}</div>
                    </div>
                  ))}
                </div>

                {/* Today's reminder */}
                <div style={C.card}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8c83', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>🔔 今日提醒</div>
                  <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>• 今日班次：{todaySchedule?.shift || '休息'} {todaySchedule?.actual_start ? `${todaySchedule.actual_start}-${todaySchedule.actual_end}` : ''}</div>
                    <div>• 本月出勤 {workDays} 天，累計 {totalHours.toFixed(1)} 小時</div>
                    {pendingFlows.length > 0 && <div>• 您有 {pendingFlows.length} 筆待審核申請</div>}
                    {todayAtt?.status === '遲到' && <div style={{ color: '#ef4444' }}>• 今日遲到，請注意出勤</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'clock' && (
          <div style={{ maxWidth: 500, margin: '0 auto', textAlign: 'center' }}>
            <div style={C.card}>
              <div style={{ fontSize: 56, fontWeight: 700, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>{clockTime}</div>
              <div style={{ color: '#8a8c83', marginTop: 4 }}>{clockDate}</div>
              <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center' }}>
                {clockedIn ? (
                  <button onClick={handleClockOut} style={{ padding: '14px 40px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer', boxShadow: '0 4px 12px rgba(239,68,68,.3)' }}>下班打卡</button>
                ) : (
                  <button onClick={handleClockIn} style={{ padding: '14px 40px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer', boxShadow: '0 4px 12px rgba(34,197,94,.3)' }}>上班打卡</button>
                )}
              </div>
              <div style={{ marginTop: 12, fontSize: 13, color: '#8a8c83' }}>
                {clockedIn ? `✅ 已上班打卡 · ${todayAtt?.clock_in || ''}` : '⚪ 尚未打卡'}
              </div>
            </div>

            <div style={C.card}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8c83', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>本月出勤紀錄</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ borderBottom: '2px solid #e8e8e3' }}><th style={{ padding: 8, textAlign: 'left' }}>日期</th><th>上班</th><th>下班</th><th>工時</th><th>狀態</th></tr></thead>
                <tbody>
                  {attendance.slice(-7).map(a => (
                    <tr key={a.date} style={{ borderBottom: '1px solid #f0f0ec' }}>
                      <td style={{ padding: 8 }}>{a.date}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{a.clock_in || '-'}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{a.clock_out || '-'}</td>
                      <td style={{ textAlign: 'center' }}>{a.total_hours || a.hours || '-'}</td>
                      <td style={{ textAlign: 'center' }}>{statusBadge(a.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'schedule' && (
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>📅 本月班表</div>
            <div style={C.card}>
              {schedules.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#8a8c83' }}>本月尚無排班資料</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr style={{ borderBottom: '2px solid #e8e8e3' }}><th style={{ padding: 8, textAlign: 'left' }}>日期</th><th>班次</th><th>上班</th><th>下班</th><th>工時</th></tr></thead>
                  <tbody>
                    {schedules.map(s => (
                      <tr key={s.date} style={{ borderBottom: '1px solid #f0f0ec', background: s.date === today ? '#f0fdf4' : 'transparent' }}>
                        <td style={{ padding: 8, fontWeight: s.date === today ? 700 : 400 }}>{s.date} {s.date === today && '(今天)'}</td>
                        <td style={{ textAlign: 'center' }}><span style={{ padding: '2px 8px', borderRadius: 4, background: s.shift === '休' ? '#f1f5f9' : '#dcfce7', fontSize: 12, fontWeight: 600 }}>{s.shift}</span></td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{s.actual_start || '-'}</td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{s.actual_end || '-'}</td>
                        <td style={{ textAlign: 'center' }}>{s.actual_hours || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {tab === 'attendance' && (
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>📊 出勤紀錄</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
              <div style={C.card}><div style={{ fontSize: 11, color: '#8a8c83' }}>出勤天數</div><div style={{ fontSize: 24, fontWeight: 700 }}>{workDays}</div></div>
              <div style={C.card}><div style={{ fontSize: 11, color: '#8a8c83' }}>累計工時</div><div style={{ fontSize: 24, fontWeight: 700 }}>{totalHours.toFixed(1)}</div></div>
              <div style={C.card}><div style={{ fontSize: 11, color: '#8a8c83' }}>遲到</div><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{attendance.filter(a => a.status === '遲到').length}</div></div>
              <div style={C.card}><div style={{ fontSize: 11, color: '#8a8c83' }}>請假</div><div style={{ fontSize: 24, fontWeight: 700 }}>{attendance.filter(a => ['特休', '病假', '事假'].includes(a.status)).length}</div></div>
            </div>
            <div style={C.card}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ borderBottom: '2px solid #e8e8e3' }}><th style={{ padding: 8, textAlign: 'left' }}>日期</th><th>上班</th><th>下班</th><th>工時</th><th>狀態</th></tr></thead>
                <tbody>
                  {attendance.map(a => (
                    <tr key={a.date} style={{ borderBottom: '1px solid #f0f0ec' }}>
                      <td style={{ padding: 8 }}>{a.date}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{a.clock_in || '-'}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{a.clock_out || '-'}</td>
                      <td style={{ textAlign: 'center' }}>{a.total_hours || a.hours || '-'}</td>
                      <td style={{ textAlign: 'center' }}>{statusBadge(a.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'leave' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>📋 請假</div>
            </div>
            {leaveBalances.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                {leaveBalances.map(b => (
                  <div key={b.leave_type} style={C.card}>
                    <div style={{ fontSize: 12, color: '#8a8c83' }}>{b.leave_type}</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{b.total_days - b.used_days}<span style={{ fontSize: 12, color: '#8a8c83', marginLeft: 3 }}>天</span></div>
                    <div style={{ fontSize: 11, color: '#8a8c83' }}>已用 {b.used_days} / {b.total_days}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={C.card}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8c83', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>申請紀錄</div>
              {leaveHistory.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: '#8a8c83' }}>暫無請假紀錄</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr style={{ borderBottom: '2px solid #e8e8e3' }}><th style={{ padding: 8, textAlign: 'left' }}>假別</th><th>日期</th><th>天數</th><th>事由</th><th>狀態</th></tr></thead>
                  <tbody>
                    {leaveHistory.map(l => (
                      <tr key={l.id} style={{ borderBottom: '1px solid #f0f0ec' }}>
                        <td style={{ padding: 8, fontWeight: 600 }}>{l.leave_type || l.type}</td>
                        <td>{l.start_date} ~ {l.end_date}</td>
                        <td style={{ textAlign: 'center' }}>{l.days}</td>
                        <td>{l.reason}</td>
                        <td>{statusBadge(l.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {tab === 'overtime' && (
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>⏰ 加班申請</div>
            <div style={C.card}>
              {otHistory.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: '#8a8c83' }}>暫無加班紀錄</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr style={{ borderBottom: '2px solid #e8e8e3' }}><th style={{ padding: 8, textAlign: 'left' }}>日期</th><th>時數</th><th>事由</th><th>狀態</th></tr></thead>
                  <tbody>
                    {otHistory.map(o => (
                      <tr key={o.id} style={{ borderBottom: '1px solid #f0f0ec' }}>
                        <td style={{ padding: 8 }}>{o.date || o.request_date}</td>
                        <td style={{ textAlign: 'center' }}>{o.hours || o.ot_hours} 小時</td>
                        <td>{o.reason}</td>
                        <td>{statusBadge(o.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {tab === 'salary' && (
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>💰 薪資單</div>
            <div style={{ ...C.card, background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#fff', padding: 32 }}>
              <div style={{ fontSize: 12, opacity: .75, textTransform: 'uppercase', letterSpacing: 1 }}>本月實發薪資</div>
              <div style={{ fontSize: 42, fontWeight: 700, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>NT$ {fmt(emp.base_salary || 0)}</div>
              <div style={{ fontSize: 12, opacity: .7, marginTop: 6 }}>底薪資訊（詳細薪資條請洽 HR）</div>
            </div>
          </div>
        )}

        {tab === 'flows' && (
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>📝 流程中心</div>
            <div style={C.card}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8c83', marginBottom: 12 }}>我發起的</div>
              {[...leaveHistory, ...otHistory].length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#8a8c83' }}>暫無流程紀錄</div>
              ) : [...leaveHistory, ...otHistory].map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f0ec' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {f.leave_type ? <CalendarOff size={16} /> : <Timer size={16} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{f.leave_type || f.type || '加班'} 申請</div>
                    <div style={{ fontSize: 12, color: '#8a8c83' }}>{f.start_date || f.date} · {f.days ? f.days + '天' : (f.hours || f.ot_hours) + '小時'}</div>
                  </div>
                  {statusBadge(f.status)}
                </div>
              ))}
            </div>

            {tasks.length > 0 && (
              <div style={C.card}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8c83', marginBottom: 12 }}>指派給我的</div>
                {tasks.map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f0ec' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <CheckCircle2 size={16} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{t.title}</div>
                      <div style={{ fontSize: 12, color: '#8a8c83' }}>到期：{t.due_date || '未設定'}</div>
                    </div>
                    {statusBadge(t.status)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'profile' && (
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>👤 個人資料</div>
            <div style={{ ...C.card, display: 'flex', alignItems: 'center', gap: 18 }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg, #22d3ee, #0ea5e9)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700 }}>{emp.name?.[0]}</div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{emp.name}</div>
                <div style={{ fontSize: 14, color: '#8a8c83', marginTop: 2 }}>{emp.employee_number} · {emp.email}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <span style={{ padding: '2px 10px', borderRadius: 20, background: '#f1f5f9', border: '1px solid #e2e8f0', fontSize: 12 }}>{emp.dept || emp.current_department_name}</span>
                  <span style={{ padding: '2px 10px', borderRadius: 20, background: '#f1f5f9', border: '1px solid #e2e8f0', fontSize: 12 }}>{emp.position}</span>
                  <span style={{ padding: '2px 10px', borderRadius: 20, background: '#f1f5f9', border: '1px solid #e2e8f0', fontSize: 12 }}>{emp.store || emp.current_store_name}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={C.card}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8c83', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}><User size={14} /> 基本資料</div>
                {[
                  ['員工編號', emp.employee_number],
                  ['部門', emp.dept || emp.current_department_name],
                  ['職位', emp.position],
                  ['到職日', emp.join_date],
                  ['僱用類型', emp.employment_type],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', padding: '8px 0', borderBottom: '1px solid #f0f0ec', fontSize: 13 }}>
                    <span style={{ color: '#8a8c83' }}>{k}</span><span style={{ fontWeight: 500 }}>{v || '-'}</span>
                  </div>
                ))}
              </div>
              <div style={C.card}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#8a8c83', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Phone size={14} /> 聯絡資訊</div>
                {[
                  ['Email', emp.email],
                  ['手機', emp.phone],
                  ['地址', emp.address],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', padding: '8px 0', borderBottom: '1px solid #f0f0ec', fontSize: 13 }}>
                    <span style={{ color: '#8a8c83' }}>{k}</span><span style={{ fontWeight: 500 }}>{v || '-'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
