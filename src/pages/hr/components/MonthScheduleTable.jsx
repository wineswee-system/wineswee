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
}) {
  // Group employees by store when no store filter
  const storeGroups = !storeFilter
    ? [...new Set(employees.map(e => e.store))].filter(Boolean).sort()
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

      {/* Shift Legend */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {SHIFT_TYPES.map(t => (
          <span key={t.label} style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, ...getShiftStyle(t.label) }}>
            {t.label}
          </span>
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>|</span>
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
                  const storeEmps = filtered.filter(e => e.store === store)
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
  canEditSchedule, SHIFT_TYPES, getStoreShifts, storeFilter, holidaySet,
}) {
  let workDays = 0
  let restDays = 0
  for (const d of monthDates) {
    const s = getShift(emp.name, d)
    if (s && !isAbsence(s)) workDays++
    else if (isAbsence(s)) restDays++
  }

  const isPT = emp.position?.includes('PT') || emp.employment_type === 'PT'

  return (
    <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
      <td style={{
        position: 'sticky', left: 0, zIndex: 5, background: 'var(--bg-card)',
        padding: '4px 8px', borderRight: '1px solid var(--border-light)',
      }}>
        <div style={{ fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
          {emp.name}
          {isPT && <span style={{ fontSize: 9, color: '#818cf8', marginLeft: 4 }}>PT</span>}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {emp.position || emp.dept}
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
          onClick={(e) => {
            if (canEditSchedule && !isEditing) {
              setEditCell({ empName: emp.name, date, clickX: e.clientX, clickY: e.clientY })
            }
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
              <span style={{
                display: 'inline-block', padding: '1px 3px', borderRadius: 3,
                fontSize: 9, fontWeight: 600, ...getShiftStyle(shift),
              }}>
                {shift}
              </span>
            ) : offReq ? (
              <span style={{ fontSize: 9, color: 'var(--accent-orange)' }}>申</span>
            ) : (
              <span style={{ fontSize: 9, color: 'var(--border-medium)' }}>·</span>
            )}

            {/* Fixed Editor Popup */}
            {isEditing && (
              <MonthEditPopup
                emp={emp} date={date} shift={shift} isPT={isPT}
                storeFilter={storeFilter} getStoreShifts={getStoreShifts}
                SHIFT_TYPES={SHIFT_TYPES}
                clickX={editCell.clickX} clickY={editCell.clickY}
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

// ── Fixed-position edit popup for month view ──
function MonthEditPopup({ emp, date, shift, isPT, storeFilter, getStoreShifts, SHIFT_TYPES, clickX, clickY, handleSetShift, handleDeleteShift, onClose }) {
  const popupH = 300
  const popupW = 100
  const cx = clickX || window.innerWidth / 2
  const cy = clickY || window.innerHeight / 2
  // Position: above click point if space, otherwise below
  const top = cy > popupH + 20 ? cy - popupH - 8 : cy + 8
  const left = Math.max(8, Math.min(cx - popupW / 2, window.innerWidth - popupW - 8))
  const pos = { top: Math.max(8, top), left }

  const empStore = emp.store || storeFilter || ''
  const storeShiftDefs = getStoreShifts(empStore, isPT ? 'pt' : 'full_time')
  const storeShiftLabels = storeShiftDefs.map(d => d.name)
  const shiftOptions = SHIFT_TYPES.filter(t => t.label === '休' || storeShiftLabels.includes(t.label) || storeShiftDefs.length === 0)

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onMouseDown={onClose} />
      <div style={{
        position: 'fixed',
        top: pos ? pos.top : '50%', left: pos ? pos.left : '50%',
        ...(pos ? {} : { transform: 'translate(-50%, -50%)' }),
        zIndex: 9999, background: 'var(--bg-card)', border: '1px solid var(--border-strong)',
        borderRadius: 8, padding: 6, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', gap: 3, minWidth: 80,
      }} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        {shiftOptions.map(t => (
          <button key={t.label} onClick={() => handleSetShift(emp.name, date, t.label)}
            style={{
              padding: '3px 8px', borderRadius: 5, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 600, textAlign: 'center',
              background: t.dim, color: t.color,
            }}>
            {t.label}
          </button>
        ))}
        {getAbsenceOptions().filter(a => a.value !== '休').map(a => (
          <button key={a.value} onClick={() => handleSetShift(emp.name, date, a.value)}
            style={{
              padding: '3px 8px', borderRadius: 5, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 600, textAlign: 'center',
              color: getAbsenceConfig(a.value)?.color || '#666',
              background: (getAbsenceConfig(a.value)?.color || '#666') + '15',
            }}>
            {a.icon} {a.label}
          </button>
        ))}
        {shift && handleDeleteShift && (
          <button onClick={() => handleDeleteShift(emp.name, date)} style={{
            padding: '3px', borderRadius: 5, border: '1px solid rgba(248,113,113,0.3)',
            background: 'var(--accent-red-dim)', color: 'var(--accent-red)', fontSize: 10, cursor: 'pointer',
          }}>刪除</button>
        )}
        <button onClick={onClose} style={{
          padding: '3px', borderRadius: 5, border: '1px solid var(--border-medium)',
          background: 'none', color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer',
        }}>取消</button>
      </div>
    </>
  )
}
