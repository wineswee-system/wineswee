export default function SentItems() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>寄件備份</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 3</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>已傳送郵件、員工識別標章、傳送狀態</p>
    </div>
  )
}
