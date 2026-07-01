import { useParams } from 'react-router-dom'

export default function ContactDetail() {
  const { contactId } = useParams()
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>聯絡人詳情</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 10</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>聯絡人資料、關聯郵件、行事曆、ERP 活動</p>
    </div>
  )
}
