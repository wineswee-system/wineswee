import { useState } from 'react'
import { AlertTriangle, UserPlus, Check } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { isAbsence, getShiftHours, isWeekendDay } from '../../../lib/scheduleUtils'

/**
 * Staffing Gap Detection + Candidate Suggestion Panel
 *
 * Detects days where scheduled staff < required staff,
 * then suggests candidates the manager can assign with one click.
 */
export default function StaffingGapPanel({
  weekDates, schedules, employees, shiftDefs,
  staffingRules, offRequests, storeFilter, locations,
  onAssign, // (empName, date, shift) => void
}) {
  const [assigning, setAssigning] = useState(null) // "empName_date"

  if (!weekDates?.length || !staffingRules?.length) return null

  // Don't show gap panel if no schedules exist yet (nothing has been scheduled)
  const hasAnySchedules = schedules.some(s => weekDates.includes(s.date) && employees.some(e => e.name === s.employee))
  if (!hasAnySchedules) return null

  const shiftDefMap = {}
  for (const d of shiftDefs) shiftDefMap[d.name] = d

  const offMap = new Set()
  for (const o of (offRequests || [])) offMap.add(`${o.employee}_${o.date}`)

  // Detect gaps per date per shift
  const gaps = []
  for (const date of weekDates) {
    for (const rule of staffingRules) {
      const shiftName = rule.shift_name
      const required = rule.required_count || 0
      if (required <= 0) continue

      const scheduled = schedules.filter(s =>
        s.date === date && s.shift === shiftName &&
        employees.some(e => e.name === s.employee)
      ).length

      if (scheduled >= required) continue

      const deficit = required - scheduled
      gaps.push({ date, shiftName, required, scheduled, deficit })
    }
  }

  if (gaps.length === 0) return null

  // Find candidates for each gap
  const gapsWithCandidates = gaps.map(gap => {
    const candidates = []
    const dow = new Date(gap.date).getDay()
    const shiftDef = shiftDefMap[gap.shiftName]

    for (const emp of employees) {
      // Skip if already scheduled on this day
      const existing = schedules.find(s => s.employee === emp.name && s.date === gap.date)
      if (existing && !isAbsence(existing.shift)) continue

      // Skip if has off request
      if (offMap.has(`${emp.name}_${gap.date}`)) continue

      // Skip if already on rest (not from off_request, meaning algorithm gave rest)
      // These are the ones we CAN ask — they are resting but didn't request it
      const isOnAlgoRest = existing?.shift === '休' && !offMap.has(`${emp.name}_${gap.date}`)

      // Calculate how many days they've worked this week
      const weekWork = weekDates.filter(d => {
        const s = schedules.find(x => x.employee === emp.name && x.date === d)
        return s && !isAbsence(s.shift)
      }).length

      // Skip if already working 6 days (max consecutive)
      if (weekWork >= 6) continue

      // Check weekly hours
      let weekHours = 0
      weekDates.forEach(d => {
        const s = schedules.find(x => x.employee === emp.name && x.date === d)
        if (s && !isAbsence(s.shift)) {
          const def = shiftDefMap[s.shift]
          weekHours += def ? getShiftHours(def) - (def.break_minutes || 60) / 60 : 8
        }
      })
      const targetH = emp.weekly_target_hours || 40
      if (weekHours >= targetH + 8) continue

      // Score candidate
      let score = 0
      const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT'

      // Prefer people already resting (not by request) — they can be asked
      if (isOnAlgoRest) score += 30

      // Prefer people with fewer work days
      score += (6 - weekWork) * 5

      // Prefer people under target hours
      score += Math.max(0, (targetH - weekHours)) * 2

      // Prefer full-time over part-time for fill-ins
      if (!isPT) score += 10

      // Check cross-store eligibility
      const targetStore = locations?.find(l => l.name === storeFilter)
      const isFromThisStore = emp.store === storeFilter || emp.store_id === targetStore?.id
      const storeIds = emp.assigned_store_ids || []
      const canCrossStore = storeIds.includes(targetStore?.id)
        || (emp.additional_stores || []).some(s => s === targetStore?.id || s === targetStore?.name)
      if (!isFromThisStore && !canCrossStore) continue
      if (!isFromThisStore) score -= 5 // Slight penalty for cross-store

      candidates.push({
        emp,
        score,
        weekWork,
        weekHours: Math.round(weekHours),
        isOnRest: isOnAlgoRest,
        isFromThisStore,
        reason: isOnAlgoRest ? '當天排休（非請假）' : existing ? '' : '未排班',
      })
    }

    candidates.sort((a, b) => b.score - a.score)
    return { ...gap, candidates: candidates.slice(0, 5) }
  })

  const handleAssign = async (empName, date, shiftName) => {
    setAssigning(`${empName}_${date}`)
    if (onAssign) {
      await onAssign(empName, date, shiftName)
    }
    setAssigning(null)
  }

  return (
    <div className="card" style={{ marginBottom: 16, border: '2px solid rgba(239,68,68,0.3)' }}>
      <div className="card-header" style={{ background: 'rgba(239,68,68,0.05)' }}>
        <div className="card-title" style={{ color: 'var(--accent-red)' }}>
          <AlertTriangle size={16} /> 人力缺口警報 — {gaps.reduce((s, g) => s + g.deficit, 0)} 人次不足
        </div>
      </div>

      {gapsWithCandidates.map((gap, i) => {
        const dow = ['日', '一', '二', '三', '四', '五', '六'][new Date(gap.date).getDay()]
        const isWeekend = isWeekendDay(new Date(gap.date).getDay())
        return (
          <div key={i} style={{ padding: '12px 16px', borderBottom: i < gapsWithCandidates.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
            {/* Gap info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                background: isWeekend ? 'rgba(239,68,68,0.1)' : 'var(--glass-light)',
                color: isWeekend ? 'var(--accent-red)' : 'var(--text-primary)',
              }}>
                {gap.date.slice(5)} (週{dow})
              </span>
              <span style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                background: (shiftDefMap[gap.shiftName]?.color || '#22d3ee') + '20',
                color: shiftDefMap[gap.shiftName]?.color || '#22d3ee',
              }}>
                {gap.shiftName}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-red)' }}>
                缺 {gap.deficit} 人（{gap.scheduled}/{gap.required}）
              </span>
            </div>

            {/* Candidates */}
            {gap.candidates.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: 8 }}>
                無可用候選人 — 請考慮跨店調度
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {gap.candidates.map(c => {
                  const key = `${c.emp.name}_${gap.date}`
                  const isAssigning = assigning === key
                  return (
                    <button key={c.emp.name} onClick={() => handleAssign(c.emp.name, gap.date, gap.shiftName)}
                      disabled={isAssigning}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 12px', borderRadius: 8,
                        border: '1px solid var(--border-medium)',
                        background: 'var(--bg-card)', cursor: 'pointer',
                        fontSize: 12, transition: 'all 0.15s',
                      }}
                      title={`${c.emp.name}：本週已上 ${c.weekWork} 天 / ${c.weekHours}h${c.reason ? ' · ' + c.reason : ''}${!c.isFromThisStore ? ' · 跨店' : ''}`}
                    >
                      <UserPlus size={12} style={{ color: 'var(--accent-cyan)' }} />
                      <span style={{ fontWeight: 600 }}>{c.emp.name}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                        {c.weekWork}天/{c.weekHours}h
                      </span>
                      {c.isOnRest && <span style={{ fontSize: 9, color: '#f59e0b' }}>排休中</span>}
                      {!c.isFromThisStore && <span style={{ fontSize: 9, color: '#8b5cf6' }}>跨店</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
