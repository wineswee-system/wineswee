import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getMonthDates, formatYearMonth, parseYearMonth, getLockedDateSetForStore } from '../../lib/scheduleUtils'
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
  const [publishStatusRows, setPublishStatusRows] = useState([])  // 整個 cycle 範圍的發布狀態
  const isAdmin = ['admin', 'super_admin'].includes(authProfile?.role)

  // 儲存狀態 indicator — 給使用者看「✓ 已儲存」/「💾 儲存中...」/「⚠️ 失敗」
  const [saveStatus, setSaveStatus] = useState('idle')  // 'idle' | 'saving' | 'saved' | 'error'
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const pendingSavesRef = useRef(0)  // in-flight save count

  const isDirtyRef = useRef(false)

  const safMonth = month || formatYearMonth(new Date().getFullYear(), new Date().getMonth() + 1)
  const { year: monthYear, month: monthNum } = parseYearMonth(safMonth)
  const monthDates = getMonthDates(monthYear, monthNum)
  const rangeStart = range?.start || monthDates[0]
  const rangeEnd = range?.end || monthDates[monthDates.length - 1]
  // Generate every date in range — handles cross-month cycles (e.g. 4-week Jun 26~Jul 23)
  const dates = (() => {
    const result = []
    let cur = new Date(rangeStart + 'T00:00:00Z')
    const end = new Date(rangeEnd + 'T00:00:00Z')
    while (cur <= end) {
      result.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth()+1).padStart(2,'0')}-${String(cur.getUTCDate()).padStart(2,'0')}`)
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    return result
  })()

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
      supabase.from('schedule_publish_status').select('*')
        .eq('store_id', storeId)
        .or(`cycle_start.lte.${rangeEnd},month.eq.${safMonth}`),  // overlap range OR legacy month match
    ]).then(([empRes, sdRes, storeRes, schedRes, psRes]) => {
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
      setPublishStatusRows(psRes.data || [])
      setLoading(false)
    })
  }, [storeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const lockedDates = getLockedDateSetForStore(publishStatusRows, storeId)
  // 找此 range 對應 cycle 是否已發布（顯示 chip + 控制按鈕用）
  const currentCycleStatus = (() => {
    const row = publishStatusRows.find(r =>
      r.store_id === storeId
      && r.cycle_start === rangeStart
      && r.cycle_end === rangeEnd
    )
    return row?.status === 'published' && row?.locked_at ? 'published' : 'draft'
  })()
  const isLocked = currentCycleStatus === 'published'

  // 即時儲存（每筆獨立、不共用 debounce timer — 修之前「快速連點只存最後一筆」bug）
  const autoSave = useCallback(async (empName, date, shift, actualStart, actualEnd, sourceStore) => {
    pendingSavesRef.current++
    setSaveStatus('saving')
    const { error } = await supabase.from('schedules').upsert({
      employee: empName, date, shift,
      actual_start: actualStart, actual_end: actualEnd,
      source_store: sourceStore,
      organization_id: authProfile?.organization_id,
    }, { onConflict: 'employee,date' })
    pendingSavesRef.current--
    if (error) {
      setSaveStatus('error')
      toast.error('自動儲存失敗：' + error.message)
    } else if (pendingSavesRef.current === 0) {
      setSaveStatus('saved')
      setLastSavedAt(Date.now())
    }
  }, [authProfile])

  const handleSetShift = useCallback((empName, date, shift, actualStart, actualEnd, sourceStore) => {
    setAssignments(prev => ({
      ...prev,
      [`${empName}|${date}`]: { shift, actual_start: actualStart, actual_end: actualEnd, source_store: sourceStore },
    }))
    setIsDirty(true)
    isDirtyRef.current = true
    autoSave(empName, date, shift, actualStart, actualEnd, sourceStore)
  }, [autoSave])

  const handleDeleteShift = useCallback(async (empName, date) => {
    setAssignments(prev => {
      const next = { ...prev }
      delete next[`${empName}|${date}`]
      return next
    })
    setIsDirty(true)
    isDirtyRef.current = true
    pendingSavesRef.current++
    setSaveStatus('saving')
    const { error } = await supabase.from('schedules').delete().eq('employee', empName).eq('date', date)
    pendingSavesRef.current--
    if (error) {
      setSaveStatus('error')
      toast.error('刪除失敗：' + error.message)
    } else if (pendingSavesRef.current === 0) {
      setSaveStatus('saved')
      setLastSavedAt(Date.now())
    }
  }, [])

  const handlePublish = async () => {
    if (isLocked) { toast.error('此 cycle 已發布並鎖定'); return }
    if (!(await confirm({ message: `確定發布並鎖定此 cycle？\n\n${rangeStart} ~ ${rangeEnd}\n\n發布後 cell 將無法編輯，需 admin 解鎖才能改。` }))) return
    setPublishing(true)
    // 先確保所有編輯都 flush 到 schedules（autoSave 是 debounce，可能還沒寫）
    const rows = []
    for (const [key, val] of Object.entries(assignments)) {
      const pi = key.lastIndexOf('|')
      const empName = key.slice(0, pi)
      const date = key.slice(pi + 1)
      if (date >= rangeStart && date <= rangeEnd && val.shift) {
        rows.push({
          employee: empName, date, shift: val.shift,
          actual_start: val.actual_start, actual_end: val.actual_end,
          source_store: val.source_store,
          organization_id: authProfile?.organization_id,
        })
      }
    }
    if (rows.length) {
      const { error: upErr } = await supabase.from('schedules').upsert(rows, { onConflict: 'employee,date' })
      if (upErr) { toast.error('寫入失敗：' + upErr.message); setPublishing(false); return }
    }
    // 呼叫 RPC：翻 published + 鎖定
    const { data, error } = await supabase.rpc('publish_schedule_cycle', {
      p_store_id: storeId,
      p_cycle_start: rangeStart,
      p_cycle_end: rangeEnd,
    })
    setPublishing(false)
    if (error) { toast.error('發布失敗：' + error.message); return }
    toast.success(`✅ 已發布並鎖定 ${data?.locked_rows ?? 0} 筆排班`)
    setIsDirty(false)
    isDirtyRef.current = false
    // 重撈狀態
    const { data: ps } = await supabase.from('schedule_publish_status').select('*')
      .eq('store_id', storeId)
      .or(`cycle_start.lte.${rangeEnd},month.eq.${safMonth}`)
    setPublishStatusRows(ps || [])
    navigate('/hr/schedule')
  }

  const handleUnpublish = async () => {
    if (!isAdmin) { toast.error('只有管理員可解鎖'); return }
    if (!(await confirm({ message: `確定解鎖此 cycle？\n\n${rangeStart} ~ ${rangeEnd}\n\n解鎖後 cell 可再次編輯。` }))) return
    setPublishing(true)
    const { data, error } = await supabase.rpc('unpublish_schedule_cycle', {
      p_store_id: storeId,
      p_cycle_start: rangeStart,
      p_cycle_end: rangeEnd,
    })
    setPublishing(false)
    if (error) { toast.error('解鎖失敗：' + error.message); return }
    toast.success(`🔓 已解鎖 ${data?.unlocked_rows ?? 0} 筆排班`)
    // 重撈狀態
    const { data: ps } = await supabase.from('schedule_publish_status').select('*')
      .eq('store_id', storeId)
      .or(`cycle_start.lte.${rangeEnd},month.eq.${safMonth}`)
    setPublishStatusRows(ps || [])
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
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {store} · {safMonth} 排班
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
              background: isLocked ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
              color:      isLocked ? 'var(--accent-green)'   : 'var(--accent-orange)',
              border: `1px solid ${isLocked ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)'}`,
            }}>
              {isLocked ? '🟢 已發布（鎖定）' : '🟡 草稿'}
            </span>
            {/* 儲存狀態 indicator — 每改一格自動存，給使用者看得到回饋 */}
            {!isLocked && (saveStatus !== 'idle') && (
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
                background: saveStatus === 'saving' ? 'rgba(59,130,246,0.12)'
                  : saveStatus === 'saved' ? 'rgba(16,185,129,0.10)'
                  : 'rgba(239,68,68,0.12)',
                color: saveStatus === 'saving' ? '#3b82f6'
                  : saveStatus === 'saved' ? 'var(--accent-green)'
                  : 'var(--accent-red)',
                border: `1px solid ${saveStatus === 'saving' ? 'rgba(59,130,246,0.30)' : saveStatus === 'saved' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.30)'}`,
              }} title={lastSavedAt ? `最後儲存：${new Date(lastSavedAt).toLocaleTimeString('zh-TW')}` : undefined}>
                {saveStatus === 'saving' ? '💾 儲存中...' : saveStatus === 'saved' ? '✓ 已儲存' : '⚠ 儲存失敗'}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {workHourSystem} · {rangeStart} ~ {rangeEnd} · {employees.length} 人 · {assignedCount} 格已排
            {!isLocked && isDirty && <span style={{ marginLeft: 8, color: 'var(--accent-orange)', fontWeight: 600 }}>● 未發布</span>}
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

        {isLocked ? (
          isAdmin ? (
            <button
              className="btn btn-secondary"
              style={{
                padding: '8px 22px', whiteSpace: 'nowrap',
                background: 'rgba(245,158,11,0.12)',
                color: 'var(--accent-orange)',
                border: '1px solid var(--accent-orange)',
                opacity: publishing ? 0.7 : 1,
              }}
              onClick={handleUnpublish}
              disabled={publishing}
            >
              {publishing ? '解鎖中...' : '🔓 解鎖此 cycle'}
            </button>
          ) : (
            <button className="btn btn-secondary" style={{ padding: '8px 22px', whiteSpace: 'nowrap', opacity: 0.6, cursor: 'not-allowed' }} disabled>
              🔒 已鎖定
            </button>
          )
        ) : (
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
            {publishing ? '發布中...' : '📢 發布並鎖定'}
          </button>
        )}
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
            lockedDates={lockedDates}
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
            lockedDates={lockedDates}
          />
        )}
      </div>
    </div>
  )
}
