export default function BookingPageList() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>預約連結</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 9</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>您的 Calendly 式預約頁面列表</p>
    </div>
  )
}
