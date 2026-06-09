import { parseTime, getNetWorkHours, isWeekendDay, isAbsence, getCycleFor } from '../../../lib/scheduleUtils'

export default function AnalyticsTab({ filtered, schedules, weekDates, shiftDefs, storeSettings }) {
  const rate = storeSettings?.default_hourly_rate || 196
  const budget = storeSettings?.weekly_budget || 0

  const shiftDefMap = {}
  for (const d of (shiftDefs || [])) shiftDefMap[d.name] = d

  // Calculate per-employee stats
  const empStats = filtered.map(e => {
    const empSch = schedules.filter(s => s.employee === e.name)
    const work = empSch.filter(s => s.shift && !isAbsence(s.shift))
    const rest = empSch.filter(s => isAbsence(s.shift))

    let totalHours = 0
    let weekendShifts = 0
    let eveningShifts = 0

    for (const s of work) {
      // Use actual_hours if available, otherwise calculate from shift def
      if (s.actual_hours) {
        totalHours += s.actual_hours
      } else {
        const def = shiftDefMap[s.shift]
        if (def) {
          totalHours += getNetWorkHours(def)
        } else {
          totalHours += 8
        }
      }
      const dow = new Date(s.date).getDay()
      if (isWeekendDay(dow)) weekendShifts++
      const def = shiftDefMap[s.shift]
      if (def && parseTime(def.start_time) >= 15) eveningShifts++
    }

    const isPT = e.employment_type === '兼職' || e.employment_type === 'PT'
    const target = e.weekly_target_hours || (isPT ? 20 : 40)
    const cost = Math.round(totalHours * rate)
    const hoursRatio = target > 0 ? Math.round(totalHours / target * 100) : 0

    return {
      name: e.name, dept: e.dept, isPT,
      workDays: work.length, restDays: rest.length,
      totalHours: Math.round(totalHours * 10) / 10,
      target, hoursRatio, cost,
      weekendShifts, eveningShifts,
    }
  })

  const totalHours = empStats.reduce((s, e) => s + e.totalHours, 0)
  const totalCost = empStats.reduce((s, e) => s + e.cost, 0)
  const avgHours = empStats.length ? (totalHours / empStats.length).toFixed(1) : 0

  return (
    <div>
      {/* Summary stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總排班時數</div>
          <div className="stat-card-value">{Math.round(totalHours)}h</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">人均時數</div>
          <div className="stat-card-value">{avgHours}h</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">預估人力成本</div>
          <div className="stat-card-value">NT$ {totalCost.toLocaleString()}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>時薪 NT${rate}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': budget > 0 && totalCost > budget ? 'var(--accent-red)' : 'var(--accent-green)', '--card-accent-dim': budget > 0 && totalCost > budget ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">預算使用率</div>
          <div className="stat-card-value">{budget > 0 ? Math.round(totalCost / budget * 100) + '%' : '未設定'}</div>
          {budget > 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>預算 NT${budget.toLocaleString()}</div>}
        </div>
      </div>

      {/* Cycle Progress (only in variable mode) */}
      {storeSettings?.work_hour_system && storeSettings.work_hour_system !== '標準工時' && storeSettings?.variable_period_start && weekDates?.length > 0 && (() => {
        const ws = storeSettings.work_hour_system
        const anchor = storeSettings.variable_period_start
        // 用 view 起點 probe cycle，cycleMax 從 getWorkSystemConstraints 拿（跟演算法用同一張表）
        const cycle = getCycleFor(weekDates[0], ws, anchor)
        const cycleMax = cycle.periodTotalHours
        const ftMax = storeSettings?.ft_monthly_hours_max ?? 175
        const ptMax = storeSettings?.pt_monthly_hours_max ?? 175

        // 嚴格只算 cycle 範圍內的 schedules（避免月視圖跨 cycle 時加錯）
        const cycleHours = {}
        for (const s of schedules) {
          if (!s.date || s.date < cycle.start || s.date > cycle.end) continue
          if (!s.shift || isAbsence(s.shift)) continue
          if (!cycleHours[s.employee]) cycleHours[s.employee] = 0
          if (s.actual_hours) cycleHours[s.employee] += s.actual_hours
          else {
            const def = shiftDefMap[s.shift]
            if (def) cycleHours[s.employee] += getNetWorkHours(def)
            else cycleHours[s.employee] += 8
          }
        }

        // 警示：當前 view 範圍是否完整覆蓋這個 cycle (月視圖跨 cycle 時，本月不一定看到完整 cycle)
        const viewStart = weekDates[0]
        const viewEnd = weekDates[weekDates.length - 1]
        const cycleFullyVisible = viewStart <= cycle.start && viewEnd >= cycle.end
        const partialNote = !cycleFullyVisible ? '（顯示日期未完整覆蓋此 cycle，數值為已載入區間累計）' : ''

        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">📐</span> 本 Cycle 進度（{ws}）</div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Cycle #{cycle.cycleIndex + 1}: {cycle.start} ~ {cycle.end} · 法定上限 {cycleMax}h
              </span>
            </div>
            {partialNote && (
              <div style={{ padding: '6px 14px', fontSize: 11, color: 'var(--accent-orange)', background: 'rgba(251,146,60,0.06)' }}>
                ⚠ {partialNote}
              </div>
            )}
            <div className="data-table-wrapper">
              <table className="data-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>員工</th>
                    <th>類型</th>
                    <th style={{ textAlign: 'center' }}>已排時數</th>
                    <th style={{ textAlign: 'center' }}>個人 cap</th>
                    <th style={{ textAlign: 'center' }}>使用率</th>
                    <th style={{ width: 200 }}>進度</th>
                    <th style={{ textAlign: 'center' }}>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {empStats.map(es => {
                    const emp = filtered.find(f => f.name === es.name)
                    const storeMax = es.isPT ? ptMax : ftMax
                    const personalCap = emp?.personal_hour_cap
                    const effectiveCap = Math.min(cycleMax, personalCap ?? storeMax)
                    const hours = Math.round((cycleHours[es.name] || 0) * 10) / 10
                    const ratio = effectiveCap > 0 ? Math.round(hours / effectiveCap * 100) : 0
                    const isOver = hours > effectiveCap
                    const isWarning = !isOver && ratio >= 90
                    const isLow = !isOver && ratio < 50
                    return (
                      <tr key={es.name}>
                        <td style={{ fontWeight: 600 }}>{es.name}</td>
                        <td>
                          <span style={{
                            padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            background: es.isPT ? 'rgba(251,191,36,0.12)' : 'rgba(34,211,238,0.12)',
                            color: es.isPT ? '#f59e0b' : 'var(--accent-cyan)',
                          }}>
                            {es.isPT ? '兼職' : '全職'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{hours}h</td>
                        <td style={{ textAlign: 'center', color: personalCap != null ? 'var(--accent-purple)' : 'var(--text-muted)' }}>
                          {personalCap != null ? `${personalCap}h` : `(店${storeMax})`}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700,
                          color: isOver ? 'var(--accent-red)' : isWarning ? '#f59e0b' : isLow ? 'var(--text-muted)' : 'var(--accent-green)',
                        }}>{ratio}%</td>
                        <td>
                          <div style={{ height: 8, borderRadius: 4, background: 'var(--border-medium)', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', borderRadius: 4,
                              width: `${Math.min(ratio, 100)}%`,
                              background: isOver ? 'var(--accent-red)' : isWarning ? '#f59e0b' : 'var(--accent-green)',
                            }} />
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                            上限 {effectiveCap}h
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {isOver ? <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>⚠ 超</span>
                            : isWarning ? <span style={{ color: '#f59e0b' }}>近上限</span>
                            : isLow ? <span style={{ color: 'var(--text-muted)' }}>偏低</span>
                            : <span style={{ color: 'var(--accent-green)' }}>✓</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* Cost Breakdown */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">💰</span> 人力成本明細</div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>依實際排班計算</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>員工</th>
                <th>類型</th>
                <th style={{ textAlign: 'center' }}>上班天數</th>
                <th style={{ textAlign: 'center' }}>時數</th>
                <th style={{ textAlign: 'center' }}>目標達成</th>
                <th style={{ textAlign: 'right' }}>預估成本</th>
                <th style={{ width: 100 }}>成本占比</th>
              </tr>
            </thead>
            <tbody>
              {empStats.sort((a, b) => b.cost - a.cost).map(e => (
                <tr key={e.name}>
                  <td style={{ fontWeight: 600 }}>{e.name}</td>
                  <td>
                    <span style={{
                      padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: e.isPT ? 'rgba(251,191,36,0.12)' : 'rgba(34,211,238,0.12)',
                      color: e.isPT ? '#f59e0b' : 'var(--accent-cyan)',
                    }}>
                      {e.isPT ? '兼職' : '全職'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>{e.workDays}</td>
                  <td style={{ textAlign: 'center', fontWeight: 600, color: e.totalHours > e.target ? 'var(--accent-red)' : 'var(--accent-cyan)' }}>
                    {e.totalHours}h
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                      background: e.hoursRatio > 110 ? 'rgba(239,68,68,0.1)' : e.hoursRatio < 80 ? 'rgba(251,191,36,0.1)' : 'rgba(52,211,153,0.1)',
                      color: e.hoursRatio > 110 ? 'var(--accent-red)' : e.hoursRatio < 80 ? '#f59e0b' : 'var(--accent-green)',
                    }}>
                      {e.hoursRatio}%
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>NT$ {e.cost.toLocaleString()}</td>
                  <td>
                    <div style={{ height: 8, borderRadius: 4, background: 'var(--border-medium)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${totalCost > 0 ? (e.cost / totalCost) * 100 : 0}%`, borderRadius: 4, background: 'var(--accent-cyan)' }} />
                    </div>
                  </td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-medium)' }}>
                <td colSpan={3}>合計</td>
                <td style={{ textAlign: 'center', color: 'var(--accent-cyan)' }}>{Math.round(totalHours)}h</td>
                <td></td>
                <td style={{ textAlign: 'right', color: totalCost > budget && budget > 0 ? 'var(--accent-red)' : 'var(--accent-cyan)' }}>
                  NT$ {totalCost.toLocaleString()}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 班別分布 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">⚖️</span> 班別分布</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>員工</th>
                <th style={{ textAlign: 'center' }}>假日班</th>
                <th style={{ textAlign: 'center' }}>晚班</th>
                <th style={{ textAlign: 'center' }}>休息天</th>
              </tr>
            </thead>
            <tbody>
              {empStats.sort((a, b) => b.weekendShifts - a.weekendShifts).map(e => (
                <tr key={e.name}>
                  <td style={{ fontWeight: 600 }}>{e.name}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block', minWidth: 24, padding: '2px 6px', borderRadius: 6,
                      background: e.weekendShifts > 0 ? 'rgba(239,68,68,0.1)' : 'var(--glass-light)',
                      color: e.weekendShifts > 0 ? 'var(--accent-red)' : 'var(--text-muted)',
                      fontWeight: 700, fontSize: 13,
                    }}>
                      {e.weekendShifts}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block', minWidth: 24, padding: '2px 6px', borderRadius: 6,
                      background: e.eveningShifts > 0 ? 'rgba(139,92,246,0.1)' : 'var(--glass-light)',
                      color: e.eveningShifts > 0 ? '#8b5cf6' : 'var(--text-muted)',
                      fontWeight: 700, fontSize: 13,
                    }}>
                      {e.eveningShifts}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 600, color: e.restDays < 2 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                    {e.restDays}
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
