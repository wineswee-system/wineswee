import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export default function PreferencesTab({
  filtered, shiftDefs, preferences, setPreferences,
  storeFilter, locations, getStoreShifts, schedules,
}) {
  const [availability, setAvailability] = useState({})
  const [editingAvail, setEditingAvail] = useState(null)

  // Get shifts for current store, with fallback to extracting from actual schedules
  const visibleShifts = (() => {
    // 1. Try shift_definitions (filtered by store or deduplicated)
    let defs = storeFilter && getStoreShifts
      ? getStoreShifts(storeFilter)
      : (() => {
          const seen = new Set()
          return shiftDefs.filter(d => {
            if (seen.has(d.name)) return false
            seen.add(d.name)
            return true
          })
        })()

    if (defs.length > 0) return defs

    // 2. Fallback: extract unique shift names from actual schedule data
    const seen = new Set()
    const fromSchedules = []
    for (const s of (schedules || [])) {
      if (!s.shift || seen.has(s.shift)) continue
      // Skip absence types
      if (['休', '補休', '特休', '病', '會議', '產', '事'].includes(s.shift)) continue
      seen.add(s.shift)
      fromSchedules.push({ id: `sched-${s.shift}`, name: s.shift })
    }
    return fromSchedules
  })()

  useEffect(() => {
    supabase.from('employee_availability').select('*').then(({ data }) => {
      const map = {}
      for (const a of (data || [])) {
        if (!map[a.employee]) map[a.employee] = {}
        map[a.employee][a.day_of_week] = {
          id: a.id,
          start: a.start_time?.slice(0, 5) || '11:00',
          end: a.end_time?.slice(0, 5) || '00:00',
        }
      }
      setAvailability(map)
    })
  }, [])

  const handleTargetHoursChange = async (emp, value) => {
    const hours = Math.max(0, Math.min(48, Number(value) || 0))
    await supabase.from('employees').update({ weekly_target_hours: hours }).eq('id', emp.id)
  }

  const handlePersonalCapChange = async (emp, value) => {
    const cap = value === '' ? null : Math.max(0, Math.min(400, Number(value) || 0))
    await supabase.from('employees').update({ personal_hour_cap: cap }).eq('id', emp.id)
  }

  const rotateShiftPreference = async (emp, shiftName, pref) => {
    const isPreferred = pref?.preferred_shifts?.includes(shiftName)
    const isBlocked = pref?.avoid_shifts?.includes(shiftName)
    const level = isPreferred ? 'want' : isBlocked ? 'block' : 'ok'

    let nextPreferred = [...(pref?.preferred_shifts || [])]
    let nextAvoid = [...(pref?.avoid_shifts || [])]

    if (level === 'ok') {
      nextPreferred.push(shiftName)
      nextAvoid = nextAvoid.filter(s => s !== shiftName)
    } else if (level === 'want') {
      nextPreferred = nextPreferred.filter(s => s !== shiftName)
      nextAvoid.push(shiftName)
    } else {
      nextPreferred = nextPreferred.filter(s => s !== shiftName)
      nextAvoid = nextAvoid.filter(s => s !== shiftName)
    }

    const { data } = await supabase.from('employee_shift_preferences')
      .upsert({ employee: emp.name, preferred_shifts: nextPreferred, avoid_shifts: nextAvoid }, { onConflict: 'employee' })
      .select().single()
    if (data) setPreferences(prev => [...prev.filter(p => p.employee !== emp.name), data])
  }

  const handleAvailSave = async (empName, dow, start, end) => {
    const existing = availability[empName]?.[dow]
    let savedId = existing?.id
    if (existing?.id) {
      await supabase.from('employee_availability')
        .update({ start_time: start, end_time: end })
        .eq('id', existing.id)
    } else {
      const { data } = await supabase.from('employee_availability')
        .upsert({ employee: empName, day_of_week: dow, start_time: start, end_time: end }, { onConflict: 'employee,day_of_week' })
        .select('id').single()
      if (data) savedId = data.id
    }
    setAvailability(prev => ({
      ...prev,
      [empName]: { ...prev[empName], [dow]: { id: savedId, start, end } },
    }))
  }

  const handleAvailDelete = async (empName, dow) => {
    const existing = availability[empName]?.[dow]
    if (existing?.id) {
      await supabase.from('employee_availability').delete().eq('id', existing.id)
    }
    setAvailability(prev => {
      const next = { ...prev, [empName]: { ...prev[empName] } }
      delete next[empName][dow]
      return next
    })
  }

  return (
    <div>
      {/* Shift Preferences — card layout per employee */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="card-title"><span className="card-title-icon">👤</span> 班別偏好 & 目標工時</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            點擊班別標籤切換：預設 → <span style={{ color: '#10b981', fontWeight: 600 }}>想上</span> → <span style={{ color: '#ef4444', fontWeight: 600 }}>不可</span> → 預設
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12, padding: '4px 0' }}>
          {filtered.map(emp => {
            const pref = preferences.find(p => p.employee === emp.name)
            const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT' || emp.position?.includes('PT')

            return (
              <div key={emp.id} style={{
                border: '1px solid var(--border-light)', borderRadius: 10, padding: '12px 14px',
                background: 'var(--bg-card)',
              }}>
                {/* Employee header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{emp.name}</span>
                    {isPT && <span style={{
                      fontSize: 10, fontWeight: 700, color: '#f59e0b',
                      background: 'rgba(251,191,36,0.12)', padding: '1px 6px', borderRadius: 4,
                    }}>PT</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        className="form-input"
                        type="number" min={4} max={48} step={1}
                        style={{ width: 48, textAlign: 'center', fontWeight: 700, fontSize: 13, padding: '3px 4px' }}
                        defaultValue={emp.weekly_target_hours || (isPT ? 20 : 40)}
                        onBlur={e => handleTargetHoursChange(emp, e.target.value)}
                        title="每週目標時數（給排班參考、預設用）"
                      />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>h/週</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="個人 cycle 時數上限（NULL = 用店面預設）">
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>cap</span>
                      <input
                        className="form-input"
                        type="number" min={0} max={400} step={1}
                        placeholder="-"
                        style={{ width: 56, textAlign: 'center', fontSize: 12, padding: '3px 4px' }}
                        defaultValue={emp.personal_hour_cap ?? ''}
                        onBlur={e => handlePersonalCapChange(emp, e.target.value)}
                      />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>h/cycle</span>
                    </div>
                  </div>
                </div>

                {/* Shift preference tags */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {visibleShifts.length === 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      尚無班別定義，請先到「門市設定」新增班別
                    </span>
                  )}
                  {visibleShifts.map(d => {
                    const isPreferred = pref?.preferred_shifts?.includes(d.name)
                    const isBlocked = pref?.avoid_shifts?.includes(d.name)
                    const level = isPreferred ? 'want' : isBlocked ? 'block' : 'ok'

                    const styles = {
                      want: { background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' },
                      block: { background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' },
                      ok: { background: 'var(--glass-light)', color: 'var(--text-muted)', border: '1px solid var(--border-light)' },
                    }

                    return (
                      <button key={d.id} onClick={() => rotateShiftPreference(emp, d.name, pref)} style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        cursor: 'pointer', transition: 'all 0.15s', lineHeight: 1.3,
                        ...styles[level],
                      }}>
                        {level === 'want' && '+ '}{level === 'block' && '✕ '}{d.name}
                      </button>
                    )
                  })}
                </div>

                {/* Notes */}
                {pref?.notes && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic' }}>
                    📝 {pref.notes}
                  </div>
                )}
                {!pref?.notes && (
                  <button onClick={async () => {
                    const notes = prompt('備註（例如：只能上早班、週三不行）', '')
                    if (!notes) return
                    const { data } = await supabase.from('employee_shift_preferences').upsert({ employee: emp.name, notes }, { onConflict: 'employee' }).select().single()
                    if (data) setPreferences(prev => [...prev.filter(p => p.employee !== emp.name), data])
                  }} style={{
                    marginTop: 8, fontSize: 11, color: 'var(--text-muted)', background: 'none',
                    border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline',
                  }}>
                    + 加備註
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Availability Slots */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📅</span> 每週可出勤時段</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>未設定的日期 = 全天可上班。設定後，排班只會排在該時段內。</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>員工</th>
                {DAY_LABELS.map((label, i) => (
                  <th key={i} style={{ textAlign: 'center', color: i === 0 || i === 6 ? 'var(--accent-red)' : undefined }}>{label}</th>
                ))}
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(emp => {
                const empAvail = availability[emp.name] || {}
                const isEditing = editingAvail === emp.name
                return (
                  <tr key={emp.id}>
                    <td style={{ fontWeight: 600 }}>{emp.name}</td>
                    {[0, 1, 2, 3, 4, 5, 6].map(dow => {
                      const slot = empAvail[dow]
                      if (isEditing) {
                        return (
                          <td key={dow} style={{ padding: '4px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                              <input type="time" className="form-input"
                                style={{ width: 85, padding: '2px 4px', fontSize: 11 }}
                                defaultValue={slot?.start || '11:00'}
                                onBlur={e => {
                                  const end = empAvail[dow]?.end || '00:00'
                                  handleAvailSave(emp.name, dow, e.target.value, end)
                                }}
                              />
                              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>~</span>
                              <input type="time" className="form-input"
                                style={{ width: 85, padding: '2px 4px', fontSize: 11 }}
                                defaultValue={slot?.end || '00:00'}
                                onBlur={e => {
                                  const start = empAvail[dow]?.start || '11:00'
                                  handleAvailSave(emp.name, dow, start, e.target.value)
                                }}
                              />
                              {slot && (
                                <button onClick={() => handleAvailDelete(emp.name, dow)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--accent-red)' }}>
                                  清除
                                </button>
                              )}
                            </div>
                          </td>
                        )
                      }
                      return (
                        <td key={dow} style={{ textAlign: 'center' }}>
                          {slot ? (
                            <span style={{
                              display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                              background: 'rgba(34,211,238,0.08)', fontSize: 11, fontFamily: 'monospace',
                            }}>
                              {slot.start}~{slot.end}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>全天</span>
                          )}
                        </td>
                      )
                    })}
                    <td>
                      <button className="btn btn-sm btn-secondary"
                        onClick={() => setEditingAvail(isEditing ? null : emp.name)}>
                        {isEditing ? '完成' : '編輯'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
