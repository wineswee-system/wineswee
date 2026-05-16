import { useState, useRef } from 'react'
import { X, Upload } from 'lucide-react'
import {
  createTaskComment,
  createTaskAttachment, deleteTaskAttachment,
} from '../../lib/db'
import { toast } from '../../lib/toast'

const labelStyle = { fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 6, marginTop: 18 }
const sectionStyle = {
  padding: '16px 20px', marginBottom: 12, borderRadius: 10,
  background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
}

export default function TaskDiscussionTab({
  task,
  profile,
  attachments, setAttachments,
  comments, setComments,
  openInput, closeInput,
}) {
  const [commentText, setCommentText] = useState('')
  const commentsListRef = useRef(null)

  // ── Attachments ──
  const handleAddAttachment = () => {
    openInput(
      '新增附件',
      '檔案 URL（須以 https:// 開頭）：',
      (url) => {
        if (!url.startsWith('https://')) { toast.warning('請輸入有效的 https:// 網址'); return }
        openInput(
          '新增附件',
          '檔案名稱：',
          (name) => {
            closeInput()
            createTaskAttachment({ task_id: task.id, file_name: name, file_url: url, uploaded_by: '使用者' })
              .then(({ data }) => { if (data) setAttachments(prev => [...prev, data]) })
          },
          { placeholder: '例如：合約.pdf' }
        )
      },
      { placeholder: 'https://...' }
    )
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
          <button className="btn btn-sm btn-secondary" style={{ fontSize: 11 }} onClick={handleAddAttachment}>
            <Upload size={11} /> 上傳
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
            <a href={a.file_url} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--accent-cyan)' }}>
              📄 {a.file_name}
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
