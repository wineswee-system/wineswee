import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import ShiftEditPopup from './ShiftEditPopup'
import { parseTime } from '../../../lib/scheduleUtils'
import { getDayLabel, isAbsence, getAbsenceConfig, getAbsenceOptions, isWeekendDay, formatShiftLabel } from '../../../lib/scheduleUtils'

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
  focusedCell,
  setFocusedCell,
  selection,
  setSelection,
  selecting,
  setSelecting,
  handleSetShift,
  handleDeleteShift,
  canEditSchedule = true,
  getStoreShifts,
  storeFilter,
  holidaySet,
  storeSettings,
  pendingLeaveMap = {},  // empName → Set<dateStr>（待審核/審核中請假）
  violationsByEmp = {},   // empName → { errors: N, warnings: N }
  onClickEmployeeBadge,   // 點 badge 開合規 modal
  lockedDates = new Set(),  // Set<'YYYY-MM-DD'> — 鎖定（已發布）的日期，cell 不可編輯
}) {
  const isDateLocked = (date) => lockedDates && lockedDates.has(date)
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

  // 滑鼠拖曳框選 — 在 window 接 mouseup 才不會放開時鼠標已移出 cell
  useEffect(() => {
    if (!selecting) return
    const onUp = () => setSelecting(false)
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [selecting, setSelecting])

  // 判斷 cell 是否在 selection 矩形範圍內
  const isCellInSelection = (empName, date) => {
    if (!selection) return false
    // 在所有可見員工裡查 index（橫跨 store group 也算）
    const aIdx = filtered.findIndex(em => em.name === selection.anchor.empName)
    const eIdx = filtered.findIndex(em => em.name === selection.end.empName)
    const cIdx = filtered.findIndex(em => em.name === empName)
    const aDIdx = monthDates.findIndex(d => d === selection.anchor.date)
    const eDIdx = monthDates.findIndex(d => d === selection.end.date)
    const cDIdx = monthDates.findIndex(d => d === date)
    if (cIdx < 0 || cDIdx < 0) return false
    const eMin = Math.min(aIdx, eIdx), eMax = Math.max(aIdx, eIdx)
    const dMin = Math.min(aDIdx, eDIdx), dMax = Math.max(aDIdx, eDIdx)
    return cIdx >= eMin && cIdx <= eMax && cDIdx >= dMin && cDIdx <= dMax
  }

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
      {/* Shift Legend — simplified when viewing all stores */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {storeFilter && getStoreShifts(storeFilter).map(d => (
          <span key={d.id} style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, ...getShiftStyle(d.name) }}>
            {d.name}
          </span>
        ))}
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
                      textAlign: 'center', padding: '4px 1px',
                      width: 42, minWidth: 42, maxWidth: 42,
                      borderBottom: '2px solid var(--border-medium)',
                      borderLeft: '1px solid var(--border-medium)',
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
                      focusedCell={focusedCell}
                      setFocusedCell={setFocusedCell}
                      selection={selection}
                      setSelection={setSelection}
                      selecting={selecting}
                      setSelecting={setSelecting}
                      isCellInSelection={isCellInSelection}
                      handleSetShift={handleSetShift}
                      handleDeleteShift={handleDeleteShift}
                      canEditSchedule={canEditSchedule}
                      SHIFT_TYPES={SHIFT_TYPES}
                      getStoreShifts={getStoreShifts}
                      storeFilter={store}
                      holidaySet={holidaySet}
                      storeSettings={storeSettings}
                      pendingLeaveMap={pendingLeaveMap}
                      schedules={schedules}
                      violationsByEmp={violationsByEmp}
                      onClickEmployeeBadge={onClickEmployeeBadge}
                      lockedDates={lockedDates}
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
                    focusedCell={focusedCell}
                    setFocusedCell={setFocusedCell}
                    selection={selection}
                    setSelection={setSelection}
                    selecting={selecting}
                    setSelecting={setSelecting}
                    isCellInSelection={isCellInSelection}
                    handleSetShift={handleSetShift}
                    handleDeleteShift={handleDeleteShift}
                    canEditSchedule={canEditSchedule}
                    SHIFT_TYPES={SHIFT_TYPES}
                    getStoreShifts={getStoreShifts}
                    storeFilter={storeFilter}
                    holidaySet={holidaySet}
                    storeSettings={storeSettings}
                    pendingLeaveMap={pendingLeaveMap}
                    schedules={schedules}
                    violationsByEmp={violationsByEmp}
                    onClickEmployeeBadge={onClickEmployeeBadge}
                    lockedDates={lockedDates}
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
  editCell, setEditCell, focusedCell, setFocusedCell,
  selection, setSelection, selecting, setSelecting, isCellInSelection,
  handleSetShift, handleDeleteShift,
  canEditSchedule, SHIFT_TYPES, getStoreShifts, storeFilter, holidaySet, storeSettings,
  pendingLeaveMap = {}, schedules = [],
  violationsByEmp = {}, onClickEmployeeBadge,
  lockedDates = new Set(),
}) {
  const isDateLocked = (date) => lockedDates && lockedDates.has(date)
  const v = violationsByEmp[emp.name] || { errors: 0, warnings: 0 }
  let workDays = 0
  let restDays = 0
  for (const d of monthDates) {
    const s = getShift(emp.name, d)
    if (s && !isAbsence(s)) workDays++
    else if (isAbsence(s)) restDays++
  }

  const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT' || emp.position?.includes('PT')

  return (
    <tr style={{ height: 42, borderBottom: '1px solid var(--border-light)' }}>
      <td style={{
        position: 'sticky', left: 0, zIndex: 5, background: 'var(--bg-card)',
        padding: '4px 8px', borderRight: '1px solid var(--border-light)',
      }}>
        <div style={{ fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>{emp.name}{isPT && <span style={{ fontSize: 9, color: '#818cf8', marginLeft: 2 }}>(PT)</span>}</span>
          {(v.errors > 0 || v.warnings > 0) && (
            <span
              onClick={() => onClickEmployeeBadge?.(emp.name)}
              title={v.errors > 0 ? `${v.errors} 個違規（點開只看 ${emp.name} 的）` : `${v.warnings} 個提醒（點開只看 ${emp.name} 的）`}
              style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 8, fontWeight: 700, cursor: 'pointer',
                background: v.errors > 0 ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.18)',
                color: v.errors > 0 ? '#dc2626' : '#d97706',
                lineHeight: '14px',
              }}
            >
              {v.errors > 0 ? `❌${v.errors}` : `⚠${v.warnings}`}
            </span>
          )}
        </div>
      </td>
      {monthDates.map(date => {
        // ★ 任期外的日期 (未入職 / 已離職) — 視覺灰掉、不可編輯
        //   join_date / resign_date 都是 'YYYY-MM-DD' 字串，直接字典序比較
        const isBeforeJoin = emp.join_date && date < emp.join_date
        const isAfterResign = emp.resign_date && date > emp.resign_date
        const isOutOfTenure = isBeforeJoin || isAfterResign
        if (isOutOfTenure) {
          return (
            <td key={date} style={{
              textAlign: 'center', padding: '2px 1px', position: 'relative',
              width: 42, minWidth: 42, maxWidth: 42, height: 42,
              border: '1px solid var(--border-medium)',
              background: 'var(--bg-tertiary)',
              cursor: 'not-allowed',
              userSelect: 'none',
            }}
            title={isBeforeJoin ? `${emp.join_date} 入職` : `${emp.resign_date} 離職`}>
              <span style={{
                fontSize: 9, color: 'var(--text-muted)', opacity: 0.55,
                fontStyle: 'italic',
              }}>
                {isBeforeJoin ? '未入職' : '已離職'}
              </span>
            </td>
          )
        }

        const shift = getShift(emp.name, date)
        const offReq = getOffRequest(emp.name, date)
        const dayOfWeek = new Date(date).getDay()
        const isWeekend = isWeekendDay(dayOfWeek)
        const isHoliday = holidaySet?.has(date)
        const isEditing = editCell?.empName === emp.name && editCell?.date === date
        const isFocused = focusedCell?.empName === emp.name && focusedCell?.date === date
        const isSelected = isCellInSelection?.(emp.name, date)
        const isRest = isAbsence(shift)
        const absenceCfg = isRest ? getAbsenceConfig(shift) : null
        const hasPendingLeave = pendingLeaveMap[emp.name]?.has(date)
        // 跨店：該天 source_store 若不是員工主店 → 顯示淡紫色背景
        const daySchedule = schedules.find(s => s.employee === emp.name && s.date === date)
        const isCrossStore = daySchedule?.source_store && emp.store && daySchedule.source_store !== emp.store
        const cellLocked = isDateLocked(date)

        return (
          <td key={date} style={{
            textAlign: 'center', padding: '2px 1px', position: 'relative',
            width: 42, minWidth: 42, maxWidth: 42, height: 42,
            border: isFocused ? '2px solid var(--accent-cyan)' : '1px solid var(--border-medium)',
            background: cellLocked
              ? 'repeating-linear-gradient(45deg, rgba(100,116,139,0.06), rgba(100,116,139,0.06) 4px, transparent 4px, transparent 8px)'
              : isSelected ? 'rgba(34,211,238,0.20)'
              : isCrossStore ? 'rgba(168,85,247,0.08)'
              : isHoliday ? 'rgba(239,68,68,0.05)' : isWeekend ? 'rgba(99,102,241,0.03)' : undefined,
            cursor: cellLocked ? 'not-allowed' : (canEditSchedule ? 'pointer' : 'default'),
            outline: isFocused ? '1px solid var(--accent-cyan)' : 'none',
            userSelect: 'none',
          }}
          title={cellLocked ? '此排班已發布鎖定' : undefined}
          onMouseDown={(e) => {
            if (!canEditSchedule || cellLocked) return
            // 拖曳開始：set anchor + 進入 selecting；不開 modal
            // Shift+click → 從原 anchor 延伸到這格
            if (e.shiftKey && selection?.anchor) {
              setSelection?.({ anchor: selection.anchor, end: { empName: emp.name, date } })
              return
            }
            e.preventDefault()
            setSelection?.({ anchor: { empName: emp.name, date }, end: { empName: emp.name, date } })
            setSelecting?.(true)
            setFocusedCell?.({ empName: emp.name, date })
          }}
          onMouseEnter={() => {
            if (cellLocked) return
            if (selecting && selection?.anchor) {
              setSelection?.({ anchor: selection.anchor, end: { empName: emp.name, date } })
            }
          }}
          onClick={(e) => {
            if (!canEditSchedule || cellLocked) return
            // 拖曳到別格了（多格框選）→ 不動作
            if (selection && (selection.anchor.empName !== selection.end.empName
              || selection.anchor.date !== selection.end.date)) return
            if (e.shiftKey) return
            // 單擊 = 選取那格（mousedown 已設 selection 單格 + focusedCell）；不再直接開編輯
            // 選好後可按 R/S/B/M/E 填班、Del 清除、Esc 退選；要細編改用雙擊
            setFocusedCell?.({ empName: emp.name, date })
          }}
          onDoubleClick={(e) => {
            if (!canEditSchedule || cellLocked) return
            // 雙擊 = 進入細部編輯 modal（清掉框選，聚焦這格）
            e.preventDefault()
            setSelection?.(null)
            if (!isEditing) setEditCell({ empName: emp.name, date })
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
              // Normalise format; resolve to HH:MM~HH:MM via SHIFT_TYPES then actual_start/actual_end
              (() => {
                let label = formatShiftLabel(shift)
                if (!/^\d{1,2}:\d{2}~\d{1,2}:\d{2}$/.test(label)) {
                  const def = SHIFT_TYPES.find(t => t.label === shift)
                  if (def?.start_time && def?.end_time) label = `${def.start_time}~${def.end_time}`
                  else if (daySchedule?.actual_start && daySchedule?.actual_end) {
                    label = `${daySchedule.actual_start.slice(0, 5)}~${daySchedule.actual_end.slice(0, 5)}`
                  }
                }
                const isTimeRange = /^\d{1,2}:\d{2}~\d{1,2}:\d{2}$/.test(label)
                return isTimeRange ? (
                  <span style={{
                    display: 'inline-block', padding: '1px 2px', borderRadius: 3,
                    fontSize: 9, fontWeight: 600, lineHeight: 1.15,
                    ...getShiftStyle(shift),
                  }}>
                    <div>{label.split('~')[0]}</div>
                    <div>{label.split('~')[1]}</div>
                  </span>
                ) : (
                  <span style={{
                    display: 'inline-block', padding: '1px 3px', borderRadius: 3,
                    fontSize: 9, fontWeight: 600, ...getShiftStyle(shift),
                    whiteSpace: 'nowrap',
                  }}>
                    {label}
                  </span>
                )
              })()
            ) : offReq ? (
              <span style={{ fontSize: 9, color: 'var(--accent-orange)' }}>申</span>
            ) : (
              <span style={{ fontSize: 9, color: 'var(--border-medium)' }}>·</span>
            )}

            {/* 待審核請假 — 橘點提示 */}
            {hasPendingLeave && (
              <span style={{
                position: 'absolute', top: 1, right: 2,
                fontSize: 7, lineHeight: 1, pointerEvents: 'none',
                color: 'var(--accent-orange)',
              }} title="有待審核請假">●</span>
            )}

            {/* 跨店：左上角小標 — 顯示去支援的店第一個字 */}
            {isCrossStore && (
              <span style={{
                position: 'absolute', top: 1, left: 2,
                fontSize: 8, lineHeight: 1, pointerEvents: 'none',
                padding: '1px 3px', borderRadius: 3, fontWeight: 700,
                background: 'rgba(168,85,247,0.2)', color: '#a855f7',
              }} title={`今天在 ${daySchedule.source_store}`}>
                {daySchedule.source_store.slice(0, 1)}
              </span>
            )}

            {/* Fixed Editor Popup */}
            {isEditing && (
              <ShiftEditPopup
                emp={emp} date={date} shift={shift}
                storeSettings={storeSettings}
                schedules={schedules}
                currentSchedule={schedules.find(s => s.employee === emp.name && s.date === date)}
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

