import { useState, useEffect, useMemo } from 'react'
import { Save, Workflow, Clock, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import { LEAVE_TYPES } from '../../lib/leavePolicy'
import { useAuth } from '../../contexts/AuthContext'

// 加班 step 可選值
const OVERTIME_STEP_OPTIONS = [
  { value: 0.25, label: '15 分鐘 (0.25)' },
  { value: 0.5,  label: '30 分鐘 (0.5)'  },
  { value: 1,    label: '1 小時'         },
  { value: 2,    label: '2 小時'         },
]

// 請假 step 對應的可選值（依 unit）
const LEAVE_STEP_OPTIONS = {
  day: [
    { value: 0.5, label: '半天 (0.5)' },
    { value: 1,   label: '整天 (1)'   },
  ],
  hour: [
    { value: 0.5, label: '30 分鐘 (0.5)' },
    { value: 1,   label: '1 小時'        },
    { value: 2,   label: '2 小時'        },
    { value: 4,   label: '4 小時'        },
    { value: 8,   label: '8 小時 (整天)' },
  ],
}

export default function WorkUnitSettings() {
  const { role, hasPermission } = useAuth()
  const canEditRule = role?.name === 'admin' || role?.name === 'super_admin' || hasPermission('schedule.rule_edit')
  const [stores, setStores] = useState([])
  const [leaveSettings, setLeaveSettings] = useState([])  // [{store_id, leave_code, step, unit}]
  const [selectedStoreId, setSelectedStoreId] = useState('all')  // 'all' = 全公司
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [error, setError] = useState(null)

  // 本地 draft（未儲存）
  const [draftOvertimeStep, setDraftOvertimeStep] = useState({})  // {store_id: step}
  const [draftLeaveSteps, setDraftLeaveSteps] = useState({})       // {`${store_id||'all'}.${code}`: {step, unit}}

  const loadAll = () => {
    setLoading(true)
    Promise.all([
      supabase.from('stores').select('id, name, overtime_step_hours').order('id'),
      supabase.from('leave_step_settings').select('*').order('id'),
    ]).then(([s, l]) => {
      setStores(s.data || [])
      setLeaveSettings(l.data || [])
      // 初始化 draft：copy 現值
      const ot = {}
      ;(s.data || []).forEach(st => { ot[st.id] = Number(st.overtime_step_hours) || 0.5 })
      setDraftOvertimeStep(ot)

      const ls = {}
      ;(l.data || []).forEach(ll => {
        const k = `${ll.store_id || 'all'}.${ll.leave_code}`
        ls[k] = { step: Number(ll.step), unit: ll.unit }
      })
      setDraftLeaveSteps(ls)
    }).catch(err => {
      console.error(err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }

  useEffect(() => { loadAll() }, [])

  // 取目前 effective leave step（先看當前 store，沒設 fallback 全公司，再 fallback 內建）
  const getEffectiveLeaveStep = (code) => {
    const lt = LEAVE_TYPES.find(x => x.code === code)
    const defaultUnit = lt?.unit || 'day'
    const defaultStep = lt?.minUnit || (defaultUnit === 'day' ? 0.5 : 1)

    if (selectedStoreId !== 'all') {
      const k = `${selectedStoreId}.${code}`
      if (draftLeaveSteps[k]) return draftLeaveSteps[k]
    }
    const allK = `all.${code}`
    if (draftLeaveSteps[allK]) return draftLeaveSteps[allK]
    return { step: defaultStep, unit: defaultUnit, isDefault: true }
  }

  const setLeaveStep = (code, patch) => {
    const k = `${selectedStoreId}.${code}`
    setDraftLeaveSteps(prev => {
      const next = { ...prev }
      const lt = LEAVE_TYPES.find(x => x.code === code)
      const cur = next[k] || { step: lt?.minUnit || 0.5, unit: lt?.unit || 'day' }
      next[k] = { ...cur, ...patch }
      return next
    })
  }

  const removeLeaveOverride = (code) => {
    const k = `${selectedStoreId}.${code}`
    setDraftLeaveSteps(prev => {
      const next = { ...prev }
      delete next[k]
      return next
    })
  }

  // 儲存
  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      // 1. 加班 step：所有 store 的 overtime_step_hours
      const otUpdates = stores.map(s => ({
        id: s.id,
        overtime_step_hours: Number(draftOvertimeStep[s.id]) || 0.5,
      }))
      // 用 individual update 保證安全
      for (const u of otUpdates) {
        const cur = stores.find(s => s.id === u.id)
        if (cur && cur.overtime_step_hours != u.overtime_step_hours) {
          await supabase.from('stores').update({ overtime_step_hours: u.overtime_step_hours }).eq('id', u.id)
        }
      }

      // 2. 請假 step：依 draft 對 leave_step_settings 做 upsert / delete
      // 先把 draft 整理成 (store_id, code, step, unit) 列表
      const draftRows = Object.entries(draftLeaveSteps).map(([k, v]) => {
        const [storeKey, code] = k.split('.')
        return {
          store_id: storeKey === 'all' ? null : Number(storeKey),
          leave_code: code,
          step: v.step,
          unit: v.unit,
        }
      })

      // 找出要刪除的：原本有 row 但 draft 沒有
      const toDelete = leaveSettings.filter(orig => {
        const k = `${orig.store_id || 'all'}.${orig.leave_code}`
        return !draftLeaveSteps[k]
      })
      for (const d of toDelete) {
        await supabase.from('leave_step_settings').delete().eq('id', d.id)
      }

      // upsert draft rows
      if (draftRows.length > 0) {
        const { error: upErr } = await supabase
          .from('leave_step_settings')
          .upsert(draftRows, { onConflict: 'store_id,leave_code', ignoreDuplicates: false })
        if (upErr) throw upErr
      }

      setSavedAt(new Date())
      loadAll()
    } catch (err) {
      console.error(err)
      setError('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Workflow size={20} style={{ color: 'var(--accent-cyan)' }} /> 工時 / 假別最小單位設定
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              廠商可依需求設定加班與請假的最小單位倍數，員工申請時系統會自動依此限制可選值
            </p>
          </div>
          {canEditRule && <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Save size={16} /> {saving ? '儲存中...' : '儲存全部變更'}
          </button>}
        </div>
      </div>

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 16, borderRadius: 8,
          background: 'rgba(248,113,113,0.1)', color: 'var(--accent-red)', fontSize: 13,
        }}>⚠️ {error}</div>
      )}

      {savedAt && (
        <div style={{
          padding: '8px 14px', marginBottom: 16, borderRadius: 8,
          background: 'rgba(52,211,153,0.1)', color: 'var(--accent-green)', fontSize: 13,
        }}>✅ 已儲存（{savedAt.toLocaleTimeString()}）</div>
      )}

      {/* ─── 加班 step ─── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '18px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Clock size={16} style={{ color: 'var(--accent-orange)' }} />
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>加班最小單位（每店設定）</h3>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px' }}>
          設 0.5 → 員工可申請 0.5/1/1.5/2... 小時；設 1 → 只能 1/2/3...；設 0.25 → 0.25/0.5/0.75...
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {stores.map(s => (
            <div key={s.id} style={{
              padding: '10px 14px', border: '1px solid var(--border-subtle)',
              borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
              <select
                className="form-input"
                value={draftOvertimeStep[s.id] ?? 0.5}
                onChange={e => setDraftOvertimeStep(p => ({ ...p, [s.id]: Number(e.target.value) }))}
                style={{ width: 130, fontSize: 12 }}
              >
                {OVERTIME_STEP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* ─── 請假 step ─── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Workflow size={16} style={{ color: 'var(--accent-purple)' }} />
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>請假最小單位（每店每假別）</h3>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px' }}>
          沒設定的假別會 fallback 到「全公司預設」，再 fallback 到內建勞基法預設值
        </p>

        {/* 範圍選擇 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            onClick={() => setSelectedStoreId('all')}
            style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: '1px solid ' + (selectedStoreId === 'all' ? 'var(--accent-cyan)' : 'var(--border-subtle)'),
              background: selectedStoreId === 'all' ? 'rgba(34,211,238,0.1)' : 'transparent',
              color: selectedStoreId === 'all' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            }}
          >全公司預設</button>
          {stores.map(s => (
            <button
              key={s.id}
              onClick={() => setSelectedStoreId(s.id)}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: '1px solid ' + (selectedStoreId === s.id ? 'var(--accent-cyan)' : 'var(--border-subtle)'),
                background: selectedStoreId === s.id ? 'rgba(34,211,238,0.1)' : 'transparent',
                color: selectedStoreId === s.id ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              }}
            >{s.name}</button>
          ))}
        </div>

        {/* 假別表 */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-tertiary)' }}>
                {['假別', '單位類型', '最小單位倍數', '來源', '操作'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LEAVE_TYPES.map(lt => {
                const eff = getEffectiveLeaveStep(lt.code)
                const k = `${selectedStoreId}.${lt.code}`
                const hasOverride = !!draftLeaveSteps[k]
                const stepOpts = LEAVE_STEP_OPTIONS[eff.unit] || LEAVE_STEP_OPTIONS.day
                return (
                  <tr key={lt.code} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                      {lt.shortName}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{lt.name}</div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <select
                        className="form-input"
                        value={eff.unit}
                        onChange={e => setLeaveStep(lt.code, { unit: e.target.value, step: e.target.value === 'day' ? 0.5 : 1 })}
                        style={{ width: 100, fontSize: 12 }}
                      >
                        <option value="day">天</option>
                        {lt.allowHourly !== false && <option value="hour">小時</option>}
                      </select>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <select
                        className="form-input"
                        value={eff.step}
                        onChange={e => setLeaveStep(lt.code, { step: Number(e.target.value) })}
                        style={{ width: 160, fontSize: 12 }}
                      >
                        {stepOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 11 }}>
                      {hasOverride ? (
                        <span style={{
                          padding: '2px 8px', borderRadius: 999, fontWeight: 600,
                          background: 'rgba(34,211,238,0.15)', color: 'var(--accent-cyan)',
                        }}>
                          {selectedStoreId === 'all' ? '全公司覆寫' : '此店覆寫'}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>內建預設</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {hasOverride && (
                        <button
                          onClick={() => removeLeaveOverride(lt.code)}
                          title="清除覆寫，回到預設"
                          style={{ background: 'none', border: 'none', color: 'var(--accent-orange)', cursor: 'pointer', padding: 4 }}
                        ><RotateCcw size={14} /></button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
