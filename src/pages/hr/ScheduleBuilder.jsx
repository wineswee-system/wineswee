import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getMonthDates, formatYearMonth, parseYearMonth } from '../../lib/scheduleUtils'
import { useAuth } from '../../contexts/AuthContext'
import ScheduleBuilderGrid from './components/ScheduleBuilderGrid'
import ScheduleBuilderCalendar from './components/ScheduleBuilderCalendar'
import LoadingSpinner from '../../components/LoadingSpinner'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

export default function ScheduleBuilder() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile: authProfile } = useAuth()

  const state = location.state || {}
  const { store, storeId, month, range, workHourSystem, restDayMap = {} } = state

  const [employees, setEmployees] = useState([])
  const [shiftDefs, setShiftDefs] = useState([])
  const [storeSettings, setStoreSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [assignments, setAssignments] = useState({})
  const [view, setView] = useState('grid')
  const [calendarSubView, setCalendarSubView] = useState('month')
  const [isDirty, setIsDirty] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const saveTimer = useRef(null)
  const isDirtyRef = useRef(false)

  const safMonth = month || formatYearMonth(new Date().getFullYear(), new Date().getMonth() + 1)
  const { year: monthYear, month: monthNum } = parseYearMonth(safMonth)
  const monthDates = getMonthDates(monthYear, monthNum)
  const rangeStart = range?.start || monthDates[0]
  const rangeEnd = range?.end || monthDates[monthDates.length - 1]
  const dates = monthDates.filter(d => d >= rangeStart && d <= rangeEnd)

  useEffect(() => {
    if (!storeId) {
      toast.error('請從排班精靈開始')
      navigate('/hr/schedule')
      return
    }

    Promise.all([
      supabase.from('employees')
        .select('id, name, dept, employment_type, store, store_id, additional_stores, can_open, can_close, weekly_target_hours, personal_hour_cap')
        .eq('store_id', storeId)
        .eq('status', '在職')
        .order('name'),
      supabase.from('shift_definitions').select('*').order('sort_order'),
      supabase.from('stores').select('*').eq('id', storeId).single(),
      supabase.from('schedules').select('*').gte('date', rangeStart).lte('date', rangeEnd),
    ]).then(([empRes, sdRes, storeRes, schedRes]) => {
      const emps = empRes.data || []
      setEmployees(emps)

      // Store-scoped: global defs (no store_id) + this store's defs
      setShiftDefs((sdRes.data || []).filter(d => !d.store_id || d.store_id === storeId))

      setStoreSettings(storeRes.data)

      // Seed with wizard rest days, then overlay any existing DB schedules
      const init = { ...restDayMap }
      const empNames = new Set(emps.map(e => e.name))
      for (const s of (schedRes.data || [])) {
        if (empNames.has(s.employee)) {
          init[`${s.employee}|${s.date}`] = {
            shift: s.shift,
            actual_start: s.actual_start,
            actual_end: s.actual_end,
            source_store: s.source_store,
          }
        }
      }
      setAssignments(init)
      setLoading(false)
    })
  }, [storeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const autoSave = useCallback(async (empName, date, shift, actualStart, actualEnd, sourceStore) => {
    await supabase.from('schedules').upsert({
      employee: empName, date, shift,
      actual_start: actualStart, actual_end: actualEnd,
      source_store: sourceStore,
      status: 'draft',
      organization_id: authProfile?.organization_id,
    }, { onConflict: 'employee,date' })
  }, [authProfile])

  const handleSetShift = useCallback((empName, date, shift, actualStart, actualEnd, sourceStore) => {
    setAssignments(prev => ({
      ...prev,
      [`${empName}|${date}`]: { shift, actual_start: actualStart, actual_end: actualEnd, source_store: sourceStore },
    }))
    setIsDirty(true)
    isDirtyRef.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => autoSave(empName, date, shift, actualStart, actualEnd, sourceStore), 800)
  }, [autoSave])

  const handleDeleteShift = useCallback((empName, date) => {
    setAssignments(prev => {
      const next = { ...prev }
      delete next[`${empName}|${date}`]
      return next
    })
    setIsDirty(true)
    isDirtyRef.current = true
    supabase.from('schedules').delete().eq('employee', empName).eq('date', date)
  }, [])

  const handlePublish = async () => {
    setPublishing(true)
    const rows = []
    for (const [key, val] of Object.entries(assignments)) {
      const pi = key.lastIndexOf('|')
      const empName = key.slice(0, pi)
      const date = key.slice(pi + 1)
      if (date >= rangeStart && date <= rangeEnd) {
        rows.push({
          employee: empName, date, shift: val.shift,
          actual_start: val.actual_start, actual_end: val.actual_end,
          source_store: val.source_store,
          status: 'published',
          organization_id: authProfile?.organization_id,
        })
      }
    }
    if (!rows.length) { toast.error('無排班資料可發布'); setPublishing(false); return }
    const { error } = await supabase.from('schedules').upsert(rows, { onConflict: 'employee,date' })
    setPublishing(false)
    if (error) { toast.error('發布失敗：' + error.message); return }
    toast.success(`✅ 已發布 ${rows.length} 筆排班`)
    setIsDirty(false)
    isDirtyRef.current = false
    navigate('/hr/schedule')
  }

  const handleBack = async () => {
    if (isDirtyRef.current) {
      if (!(await confirm({ message: '有未儲存的變更，確定要離開？\n\n（草稿已自動儲存，離開後可在排班管理找到）' }))) return
    }
    navigate('/hr/schedule')
  }

  if (loading) return <LoadingSpinner />

  if (!store || !storeId) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🧙</div>
        <div style={{ fontSize: 16, marginBottom: 20 }}>請從排班精靈開始建立排班</div>
        <button className="btn btn-primary" onClick={() => navigate('/hr/schedule')}>← 回排班管理</button>
      </div>
    )
  }

  const assignedCount = Object.keys(assignments).filter(k => {
    const pi = k.lastIndexOf('|'); const d = k.slice(pi + 1)
    return d >= rangeStart && d <= rangeEnd
  }).length

  return (
    <div style={{ padding: 24, minHeight: '100vh', background: 'var(--bg-primary)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" style={{ padding: '8px 14px', whiteSpace: 'nowrap' }} onClick={handleBack}>
          ← 返回
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
            {store} · {safMonth} 排班
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {workHourSystem} · {rangeStart} ~ {rangeEnd} · {employees.length} 人 · {assignedCount} 格已排
            {isDirty && <span style={{ marginLeft: 8, color: 'var(--accent-orange)', fontWeight: 600 }}>● 未發布</span>}
          </div>
        </div>

        {/* View toggle */}
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 8, overflow: 'hidden' }}>
          {[{ k: 'grid', l: '📋 班表格' }, { k: 'calendar', l: '📅 月曆' }].map(v => (
            <button key={v.k} onClick={() => setView(v.k)} style={{
              padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: view === v.k ? 'var(--accent-cyan)' : 'var(--bg-card)',
              color: view === v.k ? '#fff' : 'var(--text-muted)',
            }}>{v.l}</button>
          ))}
        </div>

        <button
          className="btn btn-primary"
          style={{
            padding: '8px 22px', whiteSpace: 'nowrap',
            background: 'linear-gradient(135deg, var(--accent-cyan), #3b82f6)',
            opacity: publishing ? 0.7 : 1,
          }}
          onClick={handlePublish}
          disabled={publishing}
        >
          {publishing ? '發布中...' : '📢 發布排班'}
        </button>
      </div>

      {/* Info bar */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 16, padding: '8px 14px',
        background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-light)',
        flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)', alignItems: 'center',
      }}>
        <span>🏪 {store}</span>
        <span>📅 {rangeStart} ~ {rangeEnd}（{dates.length} 天）</span>
        <span>👥 {employees.length} 人在職</span>
        {storeSettings?.min_staff && <span>最低平日：<strong>{storeSettings.min_staff}</strong> 人</span>}
        {storeSettings?.min_staff_weekend && <span>最低假日：<strong>{storeSettings.min_staff_weekend}</strong> 人</span>}
        {view === 'grid' && (
          <span style={{ marginLeft: 'auto', opacity: 0.7 }}>
            拖曳班別到格子 · 點擊格子編輯 · 已排班格可拖曳移動
          </span>
        )}
      </div>

      {/* Main content card */}
      <div style={{
        background: 'var(--bg-card)', borderRadius: 14,
        border: '1px solid var(--border-medium)', padding: 20,
      }}>
        {view === 'grid' ? (
          <ScheduleBuilderGrid
            employees={employees}
            dates={dates}
            shiftDefs={shiftDefs}
            storeSettings={storeSettings}
            assignments={assignments}
            handleSetShift={handleSetShift}
            handleDeleteShift={handleDeleteShift}
            store={store}
          />
        ) : (
          <ScheduleBuilderCalendar
            employees={employees}
            dates={dates}
            shiftDefs={shiftDefs}
            assignments={assignments}
            storeSettings={storeSettings}
            handleSetShift={handleSetShift}
            handleDeleteShift={handleDeleteShift}
            calendarSubView={calendarSubView}
            setCalendarSubView={setCalendarSubView}
          />
        )}
      </div>
    </div>
  )
}
