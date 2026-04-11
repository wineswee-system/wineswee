import { supabase } from '../../../lib/supabase'

export default function PreferencesTab({ filtered, shiftDefs, preferences, setPreferences }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><span className="card-title-icon">👤</span> 員工排班偏好</div>
      </div>
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead><tr><th>員工</th><th>偏好班別</th><th>不可用日</th><th>最大連續天數</th><th>備註</th><th>操作</th></tr></thead>
          <tbody>
            {filtered.map(emp => {
              const pref = preferences.find(p => p.employee === emp.name)
              return (
                <tr key={emp.id}>
                  <td style={{ fontWeight: 600 }}>{emp.name}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {shiftDefs.map(d => {
                        const selected = pref?.preferred_shifts?.includes(d.name)
                        return (
                          <button key={d.id} onClick={async () => {
                            const current = pref?.preferred_shifts || []
                            const next = selected ? current.filter(s => s !== d.name) : [...current, d.name]
                            const { data } = await supabase.from('employee_shift_preferences').upsert({ employee: emp.name, preferred_shifts: next }, { onConflict: 'employee' }).select().single()
                            if (data) setPreferences(prev => [...prev.filter(p => p.employee !== emp.name), data])
                          }} style={{
                            padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            background: selected ? d.color + '30' : 'var(--bg-card)',
                            color: selected ? d.color : 'var(--text-muted)',
                            border: `1px solid ${selected ? d.color : 'var(--border-medium)'}`,
                          }}>{d.name}</button>
                        )
                      })}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pref?.unavailable_days?.join(', ') || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{pref?.max_consecutive || 6}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pref?.notes || '—'}</td>
                  <td>
                    <button className="btn btn-sm btn-secondary" onClick={async () => {
                      const notes = prompt('備註（例如：只能上早班、週三不行）', pref?.notes || '')
                      if (notes === null) return
                      const { data } = await supabase.from('employee_shift_preferences').upsert({ employee: emp.name, notes }, { onConflict: 'employee' }).select().single()
                      if (data) setPreferences(prev => [...prev.filter(p => p.employee !== emp.name), data])
                    }}>備註</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
