import { useState } from 'react'
import { Trash2, Pencil, Check, X, Plus } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WEEKEND_DAYS, WEEKDAY_DAYS, isWeekendDay } from '../../../lib/scheduleUtils'
import Modal, { Field } from '../../../components/Modal'

function parseTime(t) {
  if (!t) return 0
  const [h, m] = String(t).split(':').map(Number)
  return (h || 0) + (m || 0) / 60
}

const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABELS_FULL = ['一', '二', '三', '四', '五', '六', '日']
const INDIVIDUAL_DAYS = [
  { value: 0, label: '日' },
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
]

const DAY_PRESETS = [
  { label: '每天', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: '平日 (日~四)', days: [...WEEKDAY_DAYS] },
  { label: '週末 (五六)', days: [...WEEKEND_DAYS] },
]

const WORK_SYSTEMS = [
  { value: '標準工時', desc: '標準每週40小時，每日不超過8小時（勞基法§30-1）' },
  { value: '2週變形', desc: '2週內正常工時不超過84小時（勞基法§30-2）' },
  { value: '4週變形', desc: '4週內正常工時不超過160小時（勞基法§30-3）' },
  { value: '8週變形', desc: '8週內每週平均不超過40小時（勞基法§30-1）' },
]

function getDayLabel(dayOfWeek) {
  if (dayOfWeek === null || dayOfWeek === undefined) return '每天'
  const labels = ['日', '一', '二', '三', '四', '五', '六']
  return `週${labels[dayOfWeek]}`
}

function formatTimeRange(start, end) {
  if (!start && !end) return '全天'
  return `${start?.slice(0, 5) || '00:00'}~${end?.slice(0, 5) || '24:00'}`
}

export default function StoreSettingsTab({
  storeFilter, selectedStore, shiftDefs,
  setShiftDefs, setShiftTypes,
  storeSettings, setStoreSettings,
  staffing, setStaffing,
  operatingHours, setOperatingHours,
}) {
  // Shift CRUD state
  const [showShiftModal, setShowShiftModal] = useState(false)
  const [editingShift, setEditingShift] = useState(null)
  const [shiftForm, setShiftForm] = useState({ name: '', start_time: '09:00', end_time: '18:00', break_minutes: 60, color: '#22d3ee', shift_type: 'morning' })

  const setField = (k, v) => setShiftForm(f => ({ ...f, [k]: v }))

  const resetShiftForm = () => {
    setShiftForm({ name: '', start_time: '09:00', end_time: '18:00', break_minutes: 60, color: '#22d3ee', shift_type: 'morning' })
    setEditingShift(null)
    setShowShiftModal(false)
  }

  const openShiftEdit = (s) => {
    setShiftForm({ name: s.name, start_time: s.start_time?.slice(0, 5) || '09:00', end_time: s.end_time?.slice(0, 5) || '18:00', break_minutes: s.break_minutes || 60, color: s.color || '#22d3ee', shift_type: s.shift_type || 'morning' })
    setEditingShift(s)
    setShowShiftModal(true)
  }

  const handleShiftDelete = async (s) => {
    const { data: used } = await supabase.from('schedules').select('id').eq('shift', s.name).limit(1)
    const warning = used?.length > 0 ? `\n⚠ 有排班紀錄使用此班別，刪除後這些紀錄將無法顯示班別樣式。` : ''
    if (!confirm(`確定要刪除「${s.name}」班別嗎？${warning}`)) return
    await supabase.from('shift_definitions').delete().eq('id', s.id)
    const updated = shiftDefs.filter(x => x.id !== s.id)
    setShiftDefs(updated)
    setShiftTypes(updated)
  }

  const handleShiftSubmit = async () => {
    if (!shiftForm.name) return
    const payload = { name: shiftForm.name, start_time: shiftForm.start_time, end_time: shiftForm.end_time, break_minutes: Number(shiftForm.break_minutes) || 60, color: shiftForm.color, shift_type: shiftForm.shift_type || 'morning' }

    if (editingShift) {
      const { data } = await supabase.from('shift_definitions').update(payload).eq('id', editingShift.id).select().single()
      if (data) {
        const updated = shiftDefs.map(s => s.id === data.id ? data : s)
        setShiftDefs(updated)
        setShiftTypes(updated)
      }
    } else {
      payload.sort_order = shiftDefs.length + 1
      const { data, error } = await supabase.from('shift_definitions').insert(payload).select().single()
      if (error) { alert('新增失敗：' + error.message); return }
      if (data) {
        const updated = [...shiftDefs, data]
        setShiftDefs(updated)
        setShiftTypes(updated)
      }
    }
    resetShiftForm()
  }

  // New staffing form state
  const [newStaff, setNewStaff] = useState({
    shift_name: '',
    days: [],       // array of day numbers: 0=Sun, 1=Mon ... 6=Sat; empty = all days
    time_start: '',
    time_end: '',
    count: 1,
  })
  const [dayDropdownOpen, setDayDropdownOpen] = useState(false)
  // Inline editing state: { id, shift_name, day_of_week, time_start, time_end, required_count }
  const [editingRow, setEditingRow] = useState(null)

  if (!storeFilter) {
    return <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>請先選擇門市</div>
  }

  const handleAddStaffing = async () => {
    if (!selectedStore) return
    // Empty array = all days (store as [null])
    const days = newStaff.days.length === 0 ? [null] : newStaff.days

    const records = days.map(dow => ({
      store_id: selectedStore.id,
      shift_name: newStaff.shift_name || null,
      day_of_week: dow,
      time_start: newStaff.time_start || null,
      time_end: newStaff.time_end || null,
      required_count: newStaff.count,
      label: buildLabel(newStaff.shift_name, dow, newStaff.time_start, newStaff.time_end),
    }))

    const results = []
    for (const rec of records) {
      const { data } = await supabase.from('store_staffing')
        .upsert(rec, { onConflict: 'store_id,shift_name,day_of_week,time_start' })
        .select().single()
      if (data) results.push(data)
    }

    if (results.length > 0) {
      setStaffing(prev => {
        const ids = new Set(results.map(r => r.id))
        return [...prev.filter(s => !ids.has(s.id)), ...results]
      })
    }

    // Reset form
    setNewStaff(prev => ({ ...prev, count: 1 }))
  }

  const handleDeleteStaffing = async (id) => {
    const { error } = await supabase.from('store_staffing').delete().eq('id', id)
    if (!error) {
      setStaffing(prev => prev.filter(s => s.id !== id))
    }
  }

  const handleStartEdit = (s) => {
    setEditingRow({
      id: s.id,
      shift_name: s.shift_name || '',
      day_of_week: s.day_of_week,
      time_start: s.time_start?.slice(0, 5) || '',
      time_end: s.time_end?.slice(0, 5) || '',
      required_count: s.required_count,
    })
  }

  const handleSaveEdit = async () => {
    if (!editingRow) return
    const { data } = await supabase.from('store_staffing')
      .update({
        shift_name: editingRow.shift_name || null,
        day_of_week: editingRow.day_of_week,
        time_start: editingRow.time_start || null,
        time_end: editingRow.time_end || null,
        required_count: editingRow.required_count,
        label: buildLabel(editingRow.shift_name, editingRow.day_of_week, editingRow.time_start, editingRow.time_end),
      })
      .eq('id', editingRow.id)
      .select().single()
    if (data) {
      setStaffing(prev => prev.map(s => s.id === data.id ? data : s))
    }
    setEditingRow(null)
  }

  const buildLabel = (shiftName, dow, timeStart, timeEnd) => {
    const parts = []
    if (dow !== null && dow !== undefined) parts.push(getDayLabel(dow))
    if (timeStart || timeEnd) parts.push(formatTimeRange(timeStart, timeEnd))
    if (shiftName) parts.push(shiftName)
    return parts.join(' · ') || '全時段'
  }

  // Group staffing by a display key for compact rendering
  const groupedStaffing = staffing.reduce((groups, s) => {
    const key = `${s.shift_name || 'all'}_${s.time_start || ''}_${s.time_end || ''}`
    if (!groups[key]) groups[key] = []
    groups[key].push(s)
    return groups
  }, {})

  return (
    <>
      {/* Shift Definitions — Full CRUD */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-title"><span className="card-title-icon">⏰</span> 班別設定</div>
          <button className="btn btn-primary btn-sm" onClick={() => { setEditingShift(null); setShiftForm({ name: '', start_time: '09:00', end_time: '18:00', break_minutes: 60, color: '#22d3ee', shift_type: 'morning' }); setShowShiftModal(true) }}>
            <Plus size={12} /> 新增班別
          </button>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>班別</th><th>類型</th><th>上班</th><th>下班</th><th>休息</th><th>工時</th><th>顏色</th><th style={{ width: 70 }}>操作</th></tr></thead>
            <tbody>
              {shiftDefs.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無班別，請新增</td></tr>}
              {shiftDefs.map(d => {
                const sh = parseTime(d.start_time), eh = parseTime(d.end_time)
                const wh = eh > sh ? eh - sh - (d.break_minutes || 0) / 60 : (24 - sh + eh) - (d.break_minutes || 0) / 60
                return (
                  <tr key={d.id}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 3, background: d.color }} /><b>{d.name}</b></div></td>
                    <td>
                      <span style={{
                        display: 'inline-block', padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: d.shift_type === 'evening' ? 'rgba(139,92,246,0.12)' : 'rgba(251,191,36,0.12)',
                        color: d.shift_type === 'evening' ? '#8b5cf6' : '#f59e0b',
                      }}>
                        {d.shift_type === 'evening' ? '🌙 晚班' : '☀️ 早班'}
                      </span>
                    </td>
                    <td>{d.start_time?.slice(0, 5)}</td>
                    <td>{d.end_time?.slice(0, 5)}</td>
                    <td>{d.break_minutes}分鐘</td>
                    <td style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{wh.toFixed(1)}h</td>
                    <td><div style={{ width: 20, height: 20, borderRadius: 4, background: d.color || '#22d3ee', border: '1px solid var(--border-medium)' }} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => openShiftEdit(d)}><Pencil size={12} /></button>
                        <button className="btn btn-sm btn-secondary" style={{ color: 'var(--accent-red)' }} onClick={() => handleShiftDelete(d)}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Staffing Requirements — Day + Time + Count */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">👥</span> 人力需求</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>設定各時段/日期所需人力，AI 排班時會參考此設定</div>
        </div>

        {/* Existing rules */}
        <div style={{ padding: '0 16px' }}>
          {staffing.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '16px 0' }}>尚未設定人力需求規則</div>
          ) : (
            <div className="data-table-wrapper" style={{ marginTop: 8 }}>
              <table className="data-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>適用日</th>
                    <th>時段</th>
                    <th>班別</th>
                    <th style={{ textAlign: 'center' }}>需求人數</th>
                    <th style={{ width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {staffing
                    .sort((a, b) => {
                      const da = a.day_of_week ?? -1
                      const db = b.day_of_week ?? -1
                      if (da !== db) return da - db
                      return (a.time_start || '').localeCompare(b.time_start || '')
                    })
                    .map(s => {
                      const isEditing = editingRow?.id === s.id
                      if (isEditing) {
                        return (
                          <tr key={s.id} style={{ background: 'rgba(34,211,238,0.04)' }}>
                            <td>
                              <select className="form-input" style={{ padding: '4px 6px', fontSize: 12, width: 70 }}
                                value={editingRow.day_of_week ?? ''} onChange={e => setEditingRow(prev => ({ ...prev, day_of_week: e.target.value === '' ? null : parseInt(e.target.value) }))}>
                                <option value="">每天</option>
                                {INDIVIDUAL_DAYS.map(d => <option key={d.value} value={d.value}>週{d.label}</option>)}
                              </select>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <input className="form-input" type="time" style={{ padding: '4px 6px', fontSize: 11, width: 90 }}
                                  value={editingRow.time_start} onChange={e => setEditingRow(prev => ({ ...prev, time_start: e.target.value }))} />
                                <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>~</span>
                                <input className="form-input" type="time" style={{ padding: '4px 6px', fontSize: 11, width: 90 }}
                                  value={editingRow.time_end} onChange={e => setEditingRow(prev => ({ ...prev, time_end: e.target.value }))} />
                              </div>
                            </td>
                            <td>
                              <select className="form-input" style={{ padding: '4px 6px', fontSize: 12, width: 100 }}
                                value={editingRow.shift_name} onChange={e => setEditingRow(prev => ({ ...prev, shift_name: e.target.value }))}>
                                <option value="">不限</option>
                                {shiftDefs.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                              </select>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <input className="form-input" type="number" min={1} max={99}
                                style={{ width: 50, padding: '4px 6px', fontSize: 13, textAlign: 'center', fontWeight: 700 }}
                                value={editingRow.required_count} onChange={e => setEditingRow(prev => ({ ...prev, required_count: Math.max(1, parseInt(e.target.value) || 1) }))} />
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 2 }}>
                                <button onClick={handleSaveEdit} style={{
                                  background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                                  color: 'var(--accent-green)', opacity: 0.8,
                                }} title="儲存">
                                  <Check size={14} />
                                </button>
                                <button onClick={() => setEditingRow(null)} style={{
                                  background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                                  color: 'var(--text-muted)', opacity: 0.6,
                                }} title="取消">
                                  <X size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      }
                      return (
                        <tr key={s.id}>
                          <td>
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                              background: isWeekendDay(s.day_of_week) ? 'rgba(239,68,68,0.1)' : s.day_of_week === null ? 'rgba(99,102,241,0.1)' : 'var(--glass-light)',
                              color: isWeekendDay(s.day_of_week) ? 'var(--accent-red)' : s.day_of_week === null ? '#818cf8' : 'var(--text-primary)',
                            }}>
                              {getDayLabel(s.day_of_week)}
                            </span>
                          </td>
                          <td>
                            {s.time_start || s.time_end ? (
                              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                                {s.time_start?.slice(0, 5) || '00:00'} ~ {s.time_end?.slice(0, 5) || '24:00'}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>全天</span>
                            )}
                          </td>
                          <td>
                            {s.shift_name ? (
                              <span style={{ fontWeight: 600 }}>{s.shift_name}</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>不限</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-block', minWidth: 28, padding: '2px 8px', borderRadius: 6,
                              background: 'rgba(34,211,238,0.1)', color: 'var(--accent-cyan)',
                              fontWeight: 700, fontSize: 14, textAlign: 'center',
                            }}>
                              {s.required_count}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 2 }}>
                              <button onClick={() => handleStartEdit(s)} style={{
                                background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                                color: 'var(--text-muted)', opacity: 0.6,
                              }} title="編輯">
                                <Pencil size={14} />
                              </button>
                              <button onClick={() => handleDeleteStaffing(s.id)} style={{
                                background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                                color: 'var(--text-muted)', opacity: 0.6,
                              }} title="刪除">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add new rule form */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', marginTop: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>新增人力需求規則</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            {/* Day multiselect */}
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>適用日</label>
              <div style={{ position: 'relative' }}>
                {/* Trigger button */}
                <button
                  type="button"
                  className="form-input"
                  onClick={() => setDayDropdownOpen(prev => !prev)}
                  style={{
                    width: '100%', padding: '8px 10px', fontSize: 13, textAlign: 'left',
                    cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8,
                  }}
                >
                  <span style={{ color: newStaff.days.length === 0 ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                    {newStaff.days.length === 0
                      ? '每天'
                      : newStaff.days.length === 7
                        ? '每天'
                        : INDIVIDUAL_DAYS.filter(d => newStaff.days.includes(d.value)).map(d => d.label).join('、')
                    }
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>▼</span>
                </button>

                {/* Dropdown panel */}
                {dayDropdownOpen && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60,
                    background: 'var(--bg-card)', border: '1px solid var(--border-strong)',
                    borderRadius: 10, padding: 10, boxShadow: 'var(--shadow-lg)', marginTop: 4,
                  }}>
                    {/* Preset buttons */}
                    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                      {DAY_PRESETS.map(preset => {
                        const isActive = preset.days.length === newStaff.days.length && preset.days.every(d => newStaff.days.includes(d))
                        return (
                          <button key={preset.label} type="button" onClick={() => {
                            setNewStaff(prev => ({ ...prev, days: isActive ? [] : [...preset.days] }))
                          }} style={{
                            flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid',
                            borderColor: isActive ? 'var(--accent-cyan)' : 'var(--border-medium)',
                            background: isActive ? 'rgba(34,211,238,0.15)' : 'var(--bg-card)',
                            color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                            fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          }}>
                            {preset.label}
                          </button>
                        )
                      })}
                    </div>
                    {/* Individual day toggles */}
                    <div style={{ display: 'flex', gap: 4 }}>
                      {INDIVIDUAL_DAYS.map(d => {
                        const isSelected = newStaff.days.includes(d.value)
                        const isWeekend = isWeekendDay(d.value)
                        return (
                          <button key={d.value} type="button" onClick={() => {
                            setNewStaff(prev => ({
                              ...prev,
                              days: isSelected
                                ? prev.days.filter(v => v !== d.value)
                                : [...prev.days, d.value],
                            }))
                          }} style={{
                            flex: 1, padding: '8px 0', borderRadius: 8, border: '2px solid',
                            borderColor: isSelected ? 'var(--accent-cyan)' : 'var(--border-light)',
                            background: isSelected ? 'rgba(34,211,238,0.12)' : 'transparent',
                            color: isSelected ? 'var(--accent-cyan)' : isWeekend ? 'var(--accent-red)' : 'var(--text-primary)',
                            fontSize: 13, fontWeight: 700, cursor: 'pointer', textAlign: 'center',
                          }}>
                            {d.label}
                          </button>
                        )
                      })}
                    </div>
                    {/* Close */}
                    <button type="button" onClick={() => setDayDropdownOpen(false)} style={{
                      width: '100%', marginTop: 8, padding: '6px', borderRadius: 6,
                      border: '1px solid var(--border-medium)', background: 'var(--glass-light)',
                      color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer', fontWeight: 600,
                    }}>
                      確定
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Shift selection */}
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>班別 (可選)</label>
              <select className="form-input" style={{ width: '100%', padding: '8px 10px', fontSize: 13 }}
                value={newStaff.shift_name} onChange={e => setNewStaff(prev => ({ ...prev, shift_name: e.target.value }))}>
                <option value="">不限班別</option>
                {shiftDefs.map(d => <option key={d.id} value={d.name}>{d.name} ({d.start_time?.slice(0, 5)}~{d.end_time?.slice(0, 5)})</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 10, alignItems: 'end' }}>
            {/* Time range */}
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>開始時間 (可選)</label>
              <input className="form-input" type="time" style={{ width: '100%', padding: '8px 10px', fontSize: 13 }}
                value={newStaff.time_start} onChange={e => setNewStaff(prev => ({ ...prev, time_start: e.target.value }))}
                placeholder="全天" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>結束時間 (可選)</label>
              <input className="form-input" type="time" style={{ width: '100%', padding: '8px 10px', fontSize: 13 }}
                value={newStaff.time_end} onChange={e => setNewStaff(prev => ({ ...prev, time_end: e.target.value }))}
                placeholder="全天" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>人數</label>
              <input className="form-input" type="number" min={1} max={99} style={{ width: '100%', padding: '8px 10px', fontSize: 13, textAlign: 'center' }}
                value={newStaff.count} onChange={e => setNewStaff(prev => ({ ...prev, count: Math.max(1, parseInt(e.target.value) || 1) }))} />
            </div>
          </div>

          <button className="btn btn-primary" style={{ marginTop: 12, width: '100%', padding: '10px 16px' }}
            onClick={handleAddStaffing}>
            + 新增人力需求規則
          </button>

          {/* Quick presets */}
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: '26px' }}>快速設定：</span>
            {[
              { label: '平日 3人', days: [...WEEKDAY_DAYS], count: 3 },
              { label: '週末 4人', days: [...WEEKEND_DAYS], count: 4 },
              { label: '午間加班 2人', days: [], time_start: '11:00', time_end: '14:00', count: 2 },
              { label: '晚間加班 2人', days: [], time_start: '18:00', time_end: '22:00', count: 2 },
            ].map((preset, i) => (
              <button key={i} style={{
                padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-medium)',
                background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 11,
                cursor: 'pointer', fontWeight: 500,
              }} onClick={() => setNewStaff(prev => ({
                ...prev,
                days: preset.days ?? prev.days,
                time_start: preset.time_start ?? '',
                time_end: preset.time_end ?? '',
                count: preset.count,
                shift_name: preset.shift_name ?? prev.shift_name,
              }))}>
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Operating Hours */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">🏪</span> 營業時間</div>
        </div>
        <div style={{ padding: '12px 16px' }}>
          {DAY_LABELS_FULL.map((label, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ width: 24, fontWeight: 700, color: i === 4 || i === 5 ? 'var(--accent-red)' : 'var(--text-primary)' }}>{label}</span>
              <input className="form-input" type="time" style={{ width: 110 }} value={operatingHours[DAY_NAMES[i]]?.open || ''} onChange={e => setOperatingHours(prev => ({ ...prev, [DAY_NAMES[i]]: { ...prev[DAY_NAMES[i]], open: e.target.value } }))} />
              <span style={{ color: 'var(--text-muted)' }}>~</span>
              <input className="form-input" type="time" style={{ width: 110 }} value={operatingHours[DAY_NAMES[i]]?.close || ''} onChange={e => setOperatingHours(prev => ({ ...prev, [DAY_NAMES[i]]: { ...prev[DAY_NAMES[i]], close: e.target.value } }))} />
            </div>
          ))}
          <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={async () => {
            if (!selectedStore) return
            await supabase.from('store_settings').upsert({ store_id: selectedStore.id, operating_hours: operatingHours }, { onConflict: 'store_id' })
            alert('已儲存營業時間')
          }}>儲存營業時間</button>
        </div>
      </div>

      {/* Work Hour System */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">⚙️</span> 變形工時制度</div>
        </div>
        <div style={{ padding: '12px 16px' }}>
          <select className="form-input" style={{ width: '100%', marginBottom: 8 }} value={storeSettings?.work_hour_system || '標準工時'} onChange={async e => {
            if (!selectedStore) return
            const { data } = await supabase.from('store_settings').upsert({ store_id: selectedStore.id, work_hour_system: e.target.value }, { onConflict: 'store_id' }).select().single()
            if (data) setStoreSettings(data)
          }}>
            {WORK_SYSTEMS.map(w => <option key={w.value} value={w.value}>{w.value}</option>)}
          </select>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{WORK_SYSTEMS.find(w => w.value === (storeSettings?.work_hour_system || '標準工時'))?.desc}</div>
        </div>
      </div>

      {/* Labor Cost Budget */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">💰</span> 人力成本預算</div>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>每週預算 (NT$)</label>
            <input className="form-input" type="number" placeholder="例如 50000" value={storeSettings?.weekly_budget || ''} onChange={async e => {
              if (!selectedStore) return
              const { data } = await supabase.from('store_settings').upsert({ store_id: selectedStore.id, weekly_budget: Number(e.target.value) || null }, { onConflict: 'store_id' }).select().single()
              if (data) setStoreSettings(data)
            }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>預設時薪 (NT$)</label>
            <input className="form-input" type="number" value={storeSettings?.default_hourly_rate || 183} onChange={async e => {
              if (!selectedStore) return
              const { data } = await supabase.from('store_settings').upsert({ store_id: selectedStore.id, default_hourly_rate: Number(e.target.value) || 183 }, { onConflict: 'store_id' }).select().single()
              if (data) setStoreSettings(data)
            }} />
          </div>
        </div>
        <div style={{ padding: '0 16px 12px', fontSize: 11, color: 'var(--text-muted)' }}>2026 年基本工資：NT$29,500/月、NT$196/時</div>
      </div>

      {showShiftModal && (
        <Modal title={editingShift ? `編輯班別 — ${editingShift.name}` : '新增班別'} onClose={resetShiftForm} onSubmit={handleShiftSubmit} submitLabel={editingShift ? '儲存變更' : '新增'}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="班別名稱 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：夜班" value={shiftForm.name} onChange={e => setField('name', e.target.value)} />
            </Field>
            <Field label="類型 *">
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setField('shift_type', 'morning')} style={{
                  flex: 1, padding: '8px 12px', borderRadius: 8, border: '2px solid',
                  borderColor: shiftForm.shift_type === 'morning' ? '#f59e0b' : 'var(--border-medium)',
                  background: shiftForm.shift_type === 'morning' ? 'rgba(251,191,36,0.12)' : 'var(--bg-card)',
                  color: shiftForm.shift_type === 'morning' ? '#f59e0b' : 'var(--text-muted)',
                  cursor: 'pointer', fontSize: 13, fontWeight: 600, textAlign: 'center',
                }}>
                  ☀️ 早班
                </button>
                <button type="button" onClick={() => setField('shift_type', 'evening')} style={{
                  flex: 1, padding: '8px 12px', borderRadius: 8, border: '2px solid',
                  borderColor: shiftForm.shift_type === 'evening' ? '#8b5cf6' : 'var(--border-medium)',
                  background: shiftForm.shift_type === 'evening' ? 'rgba(139,92,246,0.12)' : 'var(--bg-card)',
                  color: shiftForm.shift_type === 'evening' ? '#8b5cf6' : 'var(--text-muted)',
                  cursor: 'pointer', fontSize: 13, fontWeight: 600, textAlign: 'center',
                }}>
                  🌙 晚班
                </button>
              </div>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="上班時間 *">
              <input className="form-input" type="time" style={{ width: '100%' }} value={shiftForm.start_time} onChange={e => setField('start_time', e.target.value)} />
            </Field>
            <Field label="下班時間 *">
              <input className="form-input" type="time" style={{ width: '100%' }} value={shiftForm.end_time} onChange={e => setField('end_time', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="休息時間（分鐘）">
              <input className="form-input" type="number" style={{ width: '100%' }} min={0} step={15} value={shiftForm.break_minutes} onChange={e => setField('break_minutes', e.target.value)} />
            </Field>
            <Field label="顯示顏色">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" value={shiftForm.color} onChange={e => setField('color', e.target.value)} style={{ width: 40, height: 36, border: 'none', borderRadius: 6, cursor: 'pointer' }} />
                <input className="form-input" type="text" style={{ flex: 1 }} value={shiftForm.color} onChange={e => setField('color', e.target.value)} />
              </div>
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}
