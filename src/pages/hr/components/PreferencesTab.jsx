import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export default function PreferencesTab({ filtered, shiftDefs, preferences, setPreferences }) {
  const [availability, setAvailability] = useState({}) // employee → { dow: { start, end } }
  const [editingAvail, setEditingAvail] = useState(null) // employee name

  // Load availability data
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
      {/* Shift Preferences + Target Hours */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="card-title"><span className="card-title-icon">👤</span> 班別偏好 & 目標工時</div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} /> 想上</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} /> 不可</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--border-medium)', display: 'inline-block' }} /> 都可以</span>
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 80 }}>員工</th>
                <th style={{ textAlign: 'center', width: 80 }}>週工時</th>
                {shiftDefs.map(d => (
                  <th key={d.id} style={{ textAlign: 'center', padding: '8px 4px', fontSize: 11 }}>
                    {d.name}
                  </th>
                ))}
                <th style={{ width: 60 }}>備註</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(emp => {
                const pref = preferences.find(p => p.employee === emp.name)
                const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT' || emp.position?.includes('PT')
                return (
                  <tr key={emp.id}>
                    <td>
                      <span style={{ fontWeight: 600 }}>{emp.name}</span>
                      {isPT && <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 4, fontWeight: 600 }}>PT</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        className="form-input"
                        type="number" min={4} max={48} step={1}
                        style={{ width: 52, textAlign: 'center', fontWeight: 700, fontSize: 13, padding: '4px' }}
                        defaultValue={emp.weekly_target_hours || (isPT ? 20 : 40)}
                        onBlur={e => handleTargetHoursChange(emp, e.target.value)}
                      />
                    </td>
                    {shiftDefs.map(d => {
                      const isPreferred = pref?.preferred_shifts?.includes(d.name)
                      const isBlocked = pref?.avoid_shifts?.includes(d.name)
                      const level = isPreferred ? 'want' : isBlocked ? 'block' : 'ok'

                      const handleCycle = async () => {
                        let nextPreferred = [...(pref?.preferred_shifts || [])]
                        let nextAvoid = [...(pref?.avoid_shifts || [])]

                        if (level === 'ok') {
                          nextPreferred.push(d.name)
                          nextAvoid = nextAvoid.filter(s => s !== d.name)
                        } else if (level === 'want') {
                          nextPreferred = nextPreferred.filter(s => s !== d.name)
                          nextAvoid.push(d.name)
                        } else {
                          nextPreferred = nextPreferred.filter(s => s !== d.name)
                          nextAvoid = nextAvoid.filter(s => s !== d.name)
                        }

                        const { data } = await supabase.from('employee_shift_preferences')
                          .upsert({ employee: emp.name, preferred_shifts: nextPreferred, avoid_shifts: nextAvoid }, { onConflict: 'employee' })
                          .select().single()
                        if (data) setPreferences(prev => [...prev.filter(p => p.employee !== emp.name), data])
                      }

                      return (
                        <td key={d.id} style={{ textAlign: 'center', padding: '6px 4px' }}>
                          <button onClick={handleCycle} title={level === 'want' ? '想上' : level === 'block' ? '不可' : '都可以'} style={{
                            width: 26, height: 26, borderRadius: '50%', border: 'none',
                            cursor: 'pointer', transition: 'transform 0.15s',
                            background: level === 'want' ? '#10b981' : level === 'block' ? '#ef4444' : 'var(--border-medium)',
                            opacity: level === 'ok' ? 0.35 : 1,
                          }} onMouseEnter={e => e.target.style.transform = 'scale(1.2)'}
                             onMouseLeave={e => e.target.style.transform = 'scale(1)'} />
                        </td>
                      )
                    })}
                    <td>
                      <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={async () => {
                        const notes = prompt('備註（例如：只能上早班、週三不行）', pref?.notes || '')
                        if (notes === null) return
                        const { data } = await supabase.from('employee_shift_preferences').upsert({ employee: emp.name, notes }, { onConflict: 'employee' }).select().single()
                        if (data) setPreferences(prev => [...prev.filter(p => p.employee !== emp.name), data])
                      }}>{pref?.notes ? '📝' : '+'}</button>
                      {pref?.notes && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pref.notes}>{pref.notes}</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
                  <th key={i} style={{ textAlign: 'center', color: i === 5 || i === 6 ? 'var(--accent-red)' : undefined }}>{label}</th>
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
