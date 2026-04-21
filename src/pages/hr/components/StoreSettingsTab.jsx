import { useState, useEffect } from 'react'
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
  yearMonth,
}) {
  // Shift CRUD state
  const [showShiftModal, setShowShiftModal] = useState(false)
  const [editingShift, setEditingShift] = useState(null)
  const [shiftForm, setShiftForm] = useState({ name: '', start_time: '09:00', end_time: '18:00', break_minutes: 60, color: '#22d3ee', shift_type: 'morning', employee_type: 'all', day_type: 'all' })

  const setField = (k, v) => setShiftForm(f => ({ ...f, [k]: v }))

  const resetShiftForm = () => {
    setShiftForm({ name: '', start_time: '09:00', end_time: '18:00', break_minutes: 60, color: '#22d3ee', shift_type: 'morning', employee_type: 'all', day_type: 'all' })
    setEditingShift(null)
    setShowShiftModal(false)
  }

  const openShiftEdit = (s) => {
    setShiftForm({ name: s.name, start_time: s.start_time?.slice(0, 5) || '09:00', end_time: s.end_time?.slice(0, 5) || '18:00', break_minutes: s.break_minutes || 60, color: s.color || '#22d3ee', shift_type: s.shift_type || 'morning', employee_type: s.employee_type || 'all', day_type: s.day_type || 'all' })
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
    const bm = Number(shiftForm.break_minutes)
    const payload = { name: shiftForm.name, start_time: shiftForm.start_time, end_time: shiftForm.end_time, break_minutes: isNaN(bm) ? 60 : bm, color: shiftForm.color, shift_type: shiftForm.shift_type || 'morning', employee_type: shiftForm.employee_type || 'all', day_type: shiftForm.day_type || 'all', store_id: selectedStore?.id || null }

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

  // Time slot staffing
  const [timeSlots, setTimeSlots] = useState([])
  const [newSlot, setNewSlot] = useState({ day_type: 'all', start_time: '', end_time: '', required_count: 1, max_count: null })

  // Load time slots (per month)
  useEffect(() => {
    if (!selectedStore) return
    let q = supabase.from('store_time_slots').select('*').eq('store_id', selectedStore.id).order('start_time')
    if (yearMonth) q = q.eq('year_month', yearMonth)
    else q = q.is('year_month', null)
    q.then(({ data }) => setTimeSlots(data || []))
  }, [selectedStore?.id, yearMonth])

  const handleAddTimeSlot = async () => {
    if (!selectedStore || !newSlot.start_time || !newSlot.end_time) return
    const { data, error } = await supabase.from('store_time_slots')
      .insert({ store_id: selectedStore.id, year_month: yearMonth || null, ...newSlot })
      .select().single()
    if (error) { alert('新增失敗：' + error.message); return }
    if (data) setTimeSlots(prev => [...prev.filter(s => s.id !== data.id), data].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')))
    setNewSlot(prev => ({ ...prev, start_time: '', end_time: '' }))
  }

  const handleDeleteTimeSlot = async (id) => {
    await supabase.from('store_time_slots').delete().eq('id', id)
    setTimeSlots(prev => prev.filter(s => s.id !== id))
  }

  // 複製上月時段人力需求
  const handleCopyLastMonth = async () => {
    if (!selectedStore || !yearMonth) return
    const [y, m] = yearMonth.split('-').map(Number)
    const prevDate = new Date(y, m - 2, 1) // month is 0-indexed, so m-2
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`

    const { data: prev } = await supabase.from('store_time_slots').select('*')
      .eq('store_id', selectedStore.id).eq('year_month', prevMonth)
    if (!prev?.length) {
      alert(`${prevMonth} 沒有時段人力設定可複製`)
      return
    }
    if (!confirm(`確定要將 ${prevMonth} 的 ${prev.length} 筆時段人力需求複製到 ${yearMonth}？`)) return

    // 先清除當月
    await supabase.from('store_time_slots').delete()
      .eq('store_id', selectedStore.id).eq('year_month', yearMonth)

    // 複製
    const rows = prev.map(({ id, created_at, ...rest }) => ({ ...rest, year_month: yearMonth }))
    const { data: inserted } = await supabase.from('store_time_slots').insert(rows).select()
    setTimeSlots(inserted || [])
    alert(`已複製 ${inserted?.length || 0} 筆時段人力需求到 ${yearMonth}`)
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
          <button className="btn btn-primary btn-sm" onClick={() => { setEditingShift(null); setShiftForm({ name: '', start_time: '09:00', end_time: '18:00', break_minutes: 60, color: '#22d3ee', shift_type: 'morning', employee_type: 'all', day_type: 'all' }); setShowShiftModal(true) }}>
            <Plus size={12} /> 新增班別
          </button>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>班別</th><th>類型</th><th>上班</th><th>下班</th><th>休息</th><th>工時</th><th>適用</th><th style={{ width: 70 }}>操作</th></tr></thead>
            <tbody>
              {shiftDefs.filter(d => !d.store_id || d.store_id === selectedStore?.id).length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無班別，請新增</td></tr>}
              {shiftDefs.filter(d => !d.store_id || d.store_id === selectedStore?.id).map(d => {
                const sh = parseTime(d.start_time), eh = parseTime(d.end_time)
                const wh = eh > sh ? eh - sh - (d.break_minutes || 0) / 60 : (24 - sh + eh) - (d.break_minutes || 0) / 60
                return (
                  <tr key={d.id}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--accent-cyan)' }} /><b>{d.name}</b></div></td>
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
                    <td style={{ fontSize: 10 }}>
                      {d.employee_type === 'pt' ? '兼職' : d.employee_type === 'full_time' ? '正職' : '全部'}
                      {d.day_type && d.day_type !== 'all' ? ` · ${d.day_type === 'weekday' ? '平日' : '假日'}` : ''}
                    </td>
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


      {/* Time Slot Staffing — 時段覆蓋制 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="card-title"><span className="card-title-icon">⏰</span> 時段人力需求{yearMonth ? ` — ${yearMonth}` : ''}</div>
            {yearMonth && (
              <button onClick={handleCopyLastMonth} style={{
                padding: '4px 12px', borderRadius: 8, border: '1px solid var(--border-medium)',
                background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>📋 複製上月</button>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>設定各時段需要幾人，演算法會自動計算每人上下班時間</div>
        </div>

        {/* Existing time slots — inline editable */}
        {timeSlots.length > 0 && (
          <div className="data-table-wrapper" style={{ padding: '0 16px' }}>
            <table className="data-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>適用</th>
                  <th>開始</th>
                  <th>結束</th>
                  <th style={{ textAlign: 'center' }}>最少</th>
                  <th style={{ textAlign: 'center' }}>最多</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {timeSlots.map(s => (
                  <tr key={s.id}>
                    <td>
                      <select className="form-input" value={s.day_type} style={{ padding: '4px 6px', fontSize: 11, width: 70 }}
                        onChange={async e => {
                          const { data } = await supabase.from('store_time_slots').update({ day_type: e.target.value }).eq('id', s.id).select().single()
                          if (data) setTimeSlots(prev => prev.map(x => x.id === data.id ? data : x))
                        }}>
                        <option value="all">每天</option>
                        <option value="weekday">平日</option>
                        <option value="weekend">假日</option>
                      </select>
                    </td>
                    <td>
                      <input type="time" className="form-input" value={s.start_time?.slice(0, 5) || ''} style={{ padding: '4px 6px', fontSize: 12, width: 90 }}
                        onBlur={async e => {
                          if (!e.target.value || e.target.value === s.start_time?.slice(0, 5)) return
                          const { data } = await supabase.from('store_time_slots').update({ start_time: e.target.value }).eq('id', s.id).select().single()
                          if (data) setTimeSlots(prev => prev.map(x => x.id === data.id ? data : x))
                        }} />
                    </td>
                    <td>
                      <input type="time" className="form-input" value={s.end_time?.slice(0, 5) || ''} style={{ padding: '4px 6px', fontSize: 12, width: 90 }}
                        onBlur={async e => {
                          if (!e.target.value || e.target.value === s.end_time?.slice(0, 5)) return
                          const { data } = await supabase.from('store_time_slots').update({ end_time: e.target.value }).eq('id', s.id).select().single()
                          if (data) setTimeSlots(prev => prev.map(x => x.id === data.id ? data : x))
                        }} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input type="number" className="form-input" min={1} max={20} value={s.required_count}
                        style={{ width: 45, padding: '4px', fontSize: 13, textAlign: 'center', fontWeight: 700, color: 'var(--accent-cyan)' }}
                        onChange={async e => {
                          const v = Math.max(1, parseInt(e.target.value) || 1)
                          const { data } = await supabase.from('store_time_slots').update({ required_count: v }).eq('id', s.id).select().single()
                          if (data) setTimeSlots(prev => prev.map(x => x.id === data.id ? data : x))
                        }} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input type="number" className="form-input" min={1} max={20} value={s.max_count || ''}
                        placeholder="不限"
                        style={{ width: 45, padding: '4px', fontSize: 13, textAlign: 'center', fontWeight: 700, color: 'var(--accent-cyan)' }}
                        onChange={async e => {
                          const v = e.target.value ? Math.max(s.required_count, parseInt(e.target.value) || 1) : null
                          const { data } = await supabase.from('store_time_slots').update({ max_count: v }).eq('id', s.id).select().single()
                          if (data) setTimeSlots(prev => prev.map(x => x.id === data.id ? data : x))
                        }} />
                    </td>
                    <td>
                      <button onClick={() => handleDeleteTimeSlot(s.id)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                        color: 'var(--text-muted)', opacity: 0.6, fontSize: 12,
                      }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Visual timeline */}
        {timeSlots.length > 0 && (
          <div style={{ padding: '8px 16px 4px' }}>
            <div style={{ position: 'relative', height: 40, background: 'var(--glass-light)', borderRadius: 8, overflow: 'hidden' }}>
              {timeSlots.filter(s => s.day_type !== 'weekend').map((s, i) => {
                const startH = parseInt(s.start_time) || 0
                const endH = parseInt(s.end_time) || 24
                const effectiveEnd = endH <= startH ? endH + 24 : endH
                const barStart = ((startH - 10) / 16) * 100
                const barWidth = ((effectiveEnd - startH) / 16) * 100
                return (
                  <div key={i} style={{
                    position: 'absolute', top: 4, bottom: 4,
                    left: `${Math.max(0, barStart)}%`, width: `${Math.min(barWidth, 100 - barStart)}%`,
                    background: `rgba(34,211,238,${0.15 + s.required_count * 0.1})`,
                    borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, color: 'var(--accent-cyan)',
                  }}>
                    {s.required_count}人
                  </div>
                )
              })}
              {/* Hour labels */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
                {[10, 12, 14, 16, 18, 20, 22, 0, 2].map(h => (
                  <span key={h} style={{ fontSize: 8, color: 'var(--text-muted)' }}>{h}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Add new time slot */}
        <div style={{ padding: '12px 16px', borderTop: timeSlots.length > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>適用日</label>
              <select className="form-input" value={newSlot.day_type} onChange={e => setNewSlot(prev => ({ ...prev, day_type: e.target.value }))} style={{ width: 90, fontSize: 12 }}>
                <option value="all">每天</option>
                <option value="weekday">平日</option>
                <option value="weekend">假日</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>開始</label>
              <input className="form-input" type="time" value={newSlot.start_time} onChange={e => setNewSlot(prev => ({ ...prev, start_time: e.target.value }))} style={{ width: 100, fontSize: 12 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>結束</label>
              <input className="form-input" type="time" value={newSlot.end_time} onChange={e => setNewSlot(prev => ({ ...prev, end_time: e.target.value }))} style={{ width: 100, fontSize: 12 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>最少</label>
              <input className="form-input" type="number" min={1} max={20} value={newSlot.required_count} onChange={e => setNewSlot(prev => ({ ...prev, required_count: Math.max(1, parseInt(e.target.value) || 1) }))} style={{ width: 50, fontSize: 12, textAlign: 'center' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>最多</label>
              <input className="form-input" type="number" min={1} max={20} value={newSlot.max_count || ''} placeholder="不限" onChange={e => setNewSlot(prev => ({ ...prev, max_count: e.target.value ? Math.max(prev.required_count, parseInt(e.target.value) || 1) : null }))} style={{ width: 50, fontSize: 12, textAlign: 'center' }} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleAddTimeSlot} style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
              + 新增時段
            </button>
          </div>

          {/* Quick presets */}
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: '26px' }}>快速設定：</span>
            {[
              { label: '餐飲標準', slots: [
                { day_type: 'all', start_time: '11:00', end_time: '12:00', required_count: 1 },
                { day_type: 'all', start_time: '12:00', end_time: '14:00', required_count: 3 },
                { day_type: 'all', start_time: '14:00', end_time: '17:00', required_count: 2 },
                { day_type: 'all', start_time: '17:00', end_time: '21:00', required_count: 3 },
                { day_type: 'all', start_time: '21:00', end_time: '00:00', required_count: 1 },
              ]},
              { label: '假日加強', slots: [
                { day_type: 'weekend', start_time: '11:00', end_time: '14:00', required_count: 4 },
                { day_type: 'weekend', start_time: '14:00', end_time: '17:00', required_count: 3 },
                { day_type: 'weekend', start_time: '17:00', end_time: '22:00', required_count: 4 },
                { day_type: 'weekend', start_time: '22:00', end_time: '01:00', required_count: 2 },
              ]},
            ].map((preset, i) => (
              <button key={i} style={{
                padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-medium)',
                background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 11,
                cursor: 'pointer', fontWeight: 500,
              }} onClick={async () => {
                if (!selectedStore) return
                for (const s of preset.slots) {
                  await supabase.from('store_time_slots')
                    .upsert({ store_id: selectedStore.id, ...s }, { onConflict: 'store_id,day_type,start_time' })
                }
                const { data } = await supabase.from('store_time_slots').select('*').eq('store_id', selectedStore.id).order('start_time')
                setTimeSlots(data || [])
              }}>
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

      {/* Monthly Rest Days */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">🗓️</span> 每月休假天數</div>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>正職 (天/月)</label>
            <input className="form-input" type="number" min="4" max="15" value={storeSettings?.ft_monthly_rest_days ?? 8} onChange={async e => {
              if (!selectedStore) return
              const val = Number(e.target.value) || 8
              setStoreSettings(prev => ({ ...prev, ft_monthly_rest_days: val }))
              const { data } = await supabase.from('store_settings').upsert({ ...storeSettings, store_id: selectedStore.id, ft_monthly_rest_days: val }, { onConflict: 'store_id' }).select().single()
              if (data) setStoreSettings(data)
            }} style={{ width: 80 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>兼職 (天/月)</label>
            <input className="form-input" type="number" min="4" max="25" value={storeSettings?.pt_monthly_rest_days ?? 14} onChange={async e => {
              if (!selectedStore) return
              const val = Number(e.target.value) || 14
              setStoreSettings(prev => ({ ...prev, pt_monthly_rest_days: val }))
              const { data } = await supabase.from('store_settings').upsert({ ...storeSettings, store_id: selectedStore.id, pt_monthly_rest_days: val }, { onConflict: 'store_id' }).select().single()
              if (data) setStoreSettings(data)
            }} style={{ width: 80 }} />
          </div>
        </div>
        <div style={{ padding: '0 16px 12px', fontSize: 11, color: 'var(--text-muted)' }}>排班演算法會依此設定控制每月休假天數</div>
      </div>

      {/* Monthly Work Hours */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">⏱️</span> 每月上班時數上下限</div>
        </div>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>正職</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>最低 (h/月)</label>
              <input className="form-input" type="number" min="100" max="200" value={storeSettings?.ft_monthly_hours_min ?? 150} onChange={async e => {
                if (!selectedStore) return
                const { data } = await supabase.from('store_settings').upsert({ store_id: selectedStore.id, ft_monthly_hours_min: Number(e.target.value) || 150 }, { onConflict: 'store_id' }).select().single()
                if (data) setStoreSettings(data)
              }} style={{ width: 80 }} />
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 14, paddingTop: 18 }}>~</span>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>最高 (h/月)</label>
              <input className="form-input" type="number" min="100" max="220" value={storeSettings?.ft_monthly_hours_max ?? 175} onChange={async e => {
                if (!selectedStore) return
                const { data } = await supabase.from('store_settings').upsert({ store_id: selectedStore.id, ft_monthly_hours_max: Number(e.target.value) || 175 }, { onConflict: 'store_id' }).select().single()
                if (data) setStoreSettings(data)
              }} style={{ width: 80 }} />
            </div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>兼職</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>最低 (h/月)</label>
              <input className="form-input" type="number" min="20" max="175" value={storeSettings?.pt_monthly_hours_min ?? 80} onChange={async e => {
                if (!selectedStore) return
                const { data } = await supabase.from('store_settings').upsert({ store_id: selectedStore.id, pt_monthly_hours_min: Number(e.target.value) || 80 }, { onConflict: 'store_id' }).select().single()
                if (data) setStoreSettings(data)
              }} style={{ width: 80 }} />
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 14, paddingTop: 18 }}>~</span>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>最高 (h/月)</label>
              <input className="form-input" type="number" min="40" max="220" value={storeSettings?.pt_monthly_hours_max ?? 175} onChange={async e => {
                if (!selectedStore) return
                const { data } = await supabase.from('store_settings').upsert({ store_id: selectedStore.id, pt_monthly_hours_max: Number(e.target.value) || 175 }, { onConflict: 'store_id' }).select().single()
                if (data) setStoreSettings(data)
              }} style={{ width: 80 }} />
            </div>
          </div>
        </div>
        <div style={{ padding: '0 16px 12px', fontSize: 11, color: 'var(--text-muted)' }}>排班演算法會依此設定控制每月排班時數（正職預設 150-175h、兼職 80-175h）</div>
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
          <Field label="休息時間（分鐘）">
            <input className="form-input" type="number" style={{ width: '100%' }} min={0} step={15} value={shiftForm.break_minutes} onChange={e => setField('break_minutes', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="適用對象">
              <select className="form-input" style={{ width: '100%' }} value={shiftForm.employee_type} onChange={e => setField('employee_type', e.target.value)}>
                <option value="all">全部</option>
                <option value="full_time">正職</option>
                <option value="pt">兼職</option>
              </select>
            </Field>
            <Field label="適用日">
              <select className="form-input" style={{ width: '100%' }} value={shiftForm.day_type} onChange={e => setField('day_type', e.target.value)}>
                <option value="all">每天</option>
                <option value="weekday">平日</option>
                <option value="weekend">假日</option>
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}
