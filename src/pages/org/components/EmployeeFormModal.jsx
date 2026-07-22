import { useState, useEffect } from 'react'
import Modal, { Field } from '../../../components/Modal'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'
import { useAuth } from '../../../contexts/AuthContext'
import { loadPositions, groupPositions, DEFAULT_POSITIONS } from '../../../lib/positions'
import { loadInsuranceBrackets, findLaborBracket, findHealthBracket, findPTInsuredSalary } from '../../../lib/insuranceBrackets'
import { toast } from '../../../lib/toast'

// 常見津貼快選（跟 SalaryFormModal / HrTabContent 一致）；點一下加進自訂津貼
const PRESET_ALLOWANCES = [
  '夜班津貼', '主管加給', '證照津貼', '外語津貼',
  '專業加給', '危險津貼', '久任津貼', '油資補貼',
  '通訊費補助', '託兒津貼', '績效獎金', '全勤獎金',
]

const EMPLOYMENT_TYPES = [
  { value: '正職', label: '正職' },
  { value: '約聘', label: '約聘' },
  { value: '兼職', label: '兼職' },
  { value: '外籍', label: '外籍移工' },
  { value: '派遣', label: '派遣' },
]

// 職位清單改由 positions 表載入(src/lib/positions.js);依 category 分組。
const PosSelect = ({ value, onChange, positions }) => (
  <select className="form-input" style={{ width: '100%' }} value={value} onChange={onChange}>
    <option value="">— 不選 —</option>
    {groupPositions(positions).map(g => (
      <optgroup key={g.group} label={g.group}>
        {g.opts.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
      </optgroup>
    ))}
  </select>
)

/**
 * EmployeeFormModal — create employee modal form (到職).
 *
 * Props:
 *   open        boolean
 *   onClose     () => void
 *   departments array
 *   locations   array
 *   employees   array    for supervisor SearchableSelect
 *   form        object
 *   setForm     updater fn
 *   onSubmit    () => void
 */
export default function EmployeeFormModal({
  open, onClose,
  departments, locations, employees,
  form, setForm,
  onSubmit,
}) {
  const { isSuperAdmin } = useAuth()  // 只有 super_admin 能指派 super_admin（升權防護）
  const [positions, setPositions] = useState(DEFAULT_POSITIONS)
  useEffect(() => { loadPositions().then(setPositions) }, [])
  const [insBrackets, setInsBrackets] = useState(null)
  useEffect(() => { loadInsuranceBrackets(new Date().getFullYear()).then(setInsBrackets).catch(() => {}) }, [])
  if (!open) return null

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // 依「本薪 + 所有津貼」查投保級距表，帶入勞保/職災/健保/勞退（帶入後仍可手調）
  const autoFillInsuranceGrades = () => {
    if (!insBrackets) { toast.error('投保級距表尚未載入，請稍候再試'); return }
    const n = v => Number(v) || 0
    const isPT = form.employment_category === 'parttime' || form.salary_type === 'hourly'
    const base = isPT
      ? n(form.hourly_rate) * (n(form.weekly_hours) || 40) * 4.33
      : n(form.base_salary)
    const insuredBase = base
      + n(form.meal_allowance) + n(form.transport_allowance) + n(form.housing_allowance)
      + (form.custom_allowances || []).reduce((s, c) => s + n(c.amount), 0)
    if (insuredBase <= 0) { toast.error('請先填「本薪 / 時薪」與津貼'); return }
    const labor = findLaborBracket(insBrackets.labor, insuredBase, { isPartTime: isPT })?.insured_salary
    const health = isPT
      ? findPTInsuredSalary(insBrackets.health, insuredBase)
      : findHealthBracket(insBrackets.health, insuredBase)?.insured_salary
    if (labor) { set('labor_ins_grade', labor); set('labor_occ_injury_grade', labor); set('labor_pension_grade', labor) }
    if (health) set('health_ins_grade', health)
    toast.success(`已依投保基數 ${Math.round(insuredBase).toLocaleString()} 帶入級距，可再手動調整`)
  }

  // 自訂津貼（存進 salary_structures.custom_allowances；算入投保基數）
  const addCustomAllowance = (name = '') => setForm(f => ({ ...f, custom_allowances: [...(f.custom_allowances || []), { name, amount: '' }] }))
  const updateCustomAllowance = (idx, field, val) => setForm(f => ({ ...f, custom_allowances: (f.custom_allowances || []).map((c, i) => i === idx ? { ...c, [field]: val } : c) }))
  const removeCustomAllowance = (idx) => setForm(f => ({ ...f, custom_allowances: (f.custom_allowances || []).filter((_, i) => i !== idx) }))

  return (
    <Modal title="新增員工（到職）" onClose={onClose} onSubmit={onSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="姓名" required>
          <input className="form-input" type="text" style={{ width: '100%' }} placeholder="王小明" value={form.name} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="英文姓名">
          <input className="form-input" type="text" style={{ width: '100%' }} placeholder="Xiaoming Wang" value={form.name_en} onChange={e => set('name_en', e.target.value)} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="僱用類型">
          <select className="form-input" style={{ width: '100%' }} value={form.employment_type} onChange={e => set('employment_type', e.target.value)}>
            {EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="到職日">
          <input className="form-input" type="date" style={{ width: '100%' }} value={form.join_date} onChange={e => set('join_date', e.target.value)} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="薪資計算">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 36 }}>
            <button
              type="button"
              onClick={() => set('in_payroll', !form.in_payroll)}
              style={{
                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: form.in_payroll ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
                position: 'relative', transition: 'background 0.2s',
              }}
            >
              <span style={{
                position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
                left: form.in_payroll ? 23 : 3,
              }} />
            </button>
            <span style={{ color: form.in_payroll ? 'var(--accent-cyan)' : 'var(--text-muted)', fontSize: 13 }}>
              {form.in_payroll ? '編制內（計薪）' : '編制外（不計薪）'}
            </span>
          </div>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="部門">
          <select className="form-input" style={{ width: '100%' }} value={form.department_id ?? ''} onChange={e => set('department_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">請選擇</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="主職稱">
          <select className="form-input" style={{ width: '100%' }} value={form.position} onChange={e => {
            const pos = e.target.value
            setForm(f => {
              const next = { ...f, position: pos }
              if (pos && (pos.includes('門市') || pos.includes('店長'))) {
                const ops = departments.find(d => d.name === '營運部')
                if (ops) next.department_id = ops.id
              }
              return next
            })
          }}>
            <option value="">請選擇</option>
            {groupPositions(positions).map(g => (
              <optgroup key={g.group} label={g.group}>
                {g.opts.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="副職稱">
          <PosSelect value={form.position_secondary} onChange={e => set('position_secondary', e.target.value)} positions={positions} />
        </Field>
        <Field label="第三職稱">
          <PosSelect value={form.position_third} onChange={e => set('position_third', e.target.value)} positions={positions} />
        </Field>
      </div>
      <Field label="門市 / 分店">
        <select className="form-input" style={{ width: '100%' }} value={form.store_id ?? ''} onChange={e => {
          const sid = e.target.value ? Number(e.target.value) : null
          setForm(f => {
            const next = { ...f, store_id: sid }
            if (sid) {
              const ops = departments.find(d => d.name === '營運部')
              if (ops) next.department_id = ops.id
            }
            return next
          })
        }}>
          <option value="">請選擇</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
      <Field label="Email" required>
        <input className="form-input" type="email" style={{ width: '100%' }} placeholder="example@company.com" value={form.email} onChange={e => set('email', e.target.value)} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="手機">
          <input className="form-input" type="text" style={{ width: '100%' }} placeholder="0912-345-678" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </Field>
      </div>

      {/* 系統權限與組織 */}
      <div style={{ marginTop: 8, padding: '12px 14px', background: 'var(--glass-light)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text-secondary)' }}>🔐 系統權限與組織</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="角色（系統權限）">
            <select className="form-input" style={{ width: '100%' }} value={form.role} onChange={e => set('role', e.target.value)}>
              <option value="">依職稱自動判定</option>
              <option value="store_staff">門市人員</option>
              <option value="office_staff">行政人員</option>
              <option value="manager">主管</option>
              <option value="admin">HR 管理員</option>
              {/* 僅 super_admin 可指派 super_admin；或該員工本來就是 super_admin 時仍顯示以正確呈現 */}
              {(isSuperAdmin || form.role === 'super_admin') && (
                <option value="super_admin">超級管理員</option>
              )}
            </select>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              影響系統內可進的頁面與按鈕。未指定則依職稱自動判定。
            </div>
          </Field>
          <Field label="直屬主管">
            <SearchableSelect
              value={form.supervisor_id}
              onChange={(v) => set('supervisor_id', v)}
              options={empOptions(employees.filter(e => e.status === '在職'))}
              placeholder="搜尋姓名 / 職稱 / 部門 / 門市..."
            />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              簽核流程「直屬主管」這關會解析到這個人。
            </div>
          </Field>
        </div>
      </div>

      {/* 個人資料 */}
      <div style={{ marginTop: 8, padding: '12px 14px', background: 'var(--glass-light)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text-secondary)' }}>👤 個人資料</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="身分證字號">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="A123456789" maxLength={10}
              value={form.id_number} onChange={e => set('id_number', e.target.value.toUpperCase())} />
          </Field>
          <Field label="生日">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.birth_date} onChange={e => set('birth_date', e.target.value)} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="性別">
            <select className="form-input" style={{ width: '100%' }} value={form.gender} onChange={e => set('gender', e.target.value)}>
              <option value="">未填</option>
              <option value="男">男</option>
              <option value="女">女</option>
              <option value="不公開">不公開</option>
            </select>
          </Field>
          <Field label="員工編號">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="留空自動產生" value={form.employee_number} onChange={e => set('employee_number', e.target.value)} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="試用期結束日">
            <input className="form-input" type="date" style={{ width: '100%' }} value={form.probation_end_date} onChange={e => set('probation_end_date', e.target.value)} />
          </Field>
          <Field label="通訊地址">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="台北市..." value={form.address} onChange={e => set('address', e.target.value)} />
          </Field>
        </div>
      </div>

      {/* 緊急聯絡人 & 薪轉帳戶 */}
      <div style={{ marginTop: 8, padding: '12px 14px', background: 'var(--glass-light)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text-secondary)' }}>🆘 緊急聯絡人 &amp; 薪轉帳戶</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="緊急聯絡人">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="姓名" value={form.emergency_contact_name} onChange={e => set('emergency_contact_name', e.target.value)} />
          </Field>
          <Field label="緊急聯絡電話">
            <input className="form-input" type="tel" style={{ width: '100%' }} placeholder="0912-345-678" value={form.emergency_contact_phone} onChange={e => set('emergency_contact_phone', e.target.value)} />
          </Field>
          <Field label="關係">
            <select className="form-input" style={{ width: '100%' }} value={form.emergency_contact_relation} onChange={e => set('emergency_contact_relation', e.target.value)}>
              <option value="">請選擇</option>
              <option value="父母">父母</option>
              <option value="配偶">配偶</option>
              <option value="子女">子女</option>
              <option value="兄弟姊妹">兄弟姊妹</option>
              <option value="祖父母">祖父母</option>
              <option value="親戚">親戚</option>
              <option value="朋友">朋友</option>
              <option value="其他">其他</option>
            </select>
          </Field>
        </div>
        {/* 銀行帳號已移到「薪資管理 → 匯入銀行帳號」(安全表，只 admin 可讀寫) */}
      </div>

      {/* 薪資資訊 */}
      <div style={{ marginTop: 8, padding: '12px 14px', background: 'var(--glass-light)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text-secondary)' }}>💰 薪資資訊</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="員工分類">
            <select className="form-input" style={{ width: '100%' }}
              value={form.employment_category || 'regular'}
              onChange={e => {
                const cat = e.target.value
                set('employment_category', cat)
              }}>
              <option value="regular">正職（門市）</option>
              <option value="admin">行政</option>
              <option value="parttime">兼職（時薪）</option>
              <option value="piece">計件</option>
            </select>
          </Field>
          {(form.employment_category || 'regular') === 'parttime' ? (
            <Field label="時薪 (NT$)">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="183" value={form.hourly_rate} onChange={e => set('hourly_rate', e.target.value)} />
            </Field>
          ) : form.employment_category === 'piece' ? (
            <Field label="每件單價 (NT$)">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="2000" value={form.piece_rate} onChange={e => set('piece_rate', e.target.value)} />
            </Field>
          ) : (
            <Field label="月底薪 (NT$)">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="28000" value={form.base_salary} onChange={e => set('base_salary', e.target.value)} />
            </Field>
          )}
        </div>
        <Field label="每週工時上限">
          <input className="form-input" type="number" style={{ width: '100%' }} placeholder="40" value={form.weekly_hours} onChange={e => set('weekly_hours', e.target.value)} />
        </Field>
        {/* 津貼（算入投保基數）— 這裡僅收 employees 表的固定津貼;夜間/跨店/自訂在「薪資結構」詳細編輯 */}
        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>🎁 津貼（算入投保基數）</div>
        <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
          {[
            ['meal_allowance', '伙食津貼'],
            ['transport_allowance', '交通津貼'],
            ['housing_allowance', '住房津貼'],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form[key] || ''} onChange={e => set(key, e.target.value)} />
            </Field>
          ))}
        </div>
        {/* 自訂津貼（自己打名稱;存進 salary_structures.custom_allowances,算入投保基數+加班費） */}
        <div style={{ marginTop: 10, marginBottom: 6, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>✨ 自訂津貼（點快選或自己打名稱）</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {PRESET_ALLOWANCES.map(name => {
            const used = (form.custom_allowances || []).some(c => c.name === name)
            return (
              <button key={name} type="button" disabled={used} onClick={() => !used && addCustomAllowance(name)}
                style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: used ? 'default' : 'pointer',
                  border: '1px solid var(--border-subtle)', background: used ? 'var(--bg-tertiary)' : 'transparent',
                  color: used ? 'var(--text-muted)' : 'var(--accent-cyan)', opacity: used ? 0.5 : 1 }}>
                {used ? '✓ ' : '+ '}{name}
              </button>
            )
          })}
          <button type="button" onClick={() => addCustomAllowance('')}
            style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
              border: '1px dashed var(--accent-purple)', background: 'rgba(167,139,250,0.08)', color: 'var(--accent-purple)' }}>
            + 完全自訂
          </button>
        </div>
        {(form.custom_allowances || []).length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {form.custom_allowances.map((c, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input className="form-input" placeholder="津貼名稱（例：證照津貼）" value={c.name} onChange={e => updateCustomAllowance(idx, 'name', e.target.value)} style={{ flex: 2 }} />
                <input className="form-input" type="number" placeholder="金額" value={c.amount} onChange={e => updateCustomAllowance(idx, 'amount', e.target.value)} style={{ flex: 1 }} />
                <button type="button" onClick={() => removeCustomAllowance(idx)}
                  style={{ background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--accent-red)', cursor: 'pointer', borderRadius: 6, padding: '6px 9px' }}>✕</button>
              </div>
            ))}
          </div>
        )}
        {/* 投保設定（寫入 employees，計薪依此判斷扣不扣勞健保/勞退） */}
        <div style={{ marginTop: 12, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {[
            { key: 'labor_insurance', label: '投保勞保' },
            { key: 'health_insurance', label: '投保健保' },
            { key: 'pension', label: '提繳勞退' },
          ].map(it => (
            <label key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={form[it.key] ?? true} onChange={e => set(it.key, e.target.checked)} />
              {it.label}
            </label>
          ))}
        </div>
        {/* 依薪資自動帶入級距 */}
        {((form.labor_insurance ?? true) || (form.health_insurance ?? true) || (form.pension ?? true)) && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={autoFillInsuranceGrades}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: '#fff', background: 'var(--accent-cyan)', border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>
              🔄 依薪資自動帶入級距
            </button>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>以「本薪 + 津貼（伙食/交通/住房）」查表帶入勞保/健保/勞退，可再手調</span>
          </div>
        )}
        {/* 各投保級距分開填(勞保/健保/勞退常不同);勾哪個投保才顯示。留空→計薪依月薪自動查級距 */}
        {((form.labor_insurance ?? true) || (form.health_insurance ?? true) || (form.pension ?? true)) && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {(form.labor_insurance ?? true) && (
              <Field label="勞保級距">
                <input className="form-input" type="number" style={{ width: '100%' }} placeholder="留空自動(封頂45800)"
                  value={form.labor_ins_grade || ''} onChange={e => set('labor_ins_grade', e.target.value)} />
              </Field>
            )}
            {(form.health_insurance ?? true) && (
              <Field label="健保級距">
                <input className="form-input" type="number" style={{ width: '100%' }} placeholder="留空自動"
                  value={form.health_ins_grade || ''} onChange={e => set('health_ins_grade', e.target.value)} />
              </Field>
            )}
            {(form.pension ?? true) && (
              <Field label="勞退提繳工資級距">
                <input className="form-input" type="number" style={{ width: '100%' }} placeholder="留空同投保"
                  value={form.labor_pension_grade || ''} onChange={e => set('labor_pension_grade', e.target.value)} />
              </Field>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
