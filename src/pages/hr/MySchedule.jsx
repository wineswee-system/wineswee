import { useState, useEffect } from 'react'
import { Calendar, Clock, ChevronLeft, ChevronRight, CalendarOff, ArrowLeftRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { isAbsence, ABSENCE_CONFIG, getMonthDates, formatYearMonth, parseYearMonth, getDayLabel, isWeekendDay, parseTime, getShiftHours } from '../../lib/scheduleUtils'

export default function MySchedule() {
  const [profile, setProfile] = useState(null)
  const [schedules, setSchedules] = useState([])
  const [shiftDefs, setShiftDefs] = useState([])
  const [monthOffset, setMonthOffset] = useState(0)
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const viewYear = now.getFullYear()
  const viewMonth = now.getMonth() + 1 + monthOffset
  const adjustedDate = new Date(viewYear, viewMonth - 1, 1)
  const selectedMonth = formatYearMonth(adjustedDate.getFullYear(), adjustedDate.getMonth() + 1)
  const { year: mYear, month: mMonth } = parseYearMonth(selectedMonth)
  const monthDates = getMonthDates(mYear, mMonth)

  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem('sme_profile') || '{}')
      setProfile(p)
    } catch { setProfile({}) }
    supabase.from('shift_definitions').select('*').order('sort_order')
      .then(({ data }) => setShiftDefs(data || []))
  }, [])

  const [published, setPublished] = useState(false)

  useEffect(() => {
    if (!profile?.name) { setLoading(false); return }
    setLoading(true)

    // Check if this month's schedule has been published for employee's store
    const loadData = async () => {
      // Get employee's store
      const { data: empData } = await supabase.from('employees')
        .select('store').eq('name', profile.name).maybeSingle()
      const storeName = empData?.store

      // Check publish status
      let isPublished = false
      if (storeName) {
        const { data: store } = await supabase.from('stores')
          .select('id').eq('name', storeName).maybeSingle()
        if (store) {
          const { data: pubStatus } = await supabase.from('schedule_publish_status')
            .select('status').eq('store_id', store.id).eq('month', selectedMonth).maybeSingle()
          isPublished = pubStatus?.status === 'published'
        }
      }
      setPublished(isPublished)

      // Only load schedules if published
      if (isPublished) {
        const { data } = await supabase.from('schedules').select('*')
          .eq('employee', profile.name)
          .gte('date', monthDates[0])
          .lte('date', monthDates[monthDates.length - 1])
        setSchedules(data || [])
      } else {
        setSchedules([])
      }
      setLoading(false)
    }
    loadData()
  }, [profile?.name, selectedMonth])

  if (!profile?.name) {
    return (
      <div className="fade-in" style={{ textAlign: 'center', padding: 60 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
        <h3>我的班表</h3>
        <p style={{ color: 'var(--text-muted)' }}>請先登入以查看您的排班</p>
      </div>
    )
  }

  const shiftDefMap = {}
  for (const d of shiftDefs) shiftDefMap[d.name] = d

  // Stats
  const workDays = schedules.filter(s => !isAbsence(s.shift)).length
  const restDays = schedules.filter(s => isAbsence(s.shift)).length
  let totalHours = 0
  schedules.forEach(s => {
    if (isAbsence(s.shift)) return
    if (s.actual_hours) totalHours += s.actual_hours
    else {
      const def = shiftDefMap[s.shift]
      if (def) {
        totalHours += getShiftHours(def) - (def.break_minutes || 60) / 60
      } else totalHours += 8
    }
  })

  const weekendWork = schedules.filter(s => !isAbsence(s.shift) && isWeekendDay(new Date(s.date).getDay())).length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 我的班表</h2>
            <p>{profile.name} · {profile.position || profile.dept || ''}</p>
          </div>
        </div>
      </div>

      {!published && !loading && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 16,
          background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 16 }}>⏳</span>
          <span style={{ fontSize: 13, color: '#f59e0b', fontWeight: 600 }}>
            {mYear} 年 {mMonth} 月班表尚未發布，請等待店長確認後公告
          </span>
        </div>
      )}

      {/* Month Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => setMonthOffset(m => m - 1)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
          <ChevronLeft size={16} />
        </button>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{mYear} 年 {mMonth} 月</div>
        <button onClick={() => setMonthOffset(m => m + 1)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => setMonthOffset(0)} style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid var(--border-medium)', background: monthOffset === 0 ? 'var(--accent-cyan)' : 'var(--bg-card)', color: monthOffset === 0 ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
          本月
        </button>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">上班天數</div>
          <div className="stat-card-value">{workDays}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">休假天數</div>
          <div className="stat-card-value">{restDays}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">總工時</div>
          <div className="stat-card-value">{Math.round(totalHours)}h</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-pink)', '--card-accent-dim': 'rgba(236,72,153,0.1)' }}>
          <div className="stat-card-label">假日出勤</div>
          <div className="stat-card-value">{weekendWork}</div>
        </div>
      </div>

      {/* Calendar View */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Calendar size={16} /> 月曆班表</div>
        </div>
        <div style={{ padding: 16 }}>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8 }}>
            {['日', '一', '二', '三', '四', '五', '六'].map((d, i) => (
              <div key={d} style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: i === 5 || i === 6 ? 'var(--accent-red)' : 'var(--text-muted)', padding: '4px 0' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {/* Empty cells for first week offset */}
            {Array.from({ length: new Date(monthDates[0]).getDay() }, (_, i) => (
              <div key={`empty-${i}`} />
            ))}

            {monthDates.map(date => {
              const sched = schedules.find(s => s.date === date)
              const shift = sched?.shift
              const def = shift ? shiftDefMap[shift] : null
              const isToday = date === now.toISOString().slice(0, 10)
              const dow = new Date(date).getDay()
              const isWeekend = isWeekendDay(dow)
              const isRest = shift && isAbsence(shift)
              const absConfig = isRest ? ABSENCE_CONFIG[shift] : null

              return (
                <div key={date} style={{
                  borderRadius: 10, padding: '8px 4px', textAlign: 'center', minHeight: 70,
                  background: isToday ? 'rgba(34,211,238,0.08)' : 'var(--bg-card)',
                  border: isToday ? '2px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                }}>
                  <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isWeekend ? 'var(--accent-red)' : 'var(--text-primary)', marginBottom: 4 }}>
                    {parseInt(date.slice(8))}
                  </div>
                  {shift ? (
                    <div>
                      <div style={{
                        padding: '3px 6px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: isRest ? (absConfig?.color || '#6b7280') + '20' : (def?.color || '#22d3ee') + '20',
                        color: isRest ? (absConfig?.color || '#6b7280') : (def?.color || '#22d3ee'),
                      }}>
                        {isRest ? (absConfig?.icon || '😴') : ''} {shift}
                      </div>
                      {!isRest && (
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>
                          <Clock size={8} style={{ verticalAlign: -1 }} />{' '}
                          {sched?.actual_start?.slice(0, 5) || def?.start_time?.slice(0, 5) || ''}~{sched?.actual_end?.slice(0, 5) || def?.end_time?.slice(0, 5) || ''}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Self-service: Off Request + Swap */}
      {published && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          {/* Off Request */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><CalendarOff size={16} /> 請假申請</div>
            </div>
            <OffRequestForm empName={profile.name} monthDates={monthDates} schedules={schedules} />
          </div>

          {/* Swap Request */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><ArrowLeftRight size={16} /> 換班申請</div>
            </div>
            <SwapRequestForm empName={profile.name} monthDates={monthDates} schedules={schedules} shiftDefs={shiftDefs} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Off Request Sub-component ──
function OffRequestForm({ empName, monthDates, schedules }) {
  const [date, setDate] = useState('')
  const [myRequests, setMyRequests] = useState([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase.from('off_requests').select('*')
      .eq('employee', empName)
      .gte('date', monthDates[0])
      .lte('date', monthDates[monthDates.length - 1])
      .then(({ data }) => setMyRequests(data || []))
  }, [empName, monthDates])

  const handleSubmit = async () => {
    if (!date) return
    setSubmitting(true)
    const { data, error } = await supabase.from('off_requests')
      .upsert({ employee: empName, date }, { onConflict: 'employee,date' })
      .select().single()
    if (data) setMyRequests(prev => [...prev.filter(r => r.date !== date), data])
    if (error) alert('申請失敗：' + error.message)
    setSubmitting(false)
    setDate('')
  }

  const handleCancel = async (reqDate) => {
    await supabase.from('off_requests').delete().eq('employee', empName).eq('date', reqDate)
    setMyRequests(prev => prev.filter(r => r.date !== reqDate))
  }

  // Only show future work days
  const futureDates = monthDates.filter(d => {
    const today = new Date().toISOString().slice(0, 10)
    if (d <= today) return false
    const sched = schedules.find(s => s.date === d)
    return sched && !isAbsence(sched.shift)
  })

  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'end' }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>請假日期</label>
          <select className="form-input" value={date} onChange={e => setDate(e.target.value)} style={{ width: '100%' }}>
            <option value="">選擇日期</option>
            {futureDates.map(d => {
              const dow = ['日', '一', '二', '三', '四', '五', '六'][new Date(d).getDay()]
              const sched = schedules.find(s => s.date === d)
              const alreadyRequested = myRequests.some(r => r.date === d)
              return <option key={d} value={d} disabled={alreadyRequested}>{d.slice(5)} (週{dow}) {sched?.shift}{alreadyRequested ? ' ✓已申請' : ''}</option>
            })}
          </select>
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={!date || submitting} style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
          提出申請
        </button>
      </div>

      {myRequests.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>已申請的請假</div>
          {myRequests.sort((a, b) => a.date.localeCompare(b.date)).map(r => {
            const dow = ['日', '一', '二', '三', '四', '五', '六'][new Date(r.date).getDay()]
            const isPast = r.date <= new Date().toISOString().slice(0, 10)
            return (
              <div key={r.date} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: 13 }}>{r.date.slice(5)} (週{dow})</span>
                {!isPast && (
                  <button onClick={() => handleCancel(r.date)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--accent-red)' }}>
                    取消
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {myRequests.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>本月無請假申請</div>}
    </div>
  )
}

// ── Swap Request Sub-component ──
function SwapRequestForm({ empName, monthDates, schedules, shiftDefs }) {
  const [date, setDate] = useState('')
  const [targetEmployee, setTargetEmployee] = useState('')
  const [mySwaps, setMySwaps] = useState([])
  const [coworkers, setCoworkers] = useState([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase.from('shift_swaps').select('*')
      .or(`requester.eq.${empName},target.eq.${empName}`)
      .gte('date', monthDates[0])
      .lte('date', monthDates[monthDates.length - 1])
      .order('created_at', { ascending: false })
      .then(({ data }) => setMySwaps(data || []))
  }, [empName, monthDates])

  // When date selected, find coworkers on different shift that day
  useEffect(() => {
    if (!date) { setCoworkers([]); return }
    const myShift = schedules.find(s => s.employee === empName && s.date === date)?.shift
    if (!myShift) { setCoworkers([]); return }

    const others = schedules
      .filter(s => s.date === date && s.employee !== empName && !isAbsence(s.shift) && s.shift !== myShift)
      .map(s => ({ name: s.employee, shift: s.shift }))
    setCoworkers(others)
  }, [date, empName, schedules])

  const handleSubmit = async () => {
    if (!date || !targetEmployee) return
    setSubmitting(true)
    const myShift = schedules.find(s => s.employee === empName && s.date === date)?.shift
    const theirShift = schedules.find(s => s.employee === targetEmployee && s.date === date)?.shift

    const { data, error } = await supabase.from('shift_swaps').insert({
      requester: empName,
      target: targetEmployee,
      date,
      requester_shift: myShift,
      target_shift: theirShift,
      status: 'pending',
    }).select().single()

    if (data) setMySwaps(prev => [data, ...prev])
    if (error) alert('申請失敗：' + error.message)
    setSubmitting(false)
    setDate('')
    setTargetEmployee('')
  }

  const futureDates = monthDates.filter(d => {
    const today = new Date().toISOString().slice(0, 10)
    if (d <= today) return false
    const sched = schedules.find(s => s.date === d)
    return sched && !isAbsence(sched.shift)
  })

  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'end' }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>換班日期</label>
          <select className="form-input" value={date} onChange={e => setDate(e.target.value)} style={{ width: '100%' }}>
            <option value="">選擇日期</option>
            {futureDates.map(d => {
              const dow = ['日', '一', '二', '三', '四', '五', '六'][new Date(d).getDay()]
              const sched = schedules.find(s => s.date === d)
              return <option key={d} value={d}>{d.slice(5)} (週{dow}) {sched?.shift}</option>
            })}
          </select>
        </div>
      </div>

      {date && coworkers.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>想跟誰換？</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {coworkers.map(c => (
              <button key={c.name} onClick={() => setTargetEmployee(c.name)} style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                border: targetEmployee === c.name ? '2px solid var(--accent-cyan)' : '1px solid var(--border-medium)',
                background: targetEmployee === c.name ? 'rgba(34,211,238,0.1)' : 'var(--bg-card)',
                color: targetEmployee === c.name ? 'var(--accent-cyan)' : 'var(--text-primary)',
                fontWeight: 600,
              }}>
                {c.name}（{c.shift}）
              </button>
            ))}
          </div>
        </div>
      )}

      {date && coworkers.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>該日無可換班的同事（都是同班別或休假）</div>
      )}

      {targetEmployee && (
        <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={submitting} style={{ width: '100%', padding: '10px' }}>
          提出換班申請
        </button>
      )}

      {mySwaps.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>換班紀錄</div>
          {mySwaps.slice(0, 5).map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 12 }}>
              <span>{s.date?.slice(5)} {s.requester}({s.requester_shift}) ↔ {s.target}({s.target_shift})</span>
              <span style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                background: s.status === 'approved' ? 'rgba(52,211,153,0.12)' : s.status === 'rejected' ? 'rgba(239,68,68,0.1)' : 'rgba(251,191,36,0.12)',
                color: s.status === 'approved' ? '#10b981' : s.status === 'rejected' ? '#ef4444' : '#f59e0b',
              }}>
                {s.status === 'approved' ? '已核准' : s.status === 'rejected' ? '已拒絕' : '待審核'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
