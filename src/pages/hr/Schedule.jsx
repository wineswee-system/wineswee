import { useState, useEffect } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { createPortal } from 'react-dom'
import { Sparkles, Shield, AlertTriangle, CheckCircle, RefreshCw, Save, Code } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { validateSchedule } from '../../lib/laborLaw'
import { gatherSchedulingData, runAiSchedule, runMonthlyAiSchedule, fixViolations } from '../../lib/schedulingAi'
import { runProgrammaticSchedule, runMonthlyProgrammaticSchedule } from '../../lib/schedulingAlgo'
import { parseTime, getMonthDates, getWeekDates, isAbsence, formatYearMonth, parseYearMonth, getDayLabel } from '../../lib/scheduleUtils'
import { useTenant } from '../../contexts/TenantContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import MonthScheduleTable from './components/MonthScheduleTable'
import StoreSettingsTab from './components/StoreSettingsTab'
import PreferencesTab from './components/PreferencesTab'
import SwapsTab from './components/SwapsTab'
import AnalyticsTab from './components/AnalyticsTab'
import CrossStoreTab from './components/CrossStoreTab'
import LawReferenceModal from './components/LawReferenceModal'
import CoverShiftModal from './components/CoverShiftModal'
import { notifySchedulePublished } from '../../lib/lineNotify'
import { persistFatigueScores } from '../../lib/fatigueEngine'
import { validateShiftChange } from '../../lib/scheduleValidator'

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

export default function Schedule() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id || null

  // Role check: read from localStorage profile (set by AuthContext)
  const [userRole, setUserRole] = useState('viewer')
  useEffect(() => {
    try {
      const profile = JSON.parse(localStorage.getItem('sme_profile') || '{}')
      setUserRole(profile?.role || 'manager')
    } catch { setUserRole('manager') }
  }, [])
  const canEditSchedule = ['admin', 'super_admin', 'manager'].includes(userRole)
  const canUseAISchedule = ['admin', 'super_admin', 'manager'].includes(userRole)

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
  const [storeEvents, setStoreEvents] = useState([]) // [{ id, store_id, date, title, color }]
  const [shiftDefs, setShiftDefs] = useState([])
  const [SHIFT_TYPES, setShiftTypes] = useState([REST_SHIFT])
  const [autoScheduling, setAutoScheduling] = useState(false)
  const [minStaff, setMinStaff] = useState(3)
  const [showLawModal, setShowLawModal] = useState(false)
  const [compliance, setCompliance] = useState({ errors: [], warnings: [], isValid: true })
  const [error, setError] = useState(null)
  const [mainTab, setMainTab] = useState('schedule') // schedule | store-settings | preferences | swaps | analytics
  // Store settings
  const [publishStatus, setPublishStatus] = useState(null) // { status: 'draft'|'published', published_at }
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
  // Comp-off modal
  const [showCompOff, setShowCompOff] = useState(false)
  // AI Draft workflow
  const [aiDraft, setAiDraft] = useState(null) // { assignments, reasoning, aiWarnings, violations, errors, warnings, meta }
  const [aiProgress, setAiProgress] = useState('') // status message during AI run
  // View mode: week or month
  const [viewMode] = useState('month') // only month view
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return formatYearMonth(now.getFullYear(), now.getMonth() + 1)
  })

  const weekDates = getWeekDates(weekOffset)
  const weekStart = weekDates[0]
  const weekEnd = weekDates[6]

  // Month dates for monthly view
  const { year: monthYear, month: monthNum } = parseYearMonth(selectedMonth)
  const monthDates = getMonthDates(monthYear, monthNum)
  const monthStart = monthDates[0]
  const monthEnd = monthDates[monthDates.length - 1]

  // Active dates based on view mode
  const activeDates = viewMode === 'month' ? monthDates : weekDates
  const activeStart = viewMode === 'month' ? monthStart : weekStart
  const activeEnd = viewMode === 'month' ? monthEnd : weekEnd

  useEffect(() => {
    Promise.all([
      supabase.from('employees').select('id, name, dept, position, store, store_id, employment_type, schedule_priority, can_open, can_close, additional_stores, weekly_target_hours').eq('status', '在職').order('name'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('stores').select('*').order('name'),
      supabase.from('shift_definitions').select('*').order('sort_order'),
      supabase.from('holidays').select('date'),
      supabase.from('user_stores').select('employee_id, store_id, is_primary'),
    ]).then(([e, d, l, sd, hd, us]) => {
      // Enrich employees with user_stores data
      const userStoresMap = {}
      for (const row of (us.data || [])) {
        if (!userStoresMap[row.employee_id]) userStoresMap[row.employee_id] = []
        userStoresMap[row.employee_id].push(row.store_id)
      }
      const enriched = (e.data || []).map(emp => ({
        ...emp,
        assigned_store_ids: userStoresMap[emp.id] || (emp.store_id ? [emp.store_id] : []),
      }))
      setEmployees(enriched)
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
      supabase.from('schedules').select('*').gte('date', activeStart).lte('date', activeEnd),
      supabase.from('off_requests').select('*').gte('date', activeStart).lte('date', activeEnd),
    ]).then(([s, o]) => {
      setSchedules(s.data || [])
      setOffRequests(o.data || [])
    }).catch(err => {
      console.error('Failed to load schedule data:', err)
    })

    // Load publish status for current month
    const month = activeStart?.slice(0, 7)
    const store = locations.length > 0 ? locations.find(l => l.name === storeFilter) : null
    if (month && store) {
      supabase.from('schedule_publish_status').select('*')
        .eq('store_id', store.id).eq('month', month).maybeSingle()
        .then(({ data }) => setPublishStatus(data))
    }
  }, [activeStart, activeEnd, storeFilter, locations])

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

  const handleSetShift = async (empName, date, shift, actualStart, actualEnd) => {
    if (!canEditSchedule) return

    // Real-time validation before saving
    if (!isAbsence(shift)) {
      const validation = validateShiftChange({
        empName, date, newShift: shift,
        employees: filtered, schedules, shiftDefs, weekDates,
        workHourSystem: storeSettings?.work_hour_system,
      })

      if (validation.errors.length > 0) {
        const proceed = confirm(
          `⚠️ 違規警告：\n\n${validation.errors.map(e => `❌ ${e}`).join('\n')}` +
          (validation.warnings.length > 0 ? `\n\n${validation.warnings.map(w => `⚠ ${w}`).join('\n')}` : '') +
          `\n\n確定要強制排班嗎？`
        )
        if (!proceed) return
      } else if (validation.warnings.length > 0) {
        const proceed = confirm(
          `注意事項：\n\n${validation.warnings.map(w => `⚠ ${w}`).join('\n')}` +
          `\n\n確定要排班嗎？`
        )
        if (!proceed) return
      }
    }

    const record = {
      shift,
      actual_start: actualStart || null,
      actual_end: actualEnd || null,
      ...(tenantId ? { tenant_id: tenantId } : {}),
    }

    const existing = schedules.find(s => s.employee === empName && s.date === date)
    if (existing) {
      const { data } = await supabase.from('schedules').update(record).eq('id', existing.id).select().single()
      if (data) setSchedules(prev => prev.map(s => s.id === existing.id ? data : s))
    } else {
      const { data } = await supabase.from('schedules').insert({ employee: empName, date, ...record }).select().single()
      if (data) setSchedules(prev => [...prev, data])
    }
    setEditCell(null)
  }

  const handleDeleteShift = async (empName, date) => {
    if (!canEditSchedule) return
    const existing = schedules.find(s => s.employee === empName && s.date === date)
    if (!existing) return
    const { error } = await supabase.from('schedules').delete().eq('id', existing.id)
    if (!error) {
      setSchedules(prev => prev.filter(s => s.id !== existing.id))
    }
    setEditCell(null)
  }

  const getOffRequest = (empName, date) => offRequests.find(o => o.employee === empName && o.date === date)

  // Get available shifts for a specific store (only store-specific, exclude global)
  const getStoreShifts = (storeName, empType = 'all') => {
    const store = locations.find(l => l.name === storeName)
    const storeId = store?.id
    return shiftDefs.filter(d => {
      // Only show this store's shifts (not global ones without store_id)
      if (!d.store_id || d.store_id !== storeId) return false
      // Match employee type
      const typeMatch = !d.employee_type || d.employee_type === 'all' || d.employee_type === empType
      return typeMatch
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
      const targetStoreObj = locations.find(l => l.name === absentStore)
      const sameStore = emp.store === absentStore || emp.store_id === targetStoreObj?.id
        || (emp.assigned_store_ids || []).includes(targetStoreObj?.id)
        || (emp.additional_stores || []).includes(absentStore)
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
    const { data } = await supabase.from('schedules').upsert({ employee: coverEmpName, date, shift, ...(tenantId ? { tenant_id: tenantId } : {}) }, { onConflict: 'employee,date' }).select().single()
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

  // ── AI Auto-Schedule (LLM-based, 6-phase framework) ──
  const handleAutoSchedule = async () => {
    if (!canUseAISchedule) { alert('您沒有使用 AI 排班的權限'); return }
    const isMonthly = viewMode === 'month'
    const rangeLabel = isMonthly ? `${selectedMonth} 月排班` : `${weekStart} ~ ${weekEnd}`
    if (!confirm(`將使用 AI (Gemini 2.5) 為 ${filtered.length} 位員工自動排班（${rangeLabel}）\n\n已有的排班會保留。AI 產出為草稿，您可以審閱後再發布。`)) return
    setAutoScheduling(true)
    setAiDraft(null)
    setAiProgress('正在收集排班資料...')

    try {
      const dateStart = isMonthly ? monthStart : weekStart
      const dateEnd = isMonthly ? monthEnd : weekEnd

      let schedulingData = await gatherSchedulingData({
        weekDates: isMonthly ? null : weekDates,
        monthDates: isMonthly ? monthDates : null,
        employees: filtered, shiftDefs,
        storeFilter, locations, minStaff, tenantId,
      })

      // 自動讀取現有班表的休假，合併為 offRequests
      schedulingData = mergeRestDaysAsOffRequests(schedulingData, dateStart, dateEnd)

      if (isMonthly) {
        setAiProgress('AI 月排班中...')
        const result = await runMonthlyAiSchedule(schedulingData, setAiProgress)
        if (!result.success) throw new Error(result.error || 'AI 排班失敗')
        setAiDraft({ ...result, schedulingData })
      } else {
        setAiProgress('AI 分析中（Gemini 2.5）...')
        const result = await runAiSchedule(schedulingData)
        if (!result.success) throw new Error(result.error || 'AI 排班失敗')
        setAiDraft({ ...result, schedulingData })
      }
      setAiProgress('')

    } catch (err) {
      console.error('[AI Schedule] Error:', err)
      alert(`AI 排班失敗：${err.message}`)
      setAiProgress('')
    } finally {
      setAutoScheduling(false)
    }
  }

  // ── Publish draft to database ──
  const handlePublishDraft = async () => {
    if (!aiDraft?.assignments?.length) return
    if (aiDraft.errors?.length > 0) {
      if (!confirm(`仍有 ${aiDraft.errors.length} 個違規項目。確定要發布嗎？`)) return
    }

    const empNames = [...new Set(aiDraft.assignments.map(a => a.employee))]
    const dates = [...new Set(aiDraft.assignments.map(a => a.date))].sort()

    // Clear existing schedules for these employees in this date range
    await supabase.from('schedules').delete()
      .in('employee', empNames)
      .gte('date', dates[0])
      .lte('date', dates[dates.length - 1])

    // Build records with absence_type and month_group
    const monthGroup = dates[0]?.slice(0, 7) || null
    const newSchedules = aiDraft.assignments.map(a => ({
      employee: a.employee,
      date: a.date,
      shift: a.shift,
      absence_type: isAbsence(a.shift) ? a.shift : null,
      actual_start: a.actual_start || null,
      actual_end: a.actual_end || null,
      actual_hours: a.actual_hours || null,
      source_store: a.store || null,
      month_group: monthGroup,
      ...(tenantId ? { tenant_id: tenantId } : {}),
    }))

    const { data } = await supabase.from('schedules')
      .insert(newSchedules).select()
    if (data) {
      setSchedules(prev => {
        const kept = prev.filter(s => !(empNames.includes(s.employee) && s.date >= dates[0] && s.date <= dates[dates.length - 1]))
        return [...kept, ...data]
      })
    }
    setAiDraft(null)

    // Send LINE notifications to employees
    const dateRange = `${dates[0]} ~ ${dates[dates.length - 1]}`
    let notified = 0
    for (const empName of empNames) {
      const empAssignments = newSchedules
        .filter(s => s.employee === empName)
        .sort((a, b) => a.date.localeCompare(b.date))
      const result = await notifySchedulePublished(empName, dateRange, empAssignments)
      if (result?.ok) notified++
    }

    // Auto-persist fatigue scores for the month
    const month = dates[0]?.slice(0, 7)
    if (month) {
      persistFatigueScores(month).then(r => {
        if (r.success) console.log(`[Fatigue] 已結算 ${month} 辛苦度：${r.count} 人`)
      })
    }

    // Update publish status
    const store = locations.find(l => l.name === storeFilter)
    if (month && store) {
      const profile = JSON.parse(localStorage.getItem('sme_profile') || '{}')
      const pubData = { store_id: store.id, month, status: 'published', published_at: new Date().toISOString(), published_by: profile?.name || 'unknown' }
      await supabase.from('schedule_publish_status').upsert(pubData, { onConflict: 'store_id,month' })
      setPublishStatus(pubData)
    }

    alert(`已發布排班！共 ${newSchedules.length} 筆${notified > 0 ? `\n已透過 LINE 通知 ${notified} 位員工` : ''}`)
  }

  // ── Fix violations (re-run AI with violation context) ──
  const handleFixViolations = async () => {
    if (!aiDraft) return
    setAutoScheduling(true)
    setAiProgress('AI 修正違規中...')
    try {
      const result = await fixViolations(
        aiDraft.schedulingData,
        aiDraft.assignments,
        aiDraft.violations,
      )
      setAiDraft(prev => ({ ...prev, ...result, schedulingData: prev.schedulingData }))
      setAiProgress('')
    } catch (err) {
      console.error('[AI Fix] Error:', err)
      alert(`修正失敗：${err.message}`)
      setAiProgress('')
    } finally {
      setAutoScheduling(false)
    }
  }

  // ── Discard draft ──
  const handleDiscardDraft = () => {
    if (confirm('確定要捨棄排班草稿嗎？')) setAiDraft(null)
  }

  // ── Helper: merge current schedule 休 into offRequests ──
  const mergeRestDaysAsOffRequests = (schedulingData, dateStart, dateEnd) => {
    const empNames = filtered.map(e => e.name)
    // Extract 休 from currently displayed schedule
    const restFromSchedule = schedules
      .filter(s => empNames.includes(s.employee) && s.date >= dateStart && s.date <= dateEnd && isAbsence(s.shift))
      .map(s => ({ employee: s.employee, date: s.date }))

    if (restFromSchedule.length > 0) {
      // Merge with existing offRequests (deduplicate)
      const existing = new Set(schedulingData.offRequests.map(o => `${o.employee}_${o.date}`))
      const merged = [...schedulingData.offRequests]
      for (const r of restFromSchedule) {
        const key = `${r.employee}_${r.date}`
        if (!existing.has(key)) {
          merged.push(r)
          existing.add(key)
        }
      }
      schedulingData.offRequests = merged
      console.log(`[排班] 從現有班表讀取 ${restFromSchedule.length} 筆休假，合併後共 ${merged.length} 筆 offRequests`)
    }
    return schedulingData
  }

  // ── Programmatic Schedule (no AI) ──
  const handleCodeSchedule = async () => {
    if (!canUseAISchedule) { alert('您沒有使用排班功能的權限'); return }
    const isMonthly = viewMode === 'month'
    const rangeLabel = isMonthly ? `${selectedMonth} 月排班` : `${weekStart} ~ ${weekEnd}`
    if (!confirm(`將使用程式演算法為 ${filtered.length} 位員工自動排班（${rangeLabel}）\n\n不使用 AI，純邏輯計算。產出為草稿，您可以審閱後再發布。`)) return
    setAutoScheduling(true)
    setAiDraft(null)
    setAiProgress('程式排班計算中...')

    try {
      const dateStart = isMonthly ? monthStart : weekStart
      const dateEnd = isMonthly ? monthEnd : weekEnd

      let schedulingData = await gatherSchedulingData({
        weekDates: isMonthly ? null : weekDates,
        monthDates: isMonthly ? monthDates : null,
        employees: filtered, shiftDefs,
        storeFilter, locations, minStaff, tenantId,
      })

      // 自動讀取現有班表的休假，合併為 offRequests
      schedulingData = mergeRestDaysAsOffRequests(schedulingData, dateStart, dateEnd)

      const result = isMonthly
        ? runMonthlyProgrammaticSchedule(schedulingData, setAiProgress)
        : runProgrammaticSchedule(schedulingData)

      setAiDraft({ ...result, schedulingData })
      setAiProgress('')
    } catch (err) {
      console.error('[Code Schedule] Error:', err)
      alert(`程式排班失敗：${err.message}`)
      setAiProgress('')
    } finally {
      setAutoScheduling(false)
    }
  }

  // Load store settings + events whenever storeFilter changes
  useEffect(() => {
    if (storeFilter && locations.length > 0) {
      const store = locations.find(s => s.name === storeFilter)
      if (store) {
        supabase.from('store_settings').select('*').eq('store_id', store.id).maybeSingle()
          .then(({ data }) => { setStoreSettings(data); if (data?.operating_hours) setOperatingHours(data.operating_hours) })
        supabase.from('store_staffing').select('*').eq('store_id', store.id)
          .then(({ data }) => setStaffing(data || []))
        // Load store events for current month
        supabase.from('store_events').select('*').eq('store_id', store.id)
          .gte('date', monthStart).lte('date', monthEnd)
          .then(({ data }) => setStoreEvents(data || []))
          .catch(() => setStoreEvents([]))  // table might not exist yet
      }
    }
  }, [storeFilter, locations, selectedMonth])

  // Load tab-specific data
  useEffect(() => {
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

  const getShiftStyle = (shift) => {
    const type = SHIFT_TYPES.find(t => t.label === shift)
    if (!type) return {}
    return { background: type.dim, color: type.color, border: `1px solid ${type.color}30` }
  }

  const selectedStore = locations.find(s => s.name === storeFilter)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📅</span> 排班管理</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <p style={{ margin: 0 }}>管理班表、排班偏好與AI自動排班</p>
              {publishStatus && (
                <span style={{
                  padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: publishStatus.status === 'published' ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.12)',
                  color: publishStatus.status === 'published' ? '#10b981' : '#f59e0b',
                }}>
                  {publishStatus.status === 'published' ? `✓ 已發布 ${publishStatus.published_at?.slice(0, 10) || ''}` : '草稿'}
                </span>
              )}
              {!publishStatus && storeFilter && (
                <span style={{ padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: 'rgba(251,191,36,0.12)', color: '#f59e0b' }}>
                  未發布
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              最少上班
              <input type="number" className="form-input" style={{ width: 50, padding: '4px 8px', fontSize: 12, textAlign: 'center' }}
                value={minStaff} onChange={e => setMinStaff(Math.max(1, Math.min(Number(e.target.value) || 1, 99)))} min={1} max={99} />
              人/天
            </div>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={async () => {
              // Copy last month's schedule
              const prevMonth = new Date(monthYear, monthNum - 2, 1)
              const prevDates = getMonthDates(prevMonth.getFullYear(), prevMonth.getMonth() + 1)
              const empNames = filtered.map(e => e.name)
              const { data: lastSchedules } = await supabase.from('schedules').select('*')
                .in('employee', empNames)
                .gte('date', prevDates[0]).lte('date', prevDates[prevDates.length - 1])
              if (!lastSchedules?.length) { alert('上月無排班資料'); return }
              if (!confirm(`將上月 ${lastSchedules.length} 筆排班複製到 ${selectedMonth}？\n\n會根據星期幾對應，已有的排班會被覆蓋。`)) return
              // Map by day-of-week: group last month shifts by (employee, dow)
              const byEmpDow = {}
              for (const s of lastSchedules) {
                const dow = new Date(s.date).getDay()
                const key = `${s.employee}_${dow}`
                if (!byEmpDow[key]) byEmpDow[key] = s
              }
              const newSchedules = []
              for (const date of monthDates) {
                const dow = new Date(date).getDay()
                for (const emp of empNames) {
                  const src = byEmpDow[`${emp}_${dow}`]
                  if (src) newSchedules.push({ employee: emp, date, shift: src.shift, actual_start: src.actual_start, actual_end: src.actual_end })
                }
              }
              if (newSchedules.length > 0) {
                const withTenant = tenantId ? newSchedules.map(s => ({ ...s, tenant_id: tenantId })) : newSchedules
                const { data } = await supabase.from('schedules').upsert(withTenant, { onConflict: 'employee,date' }).select()
                if (data) setSchedules(prev => { const map = {}; for (const s of [...prev, ...data]) map[`${s.employee}_${s.date}`] = s; return Object.values(map) })
                alert(`已複製 ${newSchedules.length} 筆排班到 ${selectedMonth}`)
              }
            }}>
              📋 複製上月
            </button>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={async () => {
              const empNames = filtered.map(e => e.name)
              if (!confirm(`確定要清除 ${selectedMonth} ${storeFilter || '所有門市'} 共 ${empNames.length} 人的排班嗎？`)) return
              await supabase.from('schedules').delete().in('employee', empNames).gte('date', monthStart).lte('date', monthEnd)
              setSchedules(prev => prev.filter(s => !empNames.includes(s.employee) || s.date < monthStart || s.date > monthEnd))
            }}>
              🗑️ 清除本月
            </button>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)' }} onClick={() => setShowCompOff(true)}>
              🔄 指派補休
            </button>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => {
              // Export schedule as CSV
              const rows = [['員工', ...monthDates.map(d => d.slice(5))]]
              for (const emp of filtered) {
                const row = [emp.name]
                for (const date of monthDates) {
                  const s = schedules.find(x => x.employee === emp.name && x.date === date)
                  row.push(s?.shift || '')
                }
                rows.push(row)
              }
              const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\n')
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url; a.download = `排班表_${storeFilter || '全部'}_${selectedMonth}.csv`
              a.click(); URL.revokeObjectURL(url)
            }}>
              📥 匯出 CSV
            </button>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setShowLawModal(true)}>
              <Shield size={14} /> 排班條件
            </button>
            {canUseAISchedule && (
              <>
                <button className="btn btn-primary" style={{ width: 'auto', padding: '8px 16px', background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue, #3b82f6))' }}
                  onClick={handleCodeSchedule} disabled={autoScheduling}>
                  <Code size={14} /> {autoScheduling && aiProgress.includes('程式') ? aiProgress : '排班代碼'}
                </button>
                <button className="btn btn-primary" style={{ width: 'auto', padding: '8px 16px', background: 'linear-gradient(135deg, var(--accent-red), var(--accent-orange))' }}
                  onClick={handleAutoSchedule} disabled={autoScheduling}>
                  <Sparkles size={14} /> {autoScheduling && !aiProgress.includes('程式') ? (aiProgress || 'AI 排班中...') : 'AI 自動排班'}
                </button>
              </>
            )}
            {aiDraft && (
              <>
                <button className="btn btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={handlePublishDraft}>
                  <Save size={14} /> 發布草稿
                </button>
                <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={handleDiscardDraft}>
                  捨棄草稿
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* View mode toggle + Store selector + Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {/* Month navigator */}
        {(
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => {
                const d = new Date(monthYear, monthNum - 2, 1)
                setSelectedMonth(formatYearMonth(d.getFullYear(), d.getMonth() + 1))
              }}>◀</button>
            <input type="month" className="form-input" style={{ padding: '4px 8px', fontSize: 13 }}
              value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
            <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => {
                const d = new Date(monthYear, monthNum, 1)
                setSelectedMonth(formatYearMonth(d.getFullYear(), d.getMonth() + 1))
              }}>▶</button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>🏪</span>
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
            { key: 'cross-store', label: '🏪 跨店調度' },
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

      {/* AI Draft Review Panel */}
      {aiDraft && mainTab === 'schedule' && (
        <div style={{ marginBottom: 16, padding: 16, borderRadius: 12, background: 'var(--bg-card)', border: '2px solid var(--accent-cyan)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={18} style={{ color: 'var(--accent-orange)' }} />
              AI 排班草稿
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
                ({aiDraft.meta?.model || 'Gemini'} · {aiDraft.assignments?.length || 0} 筆)
              </span>
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {aiDraft.errors?.length > 0 && (
                <button className="btn btn-secondary" style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
                  onClick={handleFixViolations} disabled={autoScheduling}>
                  <RefreshCw size={12} /> AI 修正違規
                </button>
              )}
            </div>
          </div>

          {/* Reasoning */}
          {aiDraft.reasoning && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, padding: '8px 12px', background: 'var(--glass-light)', borderRadius: 8 }}>
              <strong>AI 排班邏輯：</strong> {aiDraft.reasoning}
            </div>
          )}

          {/* Errors */}
          {aiDraft.errors?.length > 0 && (
            <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#ef4444', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} /> {aiDraft.errors.length} 個違規
              </div>
              {aiDraft.errors.map((v, i) => (
                <div key={i} style={{ fontSize: 12, color: '#fca5a5', paddingLeft: 20 }}>
                  [{v.constraint}] {v.message}
                </div>
              ))}
            </div>
          )}

          {/* Warnings */}
          {aiDraft.warnings?.length > 0 && (
            <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#f59e0b', marginBottom: 4 }}>
                ⚠️ {aiDraft.warnings.length} 個警告
              </div>
              {aiDraft.warnings.map((v, i) => (
                <div key={i} style={{ fontSize: 12, color: '#fcd34d', paddingLeft: 20 }}>
                  [{v.constraint}] {v.message}
                </div>
              ))}
            </div>
          )}

          {/* All clear */}
          {(aiDraft.errors?.length === 0 && aiDraft.warnings?.length === 0) && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={14} style={{ color: '#22c55e' }} />
              <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>排班完全符合勞基法規定</span>
            </div>
          )}

          {/* Draft preview table */}
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-medium)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1 }}>員工</th>
                  {activeDates.map(d => {
                    const dow = getDayLabel(d)
                    const isWeekend = [5, 6].includes(new Date(d).getDay()) // Fri + Sat
                    return (
                      <th key={d} style={{ textAlign: 'center', padding: '6px 2px', color: isWeekend ? 'var(--accent-red)' : 'var(--text-muted)', minWidth: viewMode === 'month' ? 40 : 70, fontSize: viewMode === 'month' ? 10 : 12 }}>
                        {d.slice(5)}<br /><span style={{ fontSize: 9 }}>{dow}</span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map(emp => {
                  const empAssignments = aiDraft.assignments?.filter(a => a.employee === emp.name) || []
                  return (
                    <tr key={emp.name} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 500, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1 }}>{emp.name}</td>
                      {activeDates.map(date => {
                        const a = empAssignments.find(a => a.date === date)
                        const shift = a?.shift
                        const isRest = isAbsence(shift)
                        const hasError = aiDraft.errors?.some(v => v.employee === emp.name && v.message.includes(date))
                        return (
                          <td key={date} style={{
                            textAlign: 'center', padding: '2px', verticalAlign: 'middle',
                            background: hasError ? 'rgba(239,68,68,0.15)' : isRest ? 'var(--glass-light)' : shift ? 'rgba(34,197,94,0.08)' : 'transparent',
                            borderRadius: 4, fontSize: viewMode === 'month' ? 9 : 11,
                          }}>
                            {isRest ? (
                              <span style={{ color: 'var(--text-muted)' }}>{shift}</span>
                            ) : shift ? (
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{shift}</span>
                            ) : '-'}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Calendar Events / Holiday + Custom Events */}
      {mainTab === 'schedule' && (
        <ScheduleCalendarEvents
          selectedMonth={selectedMonth}
          monthDates={monthDates}
          holidays={holidays}
          storeEvents={storeEvents}
          setStoreEvents={setStoreEvents}
          storeFilter={storeFilter}
          locations={locations}
        />
      )}

      {mainTab === 'schedule' && (
        <MonthScheduleTable
          monthDates={monthDates}
          filtered={filtered}
          employees={employees}
          locations={locations}
          schedules={schedules}
          shiftDefs={shiftDefs}
          SHIFT_TYPES={SHIFT_TYPES}
          getShift={getShift}
          getShiftStyle={getShiftStyle}
          getOffRequest={getOffRequest}
          editCell={editCell}
          setEditCell={setEditCell}
          handleSetShift={handleSetShift}
          handleDeleteShift={handleDeleteShift}
          canEditSchedule={canEditSchedule}
          getStoreShifts={getStoreShifts}
          storeFilter={storeFilter}
          holidaySet={holidaySet}
          deptFilter={deptFilter}
          setDeptFilter={setDeptFilter}
          departments={departments}
          storeSettings={storeSettings}
        />
      )}

      {mainTab === 'store-settings' && (
        <div>
          <StoreSettingsTab
            storeFilter={storeFilter} selectedStore={selectedStore} shiftDefs={shiftDefs}
            setShiftDefs={setShiftDefs} setShiftTypes={(defs) => setShiftTypes(buildShiftTypes(defs))}
            storeSettings={storeSettings} setStoreSettings={setStoreSettings}
            staffing={staffing} setStaffing={setStaffing}
            operatingHours={operatingHours} setOperatingHours={setOperatingHours}
            yearMonth={selectedMonth}
          />
        </div>
      )}

      {mainTab === 'preferences' && (
        <PreferencesTab
          filtered={filtered} shiftDefs={shiftDefs}
          preferences={preferences} setPreferences={setPreferences}
        />
      )}

      {mainTab === 'swaps' && (
        <SwapsTab swaps={swaps} setSwaps={setSwaps} />
      )}

      {mainTab === 'cross-store' && (
        <CrossStoreTab
          storeFilter={storeFilter} locations={locations}
          shiftDefs={shiftDefs} weekDates={weekDates}
        />
      )}

      {mainTab === 'analytics' && (
        <AnalyticsTab
          filtered={filtered} schedules={schedules} weekDates={weekDates}
          shiftDefs={shiftDefs} storeSettings={storeSettings} holidays={holidays}
        />
      )}

      {showLawModal && <LawReferenceModal onClose={() => setShowLawModal(false)} />}

      {/* Comp-off assignment modal */}
      {showCompOff && (
        <CompOffModal
          employees={filtered}
          activeDates={activeDates}
          schedules={schedules}
          onAssign={async (assignments) => {
            // assignments = [{ employee, date }]
            for (const { employee, date } of assignments) {
              const existing = schedules.find(s => s.employee === employee && s.date === date)
              if (existing) {
                const { data } = await supabase.from('schedules')
                  .update({ shift: '補休', actual_start: null, actual_end: null })
                  .eq('id', existing.id).select().single()
                if (data) setSchedules(prev => prev.map(s => s.id === existing.id ? data : s))
              } else {
                const { data } = await supabase.from('schedules')
                  .insert({ employee, date, shift: '補休', ...(tenantId ? { tenant_id: tenantId } : {}) })
                  .select().single()
                if (data) setSchedules(prev => [...prev, data])
              }
            }
            setShowCompOff(false)
          }}
          onClose={() => setShowCompOff(false)}
        />
      )}

      <CoverShiftModal
        coverModal={coverModal} setCoverModal={setCoverModal}
        coverLoading={coverLoading} coverCandidates={coverCandidates}
        handleAssignCover={handleAssignCover}
      />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  Comp-Off Assignment Modal (指派補休)
// ══════════════════════════════════════════════════════════════
function CompOffModal({ employees, activeDates, schedules, onAssign, onClose }) {
  const [selected, setSelected] = useState({}) // { "empName_date": true }
  const [saving, setSaving] = useState(false)

  const toggle = (emp, date) => {
    const key = `${emp}_${date}`
    setSelected(prev => {
      const next = { ...prev }
      if (next[key]) delete next[key]
      else next[key] = true
      return next
    })
  }

  const handleSave = async () => {
    const assignments = Object.keys(selected).map(key => {
      const [employee, date] = key.split('_')
      return { employee, date }
    })
    if (assignments.length === 0) return
    setSaving(true)
    await onAssign(assignments)
    setSaving(false)
  }

  const selectedCount = Object.keys(selected).length
  const dows = ['日', '一', '二', '三', '四', '五', '六']

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 24, width: '90%', maxWidth: 800, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>🔄 指派補休</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          點選格子指派補休，已有班的格子會被覆蓋為補休。
          {selectedCount > 0 && <strong style={{ color: 'var(--accent-cyan)', marginLeft: 8 }}>已選 {selectedCount} 格</strong>}
        </p>

        {/* Grid: employees × dates */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ padding: '6px 8px', textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1 }}>員工</th>
                {activeDates.map(d => {
                  const dow = new Date(d).getDay()
                  return (
                    <th key={d} style={{ padding: '4px 2px', textAlign: 'center', minWidth: 36, color: dow === 0 || dow === 6 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                      <div>{parseInt(d.slice(8))}</div>
                      <div style={{ fontSize: 10 }}>{dows[dow]}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.name}>
                  <td style={{ padding: '4px 8px', fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1 }}>
                    {emp.name}
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
                      {emp.employment_type === '兼職' || emp.employment_type === 'PT' ? 'PT' : ''}
                    </span>
                  </td>
                  {activeDates.map(date => {
                    const key = `${emp.name}_${date}`
                    const isSelected = selected[key]
                    const existingShift = schedules.find(s => s.employee === emp.name && s.date === date)?.shift
                    const isAlreadyCompOff = existingShift === '補休'

                    return (
                      <td key={date} style={{ padding: 1, textAlign: 'center' }}>
                        <button
                          onClick={() => !isAlreadyCompOff && toggle(emp.name, date)}
                          style={{
                            width: 34, height: 28, borderRadius: 6, fontSize: 10, fontWeight: 600,
                            border: isSelected ? '2px solid #3b82f6' : '1px solid var(--border-subtle)',
                            background: isAlreadyCompOff ? 'rgba(59,130,246,0.15)' : isSelected ? 'rgba(59,130,246,0.2)' : 'transparent',
                            color: isAlreadyCompOff ? '#3b82f6' : isSelected ? '#3b82f6' : 'var(--text-muted)',
                            cursor: isAlreadyCompOff ? 'default' : 'pointer',
                            opacity: isAlreadyCompOff ? 0.6 : 1,
                          }}
                        >
                          {isAlreadyCompOff ? '補' : isSelected ? '補' : existingShift ? existingShift.slice(0, 3) : '—'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose} style={{ padding: '8px 20px' }}>取消</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={selectedCount === 0 || saving}
            style={{ padding: '8px 20px', background: '#3b82f6' }}>
            {saving ? '儲存中...' : `確認指派 ${selectedCount} 筆補休`}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ══════════════════════════════════════════════════════════════
//  Schedule Calendar Events (holidays + custom events)
// ══════════════════════════════════════════════════════════════
function ScheduleCalendarEvents({ selectedMonth, monthDates, holidays, storeEvents, setStoreEvents, storeFilter, locations }) {
  const [newEvent, setNewEvent] = useState({ date: '', title: '', color: '#f59e0b' })
  const [showForm, setShowForm] = useState(false)

  const store = locations.find(s => s.name === storeFilter)
  const dows = ['日', '一', '二', '三', '四', '五', '六']

  const handleAdd = async () => {
    if (!newEvent.date || !newEvent.title || !store) return
    const { data, error } = await supabase.from('store_events')
      .insert({ store_id: store.id, date: newEvent.date, title: newEvent.title, color: newEvent.color })
      .select().single()
    if (data) setStoreEvents(prev => [...prev, data])
    if (error) alert('新增失敗：' + error.message)
    setNewEvent({ date: '', title: '', color: '#f59e0b' })
    setShowForm(false)
  }

  const handleDelete = async (id) => {
    await supabase.from('store_events').delete().eq('id', id)
    setStoreEvents(prev => prev.filter(e => e.id !== id))
  }

  const holidayDates = monthDates.filter(d => holidays.includes(d))

  return (
    <div className="card" style={{ marginBottom: 12, padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>📅 {selectedMonth} 行事曆</span>
        {storeFilter && (
          <button onClick={() => setShowForm(!showForm)} style={{
            padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border-medium)',
            background: showForm ? 'rgba(34,211,238,0.1)' : 'var(--bg-card)',
            color: showForm ? 'var(--accent-cyan)' : 'var(--text-muted)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>
            {showForm ? '收起' : '+ 新增活動'}
          </button>
        )}
      </div>

      {/* Add event form */}
      {showForm && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--glass-light)' }}>
          <div>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>日期</label>
            <select className="form-input" style={{ width: 100, padding: '5px 6px', fontSize: 12 }}
              value={newEvent.date} onChange={e => setNewEvent(prev => ({ ...prev, date: e.target.value }))}>
              <option value="">選日期</option>
              {monthDates.map(d => {
                const day = parseInt(d.slice(8))
                const dow = dows[new Date(d).getDay()]
                return <option key={d} value={d}>{day}({dow})</option>
              })}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>活動名稱</label>
            <input className="form-input" type="text" placeholder="例：包場、週年慶" style={{ width: '100%', padding: '5px 8px', fontSize: 12 }}
              value={newEvent.title} onChange={e => setNewEvent(prev => ({ ...prev, title: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>顏色</label>
            <input type="color" value={newEvent.color} onChange={e => setNewEvent(prev => ({ ...prev, color: e.target.value }))}
              style={{ width: 32, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer' }} />
          </div>
          <button onClick={handleAdd} disabled={!newEvent.date || !newEvent.title} className="btn btn-primary btn-sm" style={{ padding: '5px 12px', fontSize: 12 }}>
            新增
          </button>
        </div>
      )}

      {/* Event list */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {/* National holidays */}
        {holidayDates.map(d => {
          const day = parseInt(d.slice(8))
          const dow = dows[new Date(d).getDay()]
          return (
            <span key={`h_${d}`} style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: 'rgba(239,68,68,0.1)', color: 'var(--accent-red)',
            }}>
              🏷️ {day}({dow}) 國定假日
            </span>
          )
        })}

        {/* Custom store events */}
        {storeEvents.map(ev => {
          const day = parseInt(ev.date.slice(8))
          const dow = dows[new Date(ev.date).getDay()]
          return (
            <span key={ev.id} style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: (ev.color || '#f59e0b') + '20', color: ev.color || '#f59e0b',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              📌 {day}({dow}) {ev.title}
              <button onClick={() => handleDelete(ev.id)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                color: 'inherit', fontSize: 10, opacity: 0.6, lineHeight: 1,
              }}>✕</button>
            </span>
          )
        })}

        {holidayDates.length === 0 && storeEvents.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>本月無節慶或活動</span>
        )}
      </div>
    </div>
  )
}
