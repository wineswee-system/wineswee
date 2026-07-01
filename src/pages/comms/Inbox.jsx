import { useState } from 'react'

export default function Inbox() {
  const [_search, setSearch] = useState('')

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>收件匣</h1>
        <span style={{
          fontSize: 12, padding: '2px 8px', borderRadius: 10,
          background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
        }}>Phase 2</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
        電子郵件收件匣 — IMAP 同步、執行緒檢視、AI 標籤、共用信箱
      </p>
      <div style={{
        marginTop: 32, padding: 24, borderRadius: 10,
        border: '1px dashed var(--border-medium)',
        background: 'var(--bg-secondary)',
        textAlign: 'center', color: 'var(--text-muted)', fontSize: 14,
      }}>
        建設中 — 請先至「帳號設定」連接電子郵件帳號
      </div>
    </div>
  )
}
