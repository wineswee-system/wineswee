import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Sparkles, CalendarOff, AlertTriangle, Shield, Info } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { validateSchedule, LABOR_STANDARDS, GENDER_EQUALITY, OCCUPATIONAL_SAFETY } from '../../lib/laborLaw'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal from '../../components/Modal'

// Parse time string "HH:MM" to decimal hours (e.g., "09:30" -> 9.5)
function parseTime(t) {
  if (!t) return 0
  const [h, m] = String(t).split(':').map(Number)
  return (h || 0) + (m || 0) / 60
}

// Fallback shift types (used if DB hasn't loaded yet)
const REST_SHIFT = { label: '休', color: 'var(--text-muted)', dim: 'var(--glass-medium)' }

function hexToDim(hex) {
  return hex + '20'
}

function buildShiftTypes(dbShifts) {
  const fromDB = dbShifts.map(s => ({
    label: s.name,
    color: s.color || 'var(--accent-cyan)',
    dim: hexToDim(s.color || '#22d3ee'),
    start_time: s.start_time?.slice(0, 5),
    end_time: s.end_time?.slice(0, 5),
  }))
  return [...fromDB, REST_SHIFT]
}

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function getWeekDates(offset = 0) {
  const now = new Date()
  const dayOfWeek = now.getDay() || 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - dayOfWeek + 1 + offset * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d.toISOString().slice(0, 10)
  })
}

export default function Schedule() {
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [locations, setLocations] = useState([])
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)
  const [deptFilter, setDeptFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [editCell, setEditCell] = useState(null)
  const [offRequests, setOffRequests] = useState([])
  const [holidays, setHolidays] = useState([]) // ['2026-04-04', ...]
  const [shiftDefs, setShiftDefs] = useState([])
  const [SHIFT_TYPES, setShiftTypes] = useState([REST_SHIFT])
  const [autoScheduling, setAutoScheduling] = useState(false)
  const [minStaff, setMinStaff] = useState(3)
  const [showLawModal, setShowLawModal] = useState(false)
  const [compliance, setCompliance] = useState({ errors: [], warnings: [], isValid: true })
  const [error, setError] = useState(null)
  const [mainTab, setMainTab] = useState('schedule') // schedule | store-settings | preferences | swaps | analytics
  // Store settings
  const [storeSettings, setStoreSettings] = useState(null)
  const [staffing, setStaffing] = useState([])
  const [operatingHours, setOperatingHours] = useState({})
  // Preferences
  const [preferences, setPreferences] = useState([])
  // Swap requests
  const [swaps, setSwaps] = useState([])
  // Cover shift finder
  const [coverModal, setCoverModal] = useState(null) // { employee, date, shift }
  const [coverCandidates, setCoverCandidates] = useState([])
  const [coverLoading, setCoverLoading] = useState(false)

  const weekDates = getWeekDates(weekOffset)
  const weekStart = weekDates[0]
  const weekEnd = weekDates[6]

  useEffect(() => {
    Promise.all([
      supabase.from('employees').select('id, name, dept, position, store, employment_type, schedule_priority, can_open, can_close, additional_stores').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('stores').select('*').order('name'),
      supabase.from('shift_definitions').select('*').order('sort_order'),
      supabase.from('holidays').select('date'),
    ]).then(([e, d, l, sd, hd]) => {
      setEmployees(e.data || [])
      setDepartments(d.data || [])
      setLocations(l.data || [])
      const defs = sd.data || []
      setShiftDefs(defs)
      setShiftTypes(buildShiftTypes(defs))
      setHolidays((hd.data || []).map(h => h.date))
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    Promise.all([
      supabase.from('schedules').select('*').gte('date', weekStart).lte('date', weekEnd),
      supabase.from('off_requests').select('*').gte('date', weekStart).lte('date', weekEnd),
    ]).then(([s, o]) => {
      setSchedules(s.data || [])
      setOffRequests(o.data || [])
    }).catch(err => {
      console.error('Failed to load schedule data:', err)
    })
  }, [weekStart])

  // Run compliance check when schedules update
  useEffect(() => {
    if (schedules.length > 0) {
      setCompliance(validateSchedule(schedules, weekDates, shiftDefs))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, weekStart])

  const getShift = (empName, date) => {
    const s = schedules.find(s => s.employee === empName && s.date === date)
    return s?.shift || ''
  }

  const handleSetShift = async (empName, date, shift) => {
    const existing = schedules.find(s => s.employee === empName && s.date === date)
    if (existing) {
      const { data } = await supabase.from('schedules').update({ shift }).eq('id', existing.id).select().single()
      if (data) setSchedules(prev => prev.map(s => s.id === existing.id ? data : s))
    } else {
      const { data } = await supabase.from('schedules').insert({ employee: empName, date, shift }).select().single()
      if (data) setSchedules(prev => [...prev, data])
    }
    setEditCell(null)
  }

  const getOffRequest = (empName, date) => offRequests.find(o => o.employee === empName && o.date === date)

  // Get available shifts for a specific store (store-specific + global)
  const getStoreShifts = (storeName, empType = 'all') => {
    const store = locations.find(l => l.name === storeName)
    const storeId = store?.id
    return shiftDefs.filter(d => {
      // Match store: store-specific OR global (no store_id)
      const storeMatch = !d.store_id || d.store_id === storeId
      // Match employee type
      const typeMatch = !d.employee_type || d.employee_type === 'all' || d.employee_type === empType
      return storeMatch && typeMatch
    })
  }

  // AI Auto-Schedule
  const holidaySet = new Set(holidays)

  // ── Cover Shift Finder: find who can replace a shift ──
  const findCoverCandidates = async (absentEmp, date, shiftName) => {
    setCoverLoading(true)
    setCoverCandidates([])

    const shiftDef = shiftDefs.find(d => d.name === shiftName)
    const shiftStartH = shiftDef ? parseTime(shiftDef.start_time) || 11 : 11
    const absentStore = employees.find(e => e.name === absentEmp)?.store || ''

    // Get schedules for the full week + adjacent days (for 11h rule + rest day count)
    const prevDate = new Date(new Date(date).getTime() - 86400000).toISOString().slice(0, 10)
    const nextDate = new Date(new Date(date).getTime() + 86400000).toISOString().slice(0, 10)
    const { data: nearbySchedules } = await supabase.from('schedules')
      .select('*').gte('date', weekStart).lte('date', weekEnd)

    const allSchedules = nearbySchedules || []
    const candidates = []

    for (const emp of employees) {
      if (emp.name === absentEmp) continue
      if (emp.status !== '在職') continue

      // Check if same store (or willing to cross-store)
      const sameStore = emp.store === absentStore || (emp.additional_stores || []).includes(absentStore)
      // Check if already working that day
      const daySchedule = allSchedules.find(s => s.employee === emp.name && s.date === date)
      if (daySchedule && daySchedule.shift !== '休') continue // already working

      // Check 11h rule with previous day
      const prevSchedule = allSchedules.find(s => s.employee === emp.name && s.date === prevDate)
      let valid11h = true
      if (prevSchedule && prevSchedule.shift !== '休') {
        const prevDef = shiftDefs.find(d => d.name === prevSchedule.shift)
        if (prevDef) {
          const prevEndH = parseTime(prevDef.end_time)
          const prevStartH = parseTime(prevDef.start_time)
          const crossesMidnight = prevEndH < prevStartH
          if (crossesMidnight) {
            const gap = shiftStartH - prevEndH
            if (gap < 11) valid11h = false
          } else {
            const gap = shiftStartH + (24 - prevEndH)
            if (gap < 11) valid11h = false
          }
        }
      }

      // Check 11h rule with next day
      const nextSchedule = allSchedules.find(s => s.employee === emp.name && s.date === nextDate)
      if (nextSchedule && nextSchedule.shift !== '休' && shiftDef) {
        const nextDef = shiftDefs.find(d => d.name === nextSchedule.shift)
        if (nextDef) {
          const endH = parseTime(shiftDef.end_time)
          const startH = parseTime(shiftDef.start_time)
          const crossesMidnight = endH < startH
          const nextStartH = parseTime(nextDef.start_time) || 11
          // If crosses midnight: shift ends at endH on NEXT day morning, gap = nextStart - endH
          // If normal: shift ends today, gap = nextStart + 24 - endH (next day)
          const gap = crossesMidnight ? (nextStartH - endH) : (nextStartH + 24 - endH)
          if (gap < 11) valid11h = false
        }
      }

      // Count rest days this week
      const weekSchedules = allSchedules.filter(s => s.employee === emp.name)
      const restDays = weekSchedules.filter(s => s.shift === '休').length
      const wouldLoseRest = daySchedule?.shift === '休' && restDays <= 2

      const isPT = emp.position?.includes('PT') || emp.employment_type === 'PT'

      candidates.push({
        name: emp.name,
        dept: emp.dept,
        store: emp.store,
        position: emp.position,
        isPT,
        sameStore,
        isOff: !daySchedule || daySchedule.shift === '休',
        valid11h,
        wouldLoseRest,
        restDays,
        score: (sameStore ? 30 : 0) + (valid11h ? 20 : 0) + (!wouldLoseRest ? 15 : 0) + (!isPT && !shiftName.includes('18') ? 10 : 0) + (restDays > 2 ? 5 : 0),
      })
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score)
    setCoverCandidates(candidates.filter(c => c.isOff && c.valid11h))
    setCoverLoading(false)
  }

  const handleAssignCover = async (coverEmpName, date, shift) => {
    const { data } = await supabase.from('schedules').upsert({ employee: coverEmpName, date, shift }, { onConflict: 'employee,date' }).select().single()
    if (data) {
      setSchedules(prev => {
        const idx = prev.findIndex(s => s.employee === coverEmpName && s.date === date)
        if (idx >= 0) return prev.map((s, i) => i === idx ? data : s)
        return [...prev, data]
      })
    }
    setCoverModal(null)
    alert(`已指派 ${coverEmpName} 代班 ${shift}`)
  }

  const handleAutoSchedule = async () => {
    if (!confirm(`將為 ${filtered.length} 位員工自動排班（${weekStart} ~ ${weekEnd}）\n已有的排班會保留，空白格子才會填入。\n每天最少 ${minStaff} 人上班。`)) return
    setAutoScheduling(true)

    // Sort employees by schedule_priority (1=highest) — high priority gets scheduled first for peak slots
    const sortedEmps = [...filtered].sort((a, b) => (a.schedule_priority || 3) - (b.schedule_priority || 3))
    const empNames = sortedEmps.map(e => e.name)
    const newSchedules = []

    // Build existing schedule map
    const existing = {}
    for (const s of schedules) {
      existing[`${s.employee}_${s.date}`] = s.shift
    }

    // Build off-request map
    const offMap = {}
    for (const o of offRequests) {
      offMap[`${o.employee}_${o.date}`] = true
    }

    // For each employee, count how many rest days they already have this week
    const restCount = {}
    empNames.forEach(name => { restCount[name] = 0 })
    for (const date of weekDates) {
      for (const name of empNames) {
        const key = `${name}_${date}`
        if (existing[key] === '休') restCount[name]++
      }
    }

    // Auto-fill empty cells
    for (const date of weekDates) {
      const dayIndex = weekDates.indexOf(date) // 0=Mon ... 6=Sun

      // Count how many people already scheduled to work this day
      let workingCount = 0
      for (const name of empNames) {
        const key = `${name}_${date}`
        if (existing[key] && existing[key] !== '休') workingCount++
      }

      // Fill unscheduled employees
      for (const name of empNames) {
        const key = `${name}_${date}`
        if (existing[key]) continue // already scheduled

        // Check if employee requested off or is a holiday
        if (offMap[key] || holidaySet.has(date)) {
          newSchedules.push({ employee: name, date, shift: '休' })
          restCount[name]++
          existing[key] = '休'
          continue
        }

        // Each person gets 2 rest days per week (勞基法 §36)
        const needRest = restCount[name] < 2
        const isWeekend = dayIndex >= 5
        // Count how many unscheduled people remain for today
        const unscheduledToday = empNames.filter(n => !existing[`${n}_${date}`]).length
        const futureWorkersEstimate = workingCount + unscheduledToday - 1 // if this person rests
        const canRest = futureWorkersEstimate >= minStaff

        if (needRest && canRest && (isWeekend || dayIndex >= 3 || restCount[name] === 0)) {
          newSchedules.push({ employee: name, date, shift: '休' })
          restCount[name]++
          existing[key] = '休'
        } else if (needRest && dayIndex === 6 && restCount[name] < 2) {
          // Last day of week — force rest if still needed, even if understaffed
          newSchedules.push({ employee: name, date, shift: '休' })
          restCount[name]++
          existing[key] = '休'
        } else {
          // Assign a work shift — check 11h interval with previous day
          const prevDate = dayIndex > 0 ? weekDates[dayIndex - 1] : null
          const prevShift = prevDate ? existing[`${name}_${prevDate}`] : null
          const prevDef = prevShift && prevShift !== '休' ? shiftDefs.find(d => d.name === prevShift) : null

          // Calculate when previous shift actually ends
          // Night shift (e.g., 22:00-06:00): ends next morning, so effective end = 06:00 on CURRENT day
          let prevEndEffective = null
          if (prevDef) {
            const prevStartH = parseTime(prevDef.start_time)
            const prevEndH = parseTime(prevDef.end_time)
            const crossesMidnight = prevEndH < prevStartH // e.g., 22-06
            // If crosses midnight, prev shift ends at prevEndH on CURRENT day (morning)
            // Gap = candidate start on current day - prevEndH on current day
            prevEndEffective = crossesMidnight ? prevEndH : null // null means normal shift, use 24-based calc
          }

          // Find a valid shift with ≥ 11h gap — use store-specific shifts
          let assigned = false
          const emp = filtered.find(e => e.name === name)
          const empStore = emp?.store || storeFilter || ''
          const isPT = emp?.position?.includes('PT') || emp?.employment_type === 'PT'
          const empType = isPT ? 'pt' : 'full_time'
          const availableShifts = getStoreShifts(empStore, empType).map(d => d.name)
          const workShifts = availableShifts.length > 0 ? availableShifts : SHIFT_TYPES.filter(t => t.label !== '休').map(t => t.label)

          const startIdx = (empNames.indexOf(name) + dayIndex) % workShifts.length
          for (let attempt = 0; attempt < workShifts.length; attempt++) {
            const candidateName = workShifts[(startIdx + attempt) % workShifts.length]
            const candidateDef = shiftDefs.find(d => d.name === candidateName)
            const candidateStartH = candidateDef ? parseTime(candidateDef.start_time) || 9 : 9

            // Check 11h gap with PREVIOUS day
            if (prevDef) {
              let gap
              if (prevEndEffective !== null) {
                gap = candidateStartH - prevEndEffective
              } else {
                const prevEndH = parseTime(prevDef.end_time)
                gap = candidateStartH + (24 - prevEndH)
              }
              if (gap < 11) continue
            }

            // Check 11h gap with NEXT day (if already scheduled)
            const nextDate = dayIndex < 6 ? weekDates[dayIndex + 1] : null
            const nextShift = nextDate ? existing[`${name}_${nextDate}`] : null
            const nextDef = nextShift && nextShift !== '休' ? shiftDefs.find(d => d.name === nextShift) : null
            if (nextDef && candidateDef) {
              const candEndH = parseTime(candidateDef.end_time)
              const candStartH2 = parseTime(candidateDef.start_time)
              const candCrosses = candEndH < candStartH2
              const nextStartH = parseTime(nextDef.start_time) || 11
              const fwdGap = candCrosses ? (nextStartH - candEndH) : (nextStartH + 24 - candEndH)
              if (fwdGap < 11) continue
            }

            newSchedules.push({ employee: name, date, shift: candidateName })
            workingCount++
            existing[key] = candidateName
            assigned = true
            break
          }
          // Fallback: if no valid shift, force rest (better than violating labor law)
          if (!assigned) {
            newSchedules.push({ employee: name, date, shift: '休' })
            restCount[name]++
            existing[key] = '休'
          }
        }
      }
    }

    // Batch upsert
    if (newSchedules.length > 0) {
      const { data } = await supabase.from('schedules').upsert(newSchedules, { onConflict: 'employee,date' }).select()
      if (data) {
        setSchedules(prev => {
          const map = {}
          for (const s of [...prev, ...data]) map[`${s.employee}_${s.date}`] = s
          return Object.values(map)
        })
      }
    }

    setAutoScheduling(false)
    alert(`自動排班完成！填入 ${newSchedules.length} 個班次`)
  }

  // Load tab-specific data (must be before early returns to maintain hook order)
  useEffect(() => {
    if (mainTab === 'store-settings' && storeFilter) {
      const store = locations.find(s => s.name === storeFilter)
      if (store) {
        supabase.from('store_settings').select('*').eq('store_id', store.id).maybeSingle()
          .then(({ data }) => { setStoreSettings(data); if (data?.operating_hours) setOperatingHours(data.operating_hours) })
        supabase.from('store_staffing').select('*').eq('store_id', store.id)
          .then(({ data }) => setStaffing(data || []))
      }
    }
    if (mainTab === 'preferences') {
      supabase.from('employee_shift_preferences').select('*').order('employee')
        .then(({ data }) => setPreferences(data || []))
    }
    if (mainTab === 'swaps') {
      supabase.from('shift_swaps').select('*').order('created_at', { ascending: false })
        .then(({ data }) => setSwaps(data || []))
    }
  }, [mainTab, storeFilter])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = employees.filter(e =>
    (deptFilter === '' || e.dept === deptFilter) &&
    (storeFilter === '' || e.store === storeFilter)
  )

  const btnStyle = (active) => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500,
  })

  const getShiftStyle = (shift) => {
    const type = SHIFT_TYPES.find(t => t.label === shift)
    if (!type) return {}
    return { background: type.dim, color: type.color, border: `1px solid ${type.color}30` }
  }

  const selectedStore = locations.find(s => s.name === storeFilter)
  const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const DAY_LABELS_FULL = ['一', '二', '三', '四', '五', '六', '日']
  const WORK_SYSTEMS = [
    { value: '標準工時', desc: '標準每週40小時，每日不超過8小時（勞基法§30-1）' },
    { value: '2週變形', desc: '2週內正常工時不超過84小時（勞基法§30-2）' },
    { value: '4週變形', desc: '4週內正常工時不超過160小時（勞基法§30-3）' },
    { value: '8週變形', desc: '8週內每週平均不超過40小時（勞基法§30-1）' },
  ]

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📅</span> 排班管理</h2>
            <p>管理班表、排班偏好與AI自動排班</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              最少上班
              <input type="number" className="form-input" style={{ width: 50, padding: '4px 8px', fontSize: 12, textAlign: 'center' }}
                value={minStaff} onChange={e => setMinStaff(Number(e.target.value) || 1)} min={1} />
              人/天
            </div>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={async () => {
              // Copy last week's schedule
              const lastWeek = getWeekDates(weekOffset - 1)
              const { data: lastSchedules } = await supabase.from('schedules').select('*').gte('date', lastWeek[0]).lte('date', lastWeek[6])
              if (!lastSchedules?.length) { alert('上週無排班資料'); return }
              const newSchedules = lastSchedules.map(s => {
                const dayIdx = lastWeek.indexOf(s.date)
                return dayIdx >= 0 ? { employee: s.employee, date: weekDates[dayIdx], shift: s.shift } : null
              }).filter(Boolean)
              if (newSchedules.length > 0) {
                const { data } = await supabase.from('schedules').upsert(newSchedules, { onConflict: 'employee,date' }).select()
                if (data) setSchedules(prev => { const map = {}; for (const s of [...prev, ...data]) map[`${s.employee}_${s.date}`] = s; return Object.values(map) })
                alert(`已複製 ${newSchedules.length} 筆排班`)
              }
            }}>
              📋 複製上週
            </button>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={async () => {
              const empNames = filtered.map(e => e.name)
              if (!confirm(`確定要清除本週（${weekStart} ~ ${weekEnd}）${storeFilter || '所有門市'} 共 ${empNames.length} 人的排班嗎？`)) return
              await supabase.from('schedules').delete().in('employee', empNames).gte('date', weekStart).lte('date', weekEnd)
              setSchedules(prev => prev.filter(s => !empNames.includes(s.employee) || s.date < weekStart || s.date > weekEnd))
            }}>
              🗑️ 清除本週
            </button>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setShowLawModal(true)}>
              <Shield size={14} /> 排班條件
            </button>
            <button className="btn btn-primary" style={{ width: 'auto', padding: '8px 16px', background: 'linear-gradient(135deg, var(--accent-red), var(--accent-orange))' }}
              onClick={handleAutoSchedule} disabled={autoScheduling}>
              <Sparkles size={14} /> {autoScheduling ? 'AI 排班中...' : 'AI 自動排班'}
            </button>
          </div>
        </div>
      </div>

      {/* Store selector + Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>📅</span>
          <select className="form-input" style={{ width: 200, padding: '8px 12px', fontSize: 13 }}
            value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
            <option value="">全部門市</option>
            {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 10, overflow: 'hidden' }}>
          {[
            { key: 'schedule', label: '📋 班表總覽' },
            { key: 'store-settings', label: '⚙️ 門市設定' },
            { key: 'preferences', label: '👤 排班偏好' },
            { key: 'swaps', label: '🔄 換班申請' },
            { key: 'analytics', label: '📊 分析報表' },
          ].map(tab => (
            <button key={tab.key} onClick={() => setMainTab(tab.key)} style={{
              padding: '8px 18px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: mainTab === tab.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
              color: mainTab === tab.key ? '#fff' : 'var(--text-muted)',
            }}>{tab.label}</button>
          ))}
        </div>
      </div>

      {mainTab === 'schedule' && (<>
      {/* Week Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
          <ChevronLeft size={16} />
        </button>
        <div style={{ fontSize: 15, fontWeight: 700 }}>
          {weekStart} ~ {weekEnd}
        </div>
        <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => setWeekOffset(0)} style={{ ...btnStyle(weekOffset === 0), marginLeft: 4 }}>本週</button>
      </div>

      {/* Compact filters — use dropdowns instead of button lists */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>部門</span>
          <select className="form-input" style={{ width: 160, padding: '6px 10px', fontSize: 13 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">全部部門</option>
            {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          篩選結果：{filtered.length} 人
        </div>
      </div>

      {/* Compliance Alerts */}
      {(compliance.errors.length > 0 || compliance.warnings.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          {compliance.errors.map((e, i) => (
            <div key={`e-${i}`} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderRadius: 10, marginBottom: 6,
              background: 'var(--accent-red-dim)', border: '1px solid rgba(248,113,113,0.2)',
            }}>
              <AlertTriangle size={16} style={{ color: 'var(--accent-red)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-red)' }}>違規：{e.law}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{e.message}</div>
              </div>
            </div>
          ))}
          {compliance.warnings.map((w, i) => (
            <div key={`w-${i}`} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderRadius: 10, marginBottom: 6,
              background: 'var(--accent-orange-dim)', border: '1px solid rgba(251,146,60,0.2)',
            }}>
              <Info size={16} style={{ color: 'var(--accent-orange)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-orange)' }}>警告：{w.law}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{w.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {compliance.isValid && schedules.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, marginBottom: 16,
          background: 'var(--accent-green-dim)', border: '1px solid rgba(52,211,153,0.2)',
        }}>
          <Shield size={16} style={{ color: 'var(--accent-green)' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-green)' }}>排班符合勞基法規定</span>
        </div>
      )}

      {/* Stats */}
      {schedules.length > 0 && (() => {
        const weekWork = filtered.map(e => weekDates.filter(d => { const s = getShift(e.name, d); return s && s !== '休' }).length)
        const totalHours = weekWork.reduce((s, d) => s + d * 8, 0)
        const avgHours = filtered.length ? (totalHours / filtered.length).toFixed(1) : 0
        const restDays = filtered.map(e => weekDates.filter(d => getShift(e.name, d) === '休').length)
        const overwork = weekWork.filter(d => d > 6).length
        return (
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">本週總排班時數</div>
              <div className="stat-card-value">{totalHours}h</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">人均週時數</div>
              <div className="stat-card-value">{avgHours}h</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">平均休假天數</div>
              <div className="stat-card-value">{filtered.length ? (restDays.reduce((a, b) => a + b, 0) / filtered.length).toFixed(1) : 0}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': overwork > 0 ? 'var(--accent-red)' : 'var(--accent-green)', '--card-accent-dim': overwork > 0 ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">超時排班人數</div>
              <div className="stat-card-value">{overwork}</div>
            </div>
          </div>
        )
      })()}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {SHIFT_TYPES.map(t => (
          <span key={t.label} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, ...getShiftStyle(t.label) }}>
            {t.label}
          </span>
        ))}
      </div>

      {/* Schedule Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ minWidth: 100 }}>員工</th>
                {weekDates.map((date, i) => {
                  const isHoliday = holidaySet.has(date)
                  return (
                    <th key={date} style={{ textAlign: 'center', minWidth: 80, background: isHoliday ? 'var(--accent-red-dim)' : undefined }}>
                      <div>週{DAY_LABELS[i]}</div>
                      <div style={{ fontSize: 11, color: isHoliday ? 'var(--accent-red)' : 'var(--text-muted)', fontWeight: isHoliday ? 600 : 400 }}>
                        {date.slice(5)}{isHoliday ? ' 🎌' : ''}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>無員工</td></tr>}
              {filtered.map(emp => (
                <tr key={emp.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {emp.position || emp.dept} · {weekDates.filter(d => { const s = getShift(emp.name, d); return s && s !== '休' }).length * 8}h
                    </div>
                  </td>
                  {weekDates.map(date => {
                    const shift = getShift(emp.name, date)
                    const isEditing = editCell?.empName === emp.name && editCell?.date === date
                    return (
                      <td key={date} style={{ textAlign: 'center', padding: '6px 4px', position: 'relative' }}>
                        {isEditing ? (
                          <div style={{
                            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                            zIndex: 50, background: 'var(--bg-card)', border: '1px solid var(--border-strong)',
                            borderRadius: 10, padding: 8, boxShadow: 'var(--shadow-lg)',
                            display: 'flex', flexDirection: 'column', gap: 4, minWidth: 90,
                          }}>
                            {(() => {
                              const empStore = emp.store || storeFilter || ''
                              const isPT = emp.position?.includes('PT') || emp.employment_type === 'PT'
                              const storeShiftDefs = getStoreShifts(empStore, isPT ? 'pt' : 'full_time')
                              const storeShiftLabels = storeShiftDefs.map(d => d.name)
                              const shiftOptions = SHIFT_TYPES.filter(t => t.label === '休' || storeShiftLabels.includes(t.label) || storeShiftDefs.length === 0)
                              return shiftOptions.map(t => (
                                <button key={t.label} onClick={() => handleSetShift(emp.name, date, t.label)}
                                  style={{
                                    padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                                    fontSize: 12, fontWeight: 600, textAlign: 'center',
                                    background: t.dim, color: t.color,
                                  }}>
                                  {t.label}
                                </button>
                              ))
                            })()}
                            <button onClick={() => setEditCell(null)} style={{
                              padding: '4px', borderRadius: 6, border: '1px solid var(--border-medium)',
                              background: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
                            }}>取消</button>
                          </div>
                        ) : null}
                        {getOffRequest(emp.name, date) && !shift && (
                          <div style={{ fontSize: 9, color: 'var(--accent-orange)', marginBottom: 2 }}>
                            <CalendarOff size={10} style={{ verticalAlign: -1 }} /> 希望休
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                          <span
                            onClick={() => setEditCell(isEditing ? null : { empName: emp.name, date })}
                            style={{
                              display: 'inline-block', padding: '4px 12px', borderRadius: 8,
                              fontSize: 12, fontWeight: 600, cursor: 'pointer',
                              transition: 'all 0.15s',
                              ...(shift ? getShiftStyle(shift) : { background: 'var(--glass-light)', color: 'var(--text-muted)', border: '1px dashed var(--border-medium)' }),
                            }}
                          >
                            {shift || '+'}
                          </span>
                          {shift && shift !== '休' && (
                            <button title="找人代班" onClick={e => {
                              e.stopPropagation()
                              setCoverModal({ employee: emp.name, date, shift })
                              findCoverCandidates(emp.name, date, shift)
                            }} style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'var(--text-muted)', fontSize: 10, padding: 1, opacity: 0.4, lineHeight: 1,
                            }}>🔄</button>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      </>)}

      {/* ══ Store Settings Tab ══ */}
      {mainTab === 'store-settings' && (
        <div>
          {!storeFilter ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>請先選擇門市</div>
          ) : (
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
          )}
        </div>
      )}

      {/* ══ Preferences Tab ══ */}
      {mainTab === 'preferences' && (
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
      )}

      {/* ══ Shift Swaps Tab ══ */}
      {mainTab === 'swaps' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🔄</span> 換班申請</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>申請人</th><th>對象</th><th>日期</th><th>原班</th><th>換班</th><th>原因</th><th>狀態</th><th>操作</th></tr></thead>
              <tbody>
                {swaps.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無換班申請</td></tr>}
                {swaps.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.requester}</td>
                    <td style={{ fontWeight: 600 }}>{s.target}</td>
                    <td>{s.swap_date}</td>
                    <td>{s.requester_shift || '—'}</td>
                    <td>{s.target_shift || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.reason || '—'}</td>
                    <td>
                      <span className={`badge ${s.status === '已核准' ? 'badge-success' : s.status === '已拒絕' ? 'badge-danger' : 'badge-warning'}`}>
                        <span className="badge-dot"></span>{s.status}
                      </span>
                      {s.reject_reason && <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>{s.reject_reason}</div>}
                    </td>
                    <td>
                      {s.status === '待審核' && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm btn-primary" onClick={async () => {
                            const { data } = await supabase.from('shift_swaps').update({ status: '已核准', approver: '主管' }).eq('id', s.id).select().single()
                            if (data) {
                              setSwaps(prev => prev.map(x => x.id === s.id ? data : x))
                              // Execute swap in schedules
                              await supabase.from('schedules').update({ shift: s.target_shift }).eq('employee', s.requester).eq('date', s.swap_date)
                              await supabase.from('schedules').update({ shift: s.requester_shift }).eq('employee', s.target).eq('date', s.swap_date)
                            }
                          }}>核准</button>
                          <button className="btn btn-sm btn-secondary" onClick={async () => {
                            const reason = prompt('拒絕原因：')
                            if (!reason?.trim()) return
                            const { data } = await supabase.from('shift_swaps').update({ status: '已拒絕', reject_reason: reason.trim() }).eq('id', s.id).select().single()
                            if (data) setSwaps(prev => prev.map(x => x.id === s.id ? data : x))
                          }}>拒絕</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Analytics Tab ══ */}
      {mainTab === 'analytics' && (() => {
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
      })()}

      {/* Law Reference Modal */}
      {showLawModal && (
        <Modal title="排班相關法規參照" onClose={() => setShowLawModal(false)} onSubmit={() => setShowLawModal(false)} submitLabel="關閉">
          <div style={{ maxHeight: '65vh', overflowY: 'auto' }}>
            {/* 勞基法 */}
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 700 }}>勞基法</span>
              勞動基準法
            </div>
            {Object.values(LABOR_STANDARDS).map(rule => (
              <div key={rule.law} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{rule.title}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' }}>{rule.law}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{rule.desc}</div>
                {rule.note && <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4 }}>⚠ {rule.note}</div>}
                {rule.detail && (
                  <div style={{ marginTop: 6, paddingLeft: 12 }}>
                    {rule.detail.map((d, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {d}</div>)}
                  </div>
                )}
                {rule.rates && (
                  <div style={{ marginTop: 8, background: 'var(--glass-light)', borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>加班費率：</div>
                    {rule.rates.map((r, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', padding: '2px 0' }}>
                        <span>{r.desc}</span>
                        <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{r.formula}</span>
                      </div>
                    ))}
                  </div>
                )}
                {rule.conditions && (
                  <div style={{ marginTop: 6, paddingLeft: 12 }}>
                    {rule.conditions.map((c, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {c}</div>)}
                  </div>
                )}
                {rule.measures && (
                  <div style={{ marginTop: 6, paddingLeft: 12 }}>
                    {rule.measures.map((m, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {m}</div>)}
                  </div>
                )}
                {rule.holidays2026 && (
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {rule.holidays2026.map(h => (
                      <span key={h.date} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-red-dim)', color: 'var(--accent-red)' }}>
                        {h.date} {h.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* 性平法 */}
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '20px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, background: 'var(--accent-pink-dim)', color: 'var(--accent-pink)', fontWeight: 700 }}>性平法</span>
              性別平等工作法
            </div>
            {Object.values(GENDER_EQUALITY).map(rule => (
              <div key={rule.law} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{rule.title}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-pink-dim)', color: 'var(--accent-pink)' }}>{rule.law}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{rule.desc}</div>
                {rule.impact && <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 4 }}>💡 {rule.impact}</div>}
              </div>
            ))}

            {/* 職安法 */}
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '20px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, background: 'var(--accent-green-dim)', color: 'var(--accent-green)', fontWeight: 700 }}>職安法</span>
              職業安全衛生法
            </div>
            {Object.values(OCCUPATIONAL_SAFETY).map(rule => (
              <div key={rule.law} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{rule.title}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-green-dim)', color: 'var(--accent-green)' }}>{rule.law}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{rule.desc}</div>
                {rule.measures && (
                  <div style={{ marginTop: 6, paddingLeft: 12 }}>
                    {rule.measures.map((m, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {m}</div>)}
                  </div>
                )}
                {rule.prohibitedWork && (
                  <div style={{ marginTop: 6, paddingLeft: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-red)', marginBottom: 4 }}>禁止作業：</div>
                    {rule.prohibitedWork.map((w, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {w}</div>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* ══ Cover Shift Modal ══ */}
      {coverModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.4)', width: '100vw', height: '100vh',
        }} onMouseDown={e => { if (e.target === e.currentTarget) setCoverModal(null) }}>
          <div style={{
            width: '100%', maxWidth: 560, maxHeight: '85vh',
            background: 'var(--bg-primary)', border: '1px solid var(--border-medium)',
            borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: 'auto',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>🔄 找人代班</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {coverModal.employee} · {coverModal.date} · {coverModal.shift}
                </div>
              </div>
              <button onClick={() => setCoverModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {coverLoading ? (
                <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                  <div className="spinner" style={{ margin: '0 auto 12px' }} />
                  分析可代班人選...
                </div>
              ) : coverCandidates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                  😔 沒有符合條件的人選
                  <div style={{ fontSize: 12, marginTop: 8 }}>所有員工當天都有班或不符合 11 小時班距規定</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                    找到 {coverCandidates.length} 位可代班人選（依適合度排序）
                  </div>
                  {coverCandidates.map((c, i) => (
                    <div key={c.name} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 14px', borderRadius: 10, marginBottom: 8,
                      background: i === 0 ? 'var(--accent-green-dim)' : 'var(--bg-card)',
                      border: `1px solid ${i === 0 ? 'rgba(52,211,153,0.3)' : 'var(--border-subtle)'}`,
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                          {i === 0 && '⭐ '}{c.name}
                          {!c.sameStore && <span style={{ fontSize: 11, color: 'var(--accent-orange)', marginLeft: 6 }}>跨店</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {c.store || '—'} · {c.position || c.dept}
                          {c.isPT && <span className="badge badge-cyan" style={{ marginLeft: 6, fontSize: 10 }}>PT</span>}
                          {c.wouldLoseRest && <span style={{ color: 'var(--accent-orange)', marginLeft: 6 }}>⚠ 僅剩 {c.restDays} 天休</span>}
                        </div>
                      </div>
                      <button className="btn btn-sm btn-primary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                        onClick={() => handleAssignCover(c.name, coverModal.date, coverModal.shift)}>
                        指派代班
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
