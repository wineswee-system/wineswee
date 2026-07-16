import { supabase } from './supabase'
import { createTaskAttachment } from './db'
import { safeStorageName } from './storageSanitize'

// 任務附件共用規則（與 TaskAttachmentsTab 對齊）
const BLOCKED_EXT = new Set(['exe', 'bat', 'sh', 'cmd', 'ps1', 'scr', 'vbs', 'msi', 'com'])
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

/** 驗證選檔；不合格回錯誤訊息字串，合格回 null */
export function validateTaskFile(file) {
  const ext = file?.name?.split('.').pop()?.toLowerCase()
  if (BLOCKED_EXT.has(ext)) return '不允許上傳可執行檔案'
  if (file.size > MAX_ATTACHMENT_SIZE) return '檔案超過 10 MB 限制'
  return null
}

/**
 * 任務建立後，把使用者在「新增任務」時預選的檔案上傳為「發起附件」(kind='initiator')。
 * 非阻斷：任務已建立，某檔失敗不影響其他檔。回上傳成功數。
 */
export async function uploadInitiatorAttachments(taskId, files, uploadedBy) {
  if (!taskId || !files?.length) return 0
  let done = 0
  for (const file of files) {
    try {
      const sanitizedFileName = safeStorageName(file.name)
      const storagePath = `${taskId}/${Date.now()}_${sanitizedFileName}`
      const { error } = await supabase.storage
        .from('task-attachments')
        .upload(storagePath, file, { upsert: false })
      if (!error) {
        await createTaskAttachment({
          task_id: taskId,
          file_name: sanitizedFileName,
          storage_path: storagePath,
          uploaded_by: uploadedBy || '使用者',
          kind: 'initiator',
        })
        done++
      }
    } catch {
      // non-blocking — task already created
    }
  }
  return done
}
