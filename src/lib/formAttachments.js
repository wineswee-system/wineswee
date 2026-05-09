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

export async function getAttachmentSignedUrl({ bucket = 'attachments', path, expiresIn = 3600 }) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
  if (error) {
    console.warn('signed url failed:', error)
    return null
  }
  return data?.signedUrl || null
}
