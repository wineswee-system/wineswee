import { useState, useEffect, useMemo, useCallback } from 'react'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'
import { useNavigate } from 'react-router-dom'
import { Search, Download, MapPin, Clock, CalendarCheck } from 'lucide-react'
import { getAttendance, serverClockIn, getDepartments, getStores } from '../../lib/db'
import { exportAttendancePdf } from '../../lib/exportPdf'
import { validateClockIn } from '../../lib/clockInValidator'
import { getRestMinutes } from '../../lib/scheduleUtils'
import { toast } from '../../lib/toast'

// 由上下班時間算「淨工時」（扣休息：<5h=0、5~9h=30分、≥9h=60分；跨午夜 +24h）
function computeNet(inStr, outStr, isAdmin = false) {
  if (!inStr || !outStr) return null
  const [ih, im] = inStr.split(':').map(Number)
  const [oh, om] = outStr.split(':').map(Number)
  let mins = (oh * 60 + om) - (ih * 60 + im)
  if (mins < 0) mins += 24 * 60
  const gross = mins / 60
  const rest = isAdmin ? 60 : getRestMinutes(gross)   // 行政午休固定 60 分
  const net = gross - rest / 60
  return net > 0 ? Math.round(net * 100) / 100 : 0
}
import { todayTW, monthStartTW, nowTimeTW } from '../../lib/datetime'

// 加班歸日:凌晨(6點換日線前)開始的加班算「前一天」的加班(跟打卡/補打卡 6 點換日同規則)。
//   例:加班日期 8/3、00:00~01:00(跨午夜尾段)→ 歸 8/2,打卡追蹤才掛在 8/2 那天。
const shiftDateStr = (dstr, days) => {
  const [y, m, d] = String(dstr).split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  const p = n => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}
// boundary = 換日線時間字串(如 '06:00:00'),讀 org 的 day_boundary_hour 欄位帶進來
const otAttributedDate = (o, boundary) =>
  (o.start_time && String(o.start_time) < boundary) ? shiftDateStr(o.date, -1) : o.date
import { useAuth } from '../../contexts/AuthContext'
import { useErrorHandler } from '../../hooks/useErrorHandler'
import LoadingSpinner from '../../components/LoadingSpinner'
import DateRangeField from '../../components/DateRangeField'
import { supabase } from '../../lib/supabase'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'

// 模式 tag — 對應 Edge Function 的 clock_in_mode / clock_out_mode（2026-05-28 簡化 5 → 2）
//   normal 不顯示、outing 顯示「外出」
//   舊資料 overtime/leave/shift_swap 已 backfill 為 normal；映射保留為防快取舊 row
const MODE_TAG = {
  outing:     { label: '外出', color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)' },
  overtime:   { label: '加班', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  leave:      { label: '請假', color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)' },
  shift_swap: { label: '換班', color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)' },
}
function ClockModeTags({ inMode, outMode }) {
  const tagStyle = (m) => ({
    padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
    background: MODE_TAG[m].dim, color: MODE_TAG[m].color, whiteSpace: 'nowrap',
  })
  const showIn  = inMode  && inMode  !== 'normal' && MODE_TAG[inMode]
  const showOut = outMode && outMode !== 'normal' && MODE_TAG[outMode]
  if (!showIn && !showOut) return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
  if (showIn && showOut && inMode === outMode) {
    return <span style={tagStyle(inMode)}>{MODE_TAG[inMode].label}</span>
  }
  return (
    <span style={{ display: 'inline-flex', gap: 3, flexWrap: 'wrap' }}>
      {showIn  && <span style={tagStyle(inMode)}>上{MODE_TAG[inMode].label}</span>}
      {showOut && <span style={tagStyle(outMode)}>下{MODE_TAG[outMode].label}</span>}
    </span>
  )
}

export default function Attendance() {
  const { profile, isStoreStaff, isManager, hasPermission } = useAuth()
  const navigate = useNavigate()
  const { handleError } = useErrorHandler('hr')
  const isStaff = isStoreStaff
  const canEditClock = hasPermission('clock.correction_edit')

  const [records, setRecords] = useState([])
  const [overtimes, setOvertimes] = useState([])   // 已核准加班單 → 打卡追蹤獨立加班列
  const [daySchedules, setDaySchedules] = useState([])  // 當天班表對照
  const [dayLeaves, setDayLeaves] = useState([])        // 已核准請假對照
  const [salaryCats, setSalaryCats] = useState([])      // [{employee_id, employment_category}] 判斷行政/正職
  const [catWorkRules, setCatWorkRules] = useState([])  // employment_category_work_rules（行政固定辦公時間）
  const [clockCorrections, setClockCorrections] = useState([])  // 補打卡申請（顯示「有沒有申請補打卡」欄）
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [stores, setStores] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [visibleStoreIds, setVisibleStoreIds] = useState(null)  // 主管/督導可見門市 id(null=未載入/不限)
  // 日期區間篩選（預設：本月 1 號 ~ 今天）
  const [startDate, setStartDate] = useState(() => monthStartTW())
  const [endDate, setEndDate] = useState(() => todayTW())
  const [search, setSearch] = useState(isStaff ? (profile?.name || '') : '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [clockingIn, setClockingIn] = useState(false)
  const [clockMsg, setClockMsg] = useState(null)
  const [tab, setTab] = useState('records') // records | hours | comparison | failures
  const [page, setPage] = useState(1)       // 打卡紀錄分頁（每頁 100 筆）
  const [failures, setFailures] = useState([])   // 定位失敗記錄(clock_attempts)
  const [failLoading, setFailLoading] = useState(false)

  // 載入定位失敗記錄(切到「定位失敗」tab 才抓;RLS 已依組織過濾)
  useEffect(() => {
    if (tab !== 'failures') return
    let cancelled = false
    ;(async () => {
      setFailLoading(true)
      const { data } = await supabase.from('clock_attempts')
        .select('created_at, employee, store, action, reason, geo_code, perm_state, accuracy, distance_m, ip, client, detail')
        .gte('created_at', `${startDate}T00:00:00+08:00`).lte('created_at', `${endDate}T23:59:59+08:00`)
        .order('created_at', { ascending: false }).limit(500)
      if (!cancelled) { setFailures(data || []); setFailLoading(false) }
    })()
    return () => { cancelled = true }
  }, [tab, startDate, endDate])
  const PAGE_SIZE = 100
  const goToPage = (p) => {
    setPage(p)
    // 只捲 main-content 這個真正的捲動容器回頂端。
    // 不要用 el.scrollIntoView() — 它會連 document 一起捲，在 #root zoom≠1 時
    // (document 被撐得比視窗高、可捲) 會把整頁往上頂 → 頂部躲 topnav、底部露縫。
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const [editModal, setEditModal] = useState(null) // record being edited
  const [editClockIn, setEditClockIn] = useState('')
  const [editClockOut, setEditClockOut] = useState('')
  const [editDate, setEditDate] = useState('')      // 可改日期（跨日班把紀錄搬到正確那天）
  const [editHours, setEditHours] = useState('')   // 手動工時（空=用自動扣休息值）
  const [editReason, setEditReason] = useState('')
  const [editHistory, setEditHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // 補登打卡（可補離職者 / 任意日期）
  const [backfillOpen, setBackfillOpen] = useState(false)
  const [allEmps, setAllEmps] = useState([])   // 含離職,補登下拉用（懶載）
  const [bfEmpId, setBfEmpId] = useState('')
  const [bfDate, setBfDate] = useState('')
  const [bfIn, setBfIn] = useState('')
  const [bfOut, setBfOut] = useState('')
  const [bfReason, setBfReason] = useState('')
  const [bfSaving, setBfSaving] = useState(false)

  useEffect(() => {
    const orgId = profile?.organization_id ?? getTenantOrgId()
    setLoading(true)
    Promise.all([
      getAttendance(null, { orgId, from: startDate, to: endDate }),
      // 在職 + 「該區間內還在職過」的離職者(resign_date≥區間起日)→ 讓離職者也能補齊每日出勤列
      supabase.from('employees')
        .select('id, name, dept, store, department_id, position, store_id, status, join_date, resign_date, departments!department_id(name), stores!store_id(name)')
        .eq('organization_id', orgId)
        .or(`status.eq.在職,resign_date.gte.${startDate}`)
        .order('name'),
      getDepartments(orgId),
      getStores(orgId),
      supabase.from('overtime_requests')
        .select('id, employee, date, start_time, end_time, ot_hours, hours, ot_category, store, status, organization_id')
        .eq('organization_id', orgId).in('status', ['已核准', '待審核'])
        .is('deleted_at', null)
        .gte('date', startDate).lte('date', endDate),
      // 當天班表(顯示排定班別)
      supabase.from('schedules')
        .select('employee, employee_id, date, shift, actual_start, actual_end')
        .eq('organization_id', orgId)
        .gte('date', startDate).lte('date', endDate),
      // 請假(已核准 + 待審核;覆蓋區間的)
      supabase.from('leave_requests')
        .select('employee, employee_id, start_date, end_date, type, status')
        .eq('organization_id', orgId).in('status', ['已核准', '待審核'])
        .is('deleted_at', null)
        .lte('start_date', endDate).gte('end_date', startDate),
      // 換日線設定(day_boundary_hour):凌晨加班歸前一天用
      supabase.from('organizations').select('settings').eq('id', orgId).maybeSingle(),
      supabase.rpc('web_my_visible_store_ids'),  // 跨店主管/督導可見門市(_can_see_store_for_emp)
      // 員工身分（行政 admin 走固定辦公時間、其他走班表）+ 各身分工時規則
      supabase.from('salary_structures').select('employee_id, employment_category'),
      supabase.from('employment_category_work_rules')
        .select('category, work_start, work_end, grace_minutes')
        .eq('organization_id', orgId).eq('is_active', true),
      // 補打卡申請（待審核 / 已核准 / 已駁回）→ 出勤紀錄「補打卡」欄對照
      supabase.from('clock_corrections')
        .select('employee, date, type, correction_time, status')
        .eq('organization_id', orgId).is('deleted_at', null)
        .in('status', ['待審核', '已核准', '已駁回'])
        .gte('date', startDate).lte('date', endDate),
    ]).then(([r, e, d, s, ot, sch, lv, orgRes, visRes, salRes, ecwrRes, ccRes]) => {
      const boundaryHour = parseInt(orgRes?.data?.settings?.day_boundary_hour, 10) || 6
      const boundaryStr = `${String(boundaryHour).padStart(2, '0')}:00:00`
      const visIds = Array.isArray(visRes?.data) ? visRes.data : null
      setVisibleStoreIds(visIds)
      const empStoreId = (name) => (e.data || []).find(emp => emp.name === name)?.store_id ?? null
      let recs = (r.data || []).map(r => ({
        ...r,
        // Edge Function 寫 total_hours；舊資料寫 hours；統一用 hours
        hours: r.total_hours > 0 ? r.total_hours : (r.hours ?? 0),
      }))
      // store_staff: 只顯示自己的紀錄
      if (isStaff && profile?.name) recs = recs.filter(r => r.employee === profile.name)
      // manager/督導: 只顯示「可見門市」(含所督導的多店),取代舊的單一所屬門市
      if (isManager && visIds) recs = recs.filter(r => visIds.includes(empStoreId(r.employee)))
      setRecords(recs)
      // 加班單 → 套跟出勤一樣的可見性（店員只看自己、主管看可見門市）
      // 凌晨(換日線前)開始的加班歸前一天,打卡追蹤才掛對日子(跨午夜尾段 00:00~ 歸前一天)
      let ots = (ot.data || []).map(o => ({ ...o, date: otAttributedDate(o, boundaryStr) }))
      if (isStaff && profile?.name) ots = ots.filter(o => o.employee === profile.name)
      if (isManager && visIds) ots = ots.filter(o => visIds.includes(empStoreId(o.employee)))
      setOvertimes(ots)
      setDaySchedules(sch.data || [])
      setDayLeaves(lv.data || [])
      setSalaryCats(salRes?.data || [])
      setCatWorkRules(ecwrRes?.data || [])
      // 補打卡:套跟出勤一樣的可見性（店員只看自己、主管看可見門市）
      let ccs = ccRes?.data || []
      if (isStaff && profile?.name) ccs = ccs.filter(c => c.employee === profile.name)
      if (isManager && visIds) ccs = ccs.filter(c => visIds.includes(empStoreId(c.employee)))
      setClockCorrections(ccs)
      setEmployees(e.data || [])
      setDepartments(d.data || [])
      setStores(s.data || [])
    }).catch(err => {
      handleError(err, { component: 'Attendance', errorCode: 'ATTENDANCE_LOAD_FAILED' })
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [startDate, endDate, profile?.organization_id, reloadKey])

  // dept / store 優先用 FK join 出來的名字（departments.name / stores.name），
  // 退而求其次才用 text 欄（e.dept / e.store）— 新匯入員工 text 欄常常是 NULL
  const getEmpDept = useCallback((name) => {
    const e = employees.find(emp => emp.name === name)
    return e?.departments?.name || e?.dept || ''
  }, [employees])
  const getEmpStore = useCallback((name) => {
    const e = employees.find(emp => emp.name === name)
    return e?.stores?.name || e?.store || ''
  }, [employees])

  // 每人每天的「班表 / 加班 / 請假」對照(key = 姓名|日期)
  const dayCtx = useMemo(() => {
    const sched = {}, ot = {}, leave = {}
    for (const s of daySchedules) {
      const k = `${s.employee}|${s.date}`
      if (!sched[k]) sched[k] = (s.actual_start && s.actual_end)
        ? `${String(s.actual_start).slice(0, 5)}-${String(s.actual_end).slice(0, 5)}`
        : (s.shift || '')
    }
    for (const o of overtimes) {
      const k = `${o.employee}|${o.date}`
      if (!ot[k]) ot[k] = { h: 0, pending: false }
      ot[k].h += Number(o.ot_hours ?? o.hours ?? 0)
      if (o.status !== '已核准') ot[k].pending = true
    }
    for (const l of dayLeaves) {
      if (!l.start_date || !l.end_date) continue
      let d = new Date(l.start_date + 'T00:00:00Z'); const end = new Date(l.end_date + 'T00:00:00Z')
      while (d <= end) {
        const k = `${l.employee}|${d.toISOString().slice(0, 10)}`
        // 已核准優先;同天只有待審核才標 pending
        if (!leave[k] || (leave[k].pending && l.status === '已核准')) {
          leave[k] = { type: l.type || '請假', pending: l.status !== '已核准' }
        }
        d.setUTCDate(d.getUTCDate() + 1)
      }
    }
    // 補打卡:key=姓名|日期 → 是否有申請 + 狀態（一天可能補上班+補下班兩筆）
    //   ★ 6 點換天:凌晨(6點前)的補打卡歸「前一天」的班,對齊核准時 _apply_correction_to_attendance,
    //     否則跨午夜夜班的補卡會掛到隔天、跟實際生效那天對不上。
    const corrDay = (c) => {
      const h = c.correction_time ? Number(String(c.correction_time).slice(0, 2)) : null
      if (h != null && h < 6 && c.date) {
        const d = new Date(`${c.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1)
        return d.toISOString().slice(0, 10)
      }
      return c.date
    }
    const corr = {}
    for (const c of clockCorrections) {
      const k = `${c.employee}|${corrDay(c)}`
      if (!corr[k]) corr[k] = { pending: false, approved: false, rejected: false, types: [] }
      if (c.status === '待審核') corr[k].pending = true
      else if (c.status === '已核准') corr[k].approved = true
      else if (c.status === '已駁回') corr[k].rejected = true
      corr[k].types.push(c.type === 'clock_in' ? '補上班' : c.type === 'clock_out' ? '補下班' : '補卡')
    }
    return { sched, ot, leave, corr }
  }, [daySchedules, overtimes, dayLeaves, clockCorrections])

  // 遲到/早退:拿當天班表時間段(HH:MM-HH:MM)跟打卡比。上班晚於班表=遲到、下班早於班表=早退(分鐘)。
  //   只在「有排班時間段」且真的遲到/早退才回值;跨午夜班(end<=start)自動 +1440。
  const toMin = (t) => { if (!t) return null; const [h, m] = String(t).split(':'); return Number(h) * 60 + Number(m) }

  // 姓名 → employment_category（行政 admin 用固定辦公時間判遲到/早退,不靠班表）
  const empCatByName = useMemo(() => {
    const idToCat = {}
    for (const sc of salaryCats) if (sc.employee_id != null && sc.employment_category) idToCat[sc.employee_id] = sc.employment_category
    const m = {}
    for (const e of employees) if (idToCat[e.id]) m[e.name] = idToCat[e.id]
    return m
  }, [salaryCats, employees])

  // 行政固定辦公時間規則(分鐘);沒載到 → fallback 09:00–18:00 grace 30(跟計薪引擎同預設)
  const adminRule = useMemo(() => {
    const a = catWorkRules.find(c => c.category === 'admin')
    return {
      ws: a?.work_start ? toMin(String(a.work_start).slice(0, 5)) : 540,
      we: a?.work_end ? toMin(String(a.work_end).slice(0, 5)) : 1080,
      grace: a?.grace_minutes != null ? Number(a.grace_minutes) : 30,
    }
  }, [catWorkRules])   // eslint-disable-line react-hooks/exhaustive-deps

  // 遲到/早退:有排班就比班表;行政(admin)沒排班 → 固定辦公時間 + 浮動制(跟計薪引擎同一套規則)。
  //   上班晚於「基準−寬限」=遲到;下班早於「應下班」=早退。
  //   行政應下班 = clamp(上班打卡 + 工時span, 下班−寬限, 下班+寬限)（早進早走、晚進晚走）。
  const lateEarly = (r) => {
    // 加班列(加班單)的打卡是加班時段,非正常班,別拿去比標遲到/早退
    if (r._rowType === 'overtime' || r.status === '加班' || r.clock_in_mode === 'overtime') return null
    // 有「核准」請假的日子不判遲到/早退:請假的提早走/晚到不該再算(對齊計薪引擎,避免跟請假重複)。
    //   例:排 11-20、特休 18-20 已核准,18:16 下班不是早退 104 分,是請假時段。待審核不算(還沒核准)。
    const lvDay = dayCtx.leave[`${r.employee}|${r.date}`]
    if (lvDay && !lvDay.pending) return null
    const ci = toMin(r.clock_in), coRaw = toMin(r.clock_out)
    const sv = dayCtx.sched[`${r.employee}|${r.date}`]
    const mm = sv && sv.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/)
    const isAdmin = empCatByName[r.employee] === 'admin'
    let start, end, grace = 0
    if (mm) {
      // 有排班時間段 → 照班表(行政也吃遲到寬限)
      start = toMin(mm[1]); end = toMin(mm[2]); if (end <= start) end += 1440
      grace = isAdmin ? adminRule.grace : 0
    } else if (isAdmin) {
      // 行政沒排班 → 固定辦公時間;週末沒正常班不判(對齊引擎)
      const dow = new Date(r.date + 'T00:00:00').getDay()
      if (dow === 0 || dow === 6) return null
      start = adminRule.ws; grace = adminRule.grace
      const span = adminRule.we - adminRule.ws
      end = ci != null ? Math.min(Math.max(ci + span, adminRule.we - grace), adminRule.we + grace) : adminRule.we
    } else {
      return null
    }
    let late = 0, early = 0
    if (ci != null && start != null) late = Math.max(0, ci - start - grace)
    if (coRaw != null && end != null) { let co = coRaw; if (co < start) co += 1440; if (co < end) early = end - co }
    return (late > 0 || early > 0) ? { late, early } : null
  }

  // 打卡時段與班表時段「完全無交集」= 在錯的時間打卡(非遲到/早退,例:排15:00-02:00卻打11:00-13:01)→ 異常。
  // 只在有完整上下班卡時判斷(缺卡另有標記);對齊跨午夜(打卡窗試 +0 / +1440 兩種位置)。
  const clockOffSchedule = (r) => {
    if (r._rowType === 'overtime' || r._rowType === 'notClocked' || r._rowType === 'leave') return false
    if (r.status === '加班' || r.clock_in_mode === 'overtime') return false
    if (r.clock_in_mode === 'outing' || r.status === '外出' || r.status === '請假') return false
    const sv = dayCtx.sched[`${r.employee}|${r.date}`]
    const mm = sv && sv.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/)
    if (!mm) return false
    const ci = toMin(r.clock_in), co = toMin(r.clock_out)
    if (ci == null || co == null) return false
    let start = toMin(mm[1]), end = toMin(mm[2]); if (end <= start) end += 1440
    let cs = ci, ce = co; if (ce < cs) ce += 1440   // 打卡跨午夜
    const ov = (a1, a2, b1, b2) => a1 < b2 && a2 > b1
    const overlap = ov(cs, ce, start, end) || ov(cs + 1440, ce + 1440, start, end)  // +1440:午夜後打卡對到跨午夜班後半段
    return !overlap
  }

  const today = todayTW()
  const [statusFilter, setStatusFilter] = useState('')   // '' 全部 / normal / abnormal

  // 一列是否「異常」（遲到 / 早退 / 缺下班 / 有排班卻未打卡）— 狀態篩選器與統計共用
  const isRowAbnormal = (r) => {
    if (r._rowType === 'overtime') return false           // 加班單不算
    const isToday = r.date === today
    if (r._rowType === 'notClocked') {
      if (dayCtx.leave[`${r.employee}|${r.date}`]) return false      // 請假
      const sv = dayCtx.sched[`${r.employee}|${r.date}`]
      if (!sv || !/\d{1,2}:\d{2}/.test(sv)) return false             // 休/例假/無排班 → 不算異常
      return true                                                    // 有排班卻沒打卡 = 未打卡
    }
    if (r.status === '請假') return false
    const missingOut = !isToday && r.clock_in && !r.clock_out
    const le = lateEarly(r)
    // 當天有已核准請假 → 不把遲到/早退算異常(對齊計薪引擎守門:請假時段不重複罰;例後 2h 請假打卡到接近假開始)
    const lv = dayCtx.leave[`${r.employee}|${r.date}`]
    const hasApprovedLeave = lv && !lv.pending
    return missingOut || clockOffSchedule(r) || (!hasApprovedLeave && ((le && (le.late > 0 || le.early > 0)) || r.status === '遲到'))
  }

  const filtered = useMemo(() => records.filter(r =>
    (deptFilter === '' || getEmpDept(r.employee) === deptFilter) &&
    (storeFilter === '' || getEmpStore(r.employee) === storeFilter) &&
    (search === '' || r.employee?.includes(search))
  ), [records, deptFilter, storeFilter, search, getEmpDept, getEmpStore])

  const avgHours = useMemo(() =>
    filtered.filter(r => r.hours > 0).reduce((s, r) => s + Number(r.hours), 0) /
    (filtered.filter(r => r.hours > 0).length || 1),
    [filtered]
  )
  const totalHours = useMemo(() =>
    filtered.filter(r => r.hours > 0).reduce((s, r) => s + Number(r.hours), 0),
    [filtered]
  )

  // 「今日未打卡」只在「區間包含今天」時顯示 — 看過去區間時硬塞「今天 未打卡」row 沒意義
  // 加班單 → 獨立加班列（起訖時間當打卡、狀態=加班）
  const otRows = useMemo(() => overtimes
    .filter(o =>
      o.status === '已核准' &&   // 獨立加班列只顯示已核准(待審核只在「加班」欄呈現)
      (deptFilter === '' || getEmpDept(o.employee) === deptFilter) &&
      (storeFilter === '' || getEmpStore(o.employee) === storeFilter) &&
      (search === '' || o.employee?.includes(search))
    )
    .map(o => ({
      _rowType: 'overtime', id: `ot-${o.id}`, ot_id: o.id,
      employee: o.employee, date: o.date,
      clock_in: (o.start_time || '').slice(0, 5) || null,
      clock_out: (o.end_time || '').slice(0, 5) || null,
      hours: Number(o.ot_hours ?? o.hours ?? 0),
      status: '加班', clock_in_mode: 'overtime', clock_out_mode: 'overtime',
      store: o.store,
    })),
    [overtimes, deptFilter, storeFilter, search, getEmpDept, getEmpStore])

  const allRows = useMemo(() => {
    const recordRows = filtered.map(r => ({ ...r, _rowType: 'record' }))
    // 區間內「每一天」都顯示(7/1~7/31 都列),當天沒打卡就補一列「未打卡」
    const dateList = []
    for (let d = new Date(startDate + 'T00:00:00Z'), end = new Date(endDate + 'T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      dateList.push(d.toISOString().slice(0, 10))
    }
    const existing = new Set(records.map(r => `${r.employee}|${r.date}`))
    const scopeEmps = employees.filter(e => {
      const empDept  = e.departments?.name || e.dept || ''
      const empStore = e.stores?.name || e.store || ''
      return (storeFilter === '' || empStore === storeFilter) &&
        (deptFilter === '' || empDept === deptFilter) &&
        (search === '' || e.name.includes(search)) &&
        (!isStaff || e.name === profile?.name) &&
        (!isManager || !visibleStoreIds || visibleStoreIds.includes(e.store_id))
    })
    const noPunchRows = []
    for (const e of scopeEmps) {
      const jd = e.join_date || null      // 到職前不補列
      const rd = e.resign_date || null    // 離職後不補列(離職者只補在職期間)
      for (const d of dateList) {
        if (jd && d < jd) continue
        if (rd && d > rd) continue
        if (existing.has(`${e.name}|${d}`)) continue
        noPunchRows.push({
          _rowType: 'notClocked', id: `nc-${e.id}-${d}`, employee: e.name,
          dept: e.departments?.name || e.dept, store: e.stores?.name || e.store, date: d,
        })
      }
    }
    // 已核准/待審核請假 → 補「請假列」:涵蓋不在 active employees 名單的人(如離職者),
    //   他們沒打卡、又不會被上面的未打卡迴圈補到 → 請假整個看不到。在職者的請假已由未打卡列帶出,
    //   故用 covered 去重,不重複產列。
    const covered = new Set(existing)
    for (const r of noPunchRows) covered.add(`${r.employee}|${r.date}`)
    const leaveRows = []
    for (const lv of dayLeaves) {
      const nm = lv.employee
      if (!nm || !lv.start_date) continue
      if (search !== '' && !nm.includes(search)) continue
      const empDept = getEmpDept(nm), empStore = getEmpStore(nm)
      if (deptFilter !== '' && empDept !== deptFilter) continue
      if (storeFilter !== '' && empStore !== storeFilter) continue
      if (isStaff && nm !== profile?.name) continue
      // 主管/督導:只顯示能解析到可見門市的(離職者在 active 名單解析不到 → 保守略過,不外洩他店)
      const eObj = employees.find(x => x.name === nm)
      if (isManager && visibleStoreIds && !(eObj && visibleStoreIds.includes(eObj.store_id))) continue
      const ls = lv.start_date < startDate ? startDate : lv.start_date
      const leEnd = lv.end_date || lv.start_date
      const le = leEnd > endDate ? endDate : leEnd
      for (let d = new Date(ls + 'T00:00:00Z'), end = new Date(le + 'T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const ds = d.toISOString().slice(0, 10)
        const key = `${nm}|${ds}`
        if (covered.has(key)) continue
        covered.add(key)
        leaveRows.push({
          _rowType: 'notClocked', id: `lv-${lv.employee_id || nm}-${ds}`, employee: nm,
          dept: empDept, store: empStore, date: ds,
        })
      }
    }
    return [...recordRows, ...otRows, ...noPunchRows, ...leaveRows].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '') ||
      (a.employee || '').localeCompare(b.employee || '') ||
      (a._rowType === 'overtime' ? 1 : 0) - (b._rowType === 'overtime' ? 1 : 0)
    )
  }, [filtered, otRows, records, employees, dayLeaves, getEmpDept, getEmpStore, storeFilter, deptFilter, search, startDate, endDate, isStaff, isManager, profile, visibleStoreIds])

  // 狀態篩選（正常 / 異常）
  const viewRows = useMemo(
    () => statusFilter === '' ? allRows
        : allRows.filter(r => statusFilter === 'abnormal' ? isRowAbnormal(r) : !isRowAbnormal(r)),
    [allRows, statusFilter]   // eslint-disable-line react-hooks/exhaustive-deps
  )
  // 前端分頁：預設每頁 100 筆。篩選/區間/tab 改變時回第 1 頁。
  useEffect(() => { setPage(1) }, [search, deptFilter, storeFilter, statusFilter, startDate, endDate, tab])
  const totalPages = Math.max(1, Math.ceil(viewRows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedRows = useMemo(
    () => viewRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [viewRows, safePage]
  )

  // 匯出 PDF：把顯示集(viewRows,未分頁)每列解析成各欄字串(對齊畫面表格欄位)
  const buildExportRows = () => viewRows.map((r) => {
    const isNotClocked = r._rowType === 'notClocked' || r._rowType === 'leave'
    const isOvertime = r._rowType === 'overtime'
    const sched = dayCtx.sched[`${r.employee}|${r.date}`] || ''
    const o = dayCtx.ot[`${r.employee}|${r.date}`]
    const lv = dayCtx.leave[`${r.employee}|${r.date}`]
    const le = (isNotClocked || isOvertime) ? null : lateEarly(r)
    const missingOut = !isOvertime && !isNotClocked && r.date !== today && r.clock_in && !r.clock_out
    let status
    if (isOvertime) status = '加班'
    else if (isNotClocked) {
      if (lv) status = lv.pending ? '請假(審)' : '請假'
      else { const isWork = sched && /\d{1,2}:\d{2}/.test(sched); status = sched ? (isWork ? '未打卡' : sched) : '無排班' }
    } else {
      const offSched = clockOffSchedule(r)
      const hasApprovedLeave = lv && !lv.pending   // 已核准請假 → 不標遲到/早退(對齊計薪守門)
      const showLE = le && !hasApprovedLeave
      const abnormal = r.status === '正常' && ((showLE && (le.late > 0 || le.early > 0)) || missingOut || offSched)
      status = abnormal ? '異常' : r.status
      const extra = []
      if (showLE && le.late > 0) extra.push(`遲到${le.late}分`)
      if (showLE && le.early > 0) extra.push(`早退${le.early}分`)
      if (missingOut) extra.push('缺下班')
      if (offSched && !(le?.late > 0) && !(le?.early > 0)) extra.push('時段不符班表')
      if (extra.length) status += `（${extra.join('、')}）`
    }
    return {
      employee: r.employee,
      dept: (isNotClocked ? (r.dept || getEmpDept(r.employee)) : getEmpDept(r.employee)) || '',
      date: r.date,
      shift: sched,
      clock_in: (!isNotClocked && r.clock_in) || '',
      clock_out: (!isNotClocked && r.clock_out) || '',
      hours: (!isNotClocked && r.hours > 0) ? `${r.hours}h` : '',
      ot: (o?.h > 0) ? `${o.h}h${o.pending ? '(審)' : ''}` : '',
      leave: lv ? `${lv.type}${lv.pending ? '(審)' : ''}` : '',
      correction: (() => { const c = dayCtx.corr[`${r.employee}|${r.date}`]; if (!c) return ''; const label = [...new Set(c.types)].join('/'); return c.pending ? `待審(${label})` : c.approved ? `已補(${label})` : c.rejected ? '駁回' : '' })(),
      location: isOvertime ? '加班單' : (isNotClocked ? '' : (r.clock_in_location || '')),
      gps: (!isNotClocked && r.clock_in_lat != null && r.clock_in_lng != null)
        ? `${Number(r.clock_in_lat).toFixed(5)}, ${Number(r.clock_in_lng).toFixed(5)}` : '',
      status,
    }
  })

  // 匯出 Excel：與 PDF 同一份顯示集(buildExportRows),欄位對齊畫面表格；按下才 lazy-load xlsx
  const exportExcel = async () => {
    const src = buildExportRows()
    if (!src.length) { toast.warning('目前沒有可匯出的紀錄'); return }
    const XLSX = await import('xlsx') // lazy-load：按下匯出才下載 xlsx
    const rows = src.map(r => ({
      '員工': r.employee,
      '部門': r.dept,
      '日期': r.date,
      '當天班表': r.shift,
      '上班打卡': r.clock_in,
      '下班打卡': r.clock_out,
      '工時': r.hours,
      '加班': r.ot,
      '請假': r.leave,
      '補打卡': r.correction,
      '打卡地點': r.location,
      '經緯度': r.gps,
      '狀態': r.status,
    }))
    const header = ['員工','部門','日期','當天班表','上班打卡','下班打卡','工時','加班','請假','補打卡','打卡地點','經緯度','狀態']
    const ws = XLSX.utils.json_to_sheet(rows, { header })
    ws['!cols'] = [10,12,12,14,10,10,7,7,12,12,12,18,20].map(w => ({ wch: w }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '出勤紀錄')
    XLSX.writeFile(wb, `打卡追蹤_${startDate}_${endDate}.xlsx`)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const handleClockIn = async (employeeName) => {
    setClockingIn(true)
    setClockMsg(null)
    try {
      const emp = employees.find(e => e.name === employeeName)
      const store = stores.find(s => s.id === emp?.store_id)  // match by INT FK, not name

      // Client-side validation first (blocks if location check fails)
      const result = await validateClockIn(store)

      const dateStr = todayTW()
      const existing = records.find(r => r.employee === employeeName && r.date === dateStr)
      const action = (existing?.clock_in && !existing?.clock_out) ? 'clock_out' : 'clock_in'

      // Server-side validation + record write
      const data = await serverClockIn({
        employee_id: emp?.id,
        employee:    employeeName,   // legacy fallback — server accepts either
        action,
        lat:      result.lat,
        lng:      result.lng,
        accuracy: result.accuracy ?? null,   // ?? not || — 0 is a valid GPS accuracy value
        ip:       result.ip,
      })

      const timeStr = nowTimeTW()

      if (action === 'clock_out') {
        setRecords(prev => prev.map(r => r.id === data.record.id ? data.record : r))
        setClockMsg({ type: 'success', text: `${employeeName} 下班打卡成功 (${timeStr})` })
      } else {
        setRecords(prev => [...prev.filter(r => !(r.employee === employeeName && r.date === dateStr)), data.record])
        setClockMsg({ type: 'success', text: `${employeeName} 上班打卡成功 (${timeStr}) — ${data.locationName || data.method}` })
      }
    } catch (err) {
      handleError(err, { component: 'Attendance', errorCode: 'CLOCK_IN_FAILED' })
      setClockMsg({ type: 'error', text: err.message })
    }
    setClockingIn(false)
  }

  const openEdit = async (r) => {
    setEditModal(r)
    setEditClockIn(r.clock_in || '')
    setEditClockOut(r.clock_out || '')
    setEditDate(r.date || '')
    setEditHours('')            // 空=用自動扣休息值；填了=用手動值
    setEditReason('')
    setEditHistory([])
    setHistoryLoading(true)
    const { data } = await supabase.from('attendance_clock_edits')
      .select('*').eq('attendance_record_id', r.id).order('created_at', { ascending: false })
    setEditHistory(data || [])
    setHistoryLoading(false)
  }
  const cancelEdit = () => { setEditModal(null); setEditReason(''); setEditHours(''); setEditHistory([]) }

  const saveEdit = async () => {
    const r = editModal
    if (!editReason.trim()) { alert('請填寫調整原因'); return }
    setSaving(true)
    const payload = {}
    if (editClockIn) payload.clock_in = editClockIn
    if (editClockOut) payload.clock_out = editClockOut
    const dateChanged = editDate && editDate !== r.date   // 跨日班把整筆搬到正確那天
    if (dateChanged) payload.date = editDate
    // 工時：有手動填就用手動值（固定不浮動）；沒填才自動算（扣休息）
    if (editHours !== '' && !isNaN(Number(editHours))) {
      payload.total_hours = Math.round(Number(editHours) * 100) / 100
      payload.hours = payload.total_hours
    } else if (editClockIn && editClockOut) {
      // 自動工時走後端 net_work_hours（休息窗 ∩ 打卡;休息落打卡外不扣,如 13:15 打卡不扣午休）
      // RPC 失敗才退回本地 computeNet（舊固定公式）
      const { data: nwh } = await supabase.rpc('net_work_hours', {
        p_emp_id: r.employee_id, p_date: editDate || r.date, p_clock_in: editClockIn, p_clock_out: editClockOut,
      })
      let net = nwh != null ? Number(nwh) : null
      if (net == null) {
        const { data: ssCat } = await supabase.from('salary_structures')
          .select('employment_category').eq('employee_id', r.employee_id).maybeSingle()
        net = computeNet(editClockIn, editClockOut, ssCat?.employment_category === 'admin')
      }
      if (net > 0) { payload.total_hours = net; payload.hours = net }
    }
    const { error } = await supabase.from('attendance_records').update(payload).eq('id', r.id)
    if (error) { setSaving(false); setClockMsg({ type: 'error', text: '儲存失敗：' + error.message }); return }
    const editorEmp = employees.find(e => e.name === profile?.name)
    await supabase.from('attendance_clock_edits').insert({
      attendance_record_id: r.id,
      employee: r.employee,
      date: editDate || r.date,
      old_clock_in: r.clock_in || null,
      new_clock_in: editClockIn || null,
      old_clock_out: r.clock_out || null,
      new_clock_out: editClockOut || null,
      reason: dateChanged ? `${editReason.trim()}（日期 ${r.date}→${editDate}）` : editReason.trim(),
      edited_by: profile?.name || '',
      edited_by_id: editorEmp?.id || null,
      organization_id: profile?.organization_id || null,
    })
    setRecords(prev => prev.map(rec => rec.id === r.id ? { ...rec, ...payload } : rec))
    setClockMsg({ type: 'success', text: `${r.employee} ${editDate || r.date} 打卡時間已更新${dateChanged ? `（已從 ${r.date} 搬移）` : ''}` })
    setSaving(false)
    cancelEdit()
  }

  const openBackfill = async () => {
    setBfEmpId(''); setBfDate(''); setBfIn(''); setBfOut(''); setBfReason('')
    setBackfillOpen(true)
    if (allEmps.length === 0) {
      const orgId = profile?.organization_id ?? getTenantOrgId()
      const { data } = await supabase.from('employees')
        .select('id, name, name_en, status, resign_date, position, store, dept, store_id, departments!department_id(name), stores!store_id(name)')
        .eq('organization_id', orgId)
        .order('status', { ascending: true }).order('name')
      setAllEmps(data || [])
    }
  }

  const saveBackfill = async () => {
    if (!bfEmpId || !bfDate || !bfIn) { alert('請選員工、日期、上班時間'); return }
    if (!bfReason.trim()) { alert('請填補登原因'); return }
    setBfSaving(true)
    const emp = allEmps.find(e => String(e.id) === String(bfEmpId))
    const { data, error } = await supabase.rpc('hr_backfill_attendance', {
      p_emp_id: Number(bfEmpId), p_date: bfDate, p_clock_in: bfIn,
      p_clock_out: bfOut || null, p_reason: bfReason.trim(), p_actor_id: profile?.id ?? null,
    })
    setBfSaving(false)
    if (error || !data?.ok) {
      setClockMsg({ type: 'error', text: '補登失敗：' + (error?.message || data?.error || '未知錯誤') })
      return
    }
    setBackfillOpen(false)
    setClockMsg({ type: 'success', text: `已補登 ${emp?.name || ''} ${bfDate} 打卡（${data.action === 'update' ? '覆蓋既有' : '新增'}）` })
    setReloadKey(k => k + 1)
  }

  const locationBadge = (r) => {
    if (!r.clock_in_location) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>-</span>
    const isExternal = r.clock_in_location === '外部位置'
    return (
      <span className={`badge ${isExternal ? 'badge-warning' : 'badge-success'}`} style={{ fontSize: 11 }}>
        <MapPin size={10} style={{ marginRight: 3 }} />
        {r.clock_in_location}
      </span>
    )
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">⏰</span> 打卡追蹤</h2>
            <p>員工每日出缺勤即時追蹤（含 GPS 地點 / WiFi IP 驗證）</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {canEditClock && (
              <button className="btn btn-primary" onClick={openBackfill}><Clock size={14} /> 補登打卡</button>
            )}
            <button className="btn btn-secondary" onClick={() => exportAttendancePdf(buildExportRows(), { dept: deptFilter, date: `${startDate} ~ ${endDate}` })}><Download size={14} /> 匯出 PDF</button>
            <button className="btn btn-secondary" onClick={exportExcel}><Download size={14} /> 匯出 Excel</button>
          </div>
        </div>
      </div>

      {/* Clock-in message */}
      {clockMsg && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13,
          background: clockMsg.type === 'success' ? 'var(--accent-green-dim)' : clockMsg.type === 'error' ? 'var(--accent-red-dim)' : 'var(--accent-cyan-dim)',
          color: clockMsg.type === 'success' ? 'var(--accent-green)' : clockMsg.type === 'error' ? 'var(--accent-red)' : 'var(--accent-cyan)',
          border: `1px solid ${clockMsg.type === 'success' ? 'var(--accent-green)' : clockMsg.type === 'error' ? 'var(--accent-red)' : 'var(--accent-cyan)'}`,
        }}>
          {clockMsg.text}
          <button onClick={() => setClockMsg(null)} style={{ float: 'right', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { key: 'records', label: '📋 打卡紀錄' },
          { key: 'hours', label: '⏱️ 工時統整' },
          { key: 'comparison', label: '📊 排班比對' },
          { key: 'failures', label: '📍 定位失敗' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
            border: tab === t.key ? 'none' : '1px solid var(--border-medium)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* 月份 + 門市篩選 */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
        alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>📅 日期</span>
        <DateRangeField start={startDate} end={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e) }} />
        {!isStaff && <>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏪 門市</span>
          <select className="form-input" style={{ fontSize: 13, width: 150 }} value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
            <option value="">全部門市</option>
            {stores.filter(s => !isManager || !visibleStoreIds || visibleStoreIds.includes(s.id)).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏢 部門</span>
          <select className="form-input" style={{ fontSize: 13, width: 150 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">全部部門</option>
            {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </>}
      </div>

      {tab === 'records' && <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">正常</div>
          <div className="stat-card-value">{filtered.filter(r => r.status === '正常').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">遲到</div>
          <div className="stat-card-value">{filtered.filter(r => r.status === '遲到').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">加班打卡</div>
          <div className="stat-card-value">{filtered.filter(r => r.status === '加班').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">未打卡</div>
          <div className="stat-card-value">{filtered.filter(r => r.status === '未打卡').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">平均工時</div>
          <div className="stat-card-value">{avgHours.toFixed(1)}h</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">總工時</div>
          <div className="stat-card-value">{totalHours.toFixed(1)}h</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 出勤紀錄</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="form-input" style={{ fontSize: 13, maxWidth: 120 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">全部狀態</option>
              <option value="normal">正常</option>
              <option value="abnormal">異常</option>
            </select>
            <div className="search-bar">
              <Search className="search-icon" />
              <input type="text" placeholder="搜尋員工..." className="form-input" style={{ paddingLeft: 38 }}
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
        </div>
        <div>
          {viewRows.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{statusFilter ? '無符合此狀態的紀錄' : '尚無出勤紀錄'}</div>
          )}
          {/* 橫向捲動容器:表頭 + 內容一起捲 */}
          <div style={{ overflowX: 'auto' }}>
           <div style={{ minWidth: 1520 }}>
          {/* Virtual table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 100px 100px 110px 85px 85px 60px 60px 80px 96px 120px 145px 85px 110px 1fr', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
            {['員工', '部門', '日期', '當天班表', '上班打卡', '下班打卡', '工時', '加班', '請假', '補打卡', '打卡地點', '經緯度', '狀態', '模式', '操作'].map(h => (
              <div key={h} style={{ padding: '10px 8px' }}>{h}</div>
            ))}
          </div>
          {/* List body */}
          <div>
            <div>
              {pagedRows.map((r) => {
                const isToday = r.date === today
                const isNotClocked = r._rowType === 'notClocked'
                const isOvertime = r._rowType === 'overtime'
                const canClockOut = !isNotClocked && !isOvertime && isToday && r.clock_in && !r.clock_out
                const canClockIn = !isNotClocked && !isOvertime && isToday && !r.clock_in
                return (
                  <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '140px 100px 100px 110px 85px 85px 60px 60px 80px 96px 120px 145px 85px 110px 1fr', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', opacity: isNotClocked ? 0.75 : 1, background: isOvertime ? 'var(--accent-orange-dim)' : undefined }}>
                    <div style={{ padding: '4px 8px', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.employee}</div>
                    <div style={{ padding: '4px 8px', fontSize: 12, color: 'var(--text-muted)' }}>{isNotClocked ? (r.dept || '-') : (getEmpDept(r.employee) || '-')}</div>
                    <div style={{ padding: '4px 8px', fontSize: 13 }}>{r.date}</div>
                    {/* 當天班表(緊接日期後)*/}
                    <div style={{ padding: '4px 8px', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dayCtx.sched[`${r.employee}|${r.date}`] || '-'}</div>
                    <div style={{ padding: '4px 8px', fontSize: 13 }}>{r.clock_in || '-'}</div>
                    <div style={{ padding: '4px 8px', fontSize: 13 }}>{r.clock_out || '-'}</div>
                    <div style={{ padding: '4px 8px', fontSize: 13 }}>{!isNotClocked && r.hours > 0 ? `${r.hours}h` : '-'}</div>
                    {/* 加班 / 請假 */}
                    <div style={{ padding: '4px 8px', fontSize: 12 }}>{(() => { const o = dayCtx.ot[`${r.employee}|${r.date}`]; return o?.h > 0 ? <span style={{ color: o.pending ? 'var(--accent-orange)' : 'var(--accent-purple)' }}>{o.h}h{o.pending ? ' 審' : ''}</span> : <span style={{ color: 'var(--text-muted)' }}>-</span> })()}</div>
                    <div style={{ padding: '4px 8px', fontSize: 12 }}>{(() => { const lv = dayCtx.leave[`${r.employee}|${r.date}`]; return lv ? <span style={{ color: lv.pending ? 'var(--accent-orange)' : 'var(--accent-blue)' }}>{lv.type}{lv.pending ? '(審)' : ''}</span> : <span style={{ color: 'var(--text-muted)' }}>-</span> })()}</div>
                    {/* 補打卡：該員工當天有沒有申請補打卡 + 補上班/補下班 + 狀態 */}
                    <div style={{ padding: '4px 8px', fontSize: 12 }}>{(() => {
                      const c = dayCtx.corr[`${r.employee}|${r.date}`]
                      if (!c) return <span style={{ color: 'var(--text-muted)' }}>-</span>
                      const label = [...new Set(c.types)].join('/')
                      const badge = c.pending ? <span className="badge badge-warning"><span className="badge-dot"></span>待審</span>
                        : c.approved ? <span className="badge badge-success"><span className="badge-dot"></span>已補</span>
                        : c.rejected ? <span className="badge badge-danger"><span className="badge-dot"></span>駁回</span>
                        : null
                      if (!badge) return <span style={{ color: 'var(--text-muted)' }}>-</span>
                      return <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }} title={`補打卡 · ${label}`}>{badge}<span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{label}</span></div>
                    })()}</div>
                    <div style={{ padding: '4px 8px' }}>{isNotClocked || isOvertime ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{isOvertime ? '加班單' : '-'}</span> : locationBadge(r)}</div>
                    <div style={{ padding: '4px 8px', fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                      {!isNotClocked && r.clock_in_lat != null && r.clock_in_lng != null ? (
                        <a
                          href={`https://www.google.com/maps?q=${r.clock_in_lat},${r.clock_in_lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="在 Google 地圖開啟打卡位置"
                          style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent-blue)', textDecoration: 'none' }}
                        >
                          <MapPin size={10} style={{ flexShrink: 0 }} />
                          <span style={{ lineHeight: 1.3 }}>
                            {Number(r.clock_in_lat).toFixed(5)}<br />{Number(r.clock_in_lng).toFixed(5)}
                          </span>
                        </a>
                      ) : '-'}
                    </div>
                    <div style={{ padding: '4px 8px' }}>
                      {isNotClocked
                        ? (() => {
                            // 當天有請假(含離職者補的請假列)→ 直接顯示「請假」,不判無排班/漏打
                            const lv = dayCtx.leave[`${r.employee}|${r.date}`]
                            if (lv) return <span className="badge badge-info"><span className="badge-dot"></span>{lv.pending ? '請假(審)' : '請假'}</span>
                            const sv = dayCtx.sched[`${r.employee}|${r.date}`]
                            const isWork = sv && /\d{1,2}:\d{2}/.test(sv)   // 班別是時間段=該上班
                            // 休假/例假/請假別(非時間段)→ 本來就不用打卡,不標紅;無排班也不算漏打
                            if (sv && !isWork) return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sv}</span>
                            if (!sv) return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>無排班</span>
                            return <span className="badge badge-danger"><span className="badge-dot"></span>未打卡</span>
                          })()
                        : (() => {
                            // 缺下班:過去日、有上班卡、沒下班卡(含外出/outing)→ 提示主管補下班
                            //   今天在途中(還沒下班)不算;加班單另計
                            const missingOut = !isToday && !isOvertime && r.clock_in && !r.clock_out
                            const le = lateEarly(r)
                            const offSched = clockOffSchedule(r)
                            // DB 狀態「正常」但實際有遲到/早退/缺下班/打卡時段不符班表 → 顯示「異常」（狀態欄與旁邊細項一致）
                            const abnormal = r.status === '正常' && ((le && (le.late > 0 || le.early > 0)) || missingOut || offSched)
                            return (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                                {abnormal
                                  ? <span className="badge badge-danger" title="有遲到／早退／缺下班／打卡時段不符班表"><span className="badge-dot"></span>異常</span>
                                  : <span className={`badge ${r.status === '正常' ? 'badge-success' : r.status === '遲到' ? 'badge-warning' : r.status === '加班' ? 'badge-purple' : r.status === '請假' ? 'badge-info' : r.status === '外出' ? 'badge-success' : 'badge-danger'}`}><span className="badge-dot"></span>{r.status}</span>}
                                {le && (<>
                                  {le.late > 0 && <span className="badge badge-warning" title={`上班晚於班表 ${le.late} 分鐘`}><span className="badge-dot"></span>遲到 {le.late} 分</span>}
                                  {le.early > 0 && <span className="badge badge-danger" title={`下班早於班表 ${le.early} 分鐘`}><span className="badge-dot"></span>早退 {le.early} 分</span>}
                                </>)}
                                {offSched && !(le?.late > 0) && !(le?.early > 0) && <span className="badge badge-danger" title="打卡時段與當天班表完全不符（在錯的時間打卡）"><span className="badge-dot"></span>時段不符</span>}
                                {missingOut && <span className="badge badge-danger" title="有上班打卡但沒有下班打卡,請補登下班時間"><span className="badge-dot"></span>缺下班</span>}
                              </div>
                            )
                          })()
                      }
                    </div>
                    <div style={{ padding: '4px 8px' }}>
                      {!isNotClocked && <ClockModeTags inMode={r.clock_in_mode} outMode={r.clock_out_mode} />}
                    </div>
                    <div style={{ padding: '4px 8px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {isOvertime && (
                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => navigate(`/hr/overtime?focus=${r.ot_id}`)}>
                          ⚡ 查看加班單
                        </button>
                      )}
                      {canEditClock && !isNotClocked && !isOvertime && (
                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => openEdit(r)}>
                          ✏️ 改時間
                        </button>
                      )}
                      {(isNotClocked || canClockIn || canClockOut) && (
                        <button className={`btn ${canClockOut ? 'btn-secondary' : 'btn-primary'}`} style={{ fontSize: 11, padding: '3px 10px' }} disabled={clockingIn} onClick={() => handleClockIn(r.employee)}>
                          <Clock size={10} /> {canClockOut ? '下班打卡' : '上班打卡'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
           </div>
          </div>
          {/* 分頁 */}
          {viewRows.length > PAGE_SIZE && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                顯示 {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, viewRows.length)} / 共 {viewRows.length} 筆
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} disabled={safePage <= 1} onClick={() => goToPage(safePage - 1)}>← 上一頁</button>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 70, textAlign: 'center' }}>{safePage} / {totalPages}</span>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} disabled={safePage >= totalPages} onClick={() => goToPage(safePage + 1)}>下一頁 →</button>
              </div>
            </div>
          )}
        </div>
      </div>
      </>}

      {/* ══ Work Hours Summary Tab ══ */}
      {tab === 'hours' && (() => {
        // Group records by employee, compute totals
        const empMap = {}
        for (const r of filtered) {
          if (!r.employee) continue
          if (!empMap[r.employee]) empMap[r.employee] = { days: 0, hours: 0, late: 0, normal: 0, overtime: 0, leaveAdj: 0, records: [] }
          empMap[r.employee].records.push(r)
          if (r.hours > 0) { empMap[r.employee].days++; empMap[r.employee].hours += Number(r.hours) }
          if (r.status === '遲到') empMap[r.employee].late++
          if (r.status === '正常') empMap[r.employee].normal++
          if (r.status === '加班') empMap[r.employee].overtime++
          if (r.status === '請假') empMap[r.employee].leaveAdj++
        }
        const empList = Object.entries(empMap).map(([name, data]) => ({
          name, ...data,
          avg: data.days > 0 ? (data.hours / data.days) : 0,
          store: getEmpStore(name),
          dept: getEmpDept(name),
        })).sort((a, b) => b.hours - a.hours)

        const totalHours = empList.reduce((s, e) => s + e.hours, 0)
        const totalDays = empList.reduce((s, e) => s + e.days, 0)

        return (
          <>
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
                <div className="stat-card-label">總工時</div>
                <div className="stat-card-value">{totalHours.toFixed(1)}h</div>
              </div>
              <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
                <div className="stat-card-label">總出勤天數</div>
                <div className="stat-card-value">{totalDays}</div>
              </div>
              <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
                <div className="stat-card-label">人員數</div>
                <div className="stat-card-value">{empList.length}</div>
              </div>
              <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
                <div className="stat-card-label">平均每人工時</div>
                <div className="stat-card-value">{empList.length > 0 ? (totalHours / empList.length).toFixed(1) : 0}h</div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">⏱️</span> 員工工時明細</div>
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>員工</th><th>門市</th><th>出勤天數</th><th>總工時</th><th>平均工時</th>
                      <th>正常</th><th>遲到</th><th>加班</th><th>請假</th><th>工時分佈</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empList.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無資料</td></tr>}
                    {empList.map(e => {
                      const maxHours = Math.max(...empList.map(x => x.hours), 1)
                      const pct = (e.hours / maxHours) * 100
                      return (
                        <tr key={e.name}>
                          <td style={{ fontWeight: 600 }}>{e.name}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.store || e.dept || '—'}</td>
                          <td style={{ textAlign: 'center' }}>{e.days} 天</td>
                          <td style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{e.hours.toFixed(1)}h</td>
                          <td style={{ textAlign: 'center' }}>{e.avg.toFixed(1)}h</td>
                          <td style={{ textAlign: 'center', color: 'var(--accent-green)' }}>{e.normal}</td>
                          <td style={{ textAlign: 'center', color: e.late > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>{e.late}</td>
                          <td style={{ textAlign: 'center', color: e.overtime > 0 ? 'var(--accent-purple)' : 'var(--text-muted)' }}>{e.overtime}</td>
                          <td style={{ textAlign: 'center', color: e.leaveAdj > 0 ? 'var(--accent-blue)' : 'var(--text-muted)' }}>{e.leaveAdj}</td>
                          <td style={{ minWidth: 120 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--glass-light)', overflow: 'hidden' }}>
                                <div style={{
                                  height: '100%', borderRadius: 4, width: `${pct}%`,
                                  background: e.avg >= 9 ? 'var(--accent-orange)' : e.avg >= 7 ? 'var(--accent-cyan)' : 'var(--accent-green)',
                                }} />
                              </div>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 30 }}>{pct.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      })()}

      {tab === 'comparison' && <ScheduleComparisonTab storeFilter={storeFilter} />}

      {tab === 'failures' && (() => {
        const REASON = {
          permission_denied: { t: '定位權限未開（按不允許 或 關定位服務）', c: 'var(--accent-red)' },
          position_unavailable: { t: '定位服務沒開／抓不到（多為 Android）', c: 'var(--accent-orange)' },
          timeout: { t: '定位逾時', c: 'var(--accent-orange)' },
          weak_accuracy: { t: 'GPS 精度不足', c: 'var(--accent-blue)' },
          out_of_range: { t: '不在店範圍', c: 'var(--accent-purple)' },
          no_ip: { t: '抓不到網路 IP', c: 'var(--accent-orange)' },
          unknown: { t: '其他／未知', c: 'var(--text-muted)' },
        }
        const PERM = { denied: '拒絕', granted: '已允許', prompt: '未決定', unsupported: '不支援' }
        const fmt = (ts) => { const d = new Date(ts); return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }
        const failView = storeFilter
          ? failures.filter(r => r.store === storeFilter)
          : failures
        return (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-medium)' }}>
              員工打卡定位失敗記錄 —— 分辨「按不允許／定位沒開／逾時／不在店／精度差」，不用再猜。共 {failView.length} 筆
            </div>
            {failLoading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>載入中...</div>
            ) : failView.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>此區間沒有定位失敗記錄 🎉</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                    {['時間', '員工', '門市', '失敗原因', '定位權限', '距離/精度', '來源'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-medium)' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {failView.map((r, i) => {
                      // permission_denied 再依「網頁定位權限」細分:granted 卻失敗多為系統定位服務未開
                      //   (iOS 的 permissions API 有時會誤報 granted,故用詞保守);denied 則是沒按允許
                      let rc = REASON[r.reason] || REASON.unknown
                      if (r.reason === 'permission_denied') {
                        if (r.perm_state === 'granted') rc = { t: '已允許網頁卻抓不到 → 多為手機「定位服務」未開（iOS 有時誤報已允許）', c: 'var(--accent-red)' }
                        else if (r.perm_state === 'denied') rc = { t: '沒允許網頁定位（請按「允許」）', c: 'var(--accent-red)' }
                      }
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{fmt(r.created_at)}</td>
                          <td style={{ padding: '8px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.employee || '—'}</td>
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{r.store || '—'}</td>
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                            <span style={{ color: rc.c, fontWeight: 600 }}>{rc.t}</span>
                            {r.geo_code ? <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 12 }}>code {r.geo_code}</span> : null}
                          </td>
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: r.perm_state === 'denied' ? 'var(--accent-red)' : 'var(--text-secondary)' }}>{PERM[r.perm_state] || r.perm_state || '—'}</td>
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{r.distance_m != null ? `${r.distance_m}m` : r.accuracy != null ? `±${r.accuracy}m` : '—'}</td>
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{r.client === 'web' ? '網頁' : 'LINE'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── 改時間 Modal ── */}
      {backfillOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px 16px' }}
          onClick={e => { if (e.target === e.currentTarget) setBackfillOpen(false) }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--border-medium)' }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>⏰ 補登打卡紀錄</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              幫當天沒打卡的人補一筆（含已離職員工）
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>員工 <span style={{ color: 'var(--accent-red)' }}>*</span></div>
              <SearchableSelect
                value={bfEmpId}
                onChange={(v) => setBfEmpId(v || '')}
                options={empOptions(allEmps, { keyBy: 'id' })}
                placeholder="搜尋 / 選擇員工（含離職）"
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>日期 <span style={{ color: 'var(--accent-red)' }}>*</span></div>
              <input type="date" value={bfDate} onChange={e => setBfDate(e.target.value)} className="form-input" style={{ width: '100%' }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>上班打卡 <span style={{ color: 'var(--accent-red)' }}>*</span></div>
                <input type="time" value={bfIn} onChange={e => setBfIn(e.target.value)} className="form-input" style={{ width: '100%' }} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  下班打卡{bfIn && bfOut && bfOut < bfIn && <span style={{ color: 'var(--accent-cyan)', marginLeft: 4 }}>· 隔天</span>}
                </div>
                <input type="time" value={bfOut} onChange={e => setBfOut(e.target.value)} className="form-input" style={{ width: '100%' }} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
              下班可留空（只補上班）；有下班則工時依上下班自動算（扣休息）。
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>補登原因 <span style={{ color: 'var(--accent-red)' }}>*</span></div>
              <textarea className="form-input" rows={3} style={{ width: '100%', resize: 'vertical' }}
                placeholder="例：離職員工補齊出勤、忘打卡..."
                value={bfReason} onChange={e => setBfReason(e.target.value)} />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={bfSaving} onClick={saveBackfill}>
                {bfSaving ? '補登中…' : '確認補登'}
              </button>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setBackfillOpen(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {editModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px 16px' }}
          onClick={e => { if (e.target === e.currentTarget) cancelEdit() }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--border-medium)' }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>✏️ 調整打卡時間</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              {editModal.employee}・{editModal.date}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>日期</div>
              <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                className="form-input" style={{ width: '100%' }} />
              {editDate && editDate !== editModal.date && (
                <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4 }}>
                  ⚠️ 這筆打卡紀錄會從 {editModal.date} 搬到 {editDate}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>上班打卡</div>
                <input type="time" value={editClockIn} onChange={e => setEditClockIn(e.target.value)}
                  className="form-input" style={{ width: '100%' }} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  下班打卡{editClockIn && editClockOut && editClockOut < editClockIn && (
                    <span style={{ color: 'var(--accent-cyan)', marginLeft: 4 }}>· 隔天</span>
                  )}
                </div>
                <input type="time" value={editClockOut} onChange={e => setEditClockOut(e.target.value)}
                  className="form-input" style={{ width: '100%' }} />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>工時（小時）</div>
              <input type="number" step="0.01" min="0" value={editHours}
                onChange={e => setEditHours(e.target.value)}
                placeholder={editClockIn && editClockOut ? `自動 ${computeNet(editClockIn, editClockOut)}（可改）` : '留空=依上下班自動算'}
                className="form-input" style={{ width: '100%' }} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                留空 = 依上下班時間自動算（扣休息）；填了 = 固定用這個值，不會被浮動重算。
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>調整原因 <span style={{ color: 'var(--accent-red)' }}>*</span></div>
              <textarea className="form-input" rows={3} style={{ width: '100%', resize: 'vertical' }}
                placeholder="例：員工忘記打卡、系統錯誤..."
                value={editReason} onChange={e => setEditReason(e.target.value)} />
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={saving} onClick={saveEdit}>
                {saving ? '儲存中…' : '確認儲存'}
              </button>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={cancelEdit}>取消</button>
            </div>

            {/* 調整紀錄 */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>📋 調整紀錄</div>
              {historyLoading ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>載入中…</div>
              ) : editHistory.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>尚無調整紀錄</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {editHistory.map(h => (
                    <div key={h.id} style={{ padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{h.edited_by}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{new Date(h.created_at).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
                        {h.old_clock_in !== h.new_clock_in && (
                          <span>上班：<span style={{ color: 'var(--accent-red)' }}>{h.old_clock_in || '—'}</span> → <span style={{ color: 'var(--accent-green)' }}>{h.new_clock_in || '—'}</span></span>
                        )}
                        {h.old_clock_out !== h.new_clock_out && (
                          <span>下班：<span style={{ color: 'var(--accent-red)' }}>{h.old_clock_out || '—'}</span> → <span style={{ color: 'var(--accent-green)' }}>{h.new_clock_out || '—'}</span></span>
                        )}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>「{h.reason}」</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Schedule Comparison Tab ──
function ScheduleComparisonTab({ storeFilter }) {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState(() => ({
    start: monthStartTW(),
    end: todayTW(),
  }))

  useEffect(() => {
    setLoading(true)
    import('../../lib/attendanceComparison').then(({ compareAttendanceWithSchedule }) => {
      compareAttendanceWithSchedule(dateRange.start, dateRange.end, storeFilter).then(data => {
        setResults(data)
        setLoading(false)
      })
    })
  }, [dateRange, storeFilter])

  const normal = results.filter(r => r.status === 'normal').length
  const late = results.filter(r => r.status === 'late').length
  const earlyLeave = results.filter(r => r.status === 'early_leave').length
  const noShow = results.filter(r => r.status === 'no_show').length

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>期間</label>
        <input className="form-input" type="date" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))} style={{ width: 150 }} />
        <span style={{ color: 'var(--text-muted)' }}>~</span>
        <input className="form-input" type="date" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))} style={{ width: 150 }} />
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>比對中...</div> : (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">正常</div>
              <div className="stat-card-value">{normal}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label">遲到</div>
              <div className="stat-card-value">{late}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-pink)', '--card-accent-dim': 'rgba(236,72,153,0.1)' }}>
              <div className="stat-card-label">早退</div>
              <div className="stat-card-value">{earlyLeave}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
              <div className="stat-card-label">未打卡</div>
              <div className="stat-card-value">{noShow}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title"><CalendarCheck size={16} /> 排班 vs 打卡比對</div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>共 {results.length} 筆</span>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>員工</th>
                    <th>日期</th>
                    <th>班別</th>
                    <th style={{ textAlign: 'center' }}>排班時間</th>
                    <th style={{ textAlign: 'center' }}>實際打卡</th>
                    <th style={{ textAlign: 'center' }}>遲到</th>
                    <th style={{ textAlign: 'center' }}>早退</th>
                    <th>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {results.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無比對資料</td></tr>}
                  {results
                    .filter(r => r.status !== 'normal') // Only show anomalies by default
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((r, i) => (
                    <tr key={i} style={{ background: r.status === 'no_show' ? 'rgba(239,68,68,0.03)' : undefined }}>
                      <td style={{ fontWeight: 600 }}>{r.employee}</td>
                      <td>{r.date.slice(5)}</td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: 'var(--glass-light)' }}>
                          {r.shift}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 12 }}>
                        {r.scheduled_start}~{r.scheduled_end}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 12 }}>
                        {r.clock_in || '—'} ~ {r.clock_out || '—'}
                      </td>
                      <td style={{ textAlign: 'center', color: r.late_minutes > 0 ? 'var(--accent-red)' : 'var(--text-muted)', fontWeight: r.late_minutes > 0 ? 700 : 400 }}>
                        {r.late_minutes > 0 ? `${r.late_minutes}分` : '—'}
                      </td>
                      <td style={{ textAlign: 'center', color: r.early_leave_minutes > 0 ? '#ec4899' : 'var(--text-muted)', fontWeight: r.early_leave_minutes > 0 ? 700 : 400 }}>
                        {r.early_leave_minutes > 0 ? `${r.early_leave_minutes}分` : '—'}
                      </td>
                      <td>
                        <span style={{
                          padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                          background: r.status === 'normal' ? 'rgba(52,211,153,0.12)' : r.status === 'late' ? 'rgba(251,146,60,0.12)' : r.status === 'early_leave' ? 'rgba(236,72,153,0.12)' : 'rgba(239,68,68,0.12)',
                          color: r.status === 'normal' ? '#10b981' : r.status === 'late' ? '#f97316' : r.status === 'early_leave' ? '#ec4899' : '#ef4444',
                        }}>
                          {r.status === 'normal' ? '正常' : r.status === 'late' ? '遲到' : r.status === 'early_leave' ? '早退' : '未打卡'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {results.filter(r => r.status !== 'normal').length === 0 && results.length > 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--accent-green)', padding: 20, fontWeight: 600 }}>✓ 全部正常，無遲到/早退/未打卡</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  )
}
