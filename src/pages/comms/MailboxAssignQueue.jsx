import { useParams } from 'react-router-dom'

export default function MailboxAssignQueue() {
  const { mailboxId } = useParams()
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>指派佇列</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 5</span>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Mailbox ID: {mailboxId}</p>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>未指派郵件佇列、SLA 倒數、指派／轉派、OOO 覆蓋警告</p>
    </div>
  )
}
