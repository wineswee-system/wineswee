export default function SkillList() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>AI 技能庫</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 13</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>技能列表、啟用狀態、執行統計、成功率分析</p>
    </div>
  )
}
