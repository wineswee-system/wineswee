import { useState, useEffect } from 'react'
import { Upload, Eye, Plus, X, Trash2 } from 'lucide-react'
import { getPTAnnualLeaveHours, getAnnualLeaveEntitlement } from '../../lib/leavePolicy'
import SearchableSelect, { empOptions } from '../SearchableSelect'
import { useAuth } from '../../contexts/AuthContext'
import { loadPositions, groupPositions, DEFAULT_POSITIONS } from '../../lib/positions'
import { loadInsuranceBrackets, findLaborBracket, findHealthBracket, findPTInsuredSalary } from '../../lib/insuranceBrackets'
import { toast } from '../../lib/toast'

const maskBank = (v) => v ? '****' + v.slice(-4) : ''

// 職位清單改由 positions 表載入(後台「職位管理」可自編);見 src/lib/positions.js。
function PositionCombo({ value, onChange, placeholder }) {
  const [positions, setPositions] = useState(DEFAULT_POSITIONS)
  useEffect(() => { loadPositions().then(setPositions) }, [])
  return (
    <select
      className="form-input"
      style={{ width: '100%' }}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">{placeholder || '— 不選 —'}</option>
      {groupPositions(positions).map(g => (
        <optgroup key={g.group} label={g.group}>
          {g.opts.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

// 跟 SalaryFormModal / SalaryStructures 一致的 12 個常見津貼快選
const PRESET_ALLOWANCES = [
  '夜班津貼', '主管加給', '證照津貼', '外語津貼',
  '專業加給', '危險津貼', '久任津貼', '油資補貼',
  '通訊費補助', '託兒津貼', '房屋津貼', '績效獎金',
]

export default function HrTabContent({
  form,
  set,
  isAdmin,
  subTab,
  employee,
  insuranceEvents = [],
  dependents = [],
  showDepForm, setShowDepForm, depForm, setDepForm, addDependent, deleteDependent,
  roles,
  stores,
  departments,
  employees: allEmployees,
  passbookUploading,
  handlePassbookUpload,
  Toggle,
  SectionTitle,
  L,
}) {
  const { isSuperAdmin } = useAuth()
  // 僅 super_admin 可指派 super_admin（升權防護）；該員工本來就是 super_admin 時仍保留選項以正確顯示
  const roleOptions = (roles || []).filter(
    r => r.name !== 'super_admin' || isSuperAdmin || form.role_id === 1 || form.role === 'super_admin'
  )

  // ── 勞健保級距表（依薪資自動帶入用）─────────────────────────────
  const [insBrackets, setInsBrackets] = useState(null)
  useEffect(() => {
    loadInsuranceBrackets(new Date().getFullYear()).then(setInsBrackets).catch(() => {})
  }, [])

  // 依「本薪 + 經常性津貼」查投保級距表，帶入勞保/職災/健保/勞退級距（帶入後仍可手調）
  const autoFillInsuranceGrades = () => {
    if (!insBrackets) { toast.error('投保級距表尚未載入，請稍候再試'); return }
    const n = v => Number(v) || 0
    const isPT = form.salary_type === 'hourly' || form.employment_category === 'parttime'
    // 投保基數 = 本薪(月薪)或估算月收入(時薪) + 所有津貼(伙食/交通/住房/夜間/跨店 + 自訂)
    const base = isPT
      ? n(form.hourly_rate) * (n(form.weekly_hours) || 40) * 4.33
      : n(form.base_salary)
    const insuredBase = base
      + n(form.meal_allowance) + n(form.transport_allowance) + n(form.housing_allowance)
      + n(form.night_shift_allowance) + n(form.cross_store_allowance)
      + (form.custom_allowances || []).reduce((s, c) => s + n(c.amount), 0)
    if (insuredBase <= 0) { toast.error('請先填「本薪 / 時薪」與津貼'); return }

    const labor = findLaborBracket(insBrackets.labor, insuredBase, { isPartTime: isPT })?.insured_salary
    const health = isPT
      ? findPTInsuredSalary(insBrackets.health, insuredBase)
      : findHealthBracket(insBrackets.health, insuredBase)?.insured_salary
    // 職災/勞退預設「同投保級距」（高薪者上限不同可手動再調）
    if (labor) { set('labor_ins_grade', labor); set('labor_occ_injury_grade', labor); set('labor_pension_grade', labor) }
    if (health) set('health_ins_grade', health)
    toast.success(`已依投保基數 ${Math.round(insuredBase).toLocaleString()} 帶入級距，可再手動調整`)
  }

  return (
    <>
      {/* ════════════════════════════════════════
          人事 / 組織職務
      ════════════════════════════════════════ */}
      {subTab === 'org' && (
        <>
          <SectionTitle icon="💼" text="僱用資訊" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><div style={L}>類型</div>
              <select className="form-input" style={{ width: '100%' }} value={form.employment_type || '正職'} onChange={e => set('employment_type', e.target.value)}>
                <option value="正職">正職</option>
                <option value="約聘">約聘</option>
                <option value="兼職">兼職</option>
                <option value="外籍">外籍移工</option>
                <option value="派遣">派遣</option>
              </select>
            </div>
            <div><div style={L}>狀態</div>
              <select className="form-input" style={{ width: '100%' }} value={form.status || '在職'} onChange={e => set('status', e.target.value)}>
                <option>在職</option><option>離職</option><option>留職停薪</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={L}>薪資計算</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 36 }}>
                <button
                  type="button"
                  onClick={() => set('in_payroll', !(form.in_payroll ?? true))}
                  style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: (form.in_payroll ?? true) ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.2s',
                    left: (form.in_payroll ?? true) ? 23 : 3,
                  }} />
                </button>
                <span style={{ color: (form.in_payroll ?? true) ? 'var(--accent-cyan)' : 'var(--text-muted)', fontSize: 13 }}>
                  {(form.in_payroll ?? true) ? '編制內（計薪）' : '編制外（不計薪）'}
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><div style={L}>入職日期</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.join_date || ''} onChange={e => set('join_date', e.target.value)} /></div>
            <div><div style={L}>試用期結束</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.probation_end || ''} onChange={e => set('probation_end', e.target.value)} /></div>
          </div>
          {form.employment_type === '外籍' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div><div style={L}>工作證號</div><input className="form-input" type="text" style={{ width: '100%' }} value={form.work_permit_number || ''} onChange={e => set('work_permit_number', e.target.value)} /></div>
              <div><div style={L}>工作證到期日</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.work_permit_expiry || ''} onChange={e => set('work_permit_expiry', e.target.value)} /></div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><div style={L}>離職日期</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.resign_date || ''} onChange={e => set('resign_date', e.target.value)} /></div>
          </div>
          <div><div style={L}>離職原因</div><textarea className="form-input" style={{ width: '100%', minHeight: 50, resize: 'vertical' }} value={form.resign_reason || ''} onChange={e => set('resign_reason', e.target.value)} /></div>

          <SectionTitle icon="🏪" text="門市 / 部門" />
          <div><div style={L}>主要門市</div>
            <select className="form-input" style={{ width: '100%' }} value={form.store || ''} onChange={e => set('store', e.target.value)}>
              <option value="">未指派</option>
              {(stores || []).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={L}>可支援門市（跨店排班）</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(stores || []).filter(s => s.name !== form.store).map(s => {
                const checked = (form.additional_stores || []).includes(s.name)
                return (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', padding: '4px 8px', borderRadius: 6, background: checked ? 'var(--accent-cyan-dim)' : 'var(--glass-light)', border: `1px solid ${checked ? 'rgba(6,182,212,0.3)' : 'var(--border-subtle)'}` }}>
                    <input type="checkbox" checked={checked} style={{ width: 14, height: 14 }} onChange={() => {
                      const current = form.additional_stores || []
                      set('additional_stores', checked ? current.filter(n => n !== s.name) : [...current, s.name])
                    }} />
                    {s.name}
                  </label>
                )
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>勾選的門市會在「找人代班」時優先顯示此員工</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><div style={L}>部門</div>
              <select className="form-input" style={{ width: '100%' }} value={form.dept || ''} onChange={e => set('dept', e.target.value)}>
                <option value="">— 未指派 —</option>
                {(departments || []).map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <div><div style={L}>直屬主管</div>
              <SearchableSelect
                value={form.supervisor || ''}
                onChange={(v) => set('supervisor', v || '')}
                options={empOptions(
                  (allEmployees || []).filter(e => e.id !== employee.id && e.status === '在職'),
                  { keyBy: 'name' }
                )}
                placeholder="— 未指派 —"
              />
            </div>
          </div>

          <SectionTitle icon="👔" text="職位" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><div style={L}>主職位</div><PositionCombo value={form.position} onChange={v => set('position', v)} placeholder="輸入或選擇職位" /></div>
            <div><div style={L}>職等</div><input className="form-input" style={{ width: '100%' }} value={form.grade || ''} onChange={e => set('grade', e.target.value)} placeholder="M1 / S3" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><div style={L}>副職位</div><PositionCombo value={form.position_secondary} onChange={v => set('position_secondary', v)} placeholder="選填" /></div>
            <div><div style={L}>第三職位</div><PositionCombo value={form.position_third} onChange={v => set('position_third', v)} placeholder="選填" /></div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={L}>角色（系統權限）</div>
            <select className="form-input" style={{ width: '100%' }} value={form.role_id || ''}
              onChange={e => {
                const id = e.target.value ? Number(e.target.value) : null
                const r = roles.find(x => x.id === id)
                set('role_id', id)
                if (r) set('role', r.name)
              }}>
              <option value="">— 未指派 —</option>
              {roleOptions.map(r => <option key={r.id} value={r.id}>{r.name}{r.description ? `（${r.description}）` : ''}</option>)}
            </select>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════
          人事 / 薪資
      ════════════════════════════════════════ */}
      {subTab === 'salary' && (
        <>
          <SectionTitle icon="💰" text="薪資" />
          {/* ★ 員工分類 — 4 個選項決定加班費演算法 + 投保邏輯
             regular(正職門市 1.34/1.67·看班表) / admin(行政 月薪制·固定9-6·不排班) / parttime(兼職 PT 投保) / piece(計件無 OT)
             ※ 加班費目前 regular/admin 同階梯算（DB 未對 admin 套 ×1）;admin 與 regular 計薪差別在「考勤基準」 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><div style={L}>員工分類</div>
              <select className="form-input" style={{ width: '100%' }}
                value={form.employment_category || 'regular'}
                onChange={e => {
                  const cat = e.target.value
                  set('employment_category', cat)
                  // 自動同步 salary_type（payrollCalc 仍會用到）：piece 用 monthly、parttime 用 hourly、其他 monthly
                  if (cat === 'parttime') set('salary_type', 'hourly')
                  else set('salary_type', 'monthly')
                  // 計件預設單價 2000（廠商實務上多數 2000/件）
                  if (cat === 'piece' && !form.piece_rate) set('piece_rate', 2000)
                }}>
                <option value="regular">正職（門市，看班表、加班 1.34/1.67 階梯）</option>
                <option value="admin">行政（月薪制，固定工時 9-6、不排班）</option>
                <option value="parttime">兼職（時薪制，投保 PT 級距）</option>
                <option value="piece">計件（月薪 = 件數 × 單價，不算加班）</option>
              </select>
            </div>
            {(() => {
              const cat = form.employment_category || 'regular'
              if (cat === 'piece') {
                return <div><div style={L}>每件單價 (NT$)</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="2000" value={form.piece_rate || ''} onChange={e => set('piece_rate', e.target.value)} /></div>
              }
              if (cat === 'parttime') {
                return <div><div style={L}>時薪 (NT$)</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="例：183" value={form.hourly_rate || ''} onChange={e => set('hourly_rate', e.target.value)} /></div>
              }
              // regular / admin → 月底薪
              return <div><div style={L}>月底薪 (NT$)</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="例：28000" value={form.base_salary || ''} onChange={e => set('base_salary', e.target.value)} /></div>
            })()}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><div style={L}>每週工時上限</div><input className="form-input" type="number" style={{ width: '100%' }} value={form.weekly_hours || 40} onChange={e => set('weekly_hours', e.target.value)} /></div>
            {(() => {
              const cat = form.employment_category || 'regular'
              if (cat === 'piece') {
                // 計件員工專屬：本月件數（HR 計薪前手動更新）
                const cnt = Number(form.current_piece_count) || 0
                const rate = Number(form.piece_rate) || 0
                return (
                  <div><div style={L}>本月件數（計薪前更新）</div>
                    <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0"
                      value={form.current_piece_count || ''}
                      onChange={e => set('current_piece_count', e.target.value)} />
                    {cnt > 0 && rate > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 4 }}>
                        ✨ 預估月薪：{cnt} × {rate.toLocaleString()} = NT$ {(cnt * rate).toLocaleString()}
                      </div>
                    )}
                  </div>
                )
              }
              if (cat === 'parttime') {
                return null  // 時薪制不顯示換算時薪
              }
              // 月薪制（regular / admin）顯示換算時薪 =（月底薪 + 所有津貼含自訂）/ 30 / 8
              const n = v => Number(v) || 0
              const monthlyTotal = n(form.base_salary)
                + n(form.meal_allowance) + n(form.transport_allowance) + n(form.housing_allowance)
                + n(form.supervisor_allowance) + n(form.attendance_bonus)
                + n(form.night_shift_allowance) + n(form.cross_store_allowance)
                + (form.custom_allowances || []).reduce((s, c) => s + n(c.amount), 0)
              return (
                <div><div style={L}>換算時薪（含津貼）</div>
                  <div className="form-input" style={{ width: '100%', background: 'var(--glass-light)', color: 'var(--text-muted)' }}>
                    NT$ {form.base_salary ? Math.round(monthlyTotal / 30 / 8) : '—'} /hr
                  </div>
                </div>
              )
            })()}
          </div>

          <SectionTitle icon="🎁" text="津貼" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <div><div style={L}>伙食津貼</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.meal_allowance || ''} onChange={e => set('meal_allowance', e.target.value)} /></div>
            <div><div style={L}>交通津貼</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.transport_allowance || ''} onChange={e => set('transport_allowance', e.target.value)} /></div>
            <div><div style={L}>住房津貼</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.housing_allowance || ''} onChange={e => set('housing_allowance', e.target.value)} /></div>
            <div><div style={L}>主管加給</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.supervisor_allowance || ''} onChange={e => set('supervisor_allowance', e.target.value)} /></div>
            <div><div style={L}>全勤獎金</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.attendance_bonus || ''} onChange={e => set('attendance_bonus', e.target.value)} /></div>
            <div><div style={L}>夜間津貼</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.night_shift_allowance || ''} onChange={e => set('night_shift_allowance', e.target.value)} /></div>
            <div><div style={L}>跨店津貼</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.cross_store_allowance || ''} onChange={e => set('cross_store_allowance', e.target.value)} /></div>
          </div>

          {/* ─── 自訂津貼（動態新增）— 算入勞健保 + 加班費基數，跟 SalaryFormModal pattern 一致 ─── */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                ✨ 自訂津貼（會算入投保薪資與加班費基數）
              </label>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {(form.custom_allowances || []).length} 項
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {PRESET_ALLOWANCES.map(name => {
                const used = (form.custom_allowances || []).some(c => c.name === name)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      if (used) return
                      set('custom_allowances', [...(form.custom_allowances || []), { name, amount: '' }])
                    }}
                    disabled={used}
                    style={{
                      padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: used ? 'default' : 'pointer',
                      border: '1px solid var(--border-subtle)',
                      background: used ? 'var(--bg-tertiary)' : 'transparent',
                      color: used ? 'var(--text-muted)' : 'var(--accent-cyan)',
                      opacity: used ? 0.5 : 1,
                    }}
                  >
                    {used ? '✓ ' : <Plus size={10} style={{ display: 'inline', marginRight: 2 }} />}{name}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => set('custom_allowances', [...(form.custom_allowances || []), { name: '', amount: '' }])}
                style={{
                  padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                  border: '1px dashed var(--accent-purple)',
                  background: 'rgba(167,139,250,0.08)', color: 'var(--accent-purple)',
                }}
              >
                <Plus size={10} style={{ display: 'inline', marginRight: 2 }} />完全自訂
              </button>
            </div>
            {(form.custom_allowances || []).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {form.custom_allowances.map((c, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      className="form-input"
                      placeholder="津貼名稱"
                      value={c.name || ''}
                      onChange={e => set('custom_allowances', form.custom_allowances.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                      style={{ flex: 2 }}
                    />
                    <input
                      className="form-input"
                      type="number"
                      placeholder="金額"
                      value={c.amount || ''}
                      onChange={e => set('custom_allowances', form.custom_allowances.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => set('custom_allowances', form.custom_allowances.filter((_, i) => i !== idx))}
                      style={{
                        background: 'transparent', border: '1px solid var(--border-subtle)',
                        color: 'var(--accent-red)', cursor: 'pointer',
                        borderRadius: 6, padding: 6, display: 'flex',
                      }}
                      title="刪除"
                    ><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 銀行帳戶已移到「薪資管理 → 匯入銀行帳號」(存安全表 employee_bank_accounts，
              只 admin 可讀寫;不再寫 employees.bank_*，避免全公司可讀的個資外洩) */}

          {/* 存摺封面上傳 */}
          {isAdmin && (
            <div style={{ marginTop: 14 }}>
              <div style={L}>存摺封面</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {form.passbook_image_url ? (
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img src={form.passbook_image_url} alt="存摺封面" style={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border-subtle)' }} />
                    <a href={form.passbook_image_url} target="_blank" rel="noopener noreferrer"
                      style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.55)', borderRadius: 4, padding: '2px 5px', color: '#fff', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3, fontSize: 10 }}>
                      <Eye size={10} /> 查看
                    </a>
                  </div>
                ) : (
                  <div style={{ width: 120, height: 80, borderRadius: 8, border: '2px dashed var(--border-medium)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
                    未上傳
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 14px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', cursor: passbookUploading ? 'not-allowed' : 'pointer', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    <Upload size={13} /> {passbookUploading ? '上傳中...' : '選擇圖片'}
                    <input type="file" accept="image/*" style={{ display: 'none' }} disabled={passbookUploading}
                      onChange={e => handlePassbookUpload(e.target.files?.[0])} />
                  </label>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>支援 JPG / PNG，最大 5MB</div>
                  {form.passbook_image_url && (
                    <button onClick={() => set('passbook_image_url', null)} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 11, textAlign: 'left', padding: 0 }}>
                      移除圖片
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {!isAdmin && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>銀行資訊需管理員權限方可查看與修改</div>}
        </>
      )}

      {/* ════════════════════════════════════════
          人事 / 勞健退
      ════════════════════════════════════════ */}
      {subTab === 'insurance' && (
        <>
          <SectionTitle icon="🏥" text="勞健保 / 退休金" />

          {/* 依薪資自動帶入級距 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10, padding: '10px 14px', background: 'var(--accent-cyan-dim)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
            <button type="button" onClick={autoFillInsuranceGrades}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#fff', background: 'var(--accent-cyan)', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', flexShrink: 0 }}>
              🔄 依薪資自動帶入級距
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              以「本薪 + 所有津貼（伙食/交通/住房/夜間/跨店 + 自訂）」為投保基數查級距表，帶入勞保/職災/健保/勞退。帶入後仍可手動調整。
            </span>
          </div>

          <div style={{ padding: '12px 14px', background: 'var(--bg-card)', borderRadius: 10, marginBottom: 10, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: form.labor_insurance ? 12 : 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>勞工保險</span>
              <Toggle checked={form.labor_insurance || false} onChange={e => set('labor_insurance', e.target.checked)} />
            </div>
            {form.labor_insurance && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>投保級距</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="27600" value={form.labor_ins_grade || ''} onChange={e => set('labor_ins_grade', e.target.value)} /></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>職災級距</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="同投保級距" value={form.labor_occ_injury_grade || ''} onChange={e => set('labor_occ_injury_grade', e.target.value)} /></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>加保日期</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.labor_ins_start || ''} onChange={e => set('labor_ins_start', e.target.value)} /></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>退保日期</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.labor_ins_end || ''} onChange={e => set('labor_ins_end', e.target.value)} /></div>
              </div>
            )}
          </div>

          <div style={{ padding: '12px 14px', background: 'var(--bg-card)', borderRadius: 10, marginBottom: 10, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: form.health_insurance ? 12 : 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>全民健康保險</span>
              <Toggle checked={form.health_insurance || false} onChange={e => set('health_insurance', e.target.checked)} />
            </div>
            {form.health_insurance && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>投保級距</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="27600" value={form.health_ins_grade || ''} onChange={e => set('health_ins_grade', e.target.value)} /></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>加保日期</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.health_ins_start || ''} onChange={e => set('health_ins_start', e.target.value)} /></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>退保日期</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.health_ins_end || ''} onChange={e => set('health_ins_end', e.target.value)} /></div>
              </div>
            )}
          </div>

          <div style={{ padding: '12px 14px', background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: form.pension ? 12 : 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>勞工退休金</span>
              <Toggle checked={form.pension || false} onChange={e => set('pension', e.target.checked)} />
            </div>
            {form.pension && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>提繳工資級距</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="同投保級距" value={form.labor_pension_grade || ''} onChange={e => set('labor_pension_grade', e.target.value)} /></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>提繳率 (%)</div><input className="form-input" type="number" style={{ width: '100%' }} placeholder="6" value={form.pension_rate || 6} onChange={e => set('pension_rate', e.target.value)} /></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>加保日期</div><input className="form-input" type="date" style={{ width: '100%' }} value={form.labor_pension_start || ''} onChange={e => set('labor_pension_start', e.target.value)} /></div>
              </div>
            )}
          </div>

          <div style={{ padding: '12px 14px', background: 'var(--bg-card)', borderRadius: 10, marginTop: 10, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: Number(form.labor_pension_self_rate) > 0 ? 12 : 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>勞退自提（員工自願）</span>
              <Toggle checked={Number(form.labor_pension_self_rate) > 0} onChange={e => set('labor_pension_self_rate', e.target.checked ? 6 : 0)} />
            </div>
            {Number(form.labor_pension_self_rate) > 0 && (
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>自提率 (%)</div>
                <input className="form-input" type="number" min="0" max="6" style={{ width: '50%' }} placeholder="6" value={form.labor_pension_self_rate || ''} onChange={e => set('labor_pension_self_rate', e.target.value)} />
              </div>
            )}
          </div>

          {/* ─── 眷屬 ─── */}
          <SectionTitle icon="👥" text={`眷屬 (${dependents.length})`} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowDepForm && setShowDepForm(!showDepForm)}><Plus size={13} /></button>
          </div>
          {showDepForm && setDepForm && (
            <div style={{ padding: 14, background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--accent-cyan)', marginBottom: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>姓名 *</div><input className="form-input" style={{ width: '100%', fontSize: 12 }} placeholder="眷屬姓名" value={depForm.name} onChange={e => setDepForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>關係</div><select className="form-input" style={{ width: '100%', fontSize: 12 }} value={depForm.relationship} onChange={e => setDepForm(f => ({ ...f, relationship: e.target.value }))}><option>配偶</option><option>子女</option><option>父</option><option>母</option><option>其他</option></select></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>身分證字號</div><input className="form-input" style={{ width: '100%', fontSize: 12 }} placeholder="選填" value={depForm.id_number} onChange={e => setDepForm(f => ({ ...f, id_number: e.target.value }))} /></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>出生日期</div><input className="form-input" type="date" style={{ width: '100%', fontSize: 12 }} value={depForm.birth_date} onChange={e => setDepForm(f => ({ ...f, birth_date: e.target.value }))} /></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}><input type="checkbox" checked={depForm.health_ins} onChange={e => setDepForm(f => ({ ...f, health_ins: e.target.checked }))} /> 加保健保（眷屬附加）</label>
                <div style={{ display: 'flex', gap: 6 }}><button className="btn btn-sm btn-secondary" onClick={() => setShowDepForm(false)} style={{ fontSize: 11 }}>取消</button><button className="btn btn-sm btn-primary" onClick={addDependent} style={{ fontSize: 11 }}>新增</button></div>
              </div>
            </div>
          )}
          {dependents.length === 0 && !showDepForm
            ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無眷屬</div>
            : dependents.map(d => (
              <div key={d.id} style={{ padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                    <span className="badge badge-cyan" style={{ fontSize: 11 }}>{d.relationship || '—'}</span>
                    {d.health_ins && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'var(--accent-green-dim)', color: 'var(--accent-green)', fontWeight: 600 }}>健保</span>}
                  </div>
                  {deleteDependent && <button onClick={() => deleteDependent(d.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.5 }}><Trash2 size={13} /></button>}
                </div>
              </div>
            ))
          }

          {/* ─── 投保異動紀錄 ─── */}
          <SectionTitle icon="🏥" text={`投保異動紀錄 (${insuranceEvents.length})`} />
          {insuranceEvents.length === 0
            ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>尚無投保異動紀錄</div>
            : insuranceEvents.map(ev => (
              <div key={ev.id} style={{ padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 6, border: '1px solid var(--border-subtle)', fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{ev.event_type}{ev.dependent_name ? ` · ${ev.dependent_name}` : ''}</span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{ev.effective_date || '—'}</span>
                </div>
                {ev.detail && <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{ev.detail}</div>}
              </div>
            ))
          }

          {/* ─── 特別休假額度 ─── */}
          {(() => {
            const isPT = (form.employment_category || 'regular') === 'parttime'
            const joinDate = form.join_date
            if (!joinDate) return null
            if (isPT) {
              const wh = Number(form.weekly_hours) || 0
              const { hours, days, yearsWorked, ratio } = getPTAnnualLeaveHours(joinDate, wh)
              return (
                <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--accent-blue-dim)', borderRadius: 10, border: '1px solid var(--accent-blue)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 8 }}>📅 特別休假額度（兼職比例制）</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 12 }}>
                    <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>年資</div><div style={{ fontWeight: 600 }}>{yearsWorked} 年</div></div>
                    <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>正職天數</div><div style={{ fontWeight: 600 }}>{days} 天</div></div>
                    <div><div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>工時比例</div><div style={{ fontWeight: 600 }}>{wh}h / 40h = {Math.round(ratio * 100)}%</div></div>
                  </div>
                  <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>本年度特休額度</span>
                    <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-blue)' }}>{hours} 小時</span>
                  </div>
                  {wh === 0 && <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 6 }}>⚠ 請先設定每週工時上限</div>}
                </div>
              )
            }
            // 正職 / 行政
            const { days, yearsWorked } = getAnnualLeaveEntitlement(joinDate)
            return (
              <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--accent-cyan-dim)', borderRadius: 10, border: '1px solid var(--accent-cyan)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 8 }}>📅 特別休假額度</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>年資 {yearsWorked} 年</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-cyan)' }}>{days} 天</span>
                </div>
              </div>
            )
          })()}
        </>
      )}
    </>
  )
}
