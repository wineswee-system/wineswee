import { useParams } from 'react-router-dom'

export default function BookingPageEditor() {
  const { pageId } = useParams()
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>編輯預約頁面</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 9</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>設定持續時間、緩衝時間、可用視窗、問題</p>
    </div>
  )
}
