import { supabase } from '../../../lib/supabase'

function parseTime(t) {
  if (!t) return 0
  const [h, m] = String(t).split(':').map(Number)
  return (h || 0) + (m || 0) / 60
}

const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABELS_FULL = ['一', '二', '三', '四', '五', '六', '日']
const WORK_SYSTEMS = [
  { value: '標準工時', desc: '標準每週40小時，每日不超過8小時（勞基法§30-1）' },
  { value: '2週變形', desc: '2週內正常工時不超過84小時（勞基法§30-2）' },
  { value: '4週變形', desc: '4週內正常工時不超過160小時（勞基法§30-3）' },
  { value: '8週變形', desc: '8週內每週平均不超過40小時（勞基法§30-1）' },
]

export default function StoreSettingsTab({
  storeFilter, selectedStore, shiftDefs,
  storeSettings, setStoreSettings,
  staffing, setStaffing,
  operatingHours, setOperatingHours,
}) {
  if (!storeFilter) {
    return <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>請先選擇門市</div>
  }

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

      {/* Staffing Requirements */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">👥</span> 人力需求</div>
        </div>
        <div style={{ padding: '12px 16px' }}>
          {staffing.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>尚未設定（例如：早班×3人、晚班×2人）</div>
          ) : staffing.map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span><b>{s.shift_name}</b>{s.skill ? ` · ${s.skill}` : ''}</span>
              <span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{s.required_count} 人</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <select id="staffShift" className="form-input" style={{ flex: 1 }}>
              {shiftDefs.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
            <input id="staffCount" className="form-input" type="number" min={1} defaultValue={1} style={{ width: 60 }} />
            <button className="btn btn-primary btn-sm" onClick={async () => {
              const shift = document.getElementById('staffShift').value
              const count = parseInt(document.getElementById('staffCount').value) || 1
              if (!selectedStore) return
              const { data } = await supabase.from('store_staffing').upsert({ store_id: selectedStore.id, shift_name: shift, required_count: count }, { onConflict: 'store_id,shift_name,skill' }).select().single()
              if (data) setStaffing(prev => [...prev.filter(s => s.id !== data.id), data])
            }}>+ 新增</button>
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
