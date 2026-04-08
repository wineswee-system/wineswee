import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Sparkles, CalendarOff, AlertTriangle, Shield, Info } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { validateSchedule, LABOR_STANDARDS, GENDER_EQUALITY, OCCUPATIONAL_SAFETY } from '../../lib/laborLaw'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal from '../../components/Modal'

const SHIFT_TYPES = [
  { label: '08-17', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)' },
  { label: '09-18', color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)' },
  { label: '10-19', color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)' },
  { label: '11-20', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  { label: '12-21', color: 'var(--accent-pink)', dim: 'var(--accent-pink-dim)' },
  { label: '輪值', color: 'var(--accent-yellow)', dim: 'var(--accent-yellow-dim)' },
  { label: '休', color: 'var(--text-muted)', dim: 'var(--glass-medium)' },
]

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function getWeekDates(offset = 0) {
  const now = new Date()
  const dayOfWeek = now.getDay() || 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - dayOfWeek + 1 + offset * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d.toISOString().slice(0, 10)
  })
}

export default function Schedule() {
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [locations, setLocations] = useState([])
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)
  const [deptFilter, setDeptFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [editCell, setEditCell] = useState(null)
  const [offRequests, setOffRequests] = useState([])
  const [autoScheduling, setAutoScheduling] = useState(false)
  const [minStaff, setMinStaff] = useState(3)
  const [showLawModal, setShowLawModal] = useState(false)
  const [compliance, setCompliance] = useState({ errors: [], warnings: [], isValid: true })
  const [error, setError] = useState(null)

  const weekDates = getWeekDates(weekOffset)
  const weekStart = weekDates[0]
  const weekEnd = weekDates[6]

  useEffect(() => {
    Promise.all([
      supabase.from('employees').select('id, name, dept, position, store').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('stores').select('*').order('name'),
    ]).then(([e, d, l]) => {
      setEmployees(e.data || [])
      setDepartments(d.data || [])
      setLocations(l.data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    Promise.all([
      supabase.from('schedules').select('*').gte('date', weekStart).lte('date', weekEnd),
      supabase.from('off_requests').select('*').gte('date', weekStart).lte('date', weekEnd),
    ]).then(([s, o]) => {
      setSchedules(s.data || [])
      setOffRequests(o.data || [])
    }).catch(err => {
      console.error('Failed to load schedule data:', err)
    })
  }, [weekStart])

  // Run compliance check when schedules update
  useEffect(() => {
    if (schedules.length > 0) {
      setCompliance(validateSchedule(schedules, weekDates))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, weekStart])

  const getShift = (empName, date) => {
    const s = schedules.find(s => s.employee === empName && s.date === date)
    return s?.shift || ''
  }

  const handleSetShift = async (empName, date, shift) => {
    const existing = schedules.find(s => s.employee === empName && s.date === date)
    if (existing) {
      const { data } = await supabase.from('schedules').update({ shift }).eq('id', existing.id).select().single()
      if (data) setSchedules(prev => prev.map(s => s.id === existing.id ? data : s))
    } else {
      const { data } = await supabase.from('schedules').insert({ employee: empName, date, shift }).select().single()
      if (data) setSchedules(prev => [...prev, data])
    }
    setEditCell(null)
  }

  const getOffRequest = (empName, date) => offRequests.find(o => o.employee === empName && o.date === date)

  // AI Auto-Schedule
  const WORK_SHIFTS = SHIFT_TYPES.filter(t => t.label !== '休' && t.label !== '輪值').map(t => t.label)

  const handleAutoSchedule = async () => {
    if (!confirm(`將為 ${filtered.length} 位員工自動排班（${weekStart} ~ ${weekEnd}）\n已有的排班會保留，空白格子才會填入。\n每天最少 ${minStaff} 人上班。`)) return
    setAutoScheduling(true)

    const empNames = filtered.map(e => e.name)
    const newSchedules = []

    // Build existing schedule map
    const existing = {}
    for (const s of schedules) {
      existing[`${s.employee}_${s.date}`] = s.shift
    }

    // Build off-request map
    const offMap = {}
    for (const o of offRequests) {
      offMap[`${o.employee}_${o.date}`] = true
    }

    // For each employee, count how many rest days they already have this week
    const restCount = {}
    empNames.forEach(name => { restCount[name] = 0 })
    for (const date of weekDates) {
      for (const name of empNames) {
        const key = `${name}_${date}`
        if (existing[key] === '休') restCount[name]++
      }
    }

    // Auto-fill empty cells
    for (const date of weekDates) {
      const dayIndex = weekDates.indexOf(date) // 0=Mon ... 6=Sun

      // Count how many people already scheduled to work this day
      let workingCount = 0
      for (const name of empNames) {
        const key = `${name}_${date}`
        if (existing[key] && existing[key] !== '休') workingCount++
      }

      // Fill unscheduled employees
      for (const name of empNames) {
        const key = `${name}_${date}`
        if (existing[key]) continue // already scheduled

        // Check if employee requested off
        if (offMap[key]) {
          newSchedules.push({ employee: name, date, shift: '休' })
          restCount[name]++
          existing[key] = '休'
          continue
        }

        // Each person gets ~2 rest days per week
        // Prefer weekend rest, but ensure minimum staff
        const needRest = restCount[name] < 2
        const isWeekend = dayIndex >= 5
        const enoughStaff = workingCount >= minStaff

        if (needRest && isWeekend && enoughStaff) {
          newSchedules.push({ employee: name, date, shift: '休' })
          restCount[name]++
          existing[key] = '休'
        } else if (needRest && !isWeekend && workingCount >= minStaff && restCount[name] === 0 && dayIndex >= 3) {
          // Give a midweek rest if they have 0 so far and enough staff
          newSchedules.push({ employee: name, date, shift: '休' })
          restCount[name]++
          existing[key] = '休'
        } else {
          // Assign a work shift (rotate through shifts)
          const shiftIndex = (empNames.indexOf(name) + dayIndex) % WORK_SHIFTS.length
          const shift = WORK_SHIFTS[shiftIndex]
          newSchedules.push({ employee: name, date, shift })
          workingCount++
          existing[key] = shift
        }
      }
    }

    // Batch upsert
    if (newSchedules.length > 0) {
      const { data } = await supabase.from('schedules').upsert(newSchedules, { onConflict: 'employee,date' }).select()
      if (data) {
        setSchedules(prev => {
          const map = {}
          for (const s of [...prev, ...data]) map[`${s.employee}_${s.date}`] = s
          return Object.values(map)
        })
      }
    }

    setAutoScheduling(false)
    alert(`自動排班完成！填入 ${newSchedules.length} 個班次`)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = employees.filter(e =>
    (deptFilter === '' || e.dept === deptFilter) &&
    (storeFilter === '' || e.store === storeFilter)
  )

  const btnStyle = (active) => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500,
  })

  const getShiftStyle = (shift) => {
    const type = SHIFT_TYPES.find(t => t.label === shift)
    if (!type) return {}
    return { background: type.dim, color: type.color, border: `1px solid ${type.color}30` }
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📅</span> 排班管理</h2>
            <p>管理班表、排班偏好與AI自動排班</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              最少上班
              <input type="number" className="form-input" style={{ width: 50, padding: '4px 8px', fontSize: 12, textAlign: 'center' }}
                value={minStaff} onChange={e => setMinStaff(Number(e.target.value) || 1)} min={1} />
              人/天
            </div>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={async () => {
              // Copy last week's schedule
              const lastWeek = getWeekDates(weekOffset - 1)
              const { data: lastSchedules } = await supabase.from('schedules').select('*').gte('date', lastWeek[0]).lte('date', lastWeek[6])
              if (!lastSchedules?.length) { alert('上週無排班資料'); return }
              const newSchedules = lastSchedules.map(s => {
                const dayIdx = lastWeek.indexOf(s.date)
                return dayIdx >= 0 ? { employee: s.employee, date: weekDates[dayIdx], shift: s.shift } : null
              }).filter(Boolean)
              if (newSchedules.length > 0) {
                const { data } = await supabase.from('schedules').upsert(newSchedules, { onConflict: 'employee,date' }).select()
                if (data) setSchedules(prev => { const map = {}; for (const s of [...prev, ...data]) map[`${s.employee}_${s.date}`] = s; return Object.values(map) })
                alert(`已複製 ${newSchedules.length} 筆排班`)
              }
            }}>
              📋 複製上週
            </button>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setShowLawModal(true)}>
              <Shield size={14} /> 排班條件
            </button>
            <button className="btn btn-primary" style={{ width: 'auto', padding: '8px 16px', background: 'linear-gradient(135deg, var(--accent-red), var(--accent-orange))' }}
              onClick={handleAutoSchedule} disabled={autoScheduling}>
              <Sparkles size={14} /> {autoScheduling ? 'AI 排班中...' : 'AI 自動排班'}
            </button>
          </div>
        </div>
      </div>

      {/* Store selector + Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>📅</span>
          <select className="form-input" style={{ width: 200, padding: '8px 12px', fontSize: 13 }}
            value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
            <option value="">全部門市</option>
            {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 10, overflow: 'hidden' }}>
          {['班表總覽', '排班條件', '分析報表'].map(tab => (
            <button key={tab} style={{
              padding: '8px 18px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: tab === '班表總覽' ? 'var(--accent-cyan)' : 'var(--bg-card)',
              color: tab === '班表總覽' ? '#fff' : 'var(--text-muted)',
            }}>{tab}</button>
          ))}
        </div>
      </div>

      {/* Week Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
          <ChevronLeft size={16} />
        </button>
        <div style={{ fontSize: 15, fontWeight: 700 }}>
          {weekStart} ~ {weekEnd}
        </div>
        <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => setWeekOffset(0)} style={{ ...btnStyle(weekOffset === 0), marginLeft: 4 }}>本週</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: '28px' }}>門市</span>
        <button style={btnStyle(storeFilter === '')} onClick={() => setStoreFilter('')}>全部</button>
        {locations.map(l => <button key={l.id} style={btnStyle(storeFilter === l.name)} onClick={() => setStoreFilter(l.name)}>{l.name}</button>)}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: '28px' }}>部門</span>
        <button style={btnStyle(deptFilter === '')} onClick={() => setDeptFilter('')}>全部</button>
        {departments.map(d => <button key={d.id} style={btnStyle(deptFilter === d.name)} onClick={() => setDeptFilter(d.name)}>{d.name}</button>)}
      </div>

      {/* Compliance Alerts */}
      {(compliance.errors.length > 0 || compliance.warnings.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          {compliance.errors.map((e, i) => (
            <div key={`e-${i}`} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderRadius: 10, marginBottom: 6,
              background: 'var(--accent-red-dim)', border: '1px solid rgba(248,113,113,0.2)',
            }}>
              <AlertTriangle size={16} style={{ color: 'var(--accent-red)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-red)' }}>違規：{e.law}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{e.message}</div>
              </div>
            </div>
          ))}
          {compliance.warnings.map((w, i) => (
            <div key={`w-${i}`} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderRadius: 10, marginBottom: 6,
              background: 'var(--accent-orange-dim)', border: '1px solid rgba(251,146,60,0.2)',
            }}>
              <Info size={16} style={{ color: 'var(--accent-orange)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-orange)' }}>警告：{w.law}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{w.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {compliance.isValid && schedules.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, marginBottom: 16,
          background: 'var(--accent-green-dim)', border: '1px solid rgba(52,211,153,0.2)',
        }}>
          <Shield size={16} style={{ color: 'var(--accent-green)' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-green)' }}>排班符合勞基法規定</span>
        </div>
      )}

      {/* Stats */}
      {schedules.length > 0 && (() => {
        const weekWork = filtered.map(e => weekDates.filter(d => { const s = getShift(e.name, d); return s && s !== '休' }).length)
        const totalHours = weekWork.reduce((s, d) => s + d * 8, 0)
        const avgHours = filtered.length ? (totalHours / filtered.length).toFixed(1) : 0
        const restDays = filtered.map(e => weekDates.filter(d => getShift(e.name, d) === '休').length)
        const overwork = weekWork.filter(d => d > 6).length
        return (
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">本週總排班時數</div>
              <div className="stat-card-value">{totalHours}h</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">人均週時數</div>
              <div className="stat-card-value">{avgHours}h</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">平均休假天數</div>
              <div className="stat-card-value">{filtered.length ? (restDays.reduce((a, b) => a + b, 0) / filtered.length).toFixed(1) : 0}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': overwork > 0 ? 'var(--accent-red)' : 'var(--accent-green)', '--card-accent-dim': overwork > 0 ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">超時排班人數</div>
              <div className="stat-card-value">{overwork}</div>
            </div>
          </div>
        )
      })()}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {SHIFT_TYPES.map(t => (
          <span key={t.label} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, ...getShiftStyle(t.label) }}>
            {t.label}
          </span>
        ))}
      </div>

      {/* Schedule Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ minWidth: 100 }}>員工</th>
                {weekDates.map((date, i) => (
                  <th key={date} style={{ textAlign: 'center', minWidth: 80 }}>
                    <div>週{DAY_LABELS[i]}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{date.slice(5)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無員工</td></tr>}
              {filtered.map(emp => (
                <tr key={emp.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {emp.position || emp.dept} · {weekDates.filter(d => { const s = getShift(emp.name, d); return s && s !== '休' }).length * 8}h
                    </div>
                  </td>
                  {weekDates.map(date => {
                    const shift = getShift(emp.name, date)
                    const isEditing = editCell?.empName === emp.name && editCell?.date === date
                    return (
                      <td key={date} style={{ textAlign: 'center', padding: '6px 4px', position: 'relative' }}>
                        {isEditing ? (
                          <div style={{
                            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                            zIndex: 50, background: 'var(--bg-card)', border: '1px solid var(--border-strong)',
                            borderRadius: 10, padding: 8, boxShadow: 'var(--shadow-lg)',
                            display: 'flex', flexDirection: 'column', gap: 4, minWidth: 90,
                          }}>
                            {SHIFT_TYPES.map(t => (
                              <button key={t.label} onClick={() => handleSetShift(emp.name, date, t.label)}
                                style={{
                                  padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                                  fontSize: 12, fontWeight: 600, textAlign: 'center',
                                  background: t.dim, color: t.color,
                                }}>
                                {t.label}
                              </button>
                            ))}
                            <button onClick={() => setEditCell(null)} style={{
                              padding: '4px', borderRadius: 6, border: '1px solid var(--border-medium)',
                              background: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
                            }}>取消</button>
                          </div>
                        ) : null}
                        {getOffRequest(emp.name, date) && !shift && (
                          <div style={{ fontSize: 9, color: 'var(--accent-orange)', marginBottom: 2 }}>
                            <CalendarOff size={10} style={{ verticalAlign: -1 }} /> 希望休
                          </div>
                        )}
                        <span
                          onClick={() => setEditCell(isEditing ? null : { empName: emp.name, date })}
                          style={{
                            display: 'inline-block', padding: '4px 12px', borderRadius: 8,
                            fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            transition: 'all 0.15s',
                            ...(shift ? getShiftStyle(shift) : { background: 'var(--glass-light)', color: 'var(--text-muted)', border: '1px dashed var(--border-medium)' }),
                          }}
                        >
                          {shift || '+'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Law Reference Modal */}
      {showLawModal && (
        <Modal title="排班相關法規參照" onClose={() => setShowLawModal(false)} onSubmit={() => setShowLawModal(false)} submitLabel="關閉">
          <div style={{ maxHeight: '65vh', overflowY: 'auto' }}>
            {/* 勞基法 */}
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 700 }}>勞基法</span>
              勞動基準法
            </div>
            {Object.values(LABOR_STANDARDS).map(rule => (
              <div key={rule.law} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{rule.title}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' }}>{rule.law}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{rule.desc}</div>
                {rule.note && <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4 }}>⚠ {rule.note}</div>}
                {rule.detail && (
                  <div style={{ marginTop: 6, paddingLeft: 12 }}>
                    {rule.detail.map((d, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {d}</div>)}
                  </div>
                )}
                {rule.rates && (
                  <div style={{ marginTop: 8, background: 'var(--glass-light)', borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>加班費率：</div>
                    {rule.rates.map((r, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', padding: '2px 0' }}>
                        <span>{r.desc}</span>
                        <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{r.formula}</span>
                      </div>
                    ))}
                  </div>
                )}
                {rule.conditions && (
                  <div style={{ marginTop: 6, paddingLeft: 12 }}>
                    {rule.conditions.map((c, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {c}</div>)}
                  </div>
                )}
                {rule.measures && (
                  <div style={{ marginTop: 6, paddingLeft: 12 }}>
                    {rule.measures.map((m, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {m}</div>)}
                  </div>
                )}
                {rule.holidays2026 && (
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {rule.holidays2026.map(h => (
                      <span key={h.date} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-red-dim)', color: 'var(--accent-red)' }}>
                        {h.date} {h.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* 性平法 */}
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '20px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, background: 'var(--accent-pink-dim)', color: 'var(--accent-pink)', fontWeight: 700 }}>性平法</span>
              性別平等工作法
            </div>
            {Object.values(GENDER_EQUALITY).map(rule => (
              <div key={rule.law} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{rule.title}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-pink-dim)', color: 'var(--accent-pink)' }}>{rule.law}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{rule.desc}</div>
                {rule.impact && <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 4 }}>💡 {rule.impact}</div>}
              </div>
            ))}

            {/* 職安法 */}
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '20px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, background: 'var(--accent-green-dim)', color: 'var(--accent-green)', fontWeight: 700 }}>職安法</span>
              職業安全衛生法
            </div>
            {Object.values(OCCUPATIONAL_SAFETY).map(rule => (
              <div key={rule.law} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{rule.title}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-green-dim)', color: 'var(--accent-green)' }}>{rule.law}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{rule.desc}</div>
                {rule.measures && (
                  <div style={{ marginTop: 6, paddingLeft: 12 }}>
                    {rule.measures.map((m, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {m}</div>)}
                  </div>
                )}
                {rule.prohibitedWork && (
                  <div style={{ marginTop: 6, paddingLeft: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-red)', marginBottom: 4 }}>禁止作業：</div>
                    {rule.prohibitedWork.map((w, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {w}</div>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
