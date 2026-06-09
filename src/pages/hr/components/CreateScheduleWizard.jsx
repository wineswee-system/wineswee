import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { getMonthDates, formatYearMonth, parseYearMonth } from '../../../lib/scheduleUtils'

const WORK_HOUR_SYSTEMS = ['四週變形', '二週變形', '八週變形', '標準工時']
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export default function CreateScheduleWizard({ open, onClose, locations, mode, onComplete }) {
  const [step, setStep] = useState(1)
  const [wizardStore, setWizardStore] = useState('')
  const [wizardStoreId, setWizardStoreId] = useState(null)
  const [wizardMonth, setWizardMonth] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1)
    return formatYearMonth(d.getFullYear(), d.getMonth() + 1)
  })
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [workHourSystem, setWorkHourSystem] = useState('四週變形')

  const [storeSettings, setStoreSettings] = useState(null)
  const [employees, setEmployees] = useState([])
  const [loadingStore, setLoadingStore] = useState(false)

  const [restDays, setRestDays] = useState({})

  // Reset step when wizard opens
  useEffect(() => {
    if (open) { setStep(1); setRestDays({}) }
  }, [open])

  // Reset range when month changes
  useEffect(() => {
    if (!wizardMonth) return
    const { year, month } = parseYearMonth(wizardMonth)
    const dates = getMonthDates(year, month)
    setRangeStart(dates[0])
    setRangeEnd(dates[dates.length - 1])
  }, [wizardMonth])

  // Fetch store data when store selection changes
  useEffect(() => {
    if (!wizardStoreId) { setStoreSettings(null); setEmployees([]); return }
    setLoadingStore(true)
    Promise.all([
      supabase.from('stores').select('*').eq('id', wizardStoreId).single(),
      supabase.from('employees')
        .select('id, name, dept, employment_type, store, store_id')
        .eq('store_id', wizardStoreId)
        .eq('status', '在職')
        .order('name'),
    ]).then(([storeRes, empRes]) => {
      setStoreSettings(storeRes.data)
      setEmployees(empRes.data || [])
      if (storeRes.data?.work_hour_system) setWorkHourSystem(storeRes.data.work_hour_system)
      setLoadingStore(false)
    })
  }, [wizardStoreId])

  const handleStoreChange = (name) => {
    setWizardStore(name)
    const loc = locations.find(l => l.name === name)
    setWizardStoreId(loc?.id || null)
  }

  const rangeDates = (() => {
    if (!rangeStart || !rangeEnd || !wizardMonth) return []
    const { year, month } = parseYearMonth(wizardMonth)
    return getMonthDates(year, month).filter(d => d >= rangeStart && d <= rangeEnd)
  })()

  const toggleRestDay = (empName, date) => {
    const key = `${empName}|${date}`
    setRestDays(prev => {
      const next = { ...prev }
      if (next[key]) delete next[key]
      else next[key] = true
      return next
    })
  }

  const buildRestDayMap = () => {
    const map = {}
    for (const key of Object.keys(restDays)) {
      const pipeIdx = key.lastIndexOf('|')
      const empName = key.slice(0, pipeIdx)
      const date = key.slice(pipeIdx + 1)
      map[`${empName}|${date}`] = { shift: '例假', actual_start: null, actual_end: null }
    }
    return map
  }

  const handleComplete = (actionMode) => {
    onComplete({
      mode: actionMode,
      store: wizardStore,
      storeId: wizardStoreId,
      month: wizardMonth,
      range: { start: rangeStart, end: rangeEnd },
      workHourSystem,
      restDayMap: buildRestDayMap(),
    })
  }

  if (!open) return null

  const canGoNext1 = wizardStore && wizardMonth && rangeStart && rangeEnd

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-strong)',
        borderRadius: 18, padding: 32, width: 600, maxWidth: '95vw', maxHeight: '90vh',
        overflowY: 'auto', boxShadow: '0 32px 80px rgba(0,0,0,0.4)',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              🧙 排班精靈 — {mode === 'auto' ? '自動建立' : '手動建立'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>步驟 {step} / 4</div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-medium)',
            background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16,
          }}>✕</button>
        </div>

        {/* Step progress bar */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 28 }}>
          {['基本設定', '店資訊', '休假設定', '完成'].map((label, i) => {
            const n = i + 1
            return (
              <div key={n} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  height: 4, borderRadius: 4, marginBottom: 6,
                  background: step >= n ? 'var(--accent-cyan)' : 'var(--border-medium)',
                  transition: 'background 0.2s',
                }} />
                <div style={{
                  fontSize: 10, fontWeight: step === n ? 700 : 400,
                  color: step >= n ? 'var(--accent-cyan)' : 'var(--text-muted)',
                }}>{n}. {label}</div>
              </div>
            )
          })}
        </div>

        {/* ── Step 1: 基本設定 ── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label style={labelStyle}>門市 *</label>
              <select className="form-input" value={wizardStore} onChange={e => handleStoreChange(e.target.value)}
                style={inputStyle}>
                <option value="">請選擇門市</option>
                {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
              </select>
            </div>

            <div>
              <label style={labelStyle}>排班月份</label>
              <input type="month" className="form-input" value={wizardMonth} onChange={e => setWizardMonth(e.target.value)}
                style={inputStyle} />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>開始日</label>
                <input type="date" className="form-input" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
                  style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>結束日</label>
                <input type="date" className="form-input" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
                  style={inputStyle} />
              </div>
            </div>

            <div>
              <label style={labelStyle}>工時制度</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {WORK_HOUR_SYSTEMS.map(sys => (
                  <button key={sys} onClick={() => setWorkHourSystem(sys)} style={{
                    padding: '10px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    border: `1px solid ${workHourSystem === sys ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                    background: workHourSystem === sys ? 'rgba(34,211,238,0.12)' : 'var(--bg-card)',
                    color: workHourSystem === sys ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}>{sys}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn btn-primary" style={{ padding: '10px 28px' }}
                disabled={!canGoNext1} onClick={() => setStep(2)}>
                下一步 →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: 確認店資訊 ── */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              🏪 {wizardStore} · {wizardMonth}
            </div>

            {loadingStore && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>載入門市資料...</div>
            )}

            {!loadingStore && storeSettings?.operating_hours && (
              <div style={cardStyle}>
                <div style={cardLabelStyle}>營業時間</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                  {DAY_NAMES.map((d, i) => {
                    const oh = storeSettings.operating_hours[d]
                    const isWeekend = i === 0 || i === 6
                    return (
                      <div key={d} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: isWeekend ? 'var(--accent-orange)' : 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>
                          {DAY_LABELS[i]}
                        </div>
                        {oh ? (
                          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent-cyan)', lineHeight: 1.4 }}>
                            {oh.open}<br />{oh.close}
                          </div>
                        ) : (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>休</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {!loadingStore && (storeSettings?.min_staff || storeSettings?.min_staff_weekend) && (
              <div style={cardStyle}>
                <div style={cardLabelStyle}>最低出勤需求</div>
                <div style={{ display: 'flex', gap: 24 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    平日：<span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{storeSettings.min_staff || '—'} 人</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    假日：<span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{storeSettings.min_staff_weekend || '—'} 人</span>
                  </div>
                </div>
              </div>
            )}

            {!loadingStore && (
              <div style={cardStyle}>
                <div style={cardLabelStyle}>員工名單（{employees.length} 人在職）</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {employees.map(e => (
                    <div key={e.id} style={{
                      padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      background: e.employment_type === '全職' ? 'rgba(34,211,238,0.12)' : 'rgba(139,92,246,0.10)',
                      color: e.employment_type === '全職' ? 'var(--accent-cyan)' : 'var(--accent-purple)',
                      border: `1px solid ${e.employment_type === '全職' ? 'rgba(34,211,238,0.3)' : 'rgba(139,92,246,0.25)'}`,
                    }}>
                      {e.name} <span style={{ opacity: 0.65, fontSize: 10 }}>{e.employment_type}</span>
                    </div>
                  ))}
                  {employees.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>此門市無在職員工</div>}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ padding: '10px 20px' }} onClick={() => setStep(1)}>← 上一步</button>
              <button className="btn btn-primary" style={{ padding: '10px 28px' }} onClick={() => setStep(3)}>下一步 →</button>
            </div>
          </div>
        )}

        {/* ── Step 3: 休假設定 ── */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                🌙 休假設定
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                點選格子標記該員工的休假日 · {rangeStart} ~ {rangeEnd}
              </div>
            </div>

            {employees.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>此門市無在職員工</div>
            ) : (
              <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border-light)' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: '100%' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)' }}>
                      <th style={{
                        position: 'sticky', left: 0, background: 'var(--bg-secondary)',
                        padding: '8px 12px', textAlign: 'left', fontWeight: 700,
                        color: 'var(--text-muted)', borderBottom: '1px solid var(--border-medium)',
                        zIndex: 2, minWidth: 72,
                      }}>員工</th>
                      {rangeDates.map(date => {
                        const dow = new Date(date).getDay()
                        const isWeekend = dow === 0 || dow === 6
                        return (
                          <th key={date} style={{
                            padding: '6px 3px', textAlign: 'center', fontSize: 10, minWidth: 28,
                            color: isWeekend ? 'var(--accent-orange)' : 'var(--text-muted)',
                            borderBottom: '1px solid var(--border-medium)',
                          }}>
                            <div style={{ fontWeight: 700 }}>{date.slice(8)}</div>
                            <div>{DAY_LABELS[dow]}</div>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp, ri) => (
                      <tr key={emp.id}>
                        <td style={{
                          position: 'sticky', left: 0, zIndex: 1,
                          background: ri % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                          padding: '4px 12px', fontWeight: 600, color: 'var(--text-primary)',
                          borderBottom: '1px solid var(--border-light)', whiteSpace: 'nowrap',
                        }}>{emp.name}</td>
                        {rangeDates.map(date => {
                          const key = `${emp.name}|${date}`
                          const isRest = !!restDays[key]
                          const dow = new Date(date).getDay()
                          const isWeekend = dow === 0 || dow === 6
                          return (
                            <td key={date} onClick={() => toggleRestDay(emp.name, date)} style={{
                              padding: '3px', borderBottom: '1px solid var(--border-light)',
                              textAlign: 'center', cursor: 'pointer',
                              background: ri % 2 !== 0 ? 'var(--bg-secondary)' : 'var(--bg-card)',
                            }}>
                              <div style={{
                                width: 24, height: 24, margin: '0 auto', borderRadius: 5, fontSize: 10,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontWeight: 700, transition: 'all 0.15s',
                                background: isRest ? 'var(--accent-red)' : isWeekend ? 'rgba(245,158,11,0.1)' : 'transparent',
                                color: isRest ? '#fff' : isWeekend ? 'var(--accent-orange)' : 'var(--border-medium)',
                                border: isRest ? 'none' : '1px solid var(--border-light)',
                              }}>
                                {isRest ? '休' : '·'}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              已標記 <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{Object.keys(restDays).length}</span> 個休假日
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn btn-secondary" style={{ padding: '10px 20px' }} onClick={() => setStep(2)}>← 上一步</button>
              <button className="btn btn-primary" style={{ padding: '10px 28px' }} onClick={() => setStep(4)}>下一步 →</button>
            </div>
          </div>
        )}

        {/* ── Step 4: 完成 ── */}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>✅ 準備好了！</div>

            <div style={{ ...cardStyle, gap: 10, display: 'flex', flexDirection: 'column' }}>
              {[
                { label: '門市', value: wizardStore },
                { label: '月份', value: wizardMonth },
                { label: '日期範圍', value: `${rangeStart} ~ ${rangeEnd}（${rangeDates.length} 天）` },
                { label: '工時制度', value: workHourSystem },
                { label: '員工人數', value: `${employees.length} 人` },
                { label: '休假日已設定', value: `${Object.keys(restDays).length} 個` },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{r.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{r.value}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              {(mode === 'manual' || !mode) && (
                <button
                  className="btn btn-primary"
                  style={{ padding: '14px', fontSize: 15, fontWeight: 700, background: 'linear-gradient(135deg, var(--accent-cyan), #3b82f6)' }}
                  onClick={() => handleComplete('manual')}
                >
                  📋 手動填寫班表 →
                </button>
              )}
              {(mode === 'auto' || !mode) && (
                <button
                  className="btn btn-primary"
                  style={{ padding: '14px', fontSize: 15, fontWeight: 700, background: 'linear-gradient(135deg, var(--accent-red), var(--accent-orange))' }}
                  onClick={() => handleComplete('auto')}
                >
                  ✨ AI 自動排班 →
                </button>
              )}
            </div>

            <button className="btn btn-secondary" style={{ padding: '10px 20px', alignSelf: 'flex-start' }} onClick={() => setStep(3)}>
              ← 上一步
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }
const inputStyle = { width: '100%', padding: '10px 12px', fontSize: 14 }
const cardStyle = { background: 'var(--bg-secondary)', borderRadius: 12, padding: 16 }
const cardLabelStyle = { fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10 }
