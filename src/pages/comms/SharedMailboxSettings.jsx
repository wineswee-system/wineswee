export default function SharedMailboxSettings() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 22, fontWeight: 600 }}>共用信箱設定</h1>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Phase 5</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>hr@／finance@ 等團隊信箱、成員權限（讀取／回覆／管理）、SLA 時限、預設指派</p>
    </div>
  )
}
