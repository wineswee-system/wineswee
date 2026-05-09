import { useState } from 'react'
import { AlertTriangle, Phone, UserPlus, Check, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { isAbsence, getShiftHours, isWeekendDay } from '../../../lib/scheduleUtils'
import { notifySchedulePublished } from '../../../lib/lineNotify'
import { empLabel } from '../../../lib/empLabel'

import { toast } from '../../../lib/toast'
/**
 * Emergency Cover Panel
 *
 * Quick flow for same-day sick calls:
 * 1. Select who called in sick
 * 2. System finds best replacement candidates
 * 3. Manager assigns with one click
 * 4. Optional: LINE notify the replacement
 */
export default function EmergencyCoverPanel({
  employees, schedules, shiftDefs, weekDates,
  storeFilter, locations, offRequests,
  onUpdate, // callback after cover assigned
}) {
  const [open, setOpen] = useState(false)
  const [sickEmployee, setSickEmployee] = useState('')
  const [sickDate, setSickDate] = useState(new Date().toISOString().slice(0, 10))
  const [candidates, setCandidates] = useState([])
  const [assigning, setAssigning] = useState(null)
  const [done, setDone] = useState(null)

  const shiftDefMap = {}
  for (const d of shiftDefs) shiftDefMap[d.name] = d

  const findCandidates = () => {
    if (!sickEmployee || !sickDate) return

    // Find what shift the sick employee was assigned
    const sickSchedule = schedules.find(s => s.employee === sickEmployee && s.date === sickDate)
    if (!sickSchedule || isAbsence(sickSchedule.shift)) {
      setCandidates([])
      return
    }

    const shiftName = sickSchedule.shift
    const shiftDef = shiftDefMap[shiftName]

    const offMap = new Set()
    for (const o of (offRequests || [])) offMap.add(`${o.employee}_${o.date}`)

    const results = []
    for (const emp of employees) {
      if (emp.name === sickEmployee) continue

      // Already working this day?
      const existing = schedules.find(s => s.employee === emp.name && s.date === sickDate)
      if (existing && !isAbsence(existing.shift)) continue

      // Has off request?
      if (offMap.has(`${emp.name}_${sickDate}`)) continue

      // Store eligibility
      const targetStore = locations?.find(l => l.name === storeFilter)
      const isFromStore = emp.store === storeFilter || emp.store_id === targetStore?.id
      const storeIds = emp.assigned_store_ids || []
      const canCross = storeIds.includes(targetStore?.id) || (emp.additional_stores || []).some(s => s === targetStore?.id || s === targetStore?.name)
      if (!isFromStore && !canCross) continue

      // Week work count
      const weekWork = weekDates.filter(d => {
        const s = schedules.find(x => x.employee === emp.name && x.date === d)
        return s && !isAbsence(s.shift)
      }).length
      if (weekWork >= 6) continue

      let score = 0
      const isOnRest = existing?.shift === '休'
      if (isOnRest) score += 30
      score += (6 - weekWork) * 5
      if (!isFromStore) score -= 10
      const isPT = emp.employment_type === '兼職' || emp.employment_type === 'PT'
      if (!isPT) score += 10

      results.push({
        emp,
        score,
        weekWork,
        isOnRest,
        isFromStore,
      })
    }

    results.sort((a, b) => b.score - a.score)
    setCandidates(results.slice(0, 8))
  }

  const handleAssign = async (emp) => {
    const sickSchedule = schedules.find(s => s.employee === sickEmployee && s.date === sickDate)
    if (!sickSchedule) return

    setAssigning(emp.name)

    try {
      // 1. Mark sick employee as 病假
      const { error: e1 } = await supabase.from('schedules')
        .update({ shift: '病', absence_type: '病' })
        .eq('id', sickSchedule.id)
      if (e1) throw new Error('標記病假失敗：' + e1.message)

      // 2. Assign replacement
      const existing = schedules.find(s => s.employee === emp.name && s.date === sickDate)
      if (existing) {
        const { error: e2 } = await supabase.from('schedules')
          .update({
            shift: sickSchedule.shift,
            actual_start: sickSchedule.actual_start,
            actual_end: sickSchedule.actual_end,
            actual_hours: sickSchedule.actual_hours,
          })
          .eq('id', existing.id)
        if (e2) throw new Error('指派代班失敗：' + e2.message)
      } else {
        const { error: e3 } = await supabase.from('schedules').insert({
          employee: emp.name,
          date: sickDate,
          shift: sickSchedule.shift,
          actual_start: sickSchedule.actual_start,
          actual_end: sickSchedule.actual_end,
          actual_hours: sickSchedule.actual_hours,
        })
        if (e3) throw new Error('指派代班失敗：' + e3.message)
      }

      // 3. Notify replacement via LINE
      await notifySchedulePublished(emp.name, sickDate, [{
        date: sickDate,
        shift: sickSchedule.shift,
        actual_start: sickSchedule.actual_start,
        actual_end: sickSchedule.actual_end,
      }])

      setDone({ sick: sickEmployee, cover: emp.name, shift: sickSchedule.shift })
      setSickEmployee('')
      setCandidates([])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAssigning(null)
      onUpdate?.()
    }
  }

  if (!open) {
    return (
      <button className="btn btn-secondary" onClick={() => setOpen(true)}
        style={{ width: 'auto', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Phone size={14} /> 緊急代班
      </button>
    )
  }

  const todayEmployees = employees.filter(emp => {
    const s = schedules.find(x => x.employee === emp.name && x.date === sickDate)
    return s && !isAbsence(s.shift)
  })

  return (
    <div className="card" style={{ marginBottom: 16, border: '2px solid rgba(239,68,68,0.4)' }}>
      <div className="card-header" style={{ background: 'rgba(239,68,68,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="card-title" style={{ color: 'var(--accent-red)' }}>
          <Phone size={16} /> 緊急代班
        </div>
        <button onClick={() => { setOpen(false); setCandidates([]); setDone(null) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <X size={16} />
        </button>
      </div>

      {done && (
        <div style={{ padding: '12px 16px', background: 'rgba(52,211,153,0.1)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Check size={16} style={{ color: 'var(--accent-green)' }} />
          <span style={{ fontSize: 13, color: 'var(--accent-green)', fontWeight: 600 }}>
            已將 {done.sick} 的 {done.shift} 改為病假，由 {done.cover} 代班（已 LINE 通知）
          </span>
        </div>
      )}

      <div style={{ padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>日期</label>
          <input className="form-input" type="date" value={sickDate}
            onChange={e => { setSickDate(e.target.value); setCandidates([]) }}
            style={{ width: 150 }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>誰請假？</label>
          <select className="form-input" value={sickEmployee}
            onChange={e => { setSickEmployee(e.target.value); setCandidates([]) }}
            style={{ width: 160 }}>
            <option value="">選擇員工</option>
            {todayEmployees.map(emp => {
              const s = schedules.find(x => x.employee === emp.name && x.date === sickDate)
              return <option key={emp.name} value={emp.name}>{empLabel(emp)}（{s?.shift}）</option>
            })}
          </select>
        </div>
        <button className="btn btn-primary btn-sm" onClick={findCandidates}
          disabled={!sickEmployee} style={{ padding: '8px 16px' }}>
          搜尋代班人選
        </button>
      </div>

      {candidates.length > 0 && (
        <div style={{ padding: '8px 16px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
            建議代班人選（點擊一鍵指派 + LINE 通知）
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {candidates.map(c => (
              <button key={c.emp.name} onClick={() => handleAssign(c.emp)}
                disabled={assigning === c.emp.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 8,
                  border: '1px solid var(--border-medium)',
                  background: 'var(--bg-card)', cursor: 'pointer', fontSize: 12,
                }}>
                <UserPlus size={12} style={{ color: 'var(--accent-cyan)' }} />
                <span style={{ fontWeight: 600 }}>{c.emp.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{c.weekWork}天/週</span>
                {c.isOnRest && <span style={{ fontSize: 9, color: '#f59e0b' }}>排休中</span>}
                {!c.isFromStore && <span style={{ fontSize: 9, color: '#8b5cf6' }}>跨店</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {candidates.length === 0 && sickEmployee && (
        <div style={{ padding: '8px 16px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          請點擊「搜尋代班人選」
        </div>
      )}
    </div>
  )
}
