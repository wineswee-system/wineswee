export default function CategoryManager() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>分類管理</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 4</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>單選分類（財務／人資／營運／法務／業務／內部／緊急），可重新命名與調色</p>
    </div>
  )
}
