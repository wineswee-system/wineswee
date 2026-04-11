import { Calculator } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

// ── Employee select grouped by department ──
function EmpSelect({ value, onChange, employees, departments }) {
  return (
    <select className="form-input" style={{ width: '100%' }} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">請選擇員工</option>
      {departments.map(d => (
        <optgroup key={d.id} label={d.name}>
          {employees.filter(e => e.dept === d.name).map(e => (
            <option key={e.id} value={e.name}>{e.name}｜{e.position}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

export default function SalaryFormModal({ editingRecord, form, set, deductions, employees, departments, onClose, onSubmit }) {
  return (
    <Modal title={editingRecord ? '編輯薪資紀錄' : '新增薪資紀錄'} onClose={onClose} onSubmit={onSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="員工 *">
          <EmpSelect value={form.employee} onChange={v => set('employee', v)} employees={employees} departments={departments} />
        </Field>
        <Field label="月份">
          <input className="form-input" type="month" style={{ width: '100%' }} value={form.month} onChange={e => set('month', e.target.value)} />
        </Field>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-green)', margin: '8px 0 4px' }}>▲ 薪資項目</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
        <Field label="底薪">
          <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.base_salary} onChange={e => set('base_salary', e.target.value)} />
        </Field>
        <Field label="加班費">
          <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.overtime_pay} onChange={e => set('overtime_pay', e.target.value)} />
        </Field>
        <Field label="津貼">
          <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.allowances} onChange={e => set('allowances', e.target.value)} />
        </Field>
        <Field label="獎金">
          <input className="form-input" type="number" style={{ width: '100%', borderColor: 'var(--accent-purple)' }} placeholder="0" value={form.bonus} onChange={e => set('bonus', e.target.value)} />
        </Field>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-orange)', margin: '8px 0 4px' }}>⚙ 保險參數</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="健保眷屬人數">
          <input className="form-input" type="number" min="0" max="3" style={{ width: '100%' }} value={form.dependents} onChange={e => set('dependents', e.target.value)} />
        </Field>
        <Field label="勞退自提比率 (%)">
          <input className="form-input" type="number" min="0" max="6" step="1" style={{ width: '100%' }} placeholder="0" value={form.voluntary_pension_rate} onChange={e => set('voluntary_pension_rate', e.target.value)} />
        </Field>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-red)', margin: '8px 0 4px' }}>▼ 其他扣款</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="事假扣薪">
          <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.absence_deduction} onChange={e => set('absence_deduction', e.target.value)} />
        </Field>
        <Field label="遲到扣薪">
          <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.late_deduction} onChange={e => set('late_deduction', e.target.value)} />
        </Field>
        <Field label="其他扣款">
          <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.other_deduction} onChange={e => set('other_deduction', e.target.value)} />
        </Field>
      </div>
      <Field label="其他扣款說明">
        <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：預支薪資扣還、公司借款..." value={form.deduction_note} onChange={e => set('deduction_note', e.target.value)} />
      </Field>

      {/* ── Real-time auto-calculation panel ── */}
      <div style={{ background: 'var(--glass-light)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--border-medium)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
          <Calculator size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          自動計算預覽（即時更新）
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
            <span style={{ color: 'var(--text-muted)' }}>總薪資</span>
            <span style={{ fontWeight: 600 }}>{fmt(deductions.gross)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
            <span style={{ color: 'var(--accent-orange)' }}>勞保自付</span>
            <span style={{ fontWeight: 600 }}>-{deductions.laborIns.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
            <span style={{ color: 'var(--accent-orange)' }}>健保自付</span>
            <span style={{ fontWeight: 600 }}>-{deductions.healthIns.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
            <span style={{ color: 'var(--accent-orange)' }}>勞退自提</span>
            <span style={{ fontWeight: 600 }}>{deductions.pensionSelf > 0 ? `-${deductions.pensionSelf.toLocaleString()}` : '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
            <span style={{ color: 'var(--accent-red)' }}>所得稅扣繳</span>
            <span style={{ fontWeight: 600 }}>{deductions.incomeTax > 0 ? `-${deductions.incomeTax.toLocaleString()}` : '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
            <span style={{ color: 'var(--accent-red)' }}>其他扣款</span>
            <span style={{ fontWeight: 600 }}>{deductions.manualDeductions > 0 ? `-${deductions.manualDeductions.toLocaleString()}` : '—'}</span>
          </div>
        </div>
        <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)', fontSize: 14, fontWeight: 700, color: 'var(--accent-green)', textAlign: 'center', marginTop: 10 }}>
          實領薪資：{fmt(deductions.net)}
        </div>
      </div>
    </Modal>
  )
}
