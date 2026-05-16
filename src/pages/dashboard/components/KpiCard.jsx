// KpiCard — extracted from TeamDashboard.jsx
const C = {
  cyan: 'var(--accent-cyan)',
  cyanDim: 'var(--accent-cyan-dim)',
  red: 'var(--accent-red)',
  redDim: 'var(--accent-red-dim)',
  muted: 'var(--text-muted)',
  card: 'var(--bg-card)',
  border: 'var(--border-medium)',
}

export default function KpiCard({ icon: Icon, label, value, suffix, sub, subColor, color = C.cyan, colorDim = C.cyanDim, badge, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: 16, cursor: onClick ? 'pointer' : 'default',
        transition: 'transform .12s, border-color .12s',
        display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
      }}
      onMouseEnter={(e) => { if (onClick) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.borderColor = color } }}
      onMouseLeave={(e) => { if (onClick) { e.currentTarget.style.transform = ''; e.currentTarget.style.borderColor = C.border } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, background: colorDim,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color,
        }}>
          <Icon size={18} />
        </div>
        {badge && (
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 12, fontWeight: 700,
            background: C.redDim, color: C.red,
          }}>{badge}</span>
        )}
      </div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
          {value}{suffix && <span style={{ fontSize: 14, fontWeight: 500, color: C.muted, marginLeft: 4 }}>{suffix}</span>}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{label}</div>
        {sub && (
          <div style={{ fontSize: 10, color: subColor || C.muted, marginTop: 4, fontWeight: 600 }}>{sub}</div>
        )}
      </div>
    </div>
  )
}
