import { useState, useEffect, useRef } from 'react'
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

function getNextTwoPeriods(ws, anchor) {
  const today = new Date().toISOString().slice(0, 10)
  try {
    const cur = getCycleFor(today, ws || '標準工時', anchor || null)
    const d1 = new Date(cur.end + 'T00:00:00Z')
    d1.setUTCDate(d1.getUTCDate() + 1)
    const p1 = getCycleFor(d1.toISOString().slice(0, 10), ws || '標準工時', anchor || null)
    const d2 = new Date(p1.end + 'T00:00:00Z')
    d2.setUTCDate(d2.getUTCDate() + 1)
    const p2 = getCycleFor(d2.toISOString().slice(0, 10), ws || '標準工時', anchor || null)
    return [{ start: p1.start, end: p1.end }, { start: p2.start, end: p2.end }]
  } catch {
    return []
  }
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

function DateChip({ date, type, onRemove, isWish }) {
  const isRest = type === '休假'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 4 }}>
      <span style={{
        padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
        background: isRest ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.10)',
        color: isRest ? '#f59e0b' : '#ef4444',
        border: `1px solid ${isRest ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.25)'}`,
      }}>
        {date.slice(5)}
      </span>
      {isWish && (
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
          background: 'rgba(34,211,238,0.12)', color: 'var(--accent-cyan)',
          border: '1px solid rgba(34,211,238,0.25)',
        }} title="已核准希望休">希</span>
      )}
      <button onClick={onRemove} style={{
        width: 16, height: 16, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: 'var(--bg-secondary)', color: 'var(--text-muted)',
        fontSize: 10, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>✕</button>
    </div>
  )
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
  // `${storeId}|${empName}|${type}` → boolean
  const [showPicker, setShowPicker] = useState({})
  const [isSaving, setIsSaving]     = useState(false)
  const [activeStoreTab, setActiveStoreTab] = useState(null)

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
      setShowPicker({})
      setIsSaving(false)
      setActiveStoreTab(null)
      wishDates.current = new Set()
    }
  }, [open])

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
  const periods          = primaryStore
    ? getNextTwoPeriods(primarySettings.work_hour_system, primarySettings.variable_period_start)
    : []
  const selectedPeriod   = periods[selectedPeriodIdx] || null

  // Helper: get real work_hour_system for a store (from store_settings, not stores table)
  const getWhs = (storeId) => storeSettingsMap[storeId]?.work_hour_system || null

  const toggleStore = (id) => {
    setSelectedStoreIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const addDate = (storeId, empName, type, date) => {
    const key = `${storeId}|${empName}`
    setEmpRestMap(prev => {
      const cur = prev[key] || { 休假: [], 例假: [] }
      const list = cur[type] || []
      if (list.includes(date)) return prev
      return { ...prev, [key]: { ...cur, [type]: [...list, date].sort() } }
    })
  }

  const removeDate = (storeId, empName, type, date) => {
    const key = `${storeId}|${empName}`
    setEmpRestMap(prev => {
      const cur = prev[key] || { 休假: [], 例假: [] }
      return { ...prev, [key]: { ...cur, [type]: (cur[type] || []).filter(d => d !== date) } }
    })
  }

  const openPicker  = (storeId, empName, type) => setShowPicker(p => ({ ...p, [`${storeId}|${empName}|${type}`]: true }))
  const closePicker = (storeId, empName, type) => setShowPicker(p => ({ ...p, [`${storeId}|${empName}|${type}`]: false }))

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

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-strong)',
        borderRadius: 18, width: 660, maxWidth: '95vw', maxHeight: '90vh',
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
            <button onClick={onClose} style={{
              width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-medium)',
              background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16,
            }}>✕</button>
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
                  <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 11 }}>依 {getWhs(primaryStore?.id) || '標準工時'} 自動計算下兩期</span>
                </label>
                {periods.length === 0 ? (
                  <div style={warnBox}>⚠ 此門市尚未設定工時制度或週期基準日，請先到門市設定完善資料</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {periods.map((p, i) => {
                      const days = Math.round((new Date(p.end) - new Date(p.start)) / 86400000) + 1
                      const active = selectedPeriodIdx === i
                      return (
                        <div key={i} onClick={() => setSelectedPeriodIdx(i)} style={{
                          display: 'flex', alignItems: 'center', gap: 14, padding: '11px 16px',
                          borderRadius: 10, cursor: 'pointer',
                          border: `1px solid ${active ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                          background: active ? 'rgba(34,211,238,0.07)' : 'var(--bg-secondary)',
                          transition: 'all 0.15s',
                        }}>
                          <div style={{
                            width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                            border: `2px solid ${active ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {active && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-cyan)' }} />}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>第 {i + 1} 期</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                              {p.start} ~ {p.end}<span style={{ marginLeft: 8, fontSize: 11 }}>（{days} 天）</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
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
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: 'var(--bg-card)' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-secondary)' }}>
                          <th style={thStyle}>員工姓名</th>
                          <th style={{ ...thStyle, textAlign: 'left', width: '38%', color: '#f59e0b' }}>🌙 休假日期</th>
                          <th style={{ ...thStyle, textAlign: 'left', width: '38%', color: '#ef4444' }}>🛑 例假日期</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emps.map((emp, ri) => {
                          const key  = `${store.id}|${emp.name}`
                          const vals = empRestMap[key] || { 休假: [], 例假: [] }
                          return (
                            <tr key={emp.id} style={{ background: ri % 2 !== 0 ? 'rgba(0,0,0,0.02)' : 'transparent' }}>
                              <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', verticalAlign: 'top' }}>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{emp.name}</div>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{emp.employment_type}</div>
                              </td>

                              {['休假', '例假'].map(type => {
                                const pickerKey = `${store.id}|${emp.name}|${type}`
                                const isPicking = !!showPicker[pickerKey]
                                const dates     = vals[type] || []
                                const typeColor = type === '休假' ? '#f59e0b' : '#ef4444'

                                return (
                                  <td key={type} style={{ padding: '10px 10px', borderBottom: '1px solid var(--border-light)', verticalAlign: 'top' }}>
                                    {dates.map(date => (
                                      <DateChip
                                        key={date}
                                        date={date}
                                        type={type}
                                        isWish={wishDates.current.has(`${emp.name}|${date}`)}
                                        onRemove={() => removeDate(store.id, emp.name, type, date)}
                                      />
                                    ))}

                                    {isPicking ? (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <input
                                          type="date"
                                          autoFocus
                                          min={rangeStart}
                                          max={rangeEnd}
                                          defaultValue={rangeStart}
                                          style={{
                                            padding: '4px 6px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                            border: `1px solid ${typeColor}`,
                                            background: 'var(--bg-card)', color: 'var(--text-primary)', width: 130,
                                          }}
                                          onChange={e => {
                                            const v = e.target.value
                                            if (v && v >= rangeStart && v <= rangeEnd) {
                                              addDate(store.id, emp.name, type, v)
                                              closePicker(store.id, emp.name, type)
                                            }
                                          }}
                                        />
                                        <button onClick={() => closePicker(store.id, emp.name, type)} style={{
                                          width: 20, height: 20, borderRadius: 5, border: '1px solid var(--border-medium)',
                                          background: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                                          fontSize: 11, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}>✕</button>
                                      </div>
                                    ) : (
                                      <button onClick={() => openPicker(store.id, emp.name, type)} style={{
                                        width: 26, height: 26, borderRadius: 7, cursor: 'pointer',
                                        border: `1px dashed ${typeColor}`, background: 'transparent', color: typeColor,
                                        fontSize: 18, fontWeight: 700, lineHeight: 1,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                                      }} title={`新增${type}日期`}>+</button>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
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
                  {isSaving ? '建立草稿中...' : '✨ AI 自動排班 →'}
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
  )
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
