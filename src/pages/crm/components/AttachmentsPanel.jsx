import { useState, useEffect, useRef } from 'react'
import { Upload, Trash2, FileText, Image, File } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { getCRMAttachments, createCRMAttachment, deleteCRMAttachment } from '../../../lib/db'

import { toast } from '../../../lib/toast'
import { confirm } from '../../../lib/confirm'
function formatSize(bytes) {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(type) {
  if (!type) return File
  if (type.startsWith('image/')) return Image
  return FileText
}

/**
 * Reusable file attachments panel for any CRM entity.
 * Props: entityType, entityId
 */
export default function AttachmentsPanel({ entityType, entityId }) {
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!entityType || !entityId) return
    getCRMAttachments(entityType, entityId)
      .then(({ data }) => setAttachments(data || []))
      .finally(() => setLoading(false))
  }, [entityType, entityId])

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  const MAX_SIZE = 10 * 1024 * 1024 // 10MB

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!ALLOWED_TYPES.includes(file.type)) { toast.error('不支援此檔案類型'); return }
    if (file.size > MAX_SIZE) { toast.error('檔案大小不可超過 10MB'); return }
    setUploading(true)
    try {
      const path = `crm/${entityType}/${entityId}/${Date.now()}_${file.name}`
      const { error: uploadErr } = await supabase.storage.from('attachments').upload(path, file)
      if (uploadErr) throw uploadErr

      const { data, error: dbErr } = await createCRMAttachment({
        entity_type: entityType,
        entity_id: entityId,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type,
        storage_path: path,
        uploaded_by: '系統使用者',
      })
      if (dbErr) throw dbErr
      setAttachments(prev => [data, ...prev])
    } catch (err) {
      toast.error('上傳失敗：' + (err.message || '未知錯誤'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDelete = async (att) => {
    if (!(await confirm({ message: `確定要刪除 ${att.file_name}？` }))) return
    await supabase.storage.from('attachments').remove([att.storage_path])
    await deleteCRMAttachment(att.id)
    setAttachments(prev => prev.filter(a => a.id !== att.id))
  }

  const handleDownload = async (att) => {
    const { data } = supabase.storage.from('attachments').getPublicUrl(att.storage_path)
    if (data?.publicUrl) window.open(data.publicUrl, '_blank')
  }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>載入中...</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>附件 ({attachments.length})</span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600 }}>
          <Upload size={12} /> {uploading ? '上傳中...' : '上傳檔案'}
          <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      {attachments.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12, textAlign: 'center', border: '1px dashed var(--border-medium)', borderRadius: 8 }}>
          尚無附件，點擊上方「上傳檔案」新增
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {attachments.map(att => {
          const Icon = getFileIcon(att.file_type)
          return (
            <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: 'var(--glass-light)' }}>
              <Icon size={16} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{ fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--accent-cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onClick={() => handleDownload(att)}
                  title={att.file_name}
                >
                  {att.file_name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {formatSize(att.file_size)} · {new Date(att.created_at).toLocaleDateString('zh-TW')}
                </div>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }} onClick={() => handleDelete(att)} title="刪除">
                <Trash2 size={12} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
