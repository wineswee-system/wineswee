import { useState, useRef } from 'react'
import { X, Upload, Loader2 } from 'lucide-react'
import {
  createTaskComment,
  createTaskAttachment, deleteTaskAttachment,
} from '../../lib/db'
import { toast } from '../../lib/toast'
import { supabase } from '../../lib/supabase'

const labelStyle = { fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 6, marginTop: 18 }
const sectionStyle = {
  padding: '16px 20px', marginBottom: 12, borderRadius: 10,
  background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
}

const fileIcon = (name) => {
  const ext = name?.split('.').pop()?.toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️'
  if (ext === 'pdf') return '📕'
  if (['xlsx', 'xls', 'csv'].includes(ext)) return '📊'
  if (['docx', 'doc'].includes(ext)) return '📝'
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️'
  return '📄'
}

export default function TaskDiscussionTab({
  task,
  profile,
  attachments, setAttachments,
  comments, setComments,
  openInput, closeInput,
}) {
  const [commentText, setCommentText] = useState('')
  const [uploading, setUploading] = useState(false)
  const commentsListRef = useRef(null)
  const fileInputRef = useRef(null)

  // ── Attachments ──

  /** Trigger the hidden file input */
  const handleAddAttachment = () => {
    fileInputRef.current?.click()
  }

  /** Handle file selected from OS picker */
  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset so the same file can be re-selected after a failure
    e.target.value = ''

    const sanitizedFileName = file.name.replace(/\s+/g, '_')
    const storagePath = `${task.id}/${Date.now()}_${sanitizedFileName}`

    setUploading(true)
    try {
      // 1. Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('task-attachments')
        .upload(storagePath, file, { upsert: false })

      if (uploadError) throw uploadError

      // 2. Get the public URL
      const { data: urlData } = supabase.storage
        .from('task-attachments')
        .getPublicUrl(storagePath)

      const fileUrl = urlData?.publicUrl
      if (!fileUrl) throw new Error('無法取得公開網址')

      // 3. Persist the attachment record
      const { data, error: dbError } = await createTaskAttachment({
        task_id: task.id,
        file_name: sanitizedFileName,
        file_url: fileUrl,
        uploaded_by: profile?.name || '使用者',
      })

      if (dbError) throw dbError
      if (data) setAttachments(prev => [...prev, data])

      // 4. Success feedback
      toast.success('附件已上傳')
    } catch (err) {
      console.error('[TaskDiscussionTab] upload error', err)
      toast.error(err?.message || '上傳失敗，請再試一次')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteAttachment = async (id) => {
    await deleteTaskAttachment(id)
    setAttachments(prev => prev.filter(x => x.id !== id))
  }

  // ── Comments ──
  const handleSendComment = async () => {
    if (!commentText.trim()) return
    const { data } = await createTaskComment({
      task_id: task.id,
      author: profile?.name || '使用者',
      content: commentText.trim(),
    })
    if (data) {
      setComments(prev => [...prev, data])
      requestAnimationFrame(() => {
        const el = commentsListRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    }
    setCommentText('')
  }

  return (
    <>
      {/* ═══ Attachments ═══ */}
      <div style={sectionStyle}>
        <div style={{ ...labelStyle, marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>📎 附件 ({attachments.length})</span>

          {/* Hidden real file input — triggered by handleAddAttachment */}
          <input
            ref={fileInputRef}
            type="file"
            multiple={false}
            accept="*/*"
            style={{ display: 'none' }}
            onChange={handleFileSelected}
          />

          <button
            className="btn btn-sm btn-secondary"
            style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={handleAddAttachment}
            disabled={uploading}
          >
            {uploading
              ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> 上傳中...</>
              : <><Upload size={11} /> 上傳</>
            }
          </button>
        </div>

        {attachments.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>尚無附件</div>
        ) : attachments.map(a => (
          <div key={a.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px', background: 'var(--glass-light)', borderRadius: 8,
            marginBottom: 4, border: '1px solid var(--border-subtle)', fontSize: 12,
          }}>
            <a href={a.file_url} target="_blank" rel="noreferrer noopener"
              style={{ color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>{fileIcon(a.file_name)}</span>
              <span>{a.file_name}</span>
            </a>
            <button onClick={() => handleDeleteAttachment(a.id)} style={{
              background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            }}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>

      {/* ═══ Comments ═══ */}
      <div style={sectionStyle}>
        <div style={{ ...labelStyle, marginTop: 0 }}>💬 備註 ({comments.length})</div>
        <div ref={commentsListRef} style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
          {comments.map(c => (
            <div key={c.id} style={{
              padding: '8px 12px', marginBottom: 6, borderRadius: 8,
              background: 'var(--glass-light)', border: '1px solid var(--border-subtle)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)' }}>⚙️ {c.author}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {new Date(c.created_at).toLocaleString('zh-TW')}
                </span>
              </div>
              <div style={{ fontSize: 13 }}>🚩 {c.content}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="form-input" type="text" style={{ flex: 1 }}
            placeholder="輸入備註..."
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendComment()} />
          <button className="btn btn-primary" onClick={handleSendComment}
            style={{ fontSize: 12, padding: '8px 14px' }}>
            送出
          </button>
        </div>
      </div>
    </>
  )
}
