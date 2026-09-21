export default function ContactMergeReview() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>合併重複聯絡人</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 10</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>並排比較重複項目，選擇合併或保留</p>
    </div>
  )
}
