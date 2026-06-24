import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { getAccounts, getCurrencies } from '../../../lib/db'
import { createApprovalWorkflow } from '../../../lib/workflowIntegration'
import { validateRequired } from '../../../lib/formValidation'
import { safeStorageName } from '../../../lib/storageSanitize'
import { useAuth } from '../../../contexts/AuthContext'
import { toast } from '../../../lib/toast'
import { confirm } from '../../../lib/confirm'
import ExpenseFormModal from './ExpenseFormModal'

// 自包含「新增費用申請」元件 — 給任務綁定表單在任務面板內「原生內嵌」直接填（不用 iframe）。
// 內含 state + 送出流程（insert expense_requests + 上傳附件 + 建簽核流程），
// 與費用申請頁的新增路徑等價，並寫入 linked_binding_id 讓任務同步。
//
// props: { bindingId, onClose, onDone }
//   onClose() = 取消 / 關閉；onDone() = 送出成功（caller reload / 推進佇列）

const emptyForm = {
  employee: '', account_code: '', title: '', description: '',
  estimated_amount: '', store: '', supplier: '', currency: 'TWD',
}
const emptyItem = () => ({ name: '', qty: '', unit_price: '', subtotal: 0 })

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
const MAX_SIZE = 10 * 1024 * 1024

export default function ExpenseRequestCreate({ bindingId, onClose, onDone }) {
  const { profile } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [currencies, setCurrencies] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [form, setForm] = useState({ ...emptyForm, employee: profile?.name || '' })
  const [lineItems, setLineItems] = useState([emptyItem()])
  const [files, setFiles] = useState([])
  const [isExpense, setIsExpense] = useState(true)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const orgId = profile?.organization_id
    let empQuery = supabase.from('employees')
      .select('id, name, name_en, employee_number, dept, department_id, store, store_id, position, status, signature_url')
      .eq('status', '在職').order('name')
    if (orgId) empQuery = empQuery.eq('organization_id', orgId)
    Promise.all([
      getAccounts(orgId),
      empQuery,
      supabase.from('stores').select('id, name').order('name'),
      getCurrencies(),
    ]).then(([accRes, empRes, storeRes, curRes]) => {
      setAccounts(accRes?.data || [])
      setEmployees((empRes?.data || []).filter(e => e.status === '在職'))
      setStores(storeRes?.data || [])
      setCurrencies(curRes?.data || [])
    })
  }, [profile?.organization_id, profile?.name])

  const uploadFiles = async (requestId, fileList, stage = 'request') => {
    const MAX_ATTACHMENTS_PER_STAGE = 3
    const { count: existing } = await supabase
      .from('expense_request_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('request_id', requestId).eq('stage', stage)
    const existingCount = existing || 0
    const remaining = Math.max(0, MAX_ATTACHMENTS_PER_STAGE - existingCount)
    if (remaining === 0) return []
    if (fileList.length > remaining) fileList = fileList.slice(0, remaining)
    const results = []
    for (const file of fileList) {
      if (!ALLOWED_TYPES.includes(file.type)) { toast.error(`「${file.name}」不支援此檔案類型`); continue }
      if (file.size > MAX_SIZE) { toast.error(`「${file.name}」檔案大小超過 10MB`); continue }
      const path = `expense-requests/${requestId}/${stage}/${Date.now()}_${safeStorageName(file.name)}`
      const { error: upErr } = await supabase.storage.from('attachments').upload(path, file)
      if (upErr) { toast.error(`「${file.name}」上傳失敗：${upErr.message || '未知錯誤'}`); continue }
      const { data, error: insErr } = await supabase.from('expense_request_attachments').insert({
        request_id: requestId, file_name: file.name, storage_path: path,
        file_size: file.size, file_type: file.type, stage, uploaded_by: form.employee || '系統',
      }).select().single()
      if (insErr) { toast.error(`「${file.name}」寫入失敗：${insErr.message || '未知錯誤'}`); continue }
      if (data) results.push(data)
    }
    return results
  }

  const handleSubmit = async () => {
    const validItems = lineItems.filter(li => li.name && li.qty > 0)
    const total = validItems.length > 0 ? validItems.reduce((s, li) => s + (li.subtotal || 0), 0) : Number(form.estimated_amount)

    if (isExpense) {
      const validateForm = { ...form, _total: total }
      if (!validateRequired(validateForm, ['employee', 'account_code', 'title', '_total', 'store'], setErrors, { zeroInvalid: true })) return
    } else {
      if (!validateRequired(form, ['employee', 'title'], setErrors)) return
    }

    if (files.length === 0) {
      const proceed = await confirm('尚未附上任何附件（訂購單、報價單等），確定要直接提交？')
      if (!proceed) return
    }

    setSaving(true)
    const emp = employees.find(e => e.name === form.employee)
    const acc = isExpense ? accounts.find(a => a.code === form.account_code) : null
    const orgId = profile?.organization_id ?? null
    if (!orgId) { toast.error('身份未載入完成，請重新登入再操作'); setSaving(false); return }

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
      status: '申請中',
      linked_binding_id: bindingId ? Number(bindingId) : null,
    }

    const { data, error: insErr } = await supabase.from('expense_requests').insert(payload).select().single()
    if (insErr) { toast.error('送出失敗：' + insErr.message); setSaving(false); return }

    if (files.length > 0 && data) await uploadFiles(data.id, files, 'request')

    if (data) {
      try {
        const wfResult = await createApprovalWorkflow('expense_request', data, form.employee)
        if (wfResult?.error) toast.error('簽核流程建立失敗：' + (wfResult.error.message || wfResult.error))
        if (wfResult?.instance?.id) {
          await supabase.from('expense_requests').update({ workflow_instance_id: wfResult.instance.id }).eq('id', data.id)
        }
      } catch (e) {
        toast.error('簽核流程建立失敗：' + (e.message || '未知錯誤'))
      }
    }

    setSaving(false)
    toast.success('已送出申請！')
    onDone?.()
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
      onSubmit={handleSubmit} saving={saving} errors={errors} setErrors={setErrors}
      currency={form.currency} currencies={currencies}
      onCurrencyChange={(v) => setForm(f => ({ ...f, currency: v }))}
    />
  )
}
