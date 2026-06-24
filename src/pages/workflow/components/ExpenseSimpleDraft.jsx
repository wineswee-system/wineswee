import { useState, useEffect } from 'react'
import { Paperclip } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'
import { supabase } from '../../../lib/supabase'
import { getAccounts } from '../../../lib/db'
import { validateRequired, clearError } from '../../../lib/formValidation'
import { useAuth } from '../../../contexts/AuthContext'

// 經常性費用「擷取模式」表單 — 填完只整理成 draft（payload + attachFiles）回傳，不寫 DB。
// 給新增任務「自己填(暫存式)」用；落地由 lib/commitBindingDraft.commitSimpleExpenseDraft 在任務儲存時做。
//
// props: { initialDraft, onCapture(draft), onClose }

export default function ExpenseSimpleDraft({ initialDraft, onCapture, onClose }) {
  const { profile } = useAuth()
  const [employees, setEmployees] = useState([])
  const [accounts, setAccounts] = useState([])
  const [form, setForm] = useState(() => initialDraft?.payload || { employee: profile?.name || '', category: '', amount: '', date: '', description: '', receipt: true })
  const [attachFiles, setAttachFiles] = useState(() => initialDraft?.attachFiles || [])
  const [errors, setErrors] = useState({})

  useEffect(() => {
    const orgId = profile?.organization_id
    let empQ = supabase.from('employees').select('id, name, name_en, dept, position').eq('status', '在職').order('name')
    if (orgId) empQ = empQ.eq('organization_id', orgId)
    Promise.all([empQ, getAccounts(orgId)]).then(([eRes, aRes]) => {
      const emps = eRes?.data || []
      const accs = aRes?.data || []
      setEmployees(emps)
      setAccounts(accs)
      setForm(f => ({ ...f, employee: f.employee || profile?.name || emps[0]?.name || '', category: f.category || accs[0]?.name || '' }))
    })
  }, [profile?.organization_id, profile?.name])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || [])
    setAttachFiles(prev => [...prev, ...files.map(f => ({ file: f }))].slice(0, 5))
    e.target.value = ''
  }
  const removeAttach = (idx) => setAttachFiles(prev => prev.filter((_, i) => i !== idx))

  const handleCapture = () => {
    if (!validateRequired(form, ['employee', 'category', 'amount', 'date', 'description'], setErrors)) return false
    const empId = employees.find(e => e.name === form.employee)?.id || null
    onCapture?.({ payload: { ...form }, attachFiles, empId })
    onClose?.()
  }

  return (
    <Modal title="填寫經常性費用申請" onClose={() => onClose?.()} onSubmit={handleCapture} submitLabel="完成填寫">
      <Field label="員工" required error={errors.employee} errorMsg="請選擇員工">
        <SearchableSelect
          value={form.employee}
          onChange={(v) => { set('employee', v || ''); clearError('employee', setErrors) }}
          options={empOptions(employees, { keyBy: 'name' })}
          placeholder="搜尋員工姓名/職稱..."
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="會計科目" required error={errors.category} errorMsg="請選會計科目">
          <select className="form-input" style={{ width: '100%' }} value={form.category} onChange={e => { set('category', e.target.value); clearError('category', setErrors) }}>
            <option value="">— 請選擇會計科目 —</option>
            {accounts.map(a => <option key={a.id ?? a.code} value={a.name}>{a.code} {a.name}</option>)}
          </select>
        </Field>
        <Field label="金額 (NT$)" required error={errors.amount} errorMsg="請填寫金額">
          <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.amount} onChange={e => { set('amount', e.target.value); clearError('amount', setErrors) }} />
        </Field>
      </div>
      <Field label="日期" required error={errors.date} errorMsg="請選日期">
        <input className="form-input" type="date" style={{ width: '100%' }} value={form.date} onChange={e => { set('date', e.target.value); clearError('date', setErrors) }} />
      </Field>
      <Field label="說明" required error={errors.description} errorMsg="請填寫費用說明">
        <input className="form-input" type="text" style={{ width: '100%' }} placeholder="費用說明" value={form.description} onChange={e => { set('description', e.target.value); clearError('description', setErrors) }} />
      </Field>
      <Field label="收據">
        <select className="form-input" style={{ width: '100%' }} value={form.receipt} onChange={e => set('receipt', e.target.value === 'true')}>
          <option value="true">有收據</option>
          <option value="false">無收據</option>
        </select>
      </Field>
      <Field label="收據附件（最多 5 個）">
        <div>
          <input type="file" multiple accept="image/*,application/pdf" onChange={handleFileSelect} style={{ fontSize: 12 }} />
          {attachFiles.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {attachFiles.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                  <Paperclip size={11} />
                  <span style={{ flex: 1 }}>{a.file.name}</span>
                  <button type="button" onClick={() => removeAttach(i)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Field>
    </Modal>
  )
}
