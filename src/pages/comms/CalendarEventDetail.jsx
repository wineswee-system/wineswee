import { useParams } from 'react-router-dom'

export default function CalendarEventDetail() {
  const { eventId } = useParams()
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>行事曆事件</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 7</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>事件詳情、與會者、ERP 連結、視訊連結</p>
    </div>
  )
}
