import { ArrowUp, ArrowDown, Trash2, Plus, AlertCircle, CheckCircle2 } from 'lucide-react'
import SearchableSelect, { empOptions } from '../SearchableSelect'

// ─── target_type 選項 ───
const TARGET_TYPES = [
  { value: 'fixed_emp',   group: '🔒 寫死指定', label: '指定員工',           needs: 'emp'   },
  { value: 'fixed_role',  group: '🔒 寫死指定', label: '指定角色（全部人）', needs: 'role'  },
  { value: 'fixed_dept',  group: '🔒 寫死指定', label: '指定部門（全部人）', needs: 'dept'  },
  { value: 'applicant_supervisor',          group: '👤 申請人連動', label: '申請人的直屬主管（依員工卡設定）', needs: null },
  { value: 'applicant_dept_manager',        group: '👤 申請人連動', label: '申請人部門的主管',   needs: null },
  { value: 'applicant_store_manager',       group: '👤 申請人連動', label: '申請人門市的店長',   needs: null },
  { value: 'applicant_section_supervisor',  group: '👤 申請人連動', label: '申請人課別的督導',   needs: null },
  { value: 'specific_dept_manager',         group: '🏢 指定單位主管', label: '特定部門的主管',   needs: 'dept'    },
  { value: 'specific_store_manager',        group: '🏢 指定單位主管', label: '特定門市的店長',   needs: 'store'   },
  { value: 'specific_section_supervisor',   group: '🏢 指定單位主管', label: '特定課別的督導',   needs: 'section' },
]

// ── 預覽該關會由誰簽（與 ChainConfigModal.stepPreview 邏輯一致） ──
function computeStepPreview(step, employees, roles, depts, stores, sections) {
  const meta = TARGET_TYPES.find(t => t.value === step.target_type)
  if (!meta) return { ok: false, text: '未知類型' }
  if (!meta.needs) return { ok: true, dynamic: true, text: meta.label }
  if (meta.needs === 'emp') {
    const e = employees.find(x => x.id === step.target_emp_id)
    return e ? { ok: true, text: `指定員工：${e.name}` } : { ok: false, text: '⚠️ 請選擇員工' }
  }
  if (meta.needs === 'role') {
    const r = roles.find(x => x.id === step.target_role_id)
    return r ? { ok: true, text: `角色「${r.name}」全部成員` } : { ok: false, text: '⚠️ 請選擇角色' }
  }
  if (meta.needs === 'dept') {
    const d = depts.find(x => x.id === step.target_dept_id)
    if (!d) return { ok: false, text: '⚠️ 請選擇部門' }
    if (step.target_type === 'fixed_dept') return { ok: true, text: `部門「${d.name}」全部員工` }
    return { ok: true, text: `部門「${d.name}」的主管` }
  }
  if (meta.needs === 'store') {
    const s = stores.find(x => x.id === step.target_store_id)
    return s ? { ok: true, text: `門市「${s.name}」的店長` } : { ok: false, text: '⚠️ 請選擇門市' }
  }
  if (meta.needs === 'section') {
    const s = sections.find(x => x.id === step.target_section_id)
    return s ? { ok: true, text: `課別「${s.name}」的督導` } : { ok: false, text: '⚠️ 請選擇課別' }
  }
  return { ok: false, text: '未設定' }
}

/**
 * ChainEditorView — the chain editor (steps form, step add/edit/delete/reorder).
 *
 * Props:
 *   mode, chainName, setChainName, chainDescription, setChainDescription,
 *   libraryCategory, setLibraryCategory,
 *   minAmount, setMinAmount, maxAmount, setMaxAmount,
 *   steps, updateStep, addStep, removeStep, moveStep, changeTargetType,
 *   employees, roles, depts, stores, sections, formLabel
 *
 * Note: save logic (handleSave) lives in ChainConfigModal; this is pure form UI.
 */
export default function ChainEditorView({
  mode, chainName, setChainName, chainDescription, setChainDescription,
  libraryCategory, setLibraryCategory,
  minAmount, setMinAmount, maxAmount, setMaxAmount,
  steps, updateStep, addStep, removeStep, moveStep, changeTargetType,
  employees, roles, depts, stores, sections, formLabel,
}) {
  return (
    <>
      {/* Chain name + (amount_grouped) amount + (library) category */}
      <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>簽核鏈名稱 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
          <input className="form-input" style={{ width: '100%' }}
            value={chainName} onChange={e => setChainName(e.target.value)}
            placeholder={mode === 'library' ? '例：員工請假簽核 / 採購簽核 / 執行長簽核' : `例：小額${formLabel}`} />
        </div>
        {(mode === 'amount_grouped' || mode === 'library') && (
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>說明（選填）</label>
            <input className="form-input" style={{ width: '100%' }}
              value={chainDescription} onChange={e => setChainDescription(e.target.value)}
              placeholder={mode === 'library' ? '描述這條 chain 的用途或適用情境' : '例：3,000 以下由直屬主管核准'} />
          </div>
        )}
        {mode === 'library' && (
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>分類（選填）</label>
            <input className="form-input" style={{ width: '100%' }}
              value={libraryCategory} onChange={e => setLibraryCategory(e.target.value)}
              placeholder="例：請假 / 採購 / 費用 / 行政 — 用來分組顯示" />
          </div>
        )}
        {mode === 'amount_grouped' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>最低金額（含）</label>
              <input className="form-input" type="number" style={{ width: '100%' }}
                value={minAmount} onChange={e => setMinAmount(e.target.value)}
                placeholder="0（無下限）" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>最高金額（含）</label>
              <input className="form-input" type="number" style={{ width: '100%' }}
                value={maxAmount} onChange={e => setMaxAmount(e.target.value)}
                placeholder="留空 = 無上限" />
            </div>
          </div>
        )}
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* 申請人（固定） */}
        <div style={{ padding: '8px 12px', background: 'var(--accent-cyan-dim)', border: '1px solid var(--accent-cyan-dim)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-cyan)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>👤</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>申請人</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>送出表單者，自動帶</div>
          </div>
        </div>

        {steps.map((step, idx) => {
          const meta = TARGET_TYPES.find(t => t.value === step.target_type)
          const preview = computeStepPreview(step, employees, roles, depts, stores, sections)
          return (
            <div key={step._localId} style={{
              padding: 10, background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)', borderRadius: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-purple)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                  {idx + 1}
                </div>
                <input className="form-input" style={{ flex: 1, fontWeight: 600 }}
                  placeholder={`第 ${idx + 1} 關標籤（例：直屬主管 / 部門經理 / 財務確認）`}
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
                      return <option key={sec.id} value={sec.id}>{sec.name}{dept ? `(${dept.name})` : ''}</option>
                    })}
                  </select>
                </div>
              )}

              <div style={{
                padding: '6px 10px', borderRadius: 6,
                background: preview.ok ? 'var(--accent-green-dim)' : 'var(--accent-orange-dim)',
                color: preview.ok ? 'var(--accent-green)' : 'var(--accent-orange)',
                fontSize: 11, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                {preview.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                本關會由：{preview.text}
                {preview.dynamic && <span style={{ fontSize: 9, marginLeft: 4, padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,0.4)' }}>動態</span>}
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

        <div style={{ padding: '8px 12px', background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green-dim)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-green)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>✅</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>簽核完成</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>所有關卡通過後通知申請人</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--bg-tertiary)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        💡 <b>動態目標</b>：每次申請才會解析（例：申請人部門主管會依申請人 department_id 動態決定）<br/>
        💡 <b>解不到簽核者</b>：表示組織圖未設好（例：員工未設 department_id）→ 申請會卡住，請先到員工資料補
      </div>
    </>
  )
}
