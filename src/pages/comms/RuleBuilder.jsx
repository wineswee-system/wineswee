export default function RuleBuilder() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>郵件規則</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 4</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>條件（寄件人／主旨／附件）＋ 動作（標籤／分類／移動／指派／觸發技能）自動套用</p>
    </div>
  )
}
