import { useState } from 'react'
import ShiftEditPopup from './ShiftEditPopup'
import { isAbsence } from '../../../lib/scheduleUtils'

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function hexToDim(hex) { return hex + '22' }

function getShiftColor(shiftLabel, shiftDefs) {
  if (!shiftLabel || isAbsence(shiftLabel)) return null
  return shiftDefs.find(d => d.name === shiftLabel)?.color || null
}

function groupByShift(employees, date, assignments, shiftDefs) {
  const groups = {}
  for (const emp of employees) {
    const asgn = assignments[`${emp.name}|${date}`]
    if (!asgn) continue
    const { shift } = asgn
    if (!groups[shift]) {
      groups[shift] = {
        shift, employees: [],
        color: getShiftColor(shift, shiftDefs),
        isAbsence: isAbsence(shift),
      }
    }
    groups[shift].employees.push(emp)
  }
  return Object.values(groups).sort((a, b) => a.isAbsence ? 1 : b.isAbsence ? -1 : a.shift.localeCompare(b.shift))
}

export default function ScheduleBuilderCalendar({
  employees, dates, shiftDefs, assignments, storeSettings,
  handleSetShift, handleDeleteShift,
  calendarSubView, setCalendarSubView,
}) {
  const [editCell, setEditCell] = useState(null)
  const [expandedDay, setExpandedDay] = useState(null)
  const [weekOffset, setWeekOffset] = useState(0)

  const getAssignment = (empName, date) => assignments[`${empName}|${date}`] || null

  const editEmp = editCell ? employees.find(e => e.name === editCell.empName) : null
  const editAsgn = editCell ? getAssignment(editCell.empName, editCell.date) : null

  const schedulesList = Object.entries(assignments).map(([key, val]) => {
    const pi = key.lastIndexOf('|')
    return { employee: key.slice(0, pi), date: key.slice(pi + 1), ...val }
  })

  // Build week buckets for weekly nav
  const allWeeks = (() => {
    if (!dates.length) return []
    const seen = new Set()
    const weeks = []
    for (const date of dates) {
      const d = new Date(date + 'T00:00:00')
      const dow = d.getDay()
      const monday = new Date(d)
      monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
      const key = monday.toISOString().slice(0, 10)
      if (seen.has(key)) continue
      seen.add(key)
      const week = []
      for (let j = 0; j < 7; j++) {
        const wd = new Date(monday)
        wd.setDate(monday.getDate() + j)
        week.push(wd.toISOString().slice(0, 10))
      }
      weeks.push(week)
    }
    return weeks
  })()

  const safeWeekOffset = Math.min(weekOffset, allWeeks.length - 1)
  const currentWeekDays = allWeeks[safeWeekOffset] || []
  const currentWeekInRange = currentWeekDays.filter(d => dates.includes(d))

  // ── Month view ──
  const renderMonthView = () => {
    if (!dates.length) return null

    const firstDate = new Date(dates[0] + 'T00:00:00')
    const lastDate = new Date(dates[dates.length - 1] + 'T00:00:00')

    const startDow = firstDate.getDay()
    const calStart = new Date(firstDate)
    calStart.setDate(calStart.getDate() - startDow)

    const endDow = lastDate.getDay()
    const calEnd = new Date(lastDate)
    calEnd.setDate(calEnd.getDate() + (6 - endDow))

    const calDays = []
    const iter = new Date(calStart)
    while (iter <= calEnd) {
      calDays.push(iter.toISOString().slice(0, 10))
      iter.setDate(iter.getDate() + 1)
    }

    const weeks = []
    for (let i = 0; i < calDays.length; i += 7) weeks.push(calDays.slice(i, i + 7))

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
          {DAY_LABELS.map((d, i) => (
            <div key={d} style={{
              textAlign: 'center', fontSize: 11, fontWeight: 700, padding: '4px 0',
              color: i === 0 || i === 6 ? 'var(--accent-orange)' : 'var(--text-muted)',
            }}>{d}</div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {week.map(date => {
                const inRange = dates.includes(date)
                const dow = new Date(date).getDay()
                const isWeekend = dow === 0 || dow === 6
                const isExpanded = expandedDay === date
                const groups = inRange ? groupByShift(employees, date, assignments, shiftDefs) : []
                const workCount = groups.filter(g => !g.isAbsence).reduce((s, g) => s + g.employees.length, 0)
                const minStaff = isWeekend
                  ? (storeSettings?.min_staff_weekend || 0)
                  : (storeSettings?.min_staff || 0)
                const understaffed = minStaff > 0 && workCount < minStaff

                return (
                  <div
                    key={date}
                    onClick={() => inRange && setExpandedDay(isExpanded ? null : date)}
                    style={{
                      minHeight: 76, borderRadius: 10, padding: '6px 7px',
                      border: `1px solid ${isExpanded ? 'var(--accent-cyan)' : inRange ? 'var(--border-medium)' : 'transparent'}`,
                      background: inRange
                        ? isExpanded ? 'rgba(34,211,238,0.07)' : 'var(--bg-card)'
                        : 'transparent',
                      cursor: inRange ? 'pointer' : 'default',
                      opacity: inRange ? 1 : 0.2,
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{
                        fontSize: 13, fontWeight: 700,
                        color: isWeekend ? 'var(--accent-orange)' : 'var(--text-primary)',
                      }}>{date.slice(8)}</span>
                      {inRange && workCount > 0 && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 5,
                          background: understaffed ? 'rgba(239,68,68,0.15)' : 'rgba(34,211,238,0.12)',
                          color: understaffed ? 'var(--accent-red)' : 'var(--accent-cyan)',
                        }}>{workCount}人</span>
                      )}
                    </div>

                    {inRange && groups.slice(0, 3).map(g => (
                      <div key={g.shift} style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 4, flexShrink: 0,
                          background: g.isAbsence ? 'var(--glass-medium)' : g.color ? hexToDim(g.color) : 'rgba(34,211,238,0.12)',
                          color: g.isAbsence ? 'var(--text-muted)' : g.color || 'var(--accent-cyan)',
                        }}>{g.shift}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.2 }}>
                          {g.employees.slice(0, 2).map(e => e.name).join('、')}
                          {g.employees.length > 2 ? `+${g.employees.length - 2}` : ''}
                        </span>
                      </div>
                    ))}
                    {inRange && groups.length > 3 && (
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>+{groups.length - 3} 更多</div>
                    )}
                    {inRange && groups.length === 0 && (
                      <div style={{ fontSize: 9, color: 'var(--border-medium)', marginTop: 2 }}>未排班</div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Expanded day detail */}
        {expandedDay && dates.includes(expandedDay) && (
          <div style={{
            marginTop: 16, background: 'var(--bg-card)', borderRadius: 14,
            border: '1px solid var(--accent-cyan)', padding: 20,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                {expandedDay}（{DAY_LABELS[new Date(expandedDay).getDay()]}）
              </div>
              <button onClick={() => setExpandedDay(null)} style={{
                width: 28, height: 28, borderRadius: 7, border: '1px solid var(--border-medium)',
                background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14,
              }}>✕</button>
            </div>

            {groupByShift(employees, expandedDay, assignments, shiftDefs).map(g => (
              <div key={g.shift} style={{ marginBottom: 12 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, display: 'inline-block', marginBottom: 6,
                  background: g.isAbsence ? 'var(--glass-medium)' : g.color ? hexToDim(g.color) : 'rgba(34,211,238,0.12)',
                  color: g.isAbsence ? 'var(--text-muted)' : g.color || 'var(--accent-cyan)',
                }}>{g.shift} · {g.employees.length}人</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {g.employees.map(e => (
                    <button key={e.name}
                      onClick={(ev) => { ev.stopPropagation(); setEditCell({ empName: e.name, date: expandedDay }) }}
                      style={{
                        padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                        border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                      }}>
                      {e.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Unassigned employees */}
            {(() => {
              const assignedNames = new Set(
                groupByShift(employees, expandedDay, assignments, shiftDefs).flatMap(g => g.employees.map(e => e.name))
              )
              const unassigned = employees.filter(e => !assignedNames.has(e.name))
              if (!unassigned.length) return null
              return (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>尚未排班</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {unassigned.map(e => (
                      <button key={e.name}
                        onClick={(ev) => { ev.stopPropagation(); setEditCell({ empName: e.name, date: expandedDay }) }}
                        style={{
                          padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                          border: '1px dashed var(--border-medium)', background: 'transparent',
                          color: 'var(--text-muted)',
                        }}>
                        {e.name} +
                      </button>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>
    )
  }

  // ── Week view ──
  const renderWeekView = () => {
    const allShiftLabels = new Set()
    for (const date of currentWeekInRange) {
      for (const emp of employees) {
        const a = getAssignment(emp.name, date)
        if (a) allShiftLabels.add(a.shift)
      }
    }
    const shiftRows = Array.from(allShiftLabels).sort((a, b) =>
      isAbsence(a) ? 1 : isAbsence(b) ? -1 : a.localeCompare(b)
    )

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <button className="btn btn-secondary" style={{ padding: '5px 12px', fontSize: 12 }}
            disabled={safeWeekOffset <= 0} onClick={() => setWeekOffset(w => Math.max(0, w - 1))}>◀</button>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {currentWeekDays[0]?.slice(5)} ~ {currentWeekDays[6]?.slice(5)}
          </div>
          <button className="btn btn-secondary" style={{ padding: '5px 12px', fontSize: 12 }}
            disabled={safeWeekOffset >= allWeeks.length - 1} onClick={() => setWeekOffset(w => Math.min(allWeeks.length - 1, w + 1))}>▶</button>
        </div>

        {shiftRows.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>本週尚無排班</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...thBase, minWidth: 80, textAlign: 'left', paddingLeft: 10 }}>班別</th>
                  {currentWeekDays.map(date => {
                    const dow = new Date(date).getDay()
                    const isWeekend = dow === 0 || dow === 6
                    const inRange = dates.includes(date)
                    return (
                      <th key={date} style={{
                        ...thBase,
                        color: isWeekend ? 'var(--accent-orange)' : 'var(--text-muted)',
                        opacity: inRange ? 1 : 0.3,
                      }}>
                        <div style={{ fontWeight: 700 }}>{date.slice(8)}</div>
                        <div style={{ fontSize: 9 }}>{DAY_LABELS[dow]}</div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {shiftRows.map((shift, ri) => {
                  const color = getShiftColor(shift, shiftDefs)
                  const absence = isAbsence(shift)
                  return (
                    <tr key={shift} style={{ background: ri % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-light)' }}>
                        <div style={{
                          padding: '3px 8px', borderRadius: 6, display: 'inline-block', fontSize: 11, fontWeight: 700,
                          background: absence ? 'var(--glass-medium)' : color ? hexToDim(color) : 'rgba(34,211,238,0.12)',
                          color: absence ? 'var(--text-muted)' : color || 'var(--accent-cyan)',
                        }}>{shift}</div>
                      </td>
                      {currentWeekDays.map(date => {
                        const inRange = dates.includes(date)
                        const empsOnShift = inRange
                          ? employees.filter(e => getAssignment(e.name, date)?.shift === shift)
                          : []
                        return (
                          <td key={date} style={{
                            padding: '6px', borderBottom: '1px solid var(--border-light)',
                            verticalAlign: 'top', opacity: inRange ? 1 : 0.2,
                          }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {empsOnShift.map(e => (
                                <button key={e.name}
                                  onClick={() => inRange && setEditCell({ empName: e.name, date })}
                                  style={{
                                    padding: '4px 8px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                                    border: `1px solid ${color ? color + '55' : 'var(--border-medium)'}`,
                                    background: color ? hexToDim(color) : 'var(--bg-card)',
                                    color: color || 'var(--text-primary)', textAlign: 'left',
                                  }}>
                                  {e.name}
                                </button>
                              ))}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Sub-view toggle */}
      <div style={{
        display: 'flex', gap: 0, border: '1px solid var(--border-medium)',
        borderRadius: 8, overflow: 'hidden', marginBottom: 16, width: 'fit-content',
      }}>
        {[{ k: 'month', l: '月曆' }, { k: 'week', l: '週曆' }].map(v => (
          <button key={v.k} onClick={() => setCalendarSubView(v.k)} style={{
            padding: '7px 18px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: calendarSubView === v.k ? 'var(--accent-purple)' : 'var(--bg-card)',
            color: calendarSubView === v.k ? '#fff' : 'var(--text-muted)',
          }}>{v.l}</button>
        ))}
      </div>

      {calendarSubView === 'month' ? renderMonthView() : renderWeekView()}

      {/* Shared edit popup */}
      {editCell && editEmp && (
        <ShiftEditPopup
          emp={editEmp}
          date={editCell.date}
          shift={editAsgn?.shift}
          storeSettings={storeSettings}
          schedules={schedulesList}
          currentSchedule={editAsgn ? { ...editAsgn, employee: editEmp.name, date: editCell.date } : null}
          handleSetShift={handleSetShift}
          handleDeleteShift={handleDeleteShift}
          onClose={() => setEditCell(null)}
        />
      )}
    </div>
  )
}

const thBase = {
  padding: '8px 8px', textAlign: 'center', fontSize: 11,
  borderBottom: '1px solid var(--border-medium)',
  background: 'var(--bg-card)', fontWeight: 700,
}
