import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

function parseTime(t) {
  if (!t) return 0
  const [h, m] = String(t).split(':').map(Number)
  return (h || 0) + (m || 0) / 60
}

const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABELS_FULL = ['一', '二', '三', '四', '五', '六', '日']
const DAY_OPTIONS = [
  { value: '', label: '每天' },
  { value: '1', label: '週一' },
  { value: '2', label: '週二' },
  { value: '3', label: '週三' },
  { value: '4', label: '週四' },
  { value: '5', label: '週五' },
  { value: '6', label: '週六' },
  { value: '0', label: '週日' },
  { value: 'weekday', label: '平日 (一~五)' },
  { value: 'weekend', label: '週末 (六日)' },
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
  storeSettings, setStoreSettings,
  staffing, setStaffing,
  operatingHours, setOperatingHours,
}) {
  // New staffing form state
  const [newStaff, setNewStaff] = useState({
    shift_name: '',
    day: '',        // '' | '0'-'6' | 'weekday' | 'weekend'
    time_start: '',
    time_end: '',
    count: 1,
  })

  if (!storeFilter) {
    return <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>請先選擇門市</div>
  }

  // Expand day selection into individual records
  const expandDays = (dayValue) => {
    if (dayValue === 'weekday') return [1, 2, 3, 4, 5]
    if (dayValue === 'weekend') return [6, 0]
    if (dayValue === '') return [null] // null = all days
    return [parseInt(dayValue)]
  }

  const handleAddStaffing = async () => {
    if (!selectedStore) return
    const days = expandDays(newStaff.day)

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
      {/* Shift Definitions */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">⏰</span> 班別設定</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>班別</th><th>上班</th><th>下班</th><th>休息</th><th>工時</th></tr></thead>
            <tbody>
              {shiftDefs.map(d => {
                const sh = parseTime(d.start_time), eh = parseTime(d.end_time)
                const wh = eh > sh ? eh - sh - (d.break_minutes || 0) / 60 : (24 - sh + eh) - (d.break_minutes || 0) / 60
                return (
                  <tr key={d.id}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 3, background: d.color }} /><b>{d.name}</b></div></td>
                    <td>{d.start_time?.slice(0, 5)}</td>
                    <td>{d.end_time?.slice(0, 5)}</td>
                    <td>{d.break_minutes}分鐘</td>
                    <td style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{wh.toFixed(1)}h</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--text-muted)' }}>如需新增/編輯班別，請至「排班規則」頁面</div>
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
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {staffing
                    .sort((a, b) => {
                      // Sort by day_of_week (null first = all days), then time
                      const da = a.day_of_week ?? -1
                      const db = b.day_of_week ?? -1
                      if (da !== db) return da - db
                      return (a.time_start || '').localeCompare(b.time_start || '')
                    })
                    .map(s => (
                    <tr key={s.id}>
                      <td>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                          background: s.day_of_week === 0 || s.day_of_week === 6 ? 'rgba(239,68,68,0.1)' : s.day_of_week === null ? 'rgba(99,102,241,0.1)' : 'var(--glass-light)',
                          color: s.day_of_week === 0 || s.day_of_week === 6 ? 'var(--accent-red)' : s.day_of_week === null ? '#818cf8' : 'var(--text-primary)',
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
                        <button onClick={() => handleDeleteStaffing(s.id)} style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                          color: 'var(--text-muted)', opacity: 0.6,
                        }} title="刪除">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add new rule form */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', marginTop: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>新增人力需求規則</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            {/* Day selection */}
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>適用日</label>
              <select className="form-input" style={{ width: '100%', padding: '8px 10px', fontSize: 13 }}
                value={newStaff.day} onChange={e => setNewStaff(prev => ({ ...prev, day: e.target.value }))}>
                {DAY_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
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
              { label: '平日 3人', day: 'weekday', count: 3 },
              { label: '週末 4人', day: 'weekend', count: 4 },
              { label: '午間加班 2人', day: '', time_start: '11:00', time_end: '14:00', count: 2 },
              { label: '晚間加班 2人', day: '', time_start: '18:00', time_end: '22:00', count: 2 },
            ].map((preset, i) => (
              <button key={i} style={{
                padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-medium)',
                background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 11,
                cursor: 'pointer', fontWeight: 500,
              }} onClick={() => setNewStaff(prev => ({
                ...prev,
                day: preset.day ?? prev.day,
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
              <span style={{ width: 24, fontWeight: 700, color: i >= 5 ? 'var(--accent-red)' : 'var(--text-primary)' }}>{label}</span>
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
    </>
  )
}
