export default function ContactSyncSettings() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>聯絡人同步設定</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 10</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>CardDAV 帳號、同步間隔、衝突策略</p>
    </div>
  )
}
