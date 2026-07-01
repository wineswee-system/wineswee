import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function NotificationPanel({ onClose, markSeen }) {
  const [mentions, setMentions] = useState([])
  const [loading, setLoading] = useState(true)
  const panelRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    supabase.rpc('web_get_my_recent_mentions').then(({ data }) => {
      setMentions(data || [])
      setLoading(false)
    })
    // 開啟時把未讀全部標為已讀
    markSeen()
  }, [markSeen])

  // 點外面關閉
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const goToTask = (taskId) => {
    onClose()
    navigate(`/process/tasks?task=${taskId}`)
  }

  return (
    <div ref={panelRef} style={{
      position: 'absolute', top: 40, right: 0, width: 320,
      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
      borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      zIndex: 9999, overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>💬 我的 @mention</span>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', fontSize: 16, lineHeight: 1,
        }}>×</button>
      </div>

      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>載入中…</div>
        ) : mentions.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>目前沒有被標記的紀錄</div>
        ) : mentions.map(m => (
          <div
            key={m.mention_id}
            onClick={() => goToTask(m.task_id)}
            style={{
              padding: '10px 16px', cursor: 'pointer',
              borderBottom: '1px solid var(--border-subtle)',
              background: m.seen_at ? 'transparent' : 'var(--accent-blue-dim)',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-light)'}
            onMouseLeave={e => e.currentTarget.style.background = m.seen_at ? 'transparent' : 'var(--accent-blue-dim)'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)' }}>
                {m.mentioned_by || '有人'} 提到你
              </span>
              {!m.seen_at && (
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--accent-blue)', flexShrink: 0, marginTop: 3,
                }} />
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 3 }}>
              📋 {m.task_title || '未命名任務'}
            </div>
            {m.comment_content && (
              <div style={{
                fontSize: 12, color: 'var(--text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {m.comment_content.length > 60 ? m.comment_content.slice(0, 60) + '…' : m.comment_content}
              </div>
            )}
            {m.occurred_at && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                {new Date(m.occurred_at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
