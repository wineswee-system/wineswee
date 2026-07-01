// 派遣模組佔位頁 — 尚未實作的頁面共用此元件
// TODO: 依 docs/dispatch_dev.md 逐頁實作後移除
export default function DispatchPlaceholder({ title }) {
  return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🚧</div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{title}</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>此功能開發中（參見 docs/dispatch_dev.md）</p>
    </div>
  )
}
