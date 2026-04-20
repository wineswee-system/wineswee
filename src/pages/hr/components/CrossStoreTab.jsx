import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { isAbsence } from '../../../lib/scheduleUtils'

export default function CrossStoreTab({ storeFilter, locations, shiftDefs, weekDates }) {
  const [allEmployees, setAllEmployees] = useState([])
  const [staffingData, setStaffingData] = useState({}) // storeId → [staffing rules]
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!weekDates?.length) return
    setLoading(true)
    Promise.all([
      supabase.from('employees').select('id, name, store_id, additional_stores, employment_type, position, stores(name)').eq('status', '在職'),
      supabase.from('store_staffing').select('*'),
      supabase.from('schedules').select('employee, date, shift').gte('date', weekDates[0]).lte('date', weekDates[weekDates.length - 1]),
    ]).then(([e, s, sc]) => {
      setAllEmployees(e.data || [])
      // Group staffing by store
      const map = {}
      for (const r of (s.data || [])) {
        if (!map[r.store_id]) map[r.store_id] = []
        map[r.store_id].push(r)
      }
      setStaffingData(map)
      setSchedules(sc.data || [])
      setLoading(false)
    })
  }, [weekDates])

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>載入中...</div>

  // Calculate staffing status per store per date
  const storeStatus = locations.filter(loc => {
    // Filter out non-operational stores
    const empCount = allEmployees.filter(e => e.store === loc.name).length
    return empCount > 0
  }).map(loc => {
    const storeEmps = allEmployees.filter(e => e.store === loc.name)
    const storeRules = staffingData[loc.id] || []

    const dailyStatus = weekDates.map(date => {
      const daySchedules = schedules.filter(s => storeEmps.some(e => e.name === s.employee) && s.date === date && !isAbsence(s.shift))

      // Count scheduled per shift
      const scheduledByShift = {}
      daySchedules.forEach(s => { scheduledByShift[s.shift] = (scheduledByShift[s.shift] || 0) + 1 })
      const scheduled = daySchedules.length

      // Required: sum per-shift requirements, check deficit per shift
      let required = 0
      let deficit = 0
      for (const rule of storeRules) {
        const need = rule.required_count || 0
        const have = scheduledByShift[rule.shift_name] || 0
        required += need
        deficit += Math.max(0, need - have)
      }
      // If no rules configured, show scheduled count without deficit
      if (storeRules.length === 0) {
        required = 0
        deficit = 0
      }

      return { date, scheduled, required, deficit }
    })

    const totalDeficit = dailyStatus.reduce((sum, d) => sum + Math.max(0, d.deficit), 0)

    // Find employees who can support this store from other stores
    const supporters = allEmployees.filter(e => {
      if (e.store === loc.name || e.store_id === loc.id) return false
      const additional = e.additional_stores || []
      const storeIds = e.assigned_store_ids || []
      return storeIds.includes(loc.id) || additional.includes(loc.id) || additional.includes(loc.name)
    })

    return { store: loc, storeEmps, dailyStatus, totalDeficit, supporters }
  })

  const storesNeedingHelp = storeStatus.filter(s => s.totalDeficit > 0)

  return (
    <div>
      {/* Overview */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">營運門市</div>
          <div className="stat-card-value">{storeStatus.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': storesNeedingHelp.length > 0 ? 'var(--accent-red)' : 'var(--accent-green)', '--card-accent-dim': storesNeedingHelp.length > 0 ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">人力不足門市</div>
          <div className="stat-card-value">{storesNeedingHelp.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">總缺口人天</div>
          <div className="stat-card-value">{storeStatus.reduce((s, st) => s + st.totalDeficit, 0)}</div>
        </div>
      </div>

      {/* Per-store status */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">🏪</span> 各門市人力狀態</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{weekDates[0]} ~ {weekDates[weekDates.length - 1]}</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>門市</th>
                <th style={{ textAlign: 'center' }}>員工數</th>
                {weekDates.map(d => {
                  const dow = ['日', '一', '二', '三', '四', '五', '六'][new Date(d).getDay()]
                  return <th key={d} style={{ textAlign: 'center', fontSize: 11 }}>{dow}<br />{d.slice(8)}</th>
                })}
                <th style={{ textAlign: 'center' }}>可支援</th>
              </tr>
            </thead>
            <tbody>
              {storeStatus.map(({ store, storeEmps, dailyStatus, totalDeficit, supporters }) => (
                <tr key={store.id} style={{ background: totalDeficit > 0 ? 'rgba(239,68,68,0.03)' : undefined }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>
                      {store.name}
                      {totalDeficit > 0 && <span style={{ color: 'var(--accent-red)', fontSize: 11, marginLeft: 4 }}>⚠</span>}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>{storeEmps.length}</td>
                  {dailyStatus.map(d => (
                    <td key={d.date} style={{ textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block', minWidth: 28, padding: '2px 4px', borderRadius: 6,
                        fontSize: 12, fontWeight: 700,
                        background: d.deficit > 0 ? 'rgba(239,68,68,0.12)' : d.scheduled > 0 ? 'rgba(52,211,153,0.12)' : 'var(--glass-light)',
                        color: d.deficit > 0 ? 'var(--accent-red)' : d.scheduled > 0 ? 'var(--accent-green)' : 'var(--text-muted)',
                      }}>
                        {d.scheduled}/{d.required || '?'}
                      </span>
                    </td>
                  ))}
                  <td style={{ textAlign: 'center' }}>
                    {supporters.length > 0 ? (
                      <span style={{ fontSize: 11, color: 'var(--accent-cyan)' }}>
                        {supporters.map(s => s.name).join('、')}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>無</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {storesNeedingHelp.length === 0 && (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--accent-green)', fontSize: 13, fontWeight: 600 }}>
            ✓ 所有門市人力充足
          </div>
        )}
      </div>
    </div>
  )
}
