import { useParams } from 'react-router-dom'

export default function BookingPublicPage() {
  const { slug } = useParams()
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>選擇時間</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 9</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>公開預約頁 — 外部用戶選擇可用時段並預約</p>
    </div>
  )
}
