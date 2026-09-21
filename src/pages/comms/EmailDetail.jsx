import { useParams } from 'react-router-dom'

export default function EmailDetail() {
  const { threadId } = useParams()
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: 20, fontWeight: 600 }}>郵件執行緒</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Thread ID: {threadId}</p>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>執行緒檢視、回覆、標籤、ERP 連結、員工識別標章 — Phase 2</p>
    </div>
  )
}
