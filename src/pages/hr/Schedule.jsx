import { useState, useEffect } from 'react'
import { Sparkles, Shield, Save, Code } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { validateSchedule } from '../../lib/laborLaw'
import { gatherSchedulingData, runAiSchedule, runMonthlyAiSchedule, fixViolations } from '../../lib/schedulingAi'
import { runProgrammaticSchedule, runMonthlyProgrammaticSchedule } from '../../lib/schedulingAlgo'
import { parseTime, getMonthDates, getWeekDates, isAbsence, formatYearMonth, parseYearMonth, getDayLabel, listCyclesInRange, getCycleFor } from '../../lib/scheduleUtils'
import { useTenant } from '../../contexts/TenantContext'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import MonthScheduleTable from './components/MonthScheduleTable'
import StoreSettingsTab from './components/StoreSettingsTab'
import PreferencesTab from './components/PreferencesTab'
import SwapsTab from './components/SwapsTab'
import AnalyticsTab from './components/AnalyticsTab'
import CrossStoreTab from './components/CrossStoreTab'
import LawReferenceModal from './components/LawReferenceModal'
import CoverShiftModal from './components/CoverShiftModal'
import CompOffModal from './components/CompOffModal'
import ScheduleCalendarEvents from './components/ScheduleCalendarEvents'
import AiDraftReviewPanel from './components/AiDraftReviewPanel'
import { notifySchedulePublished, notifyCoverInvitationFromWeb } from '../../lib/lineNotify'
import { exportScheduleCalendarPdf } from '../../lib/exportPdf'
import { validateShiftChange } from '../../lib/scheduleValidator'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
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

  const { role: authRole, profile: authProfile } = useAuth()
  const userRole = authRole?.name || 'store_staff'
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
  const [minStaffWeekend, setMinStaffWeekend] = useState(3)
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
  const [viewMode, setViewMode] = useState('month') // 'month' | 'cycle'
  // Cycle view 用的探測日期，null = 跟著 selectedMonth 的 1 號走
  const [cycleProbeDate, setCycleProbeDate] = useState(null)
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

  // 換月 / 換店時 reset cycle probe，避免拿舊 anchor 算
  useEffect(() => { setCycleProbeDate(null) }, [selectedMonth, storeFilter])

  // 換到非變形工時店時，自動切回月視圖（不然 toggle 會消失但 viewMode 卡在 cycle）
  useEffect(() => {
    const ws = storeSettings?.work_hour_system
    const anchor = storeSettings?.variable_period_start
    const canCycle = ws && ws !== '標準工時' && !!anchor
    if (!canCycle && viewMode === 'cycle') setViewMode('month')
  }, [storeSettings, viewMode])

  // Cycle view: derive cycle from probe date (defaults to monthStart)
  const effectiveCycleProbe = cycleProbeDate || monthStart
  const cycleInfo = (() => {
    if (viewMode !== 'cycle') return null
    const ws = storeSettings?.work_hour_system
    const anchor = storeSettings?.variable_period_start
    if (!ws || ws === '標準工時' || !anchor) return null
    return getCycleFor(effectiveCycleProbe, ws, anchor)
  })()
  const cycleDates = (() => {
    if (!cycleInfo) return null
    const out = []
    const start = new Date(cycleInfo.start + 'T00:00:00Z')
    const end = new Date(cycleInfo.end + 'T00:00:00Z')
    for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(d.toISOString().slice(0, 10))
    }
    return out
  })()

  // Active dates based on view mode (cycle 沒設定 anchor 時 fallback 到 month)
  const useCycleView = viewMode === 'cycle' && cycleDates && cycleInfo
  const activeDates = useCycleView ? cycleDates : monthDates
  const activeStart = useCycleView ? cycleInfo.start : monthStart
  const activeEnd = useCycleView ? cycleInfo.end : monthEnd

  useEffect(() => {
    Promise.all([
      supabase.from('employees').select('id, name, dept, store, supervisor, department_id, position, store_id, employment_type, schedule_priority, can_open, can_close, additional_stores, weekly_target_hours, personal_hour_cap, join_date, resign_date').eq('status', '在職').order('name'),
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
    // 模擬中：aiDraft 存在時純看 draft（找不到也不 fallback DB）
    // 之前 `if (a) return a.shift` 找不到才 fallback schedules → 畫面跟警告
    // 兩個 source 不同步：畫面顯示 DB 殘留「11:00~17:00」(2 人 cover)，但警告
    // 基於 draft「休」(1 人 cover) → S10 警告 1/2 跟畫面看不一致的衝突
    // 發布後 aiDraft 會被清掉，自動 fallback 回 schedules state（DB）
    if (aiDraft?.assignments) {
      const a = aiDraft.assignments.find(a => a.employee === empName && a.date === date)
      return a?.shift || ''
    }
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
        const proceed = (await confirm({ message: `⚠️ 違規警告：\n\n${validation.errors.map(e => `❌ ${e}`).join('\n')}` +
          (validation.warnings.length > 0 ? `\n\n${validation.warnings.map(w => `⚠ ${w}`).join('\n')}` : '') +
          `\n\n確定要強制排班嗎？` }))
        if (!proceed) return
      } else if (validation.warnings.length > 0) {
        const proceed = (await confirm({ message: `注意事項：\n\n${validation.warnings.map(w => `⚠ ${w}`).join('\n')}` +
          `\n\n確定要排班嗎？` }))
        if (!proceed) return
      }
    }

    const record = {
      shift,
      actual_start: actualStart || null,
      actual_end: actualEnd || null,
    }

    const existing = schedules.find(s => s.employee === empName && s.date === date)
    if (existing) {
      const { data } = await supabase.from('schedules').update(record).eq('id', existing.id).select().single()
      if (data) setSchedules(prev => prev.map(s => s.id === existing.id ? data : s))
    } else {
      const { data } = await supabase.from('schedules').insert({
        employee: empName, date, ...record,
        organization_id: authProfile?.organization_id || null,
      }).select().single()
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

  // Get available shifts for a specific store (store-specific + global fallback)
  const getStoreShifts = (storeName, empType = 'all') => {
    const store = locations.find(l => l.name === storeName)
    const storeId = store?.id
    return shiftDefs.filter(d => {
      // Match store: store-specific OR global (no store_id)
      const storeMatch = !d.store_id || d.store_id === storeId
      // Match employee type: 'all' means return everything
      const typeMatch = empType === 'all' || !d.employee_type || d.employee_type === 'all' || d.employee_type === empType
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
    if (!(await confirm({ message: `強制指派 ${coverEmpName} 代班 ${shift}？\n\n（被指派者沒有同意機會。建議優先用「發出代班邀請」讓員工自願接班）` }))) return
    const { data } = await supabase.from('schedules').upsert({ employee: coverEmpName, date, shift }, { onConflict: 'employee,date' }).select().single()
    if (data) {
      setSchedules(prev => {
        const idx = prev.findIndex(s => s.employee === coverEmpName && s.date === date)
        if (idx >= 0) return prev.map((s, i) => i === idx ? data : s)
        return [...prev, data]
      })
    }
    setCoverModal(null)
    toast.success(`已強制指派 ${coverEmpName} 代班 ${shift}`)
  }

  // 邀請式代班 — 主管發出邀請，所有候選人收 LINE，先搶先贏
  const handlePostCoverRequest = async (reason) => {
    if (!coverModal) return
    const { employee: absentEmpName, date, shift } = coverModal
    const eligibleCandidates = coverCandidates.filter(c => c.isOff && c.valid11h)
    if (eligibleCandidates.length === 0) {
      toast.error('沒有可邀請的候選人')
      return
    }

    // 抓缺勤者 ID + 班別 snapshot
    const absentEmp = employees.find(e => e.name === absentEmpName)
    const absentSched = schedules.find(s => s.employee === absentEmpName && s.date === date)
    if (!absentEmp) { toast.error('找不到缺勤員工'); return }

    const storeRow = locations.find(l => l.name === (absentSched?.store || absentEmp.store))
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()

    const invitedIds = eligibleCandidates.map(c => employees.find(e => e.name === c.name)?.id).filter(Boolean)

    const { data, error } = await supabase.from('shift_cover_requests').insert({
      organization_id: tenantId,
      store: absentSched?.store || absentEmp.store,
      store_id: storeRow?.id || null,
      requester_id: authProfile?.id || null,
      requester_name: authProfile?.name || '主管(Web)',
      absent_emp_id: absentEmp.id,
      absent_emp_name: absentEmp.name,
      shift_date: date,
      shift_label: shift,
      actual_start: absentSched?.actual_start || null,
      actual_end: absentSched?.actual_end || null,
      actual_hours: absentSched?.actual_hours || null,
      invited_emp_ids: invitedIds,
      reason: reason?.trim() || null,
      status: '招募中',
      expires_at: expiresAt,
    }).select().single()

    if (error) { toast.error('發出失敗：' + error.message); return }

    // 推 LINE 給候選人
    notifyCoverInvitationFromWeb(
      eligibleCandidates.map(c => ({ empId: employees.find(e => e.name === c.name)?.id, name: c.name })),
      { shift_date: date, shift_label: shift, absent_emp_name: absentEmp.name, reason: reason?.trim() }
    ).catch(err => console.warn('LINE 推播失敗', err))

    setCoverModal(null)
    toast.error(`✅ 已發出代班邀請給 ${eligibleCandidates.length} 位候選人，等待先搶先贏（24h 過期）`)
  }

  // ── AI Auto-Schedule (LLM-based, 6-phase framework) ──
  const handleAutoSchedule = async () => {
    if (!canUseAISchedule) { toast.error('您沒有使用 AI 排班的權限'); return }
    const isMonthly = viewMode === 'month'
    const isCycle = viewMode === 'cycle' && cycleDates && cycleInfo
    const isMulti = isMonthly || isCycle  // 月制 + cycle 都要走多週邏輯
    const rangeLabel = isCycle
      ? `Cycle ${cycleInfo.start} ~ ${cycleInfo.end}`
      : isMonthly ? `${selectedMonth} 月排班`
      : `${weekStart} ~ ${weekEnd}`
    if (!(await confirm({ message: `將使用 AI (Gemini 2.5) 為 ${filtered.length} 位員工自動排班（${rangeLabel}）\n\n已有的排班會保留。AI 產出為草稿，您可以審閱後再發布。` }))) return
    setAutoScheduling(true)
    setAiDraft(null)
    setAiProgress('正在收集排班資料...')

    try {
      const dateStart = isCycle ? cycleInfo.start : isMonthly ? monthStart : weekStart
      const dateEnd   = isCycle ? cycleInfo.end   : isMonthly ? monthEnd   : weekEnd
      const multiDates = isCycle ? cycleDates : isMonthly ? monthDates : null
      const selectedStoreObj2 = locations.find(l => l.name === storeFilter)
      const aiStoreShifts = shiftDefs.filter(d => !d.store_id || d.store_id === selectedStoreObj2?.id)

      let schedulingData = await gatherSchedulingData({
        weekDates: isMulti ? null : weekDates,
        monthDates: multiDates,
        employees: filtered, shiftDefs: aiStoreShifts,
        storeFilter, locations, minStaff, minStaffWeekend, tenantId,
      })

      // 自動讀取現有班表的休假，合併為 offRequests
      schedulingData = mergeRestDaysAsOffRequests(schedulingData, dateStart, dateEnd)

      if (isMulti) {
        setAiProgress(isCycle ? 'AI cycle 排班中...' : 'AI 月排班中...')
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
      toast.error(`AI 排班失敗：${err.message}`)
      setAiProgress('')
    } finally {
      setAutoScheduling(false)
    }
  }

  // ── Publish draft to database ──
  const handlePublishDraft = async () => {
    if (!aiDraft?.assignments?.length) return
    if (aiDraft.errors?.length > 0) {
      if (!(await confirm({ message: `仍有 ${aiDraft.errors.length} 個違規項目。確定要發布嗎？` }))) return
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

    const month = dates[0]?.slice(0, 7)

    // Update publish status
    const store = locations.find(l => l.name === storeFilter)
    if (month && store) {
      // Use authenticated profile from AuthContext — do NOT read from localStorage (untrusted)
      const pubData = { store_id: store.id, month, status: 'published', published_at: new Date().toISOString(), published_by: authProfile?.name || 'unknown' }
      await supabase.from('schedule_publish_status').upsert(pubData, { onConflict: 'store_id,month' })
      setPublishStatus(pubData)
    }

    toast.success(`已發布排班！共 ${newSchedules.length} 筆${notified > 0 ? `\n已透過 LINE 通知 ${notified} 位員工` : ''}`)
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
      toast.error(`修正失敗：${err.message}`)
      setAiProgress('')
    } finally {
      setAutoScheduling(false)
    }
  }

  // ── Discard draft ──
  const handleDiscardDraft = async () => {
    if ((await confirm({ message: '確定要捨棄排班草稿嗎？' }))) setAiDraft(null)
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
    if (!canUseAISchedule) { toast.error('您沒有使用排班功能的權限'); return }
    const isMonthly = viewMode === 'month'
    const isCycle = viewMode === 'cycle' && cycleDates && cycleInfo
    const isMulti = isMonthly || isCycle  // 月制 + cycle 都要走多週邏輯
    const rangeLabel = isCycle
      ? `Cycle ${cycleInfo.start} ~ ${cycleInfo.end}`
      : isMonthly ? `${selectedMonth} 月排班`
      : `${weekStart} ~ ${weekEnd}`
    // Guard: check shift definitions exist for this store (ignore employee_type filter)
    const selectedStoreObj = locations.find(l => l.name === storeFilter)
    const storeShifts = shiftDefs.filter(d => !d.store_id || d.store_id === selectedStoreObj?.id)
    if (storeShifts.length === 0) {
      toast.error('⚠ 尚未設定班別定義，無法排班。\n\n請先到「門市設定」新增班別（例如：11-20 早班、15-0 晚班等）。')
      return
    }
    if (!(await confirm({ message: `將使用程式演算法為 ${filtered.length} 位員工自動排班（${rangeLabel}）\n\n不使用 AI，純邏輯計算。產出為草稿，您可以審閱後再發布。` }))) return
    setAutoScheduling(true)
    setAiDraft(null)
    setAiProgress('程式排班計算中...')

    try {
      const dateStart = isCycle ? cycleInfo.start : isMonthly ? monthStart : weekStart
      const dateEnd   = isCycle ? cycleInfo.end   : isMonthly ? monthEnd   : weekEnd
      // cycle / monthly 都把整段日期當 monthDates 傳（演算法以 monthDates 切週迴圈）
      const multiDates = isCycle ? cycleDates : isMonthly ? monthDates : null

      let schedulingData = await gatherSchedulingData({
        weekDates: isMulti ? null : weekDates,
        monthDates: multiDates,
        employees: filtered, shiftDefs: storeShifts,
        storeFilter, locations, minStaff, minStaffWeekend, tenantId,
      })

      // 自動讀取現有班表的休假，合併為 offRequests
      schedulingData = mergeRestDaysAsOffRequests(schedulingData, dateStart, dateEnd)

      const result = isMulti
        ? runMonthlyProgrammaticSchedule(schedulingData, setAiProgress)
        : runProgrammaticSchedule(schedulingData)

      setAiDraft({ ...result, schedulingData })
      setAiProgress('')
    } catch (err) {
      console.error('[Code Schedule] Error:', err)
      toast.error(`程式排班失敗：${err.message}`)
      setAiProgress('')
    } finally {
      setAutoScheduling(false)
    }
  }

  // ── Python 排班 v2（呼叫 /api/schedule.py 純手寫 backtracking solver）──
  const handlePythonSchedule = async () => {
    if (!storeFilter) { toast.error('請先選擇門市'); return }
    if (filtered.length === 0) { toast.error('沒有員工可排班'); return }
    const selectedStoreObj = locations.find(l => l.name === storeFilter)
    if (!selectedStoreObj) { toast.error('找不到門市資料'); return }
    const isMonthly = viewMode === 'month'
    const isCycle = viewMode === 'cycle' && cycleDates && cycleInfo
    const rangeLabel = isCycle
      ? `Cycle ${cycleInfo.start} ~ ${cycleInfo.end}`
      : isMonthly ? `${selectedMonth} 月排班`
      : `${weekStart} ~ ${weekEnd}`
    if (!(await confirm({ message: `用 Python 演算法為 ${filtered.length} 位員工排班（${rangeLabel}）\n\nv2 純手寫 backtracking solver，hard rule 嚴格保證 H3/H4 不違法。產出為草稿。` }))) return

    setAutoScheduling(true)
    setAiDraft(null)
    setAiProgress('Python solver 計算中... (最多 30 秒)')

    try {
      const dates = isCycle ? cycleDates : isMonthly ? monthDates : weekDates

      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: selectedStoreObj.id,
          organization_id: authProfile?.organization_id || tenantId,
          cycle_dates: dates,
          timeout_seconds: 25,
        }),
      })
      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`HTTP ${res.status}: ${errBody}`)
      }
      const result = await res.json()

      // 把 Python output 轉成跟現有 schedulingAlgo 一致的 shape
      const name_by_id = Object.fromEntries(filtered.map(e => [e.id, e.name]))
      const assignments = result.assignments.map(a => ({
        employee: name_by_id[a.employee_id] || `#${a.employee_id}`,
        date: a.date,
        shift: a.is_rest ? '休' : (a.window_start && a.window_end ? `${a.window_start}-${a.window_end}` : '上班'),
        actual_start: a.window_start,
        actual_end: a.window_end,
        actual_hours: a.hours,
      }))
      const errors = result.violations.filter(v => v.severity === 'error').map(v => ({
        employee: name_by_id[v.employee_id] || '-',
        constraint: v.constraint,
        date: v.date,
        message: v.message,
        severity: 'error',
      }))
      const warnings = result.violations.filter(v => v.severity === 'warning').map(v => ({
        employee: name_by_id[v.employee_id] || '-',
        constraint: v.constraint,
        date: v.date,
        message: v.message,
        severity: 'warning',
      }))

      setAiDraft({
        success: result.success,
        assignments,
        errors,
        warnings,
        violations: [...errors, ...warnings],
        reasoning: `Python solver v2 (backtracking)：${assignments.length} 筆。耗時 ${result.elapsed_ms}ms。`,
        meta: { model: 'python-backtracking-v1', mode: 'hybrid' },
        stats: result.stats,
      })
      setAiProgress('')
      if (!result.success) {
        toast.warning('Python solver 沒找到完全合法解，請看 violations 手動調整')
      }
    } catch (err) {
      console.error('[Python Schedule] Error:', err)
      toast.error(`Python 排班失敗：${err.message}`)
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
    if (isAbsence(shift)) {
      const type = SHIFT_TYPES.find(t => t.label === shift)
      if (!type) return {}
      return { background: type.dim, color: type.color, border: `1px solid ${type.color}30` }
    }
    // All work shifts use a single unified color for cleaner visuals
    return { background: 'rgba(34,211,238,0.10)', color: 'var(--accent-cyan)', border: '1px solid rgba(34,211,238,0.18)' }
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
              平日
              <input type="number" className="form-input" style={{ width: 42, padding: '4px 6px', fontSize: 12, textAlign: 'center' }}
                value={minStaff} onChange={e => setMinStaff(Math.max(1, Math.min(Number(e.target.value) || 1, 99)))} min={1} max={99} />
              假日
              <input type="number" className="form-input" style={{ width: 42, padding: '4px 6px', fontSize: 12, textAlign: 'center' }}
                value={minStaffWeekend} onChange={e => setMinStaffWeekend(Math.max(1, Math.min(Number(e.target.value) || 1, 99)))} min={1} max={99} />
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
              if (!lastSchedules?.length) { toast.error('上月無排班資料'); return }
              if (!(await confirm({ message: `將上月 ${lastSchedules.length} 筆排班複製到 ${selectedMonth}？\n\n會根據星期幾對應，已有的排班會被覆蓋。` }))) return
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
                const { data } = await supabase.from('schedules').upsert(newSchedules, { onConflict: 'employee,date' }).select()
                if (data) setSchedules(prev => { const map = {}; for (const s of [...prev, ...data]) map[`${s.employee}_${s.date}`] = s; return Object.values(map) })
                toast.success(`已複製 ${newSchedules.length} 筆排班到 ${selectedMonth}`)
              }
            }}>
              📋 複製上月
            </button>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={async () => {
              const empNames = filtered.map(e => e.name)
              if (!(await confirm({ message: `確定要清除 ${selectedMonth} ${storeFilter || '所有門市'} 共 ${empNames.length} 人的排班嗎？` }))) return
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
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => {
              exportScheduleCalendarPdf({
                storeName: storeFilter || '全部門市',
                yearMonth: selectedMonth,
                monthDates,
                schedules: schedules.filter(s => filtered.some(e => e.name === s.employee)),
                holidaySet,
              })
            }}>
              📅 月曆 PDF
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
                <button className="btn btn-primary" style={{ width: 'auto', padding: '8px 16px', background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-blue, #3b82f6))' }}
                  onClick={handlePythonSchedule} disabled={autoScheduling}
                  title="純 Python backtracking solver — H3/H4 嚴格保證、跨 cycle 月休不超標">
                  🐍 {autoScheduling && aiProgress.includes('Python') ? aiProgress : 'Python 排班 v2'}
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
        {/* Month navigator (cycle 模式時藏起來，避免兩種選擇器互相干擾) */}
        {viewMode !== 'cycle' && (
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
        {/* View mode toggle (only show cycle option when store is variable + has anchor) */}
        {storeSettings?.work_hour_system && storeSettings.work_hour_system !== '標準工時' && storeSettings?.variable_period_start && (
          <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 8, overflow: 'hidden' }}>
            {[
              { key: 'month', label: '📅 月' },
              { key: 'cycle', label: '🔄 Cycle' },
            ].map(v => (
              <button key={v.key} onClick={() => setViewMode(v.key)} style={{
                padding: '4px 12px', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: viewMode === v.key ? 'var(--accent-purple)' : 'var(--bg-card)',
                color: viewMode === v.key ? '#fff' : 'var(--text-muted)',
              }}>{v.label}</button>
            ))}
          </div>
        )}
        {/* Cycle navigator: prev / label / next（cycle 模式才出現） */}
        {viewMode === 'cycle' && cycleInfo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: 12, opacity: cycleInfo.cycleIndex <= 0 ? 0.4 : 1 }}
              title={cycleInfo.cycleIndex <= 0 ? '已是第一個 cycle' : '上一個 cycle'}
              disabled={cycleInfo.cycleIndex <= 0}
              onClick={() => {
                if (cycleInfo.cycleIndex <= 0) return
                // 當前 cycle 開始日 -1 天 → 拿到上一個 cycle 內的某天
                const d = new Date(cycleInfo.start + 'T00:00:00Z')
                d.setUTCDate(d.getUTCDate() - 1)
                setCycleProbeDate(d.toISOString().slice(0, 10))
              }}
            >◀</button>
            <div style={{
              padding: '4px 12px', borderRadius: 8,
              background: 'var(--accent-purple-dim)', border: '1px solid var(--accent-purple)',
              fontSize: 12, fontWeight: 600, color: 'var(--accent-purple)',
              whiteSpace: 'nowrap',
            }}>
              Cycle #{cycleInfo.cycleIndex + 1}: {cycleInfo.start} ~ {cycleInfo.end}
            </div>
            <button
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: 12 }}
              title="下一個 cycle"
              onClick={() => {
                // 當前 cycle 結束日 +1 天 → 下一個 cycle 內的某天
                const d = new Date(cycleInfo.end + 'T00:00:00Z')
                d.setUTCDate(d.getUTCDate() + 1)
                setCycleProbeDate(d.toISOString().slice(0, 10))
              }}
            >▶</button>
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

      {/* Cycle banner — 變形工時 + 有 anchor 時顯示本月跨幾個 cycle */}
      {(() => {
        const ws = storeSettings?.work_hour_system
        const anchor = storeSettings?.variable_period_start
        if (!storeFilter || !ws || ws === '標準工時' || !anchor) return null
        const cycles = listCyclesInRange(monthStart, monthEnd, ws, anchor)
        if (cycles.length === 0) return null
        return (
          <div style={{
            marginBottom: 12, padding: '8px 14px', borderRadius: 10,
            background: 'var(--accent-purple-dim)', border: '1px solid var(--accent-purple)',
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
            fontSize: 13,
          }}>
            <span style={{ fontWeight: 700, color: 'var(--accent-purple)' }}>
              📐 {ws}
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              本月跨 {cycles.length} 個 cycle：
            </span>
            {cycles.map((c, i) => (
              <span key={c.cycleIndex} style={{
                padding: '2px 8px', borderRadius: 6,
                background: 'var(--bg-card)', border: '1px solid var(--accent-purple)',
                color: 'var(--accent-purple)', fontWeight: 600,
              }}>
                #{c.cycleIndex + 1}: {c.start} ~ {c.end}
              </span>
            ))}
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              起算日 {anchor}
            </span>
          </div>
        )
      })()}

      {/* AI Draft Review Panel */}
      {aiDraft && mainTab === 'schedule' && (
        <AiDraftReviewPanel
          aiDraft={aiDraft}
          filtered={filtered}
          activeDates={activeDates}
          viewMode={viewMode}
          autoScheduling={autoScheduling}
          onFixViolations={handleFixViolations}
        />
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
          monthDates={activeDates}
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
          storeFilter={storeFilter} locations={locations}
          getStoreShifts={getStoreShifts}
          schedules={schedules}
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
                  .insert({ employee, date, shift: '補休' })
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
        handlePostCoverRequest={handlePostCoverRequest}
      />
    </div>
  )
}

