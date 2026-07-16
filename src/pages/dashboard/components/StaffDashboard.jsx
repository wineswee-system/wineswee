// StaffDashboard — extracted from Dashboard.jsx
// store_staff / office_staff 員工儀表板（參考 employee-portal 設計）
import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import LoadingSpinner from '../../../components/LoadingSpinner'
import MyTasksWidget from './MyTasksWidget'
import { todayTW, monthStartTW } from '../../../lib/datetime'

export default function StaffDashboard({ profile }) {
  const [schedules, setSchedules] = useState([])
  const [attendance, setAttendance] = useState([])
  const [leaves, setLeaves] = useState([])
  const [flows, setFlows] = useState([])
  const [loading, setLoading] = useState(true)
  const [clockTime, setClockTime] = useState(new Date())
  const empName = profile?.name || ''
  const today = todayTW()
  const monthStart = monthStartTW()

  useEffect(() => {
    if (!empName) { setLoading(false); return }
    Promise.all([
      supabase.from('schedules').select('date, shift').eq('employee', empName).gte('date', monthStart).order('date'),
      supabase.from('attendance_records').select('date, clock_in, clock_out, status, hours').eq('employee', empName).gte('date', monthStart).order('date', { ascending: false }),
      supabase.from('leave_requests').select('id, type, start_date, end_date, status').eq('employee', empName).is('deleted_at', null).order('created_at', { ascending: false }).limit(5),
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

      {/* 我的任務 */}
      <div style={{ marginBottom: 20 }}>
        <MyTasksWidget />
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
