import { useState, useRef } from 'react'
import { createTaskComment } from '../../lib/db'
import TaskAttachmentsTab from './TaskAttachmentsTab'

const labelStyle = { fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 6, marginTop: 18 }
const sectionStyle = {
  padding: '16px 20px', marginBottom: 12, borderRadius: 10,
  background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
}

export default function TaskDiscussionTab({ task, profile, attachments, setAttachments, comments, setComments }) {
  const [commentText, setCommentText] = useState('')
  const commentsListRef = useRef(null)

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
      <TaskAttachmentsTab
        task={task}
        profile={profile}
        attachments={attachments}
        setAttachments={setAttachments}
      />

      <div style={sectionStyle}>
        <div style={{ ...labelStyle, marginTop: 0 }}>💬 備註 ({comments.length})</div>
        <div ref={commentsListRef} style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 8 }}>
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
