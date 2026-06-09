import { useState, useRef } from 'react'
import ShiftEditPopup from './ShiftEditPopup'
import { isAbsence } from '../../../lib/scheduleUtils'

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function hexToDim(hex) { return hex + '22' }

function getShiftStyle(shiftLabel, shiftDefs) {
  if (!shiftLabel) return {}
  if (isAbsence(shiftLabel)) {
    const map = {
      '例假': { background: 'rgba(220,38,38,0.15)', color: '#dc2626', borderColor: 'rgba(220,38,38,0.3)' },
      '休息': { background: 'var(--glass-medium)', color: 'var(--text-muted)', borderColor: 'var(--border-light)' },
      '補休': { background: 'rgba(59,130,246,0.12)', color: '#3b82f6', borderColor: 'rgba(59,130,246,0.3)' },
      '特休': { background: 'rgba(16,185,129,0.10)', color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' },
      '病': { background: 'rgba(239,68,68,0.10)', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' },
      '會議': { background: 'rgba(139,92,246,0.10)', color: '#8b5cf6', borderColor: 'rgba(139,92,246,0.3)' },
      '產': { background: 'rgba(245,158,11,0.10)', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.3)' },
    }
    return map[shiftLabel] || map['休息']
  }
  const def = shiftDefs.find(d => d.name === shiftLabel)
  if (def?.color) return { background: hexToDim(def.color), color: def.color, borderColor: def.color + '55' }
  return { background: 'rgba(34,211,238,0.12)', color: 'var(--accent-cyan)', borderColor: 'rgba(34,211,238,0.3)' }
}

export default function ScheduleBuilderGrid({
  employees, dates, shiftDefs, storeSettings, assignments,
  handleSetShift, handleDeleteShift,
}) {
  const [editCell, setEditCell] = useState(null)
  const [dragShift, setDragShift] = useState(null)
  const [dragSource, setDragSource] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const dragActiveRef = useRef(false)

  const paletteShifts = shiftDefs.filter(d => d.name)

  const getAssignment = (empName, date) => assignments[`${empName}|${date}`] || null

  const onPaletteDragStart = (shift) => {
    dragActiveRef.current = true
    setDragShift(shift)
    setDragSource(null)
  }

  const onCellDragStart = (e, empName, date) => {
    const asgn = getAssignment(empName, date)
    if (!asgn) { e.preventDefault(); return }
    dragActiveRef.current = true
    setDragShift({ label: asgn.shift, start_time: asgn.actual_start, end_time: asgn.actual_end })
    setDragSource({ empName, date })
  }

  const onCellDragOver = (e, empName, date) => {
    if (!dragActiveRef.current) return
    e.preventDefault()
    setDropTarget(prev =>
      prev?.empName === empName && prev?.date === date ? prev : { empName, date }
    )
  }

  const onCellDrop = (e, targetEmp, targetDate) => {
    e.preventDefault()
    if (!dragShift) return
    if (dragSource && (dragSource.empName !== targetEmp || dragSource.date !== targetDate)) {
      handleDeleteShift(dragSource.empName, dragSource.date)
    }
    handleSetShift(targetEmp, targetDate, dragShift.label, dragShift.start_time || null, dragShift.end_time || null, null)
    setDragShift(null); setDragSource(null); setDropTarget(null)
    dragActiveRef.current = false
  }

  const onDragEnd = () => {
    setDragShift(null); setDragSource(null); setDropTarget(null)
    dragActiveRef.current = false
  }

  const countWork = (empName) => dates.filter(d => {
    const a = getAssignment(empName, d); return a && !isAbsence(a.shift)
  }).length
  const countRest = (empName) => dates.filter(d => {
    const a = getAssignment(empName, d); return a && isAbsence(a.shift)
  }).length

  const staffingByDate = {}
  for (const date of dates) {
    staffingByDate[date] = employees.filter(e => {
      const a = getAssignment(e.name, date); return a && !isAbsence(a.shift)
    }).length
  }

  const editEmp = editCell ? employees.find(e => e.name === editCell.empName) : null
  const editAsgn = editCell ? getAssignment(editCell.empName, editCell.date) : null

  const schedulesList = Object.entries(assignments).map(([key, val]) => {
    const pi = key.lastIndexOf('|')
    return { employee: key.slice(0, pi), date: key.slice(pi + 1), ...val }
  })

  return (
    <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start' }}>

      {/* ── Palette ── */}
      <div style={{
        width: 148, flexShrink: 0, background: 'var(--bg-card)',
        borderRadius: 12, border: '1px solid var(--border-medium)',
        padding: 12, marginRight: 12,
        display: 'flex', flexDirection: 'column', gap: 6,
        position: 'sticky', top: 80,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 2 }}>拖曳排班</div>

        {paletteShifts.map(shift => (
          <div
            key={shift.id}
            draggable
            onDragStart={() => onPaletteDragStart({ label: shift.name, start_time: shift.start_time, end_time: shift.end_time })}
            onDragEnd={onDragEnd}
            style={{
              padding: '8px 10px', borderRadius: 8, cursor: 'grab', userSelect: 'none',
              border: `1px solid ${shift.color ? shift.color + '55' : 'var(--border-medium)'}`,
              background: shift.color ? hexToDim(shift.color) : 'var(--bg-secondary)',
              color: shift.color || 'var(--text-secondary)',
              fontSize: 12, fontWeight: 700,
            }}
          >
            <div>{shift.name}</div>
            {(shift.start_time || shift.end_time) && (
              <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.75, marginTop: 1 }}>
                {shift.start_time?.slice(0, 5)}~{shift.end_time?.slice(0, 5)}
              </div>
            )}
          </div>
        ))}

        {paletteShifts.length === 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.5 }}>
            尚未設定班別<br />請到門市設定新增
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8, marginTop: 2 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }}>休假</div>
          {[
            { label: '例假', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
            { label: '休息', color: 'var(--text-muted)', bg: 'var(--glass-medium)' },
            { label: '特休', color: '#10b981', bg: 'rgba(16,185,129,0.10)' },
            { label: '補休', color: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
          ].map(a => (
            <div
              key={a.label}
              draggable
              onDragStart={() => onPaletteDragStart({ label: a.label, start_time: null, end_time: null })}
              onDragEnd={onDragEnd}
              style={{
                padding: '7px 10px', borderRadius: 8, cursor: 'grab', userSelect: 'none',
                background: a.bg, color: a.color, fontSize: 12, fontWeight: 700, marginBottom: 4,
              }}
            >
              {a.label}
            </div>
          ))}
        </div>
      </div>

      {/* ── Grid ── */}
      <div style={{ flex: 1, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thEmp}>員工</th>
              {dates.map(date => {
                const dow = new Date(date).getDay()
                const isWeekend = dow === 0 || dow === 6
                const staffCount = staffingByDate[date]
                const minStaff = isWeekend
                  ? (storeSettings?.min_staff_weekend || 0)
                  : (storeSettings?.min_staff || 0)
                const understaffed = minStaff > 0 && staffCount < minStaff
                return (
                  <th key={date} style={{
                    ...thDate,
                    color: isWeekend ? 'var(--accent-orange)' : 'var(--text-muted)',
                  }}>
                    <div style={{ fontWeight: 700 }}>{date.slice(8)}</div>
                    <div style={{ fontSize: 9 }}>{DAY_LABELS[dow]}</div>
                    <div style={{
                      marginTop: 2, fontSize: 9, fontWeight: 700,
                      color: understaffed ? 'var(--accent-red)' : staffCount > 0 ? 'var(--accent-green)' : 'transparent',
                    }}>
                      {staffCount || 0}人
                    </div>
                  </th>
                )
              })}
              <th style={thSummary}>出/休</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp, ri) => {
              const rowBg = ri % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)'
              return (
                <tr key={emp.id}>
                  <td style={{ ...tdEmp, background: rowBg }}>
                    <div>{emp.name}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{emp.employment_type}</div>
                  </td>

                  {dates.map(date => {
                    const asgn = getAssignment(emp.name, date)
                    const shift = asgn?.shift
                    const isEditing = editCell?.empName === emp.name && editCell?.date === date
                    const isDropOver = dropTarget?.empName === emp.name && dropTarget?.date === date
                    const isDragSrc = dragSource?.empName === emp.name && dragSource?.date === date
                    const dow = new Date(date).getDay()
                    const isWeekend = dow === 0 || dow === 6
                    const style = shift ? getShiftStyle(shift, shiftDefs) : {}

                    return (
                      <td
                        key={date}
                        draggable={!!shift}
                        onDragStart={(e) => onCellDragStart(e, emp.name, date)}
                        onDragOver={(e) => onCellDragOver(e, emp.name, date)}
                        onDrop={(e) => onCellDrop(e, emp.name, date)}
                        onDragEnd={onDragEnd}
                        onDragLeave={() => setDropTarget(prev =>
                          prev?.empName === emp.name && prev?.date === date ? null : prev
                        )}
                        onClick={() => !dragActiveRef.current && setEditCell({ empName: emp.name, date })}
                        style={{
                          padding: '3px 2px', textAlign: 'center',
                          borderBottom: '1px solid var(--border-light)',
                          cursor: 'pointer', minWidth: 44, height: 48, verticalAlign: 'middle',
                          position: 'relative',
                          background: isDropOver
                            ? 'rgba(34,211,238,0.18)'
                            : isDragSrc
                              ? 'rgba(34,211,238,0.08)'
                              : isWeekend
                                ? 'rgba(245,158,11,0.03)'
                                : rowBg,
                          outline: isDropOver ? '2px solid var(--accent-cyan)' : 'none',
                          outlineOffset: -2,
                          opacity: isDragSrc ? 0.45 : 1,
                        }}
                      >
                        {shift ? (
                          <div style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            flexDirection: 'column',
                            padding: '3px 6px', borderRadius: 7, fontSize: 11, fontWeight: 700,
                            border: `1px solid ${style.borderColor || 'transparent'}`,
                            background: style.background, color: style.color,
                            minWidth: 34, lineHeight: 1.2, cursor: 'grab',
                          }}>
                            {(() => {
                              // Resolve named shift to HH:MM~HH:MM via shiftDefs
                              let label = shift
                              if (!/^\d{1,2}:\d{2}~\d{1,2}:\d{2}$/.test(label)) {
                                const def = shiftDefs.find(d => d.name === shift)
                                if (def?.start_time && def?.end_time) {
                                  label = `${def.start_time.slice(0, 5)}~${def.end_time.slice(0, 5)}`
                                }
                              }
                              return /~/.test(label) ? (
                                <>
                                  <span style={{ fontSize: 9 }}>{label.split('~')[0]}</span>
                                  <span style={{ fontSize: 9 }}>{label.split('~')[1]}</span>
                                </>
                              ) : label
                            })()}
                          </div>
                        ) : (
                          <div style={{
                            width: 30, height: 30, margin: '0 auto', borderRadius: 7,
                            border: '1px dashed var(--border-light)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: isDropOver ? 'var(--accent-cyan)' : 'var(--border-medium)',
                            fontSize: 16, opacity: 0.6,
                          }}>
                            {isDropOver ? '↓' : '+'}
                          </div>
                        )}

                        {isEditing && editEmp && (
                          <ShiftEditPopup
                            emp={editEmp}
                            date={date}
                            shift={shift}
                            storeSettings={storeSettings}
                            schedules={schedulesList}
                            currentSchedule={editAsgn ? { ...editAsgn, employee: emp.name, date } : null}
                            handleSetShift={handleSetShift}
                            handleDeleteShift={handleDeleteShift}
                            onClose={() => setEditCell(null)}
                          />
                        )}
                      </td>
                    )
                  })}

                  <td style={{ ...tdSummary, background: rowBg }}>
                    <span style={{ color: 'var(--accent-cyan)' }}>{countWork(emp.name)}</span>
                    <span style={{ color: 'var(--text-muted)' }}>/</span>
                    <span style={{ color: 'var(--text-muted)' }}>{countRest(emp.name)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const thEmp = {
  position: 'sticky', left: 0, zIndex: 4, background: 'var(--bg-card)',
  padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border-medium)', borderRight: '1px solid var(--border-medium)',
  minWidth: 84, whiteSpace: 'nowrap',
}
const thDate = {
  padding: '5px 2px', textAlign: 'center', fontSize: 10, minWidth: 44,
  borderBottom: '1px solid var(--border-medium)',
  background: 'var(--bg-card)', position: 'sticky', top: 0, zIndex: 3,
}
const thSummary = {
  padding: '5px 8px', textAlign: 'center', fontSize: 10, color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border-medium)', background: 'var(--bg-card)',
  position: 'sticky', top: 0, right: 0, zIndex: 4,
}
const tdEmp = {
  position: 'sticky', left: 0, zIndex: 2,
  padding: '6px 10px', fontWeight: 600, color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border-light)', borderRight: '1px solid var(--border-medium)',
  whiteSpace: 'nowrap',
}
const tdSummary = {
  position: 'sticky', right: 0, zIndex: 2,
  padding: '4px 8px', textAlign: 'center',
  borderBottom: '1px solid var(--border-light)', borderLeft: '1px solid var(--border-medium)',
  fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
}
