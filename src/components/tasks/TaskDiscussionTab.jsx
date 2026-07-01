import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import TaskAttachmentsTab from './TaskAttachmentsTab'

const labelStyle = { fontSize: 13, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 6, marginTop: 18 }
const sectionStyle = {
  padding: '16px 20px', marginBottom: 12, borderRadius: 10,
  background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
}

function getMentionQuery(text, cursorPos) {
  const before = text.slice(0, cursorPos)
  const match = before.match(/@([^\s@]*)$/)
  return match ? match[1] : null
}

function renderContent(content) {
  const parts = content.split(/(@\S+)/g)
  return parts.map((part, i) =>
    part.startsWith('@')
      ? <span key={i} style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{part}</span>
      : part
  )
}

export default function TaskDiscussionTab({ task, profile, attachments, setAttachments, comments, setComments }) {
  const [commentText, setCommentText] = useState('')
  const [mentionQuery, setMentionQuery] = useState(null) // string after @, or null
  const [colleagues, setColleagues] = useState([])
  const [mentionedIds, setMentionedIds] = useState([]) // [{id, name}]
  const [sending, setSending] = useState(false)
  const inputRef = useRef(null)
  const commentsListRef = useRef(null)

  // 載入同組織同事供 @mention
  useEffect(() => {
    if (!profile?.organization_id) return
    supabase
      .from('employees')
      .select('id, name, stores(name)')
      .eq('organization_id', profile.organization_id)
      .eq('status', '在職')
      .order('name')
      .then(({ data }) => { if (data) setColleagues(data) })
  }, [profile?.organization_id])

  const filteredColleagues = mentionQuery !== null
    ? colleagues.filter(e =>
        e.name.includes(mentionQuery) &&
        e.id !== profile?.id
      )
    : []

  const handleInput = (e) => {
    const val = e.target.value
    setCommentText(val)
    const q = getMentionQuery(val, e.target.selectionStart)
    setMentionQuery(q)
  }

  const handleKeyDown = (e) => {
    if (mentionQuery !== null && filteredColleagues.length > 0) {
      if (e.key === 'Escape') { setMentionQuery(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey && mentionQuery === null) {
      e.preventDefault()
      handleSendComment()
    }
  }

  const selectMention = useCallback((emp) => {
    const input = inputRef.current
    if (!input) return
    const cursor = input.selectionStart
    const before = commentText.slice(0, cursor)
    const after = commentText.slice(cursor)
    const replaced = before.replace(/@([^\s@]*)$/, `@${emp.name} `)
    setCommentText(replaced + after)
    setMentionQuery(null)
    setMentionedIds(prev => prev.some(m => m.id === emp.id) ? prev : [...prev, { id: emp.id, name: emp.name }])
    setTimeout(() => {
      const newCursor = replaced.length
      input.focus()
      input.setSelectionRange(newCursor, newCursor)
    }, 0)
  }, [commentText])

  const handleSendComment = async () => {
    if (!commentText.trim()) return
    setSending(true)

    // 從 mentionedIds 過濾出 content 裡還存在的 @name
    const activeMentions = mentionedIds.filter(m => commentText.includes(`@${m.name}`))
    const mentionIds = activeMentions.map(m => m.id)

    const { data, error } = await supabase.rpc('web_create_task_comment_with_mentions', {
      p_task_id: task.id,
      p_author: profile?.name || '使用者',
      p_content: commentText.trim(),
      p_author_emp_id: profile?.id ?? null,
      p_mention_ids: mentionIds.length > 0 ? mentionIds : null,
    })

    if (!error && data?.id) {
      const newComment = {
        id: data.id,
        task_id: task.id,
        author: profile?.name || '使用者',
        content: commentText.trim(),
        source: 'web',
        created_at: new Date().toISOString(),
      }
      setComments(prev => [...prev, newComment])
      requestAnimationFrame(() => {
        const el = commentsListRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    }
    setCommentText('')
    setMentionedIds([])
    setMentionQuery(null)
    setSending(false)
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
              <div style={{ fontSize: 13 }}>🚩 {renderContent(c.content)}</div>
            </div>
          ))}
        </div>

        {/* 輸入區 + @mention 下拉 */}
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea
              ref={inputRef}
              className="form-input"
              style={{ flex: 1, resize: 'none', minHeight: 38, maxHeight: 120, overflow: 'auto', lineHeight: 1.5 }}
              rows={1}
              placeholder="輸入備註… 打 @ 可以標記同事"
              value={commentText}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
            />
            <button className="btn btn-primary" onClick={handleSendComment} disabled={sending}
              style={{ fontSize: 12, padding: '8px 14px', alignSelf: 'flex-end' }}>
              {sending ? '…' : '送出'}
            </button>
          </div>

          {/* @mention 下拉 */}
          {mentionQuery !== null && filteredColleagues.length > 0 && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, right: 50,
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
              borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              zIndex: 100, marginBottom: 4,
              maxHeight: 260, overflowY: 'auto',
            }}>
              {filteredColleagues.map(emp => (
                <div
                  key={emp.id}
                  onMouseDown={e => { e.preventDefault(); selectMention(emp) }}
                  style={{
                    padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                    display: 'flex', alignItems: 'center', gap: 8,
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-light)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontWeight: 700 }}>{emp.name}</span>
                  {(emp.stores?.name) && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{emp.stores.name}</span>}
                </div>
              ))}
              <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
                ↵ 選擇 · Esc 關閉
              </div>
            </div>
          )}
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          Shift+Enter 換行 · Enter 送出 · 打 @ 標記同事並推送 LINE 通知
        </div>
      </div>
    </>
  )
}
