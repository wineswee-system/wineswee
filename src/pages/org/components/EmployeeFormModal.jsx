import Modal, { Field } from '../../../components/Modal'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'

const EMPLOYMENT_TYPES = [
  { value: '正職', label: '正職' },
  { value: '約聘', label: '約聘' },
  { value: '兼職', label: '兼職' },
  { value: '外籍', label: '外籍移工' },
  { value: '派遣', label: '派遣' },
]

const POSITIONS = [
  { label: '總經理', level: 'admin' },
  { label: '副總經理', level: 'admin' },
  { label: '總監', level: 'manager' },
  { label: '經理', level: 'manager' },
  { label: '副理', level: 'manager' },
  { label: '主管', level: 'manager' },
  { label: '店長', level: 'manager' },
  { label: '副店長', level: 'manager' },
  { label: '組長', level: 'manager' },
  { label: '資深工程師', level: 'office_staff' },
  { label: '工程師', level: 'office_staff' },
  { label: '專員', level: 'office_staff' },
  { label: '行政助理', level: 'office_staff' },
  { label: '會計', level: 'office_staff' },
  { label: '儲備幹部', level: 'store_staff' },
  { label: '業務代表', level: 'store_staff' },
  { label: '門市人員', level: 'store_staff' },
  { label: '收銀員', level: 'store_staff' },
  { label: '倉管人員', level: 'store_staff' },
  { label: '助理', level: 'store_staff' },
  { label: '實習生', level: 'store_staff' },
]

const PosSelect = ({ value, onChange }) => (
  <select className="form-input" style={{ width: '100%' }} value={value} onChange={onChange}>
    <option value="">— 不選 —</option>
    <optgroup label="管理職">
      {POSITIONS.filter(p => ['admin', 'manager'].includes(p.level)).map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
    </optgroup>
    <optgroup label="行政職">
      {POSITIONS.filter(p => p.level === 'office_staff').map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
    </optgroup>
    <optgroup label="門市職">
      {POSITIONS.filter(p => p.level === 'store_staff').map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
    </optgroup>
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
  if (!open) return null

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

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
            <optgroup label="管理職">
              {POSITIONS.filter(p => ['admin', 'manager'].includes(p.level)).map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
            </optgroup>
            <optgroup label="行政職">
              {POSITIONS.filter(p => p.level === 'office_staff').map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
            </optgroup>
            <optgroup label="門市職">
              {POSITIONS.filter(p => p.level === 'store_staff').map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
            </optgroup>
          </select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="副職稱">
          <PosSelect value={form.position_secondary} onChange={e => set('position_secondary', e.target.value)} />
        </Field>
        <Field label="第三職稱">
          <PosSelect value={form.position_third} onChange={e => set('position_third', e.target.value)} />
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
              <option value="super_admin">超級管理員</option>
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
      </div>
    </Modal>
  )
}
