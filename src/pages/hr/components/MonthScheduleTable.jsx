import { useState } from 'react'
import { ModalOverlay } from '../../../components/Modal'
import { createPortal } from 'react-dom'
import { parseTime } from '../../../lib/scheduleUtils'
import { getDayLabel, isAbsence, getAbsenceConfig, getAbsenceOptions, isWeekendDay } from '../../../lib/scheduleUtils'

export default function MonthScheduleTable({
  monthDates,
  filtered,
  employees,
  locations,
  schedules,
  shiftDefs,
  SHIFT_TYPES,
  getShift,
  getShiftStyle,
  getOffRequest,
  editCell,
  setEditCell,
  handleSetShift,
  handleDeleteShift,
  canEditSchedule = true,
  getStoreShifts,
  storeFilter,
  holidaySet,
  deptFilter,
  setDeptFilter,
  departments,
  storeSettings,
}) {
  // Group employees by store when no store filter.
  // 沒分配門市的員工（store = null/空）集中到「未分配門市」群組，避免被吃掉看不到。
  const UNASSIGNED_LABEL = '未分配門市'
  const storeGroups = !storeFilter
    ? (() => {
        const named = [...new Set(employees.map(e => e.store).filter(Boolean))].sort()
        const hasUnassigned = employees.some(e => !e.store)
        return hasUnassigned ? [...named, UNASSIGNED_LABEL] : named
      })()
    : null

  const absenceOptions = getAbsenceOptions()

  // Compute stats
  const totalWorkDays = filtered.reduce((sum, emp) => {
    return sum + monthDates.filter(d => {
      const s = getShift(emp.name, d)
      return s && !isAbsence(s)
    }).length
  }, 0)
  const avgRestDays = filtered.length
    ? (filtered.reduce((sum, emp) => sum + monthDates.filter(d => { const s = getShift(emp.name, d); return isAbsence(s) }).length, 0) / filtered.length).toFixed(1)
    : 0

  return (
    <>
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
          篩選結果：{filtered.length} 人 · 月出勤 {totalWorkDays} 天 · 人均休假 {avgRestDays} 天
        </div>
      </div>

      {/* Shift Legend — simplified when viewing all stores */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {storeFilter ? (
          // Single store: show only that store's shifts (deduplicated)
          getStoreShifts(storeFilter).map(d => (
            <span key={d.id} style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, ...getShiftStyle(d.name) }}>
              {d.name}
            </span>
          ))
        ) : (
          // All stores: just show a generic "work shift" chip
          <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
            background: 'rgba(34,211,238,0.10)', color: 'var(--accent-cyan)', border: '1px solid rgba(34,211,238,0.18)' }}>
            工作班
          </span>
        )}
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>|</span>
        {absenceOptions.map(a => (
          <span key={a.value} style={{ fontSize: 10, color: getAbsenceConfig(a.value)?.color || '#666' }}>
            {a.icon}{a.label}
          </span>
        ))}
      </div>

      {/* Monthly Grid Table */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, width: 'max-content', minWidth: '100%' }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-card)' }}>
                <th style={{
                  position: 'sticky', left: 0, zIndex: 11, background: 'var(--bg-card)',
                  padding: '6px 10px', textAlign: 'left', minWidth: 110, borderBottom: '2px solid var(--border-medium)',
                  fontSize: 12, fontWeight: 700,
                }}>
                  員工
                </th>
                {monthDates.map(date => {
                  const dow = getDayLabel(date)
                  const dayNum = parseInt(date.slice(8))
                  const dayOfWeek = new Date(date).getDay()
                  const isWeekend = isWeekendDay(dayOfWeek)
                  const isHoliday = holidaySet?.has(date)
                  return (
                    <th key={date} style={{
                      textAlign: 'center', padding: '4px 1px', minWidth: 36, maxWidth: 42,
                      borderBottom: '2px solid var(--border-medium)',
                      background: isHoliday ? 'rgba(239,68,68,0.08)' : isWeekend ? 'rgba(99,102,241,0.05)' : undefined,
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: isHoliday ? 'var(--accent-red)' : isWeekend ? '#818cf8' : 'var(--text-primary)' }}>
                        {dayNum}
                      </div>
                      <div style={{ fontSize: 9, color: isHoliday ? 'var(--accent-red)' : isWeekend ? '#818cf8' : 'var(--text-muted)' }}>
                        {dow}
                      </div>
                    </th>
                  )
                })}
                <th style={{
                  position: 'sticky', right: 0, zIndex: 11, background: 'var(--bg-card)',
                  padding: '6px 8px', textAlign: 'center', minWidth: 50,
                  borderBottom: '2px solid var(--border-medium)', fontSize: 10, fontWeight: 700,
                }}>
                  出勤/休
                </th>
              </tr>
            </thead>
            <tbody>
              {storeGroups && !storeFilter ? (
                // Grouped by store
                storeGroups.map(store => {
                  const storeEmps = store === UNASSIGNED_LABEL
                    ? filtered.filter(e => !e.store)
                    : filtered.filter(e => e.store === store)
                  if (storeEmps.length === 0) return null
                  return (
                    <StoreSection
                      key={store}
                      storeName={store}
                      storeEmps={storeEmps}
                      monthDates={monthDates}
                      getShift={getShift}
                      getShiftStyle={getShiftStyle}
                      getOffRequest={getOffRequest}
                      editCell={editCell}
                      setEditCell={setEditCell}
                      handleSetShift={handleSetShift}
                      handleDeleteShift={handleDeleteShift}
                      canEditSchedule={canEditSchedule}
                      SHIFT_TYPES={SHIFT_TYPES}
                      getStoreShifts={getStoreShifts}
                      storeFilter={store}
                      holidaySet={holidaySet}
                    />
                  )
                })
              ) : (
                // Flat list (single store or filtered)
                filtered.map(emp => (
                  <EmployeeRow
                    key={emp.id}
                    emp={emp}
                    monthDates={monthDates}
                    getShift={getShift}
                    getShiftStyle={getShiftStyle}
                    getOffRequest={getOffRequest}
                    editCell={editCell}
                    setEditCell={setEditCell}
                    handleSetShift={handleSetShift}
                    handleDeleteShift={handleDeleteShift}
                    canEditSchedule={canEditSchedule}
                    SHIFT_TYPES={SHIFT_TYPES}
                    getStoreShifts={getStoreShifts}
                    storeFilter={storeFilter}
                    holidaySet={holidaySet}
                    storeSettings={storeSettings}
                  />
                ))
              )}
              {filtered.length === 0 && (
                <tr><td colSpan={monthDates.length + 2} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>無員工資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── Store Section (group header + employee rows) ──
function StoreSection({ storeName, storeEmps, monthDates, ...rest }) {
  return (
    <>
      <tr>
        <td colSpan={monthDates.length + 2} style={{
          padding: '8px 10px', fontWeight: 700, fontSize: 13,
          background: 'var(--glass-medium)', color: 'var(--accent-cyan)',
          borderTop: '2px solid var(--border-medium)',
        }}>
          🏪 {storeName} ({storeEmps.length} 人)
        </td>
      </tr>
      {storeEmps.map(emp => (
        <EmployeeRow key={emp.id} emp={emp} monthDates={monthDates} {...rest} />
      ))}
    </>
  )
}

// ── Employee Row ──
function EmployeeRow({
  emp, monthDates, getShift, getShiftStyle, getOffRequest,
  editCell, setEditCell, handleSetShift, handleDeleteShift,
  canEditSchedule, SHIFT_TYPES, getStoreShifts, storeFilter, holidaySet, storeSettings,
}) {
  let workDays = 0
  let restDays = 0
  for (const d of monthDates) {
    const s = getShift(emp.name, d)
    if (s && !isAbsence(s)) workDays++
    else if (isAbsence(s)) restDays++
  }

  const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT' || emp.position?.includes('PT')

  return (
    <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
      <td style={{
        position: 'sticky', left: 0, zIndex: 5, background: 'var(--bg-card)',
        padding: '4px 8px', borderRight: '1px solid var(--border-light)',
      }}>
        <div style={{ fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
          {emp.name}{isPT && <span style={{ fontSize: 9, color: '#818cf8', marginLeft: 2 }}>(PT)</span>}
        </div>
      </td>
      {monthDates.map(date => {
        const shift = getShift(emp.name, date)
        const offReq = getOffRequest(emp.name, date)
        const dayOfWeek = new Date(date).getDay()
        const isWeekend = isWeekendDay(dayOfWeek)
        const isHoliday = holidaySet?.has(date)
        const isEditing = editCell?.empName === emp.name && editCell?.date === date
        const isRest = isAbsence(shift)
        const absenceCfg = isRest ? getAbsenceConfig(shift) : null

        return (
          <td key={date} style={{
            textAlign: 'center', padding: '2px 1px', position: 'relative',
            background: isHoliday ? 'rgba(239,68,68,0.05)' : isWeekend ? 'rgba(99,102,241,0.03)' : undefined,
            cursor: canEditSchedule ? 'pointer' : 'default',
          }}
          onClick={() => {
            if (canEditSchedule && !isEditing) setEditCell({ empName: emp.name, date })
          }}>
            {/* Cell Content */}
            {isRest ? (
              <span style={{
                display: 'inline-block', padding: '1px 3px', borderRadius: 3,
                fontSize: 9, fontWeight: 600,
                color: absenceCfg?.color || 'var(--text-muted)',
                background: (absenceCfg?.color || '#6b7280') + '15',
              }}>
                {shift}
              </span>
            ) : shift ? (
              // 班別名是時段範圍（10:30-19:30）→ 上下分兩行顯示，省寬度但保留完整資訊
              /^(\d{1,2}:?\d{0,2})\s*[-~]\s*(\d{1,2}:?\d{0,2})$/.test(shift) ? (
                <span style={{
                  display: 'inline-block', padding: '1px 2px', borderRadius: 3,
                  fontSize: 9, fontWeight: 600, lineHeight: 1.15,
                  ...getShiftStyle(shift),
                }}>
                  <div>{shift.split(/[-~]/)[0].trim()}</div>
                  <div>{shift.split(/[-~]/)[1].trim()}</div>
                </span>
              ) : (
                <span style={{
                  display: 'inline-block', padding: '1px 3px', borderRadius: 3,
                  fontSize: 9, fontWeight: 600, ...getShiftStyle(shift),
                  whiteSpace: 'nowrap',
                }}>
                  {shift}
                </span>
              )
            ) : offReq ? (
              <span style={{ fontSize: 9, color: 'var(--accent-orange)' }}>申</span>
            ) : (
              <span style={{ fontSize: 9, color: 'var(--border-medium)' }}>·</span>
            )}

            {/* Fixed Editor Popup */}
            {isEditing && (
              <MonthEditPopup
                emp={emp} date={date} shift={shift}
                storeSettings={storeSettings}
                handleSetShift={handleSetShift} handleDeleteShift={handleDeleteShift}
                onClose={() => setEditCell(null)}
              />
            )}
          </td>
        )
      })}
      {/* Summary column */}
      <td style={{
        position: 'sticky', right: 0, zIndex: 5, background: 'var(--bg-card)',
        textAlign: 'center', padding: '4px 6px', borderLeft: '1px solid var(--border-light)',
        fontSize: 10, fontWeight: 600,
      }}>
        <span style={{ color: 'var(--accent-cyan)' }}>{workDays}</span>
        <span style={{ color: 'var(--text-muted)' }}>/</span>
        <span style={{ color: 'var(--text-muted)' }}>{restDays}</span>
      </td>
    </tr>
  )
}

// ── Edit popup for month view (rendered via portal at body level) ──
function MonthEditPopup({ emp, date, shift, storeSettings, handleSetShift, handleDeleteShift, onClose }) {
  const dow = ['日', '一', '二', '三', '四', '五', '六'][new Date(date).getDay()]
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const oh = storeSettings?.operating_hours?.[dayNames[new Date(date).getDay()]]
  const storeOpen = oh?.open || '11:00'
  const storeClose = oh?.close || '00:00'

  const [startTime, setStartTime] = useState(storeOpen)
  const [endTime, setEndTime] = useState(storeClose)

  // Quick presets based on operating hours
  const openH = parseInt(storeOpen) || 11
  const closeH = parseInt(storeClose) || 0
  const effectiveClose = closeH <= openH ? closeH + 24 : closeH
  const midH = openH + Math.floor((effectiveClose - openH) / 2)
  const fmt = (h) => `${String(h % 24).padStart(2, '0')}:00`

  // 用 ~ 而不是 -，避免 Excel 把 "11-20" 自動轉成日期
  const presets = [
    { label: `${openH}~${effectiveClose % 24 || 24}`, start: fmt(openH), end: fmt(effectiveClose) },
    { label: `${openH}~${midH}`, start: fmt(openH), end: fmt(midH) },
    { label: `${midH}~${effectiveClose % 24 || 24}`, start: fmt(midH), end: fmt(effectiveClose) },
    { label: `${openH}~${openH + 9}`, start: fmt(openH), end: fmt(openH + 9) },
    { label: `${openH + 4}~${effectiveClose % 24 || 24}`, start: fmt(openH + 4), end: fmt(effectiveClose) },
  ].filter((p, i, arr) => arr.findIndex(x => x.label === p.label) === i)

  const handleConfirm = () => {
    if (!startTime || !endTime) return
    const s = startTime.replace(':00', '').replace(/^0/, '')
    const e = endTime.replace(':00', '').replace(/^0/, '')
    handleSetShift(emp.name, date, `${s}~${e}`, startTime, endTime)
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-strong)',
        borderRadius: 14, padding: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        minWidth: 220,
      }} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center', marginBottom: 10 }}>
        {emp.name} · {date.slice(5)}({dow})
      </div>

      {/* Time pickers */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <input type="time" className="form-input" value={startTime} onChange={e => setStartTime(e.target.value)}
          style={{ flex: 1, padding: '8px', fontSize: 14, fontWeight: 600 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>~</span>
        <input type="time" className="form-input" value={endTime} onChange={e => setEndTime(e.target.value)}
          style={{ flex: 1, padding: '8px', fontSize: 14, fontWeight: 600 }} />
      </div>

      {/* Confirm */}
      <button onClick={handleConfirm} style={{
        width: '100%', padding: '9px', borderRadius: 8, border: 'none', cursor: 'pointer',
        background: 'var(--accent-cyan)', color: '#fff', fontSize: 14, fontWeight: 700, marginBottom: 8,
      }}>確認排班</button>

      {/* Quick presets */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 8 }}>
        {presets.map(p => (
          <button key={p.label} onClick={() => { setStartTime(p.start); setEndTime(p.end) }}
            style={{
              padding: '6px 2px', borderRadius: 6, border: '1px solid var(--border-medium)',
              background: startTime === p.start && endTime === p.end ? 'rgba(34,211,238,0.15)' : 'var(--bg-card)',
              color: startTime === p.start && endTime === p.end ? 'var(--accent-cyan)' : 'var(--text-muted)',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Rest / Absence */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 6 }}>
        <button onClick={() => handleSetShift(emp.name, date, '休')} style={{
          padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'var(--glass-medium)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
        }}>😴 休</button>
        <button onClick={() => handleSetShift(emp.name, date, '補休')} style={{
          padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(59,130,246,0.1)', color: '#3b82f6', fontSize: 12, fontWeight: 600,
        }}>🔄 補休</button>
        <button onClick={() => handleSetShift(emp.name, date, '特休')} style={{
          padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(16,185,129,0.08)', color: '#10b981', fontSize: 12, fontWeight: 600,
        }}>🌴 特休</button>
        <button onClick={() => handleSetShift(emp.name, date, '病')} style={{
          padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: 12, fontWeight: 600,
        }}>🏥 病假</button>
        <button onClick={() => handleSetShift(emp.name, date, '會議')} style={{
          padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(139,92,246,0.08)', color: '#8b5cf6', fontSize: 12, fontWeight: 600,
        }}>📋 會議</button>
        <button onClick={() => handleSetShift(emp.name, date, '產')} style={{
          padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(245,158,11,0.08)', color: '#f59e0b', fontSize: 12, fontWeight: 600,
        }}>👶 產假</button>
      </div>

      {/* Delete + Cancel */}
      <div style={{ display: 'flex', gap: 4 }}>
        {shift && handleDeleteShift && (
          <button onClick={() => handleDeleteShift(emp.name, date)} style={{
            flex: 1, padding: '6px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.3)',
            background: 'var(--accent-red-dim)', color: 'var(--accent-red)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>刪除</button>
        )}
        <button onClick={onClose} style={{
          flex: 1, padding: '6px', borderRadius: 8, border: '1px solid var(--border-medium)',
          background: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
        }}>取消</button>
      </div>
      </div>
    </ModalOverlay>
  )
}
