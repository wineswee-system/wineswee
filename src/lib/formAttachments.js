// 表單附件統一上傳：寫進 storage 並把 metadata 寫進 form_attachments 表
// 用在新加入附件功能的表單（Overtime / PunchCorrection ...）；舊有 attachment_url
// 直接寫 row 的表（Resignation / Transfer）暫不動，等 backfill 再說。

import { supabase } from './supabase'

const FORM_DIR = {
  leave: 'leave',
  overtime: 'overtime',
  trip: 'trip',
  correction: 'punch',
  expense: 'expense',
  expense_request: 'expense-request',
  resignation: 'resignation',
  transfer: 'transfer',
  loa: 'loa',
  shift_swap: 'shift-swap',
  off_request: 'off-request',
  goods_transfer_apply: 'goods-transfer-apply',
  goods_transfer_receipt: 'goods-transfer-receipt',
}

export async function uploadFormAttachments({
  formType,
  formId,
  files,         // [{ file: File }, ...]
  organizationId,
  uploaderEmpId,
  uploaderName,
  bucket = 'attachments',
}) {
  if (!files || files.length === 0) return { uploaded: 0, errors: [] }
  const dir = FORM_DIR[formType] || formType
  const errors = []
  let uploaded = 0

  for (const { file } of files) {
    try {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
      const path = `${dir}/emp-${uploaderEmpId || 'unknown'}/${formId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: '3600', upsert: false,
      })
      if (upErr) { errors.push({ name: file.name, error: upErr.message }); continue }

      const { error: insErr } = await supabase.from('form_attachments').insert({
        form_type: formType,
        form_id: formId,
        organization_id: organizationId || null,
        storage_bucket: bucket,
        storage_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by_id: uploaderEmpId || null,
        uploaded_by: uploaderName || null,
      })
      if (insErr) {
        errors.push({ name: file.name, error: 'metadata: ' + insErr.message })
        continue
      }
      uploaded++
    } catch (e) {
      errors.push({ name: file.name, error: e.message })
    }
  }

  return { uploaded, errors }
}

export async function listFormAttachments(formType, formId) {
  const { data, error } = await supabase.rpc('list_form_attachments', {
    p_form_type: formType,
    p_form_id: formId,
  })
  if (error) {
    console.warn('listFormAttachments failed:', error)
    return []
  }
  return data || []
}

// 複製附件到新單（複製重送用）。
//   atts：要複製的附件清單（form_attachments row，已過濾成「留下的」）；
//        每筆需含 storage_bucket / storage_path / file_name / file_size / mime_type。
//   連 storage 檔也複製一份到新路徑 → 各自獨立，刪原單不影響新單。copy 失敗才退回共用原路徑。
export async function cloneFormAttachments({ formType, toFormId, organizationId, uploaderEmpId, uploaderName, atts = [] }) {
  if (!atts.length) return { copied: 0 }
  const dir = FORM_DIR[formType] || formType
  let copied = 0
  for (const a of atts) {
    const bucket = a.storage_bucket || 'attachments'
    const ext = (a.file_name?.split('.').pop() || 'bin').toLowerCase()
    const newPath = `${dir}/emp-${uploaderEmpId || 'unknown'}/${toFormId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: cpErr } = await supabase.storage.from(bucket).copy(a.storage_path, newPath)
    const { error: insErr } = await supabase.from('form_attachments').insert({
      form_type: formType,
      form_id: toFormId,
      organization_id: organizationId || null,
      storage_bucket: bucket,
      storage_path: cpErr ? a.storage_path : newPath,
      file_name: a.file_name,
      file_size: a.file_size,
      mime_type: a.mime_type,
      uploaded_by_id: uploaderEmpId || null,
      uploaded_by: uploaderName || null,
    })
    if (!insErr) copied++
  }
  return { copied }
}

// 複製重送用：載入來源單附件並附上可點開的 signed url，
// 回傳的每筆保留 storage_bucket/storage_path/file_name/file_size/mime_type（給 cloneFormAttachments 用）+ url（給彈窗點開）。
export async function loadCarriedFormAttachments(formType, sourceId) {
  const rows = await listFormAttachments(formType, sourceId)
  return Promise.all((rows || []).map(async (a) => ({
    ...a,
    url: await getAttachmentSignedUrl({ bucket: a.storage_bucket || 'attachments', path: a.storage_path }),
  })))
}

export async function getAttachmentSignedUrl({ bucket = 'attachments', path, expiresIn = 3600 }) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
  if (error) {
    console.warn('signed url failed:', error)
    return null
  }
  return data?.signedUrl || null
}
