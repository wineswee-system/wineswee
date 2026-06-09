import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../../components/Modal'
import { createPortal } from 'react-dom'
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
  deptFilter,
  setDeptFilter,
  departments,
  storeSettings,
  pendingLeaveMap = {},  // empName → Set<dateStr>（待審核/審核中請假）
  violationsByEmp = {},   // empName → { errors: N, warnings: N }
  onClickEmployeeBadge,   // 點 badge 開合規 modal
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
}) {
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
              onClick={onClickEmployeeBadge}
              title={v.errors > 0 ? `${v.errors} 個違規（點開看詳情）` : `${v.warnings} 個提醒（點開看詳情）`}
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

        return (
          <td key={date} style={{
            textAlign: 'center', padding: '2px 1px', position: 'relative',
            width: 42, minWidth: 42, maxWidth: 42, height: 42,
            border: isFocused ? '2px solid var(--accent-cyan)' : '1px solid var(--border-medium)',
            background: isSelected ? 'rgba(34,211,238,0.20)'
              : isCrossStore ? 'rgba(168,85,247,0.08)'
              : isHoliday ? 'rgba(239,68,68,0.05)' : isWeekend ? 'rgba(99,102,241,0.03)' : undefined,
            cursor: canEditSchedule ? 'pointer' : 'default',
            outline: isFocused ? '1px solid var(--accent-cyan)' : 'none',
            userSelect: 'none',
          }}
          onMouseDown={(e) => {
            if (!canEditSchedule) return
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
            if (selecting && selection?.anchor) {
              setSelection?.({ anchor: selection.anchor, end: { empName: emp.name, date } })
            }
          }}
          onClick={(e) => {
            if (!canEditSchedule) return
            // 拖曳到別格了 → 不開 modal（多格選取）
            if (selection && (selection.anchor.empName !== selection.end.empName
              || selection.anchor.date !== selection.end.date)) return
            // 單格點擊 → 清 selection，開 modal
            if (e.shiftKey) return
            setSelection?.(null)
            setFocusedCell?.({ empName: emp.name, date })
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
              // 班別名 normalize 後若為時段範圍（HH:MM~HH:MM）→ 上下分兩行顯示
              // formatShiftLabel 把 "1030-1930" / "11~20" 等都統一成 "HH:MM~HH:MM"
              (() => {
                const label = formatShiftLabel(shift)
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
              <MonthEditPopup
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

// ── Edit popup for month view (rendered via portal at body level) ──
function MonthEditPopup({ emp, date, shift, storeSettings, schedules, currentSchedule, handleSetShift, handleDeleteShift, onClose }) {
  const dow = ['日', '一', '二', '三', '四', '五', '六'][new Date(date).getDay()]
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const oh = storeSettings?.operating_hours?.[dayNames[new Date(date).getDay()]]
  const storeOpen = oh?.open || '11:00'
  const storeClose = oh?.close || '00:00'

  // 上次用的 preset 從 localStorage 拿
  const lastPresetKey = `lastShiftPreset_${emp.store || 'default'}`
  const lastPreset = (() => {
    try { return JSON.parse(localStorage.getItem(lastPresetKey) || 'null') } catch { return null }
  })()

  const [startTime, setStartTime] = useState(lastPreset?.start || storeOpen)
  const [endTime, setEndTime] = useState(lastPreset?.end || storeClose)

  // 跨店：員工授權的所有店（主店 + additional_stores）
  const storeOptions = [
    emp.store,
    ...(Array.isArray(emp.additional_stores) ? emp.additional_stores : []),
  ].filter(Boolean)
  const [sourceStore, setSourceStore] = useState(currentSchedule?.source_store || emp.store || '')

  // 前一日的班 — 給「複製前一日」用
  const prevDateStr = (() => {
    const d = new Date(date); d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })()
  const prevSchedule = schedules?.find(s => s.employee === emp.name && s.date === prevDateStr)
  const hasPrev = !!prevSchedule?.shift

  const handleCopyPrev = () => {
    if (!prevSchedule) return
    handleSetShift(
      emp.name, date, prevSchedule.shift,
      prevSchedule.actual_start, prevSchedule.actual_end,
      prevSchedule.source_store || emp.store
    )
  }

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
    // 記住這次選的 preset 給下次預填
    try { localStorage.setItem(lastPresetKey, JSON.stringify({ start: startTime, end: endTime })) } catch {}
    handleSetShift(emp.name, date, `${s}~${e}`, startTime, endTime, sourceStore || null)
  }

  const setAbsence = (label) => {
    handleSetShift(emp.name, date, label, null, null, sourceStore || null)
  }

  // 鍵盤快捷鍵：1-5 = preset / R = 休 / S = 特休 / B = 病 / M = 會議
  //           Enter = 確認 / ESC = 取消 / Backspace+Delete = 刪除
  useEffect(() => {
    const handler = (e) => {
      // 在 input/select/textarea 內不接管（讓使用者正常輸入時間）
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        if (e.key === 'Enter') { e.preventDefault(); handleConfirm() }
        if (e.key === 'Escape') { e.preventDefault(); onClose() }
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (shift && handleDeleteShift) { e.preventDefault(); handleDeleteShift(emp.name, date) }
        return
      }
      // 1-5 = 對應 preset
      const num = parseInt(e.key, 10)
      if (!isNaN(num) && num >= 1 && num <= presets.length) {
        e.preventDefault()
        const p = presets[num - 1]
        setStartTime(p.start); setEndTime(p.end)
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'e') { e.preventDefault(); setAbsence('例假') }
      else if (k === 'r') { e.preventDefault(); setAbsence('休息') }
      else if (k === 's') { e.preventDefault(); setAbsence('特休') }
      else if (k === 'b') { e.preventDefault(); setAbsence('病') }
      else if (k === 'm') { e.preventDefault(); setAbsence('會議') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, endTime, sourceStore, shift])

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

      {/* 跨店：門市下拉（只有多店授權的員工才顯示）*/}
      {storeOptions.length > 1 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>當天在哪間店</div>
          <select className="form-input" value={sourceStore} onChange={e => setSourceStore(e.target.value)}
            style={{ width: '100%', padding: '7px', fontSize: 13, fontWeight: 600 }}>
            {storeOptions.map(s => (
              <option key={s} value={s}>
                {s}{s === emp.store ? ' (主店)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 複製前一日 */}
      {hasPrev && (
        <button onClick={handleCopyPrev} style={{
          width: '100%', padding: '7px', borderRadius: 8, border: '1px dashed var(--accent-cyan)',
          background: 'rgba(34,211,238,0.06)', color: 'var(--accent-cyan)',
          fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 8,
        }}>
          ↑ 複製前一日（{prevSchedule.shift}{prevSchedule.source_store && prevSchedule.source_store !== emp.store ? ` · ${prevSchedule.source_store}` : ''}）
        </button>
      )}

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
        <button onClick={() => setAbsence('例假')} style={{
          padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(220,38,38,0.10)', color: '#dc2626', fontSize: 12, fontWeight: 600,
        }}>🛑 例假</button>
        <button onClick={() => setAbsence('休息')} style={{
          padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'var(--glass-medium)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
        }}>🌙 休息</button>
        <button onClick={() => setAbsence('補休')} style={{
          padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(59,130,246,0.1)', color: '#3b82f6', fontSize: 12, fontWeight: 600,
        }}>🔄 補休</button>
        <button onClick={() => setAbsence('特休')} style={{
          padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(16,185,129,0.08)', color: '#10b981', fontSize: 12, fontWeight: 600,
        }}>🌴 特休</button>
        <button onClick={() => setAbsence('病')} style={{
          padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: 12, fontWeight: 600,
        }}>🏥 病假</button>
        <button onClick={() => setAbsence('會議')} style={{
          padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(139,92,246,0.08)', color: '#8b5cf6', fontSize: 12, fontWeight: 600,
        }}>📋 會議</button>
        <button onClick={() => setAbsence('產')} style={{
          padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(245,158,11,0.08)', color: '#f59e0b', fontSize: 12, fontWeight: 600,
        }}>👶 產假</button>
      </div>

      {/* Keyboard hints */}
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 4 }}>
        ⌨ 1-5=班別 / E=例 R=休 S=特休 B=病 / Enter=確認 / Del=刪除 / Esc=關
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
