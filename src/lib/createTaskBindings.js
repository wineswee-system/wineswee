// 建立任務後，統一處理綁定表單：建 binding（帶自己填/他人填 + 指派）→ 自己填有暫存就落地。
// 各建任務入口(任務/專案/流程/範本部署) 共用，避免每處各寫一份而漂移。

import { supabase } from './supabase'
import { commitBindingDraft } from './commitBindingDraft'
import { bindingFillPath } from '../components/tasks/bindingFillUrl'

// requiredForms: Array<{ form_type, form_template_id, fill_mode?, assignee_id?, _draft?, label? }>
// 回傳「建立後需跳出填」的佇列（自己填、可填、但沒當場暫存的；通常是重型表單），無則 null。
export async function createTaskBindings(taskId, requiredForms, profile, { onDraftError } = {}) {
  for (const f of (requiredForms || [])) {
    const { data: bRes } = await supabase.rpc('create_task_form_binding', {
      p_task_id: taskId,
      p_form_type: f.form_type,
      p_form_template_id: f.form_template_id || null,
      p_fill_mode: f.fill_mode || 'self',
      p_assignee_id: f.fill_mode === 'other' ? (f.assignee_id || null) : null,
    })
    const bId = bRes?.binding_id
    if (bId && f.fill_mode !== 'other' && f._draft) {
      try { await commitBindingDraft(bId, f, profile) }
      catch (e) { onDraftError?.(f, e) }
    }
  }
  return buildSelfFillQueue(taskId, requiredForms)
}

export async function buildSelfFillQueue(taskId, requiredForms) {
  const pendingSelf = (requiredForms || []).filter(f => f.fill_mode !== 'other' && !f._draft)
  if (!pendingSelf.length) return null
  const { data: bRows } = await supabase.from('task_form_bindings').select('*').eq('task_id', taskId).order('id')
  const queue = (bRows || []).filter(r =>
    r.fill_mode !== 'other' && !r.form_id && bindingFillPath(r, bRows) &&
    pendingSelf.some(p => p.form_type === r.form_type && (p.form_template_id ?? null) === (r.form_template_id ?? null))
  )
  return queue.length ? { bindings: queue, all: bRows } : null
}
