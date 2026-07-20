import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Download, MapPin, Clock, CalendarCheck } from 'lucide-react'
import { getAttendance, serverClockIn, getActiveEmployees, getDepartments, getStores } from '../../lib/db'
import { exportAttendancePdf } from '../../lib/exportPdf'
import { validateClockIn } from '../../lib/clockInValidator'
import { getRestMinutes } from '../../lib/scheduleUtils'

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
import { useAuth } from '../../contexts/AuthContext'
import { useErrorHandler } from '../../hooks/useErrorHandler'
import LoadingSpinner from '../../components/LoadingSpinner'
import DateRangeField from '../../components/DateRangeField'
import { supabase } from '../../lib/supabase'

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
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [stores, setStores] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState(isManager ? (profile?.store || '') : '')
  // 日期區間篩選（預設：本月 1 號 ~ 今天）
  const [startDate, setStartDate] = useState(() => monthStartTW())
  const [endDate, setEndDate] = useState(() => todayTW())
  const [search, setSearch] = useState(isStaff ? (profile?.name || '') : '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [clockingIn, setClockingIn] = useState(false)
  const [clockMsg, setClockMsg] = useState(null)
  const [tab, setTab] = useState('records') // records | hours
  const [page, setPage] = useState(1)       // 打卡紀錄分頁（每頁 100 筆）
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
  const [editHours, setEditHours] = useState('')   // 手動工時（空=用自動扣休息值）
  const [editReason, setEditReason] = useState('')
  const [editHistory, setEditHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const orgId = profile?.organization_id
    setLoading(true)
    Promise.all([
      getAttendance(null, { orgId, from: startDate, to: endDate }),
      getActiveEmployees('id, name, dept, store, department_id, position, store_id, departments!department_id(name), stores!store_id(name)', orgId),
      getDepartments(orgId),
      getStores(),
      supabase.from('overtime_requests')
        .select('id, employee, date, start_time, end_time, ot_hours, hours, ot_category, store, status, organization_id')
        .eq('organization_id', orgId).eq('status', '已核准')
        .is('deleted_at', null)
        .gte('date', startDate).lte('date', endDate),
    ]).then(([r, e, d, s, ot]) => {
      let recs = (r.data || []).map(r => ({
        ...r,
        // Edge Function 寫 total_hours；舊資料寫 hours；統一用 hours
        hours: r.total_hours > 0 ? r.total_hours : (r.hours ?? 0),
      }))
      // store_staff: 只顯示自己的紀錄
      if (isStaff && profile?.name) recs = recs.filter(r => r.employee === profile.name)
      // manager: 只顯示自己門市
      if (isManager && profile?.store) recs = recs.filter(r => {
        const emp = (e.data || []).find(emp => emp.name === r.employee)
        return emp?.store === profile.store
      })
      setRecords(recs)
      // 加班單 → 套跟出勤一樣的可見性（店員只看自己、店長只看自店）
      let ots = ot.data || []
      if (isStaff && profile?.name) ots = ots.filter(o => o.employee === profile.name)
      if (isManager && profile?.store) ots = ots.filter(o => {
        const emp = (e.data || []).find(emp => emp.name === o.employee)
        return emp?.store === profile.store
      })
      setOvertimes(ots)
      setEmployees(e.data || [])
      setDepartments(d.data || [])
      setStores(s.data || [])
    }).catch(err => {
      handleError(err, { component: 'Attendance', errorCode: 'ATTENDANCE_LOAD_FAILED' })
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [startDate, endDate, profile?.organization_id])

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

  const today = todayTW()

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

  // 「今日未打卡」只在「區間包含今天」時顯示 — 看過去區間時硬塞「今天 未打卡」row 沒意義
  const showNotClockedToday = useMemo(() => {
    const t = todayTW(); return startDate <= t && t <= endDate
  }, [startDate, endDate])

  // 加班單 → 獨立加班列（起訖時間當打卡、狀態=加班）
  const otRows = useMemo(() => overtimes
    .filter(o =>
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
    // 正常列 + 加班列合併，同日同人排一起（加班列排在正常列後）
    const merged = [...recordRows, ...otRows].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '') ||
      (a.employee || '').localeCompare(b.employee || '') ||
      (a._rowType === 'overtime' ? 1 : 0) - (b._rowType === 'overtime' ? 1 : 0)
    )
    if (!showNotClockedToday) return merged
    const todayEmpNames = new Set(records.filter(r => r.date === today).map(r => r.employee))
    const notClockedRows = employees
      .filter(e => {
        const empDept  = e.departments?.name || e.dept || ''
        const empStore = e.stores?.name || e.store || ''
        return !todayEmpNames.has(e.name) &&
          (storeFilter === '' || empStore === storeFilter) &&
          (deptFilter === '' || empDept === deptFilter) &&
          (search === '' || e.name.includes(search))
      })
      .map(e => ({
        _rowType: 'notClocked', id: `nc-${e.id}`, employee: e.name,
        dept: e.departments?.name || e.dept,
        store: e.stores?.name || e.store,
        date: today,
      }))
    return [...merged, ...notClockedRows]
  }, [filtered, otRows, records, employees, storeFilter, deptFilter, search, today, showNotClockedToday])

  // 前端分頁：預設每頁 100 筆。篩選/區間/tab 改變時回第 1 頁。
  useEffect(() => { setPage(1) }, [search, deptFilter, storeFilter, startDate, endDate, tab])
  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedRows = useMemo(
    () => allRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [allRows, safePage]
  )

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
    // 工時：有手動填就用手動值（固定不浮動）；沒填才自動算（扣休息）
    if (editHours !== '' && !isNaN(Number(editHours))) {
      payload.total_hours = Math.round(Number(editHours) * 100) / 100
      payload.hours = payload.total_hours
    } else if (editClockIn && editClockOut) {
      // 行政午休固定 60 分 → 查該員工類別
      const { data: ssCat } = await supabase.from('salary_structures')
        .select('employment_category').eq('employee_id', r.employee_id).maybeSingle()
      const net = computeNet(editClockIn, editClockOut, ssCat?.employment_category === 'admin')
      if (net > 0) { payload.total_hours = net; payload.hours = net }
    }
    const { error } = await supabase.from('attendance_records').update(payload).eq('id', r.id)
    if (error) { setSaving(false); setClockMsg({ type: 'error', text: '儲存失敗：' + error.message }); return }
    const editorEmp = employees.find(e => e.name === profile?.name)
    await supabase.from('attendance_clock_edits').insert({
      attendance_record_id: r.id,
      employee: r.employee,
      date: r.date,
      old_clock_in: r.clock_in || null,
      new_clock_in: editClockIn || null,
      old_clock_out: r.clock_out || null,
      new_clock_out: editClockOut || null,
      reason: editReason.trim(),
      edited_by: profile?.name || '',
      edited_by_id: editorEmp?.id || null,
      organization_id: profile?.organization_id || null,
    })
    setRecords(prev => prev.map(rec => rec.id === r.id ? { ...rec, ...payload } : rec))
    setClockMsg({ type: 'success', text: `${r.employee} ${r.date} 打卡時間已更新` })
    setSaving(false)
    cancelEdit()
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
          <button className="btn btn-secondary" onClick={() => exportAttendancePdf(filtered, { dept: deptFilter, date: `${startDate} ~ ${endDate}` })}><Download size={14} /> 匯出 PDF</button>
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
          <select className="form-input" style={{ fontSize: 13, width: 150 }} value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
            disabled={isManager}>
            <option value="">全部門市</option>
            {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏢 部門</span>
          <select className="form-input" style={{ fontSize: 13, width: 150 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">全部部門</option>
            {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </>}
      </div>

      {tab === 'records' && <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
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
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 出勤紀錄</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋員工..." className="form-input" style={{ paddingLeft: 38 }}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div>
          {allRows.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>尚無出勤紀錄</div>
          )}
          {/* Virtual table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 100px 100px 85px 85px 60px 120px 145px 85px 110px 1fr', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
            {['員工', '部門', '日期', '上班打卡', '下班打卡', '工時', '打卡地點', '經緯度', '狀態', '模式', '操作'].map(h => (
              <div key={h} style={{ padding: '10px 8px' }}>{h}</div>
            ))}
          </div>
          {/* List body */}
          <div style={{ overflowX: 'hidden' }}>
            <div>
              {pagedRows.map((r) => {
                const isToday = r.date === today
                const isNotClocked = r._rowType === 'notClocked'
                const isOvertime = r._rowType === 'overtime'
                const canClockOut = !isNotClocked && !isOvertime && isToday && r.clock_in && !r.clock_out
                const canClockIn = !isNotClocked && !isOvertime && isToday && !r.clock_in
                return (
                  <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '140px 100px 100px 85px 85px 60px 120px 145px 85px 110px 1fr', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', opacity: isNotClocked ? 0.75 : 1, background: isOvertime ? 'var(--accent-orange-dim)' : undefined }}>
                    <div style={{ padding: '4px 8px', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.employee}</div>
                    <div style={{ padding: '4px 8px', fontSize: 12, color: 'var(--text-muted)' }}>{isNotClocked ? (r.dept || '-') : (getEmpDept(r.employee) || '-')}</div>
                    <div style={{ padding: '4px 8px', fontSize: 13 }}>{r.date}</div>
                    <div style={{ padding: '4px 8px', fontSize: 13 }}>{r.clock_in || '-'}</div>
                    <div style={{ padding: '4px 8px', fontSize: 13 }}>{r.clock_out || '-'}</div>
                    <div style={{ padding: '4px 8px', fontSize: 13 }}>{!isNotClocked && r.hours > 0 ? `${r.hours}h` : '-'}</div>
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
                        ? <span className="badge badge-danger"><span className="badge-dot"></span>未打卡</span>
                        : <span className={`badge ${r.status === '正常' ? 'badge-success' : r.status === '遲到' ? 'badge-warning' : r.status === '加班' ? 'badge-purple' : r.status === '請假' ? 'badge-info' : r.status === '外出' ? 'badge-success' : 'badge-danger'}`}><span className="badge-dot"></span>{r.status}</span>
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
          {/* 分頁 */}
          {allRows.length > PAGE_SIZE && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                顯示 {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, allRows.length)} / 共 {allRows.length} 筆
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

      {/* ── 改時間 Modal ── */}
      {editModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px 16px' }}
          onClick={e => { if (e.target === e.currentTarget) cancelEdit() }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--border-medium)' }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>✏️ 調整打卡時間</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              {editModal.employee}・{editModal.date}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>上班打卡</div>
                <input type="time" value={editClockIn} onChange={e => setEditClockIn(e.target.value)}
                  className="form-input" style={{ width: '100%' }} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>下班打卡</div>
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
