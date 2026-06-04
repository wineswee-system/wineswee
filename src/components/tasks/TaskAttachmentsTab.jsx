import { useState, useRef } from 'react'
import { X, Upload, Loader2 } from 'lucide-react'
import { createTaskAttachment, deleteTaskAttachment } from '../../lib/db'
import { toast } from '../../lib/toast'
import { supabase } from '../../lib/supabase'
import { safeStorageName } from '../../lib/storageSanitize'

const MAX_SIZE = 10 * 1024 * 1024
const BLOCKED_EXT = new Set(['exe', 'bat', 'sh', 'cmd', 'ps1', 'scr', 'vbs', 'msi', 'com'])

const fileIcon = (name) => {
  const ext = name?.split('.').pop()?.toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️'
  if (ext === 'pdf') return '📕'
  if (['xlsx', 'xls', 'csv'].includes(ext)) return '📊'
  if (['docx', 'doc'].includes(ext)) return '📝'
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️'
  return '📄'
}

const sectionStyle = {
  padding: '16px 20px', marginBottom: 12, borderRadius: 10,
  background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
}
const labelStyle = { fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 6 }

export default function TaskAttachmentsTab({ task, profile, attachments, setAttachments }) {
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (BLOCKED_EXT.has(ext)) { toast.error('不允許上傳可執行檔案'); return }
    if (file.size > MAX_SIZE) { toast.error('檔案超過 10 MB 限制'); return }

    const sanitizedFileName = safeStorageName(file.name)
    const storagePath = `${task.id}/${Date.now()}_${sanitizedFileName}`

    setUploading(true)
    try {
      const { error: uploadError } = await supabase.storage
        .from('task-attachments')
        .upload(storagePath, file, { upsert: false })
      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage.from('task-attachments').getPublicUrl(storagePath)
      const fileUrl = urlData?.publicUrl
      if (!fileUrl) throw new Error('無法取得公開網址')

      // 詳情頁上傳一律當「回報附件」— 發起附件只在 TaskNew 預選階段建立
      const { data, error: dbError } = await createTaskAttachment({
        task_id: task.id,
        file_name: sanitizedFileName,
        file_url: fileUrl,
        uploaded_by: profile?.name || '使用者',
        kind: 'reporter',
      })
      if (dbError) throw dbError
      if (data) setAttachments(prev => [...prev, data])
      toast.success('附件已上傳')
    } catch (err) {
      console.error('[TaskAttachmentsTab] upload error', err)
      toast.error(err?.message || '上傳失敗，請再試一次')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id) => {
    await deleteTaskAttachment(id)
    setAttachments(prev => prev.filter(x => x.id !== id))
  }

  const initiatorList = attachments.filter(a => (a.kind || 'reporter') === 'initiator')
  const reporterList  = attachments.filter(a => (a.kind || 'reporter') === 'reporter')

  const renderRow = (a) => (
    <div key={a.id} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 10px', background: 'var(--glass-light)', borderRadius: 8,
      marginBottom: 4, border: '1px solid var(--border-subtle)', fontSize: 12,
    }}>
      <a href={a.file_url} target="_blank" rel="noreferrer noopener"
        style={{ color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span style={{ flexShrink: 0 }}>{fileIcon(a.file_name)}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.file_name}</span>
      </a>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 8 }}>
        {a.uploaded_by && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.uploaded_by}</span>
        )}
        <button onClick={() => handleDelete(a.id)} style={{
          background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0,
        }}>
          <X size={13} />
        </button>
      </div>
    </div>
  )

  return (
    <div style={sectionStyle}>
      {/* ── 發起附件（read-only 但可下載）── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ ...labelStyle, marginBottom: 6 }}>
          📎 發起附件 ({initiatorList.length})
        </div>
        {initiatorList.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
            發起人未附檔
          </div>
        ) : initiatorList.map(renderRow)}
      </div>

      {/* ── 回報附件 ── */}
      <div>
        <div style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span>📎 回報附件 ({reporterList.length})</span>
          <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileSelected} />
          <button
            className="btn btn-sm btn-secondary"
            style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading
              ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> 上傳中...</>
              : <><Upload size={11} /> 上傳附件</>}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          支援所有檔案類型（不含執行檔），單檔上限 10 MB
        </div>
        {reporterList.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
            尚無回報附件
          </div>
        ) : reporterList.map(renderRow)}
      </div>
    </div>
  )
}
