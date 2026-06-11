import { useState, useEffect, useMemo } from 'react'
import { Settings, RefreshCw, Lock, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import AsyncButton from '../../components/AsyncButton'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

// 固定 3 種角色（DB role_config 還沒建也能正常下拉）
const ROLE_OPTIONS = ['店長', '正職', '兼職']

/**
 * 門市業績獎金 — 月度計算與結算
 *
 * 流程：
 *   1. 選店 + 月份 → 開單（initialize_store_bonus）自動拉在職員工
 *   2. 輸入 損益兩平 / 目標 / 本月業績 + 每人 缺失/小過/記功/補卡/前月補發
 *   3. 「重算」 → 顯示 損益獎金 / 達標 / 記功 / 稽核扣 / 補卡扣 / 應發
 *   4. 「結算發放」 → finalize（鎖定）
 */
export default function StoreBonus() {
  const { profile, hasPermission } = useAuth()
  const canCompute = hasPermission('bonus.store.compute')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [stores, setStores] = useState([])
  const [storeId, setStoreId] = useState('')
  const today = new Date()
  const [yearMonth, setYearMonth] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)

  const [monthly, setMonthly] = useState(null)
  const [employees, setEmployees] = useState([])
  const [roleConfig, setRoleConfig] = useState([])
  const [showConfig, setShowConfig] = useState(false)

  // 載入門市清單 + role config
  useEffect(() => {
    const orgId = profile?.organization_id
    if (!orgId) return
    Promise.all([
      supabase.from('stores').select('id, name').eq('organization_id', orgId).order('name'),
      supabase.from('store_bonus_role_config').select('*').eq('organization_id', orgId).order('weight', { ascending: false }),
    ]).then(([s, c]) => {
      setStores(s.data || [])
      setRoleConfig(c.data || [])
      setLoading(false)
    })
  }, [profile?.organization_id])

  // 載入當前選擇的店 + 月度
  const loadMonthly = async () => {
    if (!storeId || !yearMonth) return
    const { data: m } = await supabase.from('store_bonus_monthly')
      .select('*')
      .eq('store_id', Number(storeId))
      .eq('year_month', yearMonth)
      .maybeSingle()
    setMonthly(m || null)
    if (m) {
      const { data: emps } = await supabase.from('store_bonus_employee')
        .select('*')
        .eq('monthly_id', m.id)
        .order('id')
      setEmployees(emps || [])
    } else {
      setEmployees([])
    }
  }
  useEffect(() => { loadMonthly() }, [storeId, yearMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  const isFinalized = monthly?.status === 'finalized'

  const handleInitialize = async () => {
    if (!storeId) { toast.warning('請選門市'); return }
    setSaving(true)
    const { data, error } = await supabase.rpc('initialize_store_bonus', {
      p_store_id: Number(storeId),
      p_year_month: yearMonth,
    })
    setSaving(false)
    if (error) { toast.error('開單失敗：' + error.message); return }
    toast.success('已開單，拉入該店在職員工')
    loadMonthly()
  }

  const handleSaveMonthly = async (patch) => {
    if (!monthly?.id) return
    setSaving(true)
    const { error } = await supabase.from('store_bonus_monthly').update(patch).eq('id', monthly.id)
    setSaving(false)
    if (error) { toast.error('儲存失敗：' + error.message); return }
    setMonthly(m => ({ ...m, ...patch }))
  }

  const handleEmpFieldChange = (empId, field, value) => {
    setEmployees(prev => prev.map(e => e.id === empId ? { ...e, [field]: value } : e))
  }

  const handleSaveEmp = async (emp) => {
    setSaving(true)
    const patch = {
      role:                   emp.role,
      merit_count:            Number(emp.merit_count) || 0,
      absence_count:          Number(emp.absence_count) || 0,
      minor_offense_count:    Number(emp.minor_offense_count) || 0,
      punch_correction_count: Number(emp.punch_correction_count) || 0,
      prev_month_supplement:  Number(emp.prev_month_supplement) || 0,
      notes:                  emp.notes || null,
    }
    // role 改了的話 weight 也要更新
    const cfg = roleConfig.find(c => c.role === emp.role)
    if (cfg) patch.weight = cfg.weight
    const { error } = await supabase.from('store_bonus_employee').update(patch).eq('id', emp.id)
    setSaving(false)
    if (error) { toast.error(`儲存 ${emp.employee_name} 失敗：${error.message}`); return }
  }

  const handleSyncPunchCounts = async () => {
    if (!monthly?.id) return
    setSaving(true)
    const { data, error } = await supabase.rpc('sync_store_bonus_punch_counts', {
      p_monthly_id: monthly.id,
    })
    setSaving(false)
    if (error) { toast.error('同步失敗：' + error.message); return }
    if (!data?.ok) { toast.error(`同步失敗：${data?.error || 'unknown'}`); return }
    if (data.updated === 0) {
      toast.success('已是最新（沒人補卡次數變動）')
    } else {
      toast.success(`已同步 ${data.updated} 人補卡次數，已重算扣項`)
    }
    loadMonthly()
  }

  const handleRecalculate = async () => {
    if (!monthly?.id) return
    setSaving(true)
    // 先把所有 unsaved 改動 patch 到 DB
    for (const emp of employees) {
      await handleSaveEmp(emp)
    }
    const { error } = await supabase.rpc('recalculate_store_bonus', { p_monthly_id: monthly.id })
    setSaving(false)
    if (error) { toast.error('重算失敗：' + error.message); return }
    toast.success('重算完成')
    loadMonthly()
  }

  const handleFinalize = async () => {
    if (!monthly?.id) return
    if (!(await confirm({ message: '結算後不可修改。確定發放？' }))) return
    setSaving(true)
    // 先 save 所有 row 再 recalculate 再 finalize
    for (const emp of employees) await handleSaveEmp(emp)
    const { error: ferr } = await supabase.rpc('finalize_store_bonus', {
      p_monthly_id: monthly.id,
      p_finalizer_emp_id: profile?.id || null,
    })
    setSaving(false)
    if (ferr) { toast.error('結算失敗：' + ferr.message); return }
    toast.success('已結算發放')
    loadMonthly()
  }

  const totals = useMemo(() => ({
    profit: employees.reduce((s, e) => s + Number(e.profit_bonus || 0), 0),
    target: employees.reduce((s, e) => s + Number(e.target_bonus || 0), 0),
    merit:  employees.reduce((s, e) => s + Number(e.merit_bonus || 0), 0),
    audit:  employees.reduce((s, e) => s + Number(e.audit_deduction || 0), 0),
    punch:  employees.reduce((s, e) => s + Number(e.punch_deduction || 0), 0),
    suppl:  employees.reduce((s, e) => s + Number(e.prev_month_supplement || 0), 0),
    net:    employees.reduce((s, e) => s + Number(e.net_bonus || 0), 0),
  }), [employees])

  if (loading) return <LoadingSpinner />

  if (!canCompute) {
    return (
      <div className="fade-in" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
        <h3 style={{ margin: 0 }}>無權存取</h3>
        <p>門市業績獎金需要 <code>bonus.store.compute</code> 權限，請聯絡 admin。</p>
      </div>
    )
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>門市業績獎金</h2>
            <p>選店 + 月份 → 輸入業績與扣項 → 重算 → 結算發放</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setShowConfig(true)}>
              <Settings size={14} /> 角色 / 扣項設定
            </button>
          </div>
        </div>
      </div>

      {/* 選擇區 */}
      <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label className="form-label">門市</label>
          <select className="form-input" value={storeId} onChange={e => setStoreId(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">— 選擇門市 —</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">月份</label>
          <input className="form-input" type="month" value={yearMonth} onChange={e => setYearMonth(e.target.value)} />
        </div>
        {storeId && yearMonth && !monthly && (
          <AsyncButton className="btn btn-primary" onClick={handleInitialize} busyLabel="開單中…">
            <Plus size={14} /> 開單
          </AsyncButton>
        )}
        {monthly && (
          <span style={{
            padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            background: isFinalized ? 'var(--accent-green-dim)' : 'var(--accent-orange-dim)',
            color: isFinalized ? 'var(--accent-green)' : 'var(--accent-orange)',
          }}>
            {isFinalized ? '已結算' : '草稿中'}
          </span>
        )}
      </div>

      {/* 門市層輸入 */}
      {monthly && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            <Field label="損益兩平">
              <input className="form-input" type="number" disabled={isFinalized}
                value={monthly.breakeven}
                onChange={e => setMonthly(m => ({ ...m, breakeven: e.target.value }))}
                onBlur={e => handleSaveMonthly({ breakeven: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="目標">
              <input className="form-input" type="number" disabled={isFinalized}
                value={monthly.target_revenue}
                onChange={e => setMonthly(m => ({ ...m, target_revenue: e.target.value }))}
                onBlur={e => handleSaveMonthly({ target_revenue: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="本月業績">
              <input className="form-input" type="number" disabled={isFinalized}
                value={monthly.actual_revenue}
                onChange={e => setMonthly(m => ({ ...m, actual_revenue: e.target.value }))}
                onBlur={e => handleSaveMonthly({ actual_revenue: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="獎勵 %">
              <input className="form-input" type="number" step="0.001" disabled={isFinalized}
                value={monthly.reward_pct}
                onChange={e => setMonthly(m => ({ ...m, reward_pct: e.target.value }))}
                onBlur={e => handleSaveMonthly({ reward_pct: Number(e.target.value) || 0.02 })} />
            </Field>
            <Field label="獎金池">
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-cyan)', padding: '8px 0' }}>
                NT$ {Number(monthly.bonus_pool).toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                損益超額 {Math.max(0, Number(monthly.actual_revenue) - Number(monthly.breakeven)).toLocaleString()} × {(Number(monthly.reward_pct) * 100).toFixed(1)}%
              </div>
            </Field>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            <span>{monthly.is_target_achieved ? '✅ 達標（正職可領達標獎金）' : '⚠️ 未達標'}</span>
            <span>·</span>
            <span>總權重：{Number(monthly.total_weight).toFixed(2)}</span>
            <div style={{ flex: 1 }} />
            {!isFinalized && (
              <>
                <AsyncButton className="btn btn-secondary" onClick={handleSyncPunchCounts} busyLabel="同步中…" disabled={saving} title="從 clock_corrections 自動填補卡次數">
                  <RefreshCw size={14} /> 同步補卡次數
                </AsyncButton>
                <AsyncButton className="btn btn-secondary" onClick={handleRecalculate} busyLabel="重算中…" disabled={saving}>
                  <RefreshCw size={14} /> 重算
                </AsyncButton>
                <AsyncButton className="btn btn-primary" onClick={handleFinalize} busyLabel="結算中…" disabled={saving}>
                  <Lock size={14} /> 結算發放
                </AsyncButton>
              </>
            )}
          </div>
        </div>
      )}

      {/* 員工表 */}
      {monthly && employees.length > 0 && (
        <div className="card">
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>角色</th>
                  <th>權重</th>
                  <th>個人比</th>
                  <th>損益獎金</th>
                  <th>達標</th>
                  <th>記功次</th>
                  <th>記功獎金</th>
                  <th>缺失</th>
                  <th>小過</th>
                  <th>補卡次</th>
                  <th>稽核扣</th>
                  <th>補卡扣</th>
                  <th>前月補發</th>
                  <th>應發</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(e => (
                  <tr key={e.id}>
                    <td><b>{e.employee_name}</b></td>
                    <td>
                      <select className="form-input" disabled={isFinalized}
                        value={e.role}
                        onChange={ev => handleEmpFieldChange(e.id, 'role', ev.target.value)}
                        style={{ width: 80, padding: 4, fontSize: 12 }}>
                        {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right' }}>{Number(e.weight).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(e.weight_ratio).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(e.profit_bonus).toLocaleString()}</td>
                    <td style={{ textAlign: 'right', color: 'var(--accent-green)' }}>
                      {e.target_bonus > 0 ? Number(e.target_bonus).toLocaleString() : '—'}
                    </td>
                    <td>
                      <Input n disabled={isFinalized} value={e.merit_count}
                        onChange={v => handleEmpFieldChange(e.id, 'merit_count', v)} />
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--accent-green)' }}>
                      {e.merit_bonus > 0 ? Number(e.merit_bonus).toLocaleString() : '—'}
                    </td>
                    <td>
                      <Input n disabled={isFinalized} value={e.absence_count}
                        onChange={v => handleEmpFieldChange(e.id, 'absence_count', v)} />
                    </td>
                    <td>
                      <Input n disabled={isFinalized} value={e.minor_offense_count}
                        onChange={v => handleEmpFieldChange(e.id, 'minor_offense_count', v)} />
                    </td>
                    <td>
                      <Input n disabled={isFinalized} value={e.punch_correction_count}
                        onChange={v => handleEmpFieldChange(e.id, 'punch_correction_count', v)} />
                    </td>
                    <td style={{ textAlign: 'right', color: e.audit_deduction < 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                      {e.audit_deduction < 0 ? `(${Math.abs(e.audit_deduction).toLocaleString()})` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: e.punch_deduction < 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                      {e.punch_deduction < 0 ? `(${Math.abs(e.punch_deduction).toLocaleString()})` : '—'}
                    </td>
                    <td>
                      <Input n disabled={isFinalized} value={e.prev_month_supplement}
                        onChange={v => handleEmpFieldChange(e.id, 'prev_month_supplement', v)} step="100" />
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                      {Number(e.net_bonus).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg-secondary)', fontWeight: 700 }}>
                  <td colSpan={4} style={{ textAlign: 'right' }}>合計</td>
                  <td style={{ textAlign: 'right' }}>{totals.profit.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{totals.target.toLocaleString()}</td>
                  <td></td>
                  <td style={{ textAlign: 'right' }}>{totals.merit.toLocaleString()}</td>
                  <td colSpan={3}></td>
                  <td style={{ textAlign: 'right', color: 'var(--accent-red)' }}>
                    {totals.audit < 0 ? `(${Math.abs(totals.audit).toLocaleString()})` : 0}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--accent-red)' }}>
                    {totals.punch < 0 ? `(${Math.abs(totals.punch).toLocaleString()})` : 0}
                  </td>
                  <td style={{ textAlign: 'right' }}>{totals.suppl.toLocaleString()}</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--accent-cyan)' }}>
                    {totals.net.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ padding: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            ⓘ 輸入後請按「重算」更新各欄計算結果。「結算發放」鎖定後不可再改。
          </div>
        </div>
      )}

      {/* 角色設定 modal */}
      {showConfig && (
        <RoleConfigModal
          config={roleConfig}
          orgId={profile?.organization_id}
          onClose={() => setShowConfig(false)}
          onSaved={() => {
            supabase.from('store_bonus_role_config').select('*').eq('organization_id', profile?.organization_id).order('weight', { ascending: false })
              .then(({ data }) => setRoleConfig(data || []))
            setShowConfig(false)
          }}
        />
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="form-label" style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, disabled, n, step = '1' }) {
  return (
    <input className="form-input" type="number" step={step} disabled={disabled}
      value={value ?? 0}
      onChange={e => onChange(e.target.value)}
      style={{ width: 56, padding: 4, fontSize: 12, textAlign: 'right' }} />
  )
}

function RoleConfigModal({ config, orgId, onClose, onSaved }) {
  const [rows, setRows] = useState(config)
  const handleSave = async () => {
    for (const r of rows) {
      await supabase.from('store_bonus_role_config').update({
        weight:               Number(r.weight) || 0,
        merit_amount:         Number(r.merit_amount) || 0,
        target_bonus_amount:  Number(r.target_bonus_amount) || 0,
        absence_deduct:       Number(r.absence_deduct) || 0,
        minor_offense_deduct: Number(r.minor_offense_deduct) || 0,
        punch_deduct_start:   Number(r.punch_deduct_start) || 5,
        punch_deduct_amount:  Number(r.punch_deduct_amount) || 0,
      }).eq('id', r.id)
    }
    toast.success('已儲存')
    onSaved()
  }
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ padding: 20, width: 720, maxWidth: '95vw', maxHeight: '85vh', overflow: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>⚙️ 獎金規則設定</h3>
        <div className="data-table-wrapper">
          <table className="data-table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>角色</th><th>權重</th><th>記功獎金/筆</th><th>達標獎金</th>
                <th>缺失扣/筆</th><th>小過扣/筆</th><th>補卡第幾次起扣</th><th>補卡扣/次</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td><b>{r.role}</b></td>
                  <td><Input value={r.weight} step="0.1" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, weight: v } : x))} /></td>
                  <td><Input value={r.merit_amount} step="100" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, merit_amount: v } : x))} /></td>
                  <td><Input value={r.target_bonus_amount} step="100" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, target_bonus_amount: v } : x))} /></td>
                  <td><Input value={r.absence_deduct} step="100" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, absence_deduct: v } : x))} /></td>
                  <td><Input value={r.minor_offense_deduct} step="100" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, minor_offense_deduct: v } : x))} /></td>
                  <td><Input value={r.punch_deduct_start} onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, punch_deduct_start: v } : x))} /></td>
                  <td><Input value={r.punch_deduct_amount} step="50" onChange={v => setRows(rs => rs.map((x, j) => i === j ? { ...x, punch_deduct_amount: v } : x))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave}>儲存</button>
        </div>
      </div>
    </div>
  )
}
