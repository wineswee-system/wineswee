import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { getCycleFor } from '../../../lib/scheduleUtils'

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
  const diff = Math.round(
    (new Date(newStart + 'T00:00:00Z') - expectedStart) / 86400000
  )
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
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
      background: c.bg, color: c.color,
    }}>{c.label}</span>
  )
}

export default function CreateScheduleWizard({ open, onClose, locations, mode, onComplete }) {
  const [step, setStep] = useState(1)

  // Store selection
  const [selectedStoreIds, setSelectedStoreIds] = useState(new Set())
  const [storeEmployees, setStoreEmployees] = useState({}) // storeId → emp[]
  const [storeLastDates, setStoreLastDates]   = useState({}) // storeId → 'YYYY-MM-DD' | null
  const [loadingSet, setLoadingSet]           = useState(new Set()) // stores currently fetching

  // Period selection
  const [selectedPeriodIdx, setSelectedPeriodIdx] = useState(0)
  const [storeStartOverrides, setStoreStartOverrides] = useState({}) // storeId → override start date

  // Step 2: employee leave table
  const [empRestMap, setEmpRestMap] = useState({}) // `${storeId}|${empName}` → { 休假: N, 例假: N }

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(1)
      setSelectedStoreIds(new Set())
      setStoreEmployees({})
      setStoreLastDates({})
      setLoadingSet(new Set())
      setSelectedPeriodIdx(0)
      setStoreStartOverrides({})
      setEmpRestMap({})
    }
  }, [open])

  // Fetch employees AND last schedule date together when a store is newly selected
  useEffect(() => {
    const toFetch = Array.from(selectedStoreIds).filter(id => !storeEmployees[id] && !loadingSet.has(id))
    if (!toFetch.length) return

    setLoadingSet(prev => new Set([...prev, ...toFetch]))

    Promise.all(
      toFetch.map(async id => {
        // 1. Employees
        const empRes = await supabase.from('employees')
          .select('id, name, dept, employment_type, store, store_id')
          .eq('store_id', id).eq('status', '在職').order('name')
        const emps = empRes.data || []

        // 2. Last schedule date for these employees
        let lastDate = null
        if (emps.length > 0) {
          const names = emps.map(e => e.name)
          const schedRes = await supabase.from('schedules')
            .select('date')
            .in('employee', names)
            .order('date', { ascending: false })
            .limit(1)
          lastDate = schedRes.data?.[0]?.date || null
        }

        return { id, emps, lastDate }
      })
    ).then(results => {
      setStoreEmployees(prev => {
        const next = { ...prev }
        for (const r of results) next[r.id] = r.emps
        return next
      })
      setStoreLastDates(prev => {
        const next = { ...prev }
        for (const r of results) next[r.id] = r.lastDate
        return next
      })
      setLoadingSet(prev => {
        const next = new Set(prev)
        for (const r of results) next.delete(r.id)
        return next
      })
    })
  }, [selectedStoreIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear per-store start overrides when the period selection changes
  useEffect(() => { setStoreStartOverrides({}) }, [selectedPeriodIdx])

  const selectedStores   = locations.filter(l => selectedStoreIds.has(l.id))
  const primaryStore     = selectedStores[0]
  const periods          = primaryStore ? getNextTwoPeriods(primaryStore.work_hour_system, primaryStore.variable_period_start) : []
  const selectedPeriod   = periods[selectedPeriodIdx] || null

  const toggleStore = (id) => {
    setSelectedStoreIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const setEmpRest = (storeId, empName, type, raw) => {
    const key = `${storeId}|${empName}`
    setEmpRestMap(prev => ({
      ...prev,
      [key]: { ...(prev[key] || { 休假: 0, 例假: 0 }), [type]: Math.max(0, parseInt(raw) || 0) },
    }))
  }

  const handleComplete = (actionMode) => {
    if (!selectedPeriod) return
    const storeRanges = {}
    for (const s of selectedStores) {
      storeRanges[s.id] = {
        start: storeStartOverrides[s.id] || selectedPeriod.start,
        end: selectedPeriod.end,
      }
    }
    onComplete({
      mode: actionMode,
      stores: selectedStores.map(s => ({
        store: s.name, storeId: s.id,
        workHourSystem: s.work_hour_system || '標準工時',
        employees: storeEmployees[s.id] || [],
      })),
      period: selectedPeriod,
      storeRanges,
      empRestMap,
    })
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
        borderRadius: 18, padding: 32, width: 660, maxWidth: '95vw', maxHeight: '90vh',
        overflowY: 'auto', boxShadow: '0 32px 80px rgba(0,0,0,0.4)',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
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
        <div style={{ display: 'flex', gap: 6, marginBottom: 28 }}>
          {['班表日期範圍', '員工設定', '完成'].map((label, i) => {
            const n = i + 1
            return (
              <div key={n} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  height: 4, borderRadius: 4, marginBottom: 6, transition: 'background 0.2s',
                  background: step >= n ? 'var(--accent-cyan)' : 'var(--border-medium)',
                }} />
                <div style={{
                  fontSize: 10, fontWeight: step === n ? 700 : 400,
                  color: step >= n ? 'var(--accent-cyan)' : 'var(--text-muted)',
                }}>{n}. {label}</div>
              </div>
            )
          })}
        </div>

        {/* ── Step 1: 班表日期範圍 ── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* ① Store multi-select */}
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
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1, fontSize: 14 }}>
                        {loc.name}
                      </span>
                      <WhsTag whs={loc.work_hour_system} />
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ② Period selection — auto-calculated */}
            {selectedStores.length > 0 && (
              <div>
                <label style={labelStyle}>
                  選擇排班期間
                  <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 11 }}>
                    依 {primaryStore?.work_hour_system || '標準工時'} 自動計算下兩期
                  </span>
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
                              {p.start} ~ {p.end}
                              <span style={{ marginLeft: 8, fontSize: 11 }}>（{days} 天）</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {selectedStores.length > 1 && new Set(selectedStores.map(s => s.work_hour_system)).size > 1 && (
                  <div style={{ ...warnBox, marginTop: 8 }}>
                    ⚠ 已選門市的工時制度不同，期間依「{primaryStore?.name}」計算
                  </div>
                )}
              </div>
            )}

            {/* ③ Per-store date range analysis */}
            {selectedStores.length > 0 && selectedPeriod && (
              <div>
                <label style={labelStyle}>班表日期範圍</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {selectedStores.map(store => {
                    const isLoading    = loadingSet.has(store.id)
                    const lastDate     = storeLastDates[store.id]
                    const effectiveStart = storeStartOverrides[store.id] || selectedPeriod.start
                    const gap          = isLoading ? null : analyzeGap(lastDate, effectiveStart)
                    const days         = Math.round(
                      (new Date(selectedPeriod.end + 'T00:00:00Z') - new Date(effectiveStart + 'T00:00:00Z')) / 86400000
                    ) + 1

                    return (
                      <div key={store.id} style={{
                        background: 'var(--bg-secondary)', borderRadius: 12, padding: 14,
                        border: '1px solid var(--border-light)',
                      }}>
                        {/* Store header + status */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>
                            🏪 {store.name}
                          </span>
                          <WhsTag whs={store.work_hour_system} />
                          <GapChip gap={gap} loading={isLoading} />
                        </div>

                        {/* Timeline row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          {/* Last scheduled date */}
                          <div style={{ textAlign: 'center', minWidth: 90 }}>
                            <div style={timelineLabel}>上次排班結束</div>
                            <div style={{
                              fontWeight: 700, fontSize: 13,
                              color: lastDate ? 'var(--text-primary)' : 'var(--text-muted)',
                            }}>
                              {isLoading ? '…' : (lastDate || '尚無記錄')}
                            </div>
                          </div>

                          <div style={{ color: 'var(--text-muted)', fontSize: 18, fontWeight: 300 }}>→</div>

                          {/* New start — editable */}
                          <div style={{ textAlign: 'center' }}>
                            <div style={timelineLabel}>新排班開始</div>
                            <input
                              type="date"
                              value={effectiveStart}
                              onChange={e => setStoreStartOverrides(prev => ({ ...prev, [store.id]: e.target.value }))}
                              style={{
                                padding: '5px 8px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                                border: storeStartOverrides[store.id]
                                  ? '1px solid var(--accent-cyan)'
                                  : '1px solid var(--border-medium)',
                                background: 'var(--bg-card)', color: 'var(--text-primary)',
                              }}
                            />
                          </div>

                          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>~</div>

                          {/* New end — fixed from period */}
                          <div style={{ textAlign: 'center', minWidth: 90 }}>
                            <div style={timelineLabel}>新排班結束</div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                              {selectedPeriod.end}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                              共 {days} 天
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {!selectedStores.length && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '4px 0' }}>
                請先勾選至少一間門市
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" style={{ padding: '10px 28px' }}
                disabled={!canNext1} onClick={() => setStep(2)}>
                下一步 →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: 員工設定 ── */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                👥 員工假別設定
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                設定各員工本期休假與例假天數
              </div>
            </div>

            {selectedStores.map(store => {
              const emps = storeEmployees[store.id] || []
              const isLoading = loadingSet.has(store.id)
              const range = {
                start: storeStartOverrides[store.id] || selectedPeriod?.start || '',
                end: selectedPeriod?.end || '',
              }

              return (
                <div key={store.id} style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-light)' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
                    background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)',
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>🏪 {store.name}</span>
                    <WhsTag whs={store.work_hour_system} />
                    {range.start && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
                        {range.start} ~ {range.end}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                      {isLoading ? '載入中...' : `${emps.length} 人在職`}
                    </span>
                  </div>

                  {isLoading ? (
                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, background: 'var(--bg-card)' }}>
                      載入員工中...
                    </div>
                  ) : emps.length === 0 ? (
                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, background: 'var(--bg-card)' }}>
                      此門市無在職員工
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: 'var(--bg-card)' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-secondary)' }}>
                          <th style={thStyle}>員工姓名</th>
                          <th style={{ ...thStyle, textAlign: 'center', width: 88, color: 'var(--accent-orange)' }}>休假（天）</th>
                          <th style={{ ...thStyle, textAlign: 'center', width: 88, color: 'var(--accent-red)' }}>例假（天）</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emps.map((emp, ri) => {
                          const key = `${store.id}|${emp.name}`
                          const vals = empRestMap[key] || { 休假: 0, 例假: 0 }
                          return (
                            <tr key={emp.id} style={{ background: ri % 2 !== 0 ? 'rgba(0,0,0,0.025)' : 'transparent' }}>
                              <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-light)' }}>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{emp.name}</div>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{emp.employment_type}</div>
                              </td>
                              <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)', textAlign: 'center' }}>
                                <input type="number" min={0} max={31} value={vals['休假']}
                                  onChange={e => setEmpRest(store.id, emp.name, '休假', e.target.value)}
                                  style={numInputStyle} />
                              </td>
                              <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)', textAlign: 'center' }}>
                                <input type="number" min={0} max={31} value={vals['例假']}
                                  onChange={e => setEmpRest(store.id, emp.name, '例假', e.target.value)}
                                  style={numInputStyle} />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" style={{ padding: '10px 20px' }} onClick={() => setStep(1)}>← 上一步</button>
              <button className="btn btn-primary" style={{ padding: '10px 28px' }} onClick={() => setStep(3)}>下一步 →</button>
            </div>
          </div>
        )}

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

              {/* Per-store range summary */}
              {selectedStores.map(s => {
                const start = storeStartOverrides[s.id] || selectedPeriod?.start
                const end = selectedPeriod?.end
                const lastDate = storeLastDates[s.id]
                const gap = start ? analyzeGap(lastDate, start) : null
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
                  {[...new Set(selectedStores.map(s => s.work_hour_system || '標準工時'))].map(whs => (
                    <WhsTag key={whs} whs={whs} />
                  ))}
                </div>
              </SummaryRow>

              <SummaryRow label="員工總數">
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {selectedStores.reduce((s, store) => s + (storeEmployees[store.id]?.length || 0), 0)} 人
                </span>
              </SummaryRow>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              {(mode === 'manual' || !mode) && (
                <button className="btn btn-primary"
                  style={{ padding: '14px', fontSize: 15, fontWeight: 700, background: 'linear-gradient(135deg, var(--accent-cyan), #3b82f6)' }}
                  onClick={() => handleComplete('manual')}>
                  📋 手動填寫班表 →
                </button>
              )}
              {(mode === 'auto' || !mode) && (
                <button className="btn btn-primary"
                  style={{ padding: '14px', fontSize: 15, fontWeight: 700, background: 'linear-gradient(135deg, var(--accent-red), var(--accent-orange))' }}
                  onClick={() => handleComplete('auto')}>
                  ✨ AI 自動排班 →
                </button>
              )}
            </div>

            <button className="btn btn-secondary" style={{ padding: '10px 20px', alignSelf: 'flex-start' }} onClick={() => setStep(2)}>
              ← 上一步
            </button>
          </div>
        )}
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
const numInputStyle = { width: 54, padding: '5px 4px', textAlign: 'center', borderRadius: 6, border: '1px solid var(--border-medium)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }
const warnBox       = { padding: '8px 12px', borderRadius: 8, fontSize: 11, color: 'var(--accent-orange)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }
