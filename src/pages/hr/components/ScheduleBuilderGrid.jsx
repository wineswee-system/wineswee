import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import ShiftEditPopup from './ShiftEditPopup'
import { isAbsence, validateLeisureQuota, validateMonthlyOvertime, validateNightShiftProtection } from '../../../lib/scheduleUtils'
import { validateSchedule } from '../../../lib/laborLaw'

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function hexToDim(hex) { return hex + '22' }

function getShiftStyle(shiftLabel, shiftDefs) {
  if (!shiftLabel) return {}
  if (isAbsence(shiftLabel)) {
    const map = {
      '例假': { background: 'rgba(220,38,38,0.15)', color: '#dc2626', borderColor: 'rgba(220,38,38,0.3)' },
      '休息': { background: 'var(--glass-medium)', color: 'var(--text-muted)', borderColor: 'var(--border-light)' },
      '國定假': { background: 'rgba(6,182,212,0.15)', color: '#06b6d4', borderColor: 'rgba(6,182,212,0.3)' },
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
  return { background: 'rgba(34,211,238,0.12)', color: 'var(--text-primary)', borderColor: 'rgba(34,211,238,0.3)' }
}

export default function ScheduleBuilderGrid({
  employees, dates, shiftDefs, storeSettings, assignments,
  handleSetShift, handleDeleteShift,
  lockedDates = new Set(),  // Set<'YYYY-MM-DD'> — 鎖定（已發布）的日期，cell 不可編輯
}) {
  const isLocked = (date) => lockedDates && lockedDates.has(date)
  const [editCell, setEditCell] = useState(null)
  const [dragShift, setDragShift] = useState(null)
  const [dragSource, setDragSource] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const dragActiveRef = useRef(false)

  // ── 多選 / 複製貼上 state ──
  // selectedCells: Set<"empName|date">
  // lastClicked: 上次 plain/ctrl-click 的 cell（給 shift+click range 用）
  // clipboard: Array<{ rowOffset, colOffset, shift, actual_start, actual_end }> 複製內容（相對位置）
  const [selectedCells, setSelectedCells] = useState(() => new Set())
  const [lastClicked, setLastClicked] = useState(null)
  const [clipboard, setClipboard] = useState(null)

  // ── 排班檢查布告欄 ──
  // 預設摺起來；有違規時自動展開
  const [boardExpanded, setBoardExpanded] = useState(false)
  const [userToggled, setUserToggled] = useState(false)
  const compliance = useMemo(() => {
    // 把 assignments object 攤平成 [{ employee, date, shift }]
    const schedules = []
    for (const emp of employees) {
      for (const date of dates) {
        const asgn = assignments[`${emp.name}|${date}`]
        if (asgn?.shift) schedules.push({ employee: emp.name, date, shift: asgn.shift })
      }
    }
    if (schedules.length === 0) return { errors: [], warnings: [], isValid: true }
    const base = validateSchedule(schedules, dates, shiftDefs, employees)
    const quota = validateLeisureQuota({
      schedules,
      workHourSystem: storeSettings?.work_hour_system,
      anchorDate: storeSettings?.variable_period_start,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      shiftDefs,
      employees,   // 兼職跳過例假/休息檢查
    })
    const ot = validateMonthlyOvertime({ schedules, shiftDefs })
    const night = validateNightShiftProtection({ schedules, employees, shiftDefs })
    return {
      errors: [...base.errors, ...quota.errors, ...ot.errors, ...night.errors],
      warnings: [...base.warnings, ...quota.warnings, ...ot.warnings, ...night.warnings],
      isValid: base.errors.length + quota.errors.length + ot.errors.length + night.errors.length === 0,
    }
  }, [employees, dates, assignments, shiftDefs, storeSettings])

  // 有違規時自動展開（除非使用者手動摺起來過）
  useEffect(() => {
    if (compliance.errors.length > 0 && !userToggled) setBoardExpanded(true)
  }, [compliance.errors.length, userToggled])

  const paletteShifts = shiftDefs.filter(d => d.name)

  const getAssignment = (empName, date) => assignments[`${empName}|${date}`] || null
  const cellKey = (empName, date) => `${empName}|${date}`

  // ── 多選邏輯 ──
  const handleCellSelect = (e, empName, date) => {
    const key = cellKey(empName, date)
    // Ctrl/Cmd + click：toggle 進/出選擇
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setSelectedCells(prev => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      setLastClicked({ empName, date })
      return true  // 攔截，不開 popup
    }
    // Shift + click：從 lastClicked 到本 cell 範圍選
    if (e.shiftKey && lastClicked) {
      e.preventDefault()
      const empNames = employees.map(x => x.name)
      const ri0 = empNames.indexOf(lastClicked.empName)
      const ri1 = empNames.indexOf(empName)
      const di0 = dates.indexOf(lastClicked.date)
      const di1 = dates.indexOf(date)
      if (ri0 < 0 || ri1 < 0 || di0 < 0 || di1 < 0) return false
      const rMin = Math.min(ri0, ri1), rMax = Math.max(ri0, ri1)
      const dMin = Math.min(di0, di1), dMax = Math.max(di0, di1)
      const next = new Set(selectedCells)
      for (let r = rMin; r <= rMax; r++) {
        for (let d = dMin; d <= dMax; d++) {
          next.add(cellKey(empNames[r], dates[d]))
        }
      }
      setSelectedCells(next)
      return true  // 攔截
    }
    // 沒選擇集時：plain click 走原本（開 popup）
    // 有選擇集時：plain click 先清選擇集（避免使用者誤填）
    if (selectedCells.size > 0) {
      setSelectedCells(new Set())
      setLastClicked(null)
    }
    setLastClicked({ empName, date })
    return false  // 不攔，讓 popup 開
  }

  // 套用班別到全部已選 cell — 鎖定的跳過
  const applyShiftToSelection = useCallback((shift) => {
    if (selectedCells.size === 0 || !shift) return
    for (const key of selectedCells) {
      const pi = key.lastIndexOf('|')
      const empName = key.slice(0, pi)
      const date = key.slice(pi + 1)
      if (isLocked(date)) continue  // silent skip
      handleSetShift(empName, date, shift.label, shift.start_time || null, shift.end_time || null, null)
    }
  }, [selectedCells, handleSetShift, lockedDates])  // eslint-disable-line react-hooks/exhaustive-deps

  // 複製：取 selected cells 的相對 pattern
  const copySelection = useCallback(() => {
    if (selectedCells.size === 0) return
    const empNames = employees.map(x => x.name)
    const cells = []
    let minRow = Infinity, minCol = Infinity
    for (const key of selectedCells) {
      const pi = key.lastIndexOf('|')
      const empName = key.slice(0, pi)
      const date = key.slice(pi + 1)
      const row = empNames.indexOf(empName)
      const col = dates.indexOf(date)
      if (row < 0 || col < 0) continue
      const asgn = getAssignment(empName, date)
      cells.push({ row, col, shift: asgn?.shift || null, actual_start: asgn?.actual_start, actual_end: asgn?.actual_end })
      if (row < minRow) minRow = row
      if (col < minCol) minCol = col
    }
    setClipboard(cells.map(c => ({
      rowOffset: c.row - minRow,
      colOffset: c.col - minCol,
      shift: c.shift, actual_start: c.actual_start, actual_end: c.actual_end,
    })))
  }, [selectedCells, employees, dates, assignments]) // eslint-disable-line react-hooks/exhaustive-deps

  // 貼上：以選擇集的左上角當基準（若選擇集只有 1 格也行），按 clipboard 偏移貼
  const pasteSelection = useCallback(() => {
    if (!clipboard || clipboard.length === 0 || selectedCells.size === 0) return
    const empNames = employees.map(x => x.name)
    let minRow = Infinity, minCol = Infinity
    for (const key of selectedCells) {
      const pi = key.lastIndexOf('|')
      const row = empNames.indexOf(key.slice(0, pi))
      const col = dates.indexOf(key.slice(pi + 1))
      if (row < minRow) minRow = row
      if (col < minCol) minCol = col
    }
    for (const c of clipboard) {
      const r = minRow + c.rowOffset
      const d = minCol + c.colOffset
      if (r < 0 || r >= empNames.length || d < 0 || d >= dates.length) continue
      if (isLocked(dates[d])) continue  // 鎖定日期 silent skip
      if (c.shift) handleSetShift(empNames[r], dates[d], c.shift, c.actual_start || null, c.actual_end || null, null)
      else handleDeleteShift(empNames[r], dates[d])
    }
  }, [clipboard, selectedCells, employees, dates, handleSetShift, handleDeleteShift, lockedDates])  // eslint-disable-line react-hooks/exhaustive-deps

  // 刪除已選 — 鎖定的跳過
  const deleteSelection = useCallback(() => {
    if (selectedCells.size === 0) return
    for (const key of selectedCells) {
      const pi = key.lastIndexOf('|')
      const date = key.slice(pi + 1)
      if (isLocked(date)) continue  // silent skip
      handleDeleteShift(key.slice(0, pi), date)
    }
  }, [selectedCells, handleDeleteShift, lockedDates])  // eslint-disable-line react-hooks/exhaustive-deps

  // 鍵盤快捷
  useEffect(() => {
    const onKey = (e) => {
      // 編輯中（input/textarea/select）不攔，避免影響 popup 輸入
      const tag = (e.target?.tagName || '').toLowerCase()
      if (['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selectedCells.size > 0) { e.preventDefault(); copySelection() }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (clipboard && selectedCells.size > 0) { e.preventDefault(); pasteSelection() }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedCells.size > 0) { e.preventDefault(); deleteSelection() }
      } else if (e.key === 'Escape') {
        setSelectedCells(new Set())
        setLastClicked(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedCells, clipboard, copySelection, pasteSelection, deleteSelection])

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── 排班檢查布告欄：即時 feedback，可摺疊 ── */}
      {(() => {
        const errCount = compliance.errors.length
        const warnCount = compliance.warnings.length
        const tone = errCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok'
        const palette = {
          error: { bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.35)', color: 'var(--accent-red)' },
          warn:  { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', color: 'var(--accent-orange)' },
          ok:    { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.30)', color: 'var(--accent-green)' },
        }[tone]
        const icon = tone === 'error' ? '❌' : tone === 'warn' ? '⚠️' : '✓'
        const summary = tone === 'error'
          ? `${errCount} 違規${warnCount > 0 ? ` · ${warnCount} 提醒` : ''}`
          : tone === 'warn' ? `${warnCount} 提醒` : '全部合規'

        // 按員工分組
        const groupedErrs = {}, groupedWarns = {}
        for (const e of compliance.errors) (groupedErrs[e.employee] ??= []).push(e)
        for (const w of compliance.warnings) (groupedWarns[w.employee] ??= []).push(w)
        const empNames = [...new Set([...Object.keys(groupedErrs), ...Object.keys(groupedWarns)])].sort()

        return (
          <div style={{
            marginBottom: 8, borderRadius: 10,
            background: palette.bg, border: `1px solid ${palette.border}`,
            overflow: 'hidden',
          }}>
            {/* Header — 點擊切展開 */}
            <div
              onClick={() => { setBoardExpanded(v => !v); setUserToggled(true) }}
              style={{
                padding: '8px 14px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
                color: palette.color, fontWeight: 700,
              }}
            >
              <span style={{ fontSize: 13 }}>{icon} 排班檢查：{summary}</span>
              {empNames.length > 0 && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                  · 影響 {empNames.length} 人
                </span>
              )}
              <span style={{
                marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontWeight: 500,
              }}>
                {boardExpanded ? '▲ 收合' : empNames.length > 0 ? '▼ 點開看詳情' : '✓'}
              </span>
            </div>

            {/* Body — 展開時顯示按員工分組的詳情 */}
            {boardExpanded && empNames.length > 0 && (
              <div style={{
                padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 8,
                maxHeight: 240, overflowY: 'auto',
                borderTop: `1px solid ${palette.border}`,
              }}>
                {empNames.map(empName => {
                  const errs = groupedErrs[empName] || []
                  const warns = groupedWarns[empName] || []
                  return (
                    <div key={empName} style={{
                      background: 'var(--bg-card)', borderRadius: 6,
                      padding: '6px 10px', border: '1px solid var(--border-subtle)',
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: 'var(--text-primary)' }}>
                        👤 {empName}
                      </div>
                      {errs.map((e, i) => (
                        <div key={`e${i}`} style={{
                          fontSize: 12, padding: '3px 6px', marginBottom: 3,
                          borderLeft: '3px solid var(--accent-red)', background: 'rgba(239,68,68,0.06)',
                          color: 'var(--text-secondary)',
                        }}>
                          <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>❌ </span>
                          {e.message}
                        </div>
                      ))}
                      {warns.map((w, i) => (
                        <div key={`w${i}`} style={{
                          fontSize: 12, padding: '3px 6px', marginBottom: 3,
                          borderLeft: '3px solid var(--accent-orange)', background: 'rgba(245,158,11,0.06)',
                          color: 'var(--text-secondary)',
                        }}>
                          <span style={{ color: 'var(--accent-orange)', fontWeight: 700 }}>⚠️ </span>
                          {w.message}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── 多選 toolbar：永遠顯示（沒選時當提示） ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        marginBottom: 8, padding: '8px 14px',
        borderRadius: 10,
        background: selectedCells.size > 0 || clipboard ? 'rgba(139,92,246,0.12)' : 'var(--bg-card)',
        border: `1px solid ${selectedCells.size > 0 || clipboard ? 'rgba(139,92,246,0.35)' : 'var(--border-medium)'}`,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        fontSize: 12, color: 'var(--text-primary)',
      }}>
        <span style={{ fontWeight: 700, color: selectedCells.size > 0 || clipboard ? '#8b5cf6' : 'var(--text-secondary)' }}>
          {selectedCells.size > 0 ? `🎯 已選 ${selectedCells.size} 格` : clipboard ? '📋 剪貼簿有內容' : '💡 批次填班'}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          {selectedCells.size > 0 ? (
            <>點左側班別套用 · <kbd style={kbdStyle}>Ctrl</kbd>+<kbd style={kbdStyle}>C</kbd> 複製 · <kbd style={kbdStyle}>Del</kbd> 清空 · <kbd style={kbdStyle}>Esc</kbd> 取消</>
          ) : (
            <><kbd style={kbdStyle}>Ctrl</kbd>+點 多選 · <kbd style={kbdStyle}>Shift</kbd>+點 範圍選 · 選好後點左側班別套用 / <kbd style={kbdStyle}>Ctrl</kbd>+<kbd style={kbdStyle}>C</kbd>/<kbd style={kbdStyle}>V</kbd> 複製貼上</>
          )}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {selectedCells.size > 0 && (
            <>
              <button onClick={copySelection} className="btn btn-sm btn-secondary" style={btnSmStyle}>📋 複製</button>
              {clipboard && (
                <button onClick={pasteSelection} className="btn btn-sm btn-secondary" style={btnSmStyle}>📥 貼上 ({clipboard.length})</button>
              )}
              <button onClick={deleteSelection} className="btn btn-sm btn-secondary" style={{ ...btnSmStyle, color: 'var(--accent-red)' }}>🗑️ 刪除</button>
              <button onClick={() => { setSelectedCells(new Set()); setLastClicked(null) }} className="btn btn-sm btn-secondary" style={btnSmStyle}>✕ 取消選擇</button>
            </>
          )}
          {selectedCells.size === 0 && clipboard && (
            <button onClick={() => setClipboard(null)} className="btn btn-sm btn-secondary" style={btnSmStyle}>清空剪貼簿</button>
          )}
        </div>
      </div>

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
            onClick={() => {
              // 有選擇集時：click 直接套用班別到全部已選 cell
              if (selectedCells.size > 0) {
                applyShiftToSelection({ label: shift.name, start_time: shift.start_time, end_time: shift.end_time })
              }
            }}
            title={selectedCells.size > 0 ? `點擊套用到 ${selectedCells.size} 個已選格` : '拖曳到格子'}
            style={{
              padding: '8px 10px', borderRadius: 8, cursor: selectedCells.size > 0 ? 'pointer' : 'grab', userSelect: 'none',
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
            { label: '國定假', color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
            { label: '特休', color: '#10b981', bg: 'rgba(16,185,129,0.10)' },
            { label: '補休', color: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
          ].map(a => (
            <div
              key={a.label}
              draggable
              onDragStart={() => onPaletteDragStart({ label: a.label, start_time: null, end_time: null })}
              onDragEnd={onDragEnd}
              onClick={() => {
                if (selectedCells.size > 0) {
                  applyShiftToSelection({ label: a.label, start_time: null, end_time: null })
                }
              }}
              title={selectedCells.size > 0 ? `點擊套用到 ${selectedCells.size} 個已選格` : '拖曳到格子'}
              style={{
                padding: '7px 10px', borderRadius: 8, cursor: selectedCells.size > 0 ? 'pointer' : 'grab', userSelect: 'none',
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
                    const cellLocked = isLocked(date)

                    return (
                      <td
                        key={date}
                        draggable={!!shift && !cellLocked}
                        onDragStart={(e) => { if (cellLocked) { e.preventDefault(); return } onCellDragStart(e, emp.name, date) }}
                        onDragOver={(e) => { if (cellLocked) return; onCellDragOver(e, emp.name, date) }}
                        onDrop={(e) => { if (cellLocked) { e.preventDefault(); return } onCellDrop(e, emp.name, date) }}
                        onDragEnd={onDragEnd}
                        onDragLeave={() => setDropTarget(prev =>
                          prev?.empName === emp.name && prev?.date === date ? null : prev
                        )}
                        onClick={(e) => {
                          if (dragActiveRef.current) return
                          if (cellLocked) return  // 鎖定的 cell 不開 popup 不多選
                          // ctrl/cmd/shift → 多選，攔截 popup
                          if (handleCellSelect(e, emp.name, date)) return
                          // 單擊 = 選取這格（不開編輯，跟外面手動填班一致；雙擊才開編輯）
                          setSelectedCells(new Set([cellKey(emp.name, date)]))
                          setLastClicked({ empName: emp.name, date })
                        }}
                        onDoubleClick={(e) => {
                          if (cellLocked) return
                          e.preventDefault()
                          setEditCell({ empName: emp.name, date })
                        }}
                        title={cellLocked ? '此排班已發布鎖定' : undefined}
                        style={{
                          padding: '3px 2px', textAlign: 'center',
                          borderBottom: '1px solid var(--border-light)',
                          cursor: cellLocked ? 'not-allowed' : 'pointer',
                          minWidth: 44, height: 48, verticalAlign: 'middle',
                          position: 'relative',
                          background: cellLocked
                            ? 'repeating-linear-gradient(45deg, rgba(100,116,139,0.06), rgba(100,116,139,0.06) 4px, transparent 4px, transparent 8px)'
                            : selectedCells.has(cellKey(emp.name, date))
                            ? 'rgba(139,92,246,0.18)'
                            : isDropOver
                              ? 'rgba(34,211,238,0.18)'
                              : isDragSrc
                                ? 'rgba(34,211,238,0.08)'
                                : isWeekend
                                  ? 'rgba(245,158,11,0.03)'
                                  : rowBg,
                          outline: selectedCells.has(cellKey(emp.name, date))
                            ? '2px solid #8b5cf6'
                            : isDropOver ? '2px solid var(--accent-cyan)' : 'none',
                          outlineOffset: -2,
                          opacity: isDragSrc ? 0.45 : 1,
                          userSelect: 'none',
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
                              // Resolve named shift to HH:MM~HH:MM via shiftDefs, then actual_start/actual_end
                              let label = shift
                              if (!/^\d{1,2}:\d{2}~\d{1,2}:\d{2}$/.test(label)) {
                                const def = shiftDefs.find(d => d.name === shift)
                                if (def?.start_time && def?.end_time) {
                                  label = `${def.start_time.slice(0, 5)}~${def.end_time.slice(0, 5)}`
                                } else if (asgn?.actual_start && asgn?.actual_end) {
                                  label = `${asgn.actual_start.slice(0, 5)}~${asgn.actual_end.slice(0, 5)}`
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

      </div>{/* /grid-row */}
    </div>
  )
}

const kbdStyle = {
  fontFamily: 'monospace', fontSize: 10, padding: '1px 5px',
  background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
  borderRadius: 4, color: 'var(--text-secondary)',
}
const btnSmStyle = {
  padding: '4px 10px', fontSize: 11, fontWeight: 600,
  borderRadius: 6,
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
