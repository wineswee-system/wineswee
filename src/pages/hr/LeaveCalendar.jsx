import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function getFirstDayOfWeek(year, month) {
  const d = new Date(year, month - 1, 1).getDay()
  return d === 0 ? 6 : d - 1 // Monday-based
}

export default function LeaveCalendar() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [employees, setEmployees] = useState([])
  const [leaves, setLeaves] = useState([])
  const [holidays, setHolidays] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [selectedDate, setSelectedDate] = useState(null)

  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)

  useEffect(() => {
    const startDate = `${viewYear}-${String(viewMonth).padStart(2, '0')}-01`
    const endDate = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${getDaysInMonth(viewYear, viewMonth)}`

    Promise.all([
      supabase.from('employees').select('id, name, department_id, position, departments(name)').eq('status', '在職').order('department_id').order('name'),
      supabase.from('leave_requests').select('*').eq('status', '已核准').lte('start_date', endDate).gte('end_date', startDate),
      supabase.from('holidays').select('*').gte('date', startDate).lte('date', endDate),
      supabase.from('departments').select('*').order('name'),
    ]).then(([e, l, h, d]) => {
      setEmployees(e.data || [])
      setLeaves(l.data || [])
      setHolidays(h.data || [])
      setDepartments(d.data || [])
    }).catch(err => {
      console.error('Failed to load calendar data:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }, [viewYear, viewMonth])

  // Map: date -> [{ employee, type }]
  const leaveMap = useMemo(() => {
    const map = {}
    leaves.forEach(l => {
      const start = new Date(l.start_date)
      const end = new Date(l.end_date)
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10)
        if (!map[key]) map[key] = []
        map[key].push({ employee: l.employee, type: l.type, days: l.days })
      }
    })
    return map
  }, [leaves])

  const holidayMap = useMemo(() => {
    const map = {}
    holidays.forEach(h => { map[h.date] = h.name })
    return map
  }, [holidays])

  const filteredEmployees = useMemo(() => {
    return deptFilter ? employees.filter(e => e.dept === deptFilter) : employees
  }, [employees, deptFilter])

  // Attendance summary per date
  const dateSummary = useMemo(() => {
    const days = getDaysInMonth(viewYear, viewMonth)
    const result = []
    for (let d = 1; d <= days; d++) {
      const dateStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const onLeave = (leaveMap[dateStr] || []).filter(l => !deptFilter || filteredEmployees.some(e => e.name === l.employee))
      result.push({ day: d, date: dateStr, onLeave, holiday: holidayMap[dateStr], isWeekend: [5, 6].includes(getFirstDayOfWeek(viewYear, viewMonth) + ((d - 1) % 7) > 6 ? (getFirstDayOfWeek(viewYear, viewMonth) + d - 1) % 7 : (getFirstDayOfWeek(viewYear, viewMonth) + d - 1) % 7) })
    }
    return result
  }, [viewYear, viewMonth, leaveMap, holidayMap, filteredEmployees, deptFilter])

  const stats = useMemo(() => {
    const totalLeaveCount = leaves.length
    const uniqueEmp = new Set(leaves.map(l => l.employee)).size
    const peakDay = dateSummary.reduce((max, d) => d.onLeave.length > max.count ? { date: d.date, count: d.onLeave.length } : max, { date: '', count: 0 })
    return { totalLeaveCount, uniqueEmp, peakDay }
  }, [leaves, dateSummary])

  const prevMonth = () => {
    if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const daysInMonth = getDaysInMonth(viewYear, viewMonth)
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth)

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  const calendarDays = []
  for (let i = 0; i < firstDay; i++) calendarDays.push(null)
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d)

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📅</span> 團隊請假日曆</h2>
            <p>一覽團隊休假狀態，避免排班衝突</p>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'rgba(6,182,212,0.12)' }}>
          <div className="stat-card-label">本月核准假單</div>
          <div className="stat-card-value">{stats.totalLeaveCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'rgba(245,158,11,0.12)' }}>
          <div className="stat-card-label">請假人數</div>
          <div className="stat-card-value">{stats.uniqueEmp}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'rgba(239,68,68,0.12)' }}>
          <div className="stat-card-label">最多人請假日</div>
          <div className="stat-card-value">{stats.peakDay.date ? `${stats.peakDay.date.slice(5)} (${stats.peakDay.count}人)` : '-'}</div>
        </div>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
        alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={prevMonth}><ChevronLeft size={16} /></button>
          <span style={{ fontSize: 16, fontWeight: 700, minWidth: 120, textAlign: 'center' }}>{viewYear} 年 {viewMonth} 月</span>
          <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={nextMonth}><ChevronRight size={16} /></button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🏢 部門</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 140 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">全部部門</option>
            {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="card">
        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
            {WEEKDAYS.map(d => (
              <div key={d} style={{ textAlign: 'center', padding: 8, fontSize: 13, fontWeight: 600, color: d === '六' || d === '日' ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                {d}
              </div>
            ))}
            {calendarDays.map((day, idx) => {
              if (day === null) return <div key={`empty-${idx}`} />
              const dateStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const onLeave = (leaveMap[dateStr] || []).filter(l => !deptFilter || filteredEmployees.some(e => e.name === l.employee))
              const holiday = holidayMap[dateStr]
              const isToday = dateStr === new Date().toISOString().slice(0, 10)
              const dayOfWeek = (firstDay + day - 1) % 7
              const isWeekend = dayOfWeek >= 5

              return (
                <div key={day} onClick={() => setSelectedDate(selectedDate === dateStr ? null : dateStr)}
                  style={{
                    minHeight: 80, padding: 6, border: '1px solid var(--border-subtle)', borderRadius: 6,
                    background: isToday ? 'rgba(6,182,212,0.08)' : holiday ? 'rgba(245,158,11,0.06)' : isWeekend ? 'var(--bg-secondary)' : 'var(--bg-card)',
                    cursor: 'pointer',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{
                      fontSize: 13, fontWeight: isToday ? 700 : 500,
                      color: isToday ? 'var(--accent-cyan)' : isWeekend ? 'var(--accent-red)' : 'var(--text-primary)',
                      ...(isToday ? { background: 'var(--accent-cyan)', color: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } : {}),
                    }}>
                      {day}
                    </span>
                    {onLeave.length > 0 && (
                      <span style={{ fontSize: 10, background: onLeave.length >= 3 ? 'var(--accent-red)' : 'var(--accent-orange)', color: '#fff', borderRadius: 8, padding: '1px 6px', fontWeight: 600 }}>
                        {onLeave.length}人
                      </span>
                    )}
                  </div>
                  {holiday && <div style={{ fontSize: 10, color: 'var(--accent-orange)', fontWeight: 600, marginBottom: 2 }}>{holiday}</div>}
                  {onLeave.slice(0, 3).map((l, i) => (
                    <div key={i} style={{ fontSize: 10, padding: '1px 4px', marginBottom: 1, borderRadius: 3, background: 'rgba(6,182,212,0.1)', color: 'var(--accent-cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.employee} · {l.type}
                    </div>
                  ))}
                  {onLeave.length > 3 && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{onLeave.length - 3} 人</div>}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Selected date detail */}
      {selectedDate && (leaveMap[selectedDate] || []).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Users size={16} /></span> {selectedDate} 請假人員</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>員工</th><th>假別</th><th>天數</th></tr>
              </thead>
              <tbody>
                {(leaveMap[selectedDate] || []).filter(l => !deptFilter || filteredEmployees.some(e => e.name === l.employee)).map((l, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{l.employee}</td>
                    <td><span className="badge badge-info">{l.type}</span></td>
                    <td>{l.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
