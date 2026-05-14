import { Calculator, X, AlertTriangle } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'
import { empLabel } from '../../../lib/empLabel'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

// 跟 SalaryStructures 一致的 12 個常見津貼快選
const PRESET_ALLOWANCES = [
  '夜班津貼', '主管加給', '證照津貼', '外語津貼',
  '專業加給', '危險津貼', '久任津貼', '油資補貼',
  '通訊費補助', '託兒津貼', '房屋津貼', '績效獎金',
]

function EmpSelect({ value, onChange, employees }) {
  return (
    <SearchableSelect
      value={value}
      onChange={(v) => onChange(v || '')}
      options={empOptions(employees, { keyBy: 'name' })}
      placeholder="搜尋員工姓名/職稱..."
    />
  )
}

export default function SalaryFormModal({
  editingRecord, form, set, deductions, employees, departments,
  payrollWarning,
  addCustomAllowance, updateCustomAllowance, removeCustomAllowance,
  onClose, onSubmit,
}) {
  return (
    <Modal title={editingRecord ? '編輯薪資紀錄' : '新增薪資紀錄'} onClose={onClose} onSubmit={onSubmit}>
      {/* ★ 同月已有 payroll_record 警告 */}
      {payrollWarning && !editingRecord && (
        <div style={{
          padding: '10px 12px', borderRadius: 8,
          background: 'rgba(251,146,60,0.1)', border: '1px solid var(--accent-orange)',
          color: 'var(--accent-orange)', fontSize: 12, display: 'flex', alignItems: 'flex-start', gap: 6,
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{payrollWarning}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="員工" required>
          <EmpSelect value={form.employee} onChange={v => set('employee', v)} employees={employees} departments={departments} />
        </Field>
        <Field label="月份">
          <input className="form-input" type="month" style={{ width: '100%' }} value={form.month} onChange={e => set('month', e.target.value)} />
        </Field>
      </div>

      {/* ─── 薪資項目（拆分津貼欄位，跟 SalaryStructures 對齊）─── */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-green)', margin: '8px 0 4px' }}>▲ 薪資項目</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="底薪">
          <input className="form-input" type="number" placeholder="0" value={form.base_salary} onChange={e => set('base_salary', e.target.value)} />
        </Field>
        <Field label="職務津貼">
          <input className="form-input" type="number" placeholder="0" value={form.role_allowance} onChange={e => set('role_allowance', e.target.value)} />
        </Field>
        <Field label="餐費津貼">
          <input className="form-input" type="number" placeholder="0" value={form.meal_allowance} onChange={e => set('meal_allowance', e.target.value)} />
        </Field>
        <Field label="交通津貼">
          <input className="form-input" type="number" placeholder="0" value={form.transport_allowance} onChange={e => set('transport_allowance', e.target.value)} />
        </Field>
        <Field label="全勤獎金">
          <input className="form-input" type="number" placeholder="0" value={form.attendance_bonus} onChange={e => set('attendance_bonus', e.target.value)} />
        </Field>
        <Field label="加班費">
          <input className="form-input" type="number" placeholder="0" value={form.overtime_pay} onChange={e => set('overtime_pay', e.target.value)} />
        </Field>
        <Field label="其他獎金">
          <input className="form-input" type="number" placeholder="0" value={form.bonus} onChange={e => set('bonus', e.target.value)}
            style={{ borderColor: 'var(--accent-purple)' }} />
        </Field>
      </div>

      {/* ─── 自訂津貼（同 SalaryStructures pattern）─── */}
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
            🎁 自訂津貼（選員工後會自動帶入薪資結構的設定）
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
                onClick={() => !used && addCustomAllowance(name)}
                disabled={used}
                style={{
                  padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: used ? 'default' : 'pointer',
                  border: '1px solid var(--border-subtle)',
                  background: used ? 'var(--bg-tertiary)' : 'transparent',
                  color: used ? 'var(--text-muted)' : 'var(--accent-cyan)',
                  opacity: used ? 0.5 : 1,
                }}
              >
                {used ? '✓ ' : '+ '}{name}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => addCustomAllowance('')}
            style={{
              padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
              border: '1px dashed var(--accent-purple)',
              background: 'rgba(167,139,250,0.08)', color: 'var(--accent-purple)',
            }}
          >+ 完全自訂</button>
        </div>
        {(form.custom_allowances || []).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {form.custom_allowances.map((c, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  className="form-input"
                  placeholder="津貼名稱"
                  value={c.name}
                  onChange={e => updateCustomAllowance(idx, 'name', e.target.value)}
                  style={{ flex: 2 }}
                />
                <input
                  className="form-input"
                  type="number"
                  placeholder="金額"
                  value={c.amount}
                  onChange={e => updateCustomAllowance(idx, 'amount', e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => removeCustomAllowance(idx)}
                  style={{
                    background: 'transparent', border: '1px solid var(--border-subtle)',
                    color: 'var(--accent-red)', cursor: 'pointer',
                    borderRadius: 6, padding: 6, display: 'flex',
                  }}
                ><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── 保險參數 ─── */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-orange)', margin: '12px 0 4px' }}>⚙ 保險參數</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="健保眷屬人數">
          <input className="form-input" type="number" min="0" max="3" value={form.dependents} onChange={e => set('dependents', e.target.value)} />
        </Field>
        <Field label="勞退自提比率 (%)">
          <input className="form-input" type="number" min="0" max="6" step="1" placeholder="0" value={form.voluntary_pension_rate} onChange={e => set('voluntary_pension_rate', e.target.value)} />
        </Field>
      </div>

      {/* ─── 其他扣款 ─── */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-red)', margin: '12px 0 4px' }}>▼ 其他扣款</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="事假扣薪">
          <input className="form-input" type="number" placeholder="0" value={form.absence_deduction} onChange={e => set('absence_deduction', e.target.value)} />
        </Field>
        <Field label="遲到扣薪">
          <input className="form-input" type="number" placeholder="0" value={form.late_deduction} onChange={e => set('late_deduction', e.target.value)} />
        </Field>
        <Field label="其他扣款">
          <input className="form-input" type="number" placeholder="0" value={form.other_deduction} onChange={e => set('other_deduction', e.target.value)} />
        </Field>
      </div>
      <Field label="其他扣款說明">
        <input className="form-input" type="text" placeholder="例：預支薪資扣還、公司借款..." value={form.deduction_note} onChange={e => set('deduction_note', e.target.value)} />
      </Field>

      {/* ─── 即時計算預覽 ─── */}
      <div style={{ background: 'var(--glass-light)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--border-medium)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
          <Calculator size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          自動計算預覽（即時更新）
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card)' }}>
            <span style={{ color: 'var(--text-muted)' }}>津貼合計（含自訂 {deductions.customAllowancesTotal > 0 ? `${fmt(deductions.customAllowancesTotal)}` : '無'}）</span>
            <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{fmt(deductions.allowancesTotal)}</span>
          </div>
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
