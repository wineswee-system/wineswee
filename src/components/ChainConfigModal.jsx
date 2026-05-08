/**
 * 共用簽核鏈設定 modal
 *
 * 給每張 HR 表單頁面用：請假/加班/出差/費用/離職/異動 都可以呼叫。
 *
 * Props:
 *   open: boolean
 *   onClose: () => void
 *   formType: 'leave' | 'overtime' | 'trip' | 'expense' | 'punch' | 'resignation' | 'transfer' | ...
 *   formLabel: 顯示用的中文 ('請假' / '加班' / ...)
 *   organizationId: number
 *
 * 邏輯：
 *   1. 開啟時讀 form_chain_configs(form_type, org) → 取 chain_id → 讀 chain + steps
 *   2. 編輯：加 / 減 / 排序 / 改每關 target_type + targets
 *   3. 存：刪掉舊 chain steps → 寫新的 → upsert form_chain_configs
 */

import { useState, useEffect, useCallback } from 'react'
import { X, Plus, ArrowUp, ArrowDown, Trash2, Save, AlertCircle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ModalOverlay } from './Modal'
import LoadingSpinner from './LoadingSpinner'
import SearchableSelect, { empOptions } from './SearchableSelect'

// ─── target_type 選項（9 種，砍了 applicant_supervisor 因為組織圖夠用）───
const TARGET_TYPES = [
  // 寫死
  { value: 'fixed_emp',   group: '🔒 寫死指定', label: '指定員工',           needs: 'emp'   },
  { value: 'fixed_role',  group: '🔒 寫死指定', label: '指定角色（全部人）', needs: 'role'  },
  { value: 'fixed_dept',  group: '🔒 寫死指定', label: '指定部門（全部人）', needs: 'dept'  },
  // 申請人連動（依組織圖動態解）
  { value: 'applicant_dept_manager',        group: '👤 申請人連動', label: '申請人部門的主管',   needs: null },
  { value: 'applicant_store_manager',       group: '👤 申請人連動', label: '申請人門市的店長',   needs: null },
  { value: 'applicant_section_supervisor',  group: '👤 申請人連動', label: '申請人課別的督導',   needs: null },
  // 特定單位的主管
  { value: 'specific_dept_manager',         group: '🏢 指定單位主管', label: '特定部門的主管',   needs: 'dept'    },
  { value: 'specific_store_manager',        group: '🏢 指定單位主管', label: '特定門市的店長',   needs: 'store'   },
  { value: 'specific_section_supervisor',   group: '🏢 指定單位主管', label: '特定課別的督導',   needs: 'section' },
]

const TARGET_TYPE_DESC = Object.fromEntries(TARGET_TYPES.map(t => [t.value, t.label]))

const blankStep = (idx) => ({
  // 本地 id 用 negative 區分新建 vs 已存在
  _localId: Math.random(),
  step_order: idx,
  label: '',
  target_type: 'applicant_dept_manager',
  target_emp_id: null,
  target_role_id: null,
  target_dept_id: null,
  target_store_id: null,
  target_section_id: null,
})

export default function ChainConfigModal({ open, onClose, formType, formLabel, organizationId }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [chainId, setChainId] = useState(null)
  const [chainName, setChainName] = useState('')
  const [steps, setSteps] = useState([])

  // 選項
  const [employees, setEmployees] = useState([])
  const [roles, setRoles] = useState([])
  const [depts, setDepts] = useState([])
  const [stores, setStores] = useState([])
  const [sections, setSections] = useState([])

  const load = useCallback(async () => {
    if (!open) return
    setLoading(true)
    // 抓所有選項
    const [empRes, roleRes, deptRes, storeRes, sectionRes, configRes] = await Promise.all([
      supabase.from('employees')
        .select('id, name, name_en, employee_number, status, position, dept, store, departments!department_id(name), stores!store_id(name)')
        .eq('organization_id', organizationId).eq('status', '在職').order('name'),
      supabase.from('roles').select('id, name').order('name'),
      supabase.from('departments').select('id, name').eq('organization_id', organizationId).order('name'),
      supabase.from('stores').select('id, name').eq('organization_id', organizationId).order('name'),
      supabase.from('department_sections').select('id, name, department_id').eq('organization_id', organizationId).order('name'),
      supabase.from('form_chain_configs').select('chain_id, notes')
        .eq('form_type', formType).eq('organization_id', organizationId).maybeSingle(),
    ])
    setEmployees(empRes.data || [])
    setRoles(roleRes.data || [])
    setDepts(deptRes.data || [])
    setStores(storeRes.data || [])
    setSections(sectionRes.data || [])

    if (configRes.data?.chain_id) {
      // 已有 chain → 載入 steps
      const cid = configRes.data.chain_id
      const [chainRes, stepsRes] = await Promise.all([
        supabase.from('approval_chains').select('name').eq('id', cid).maybeSingle(),
        supabase.from('approval_chain_steps').select('*').eq('chain_id', cid).order('step_order'),
      ])
      setChainId(cid)
      setChainName(chainRes.data?.name || '')
      setSteps((stepsRes.data || []).map(s => ({
        _localId: s.id,
        step_order: s.step_order,
        label: s.label || '',
        target_type: s.target_type || 'applicant_dept_manager',
        target_emp_id: s.target_emp_id || null,
        target_role_id: s.target_role_id || null,
        target_dept_id: s.target_dept_id || null,
        target_store_id: s.target_store_id || null,
        target_section_id: s.target_section_id || null,
      })))
    } else {
      setChainId(null)
      setChainName(`${formLabel}簽核鏈`)
      setSteps([blankStep(0)])
    }
    setLoading(false)
  }, [open, formType, formLabel, organizationId])

  useEffect(() => { load() }, [load])

  // ── step 操作 ──
  const updateStep = (idx, patch) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }
  const addStep = () => {
    setSteps(prev => [...prev, blankStep(prev.length)])
  }
  const removeStep = (idx) => {
    if (steps.length === 1) { alert('至少要保留 1 關'); return }
    setSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_order: i })))
  }
  const moveStep = (idx, dir) => {
    const ni = idx + dir
    if (ni < 0 || ni >= steps.length) return
    setSteps(prev => {
      const next = [...prev]
      ;[next[idx], next[ni]] = [next[ni], next[idx]]
      return next.map((s, i) => ({ ...s, step_order: i }))
    })
  }

  // 改 target_type 時清掉不相關的 target_*_id
  const changeTargetType = (idx, newType) => {
    const meta = TARGET_TYPES.find(t => t.value === newType)
    const patch = { target_type: newType }
    // 清空所有 targets
    patch.target_emp_id = null
    patch.target_role_id = null
    patch.target_dept_id = null
    patch.target_store_id = null
    patch.target_section_id = null
    updateStep(idx, patch)
  }

  // ── 預覽該關會由誰簽 ──
  const stepPreview = (step) => {
    const meta = TARGET_TYPES.find(t => t.value === step.target_type)
    if (!meta) return { ok: false, text: '未知類型' }
    if (!meta.needs) {
      // 純動態
      return { ok: true, dynamic: true, text: meta.label }
    }
    // 需要選對應對象
    if (meta.needs === 'emp') {
      const e = employees.find(x => x.id === step.target_emp_id)
      return e ? { ok: true, text: `指定員工：${e.name}` }
                : { ok: false, text: '⚠️ 請選擇員工' }
    }
    if (meta.needs === 'role') {
      const r = roles.find(x => x.id === step.target_role_id)
      return r ? { ok: true, text: `角色「${r.name}」全部成員` }
                : { ok: false, text: '⚠️ 請選擇角色' }
    }
    if (meta.needs === 'dept') {
      const d = depts.find(x => x.id === step.target_dept_id)
      if (!d) return { ok: false, text: '⚠️ 請選擇部門' }
      if (step.target_type === 'fixed_dept') return { ok: true, text: `部門「${d.name}」全部員工` }
      return { ok: true, text: `部門「${d.name}」的主管` }
    }
    if (meta.needs === 'store') {
      const s = stores.find(x => x.id === step.target_store_id)
      return s ? { ok: true, text: `門市「${s.name}」的店長` }
                : { ok: false, text: '⚠️ 請選擇門市' }
    }
    if (meta.needs === 'section') {
      const s = sections.find(x => x.id === step.target_section_id)
      return s ? { ok: true, text: `課別「${s.name}」的督導` }
                : { ok: false, text: '⚠️ 請選擇課別' }
    }
    return { ok: false, text: '未設定' }
  }

  // ── 儲存 ──
  const handleSave = async () => {
    // 驗證每關
    const missing = []
    steps.forEach((s, i) => {
      if (!s.label?.trim()) missing.push(`第 ${i+1} 關沒填標籤`)
      const preview = stepPreview(s)
      if (!preview.ok) missing.push(`第 ${i+1} 關：${preview.text}`)
    })
    if (missing.length > 0) {
      alert('有以下問題：\n\n' + missing.join('\n'))
      return
    }

    setSaving(true)
    try {
      let cid = chainId
      // Step A: chain 主表 — 沒有就建
      if (!cid) {
        const { data: newChain, error: chainErr } = await supabase.from('approval_chains').insert({
          name: chainName || `${formLabel}簽核鏈`,
          category: formLabel,
          organization_id: organizationId,
        }).select().single()
        if (chainErr) throw chainErr
        cid = newChain.id
      } else {
        await supabase.from('approval_chains').update({
          name: chainName || `${formLabel}簽核鏈`,
        }).eq('id', cid)
      }

      // Step B: 砍舊 steps（每次重寫）
      await supabase.from('approval_chain_steps').delete().eq('chain_id', cid)

      // Step C: 寫新 steps
      const stepRows = steps.map((s, i) => ({
        chain_id: cid,
        step_order: i,
        label: s.label.trim(),
        role_name: s.label.trim(),  // 沿用既有欄位
        target_type: s.target_type,
        target_emp_id: s.target_emp_id || null,
        target_role_id: s.target_role_id || null,
        target_dept_id: s.target_dept_id || null,
        target_store_id: s.target_store_id || null,
        target_section_id: s.target_section_id || null,
        organization_id: organizationId,
      }))
      const { error: stepsErr } = await supabase.from('approval_chain_steps').insert(stepRows)
      if (stepsErr) throw stepsErr

      // Step D: upsert form_chain_configs
      const { error: cfgErr } = await supabase.from('form_chain_configs').upsert({
        form_type: formType,
        organization_id: organizationId,
        chain_id: cid,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'form_type,organization_id' })
      if (cfgErr) throw cfgErr

      alert(`「${formLabel}」簽核鏈已儲存（${steps.length} 關）`)
      onClose()
    } catch (err) {
      console.error('save chain failed:', err)
      alert('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <ModalOverlay onClose={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-card)', borderRadius: 12, width: 'min(800px, 96vw)',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        border: '1px solid var(--border-medium)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>⚙️ 簽核鏈設定 — {formLabel}</h3>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>設定這張表的簽核流程，可串多關 + 動態目標（套牢組織圖）</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <X size={22} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 22 }}>
          {loading ? <LoadingSpinner /> : (
            <>
              {/* Chain name */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>簽核鏈名稱</label>
                <input className="form-input" style={{ width: '100%' }}
                  value={chainName} onChange={e => setChainName(e.target.value)}
                  placeholder={`例：${formLabel}簽核鏈`} />
              </div>

              {/* Steps */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* 申請人 cell（固定，不能改） */}
                <div style={{ padding: 12, background: 'var(--accent-cyan-dim)', border: '1px solid var(--accent-cyan-dim)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-cyan)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                    👤
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>申請人</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>送出表單者，自動帶</div>
                  </div>
                </div>

                {steps.map((step, idx) => {
                  const meta = TARGET_TYPES.find(t => t.value === step.target_type)
                  const preview = stepPreview(step)
                  return (
                    <div key={step._localId} style={{
                      padding: 14, background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-medium)', borderRadius: 10,
                    }}>
                      {/* Top row: step badge + 排序 + 刪除 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-purple)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                          {idx + 1}
                        </div>
                        <input className="form-input" style={{ flex: 1, fontWeight: 600 }}
                          placeholder={`第 ${idx + 1} 關標籤（例：直屬主管 / 部門經理 / 人資審核）`}
                          value={step.label} onChange={e => updateStep(idx, { label: e.target.value })} />
                        <button title="上移" disabled={idx === 0}
                          onClick={() => moveStep(idx, -1)}
                          style={{ background: 'transparent', border: '1px solid var(--border-medium)', borderRadius: 6, padding: 4, cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.4 : 1 }}>
                          <ArrowUp size={14} />
                        </button>
                        <button title="下移" disabled={idx === steps.length - 1}
                          onClick={() => moveStep(idx, 1)}
                          style={{ background: 'transparent', border: '1px solid var(--border-medium)', borderRadius: 6, padding: 4, cursor: idx === steps.length - 1 ? 'not-allowed' : 'pointer', opacity: idx === steps.length - 1 ? 0.4 : 1 }}>
                          <ArrowDown size={14} />
                        </button>
                        <button title="刪除" onClick={() => removeStep(idx)}
                          style={{ background: 'transparent', border: '1px solid var(--accent-red-dim)', borderRadius: 6, padding: 4, cursor: 'pointer', color: 'var(--accent-red)' }}>
                          <Trash2 size={14} />
                        </button>
                      </div>

                      {/* Target type selector */}
                      <div style={{ marginBottom: 10 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>簽核者類型</label>
                        <select className="form-input" style={{ width: '100%' }}
                          value={step.target_type}
                          onChange={e => changeTargetType(idx, e.target.value)}>
                          {Array.from(new Set(TARGET_TYPES.map(t => t.group))).map(g => (
                            <optgroup key={g} label={g}>
                              {TARGET_TYPES.filter(t => t.group === g).map(t => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>

                      {/* Target picker (依 needs 顯示) */}
                      {meta?.needs === 'emp' && (
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>選擇員工</label>
                          <SearchableSelect
                            value={step.target_emp_id || ''}
                            options={empOptions(employees)}
                            onChange={v => updateStep(idx, { target_emp_id: v ? Number(v) : null })}
                            placeholder="搜尋員工..."
                          />
                        </div>
                      )}
                      {meta?.needs === 'role' && (
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>選擇角色</label>
                          <select className="form-input" style={{ width: '100%' }}
                            value={step.target_role_id || ''}
                            onChange={e => updateStep(idx, { target_role_id: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">— 選擇角色 —</option>
                            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </div>
                      )}
                      {meta?.needs === 'dept' && (
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>選擇部門</label>
                          <select className="form-input" style={{ width: '100%' }}
                            value={step.target_dept_id || ''}
                            onChange={e => updateStep(idx, { target_dept_id: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">— 選擇部門 —</option>
                            {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </div>
                      )}
                      {meta?.needs === 'store' && (
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>選擇門市</label>
                          <select className="form-input" style={{ width: '100%' }}
                            value={step.target_store_id || ''}
                            onChange={e => updateStep(idx, { target_store_id: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">— 選擇門市 —</option>
                            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                      )}
                      {meta?.needs === 'section' && (
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>選擇課別</label>
                          <select className="form-input" style={{ width: '100%' }}
                            value={step.target_section_id || ''}
                            onChange={e => updateStep(idx, { target_section_id: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">— 選擇課別 —</option>
                            {sections.map(sec => {
                              const dept = depts.find(d => d.id === sec.department_id)
                              return <option key={sec.id} value={sec.id}>{sec.name}{dept ? `（${dept.name}）` : ''}</option>
                            })}
                          </select>
                        </div>
                      )}

                      {/* Preview */}
                      <div style={{
                        padding: '8px 12px', borderRadius: 6,
                        background: preview.ok ? 'var(--accent-green-dim)' : 'var(--accent-orange-dim)',
                        color: preview.ok ? 'var(--accent-green)' : 'var(--accent-orange)',
                        fontSize: 12, fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        {preview.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                        本關會由：{preview.text}
                        {preview.dynamic && <span style={{ fontSize: 10, marginLeft: 6, padding: '1px 6px', borderRadius: 3, background: 'rgba(255,255,255,0.4)' }}>動態</span>}
                      </div>
                    </div>
                  )
                })}

                <button onClick={addStep} style={{
                  padding: '12px', borderRadius: 8,
                  border: '2px dashed var(--border-medium)', background: 'transparent',
                  color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  <Plus size={14} /> 新增關卡
                </button>

                {/* 終點 */}
                <div style={{ padding: 12, background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green-dim)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-green)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                    ✅
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>簽核完成</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>所有關卡通過後通知申請人</div>
                  </div>
                </div>
              </div>

              {/* 提示 */}
              <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--bg-tertiary)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                💡 <b>動態目標</b>：每次申請才會解析（例：申請人直屬主管會依申請人 reporting_to 動態決定）<br/>
                💡 <b>解不到簽核者</b>：表示組織圖未設好（例：員工未設 reporting_to）→ 申請會卡住，請先到員工資料補
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading || saving}>
            <Save size={14} /> {saving ? '儲存中...' : '儲存簽核鏈'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
