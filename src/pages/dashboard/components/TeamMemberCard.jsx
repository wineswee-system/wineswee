// TeamMemberCard + STATUS_META — extracted from TeamDashboard.jsx
// Renders a single employee status badge in the team grid
const C = {
  green: 'var(--accent-green)',
  cyan: 'var(--accent-cyan)',
  orange: 'var(--accent-orange)',
  red: 'var(--accent-red)',
  purple: 'var(--accent-purple)',
  blue: 'var(--accent-blue)',
  muted: 'var(--text-muted)',
  card: 'var(--bg-card)',
  borderSubtle: 'var(--border-subtle)',
}

export const STATUS_META = {
  on:       { icon: '🟢', label: '在班',    color: C.green },
  leave:    { icon: '🌴', label: '休假中',  color: C.cyan },
  sick:     { icon: '🏥', label: '請假中',  color: C.orange },
  overtime: { icon: '⚡', label: '加班中',  color: C.purple },
  trip:     { icon: '✈️', label: '出差中',  color: C.blue },
  late:     { icon: '🔴', label: '未打卡',  color: C.red },
  off:      { icon: '⚪', label: '休息日',  color: C.muted },
  unknown:  { icon: '⚫', label: '未排班',  color: C.muted },
}

export default function TeamMemberCard({ emp, status }) {
  const meta = STATUS_META[status] || STATUS_META.unknown
  const initial = (emp.name || '?').charAt(0)
  return (
    <div title={`${emp.name} · ${meta.label}`} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      padding: 10, borderRadius: 10, background: C.card, border: `1px solid ${C.borderSubtle}`,
      minWidth: 88, position: 'relative',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: '50%', background: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 700, fontSize: 18, position: 'relative',
      }}>
        {initial}
        <span style={{
          position: 'absolute', bottom: -2, right: -2, fontSize: 14,
          width: 20, height: 20, background: C.card, border: `1px solid ${meta.color}`,
          borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{meta.icon}</span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {emp.name}
      </div>
      <div style={{ fontSize: 10, color: meta.color, fontWeight: 600 }}>{meta.label}</div>
    </div>
  )
}
