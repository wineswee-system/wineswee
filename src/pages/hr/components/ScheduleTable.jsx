import { ChevronLeft, ChevronRight, CalendarOff, AlertTriangle, Shield, Info } from 'lucide-react'
import { getShiftHours } from '../../../lib/scheduleUtils'

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export default function ScheduleTable({
  weekDates, weekStart, weekEnd, weekOffset, setWeekOffset,
  filtered, deptFilter, setDeptFilter, departments,
  schedules, getShift, getShiftStyle, getOffRequest,
  editCell, setEditCell, handleSetShift,
  handleDeleteShift, canEditSchedule = true,
  SHIFT_TYPES, shiftDefs, getStoreShifts, storeFilter,
  compliance, holidaySet,
  setCoverModal, findCoverCandidates,
}) {
  const btnStyle = (active) => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500,
  })

  return (
    <>
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

      {/* Compact filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>部門</span>
          <select className="form-input" style={{ width: 160, padding: '6px 10px', fontSize: 13 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">全部部門</option>
            {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          篩選結果：{filtered.length} 人
        </div>
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
                {weekDates.map((date, i) => {
                  const isHoliday = holidaySet.has(date)
                  return (
                    <th key={date} style={{ textAlign: 'center', minWidth: 80, background: isHoliday ? 'var(--accent-red-dim)' : undefined }}>
                      <div>週{DAY_LABELS[i]}</div>
                      <div style={{ fontSize: 11, color: isHoliday ? 'var(--accent-red)' : 'var(--text-muted)', fontWeight: isHoliday ? 600 : 400 }}>
                        {date.slice(5)}{isHoliday ? ' 🎌' : ''}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無員工</td></tr>}
              {filtered.map(emp => (
                <tr key={emp.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {emp.position || emp.dept} · {(() => {
                        let h = 0
                        weekDates.forEach(d => {
                          const s = schedules.find(x => x.employee === emp.name && x.date === d)
                          if (s?.actual_hours) h += s.actual_hours
                          else if (s?.shift && s.shift !== '休') {
                            const def = shiftDefs.find(sd => sd.name === s.shift)
                            h += def ? getShiftHours(def) - (def.break_minutes || 60) / 60 : 8
                          }
                        })
                        return Math.round(h)
                      })()}h
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
                            {(() => {
                              const empStore = emp.store || storeFilter || ''
                              const isPT = emp.position?.includes('PT') || emp.employment_type === 'PT'
                              const storeShiftDefs = getStoreShifts(empStore, isPT ? 'pt' : 'full_time')
                              const storeShiftLabels = storeShiftDefs.map(d => d.name)
                              const shiftOptions = SHIFT_TYPES.filter(t => t.label === '休' || storeShiftLabels.includes(t.label) || storeShiftDefs.length === 0)
                              return shiftOptions.map(t => (
                                <button key={t.label} onClick={() => handleSetShift(emp.name, date, t.label)}
                                  style={{
                                    padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                                    fontSize: 12, fontWeight: 600, textAlign: 'center',
                                    background: t.dim, color: t.color,
                                  }}>
                                  {t.label}
                                </button>
                              ))
                            })()}
                            {shift && handleDeleteShift && (
                              <button onClick={() => handleDeleteShift(emp.name, date)} style={{
                                padding: '4px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.3)',
                                background: 'var(--accent-red-dim)', color: 'var(--accent-red)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                              }}>刪除</button>
                            )}
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
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                          <span
                            onClick={() => canEditSchedule && setEditCell(isEditing ? null : { empName: emp.name, date })}
                            style={{
                              display: 'inline-block', padding: '4px 12px', borderRadius: 8,
                              fontSize: 12, fontWeight: 600, cursor: canEditSchedule ? 'pointer' : 'default',
                              transition: 'all 0.15s',
                              ...(shift ? getShiftStyle(shift) : { background: 'var(--glass-light)', color: 'var(--text-muted)', border: '1px dashed var(--border-medium)' }),
                            }}
                          >
                            {shift || '+'}
                          </span>
                          {shift && shift !== '休' && (() => {
                            const sched = schedules.find(x => x.employee === emp.name && x.date === date)
                            const def = shiftDefs.find(d => d.name === shift)
                            const startT = sched?.actual_start?.slice(0, 5) || def?.start_time?.slice(0, 5)
                            const endT = sched?.actual_end?.slice(0, 5) || def?.end_time?.slice(0, 5)
                            return startT && endT ? (
                              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1, fontFamily: 'monospace' }}>
                                {startT}~{endT}
                              </div>
                            ) : null
                          })()}
                          {shift && shift !== '休' && (
                            <button title="找人代班" onClick={e => {
                              e.stopPropagation()
                              setCoverModal({ employee: emp.name, date, shift })
                              findCoverCandidates(emp.name, date, shift)
                            }} style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'var(--text-muted)', fontSize: 10, padding: 1, opacity: 0.4, lineHeight: 1,
                            }}>🔄</button>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
