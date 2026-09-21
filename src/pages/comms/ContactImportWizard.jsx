export default function ContactImportWizard() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>匯入聯絡人</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 10</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>上傳 vCard / CSV → 欄位對應 → 去重複 → 匯入</p>
    </div>
  )
}
