import { useState, useEffect } from 'react'
import { Paperclip, Plus } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'
import { supabase } from '../../../lib/supabase'
import { getAccounts } from '../../../lib/db'
import { validateRequired, clearError } from '../../../lib/formValidation'
import { toast } from '../../../lib/toast'
import { useAuth } from '../../../contexts/AuthContext'

// 經常性費用「擷取模式」表單 — 填完只整理成 draft（payload + attachFiles）回傳，不寫 DB。
// 給新增任務「自己填(暫存式)」用；落地由 lib/commitBindingDraft.commitSimpleExpenseDraft 在任務儲存時做。
//
// props: { initialDraft, onCapture(draft), onClose }

const emptyItem = () => ({ name: '', qty: 1, unit_price: '', subtotal: 0 })

export default function ExpenseSimpleDraft({ initialDraft, onCapture, onClose }) {
  const { profile } = useAuth()
  const [employees, setEmployees] = useState([])
  const [accounts, setAccounts] = useState([])
  const [form, setForm] = useState(() => initialDraft?.payload || { employee: profile?.name || '', category: '', date: '', description: '', receipt: true })
  const [lineItems, setLineItems] = useState(() => initialDraft?.payload?.items || [emptyItem()])
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
  const updateItem = (i, k, v) => setLineItems(items => {
    const n = [...items]
    n[i] = { ...n[i], [k]: v }
    if (k === 'qty' || k === 'unit_price') n[i].subtotal = (Number(n[i].qty) || 0) * (Number(n[i].unit_price) || 0)
    return n
  })

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || [])
    setAttachFiles(prev => [...prev, ...files.map(f => ({ file: f }))].slice(0, 5))
    e.target.value = ''
  }
  const removeAttach = (idx) => setAttachFiles(prev => prev.filter((_, i) => i !== idx))

  const handleCapture = () => {
    if (!validateRequired(form, ['employee', 'category', 'date', 'description'], setErrors)) return false
    const total = lineItems.reduce((s, li) => s + (li.subtotal || 0), 0)
    if (total <= 0) { toast.warning('請至少填一筆品項（含數量及單價）'); return false }
    const empId = employees.find(e => e.name === form.employee)?.id || null
    const validItems = lineItems.filter(li => li.name || Number(li.unit_price) > 0)
    onCapture?.({ payload: { ...form, amount: total, items: validItems }, attachFiles, empId })
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
      <Field label="會計科目" required error={errors.category} errorMsg="請選會計科目">
        <select className="form-input" style={{ width: '100%' }} value={form.category} onChange={e => { set('category', e.target.value); clearError('category', setErrors) }}>
          <option value="">— 請選擇會計科目 —</option>
          {accounts.map(a => <option key={a.id ?? a.code} value={a.name}>{a.code} {a.name}</option>)}
        </select>
      </Field>
      <Field label="品項明細" required>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 84px 72px 24px', gap: 4, marginBottom: 4 }}>
            {['品名', '數量', '單價', '小計', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, paddingLeft: 2 }}>{h}</div>
            ))}
          </div>
          {lineItems.map((li, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 84px 72px 24px', gap: 4, marginBottom: 6, alignItems: 'center' }}>
              <input className="form-input" style={{ fontSize: 13 }} type="text" placeholder="品名" value={li.name} onChange={e => updateItem(i, 'name', e.target.value)} />
              <input className="form-input" style={{ fontSize: 13 }} type="number" placeholder="1" inputMode="decimal" value={li.qty} onChange={e => updateItem(i, 'qty', e.target.value)} />
              <input className="form-input" style={{ fontSize: 13 }} type="number" placeholder="0" inputMode="decimal" value={li.unit_price} onChange={e => updateItem(i, 'unit_price', e.target.value)} />
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', paddingRight: 2 }}>
                {li.subtotal ? `NT$${Number(li.subtotal).toLocaleString()}` : '-'}
              </div>
              <button type="button" onClick={() => setLineItems(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)}
                style={{ background: 'none', border: 'none', cursor: lineItems.length > 1 ? 'pointer' : 'default', color: lineItems.length > 1 ? 'var(--accent-red)' : 'transparent', padding: 0, fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => setLineItems(prev => [...prev, emptyItem()])}>
              <Plus size={11} /> 新增品項
            </button>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)' }}>
              合計：NT$ {lineItems.reduce((s, li) => s + (li.subtotal || 0), 0).toLocaleString()}
            </span>
          </div>
        </div>
      </Field>
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
