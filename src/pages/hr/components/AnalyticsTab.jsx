export default function AnalyticsTab({ filtered, schedules, weekDates, getShift, storeSettings }) {
  const weekSchedules = schedules.filter(s => s.shift && s.shift !== '休')
  const empStats = filtered.map(e => {
    const empSch = schedules.filter(s => s.employee === e.name)
    const work = empSch.filter(s => s.shift && s.shift !== '休').length
    const rest = empSch.filter(s => s.shift === '休').length
    const hours = work * 8
    const rate = storeSettings?.default_hourly_rate || 183
    return { name: e.name, dept: e.dept, work, rest, hours, cost: hours * rate }
  })
  const totalHours = empStats.reduce((s, e) => s + e.hours, 0)
  const totalCost = empStats.reduce((s, e) => s + e.cost, 0)
  const budget = storeSettings?.weekly_budget || 0
  const avgHours = empStats.length ? (totalHours / empStats.length).toFixed(1) : 0
  const maxWork = Math.max(...empStats.map(e => e.work), 0)
  const minWork = Math.min(...empStats.map(e => e.work), 7)

  return (
    <div>
      {/* Summary stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總排班時數</div>
          <div className="stat-card-value">{totalHours}h</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">人均時數</div>
          <div className="stat-card-value">{avgHours}h</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">預估人力成本</div>
          <div className="stat-card-value">NT$ {totalCost.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': budget > 0 && totalCost > budget ? 'var(--accent-red)' : 'var(--accent-green)', '--card-accent-dim': budget > 0 && totalCost > budget ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">預算使用率</div>
          <div className="stat-card-value">{budget > 0 ? Math.round(totalCost / budget * 100) + '%' : '未設定'}</div>
        </div>
      </div>

      {/* Fairness */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">⚖️</span> 公平性分析</div>
          <span style={{ fontSize: 12, color: maxWork - minWork > 2 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
            班次差距：{maxWork - minWork} 天 {maxWork - minWork > 2 ? '⚠️ 偏高' : '✓ 正常'}
          </span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>員工</th><th>部門</th><th>上班天數</th><th>休息天數</th><th>週時數</th><th>預估成本</th><th>分布</th></tr></thead>
            <tbody>
              {empStats.sort((a, b) => b.work - a.work).map(e => (
                <tr key={e.name}>
                  <td style={{ fontWeight: 600 }}>{e.name}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.dept}</td>
                  <td>{e.work} 天</td>
                  <td>{e.rest} 天</td>
                  <td style={{ color: e.hours > 40 ? 'var(--accent-red)' : 'var(--accent-cyan)', fontWeight: 600 }}>{e.hours}h</td>
                  <td>NT$ {e.cost.toLocaleString()}</td>
                  <td style={{ width: 120 }}>
                    <div style={{ height: 8, borderRadius: 4, background: 'var(--border-medium)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(e.work / 7) * 100}%`, borderRadius: 4, background: e.work > 5 ? 'var(--accent-red)' : 'var(--accent-cyan)' }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
