import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Shield, Save, Code, Wand2, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { validateSchedule } from '../../lib/laborLaw'
import { gatherSchedulingData, runAiSchedule, runMonthlyAiSchedule, fixViolations } from '../../lib/schedulingAi'
import { runProgrammaticSchedule, runMonthlyProgrammaticSchedule } from '../../lib/schedulingAlgo'
import { parseTime, getMonthDates, getWeekDates, isAbsence, formatYearMonth, parseYearMonth, getDayLabel, listCyclesInRange, getCycleFor, validateLeisureQuota, validateMonthlyOvertime, validateNightShiftProtection, validateHolidayWork } from '../../lib/scheduleUtils'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import MonthScheduleTable from './components/MonthScheduleTable'
import StoreSettingsTab from './components/StoreSettingsTab'
import PreferencesTab from './components/PreferencesTab'
import SwapsTab from './components/SwapsTab'
import AnalyticsTab from './components/AnalyticsTab'
import CrossStoreTab from './components/CrossStoreTab'
import LawReferenceModal from './components/LawReferenceModal'
import ScheduleImportModal from './components/ScheduleImportModal'
import EmployeeSchedulePatternsModal from './components/EmployeeSchedulePatternsModal'
import CoverShiftModal from './components/CoverShiftModal'
import CompOffModal from './components/CompOffModal'
import ScheduleCalendarEvents from './components/ScheduleCalendarEvents'
import AiDraftReviewPanel from './components/AiDraftReviewPanel'
import CreateScheduleWizard from './components/CreateScheduleWizard'
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

  const navigate = useNavigate()
  const { role: authRole, profile: authProfile, hasPermission } = useAuth()
  const userRole = authRole?.name || 'store_staff'
  // 角色預設 OR 被授予對應權限（權限設定頁可分人）
  const canEditSchedule = ['admin', 'super_admin', 'manager'].includes(userRole) || hasPermission('schedule.edit')
  const canUseAISchedule = ['admin', 'super_admin', 'manager'].includes(userRole) || hasPermission('schedule.algo')
  const isSuperAdmin = userRole === 'super_admin'
  const userPosition = authProfile?.position || ''
  const isStoreMgr = !canEditSchedule && userPosition.includes('店長')
  const isSupervisor = !canEditSchedule && userPosition.includes('督導')

  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [locations, setLocations] = useState([])
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [weekOffset, setWeekOffset] = useState(0)
  const [deptFilter, setDeptFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [editCell, setEditCell] = useState(null)
  const [focusedCell, setFocusedCell] = useState(null)  // { empName, date } 鍵盤導航的焦點
  const [selection, setSelection] = useState(null)       // { anchor: {empName, date}, end: {empName, date} } 拖曳框選
  const [selecting, setSelecting] = useState(false)      // mousedown 拖曳中
  const [offRequests, setOffRequests] = useState([])
  const [pendingLeaves, setPendingLeaves] = useState([]) // 待審核/審核中請假（橘點提示用）
  const [holidays, setHolidays] = useState([]) // ['2026-04-04', ...]
  const [storeEvents, setStoreEvents] = useState([]) // [{ id, store_id, date, title, color }]
  const [shiftDefs, setShiftDefs] = useState([])
  const [SHIFT_TYPES, setShiftTypes] = useState([REST_SHIFT])
  const [autoScheduling, setAutoScheduling] = useState(false)
  const [minStaff, setMinStaff] = useState(3)
  const [minStaffWeekend, setMinStaffWeekend] = useState(3)
  const [showLawModal, setShowLawModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showPatternsModal, setShowPatternsModal] = useState(false)
  const [showComplianceModal, setShowComplianceModal] = useState(false)
  const [complianceFilterEmp, setComplianceFilterEmp] = useState(null)  // 點員工 badge 帶員工名，只看他的
  const [compliance, setCompliance] = useState({ errors: [], warnings: [], isValid: true })
  const [error, setError] = useState(null)
  const [mainTab, setMainTab] = useState('schedule') // schedule | store-settings | preferences | swaps | analytics
  // Store settings
  const [publishStatus, setPublishStatus] = useState(null) // { status: 'draft'|'published', published_at } — 發布狀態（cycle）
  const [publishStatusRows, setPublishStatusRows] = useState([]) // 多筆 cycle 級別發布狀態
  const [monthLocks, setMonthLocks] = useState([]) // schedule_month_locks: [{store_id, month, locked_at, locked_by}] — 月鎖（對齊薪資）
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
  // 自動建立精靈完成後，標記「待自動跑排班代碼」；下方 effect 等 cycle + schedules reload 就緒才觸發
  const [pendingAutoCode, setPendingAutoCode] = useState(false)
  const autoCodeSawLoadingRef = useRef(false)  // 確保等過 schedules reload（含剛寫入的休假）才排，避免漏假
  const pendingAutoStoreIdRef = useRef(null)   // 目標門市 id：cycle 週期是用門市設定算的，要等該門市設定載入才正確
  const [aiProgress, setAiProgress] = useState('') // status message during AI run
  // Schedule Wizard
  const [showWizard, setShowWizard] = useState(false)
  const [wizardMode, setWizardMode] = useState('manual')
  const [myStoreIds, setMyStoreIds] = useState([])
  const [showWizardDropdown, setShowWizardDropdown] = useState(false)
  const wizardDropdownRef = useRef(null)
  // Prevents cycleProbeDate from being reset when wizard fires storeFilter+month changes together
  const skipCycleReset = useRef(false)
  // Sync ref so effects can read current storeFilter without adding it to deps
  const storeFilterRef = useRef('')
  const scheduleAbortRef = useRef(null)
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
  // skipCycleReset prevents the reset when the wizard changes both store and month simultaneously
  useEffect(() => {
    storeFilterRef.current = storeFilter
    if (skipCycleReset.current) { skipCycleReset.current = false; return }
    setCycleProbeDate(null)
  }, [selectedMonth, storeFilter])

  // 換到非變形工時店時，自動切回月視圖（不然 toggle 會消失但 viewMode 卡在 cycle）
  // Guard: skip when storeSettings is null (not yet loaded) or belongs to a different store
  // — prevents premature revert before new settings arrive after a store switch
  useEffect(() => {
    if (!storeSettings) return
    const locMatch = locations.find(l => l.name === storeFilterRef.current)
    if (locMatch && storeSettings.store_id && storeSettings.store_id !== locMatch.id) return
    const ws = storeSettings?.work_hour_system
    const anchor = storeSettings?.variable_period_start
    const canCycle = ws && ws !== '標準工時' && !!anchor
    if (!canCycle && viewMode === 'cycle') setViewMode('month')
  }, [storeSettings, viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

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
      // 不過濾 status：要支援「看歷史月份時，當時還在職、現在已離職」的員工顯示
      // 由 filtered 的 join_date/resign_date 範圍過濾掉跟 view 沒重疊的人
      supabase.from('employees').select('id, name, dept, store, supervisor, department_id, position, store_id, employment_type, schedule_priority, can_open, can_close, additional_stores, weekly_target_hours, personal_hour_cap, join_date, resign_date, status').order('name'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('stores').select('*').order('name'),
      supabase.from('shift_definitions').select('*').order('sort_order'),
      supabase.from('holidays').select('date'),
      supabase.from('user_stores').select('employee_id, store_id, is_primary'),
      supabase.from('salary_structures').select('employee_id, employment_category'),
    ]).then(([e, d, l, sd, hd, us, ss]) => {
      // Enrich employees with user_stores data
      const userStoresMap = {}
      for (const row of (us.data || [])) {
        if (!userStoresMap[row.employee_id]) userStoresMap[row.employee_id] = []
        userStoresMap[row.employee_id].push(row.store_id)
      }
      // 員工分類（salary_structures，不在 employees）— 用來把「行政(admin)」排除在排班外
      const catMap = {}
      for (const row of (ss.data || [])) catMap[row.employee_id] = row.employment_category
      const enriched = (e.data || []).map(emp => ({
        ...emp,
        employment_category: catMap[emp.id] || null,
        assigned_store_ids: userStoresMap[emp.id] || (emp.store_id ? [emp.store_id] : []),
      }))
      setEmployees(enriched)
      setDepartments(d.data || [])
      setLocations(l.data || [])
      // Fetch current user's store assignments for role-scoped wizard filtering
      if (authProfile?.id) {
        supabase.from('user_stores').select('store_id').eq('employee_id', authProfile.id)
          .then(({ data }) => setMyStoreIds((data || []).map(r => r.store_id)))
      }
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
    // Cancel any in-flight request from a previous month/store change
    scheduleAbortRef.current?.abort()
    const controller = new AbortController()
    scheduleAbortRef.current = controller
    const { signal } = controller

    setScheduleLoading(true)
    Promise.all([
      supabase.from('schedules').select('*').gte('date', activeStart).lte('date', activeEnd).abortSignal(signal),
      supabase.from('off_requests').select('*').gte('date', activeStart).lte('date', activeEnd).abortSignal(signal),
      supabase.from('leave_requests').select('employee, start_date, end_date')
        .in('status', ['待審核', '審核中'])
        .lte('start_date', activeEnd)
        .gte('end_date', activeStart)
        .eq('unit', 'day')
        .abortSignal(signal),
    ]).then(([s, o, pl]) => {
      if (signal.aborted) return
      setSchedules(s.data || [])
      setOffRequests(o.data || [])
      setPendingLeaves(pl.data || [])
    }).catch(err => {
      if (!signal.aborted) console.error('Failed to load schedule data:', err)
    }).finally(() => {
      if (!signal.aborted) setScheduleLoading(false)
    })

    // Load publish status for current month (legacy single) + cycle-level (multi)
    const month = activeStart?.slice(0, 7)
    const store = locations.length > 0 ? locations.find(l => l.name === storeFilter) : null
    if (month && store) {
      supabase.from('schedule_publish_status').select('*')
        .eq('store_id', store.id).eq('month', month).maybeSingle()
        .then(({ data }) => { if (!signal.aborted) setPublishStatus(data) })
      // 撈整月範圍可能涉及的所有 cycle publish_status（cycle 可跨月）
      supabase.from('schedule_publish_status').select('*')
        .eq('store_id', store.id)
        .or(`and(cycle_start.lte.${activeEnd},cycle_end.gte.${activeStart}),month.eq.${month}`)
        .then(({ data }) => { if (!signal.aborted) setPublishStatusRows(data || []) })
      // 月鎖（對齊薪資）
      supabase.from('schedule_month_locks').select('*').eq('store_id', store.id)
        .then(({ data }) => { if (!signal.aborted) setMonthLocks(data || []) })
    } else {
      setPublishStatusRows([])
      setMonthLocks([])
    }

    return () => controller.abort()
  }, [activeStart, activeEnd, storeFilter, locations])

  // 鎖定狀態（月級，對齊薪資）。lockedMonths = 該店已鎖月份；lockedDates 限定在當前畫面日期
  const currentStore = locations.length > 0 ? locations.find(l => l.name === storeFilter) : null
  const lockedMonths = new Set(
    currentStore ? monthLocks.filter(r => r.store_id === currentStore.id).map(r => r.month) : []
  )
  const lockedDates = new Set((activeDates || []).filter(d => lockedMonths.has(d.slice(0, 7))))
  // 當前畫面（cycle 可能跨月）碰到的月份，給狀態列「逐月鎖定/解鎖」用
  const viewMonths = [...new Set((activeDates || []).map(d => d.slice(0, 7)))].sort()
  const isAdmin = ['admin', 'super_admin'].includes(authRole)

  const reloadMonthLocks = async () => {
    if (!currentStore) return
    const { data } = await supabase.from('schedule_month_locks').select('*').eq('store_id', currentStore.id)
    setMonthLocks(data || [])
  }

  // 鎖定整月（凍結該月班表，薪資才能結算）
  const handleLockMonth = async (month) => {
    if (!currentStore) return
    if (!(await confirm({ message: `確定鎖定「${currentStore.name}」${month} 的班表？\n\n鎖定後該月班表不能再改，薪資才能結算（薪資結算前一定要先鎖）。` }))) return
    const { error } = await supabase.rpc('lock_schedule_month', { p_store_id: currentStore.id, p_month: month })
    if (error) { toast.error('鎖定失敗：' + error.message); return }
    await reloadMonthLocks()
    toast.success(`已鎖定 ${month} 班表`)
  }

  // 解鎖整月（admin / super_admin only）
  const handleUnlockMonth = async (month) => {
    if (!isAdmin || !currentStore) return
    if (!(await confirm({ message: `確定解鎖「${currentStore.name}」${month}？\n\n解鎖後該月可再編輯。注意：薪資結算前請再鎖回。` }))) return
    const { error } = await supabase.rpc('unlock_schedule_month', { p_store_id: currentStore.id, p_month: month })
    if (error) { toast.error('解鎖失敗：' + error.message); return }
    await reloadMonthLocks()
    toast.success(`已解鎖 ${month}`)
  }

  // Run compliance check when schedules update（debounce 250ms：連續填格時只在停下後驗一次，
  // 避免每填一格就跑 5 個全量勞基法驗證造成卡頓）
  useEffect(() => {
    if (schedules.length === 0) return
    const timer = setTimeout(() => {
      const baseResult = validateSchedule(schedules, weekDates, shiftDefs)
      // 加 cycle-aware 例休 quota 檢查（依當前店設定的工時制）
      const quotaResult = validateLeisureQuota({
        schedules,
        workHourSystem: storeSettings?.work_hour_system,
        anchorDate: storeSettings?.variable_period_start,
        startDate: activeStart,
        endDate: activeEnd,
        shiftDefs,
      })
      const otResult = validateMonthlyOvertime({ schedules, shiftDefs })
      const nightResult = validateNightShiftProtection({ schedules, employees, shiftDefs })
      const holidayResult = validateHolidayWork({ schedules, holidaySet: new Set(holidays) })
      setCompliance({
        errors: [...baseResult.errors, ...quotaResult.errors, ...otResult.errors, ...nightResult.errors, ...holidayResult.errors],
        warnings: [...baseResult.warnings, ...quotaResult.warnings, ...otResult.warnings, ...nightResult.warnings, ...holidayResult.warnings],
        isValid: baseResult.errors.length + quotaResult.errors.length + otResult.errors.length + nightResult.errors.length + holidayResult.errors.length === 0,
      })
    }, 250)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, weekStart, storeSettings, activeStart, activeEnd, employees, holidays, shiftDefs])

  // 套用班別到當前 selection 範圍
  const applyToSelection = async (shift, actualStart = null, actualEnd = null) => {
    if (!selection) return
    const vStart = activeDates?.[0]
    const vEnd = activeDates?.[activeDates.length - 1]
    const filteredEmps = employees.filter(em =>
      em.employment_category !== 'admin' && em.employment_category !== 'piece' &&
      (deptFilter === '' || em.dept === deptFilter) &&
      (storeFilter === '' || em.store === storeFilter) &&
      (!em.join_date   || !vEnd   || em.join_date   <= vEnd) &&
      (!em.resign_date || !vStart || em.resign_date >= vStart)
    )
    const aIdx = filteredEmps.findIndex(em => em.name === selection.anchor.empName)
    const eIdx = filteredEmps.findIndex(em => em.name === selection.end.empName)
    const aDIdx = activeDates.findIndex(d => d === selection.anchor.date)
    const eDIdx = activeDates.findIndex(d => d === selection.end.date)
    const eMin = Math.min(aIdx, eIdx), eMax = Math.max(aIdx, eIdx)
    const dMin = Math.min(aDIdx, eDIdx), dMax = Math.max(aDIdx, eDIdx)
    const targets = []
    for (let i = eMin; i <= eMax; i++) {
      for (let j = dMin; j <= dMax; j++) {
        targets.push({ empName: filteredEmps[i].name, date: activeDates[j] })
      }
    }
    // 一次處理多格，showpr 確認
    if (targets.length > 5) {
      const ok = await confirm({ message: `套用「${shift}」到 ${targets.length} 格？` })
      if (!ok) return
    }
    for (const t of targets) {
      const emp = filteredEmps.find(em => em.name === t.empName)
      await handleSetShift(t.empName, t.date, shift, actualStart, actualEnd, emp?.store || null)
    }
  }

  // 鍵盤導航：方向鍵移動 focused cell + Space/Enter 開 modal
  useEffect(() => {
    if (!canEditSchedule) return
    const handler = (e) => {
      // 編輯 modal 開啟時不接管（modal 內自己處理）
      if (editCell) return
      // 在 input/select/textarea 內不接管
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return

      const vStart = activeDates?.[0]
      const vEnd = activeDates?.[activeDates.length - 1]
      const filteredEmps = employees.filter(em =>
        em.employment_category !== 'admin' && em.employment_category !== 'piece' &&
        (deptFilter === '' || em.dept === deptFilter) &&
        (storeFilter === '' || em.store === storeFilter) &&
        (!em.join_date   || !vEnd   || em.join_date   <= vEnd) &&
        (!em.resign_date || !vStart || em.resign_date >= vStart)
      )
      const dates = activeDates
      if (filteredEmps.length === 0 || dates.length === 0) return

      // 有 selection 時：R/S/B/M 套到整個範圍，Del 刪除整個範圍
      if (selection) {
        const k = e.key.toLowerCase()
        if (k === 'e') { e.preventDefault(); applyToSelection('例假'); return }
        if (k === 'r') { e.preventDefault(); applyToSelection('休息'); return }
        if (k === 's') { e.preventDefault(); applyToSelection('特休'); return }
        if (k === 'b') { e.preventDefault(); applyToSelection('病'); return }
        if (k === 'm') { e.preventDefault(); applyToSelection('會議'); return }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          // 砍 selection 範圍內所有 cell
          ;(async () => {
            const aIdx = filteredEmps.findIndex(em => em.name === selection.anchor.empName)
            const eIdx = filteredEmps.findIndex(em => em.name === selection.end.empName)
            const aDIdx = dates.findIndex(d => d === selection.anchor.date)
            const eDIdx = dates.findIndex(d => d === selection.end.date)
            const eMin = Math.min(aIdx, eIdx), eMax = Math.max(aIdx, eIdx)
            const dMin = Math.min(aDIdx, eDIdx), dMax = Math.max(aDIdx, eDIdx)
            for (let i = eMin; i <= eMax; i++) {
              for (let j = dMin; j <= dMax; j++) {
                await handleDeleteShift(filteredEmps[i].name, dates[j])
              }
            }
          })()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setSelection(null)
          return
        }
      }

      // 沒 focus 時，方向鍵設第一格
      if (!focusedCell) {
        if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
          e.preventDefault()
          setFocusedCell({ empName: filteredEmps[0].name, date: dates[0] })
        }
        return
      }

      const eIdx = filteredEmps.findIndex(em => em.name === focusedCell.empName)
      const dIdx = dates.findIndex(d => d === focusedCell.date)
      if (eIdx < 0 || dIdx < 0) {
        // focus 失效，重設
        setFocusedCell({ empName: filteredEmps[0].name, date: dates[0] })
        return
      }

      let ne = eIdx, nd = dIdx
      switch (e.key) {
        case 'ArrowUp':    ne = Math.max(0, eIdx - 1); break
        case 'ArrowDown':  ne = Math.min(filteredEmps.length - 1, eIdx + 1); break
        case 'ArrowLeft':  nd = Math.max(0, dIdx - 1); break
        case 'ArrowRight': nd = Math.min(dates.length - 1, dIdx + 1); break
        case 'Home':       nd = 0; break
        case 'End':        nd = dates.length - 1; break
        case ' ':
        case 'Enter':
          e.preventDefault()
          setEditCell({ empName: focusedCell.empName, date: focusedCell.date })
          return
        case 'Escape':
          e.preventDefault()
          setFocusedCell(null)
          return
        default:
          return
      }
      e.preventDefault()
      setFocusedCell({ empName: filteredEmps[ne].name, date: dates[nd] })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedCell, editCell, canEditSchedule, employees, deptFilter, storeFilter, activeDates, selection])

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

  const handleSetShift = async (empName, date, shift, actualStart, actualEnd, sourceStore) => {
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

    // source_store：跨店支援。沒指定就用員工主店；指定就用指定的
    const emp = employees.find(e => e.name === empName)
    const effectiveSource = sourceStore || emp?.store || null

    const record = {
      shift,
      actual_start: actualStart || null,
      actual_end: actualEnd || null,
      source_store: effectiveSource,
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

  // empName → Set<dateStr>，供 MonthScheduleTable 標橘點
  const pendingLeaveMap = (() => {
    const map = {}
    for (const lr of pendingLeaves) {
      if (!lr.employee || !lr.start_date || !lr.end_date) continue
      if (!map[lr.employee]) map[lr.employee] = new Set()
      let d = new Date(lr.start_date + 'T00:00:00Z')
      const end = new Date(lr.end_date + 'T00:00:00Z')
      while (d <= end) {
        map[lr.employee].add(d.toISOString().slice(0, 10))
        d.setUTCDate(d.getUTCDate() + 1)
      }
    }
    return map
  })()

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
    const { data } = await supabase.from('schedules').upsert({ employee: coverEmpName, date, shift, organization_id: authProfile?.organization_id }, { onConflict: 'employee,date' }).select().single()
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
      organization_id: authProfile?.organization_id,
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
        storeFilter, locations, minStaff, minStaffWeekend, organization_id: authProfile?.organization_id,
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
      organization_id: authProfile?.organization_id,
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

  // ── Wizard complete handler ──
  const handleWizardComplete = ({ mode, stores, period, storeRanges, empRestMap }) => {
    setShowWizard(false)
    if (!stores?.length || !period) return
    const primary = stores[0]
    const primaryRange = storeRanges?.[primary.storeId] || period
    if (mode === 'manual') {
      navigate('/hr/schedule-builder', {
        state: {
          store: primary.store,
          storeId: primary.storeId,
          month: primaryRange.start.slice(0, 7),
          range: { start: primaryRange.start, end: primaryRange.end },
          workHourSystem: primary.workHourSystem,
          restDayMap: {},
          empRestMap: empRestMap || {},
        },
      })
    } else {
      // Set skip flag so the [selectedMonth, storeFilter] effect doesn't reset the probe date
      skipCycleReset.current = true
      setStoreFilter(primary.store)
      setSelectedMonth(primaryRange.start.slice(0, 7))
      // Switch to cycle view so the full cross-month period (e.g. 4-week Jun 26~Jul 23) is built
      setViewMode('cycle')
      setCycleProbeDate(primaryRange.start)
      // 自動建立：記住目標門市 id（cycle 週期要用「該門市」設定算），標記 pending
      pendingAutoStoreIdRef.current = primary.storeId
      setPendingAutoCode(true)
      toast.success(`門市「${primary.store}」已設定，開始自動排班…`)
    }
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
  const handleCodeSchedule = async (opts = {}) => {
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
    if (!opts.skipConfirm && !(await confirm({ message: `將使用程式演算法為 ${filtered.length} 位員工自動排班（${rangeLabel}）\n\n不使用 AI，純邏輯計算。產出為草稿，您可以審閱後再發布。` }))) return
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
        storeFilter, locations, minStaff, minStaffWeekend, organization_id: authProfile?.organization_id,
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

  // 自動建立精靈完成 → 等 cycle/門市就緒「且 schedules 已 reload（含剛寫入的休假）」才自動跑排班代碼，
  // 免使用者再回主畫面按一次。等 reload 是因為演算法會從 schedules 讀已點的休假併入，搶在 reload 前會漏假。
  useEffect(() => {
    if (!pendingAutoCode) return
    if (!(viewMode === 'cycle' && storeFilter && cycleDates && cycleInfo)) return
    // cycle 週期是用門市設定(storeSettings)算的 → 必須等「目標門市」設定載入完，否則會用上一個門市的
    // 工時制度算出錯誤週期（例：4 週變形被算成 5 週、範圍錯位 → 一堆假性違規）。
    if (storeSettings?.store_id !== pendingAutoStoreIdRef.current) return
    if (scheduleLoading) { autoCodeSawLoadingRef.current = true; return }  // schedules reload 進行中 → 等
    if (!autoCodeSawLoadingRef.current) return  // setCycleProbeDate 觸發的 reload 尚未開始 → 再等一拍
    autoCodeSawLoadingRef.current = false
    setPendingAutoCode(false)
    handleCodeSchedule({ skipConfirm: true })
  }, [pendingAutoCode, viewMode, storeFilter, cycleDates, cycleInfo, scheduleLoading, storeSettings]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // 視窗範圍：看 4 月就用 4/1 ~ 4/30；看 cycle 用 cycle 起迄
  // 用來過濾「跟 view 完全沒重疊」的員工（從沒入職過、或整段都已離職）
  const viewStart = activeDates?.[0] || monthStart
  const viewEnd = activeDates?.[activeDates.length - 1] || monthEnd
  const filtered = employees.filter(e =>
    e.employment_category !== 'admin' && e.employment_category !== 'piece' &&  // 行政(固定9-6)+計件(按件數)不排班 → 排除;督導請改成「正職」才會出現
    (deptFilter === '' || e.dept === deptFilter) &&
    (storeFilter === '' || e.store === storeFilter) &&
    (!e.join_date   || e.join_date   <= viewEnd) &&   // 4/30 之後入職 → 4 月不顯示
    (!e.resign_date || e.resign_date >= viewStart)    // 4/1 前就已離職 → 4 月不顯示
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
              {/* 發布狀態（cycle） */}
              {storeFilter && (
                <span style={{
                  padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: publishStatus?.status === 'published' ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.12)',
                  color: publishStatus?.status === 'published' ? '#10b981' : '#f59e0b',
                }}>
                  {publishStatus?.status === 'published' ? `✓ 已發布 ${publishStatus.published_at?.slice(0, 10) || ''}` : '未發布'}
                </span>
              )}
              {/* 鎖定狀態（月級，對齊薪資）— 當前畫面碰到的每個月各自鎖定/解鎖 */}
              {storeFilter && currentStore && viewMonths.map(m => {
                const locked = lockedMonths.has(m)
                return (
                  <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{
                      padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                      background: locked ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                      color: locked ? 'var(--accent-green)' : 'var(--accent-orange)',
                      border: `1px solid ${locked ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)'}`,
                    }} title={locked ? `${m} 班表已鎖定，薪資可結算` : `${m} 尚未鎖定`}>
                      {locked ? `🔒 ${m} 已鎖定` : `🔓 ${m} 未鎖定`}
                    </span>
                    {!locked && canEditSchedule && (
                      <button onClick={() => handleLockMonth(m)} style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: 'var(--accent-green-dim)', color: 'var(--accent-green)',
                        border: '1px solid var(--accent-green)', cursor: 'pointer',
                      }} title={`鎖定 ${m} 班表（鎖定後該月薪資才能結算）`}>鎖定</button>
                    )}
                    {locked && isAdmin && (
                      <button onClick={() => handleUnlockMonth(m)} style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: 'rgba(245,158,11,0.12)', color: 'var(--accent-orange)',
                        border: '1px solid var(--accent-orange)', cursor: 'pointer',
                      }} title="解鎖（admin 才看得到）">解鎖</button>
                    )}
                  </span>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={async () => {
              // 複製上個週期 — 一律走 cycle 邏輯（需要店家有設變形工時 anchor）
              const ws = storeSettings?.work_hour_system
              const anchor = storeSettings?.variable_period_start
              if (!ws || ws === '標準工時' || !anchor) {
                toast.error('門市沒設定變形工時起算日，無法用週期複製。請到「門市設定」設好再來。')
                return
              }
              // 探測：用目前 cycle（cycle view）或當月初（month view）→ 抓對應 cycle
              const probeAnchor = (useCycleView && cycleInfo) ? cycleInfo.start : monthStart
              const curCycle = getCycleFor(probeAnchor, ws, anchor)
              if (!curCycle) { toast.error('找不到目前週期'); return }
              const prevProbe = new Date(new Date(curCycle.start + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10)
              const prevCycle = getCycleFor(prevProbe, ws, anchor)
              if (!prevCycle) { toast.error('找不到上個週期'); return }
              const srcStart = prevCycle.start
              const srcEnd = prevCycle.end
              const targetDates = []
              {
                const s = new Date(curCycle.start + 'T00:00:00Z')
                const e = new Date(curCycle.end + 'T00:00:00Z')
                for (let d = s; d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
                  targetDates.push(d.toISOString().slice(0, 10))
                }
              }
              const targetLabel = `Cycle #${curCycle.index} (${curCycle.start} ~ ${curCycle.end})`
              const empNames = filtered.map(e => e.name)
              const { data: lastSchedules } = await supabase.from('schedules').select('*')
                .in('employee', empNames)
                .gte('date', srcStart).lte('date', srcEnd)
              if (!lastSchedules?.length) { toast.error('上個週期無排班資料'); return }
              if (!(await confirm({ message: `將上個週期 ${lastSchedules.length} 筆排班複製到 ${targetLabel}？\n\n會根據星期幾對應，已有的排班會被覆蓋。` }))) return
              const byEmpDow = {}
              for (const s of lastSchedules) {
                const dow = new Date(s.date).getDay()
                const key = `${s.employee}_${dow}`
                if (!byEmpDow[key]) byEmpDow[key] = s
              }
              const newSchedules = []
              for (const date of targetDates) {
                const dow = new Date(date).getDay()
                for (const emp of empNames) {
                  const src = byEmpDow[`${emp}_${dow}`]
                  if (src) newSchedules.push({ employee: emp, date, shift: src.shift, actual_start: src.actual_start, actual_end: src.actual_end, organization_id: authProfile?.organization_id })
                }
              }
              if (newSchedules.length > 0) {
                const { data } = await supabase.from('schedules').upsert(newSchedules, { onConflict: 'employee,date' }).select()
                if (data) setSchedules(prev => { const map = {}; for (const s of [...prev, ...data]) map[`${s.employee}_${s.date}`] = s; return Object.values(map) })
                toast.success(`已複製 ${newSchedules.length} 筆排班到 ${targetLabel}`)
              }
            }}>
              📋 複製上個週期
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
            {/* 排班檢查按鈕：依 compliance state 顯示狀態 */}
            <button
              className="btn btn-secondary"
              style={{
                width: 'auto', padding: '8px 16px',
                background: compliance.errors.length > 0
                  ? 'rgba(239,68,68,0.12)'
                  : compliance.warnings.length > 0
                    ? 'rgba(245,158,11,0.12)'
                    : 'rgba(16,185,129,0.10)',
                color: compliance.errors.length > 0
                  ? 'var(--accent-red)'
                  : compliance.warnings.length > 0
                    ? 'var(--accent-orange)'
                    : 'var(--accent-green)',
                border: '1px solid currentColor',
                fontWeight: 600,
              }}
              onClick={() => setShowComplianceModal(true)}
              title="點開看排班違規與提醒"
            >
              {compliance.errors.length > 0
                ? `❌ 排班檢查（${compliance.errors.length} 違規）`
                : compliance.warnings.length > 0
                  ? `⚠️ 排班檢查（${compliance.warnings.length} 提醒）`
                  : '✓ 排班檢查'}
            </button>
            {/* ✏ 繼續編輯排班 — 當選了店且該店該 cycle 有資料時，直接進 builder 跳過 wizard */}
            {canEditSchedule && storeFilter && currentStore && schedules.length > 0 && viewMonths.some(m => !lockedMonths.has(m)) && (
              <button
                className="btn btn-secondary"
                style={{
                  width: 'auto', padding: '8px 14px',
                  background: 'rgba(34,211,238,0.10)',
                  color: 'var(--accent-cyan)',
                  border: '1px solid var(--accent-cyan)',
                  fontWeight: 600,
                }}
                onClick={() => {
                  // 找實際有 shift 資料的最後一筆日期，用那筆算 cycle
                  // 不要用 activeStart（月視圖時是月初，可能算到「上一個 cycle」沒資料）
                  const ws = storeSettings?.work_hour_system
                  const anchor = storeSettings?.variable_period_start
                  let probeDate = activeStart  // fallback
                  const withShift = schedules.filter(s => s.shift)
                  if (withShift.length > 0) {
                    probeDate = withShift.reduce((max, s) => s.date > max ? s.date : max, withShift[0].date)
                  }
                  let builderStart = activeStart
                  let builderEnd = activeEnd
                  if (ws && ws !== '標準工時' && anchor) {
                    const cycle = getCycleFor(probeDate, ws, anchor)
                    builderStart = cycle.start
                    builderEnd = cycle.end
                  }
                  navigate('/hr/schedule-builder', {
                    state: {
                      store: storeFilter,
                      storeId: currentStore.id,
                      month: builderStart?.slice(0, 7),
                      range: { start: builderStart, end: builderEnd },
                      workHourSystem: ws || '標準工時',
                      restDayMap: {},
                      empRestMap: {},
                    },
                  })
                }}
                title="直接進手填頁編輯此 cycle（跳過排班精靈）"
              >
                ✏ 繼續編輯
              </button>
            )}
            {/* 排班精靈 split-button */}
            {canEditSchedule && (
              <div ref={wizardDropdownRef} style={{ position: 'relative', display: 'inline-flex' }}>
                <button
                  className="btn btn-primary"
                  style={{
                    width: 'auto', padding: '8px 14px', borderRadius: 8,
                    background: 'linear-gradient(135deg, var(--accent-purple), #7c3aed)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                  onClick={() => setShowWizardDropdown(v => !v)}
                >
                  <Wand2 size={14} /> 排班精靈
                  <ChevronDown size={14} style={{ marginLeft: 2, opacity: 0.85, transform: showWizardDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>
                {showWizardDropdown && (
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, zIndex: 500, marginTop: 4,
                    background: 'var(--bg-card)', border: '1px solid var(--border-strong)',
                    borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', minWidth: 150, overflow: 'hidden',
                  }} onClick={() => setShowWizardDropdown(false)}>
                    <button onClick={() => { setWizardMode('manual'); setShowWizard(true) }} style={{
                      width: '100%', padding: '11px 16px', border: 'none', cursor: 'pointer', textAlign: 'left',
                      background: 'transparent', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      📋 手動建立
                    </button>
                    <button onClick={() => { setWizardMode('auto'); setShowWizard(true) }} style={{
                      width: '100%', padding: '11px 16px', border: 'none', cursor: 'pointer', textAlign: 'left',
                      background: 'transparent', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                      display: 'flex', alignItems: 'center', gap: 8,
                      borderTop: '1px solid var(--border-light)',
                    }}>
                      ✨ 自動建立
                    </button>
                  </div>
                )}
              </div>
            )}
            {aiDraft && (
              <>
                <button className="btn btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={handlePublishDraft}>
                  <Save size={14} /> 發布
                </button>
                <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={handleDiscardDraft}>
                  捨棄草稿
                </button>
              </>
            )}
          </div>
        </div>
        {isSuperAdmin && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
              平日
              <input type="number" className="form-input" style={{ width: 42, padding: '4px 6px', fontSize: 12, textAlign: 'center' }}
                value={minStaff} onChange={e => setMinStaff(Math.max(1, Math.min(Number(e.target.value) || 1, 99)))} min={1} max={99} />
              假日
              <input type="number" className="form-input" style={{ width: 42, padding: '4px 6px', fontSize: 12, textAlign: 'center' }}
                value={minStaffWeekend} onChange={e => setMinStaffWeekend(Math.max(1, Math.min(Number(e.target.value) || 1, 99)))} min={1} max={99} />
              人/天
            </div>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setShowLawModal(true)}>
              <Shield size={14} /> 排班條件
            </button>
            <button className="btn btn-primary" style={{ width: 'auto', padding: '8px 16px', background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue, #3b82f6))' }}
              onClick={handleCodeSchedule} disabled={autoScheduling}>
              <Code size={14} /> {autoScheduling && aiProgress.includes('程式') ? aiProgress : '排班代碼'}
            </button>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={async () => {
              const empNames = filtered.map(e => e.name)
              if (!(await confirm({ message: `確定要清除 ${selectedMonth} ${storeFilter || '所有門市'} 共 ${empNames.length} 人的排班嗎？` }))) return
              await supabase.from('schedules').delete().in('employee', empNames).gte('date', monthStart).lte('date', monthEnd)
              setSchedules(prev => prev.filter(s => !empNames.includes(s.employee) || s.date < monthStart || s.date > monthEnd))
            }}>
              🗑️ 清除本月
            </button>
            <button className="btn btn-primary" style={{ width: 'auto', padding: '8px 16px', background: 'linear-gradient(135deg, var(--accent-red), var(--accent-orange))' }}
              onClick={handleAutoSchedule} disabled={autoScheduling}>
              <Sparkles size={14} /> {autoScheduling && !aiProgress.includes('程式') ? (aiProgress || 'AI 排班中...') : 'AI 自動排班'}
            </button>
          </div>
        )}
        {isSuperAdmin && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>部門</span>
            <select className="form-input" style={{ width: 160, padding: '4px 8px', fontSize: 13 }}
              value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
              <option value="">全部部門</option>
              {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              篩選結果：{filtered.length} 人
            </span>
          </div>
        )}
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
        {/* 框選提示條：fixed 飄右下角，不參與 flex 佈局避免班表往下跳 */}
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
        <div style={{ position: 'relative' }}>
          {scheduleLoading && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 10,
              background: 'rgba(0,0,0,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 8,
            }}>
              <LoadingSpinner />
            </div>
          )}
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
          focusedCell={focusedCell}
          setFocusedCell={setFocusedCell}
          selection={selection}
          setSelection={setSelection}
          selecting={selecting}
          setSelecting={setSelecting}
          handleSetShift={handleSetShift}
          handleDeleteShift={handleDeleteShift}
          canEditSchedule={canEditSchedule}
          getStoreShifts={getStoreShifts}
          storeFilter={storeFilter}
          holidaySet={holidaySet}
          storeSettings={storeSettings}
          pendingLeaveMap={pendingLeaveMap}
          violationsByEmp={(() => {
            const map = {}
            for (const e of (compliance.errors || [])) {
              if (!map[e.employee]) map[e.employee] = { errors: 0, warnings: 0 }
              map[e.employee].errors++
            }
            for (const w of (compliance.warnings || [])) {
              if (!map[w.employee]) map[w.employee] = { errors: 0, warnings: 0 }
              map[w.employee].warnings++
            }
            return map
          })()}
          onClickEmployeeBadge={(empName) => { setComplianceFilterEmp(empName || null); setShowComplianceModal(true) }}
          lockedDates={lockedDates}
        />
        </div>
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

      {/* 排班檢查結果 modal — 顯示 errors + warnings，按員工分組 */}
      {showComplianceModal && (() => {
        const closeModal = () => { setShowComplianceModal(false); setComplianceFilterEmp(null) }
        // 按員工分組（先 filter 員工，如果 badge 點進來只看單一員工）
        const errsScope = complianceFilterEmp
          ? compliance.errors.filter(e => e.employee === complianceFilterEmp)
          : compliance.errors
        const warnsScope = complianceFilterEmp
          ? compliance.warnings.filter(w => w.employee === complianceFilterEmp)
          : compliance.warnings
        const groupedErrors = {}
        const groupedWarnings = {}
        for (const e of errsScope) {
          if (!groupedErrors[e.employee]) groupedErrors[e.employee] = []
          groupedErrors[e.employee].push(e)
        }
        for (const w of warnsScope) {
          if (!groupedWarnings[w.employee]) groupedWarnings[w.employee] = []
          groupedWarnings[w.employee].push(w)
        }
        const allEmployees = [...new Set([...Object.keys(groupedErrors), ...Object.keys(groupedWarnings)])].sort()

        return (
          <div onClick={closeModal} style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 20px',
            overflowY: 'auto',
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: 'var(--bg-secondary)', borderRadius: 14,
              border: '1px solid var(--border-medium)', boxShadow: 'var(--shadow-xl)',
              width: '100%', maxWidth: 720, maxHeight: '90vh',
              display: 'flex', flexDirection: 'column',
            }}>
              {/* Header */}
              <div style={{
                padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
              }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  {complianceFilterEmp
                    ? `👤 ${complianceFilterEmp} 的排班問題 — ${selectedMonth}`
                    : `📋 排班檢查結果 — ${selectedMonth}`}
                </h3>
                <div style={{ display: 'flex', gap: 6 }}>
                  {complianceFilterEmp && (
                    <button onClick={() => setComplianceFilterEmp(null)} className="btn btn-secondary" style={{ padding: '4px 10px' }}>
                      看全部
                    </button>
                  )}
                  <button onClick={closeModal} className="btn btn-secondary" style={{ padding: '4px 10px' }}>
                    關閉
                  </button>
                </div>
              </div>

              {/* Summary stats */}
              <div style={{ padding: '12px 20px', display: 'flex', gap: 16, fontSize: 13, borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>
                  ❌ {errsScope.length} 違規
                </span>
                <span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>
                  ⚠️ {warnsScope.length} 提醒
                </span>
                {errsScope.length === 0 && warnsScope.length === 0 && (
                  <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>
                    ✓ {complianceFilterEmp ? '此員工合規' : '全部合規'}
                  </span>
                )}
              </div>

              {/* Body */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {allEmployees.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    🎉 本月排班全部合規，沒有問題
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {allEmployees.map(empName => {
                      const errs = groupedErrors[empName] || []
                      const warns = groupedWarnings[empName] || []
                      return (
                        <div key={empName} style={{
                          background: 'var(--bg-card)', borderRadius: 8,
                          padding: 12, border: '1px solid var(--border-subtle)',
                        }}>
                          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: 'var(--text-primary)' }}>
                            👤 {empName}
                          </div>
                          {errs.map((e, i) => (
                            <div key={`e${i}`} style={{
                              fontSize: 13, padding: '5px 8px', marginBottom: 4,
                              background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid var(--accent-red)',
                              color: 'var(--text-secondary)',
                            }}>
                              <strong style={{ color: 'var(--accent-red)' }}>❌ </strong>
                              {e.message}
                            </div>
                          ))}
                          {warns.map((w, i) => (
                            <div key={`w${i}`} style={{
                              fontSize: 13, padding: '5px 8px', marginBottom: 4,
                              background: 'rgba(245,158,11,0.08)', borderLeft: '3px solid var(--accent-orange)',
                              color: 'var(--text-secondary)',
                            }}>
                              <strong style={{ color: 'var(--accent-orange)' }}>⚠️ </strong>
                              {w.message}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Footer hint */}
              <div style={{
                padding: '10px 20px', borderTop: '1px solid var(--border-subtle)',
                fontSize: 11, color: 'var(--text-muted)', textAlign: 'center',
              }}>
                💡 編輯排班後此檢查自動更新；{complianceFilterEmp ? '點「看全部」回所有員工' : '點員工名旁邊紅/橘 badge 只看那個人的問題'}
              </div>
            </div>
          </div>
        )
      })()}
      <ScheduleImportModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        employees={employees}
        stores={locations}
        orgId={authProfile?.organization_id}
        onImported={async () => {
          const { data } = await supabase.from('schedules').select('*')
            .gte('date', activeStart).lte('date', activeEnd)
          if (data) setSchedules(data)
        }}
      />
      <EmployeeSchedulePatternsModal
        open={showPatternsModal}
        onClose={() => setShowPatternsModal(false)}
        employees={employees}
        stores={locations}
        orgId={authProfile?.organization_id}
        currentMonth={selectedMonth}
        onApplied={async () => {
          const { data } = await supabase.from('schedules').select('*')
            .gte('date', activeStart).lte('date', activeEnd)
          if (data) setSchedules(data)
        }}
      />

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

      {/* 框選提示條：fixed 飄右下角，不參與 flex 佈局避免班表往下跳 */}
      {/* 排班精靈 wizard */}
      <CreateScheduleWizard
        open={showWizard}
        mode={wizardMode}
        locations={(() => {
          if (canEditSchedule) return locations
          if (isSupervisor) return locations.filter(l => myStoreIds.includes(l.id))
          if (isStoreMgr) return locations.filter(l => l.id === authProfile?.store_id)
          return []
        })()}
        onClose={() => setShowWizard(false)}
        onComplete={handleWizardComplete}
      />

      {/* Close wizard dropdown on outside click */}
      {showWizardDropdown && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 499 }} onClick={() => setShowWizardDropdown(false)} />
      )}

      {selection && (() => {
        const vStart = activeDates?.[0]
        const vEnd = activeDates?.[activeDates.length - 1]
        const fEmps = employees.filter(em =>
          (deptFilter === '' || em.dept === deptFilter) &&
          (storeFilter === '' || em.store === storeFilter) &&
          (!em.join_date   || !vEnd   || em.join_date   <= vEnd) &&
          (!em.resign_date || !vStart || em.resign_date >= vStart)
        )
        const aIdx = fEmps.findIndex(em => em.name === selection.anchor.empName)
        const eIdx = fEmps.findIndex(em => em.name === selection.end.empName)
        const aDIdx = activeDates.findIndex(d => d === selection.anchor.date)
        const eDIdx = activeDates.findIndex(d => d === selection.end.date)
        const cnt = (aIdx < 0 || eIdx < 0 || aDIdx < 0 || eDIdx < 0)
          ? 0
          : (Math.abs(aIdx - eIdx) + 1) * (Math.abs(aDIdx - eDIdx) + 1)
        return (
          <div style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 9000,
            padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'var(--bg-secondary)', color: 'var(--accent-cyan)',
            border: '1px solid var(--accent-cyan)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            🔵 已選 {cnt} 格 — E=例 R=休 S=特休 B=病 M=會議 Del=清除 Esc=取消
            <button onClick={() => setSelection(null)} style={{
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-cyan)', padding: 0, fontSize: 16,
            }}>×</button>
          </div>
        )
      })()}
    </div>
  )
}

