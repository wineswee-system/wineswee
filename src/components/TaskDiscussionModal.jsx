import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import TaskDiscussionTab from './tasks/TaskDiscussionTab'
import { getTaskComments, getTaskAttachments } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'

// 任務「討論」小視窗 — 從步驟任務列表的按鈕直接開,可留言/@標記同事/推 LINE,
// 不用開整個任務詳情面板。內容就是任務詳情的「討論」分頁(TaskDiscussionTab)。
export default function TaskDiscussionModal({ task, onClose }) {
  const { profile } = useAuth()
  const [comments, setComments] = useState([])
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!task) return
    let alive = true
    const safe = p => Promise.resolve(p).then(r => (r?.error ? { data: null } : r), () => ({ data: null }))
    Promise.all([safe(getTaskComments(task.id)), safe(getTaskAttachments(task.id))]).then(([c, a]) => {
      if (!alive) return
      setComments(c.data || [])
      setAttachments(a.data || [])
      setLoading(false)
    })
    return () => { alive = false }
  }, [task?.id])

  if (!task) return null

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 14, width: 'min(560px, 96vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>💬 討論 — {task.title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}><X size={20} /></button>
        </div>
        <div style={{ overflow: 'auto', padding: '12px 18px 18px' }}>
          {loading
            ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</div>
            : <TaskDiscussionTab task={task} profile={profile} comments={comments} setComments={setComments} attachments={attachments} setAttachments={setAttachments} />}
        </div>
      </div>
    </div>,
    document.body
  )
}
