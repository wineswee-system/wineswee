import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { getAccounts, getCurrencies } from '../../../lib/db'
import { validateRequired } from '../../../lib/formValidation'
import { useAuth } from '../../../contexts/AuthContext'
import { confirm } from '../../../lib/confirm'
import ExpenseFormModal from './ExpenseFormModal'

// 費用申請「擷取模式」表單 — 填完只把資料整理成 draft（payload + files）回傳，不寫 DB。
// 給新增任務「自己填(暫存式)」用；真正落地由 lib/commitBindingDraft.commitExpenseDraft 在任務儲存時做。
//
// props:
//   initialDraft  上次暫存的 draft（重填時帶回）
//   onCapture(draft)  draft = { payload, files }
//   onClose()

const emptyForm = {
  employee: '', account_code: '', title: '', description: '',
  estimated_amount: '', store: '', supplier: '', currency: 'TWD',
}
const emptyItem = () => ({ name: '', qty: '', unit_price: '', subtotal: 0 })

export default function ExpenseFormDraft({ initialDraft, onCapture, onClose, busy = false }) {
  const { profile } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [currencies, setCurrencies] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [form, setForm] = useState(() => initialDraft?._formState?.form || { ...emptyForm, employee: profile?.name || '' })
  const [lineItems, setLineItems] = useState(() => initialDraft?._formState?.lineItems || [emptyItem()])
  const [files, setFiles] = useState(() => initialDraft?.files || [])
  const [isExpense, setIsExpense] = useState(() => initialDraft?._formState?.isExpense ?? true)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    const orgId = profile?.organization_id
    let empQuery = supabase.from('employees')
      .select('id, name, name_en, employee_number, dept, department_id, store, store_id, position, status, signature_url')
      .eq('status', '在職').order('name')
    if (orgId) empQuery = empQuery.eq('organization_id', orgId)
    Promise.all([getAccounts(orgId), empQuery, supabase.from('stores').select('id, name').order('name'), getCurrencies()])
      .then(([accRes, empRes, storeRes, curRes]) => {
        setAccounts(accRes?.data || [])
        setEmployees((empRes?.data || []).filter(e => e.status === '在職'))
        setStores(storeRes?.data || [])
        setCurrencies(curRes?.data || [])
      })
  }, [profile?.organization_id, profile?.name])

  const handleCapture = async () => {
    const validItems = lineItems.filter(li => li.name && li.qty > 0)
    const total = validItems.length > 0 ? validItems.reduce((s, li) => s + (li.subtotal || 0), 0) : Number(form.estimated_amount)

    if (isExpense) {
      if (!validateRequired({ ...form, _total: total }, ['employee', 'account_code', 'title', '_total', 'store'], setErrors, { zeroInvalid: true })) return
    } else {
      if (!validateRequired(form, ['employee', 'title'], setErrors)) return
    }
    if ((files || []).filter(Boolean).length === 0) {
      const proceed = await confirm({ message: '尚未附上任何附件（訂購單、報價單等），確定要直接帶入？' })
      if (!proceed) return
    }

    const emp = employees.find(e => e.name === form.employee)
    const acc = isExpense ? accounts.find(a => a.code === form.account_code) : null
    const orgId = profile?.organization_id ?? null
    const payload = {
      employee: form.employee,
      employee_id: emp?.id || null,
      department: emp?.dept || null,
      is_expense: isExpense,
      account_code: isExpense ? form.account_code : null,
      account_name: isExpense ? (acc?.name || '') : null,
      title: form.title,
      description: form.description || null,
      estimated_amount: isExpense ? total : null,
      supplier: isExpense ? (form.supplier || null) : null,
      items: isExpense ? validItems : null,
      store: isExpense ? (form.store || null) : null,
      currency: isExpense ? (form.currency || 'TWD') : 'TWD',
      organization_id: orgId,
    }
    // _formState 供重填時還原表單；files 為記憶體內 File 物件，任務儲存時才真正上傳
    // 不在此關閉：由 onCapture 持有者決定（暫存→關閉擷取視窗；即時送出→落地成功才關）
    onCapture?.({ payload, files, _formState: { form, lineItems, isExpense } })
  }

  return (
    <ExpenseFormModal
      open
      onClose={() => onClose?.()}
      form={form} setForm={setForm}
      lineItems={lineItems} setLineItems={setLineItems}
      files={files} setFiles={setFiles}
      employees={employees} accounts={accounts} stores={stores}
      editingId={null}
      isExpense={isExpense} setIsExpense={setIsExpense}
      onSubmit={handleCapture} saving={busy} errors={errors} setErrors={setErrors}
      currency={form.currency} currencies={currencies}
      onCurrencyChange={(v) => setForm(f => ({ ...f, currency: v }))}
    />
  )
}
