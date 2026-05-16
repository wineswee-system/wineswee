// PendingRow — extracted from TeamDashboard.jsx
// Renders a single pending-approval item card
const C = {
  cyan: 'var(--accent-cyan)',
  red: 'var(--accent-red)',
  muted: 'var(--text-muted)',
  bg2: 'var(--bg-secondary)',
  borderSubtle: 'var(--border-subtle)',
}

export default function PendingRow({ item, onClick }) {
  const isOverdue = item.daysOpen >= 3
  const p = item.progress
  const pct = p && p.total > 0 ? Math.round((p.current / p.total) * 100) : 0
  return (
    <div
      onClick={() => onClick?.(item)}
      style={{
        padding: 12, borderRadius: 10, border: `1px solid ${C.borderSubtle}`,
        background: C.bg2, cursor: 'pointer',
        transition: 'border-color .12s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.cyan }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderSubtle }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
          background: item.kindColor + '20', color: item.kindColor, flexShrink: 0,
        }}>{item.kindLabel}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {item.title}
          </div>
          {item.subtitle && (
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{item.subtitle}</div>
          )}
          {p && p.total > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <div style={{
                flex: 1, height: 4, borderRadius: 2, background: C.borderSubtle, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', width: `${pct}%`, background: item.kindColor,
                  transition: 'width .3s',
                }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: item.kindColor, minWidth: 30, textAlign: 'right' }}>
                {p.current}/{p.total} 關
              </span>
            </div>
          )}
        </div>
        {isOverdue && (
          <span style={{ fontSize: 10, fontWeight: 700, color: C.red, flexShrink: 0 }}>
            🚨 {item.daysOpen}天
          </span>
        )}
      </div>
    </div>
  )
}
