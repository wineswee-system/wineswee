import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { parseTime, getShiftHours, isWeekendDay, isAbsence } from '../../../lib/scheduleUtils'

export default function AnalyticsTab({ filtered, schedules, weekDates, shiftDefs, storeSettings, holidays = [] }) {
  const [fatigueScores, setFatigueScores] = useState({})
  const rate = storeSettings?.default_hourly_rate || 196
  const budget = storeSettings?.weekly_budget || 0

  const shiftDefMap = {}
  for (const d of (shiftDefs || [])) shiftDefMap[d.name] = d

  // Load fatigue scores
  useEffect(() => {
    const month = weekDates?.[0]?.slice(0, 7)
    if (!month) return
    supabase.from('fatigue_scores').select('employee, total_score')
      .eq('month', month)
      .then(({ data }) => {
        const map = {}
        for (const f of (data || [])) map[f.employee] = f.total_score || 0
        setFatigueScores(map)
      })
  }, [weekDates])

  // Calculate per-employee stats
  const empStats = filtered.map(e => {
    const empSch = schedules.filter(s => s.employee === e.name)
    const work = empSch.filter(s => s.shift && !isAbsence(s.shift))
    const rest = empSch.filter(s => isAbsence(s.shift))

    let totalHours = 0
    let weekendShifts = 0
    let eveningShifts = 0
    let weekFatigue = 0

    for (const s of work) {
      // Use actual_hours if available, otherwise calculate from shift def
      if (s.actual_hours) {
        totalHours += s.actual_hours
      } else {
        const def = shiftDefMap[s.shift]
        if (def) {
          totalHours += getShiftHours(def) - (def.break_minutes || 60) / 60
        } else {
          totalHours += 8
        }
      }
      const dow = new Date(s.date).getDay()
      if (isWeekendDay(dow)) weekendShifts++
      const def = shiftDefMap[s.shift]
      if (def && parseTime(def.start_time) >= 15) eveningShifts++

      // Calculate fatigue for this week
      const isHoliday = holidays.includes(s.date)
      const isWeekend = isWeekendDay(dow)
      const isMorning = def ? parseTime(def.start_time) < 15 : true
      if (isHoliday) weekFatigue += 4
      else if (isWeekend && !isMorning) weekFatigue += 3
      else if (isWeekend && isMorning) weekFatigue += 2
      else if (!isMorning) weekFatigue += 2
      else weekFatigue += 1
    }

    const isPT = e.employment_type === '兼職' || e.employment_type === 'PT'
    const target = e.weekly_target_hours || (isPT ? 20 : 40)
    const cost = Math.round(totalHours * rate)
    const hoursRatio = target > 0 ? Math.round(totalHours / target * 100) : 0
    const historicalFatigue = fatigueScores[e.name] || 0

    return {
      name: e.name, dept: e.dept, isPT,
      workDays: work.length, restDays: rest.length,
      totalHours: Math.round(totalHours * 10) / 10,
      target, hoursRatio, cost,
      weekendShifts, eveningShifts, weekFatigue,
      historicalFatigue,
    }
  })

  const totalHours = empStats.reduce((s, e) => s + e.totalHours, 0)
  const totalCost = empStats.reduce((s, e) => s + e.cost, 0)
  const avgHours = empStats.length ? (totalHours / empStats.length).toFixed(1) : 0
  const maxFatigue = Math.max(...empStats.map(e => e.weekFatigue), 0)
  const minFatigue = Math.min(...empStats.map(e => e.weekFatigue), 999)
  const fatigueDiff = maxFatigue - minFatigue

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

      {/* Fairness Dashboard */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">⚖️</span> 公平性儀表板</div>
          <span style={{ fontSize: 12, color: fatigueDiff > 5 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: 600 }}>
            辛苦度差距：{fatigueDiff} {fatigueDiff > 5 ? '⚠ 偏高' : '✓ 正常'}
          </span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>員工</th>
                <th style={{ textAlign: 'center' }}>假日班</th>
                <th style={{ textAlign: 'center' }}>晚班</th>
                <th style={{ textAlign: 'center' }}>本週辛苦度</th>
                <th style={{ textAlign: 'center' }}>月累計辛苦度</th>
                <th style={{ width: 150 }}>辛苦度分布</th>
                <th style={{ textAlign: 'center' }}>休息天</th>
              </tr>
            </thead>
            <tbody>
              {empStats.sort((a, b) => b.weekFatigue - a.weekFatigue).map(e => {
                const barWidth = maxFatigue > 0 ? (e.weekFatigue / maxFatigue) * 100 : 0
                const isHigh = e.weekFatigue >= maxFatigue && maxFatigue > 0
                const isLow = e.weekFatigue <= minFatigue && empStats.length > 1
                return (
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
                    <td style={{ textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block', padding: '3px 10px', borderRadius: 8,
                        background: isHigh ? 'rgba(239,68,68,0.12)' : isLow ? 'rgba(52,211,153,0.12)' : 'var(--glass-light)',
                        color: isHigh ? 'var(--accent-red)' : isLow ? 'var(--accent-green)' : 'var(--text-primary)',
                        fontWeight: 700, fontSize: 14,
                      }}>
                        {e.weekFatigue}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                      {e.historicalFatigue > 0 ? e.historicalFatigue : '—'}
                    </td>
                    <td>
                      <div style={{ height: 10, borderRadius: 5, background: 'var(--border-medium)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${barWidth}%`, borderRadius: 5,
                          background: isHigh ? 'var(--accent-red)' : isLow ? 'var(--accent-green)' : 'var(--accent-cyan)',
                          transition: 'width 0.3s',
                        }} />
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 600, color: e.restDays < 2 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                      {e.restDays}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--text-muted)' }}>
          辛苦度計分：平日早班 +1、平日晚班 +2、假日早班 +2、假日晚班 +3、國定假日 +4
        </div>
      </div>
    </div>
  )
}
