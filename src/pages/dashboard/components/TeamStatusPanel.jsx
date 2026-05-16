import { Users } from 'lucide-react'

const C = {
  cyan: 'var(--accent-cyan)',
  green: 'var(--accent-green)',
  orange: 'var(--accent-orange)',
  red: 'var(--accent-red)',
  purple: 'var(--accent-purple)',
  blue: 'var(--accent-blue)',
  muted: 'var(--text-muted)',
  card: 'var(--bg-card)',
  border: 'var(--border-medium)',
  borderSubtle: 'var(--border-subtle)',
}

// ──────────────────────────────────────────────
// 狀態 meta
// ──────────────────────────────────────────────
const STATUS_META = {
  on:       { icon: '🟢', label: '在班',    color: C.green },
  leave:    { icon: '🌴', label: '休假中',  color: C.cyan },
  sick:     { icon: '🏥', label: '請假中',  color: C.orange },
  overtime: { icon: '⚡', label: '加班中',  color: C.purple },
  trip:     { icon: '✈️', label: '出差中',  color: C.blue },
  late:     { icon: '🔴', label: '未打卡',  color: C.red },
  off:      { icon: '⚪', label: '休息日',  color: C.muted },
  unknown:  { icon: '⚫', label: '未排班',  color: C.muted },
}

// ──────────────────────────────────────────────
// 子元件：成員卡片
// ──────────────────────────────────────────────
function TeamMemberCard({ emp, status }) {
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

// ──────────────────────────────────────────────
// TeamStatusPanel
// Props:
//   team           — full employee array [{ id, name }]
//   teamWithStatus — [{ emp: { id, name }, status }]
//   isManager      — boolean
//   isAdminPlus    — boolean
//   scopeStoreId   — number | null
// ──────────────────────────────────────────────
export default function TeamStatusPanel({ team, teamWithStatus, isManager, isAdminPlus, scopeStoreId }) {
  const showAll = isManager || (isAdminPlus && scopeStoreId)
  // 全公司視角時排除 'late'：未打卡有專屬 KPI（紅卡），點 KPI 可下鑽 /hr/attendance
  // 這邊只列「在班的特殊狀態」(休假/請假/加班中/出差)，避免 dashboard 被未打卡淹沒
  const visible = showAll
    ? teamWithStatus
    : teamWithStatus.filter(t => ['leave', 'sick', 'overtime', 'trip'].includes(t.status))
  const title = showAll ? '團隊狀態' : '今日特殊狀態'
  const countLabel = showAll ? `${team.length} 人` : `${visible.length} 人`

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={16} style={{ color: C.cyan }} /> {title}
          <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>（{countLabel}）</span>
        </h3>
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.muted, flexWrap: 'wrap' }}>
          {Object.entries(STATUS_META)
            .filter(([k]) => showAll
              ? ['on', 'leave', 'sick', 'overtime', 'trip', 'late'].includes(k)
              : ['leave', 'sick', 'overtime', 'trip'].includes(k))
            .map(([k, m]) => (
              <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span>{m.icon}</span>{m.label}
              </span>
            ))}
        </div>
      </div>

      {team.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
          尚無團隊成員
        </div>
      ) : visible.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
          ✅ 今日無人請假／出差／加班
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
          gap: 10,
        }}>
          {visible.map(({ emp, status }) => (
            <TeamMemberCard key={emp.id} emp={emp} status={status} />
          ))}
        </div>
      )}
    </div>
  )
}
