export default function AccountSettings() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>帳號設定</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 1</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>連接 Gmail／Outlook／iCloud／IMAP 帳號、同步狀態、CalDAV／CardDAV 設定</p>
    </div>
  )
}
