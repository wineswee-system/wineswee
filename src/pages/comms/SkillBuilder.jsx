import { useParams } from 'react-router-dom'

export default function SkillBuilder() {
  const { skillId } = useParams()
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>AI 技能建立器</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 13</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>視覺化設定觸發條件與 Gemini 動作鏈</p>
    </div>
  )
}
