import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../../lib/supabase'
import { getCycleFor } from '../../../lib/scheduleUtils'
import { useAuth } from '../../../contexts/AuthContext'
import { toast } from '../../../lib/toast'

const WHS_COLORS = {
  '四週變形': { bg: 'rgba(139,92,246,0.15)', color: '#8b5cf6', border: 'rgba(139,92,246,0.3)' },
  '二週變形': { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: 'rgba(59,130,246,0.3)' },
  '八週變形': { bg: 'rgba(16,185,129,0.12)', color: '#10b981', border: 'rgba(16,185,129,0.3)' },
  '標準工時': { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8', border: 'rgba(100,116,139,0.3)' },
}

function WhsTag({ whs }) {
  const label = whs || '標準工時'
  const c = WHS_COLORS[label] || WHS_COLORS['標準工時']
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, flexShrink: 0,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>{label}</span>
  )
}

// 算「第 idx 期」：idx 0 = 今天所在週期的「下一期」(原第1期)，正值往後翻、負值往前翻(補排過去)
function getPeriodByIdx(ws, anchor, idx) {
  const wsv = ws || '標準工時'
  const today = new Date().toISOString().slice(0, 10)
  try {
    const cur = getCycleFor(today, wsv, anchor || null)
    // base = 今天週期的下一期
    const d0 = new Date(cur.end + 'T00:00:00Z'); d0.setUTCDate(d0.getUTCDate() + 1)
    let p = getCycleFor(d0.toISOString().slice(0, 10), wsv, anchor || null)
    if (idx > 0) {
      for (let i = 0; i < idx; i++) {
        const nd = new Date(p.end + 'T00:00:00Z'); nd.setUTCDate(nd.getUTCDate() + 1)
        p = getCycleFor(nd.toISOString().slice(0, 10), wsv, anchor || null)
      }
    } else if (idx < 0) {
      for (let i = 0; i < -idx; i++) {
        const pd = new Date(p.start + 'T00:00:00Z'); pd.setUTCDate(pd.getUTCDate() - 1)
        p = getCycleFor(pd.toISOString().slice(0, 10), wsv, anchor || null)
      }
    }
    return { start: p.start, end: p.end }
  } catch {
    return null
  }
}

// 期數標籤：idx 0=下一期、正=往後、負=往前補排
function periodIdxLabel(idx) {
  if (idx === 0) return '下一期'
  if (idx > 0) return `下 ${idx + 1} 期`
  return `往前 ${-idx} 期（補排）`
}

function analyzeGap(lastDate, newStart) {
  if (!lastDate) return { type: 'no-history' }
  const expectedStart = new Date(lastDate + 'T00:00:00Z')
  expectedStart.setUTCDate(expectedStart.getUTCDate() + 1)
  const diff = Math.round((new Date(newStart + 'T00:00:00Z') - expectedStart) / 86400000)
  if (diff === 0) return { type: 'ok' }
  if (diff > 0) return { type: 'gap', days: diff }
  return { type: 'overlap', days: -diff }
}

function GapChip({ gap, loading }) {
  if (loading) return <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>⋯ 讀取中</span>
  if (!gap) return null
  const map = {
    'no-history': { label: 'ℹ 尚無排班記錄', bg: 'rgba(100,116,139,0.12)', color: '#94a3b8' },
    'ok':         { label: '✓ 銜接正常',     bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
    'gap':        { label: `⚠ 間隔 ${gap.days} 天`, bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
    'overlap':    { label: `✗ 重疊 ${gap.days} 天`, bg: 'rgba(239,68,68,0.12)', color: '#ef4444' },
  }
  const c = map[gap.type]
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: c.bg, color: c.color }}>{c.label}</span>
}

export default function CreateScheduleWizard({ open, onClose, locations, mode, onComplete }) {
  const { profile: authProfile } = useAuth()
  const [step, setStep] = useState(1)

  const [selectedStoreIds, setSelectedStoreIds] = useState(new Set())
  const [storeEmployees, setStoreEmployees]     = useState({})
  const [storeLastDates, setStoreLastDates]     = useState({})
  const [storeSettingsMap, setStoreSettingsMap] = useState({}) // storeId → store_settings row
  const [loadingSet, setLoadingSet]             = useState(new Set())

  const [selectedPeriodIdx, setSelectedPeriodIdx]       = useState(0)
  const [storeStartOverrides, setStoreStartOverrides]   = useState({})

  // `${storeId}|${empName}` → { 休假: ['YYYY-MM-DD',...], 例假: ['YYYY-MM-DD',...] }
  const [empRestMap, setEmpRestMap] = useState({})
  // `${empName}|${date}` — dates auto-filled from approved off_requests (희望休)
  const wishDates = useRef(new Set())
  const [isSaving, setIsSaving]     = useState(false)
  const [activeStoreTab, setActiveStoreTab] = useState(null)

  // ── Step2 網格：框選 / 焦點 / 快捷鍵（對齊主排班表格的操作手感）──
  const [focusedCell, setFocusedCell]     = useState(null)  // { r, c }（在當前門市分頁的網格座標）
  const [selection, setSelection]         = useState(null)  // { anchor:{r,c}, end:{r,c} }
  const [restClipboard, setRestClipboard] = useState(null)  // 2D：('休假'|'例假'|null)[][]
  const selectingRef = useRef(false)  // 拖曳選取中
  const draggedRef   = useRef(false)  // 這次 mousedown 有沒有拖過（拖過就不觸發單格 cycle）

  // 草稿續排 session — 中斷後可續排
  const [sessionId, setSessionId] = useState(null)
  const [pendingResumeSession, setPendingResumeSession] = useState(null)  // 開啟時偵測到的未完成 session
  const sessionTimerRef = useRef(null)

  useEffect(() => {
    if (open) {
      setStep(1)
      setSelectedStoreIds(new Set())
      setStoreEmployees({})
      setStoreLastDates({})
      setStoreSettingsMap({})
      setLoadingSet(new Set())
      setSelectedPeriodIdx(0)
      setStoreStartOverrides({})
      setEmpRestMap({})
      setIsSaving(false)
      setActiveStoreTab(null)
      setSessionId(null)
      setPendingResumeSession(null)
      wishDates.current = new Set()

      // 偵測未完成 session — 撈最新一筆 in_progress
      if (authProfile?.id) {
        supabase.from('schedule_draft_sessions')
          .select('*')
          .eq('created_by', authProfile.id)
          .eq('status', 'in_progress')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data }) => {
            if (data) setPendingResumeSession(data)
          })
      }
    }
  }, [open, authProfile?.id])

  // 續排 — restore state 從 session
  const handleResumeSession = () => {
    const s = pendingResumeSession
    if (!s) return
    setSessionId(s.id)
    setSelectedStoreIds(new Set(s.store_ids || []))
    setSelectedPeriodIdx(s.selected_period_idx || 0)
    setStoreStartOverrides(s.store_start_overrides || {})
    setEmpRestMap(s.emp_rest_map || {})
    setStep(s.step || 1)
    setPendingResumeSession(null)
  }

  // 忽略 — 標 abandoned，下次開不再提示
  const handleDiscardSession = async () => {
    if (!pendingResumeSession) return
    await supabase.from('schedule_draft_sessions')
      .update({ status: 'abandoned' })
      .eq('id', pendingResumeSession.id)
    setPendingResumeSession(null)
  }

  // upsert helper — 給 auto-save / 手動按鈕 / onClose flush 共用
  const upsertSession = async ({ silent = false } = {}) => {
    if (!authProfile?.id) return null
    if (selectedStoreIds.size === 0 && !sessionId) return null  // 還沒動就不存
    const payload = {
      created_by: authProfile.id,
      organization_id: authProfile.organization_id || null,
      store_ids: Array.from(selectedStoreIds),
      selected_period_idx: selectedPeriodIdx,
      store_start_overrides: storeStartOverrides,
      emp_rest_map: empRestMap,
      step,
      mode: mode || 'manual',
      status: 'in_progress',
    }
    try {
      if (sessionId) {
        await supabase.from('schedule_draft_sessions').update(payload).eq('id', sessionId)
        if (!silent) toast.success('✓ 草稿已存')
        return sessionId
      } else {
        const { data, error } = await supabase.from('schedule_draft_sessions').insert(payload).select('id').single()
        if (error) throw error
        if (data?.id) setSessionId(data.id)
        if (!silent) toast.success('✓ 草稿已存')
        return data?.id
      }
    } catch (err) {
      if (!silent) toast.error('存草稿失敗：' + (err.message || err))
      return null
    }
  }

  // Debounce auto-save：state 變動 1.5s 後自動寫（silent）
  useEffect(() => {
    if (!open || !authProfile?.id) return
    if (selectedStoreIds.size === 0 && !sessionId) return
    if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current)
    sessionTimerRef.current = setTimeout(() => upsertSession({ silent: true }), 1500)
    return () => sessionTimerRef.current && clearTimeout(sessionTimerRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId, selectedStoreIds, selectedPeriodIdx, storeStartOverrides, empRestMap, step])

  // 包裹 onClose — 關閉前 flush 一次草稿（保險）
  const handleClose = async () => {
    if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current)
    await upsertSession({ silent: true })
    onClose?.()
  }

  // Eagerly fetch store_settings for all locations when wizard opens
  // (work_hour_system + variable_period_start live here, not in the stores table)
  useEffect(() => {
    if (!open || !locations.length) return
    Promise.all(
      locations.map(loc =>
        supabase.from('store_settings').select('*').eq('store_id', loc.id).maybeSingle()
          .then(({ data }) => [loc.id, data || {}])
      )
    ).then(results => setStoreSettingsMap(Object.fromEntries(results)))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const toFetch = Array.from(selectedStoreIds).filter(id => !storeEmployees[id] && !loadingSet.has(id))
    if (!toFetch.length) return
    setLoadingSet(prev => new Set([...prev, ...toFetch]))
    Promise.all(
      toFetch.map(async id => {
        const empRes = await supabase.from('employees')
          .select('id, name, dept, employment_type, store, store_id')
          .eq('store_id', id).eq('status', '在職').order('name')
        const emps = empRes.data || []
        let lastDate = null
        if (emps.length > 0) {
          const names = emps.map(e => e.name)
          const schedRes = await supabase.from('schedules')
            .select('date').in('employee', names)
            .order('date', { ascending: false }).limit(1)
          lastDate = schedRes.data?.[0]?.date || null
        }
        return { id, emps, lastDate }
      })
    ).then(results => {
      setStoreEmployees(prev => { const n = { ...prev }; for (const r of results) n[r.id] = r.emps; return n })
      setStoreLastDates(prev => { const n = { ...prev }; for (const r of results) n[r.id] = r.lastDate; return n })
      setLoadingSet(prev => { const n = new Set(prev); for (const r of results) n.delete(r.id); return n })
    })
  }, [selectedStoreIds]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setStoreStartOverrides({}) }, [selectedPeriodIdx])

  // When entering step 2, auto-populate 休假 from approved off_requests (希望休)
  useEffect(() => {
    if (step !== 2 || !selectedPeriod || !authProfile?.organization_id) return
    const storeNames = selectedStores.map(s => s.name)
    if (!storeNames.length) return

    const allStarts = selectedStores.map(s => storeStartOverrides[s.id] || selectedPeriod.start)
    const earliestStart = allStarts.reduce((a, b) => (a < b ? a : b))
    const latestEnd = selectedPeriod.end

    supabase
      .from('off_requests')
      .select('employee, date, store')
      .eq('organization_id', authProfile.organization_id)
      .eq('status', '已核准')
      .is('deleted_at', null)
      .in('store', storeNames)
      .gte('date', earliestStart)
      .lte('date', latestEnd)
      .then(({ data, error }) => {
        if (error || !data?.length) return
        const nameToStore = Object.fromEntries(selectedStores.map(s => [s.name, s]))
        const newWish = new Set()
        setEmpRestMap(prev => {
          const next = { ...prev }
          for (const row of data) {
            const store = nameToStore[row.store]
            if (!store) continue
            const rangeStart = storeStartOverrides[store.id] || selectedPeriod.start
            if (row.date < rangeStart || row.date > selectedPeriod.end) continue
            const key = `${store.id}|${row.employee}`
            const cur = next[key] || { 休假: [], 例假: [] }
            if (!cur['休假'].includes(row.date)) {
              next[key] = { ...cur, 休假: [...cur['休假'], row.date].sort() }
            }
            newWish.add(`${row.employee}|${row.date}`)
          }
          return next
        })
        wishDates.current = newWish
        if (newWish.size > 0) toast.success(`已自動帶入 ${newWish.size} 筆已核准希望休`)
      })
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedStores   = locations.filter(l => selectedStoreIds.has(l.id))
  const primaryStore     = selectedStores[0]
  const primarySettings  = primaryStore ? (storeSettingsMap[primaryStore.id] || {}) : {}
  const selectedPeriod   = primaryStore
    ? getPeriodByIdx(primarySettings.work_hour_system, primarySettings.variable_period_start, selectedPeriodIdx)
    : null

  // Helper: get real work_hour_system for a store (from store_settings, not stores table)
  const getWhs = (storeId) => storeSettingsMap[storeId]?.work_hour_system || null

  const toggleStore = (id) => {
    setSelectedStoreIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  // 點格子循環：空 → 休假 → 例假 → 空（給 step2 假別網格用）
  const cycleRestDate = (storeId, empName, date) => {
    const key = `${storeId}|${empName}`
    setEmpRestMap(prev => {
      const cur = prev[key] || { 休假: [], 例假: [] }
      const inRest  = (cur['休假'] || []).includes(date)
      const inLeave = (cur['例假'] || []).includes(date)
      let rest  = (cur['休假'] || []).filter(d => d !== date)
      let leave = (cur['例假'] || []).filter(d => d !== date)
      if (!inRest && !inLeave) rest = [...rest, date].sort()
      else if (inRest)         leave = [...leave, date].sort()
      // 例假 → 空（兩者都已濾掉）
      return { ...prev, [key]: { 休假: rest, 例假: leave } }
    })
  }

  // ── Step2 網格衍生資料（放 component scope，讓快捷鍵 handler 也拿得到；索引與畫面渲染共用同一份）──
  const gridStoreId = (activeStoreTab && selectedStoreIds.has(activeStoreTab))
    ? activeStoreTab : selectedStores[0]?.id || null
  const gridEmps = storeEmployees[gridStoreId] || []
  const gridDates = useMemo(() => {
    const start = storeStartOverrides[gridStoreId] || selectedPeriod?.start || ''
    const end   = selectedPeriod?.end || ''
    const out = []
    if (start && end) {
      let dd = new Date(start + 'T00:00:00Z'); const de = new Date(end + 'T00:00:00Z')
      while (dd <= de) { out.push(dd.toISOString().slice(0, 10)); dd.setUTCDate(dd.getUTCDate() + 1) }
    }
    return out
  }, [gridStoreId, storeStartOverrides, selectedPeriod])

  // selection → 正規化 {r0,r1,c0,c1}；inSel 判斷某格是否在框選內
  const normSel = (sel) => sel ? {
    r0: Math.min(sel.anchor.r, sel.end.r), r1: Math.max(sel.anchor.r, sel.end.r),
    c0: Math.min(sel.anchor.c, sel.end.c), c1: Math.max(sel.anchor.c, sel.end.c),
  } : null
  const inSel = (r, c) => { const s = normSel(selection); return !!s && r >= s.r0 && r <= s.r1 && c >= s.c0 && c <= s.c1 }

  // 套用假別到範圍：type = '休假' | '例假' | null(清除)
  const applyRestRange = (r0, r1, c0, c1, type) => {
    if (!gridStoreId) return
    const dates = gridDates.slice(c0, c1 + 1)
    setEmpRestMap(prev => {
      const next = { ...prev }
      for (let r = r0; r <= r1; r++) {
        const emp = gridEmps[r]; if (!emp) continue
        const key = `${gridStoreId}|${emp.name}`
        const cur = next[key] || { 休假: [], 例假: [] }
        const rest = new Set(cur['休假'] || []); const leave = new Set(cur['例假'] || [])
        for (const d of dates) { rest.delete(d); leave.delete(d); if (type === '休假') rest.add(d); else if (type === '例假') leave.add(d) }
        next[key] = { 休假: [...rest].sort(), 例假: [...leave].sort() }
      }
      return next
    })
  }
  // 有框選 → 套框選；否則套焦點格
  const applyRestActive = (type) => {
    const s = normSel(selection)
    if (s) applyRestRange(s.r0, s.r1, s.c0, s.c1, type)
    else if (focusedCell) applyRestRange(focusedCell.r, focusedCell.r, focusedCell.c, focusedCell.c, type)
  }
  const copyRestSelection = () => {
    const s = normSel(selection); if (!s || !gridStoreId) return
    const block = []
    for (let r = s.r0; r <= s.r1; r++) {
      const emp = gridEmps[r]; const cur = empRestMap[`${gridStoreId}|${emp?.name}`] || {}
      const row = []
      for (let c = s.c0; c <= s.c1; c++) { const d = gridDates[c]; row.push((cur['休假'] || []).includes(d) ? '休假' : (cur['例假'] || []).includes(d) ? '例假' : null) }
      block.push(row)
    }
    setRestClipboard(block)
  }
  const pasteRestSelection = () => {
    if (!restClipboard || !gridStoreId) return
    const s = normSel(selection); const base = s ? { r: s.r0, c: s.c0 } : focusedCell
    if (!base) return
    setEmpRestMap(prev => {
      const next = { ...prev }
      restClipboard.forEach((row, dr) => {
        const emp = gridEmps[base.r + dr]; if (!emp) return
        const key = `${gridStoreId}|${emp.name}`; const cur = next[key] || { 休假: [], 例假: [] }
        const rest = new Set(cur['休假'] || []); const leave = new Set(cur['例假'] || [])
        row.forEach((t, dc) => { const d = gridDates[base.c + dc]; if (!d) return; rest.delete(d); leave.delete(d); if (t === '休假') rest.add(d); else if (t === '例假') leave.add(d) })
        next[key] = { 休假: [...rest].sort(), 例假: [...leave].sort() }
      })
      return next
    })
  }

  // 拖曳結束 → 收 selecting；切換門市分頁 / 換步驟 → 清框選與焦點
  useEffect(() => {
    const up = () => { selectingRef.current = false }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])
  useEffect(() => { setSelection(null); setFocusedCell(null) }, [activeStoreTab, step])

  // 快捷鍵（僅 step2 生效，對齊主排班表格：R 休假 / E 例假 / Del 清除 / Ctrl+C·V / 方向鍵）
  useEffect(() => {
    if (!open || step !== 2) return
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) { if (selection) { e.preventDefault(); copyRestSelection() } return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) { if (restClipboard && (selection || focusedCell)) { e.preventDefault(); pasteRestSelection() } return }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (selection || focusedCell) {
        if (k === 'r') { e.preventDefault(); applyRestActive('休假'); return }
        if (k === 'e') { e.preventDefault(); applyRestActive('例假'); return }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); applyRestActive(null); return }
      }
      if (e.key === 'Escape') { e.preventDefault(); if (selection) setSelection(null); else setFocusedCell(null); return }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        if (!gridEmps.length || !gridDates.length) return
        const cur = focusedCell || { r: 0, c: 0 }
        let { r, c } = cur
        if (e.key === 'ArrowUp')    r = Math.max(0, r - 1)
        if (e.key === 'ArrowDown')  r = Math.min(gridEmps.length - 1, r + 1)
        if (e.key === 'ArrowLeft')  c = Math.max(0, c - 1)
        if (e.key === 'ArrowRight') c = Math.min(gridDates.length - 1, c + 1)
        setFocusedCell({ r, c }); setSelection(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, selection, focusedCell, restClipboard, gridEmps, gridDates, gridStoreId, empRestMap])

  const handleComplete = async (actionMode) => {
    if (!selectedPeriod || isSaving) return
    setIsSaving(true)
    try {
      const storeRanges = {}
      for (const s of selectedStores) {
        storeRanges[s.id] = {
          start: storeStartOverrides[s.id] || selectedPeriod.start,
          end: selectedPeriod.end,
        }
      }

      // Save draft schedule entries for all marked days
      // 對齊 cdee833：schedules 表沒 status 欄位，「未發布」是前端 isDirty 算的；
      // 寫 status 會被 PostgREST 退 400 → 整個精靈卡住
      const draftRows = []
      for (const [key, val] of Object.entries(empRestMap)) {
        const pipeIdx = key.indexOf('|')
        const empName = key.slice(pipeIdx + 1)
        for (const date of (val['休假'] || [])) {
          draftRows.push({ employee: empName, date, shift: '休息', organization_id: authProfile?.organization_id })
        }
        for (const date of (val['例假'] || [])) {
          draftRows.push({ employee: empName, date, shift: '例假', organization_id: authProfile?.organization_id })
        }
      }
      if (draftRows.length > 0) {
        const { error } = await supabase.from('schedules').upsert(draftRows, { onConflict: 'employee,date' })
        if (error) throw new Error('草稿建立失敗：' + error.message)
      }

      // 標 session = completed（成功進入 builder 才算完成）
      if (sessionId) {
        await supabase.from('schedule_draft_sessions')
          .update({ status: 'completed' })
          .eq('id', sessionId)
      }

      onComplete({
        mode: actionMode,
        stores: selectedStores.map(s => ({
          store: s.name, storeId: s.id,
          workHourSystem: getWhs(s.id) || '標準工時',
          employees: storeEmployees[s.id] || [],
        })),
        period: selectedPeriod,
        storeRanges,
        empRestMap,
      })
    } catch (err) {
      console.error('Draft save error:', err)
      toast.error(err.message || '建立草稿失敗')
      setIsSaving(false)
    }
  }

  if (!open) return null

  const canNext1 = selectedStoreIds.size > 0 && selectedPeriod

  return createPortal((
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={handleClose}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-strong)',
        borderRadius: 18, width: step === 2 ? 1080 : 660, maxWidth: '95vw', maxHeight: '90vh',
        boxShadow: '0 32px 80px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column',  // ← flex column 讓 header 固定 + body 滾
        overflow: 'hidden',  // 鎖死容器避免內容溢出
      }} onClick={e => e.stopPropagation()}>

        {/* Header — 固定不滾 */}
        <div style={{ padding: '24px 32px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                🧙 排班精靈 — {mode === 'auto' ? '自動建立' : '手動建立'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>步驟 {step} / 3</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {/* 💾 存草稿 — 立即 upsert + toast，給使用者看得到回饋 */}
              {(selectedStoreIds.size > 0 || sessionId) && (
                <button onClick={() => upsertSession()} style={{
                  padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-medium)',
                  background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }} title="立即存草稿（也會在每次操作後自動存）">
                  💾 存草稿
                </button>
              )}
              <button onClick={handleClose} style={{
                width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-medium)',
                background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16,
              }}>✕</button>
            </div>
          </div>

          {/* Progress */}
          <div style={{ display: 'flex', gap: 6, paddingBottom: 20, borderBottom: '1px solid var(--border-light)' }}>
            {['班表日期範圍', '員工設定', '完成'].map((label, i) => {
              const n = i + 1
              return (
                <div key={n} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{
                    height: 4, borderRadius: 4, marginBottom: 6, transition: 'background 0.2s',
                    background: step >= n ? 'var(--accent-cyan)' : 'var(--border-medium)',
                  }} />
                  <div style={{ fontSize: 10, fontWeight: step === n ? 700 : 400, color: step >= n ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                    {n}. {label}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Body — 可滾，含 step content + footer buttons */}
        {/* minHeight:0 是 flexbox 陷阱關鍵：沒這條 flex:1 子元素會撐到內容高，把 header 擠出去 */}
        <div style={{ padding: '24px 32px 28px', overflowY: 'auto', flex: 1, minHeight: 0 }}>

        {/* 草稿續排提示 — 偵測到未完成 session 時顯示 */}
        {pendingResumeSession && (
          <div style={{
            marginBottom: 20, padding: '12px 14px',
            borderRadius: 10, background: 'rgba(59,130,246,0.10)',
            border: '1px solid rgba(59,130,246,0.30)',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 13, color: 'var(--accent-blue, #3b82f6)', fontWeight: 700 }}>
              📂 上次有未完成的排班草稿
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              步驟 {pendingResumeSession.step || 1}／{pendingResumeSession.store_ids?.length || 0} 家店 · {new Date(pendingResumeSession.updated_at).toLocaleString('zh-TW')}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button onClick={handleResumeSession} className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 12 }}>
                ▶ 續排
              </button>
              <button onClick={handleDiscardSession} className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }}>
                ✕ 忽略
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1: 班表日期範圍 ── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <label style={labelStyle}>選擇門市（可多選）</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {locations.map(loc => {
                  const checked = selectedStoreIds.has(loc.id)
                  return (
                    <div key={loc.id} onClick={() => toggleStore(loc.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
                      borderRadius: 10, cursor: 'pointer',
                      border: `1px solid ${checked ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                      background: checked ? 'rgba(34,211,238,0.07)' : 'var(--bg-secondary)',
                      transition: 'all 0.15s',
                    }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                        border: `2px solid ${checked ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                        background: checked ? 'var(--accent-cyan)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontSize: 12, fontWeight: 700, transition: 'all 0.15s',
                      }}>{checked && '✓'}</div>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1, fontSize: 14 }}>{loc.name}</span>
                      <WhsTag whs={getWhs(loc.id)} />
                    </div>
                  )
                })}
              </div>
            </div>

            {selectedStores.length > 0 && (
              <div>
                <label style={labelStyle}>
                  選擇排班期間
                  <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 11 }}>依 {getWhs(primaryStore?.id) || '標準工時'} · ◀ ▶ 左右翻選任意期（可往前補排）</span>
                </label>
                {!selectedPeriod ? (
                  <div style={warnBox}>⚠ 此門市尚未設定工時制度或週期基準日，請先到門市設定完善資料</div>
                ) : (() => {
                  const days = Math.round((new Date(selectedPeriod.end) - new Date(selectedPeriod.start)) / 86400000) + 1
                  const navBtn = {
                    width: 40, height: 40, borderRadius: 9, flexShrink: 0,
                    border: '1px solid var(--border-medium)', background: 'var(--bg-card)',
                    color: 'var(--accent-cyan)', fontSize: 16, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                  }
                  return (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                      borderRadius: 10, border: '1px solid var(--accent-cyan)',
                      background: 'rgba(34,211,238,0.07)',
                    }}>
                      <button type="button" title="往前一期（補排過去）"
                        onClick={() => setSelectedPeriodIdx(i => i - 1)} style={navBtn}>◀</button>
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                          {selectedPeriod.start} ~ {selectedPeriod.end}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {days} 天 · {periodIdxLabel(selectedPeriodIdx)}
                        </div>
                      </div>
                      <button type="button" title="往後一期"
                        onClick={() => setSelectedPeriodIdx(i => i + 1)} style={navBtn}>▶</button>
                    </div>
                  )
                })()}
                {selectedStores.length > 1 && new Set(selectedStores.map(s => getWhs(s.id))).size > 1 && (
                  <div style={{ ...warnBox, marginTop: 8 }}>⚠ 已選門市的工時制度不同，期間依「{primaryStore?.name}」計算</div>
                )}
              </div>
            )}

            {selectedStores.length > 0 && selectedPeriod && (
              <div>
                <label style={labelStyle}>班表日期範圍</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {selectedStores.map(store => {
                    const isLoading      = loadingSet.has(store.id)
                    const lastDate       = storeLastDates[store.id]
                    const effectiveStart = storeStartOverrides[store.id] || selectedPeriod.start
                    const gap            = isLoading ? null : analyzeGap(lastDate, effectiveStart)
                    const days           = Math.round((new Date(selectedPeriod.end + 'T00:00:00Z') - new Date(effectiveStart + 'T00:00:00Z')) / 86400000) + 1
                    return (
                      <div key={store.id} style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: 14, border: '1px solid var(--border-light)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>🏪 {store.name}</span>
                          <WhsTag whs={getWhs(store.id)} />
                          <GapChip gap={gap} loading={isLoading} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <div style={{ textAlign: 'center', minWidth: 90 }}>
                            <div style={timelineLabel}>上次排班結束</div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: lastDate ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                              {isLoading ? '…' : (lastDate || '尚無記錄')}
                            </div>
                          </div>
                          <div style={{ color: 'var(--text-muted)', fontSize: 18, fontWeight: 300 }}>→</div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={timelineLabel}>新排班開始</div>
                            <input type="date" value={effectiveStart}
                              onChange={e => setStoreStartOverrides(prev => ({ ...prev, [store.id]: e.target.value }))}
                              style={{
                                padding: '5px 8px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                                border: storeStartOverrides[store.id] ? '1px solid var(--accent-cyan)' : '1px solid var(--border-medium)',
                                background: 'var(--bg-card)', color: 'var(--text-primary)',
                              }}
                            />
                          </div>
                          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>~</div>
                          <div style={{ textAlign: 'center', minWidth: 90 }}>
                            <div style={timelineLabel}>新排班結束</div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{selectedPeriod.end}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>共 {days} 天</div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {!selectedStores.length && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>請先勾選至少一間門市</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" style={{ padding: '10px 28px' }}
                disabled={!canNext1} onClick={() => setStep(2)}>下一步 →</button>
            </div>
          </div>
        )}

        {/* ── Step 2: 員工設定 ── */}
        {step === 2 && (() => {
          const tabStoreId = (activeStoreTab && selectedStoreIds.has(activeStoreTab))
            ? activeStoreTab
            : selectedStores[0]?.id || null
          const tabStore = selectedStores.find(s => s.id === tabStoreId)

          return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>👥 員工假別設定</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                已核准希望休自動帶入（標示
                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, margin: '0 3px',
                  background: 'rgba(34,211,238,0.12)', color: 'var(--accent-cyan)', border: '1px solid rgba(34,211,238,0.25)' }}>希</span>
                ）· 點擊「+」新增 · 完成後儲存為草稿排班
              </div>
            </div>

            {/* Store tabs */}
            {selectedStores.length > 1 && (
              <div style={{
                display: 'flex', gap: 0, borderBottom: '2px solid var(--border-light)',
                overflowX: 'auto',
              }}>
                {selectedStores.map(store => {
                  const isActive = store.id === tabStoreId
                  const empCount = storeEmployees[store.id]?.length
                  return (
                    <button key={store.id} onClick={() => setActiveStoreTab(store.id)} style={{
                      padding: '8px 18px', fontSize: 13, fontWeight: isActive ? 700 : 500,
                      color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      borderBottom: isActive ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                      marginBottom: -2, whiteSpace: 'nowrap', transition: 'color 0.15s',
                    }}>
                      {store.name}
                      {empCount != null && (
                        <span style={{
                          marginLeft: 6, fontSize: 10, fontWeight: 600,
                          padding: '1px 6px', borderRadius: 10,
                          background: isActive ? 'rgba(34,211,238,0.12)' : 'var(--bg-secondary)',
                          color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                        }}>{empCount}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Active store panel */}
            {tabStore && (() => {
              const store      = tabStore
              const emps       = storeEmployees[store.id] || []
              const isLoading  = loadingSet.has(store.id)
              const rangeStart = storeStartOverrides[store.id] || selectedPeriod?.start || ''
              const rangeEnd   = selectedPeriod?.end || ''

              return (
                <div key={store.id} style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-light)' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
                    background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)',
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>🏪 {store.name}</span>
                    <WhsTag whs={getWhs(store.id)} />
                    {rangeStart && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>{rangeStart} ~ {rangeEnd}</span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                      {isLoading ? '載入中...' : `${emps.length} 人在職`}
                    </span>
                  </div>

                  {isLoading ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, background: 'var(--bg-card)' }}>
                      載入員工中...
                    </div>
                  ) : emps.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, background: 'var(--bg-card)' }}>
                      此門市無在職員工
                    </div>
                  ) : (() => {
                    // 該期所有日期（rangeStart ~ rangeEnd）
                    const periodDates = []
                    if (rangeStart && rangeEnd) {
                      let dd = new Date(rangeStart + 'T00:00:00Z')
                      const de = new Date(rangeEnd + 'T00:00:00Z')
                      while (dd <= de) { periodDates.push(dd.toISOString().slice(0, 10)); dd.setUTCDate(dd.getUTCDate() + 1) }
                    }
                    const WK = ['日', '一', '二', '三', '四', '五', '六']
                    const dcell = {
                      width: 30, minWidth: 30, height: 32, textAlign: 'center', cursor: 'pointer',
                      borderRight: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-light)',
                      fontSize: 14, padding: 0, userSelect: 'none',
                    }
                    return (
                    <div style={{ overflowX: 'auto', border: '1px solid var(--border-light)', borderRadius: 8 }}>
                      <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-secondary)' }}>
                        點格子標假：空 →🌙休假 →🛑例假 →空（再點循環）；🔵「希」= 員工已核准的希望休
                        <span style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>· 拖曳可框選，框選後：<b>R</b> 休假 / <b>E</b> 例假 / <b>Del</b> 清除 / <b>Ctrl+C·V</b> 複製貼上 / 方向鍵移動焦點</span>
                      </div>
                      <table style={{ borderCollapse: 'collapse', fontSize: 12, background: 'var(--bg-card)' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-secondary)' }}>
                            <th style={{ ...thStyle, position: 'sticky', left: 0, zIndex: 2, background: 'var(--bg-secondary)', minWidth: 96, textAlign: 'left' }}>員工</th>
                            {periodDates.map(d => {
                              const dt = new Date(d + 'T00:00:00Z'); const dow = dt.getUTCDay()
                              const we = dow === 0 || dow === 6
                              return (
                                <th key={d} style={{ ...thStyle, width: 30, minWidth: 30, padding: '3px 0', color: we ? '#ef4444' : 'var(--text-muted)' }}>
                                  <div style={{ fontWeight: 700, fontSize: 11 }}>{dt.getUTCDate()}</div>
                                  <div style={{ fontSize: 9 }}>{WK[dow]}</div>
                                </th>
                              )
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {emps.map((emp, ri) => {
                            const key  = `${store.id}|${emp.name}`
                            const vals = empRestMap[key] || { 休假: [], 例假: [] }
                            const restSet  = new Set(vals['休假'] || [])
                            const leaveSet = new Set(vals['例假'] || [])
                            const rowBg = ri % 2 !== 0 ? 'rgba(0,0,0,0.02)' : 'var(--bg-card)'
                            return (
                              <tr key={emp.id} style={{ background: ri % 2 !== 0 ? 'rgba(0,0,0,0.02)' : 'transparent' }}>
                                <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-light)', position: 'sticky', left: 0, zIndex: 1, background: rowBg, whiteSpace: 'nowrap' }}>
                                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{emp.name}</div>
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{emp.employment_type}</div>
                                </td>
                                {periodDates.map((d, ci) => {
                                  const isRest = restSet.has(d); const isLeave = leaveSet.has(d)
                                  const isWish = wishDates.current.has(`${emp.name}|${d}`)
                                  const dow = new Date(d + 'T00:00:00Z').getUTCDay(); const we = dow === 0 || dow === 6
                                  const sel = inSel(ri, ci)
                                  const foc = !!focusedCell && focusedCell.r === ri && focusedCell.c === ci
                                  const baseBg = isRest ? 'rgba(245,158,11,0.20)' : isLeave ? 'rgba(239,68,68,0.20)' : we ? 'rgba(99,102,241,0.04)' : undefined
                                  return (
                                    <td key={d}
                                      onMouseDown={e => { e.preventDefault(); draggedRef.current = false; selectingRef.current = true; setFocusedCell({ r: ri, c: ci }); setSelection({ anchor: { r: ri, c: ci }, end: { r: ri, c: ci } }) }}
                                      onMouseEnter={() => { if (selectingRef.current) { draggedRef.current = true; setSelection(prev => prev ? { ...prev, end: { r: ri, c: ci } } : prev) } }}
                                      onClick={() => { if (draggedRef.current) { draggedRef.current = false; return } cycleRestDate(store.id, emp.name, d) }}
                                      title={`${d}${isWish ? '（希望休）' : ''} · 點一下循環：休假→例假→清除；框選後可按 R/E/Del、Ctrl+C·V`}
                                      style={{ ...dcell,
                                        background: sel && !isRest && !isLeave ? 'rgba(34,211,238,0.16)' : baseBg,
                                        outline: foc ? '2px solid var(--accent-cyan)' : sel ? '1px solid rgba(34,211,238,0.55)' : undefined,
                                        outlineOffset: foc ? '-2px' : '-1px',
                                        position: (foc || sel) ? 'relative' : undefined, zIndex: (foc || sel) ? 1 : undefined,
                                      }}>
                                      {isRest ? '🌙' : isLeave ? '🛑' : (isWish ? <span style={{ fontSize: 9, color: 'var(--accent-cyan)', fontWeight: 700 }}>希</span> : '')}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    )
                  })()
                  }
                </div>
              )
            })()}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" style={{ padding: '10px 20px' }} onClick={() => setStep(1)}>← 上一步</button>
              <button className="btn btn-primary" style={{ padding: '10px 28px' }} onClick={() => setStep(3)}>下一步 →</button>
            </div>
          </div>
          )
        })()}

        {/* ── Step 3: 完成 ── */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>✅ 準備好了！</div>

            <div style={{ background: 'var(--bg-secondary)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SummaryRow label="門市">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {selectedStores.map(s => (
                    <span key={s.id} style={{
                      fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 7,
                      background: 'rgba(34,211,238,0.1)', color: 'var(--accent-cyan)', border: '1px solid rgba(34,211,238,0.25)',
                    }}>{s.name}</span>
                  ))}
                </div>
              </SummaryRow>
              {selectedStores.map(s => {
                const start = storeStartOverrides[s.id] || selectedPeriod?.start
                const end   = selectedPeriod?.end
                const gap   = start ? analyzeGap(storeLastDates[s.id], start) : null
                return (
                  <SummaryRow key={s.id} label={`${s.name} 期間`}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{start} ~ {end}</span>
                      {gap && <GapChip gap={gap} />}
                    </div>
                  </SummaryRow>
                )
              })}
              <SummaryRow label="工時制度">
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {[...new Set(selectedStores.map(s => getWhs(s.id) || '標準工時'))].map(whs => (
                    <WhsTag key={whs} whs={whs} />
                  ))}
                </div>
              </SummaryRow>
              <SummaryRow label="員工總數">
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {selectedStores.reduce((s, store) => s + (storeEmployees[store.id]?.length || 0), 0)} 人
                </span>
              </SummaryRow>
              {(() => {
                const total = Object.values(empRestMap).reduce((s, v) => s + (v['休假']?.length || 0) + (v['例假']?.length || 0), 0)
                if (!total) return null
                return (
                  <SummaryRow label="已設定假日">
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)' }}>{total} 筆（儲存為草稿）</span>
                  </SummaryRow>
                )
              })()}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              {(mode === 'manual' || !mode) && (
                <button className="btn btn-primary" disabled={isSaving}
                  style={{ padding: '14px', fontSize: 15, fontWeight: 700, background: 'linear-gradient(135deg, var(--accent-cyan), #3b82f6)', opacity: isSaving ? 0.7 : 1 }}
                  onClick={() => handleComplete('manual')}>
                  {isSaving ? '建立草稿中...' : '📋 手動填寫班表 →'}
                </button>
              )}
              {(mode === 'auto' || !mode) && (
                <button className="btn btn-primary" disabled={isSaving}
                  style={{ padding: '14px', fontSize: 15, fontWeight: 700, background: 'linear-gradient(135deg, var(--accent-red), var(--accent-orange))', opacity: isSaving ? 0.7 : 1 }}
                  onClick={() => handleComplete('auto')}>
                  {isSaving ? '建立草稿中...' : '⚙️ 自動排班（排班代碼）→'}
                </button>
              )}
            </div>

            <button className="btn btn-secondary" style={{ padding: '10px 20px', alignSelf: 'flex-start' }}
              disabled={isSaving} onClick={() => setStep(2)}>← 上一步</button>
          </div>
        )}

        </div>{/* /Body */}
      </div>
    </div>
  ), document.body)
}

function SummaryRow({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  )
}

const labelStyle    = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }
const timelineLabel = { fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }
const thStyle       = { padding: '8px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, borderBottom: '1px solid var(--border-medium)' }
const warnBox       = { padding: '8px 12px', borderRadius: 8, fontSize: 11, color: 'var(--accent-orange)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }
