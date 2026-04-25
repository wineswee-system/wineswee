import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Calendar, DollarSign, GitBranch, MapPin, Wifi, Loader } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { serverClockIn } from '../../lib/db'
import { validateClockIn } from '../../lib/clockInValidator'

const ALL_QUICK_ACTIONS = [
  { icon: Calendar, label: '請假', desc: '假單申請', path: '/hr/leave', color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)' },
  { icon: DollarSign, label: '薪資', desc: '查看薪資單', path: '/hr/salary', color: 'var(--accent-green)', dim: 'var(--accent-green-dim)', minRole: 'office_staff' },
  { icon: GitBranch, label: '流程', desc: '任務回報', path: '/process/tasks', color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)' },
  { icon: Calendar, label: '出勤', desc: '出勤紀錄', path: '/hr/attendance', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
]

const ROLE_ORDER = ['store_staff', 'office_staff', 'manager', 'admin', 'super_admin']
const roleAtLeast = (userRole, minRole) => ROLE_ORDER.indexOf(userRole) >= ROLE_ORDER.indexOf(minRole)

export default function PortalHome() {
  const { profile, profileReady } = useAuth()
  const [todayAttendance, setTodayAttendance] = useState(null)
  const [pendingTasks, setPendingTasks] = useState(0)
  const [recentLeaves, setRecentLeaves] = useState([])
  const [store, setStore] = useState(null)
  const [clockingIn, setClockingIn] = useState(false)
  const [clockMsg, setClockMsg] = useState(null)

  const today = new Date().toISOString().slice(0, 10)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? '早安' : hour < 18 ? '午安' : '晚安'

  useEffect(() => {
    // ★ 等 profile 完全載入完（含 organization_id）才查；避免「name 有但 id 還沒」的競態
    if (!profileReady || !profile?.id) return

    supabase.from('attendance_records').select('*')
      .eq('employee_id', profile.id).eq('date', today).maybeSingle()
      .then(({ data }) => setTodayAttendance(data))

    supabase.from('tasks').select('id', { count: 'exact', head: true })
      .eq('assignee_id', profile.id).in('status', ['未開始', '進行中'])
      .then(({ count }) => setPendingTasks(count || 0))

    supabase.from('leave_requests').select('*')
      .eq('employee_id', profile.id).order('id', { ascending: false }).limit(5)
      .then(({ data }) => setRecentLeaves(data || []))

    // Load employee's store for clock-in validation
    supabase.from('employees').select('store_id').eq('id', profile.id).maybeSingle()
      .then(({ data }) => {
        if (data?.store_id) {
          supabase.from('stores').select('*').eq('id', data.store_id).maybeSingle()
            .then(({ data: s }) => setStore(s))
        }
      })
  }, [profileReady, profile?.id, today])

  const handleClock = async () => {
    if (!profile?.name) return
    setClockingIn(true)
    setClockMsg(null)
    try {
      // Client-side validation first (blocks if location check fails)
      const result = await validateClockIn(store)

      const action = (todayAttendance?.clock_in && !todayAttendance?.clock_out) ? 'clock_out' : 'clock_in'

      // Server-side validation + record write
      const data = await serverClockIn({
        employee_id: profile.id,
        action,
        lat: result.lat,
        lng: result.lng,
        accuracy: result.accuracy || null,
        ip: result.ip,
      })

      setTodayAttendance(data.record)
      const now = new Date()
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

      if (action === 'clock_in') {
        setClockMsg({ type: 'success', text: `上班打卡成功 ${timeStr} — ${data.locationName || ''}` })
      } else {
        setClockMsg({ type: 'success', text: `下班打卡成功 ${timeStr}` })
      }
    } catch (err) {
      setClockMsg({ type: 'error', text: err.message })
    }
    setClockingIn(false)
  }

  const clockStatus = todayAttendance
    ? todayAttendance.clock_out ? '已下班' : '已上班'
    : '尚未打卡'
  const clockColor = todayAttendance
    ? todayAttendance.clock_out ? 'var(--accent-green)' : 'var(--accent-cyan)'
    : 'var(--accent-orange)'
  const clockAction = todayAttendance
    ? todayAttendance.clock_out ? null : '下班打卡'
    : '上班打卡'

  return (
    <div className="fade-in">
      {/* Welcome */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(34,211,238,0.08), rgba(59,130,246,0.08), rgba(167,139,250,0.08))',
        border: '1px solid rgba(34,211,238,0.15)',
        borderRadius: 20, padding: '28px 32px', marginBottom: 24,
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px', color: 'var(--text-primary)' }}>
          {greeting}，{profile?.name}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
          {profile?.dept}{profile?.position ? ` · ${profile.position}` : ''} — {new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </p>
      </div>

      {/* Clock-in Card */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
        borderRadius: 16, padding: '24px 28px', marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              <Clock size={16} style={{ verticalAlign: -3, marginRight: 6 }} /> 今日打卡
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: clockColor }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: clockColor }}>{clockStatus}</span>
              {todayAttendance?.clock_in && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {todayAttendance.clock_in}{todayAttendance.clock_out ? ` → ${todayAttendance.clock_out}` : ''}
                </span>
              )}
            </div>
            {todayAttendance?.clock_in_location && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={10} /> {todayAttendance.clock_in_location}
                {todayAttendance.clock_in_ip && (
                  <span style={{ marginLeft: 8 }}><Wifi size={10} /> {todayAttendance.clock_in_ip}</span>
                )}
              </div>
            )}
          </div>
          {clockAction && (
            <button
              onClick={handleClock}
              disabled={clockingIn}
              style={{
                padding: '12px 28px', borderRadius: 12, border: 'none',
                background: clockAction === '下班打卡'
                  ? 'linear-gradient(135deg, var(--accent-orange), #f59e0b)'
                  : 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))',
                color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                opacity: clockingIn ? 0.6 : 1, transition: 'all 0.2s',
                boxShadow: '0 4px 14px rgba(34,211,238,0.3)',
              }}
            >
              {clockingIn ? <Loader size={16} className="spin" /> : <Clock size={16} />}
              {clockingIn ? '定位中...' : clockAction}
            </button>
          )}
        </div>

        {/* Clock message */}
        {clockMsg && (
          <div style={{
            padding: '8px 14px', borderRadius: 8, fontSize: 12,
            background: clockMsg.type === 'success' ? 'var(--accent-green-dim)'
              : clockMsg.type === 'error' ? 'var(--accent-red-dim)'
              : clockMsg.type === 'warning' ? 'var(--accent-orange-dim)'
              : 'var(--accent-cyan-dim)',
            color: clockMsg.type === 'success' ? 'var(--accent-green)'
              : clockMsg.type === 'error' ? 'var(--accent-red)'
              : clockMsg.type === 'warning' ? 'var(--accent-orange)'
              : 'var(--accent-cyan)',
          }}>
            {clockMsg.text}
          </div>
        )}
      </div>

      {/* Status Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
          borderRadius: 14, padding: '18px 20px',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>待辦任務</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: pendingTasks > 0 ? 'var(--accent-orange)' : 'var(--accent-green)' }}>
            {pendingTasks}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>項未完成</div>
        </div>

        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
          borderRadius: 14, padding: '18px 20px',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>請假紀錄</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-blue)' }}>
            {recentLeaves.filter(l => l.status === '已核准').length}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>筆已核准</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>快速操作</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {ALL_QUICK_ACTIONS.filter(a => !a.minRole || roleAtLeast(profile?.role, a.minRole)).map(a => {
            const Icon = a.icon
            return (
              <Link key={a.path} to={a.path} style={{
                textDecoration: 'none',
                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                borderRadius: 14, padding: '20px 16px', textAlign: 'center',
                transition: 'all 0.2s', cursor: 'pointer',
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, margin: '0 auto 10px',
                  background: a.dim, color: a.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={20} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{a.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.desc}</div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Recent Leaves */}
      {recentLeaves.length > 0 && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
          borderRadius: 14, padding: '20px 24px',
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>近期請假</h3>
          {recentLeaves.map(l => (
            <div key={l.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 0', borderBottom: '1px solid var(--border-subtle)',
            }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{l.type || '假'}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>{l.start_date}</span>
                {l.days && <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>({l.days}天)</span>}
              </div>
              <span style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: l.status === '已核准' ? 'var(--accent-green-dim)' : l.status === '待審核' ? 'var(--accent-orange-dim)' : 'var(--accent-red-dim)',
                color: l.status === '已核准' ? 'var(--accent-green)' : l.status === '待審核' ? 'var(--accent-orange)' : 'var(--accent-red)',
              }}>{l.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
