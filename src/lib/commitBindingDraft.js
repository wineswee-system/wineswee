// 任務綁定表單「自己填」暫存式(A 模式)的落地 helper。
//
// 流程：新增任務時點「自己填」→ 當場填表單 → 內容暫存成 draft（不寫 DB）→
// 按「儲存」建立任務 + 綁定後，才用這裡的函式把暫存內容正式送出，並寫 linked_binding_id。
//
// 各建任務頁(Tasks / Projects…) 共用，避免落地邏輯漂移。

import { supabase } from './supabase'
import { safeStorageName } from './storageSanitize'
import { createApprovalWorkflow } from './workflowIntegration'

const EXPENSE_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
const MAX_SIZE = 10 * 1024 * 1024

// ── 自訂表單 draft：{ templateId, data } ──
export async function commitFormSubmissionDraft(bindingId, draft, profile) {
  const { error } = await supabase.from('form_submissions').insert({
    organization_id: profile?.organization_id || 1,
    template_id: Number(draft.templateId),
    applicant_id: profile?.id,
    data: draft.data,
    status: '申請中',
    linked_binding_id: bindingId ? Number(bindingId) : null,
  })
  if (error) throw error
}

async function uploadExpenseFiles(requestId, fileList, employeeName) {
  const results = []
  for (const file of (fileList || [])) {
    if (!file) continue
    if (!EXPENSE_ALLOWED_TYPES.includes(file.type)) continue
    if (file.size > MAX_SIZE) continue
    const path = `expense-requests/${requestId}/request/${Date.now()}_${safeStorageName(file.name)}`
    const { error: upErr } = await supabase.storage.from('attachments').upload(path, file)
    if (upErr) continue
    const { data } = await supabase.from('expense_request_attachments').insert({
      request_id: requestId, file_name: file.name, storage_path: path,
      file_size: file.size, file_type: file.type, stage: 'request', uploaded_by: employeeName || '系統',
    }).select().single()
    if (data) results.push(data)
  }
  return results
}

// ── 費用申請 draft：{ payload, files }（payload 已含 organization_id / employee / items…）──
export async function commitExpenseDraft(bindingId, draft, _profile) {
  const payload = {
    ...draft.payload,
    status: '申請中',
    linked_binding_id: bindingId ? Number(bindingId) : null,
  }
  const { data, error } = await supabase.from('expense_requests').insert(payload).select().single()
  if (error) throw error

  if (draft.files?.length && data) await uploadExpenseFiles(data.id, draft.files, payload.employee)

  if (data) {
    try {
      const wfResult = await createApprovalWorkflow('expense_request', data, payload.employee)
      if (wfResult?.instance?.id) {
        await supabase.from('expense_requests').update({ workflow_instance_id: wfResult.instance.id }).eq('id', data.id)
      }
    } catch { /* workflow 失敗不擋單據建立；UI 端會再提示 */ }
  }
  return data
}

// 依 form_type 落地一張暫存表單
export async function commitBindingDraft(bindingId, item, profile) {
  if (!item?._draft) return
  if (item.form_type === 'form_submission') {
    await commitFormSubmissionDraft(bindingId, item._draft, profile)
  } else if (item.form_type === 'expense_request' || item.form_type === 'expense_apply') {
    await commitExpenseDraft(bindingId, item._draft, profile)
  }
}

// 此 form_type 是否支援「自己填當場暫存」(A 模式)；不支援的走建立後跳出
export function isDraftableType(formType) {
  return formType === 'form_submission' || formType === 'expense_request' || formType === 'expense_apply'
}
