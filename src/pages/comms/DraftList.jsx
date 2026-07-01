export default function DraftList() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>草稿</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 3</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>草稿列表、自動儲存、恢復未傳送郵件</p>
    </div>
  )
}
