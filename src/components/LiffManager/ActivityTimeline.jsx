const dotClass = { completed: 'green', updated: 'amber', created: 'indigo', blocked: 'red' }
const typeIcon = { completed: '✅', updated: '🔄', created: '🆕', blocked: '🚫' }

const PERIOD_LABELS = {
  today: '今日更新',
  '7days': '過去七天',
  '30days': '過去30天',
}

const TAB_STYLE = { display: 'flex', gap: '6px', padding: '10px 18px 0' }

const tabBtnStyle = (active) => ({
  flex: 1,
  padding: '6px 8px',
  fontSize: '11px',
  fontWeight: 600,
  borderRadius: '999px',
  border: '1px solid',
  borderColor: active ? 'rgba(129,140,248,0.45)' : 'rgba(255,255,255,0.06)',
  background: active ? 'rgba(129,140,248,0.18)' : 'rgba(255,255,255,0.02)',
  color: active ? '#a5b4fc' : '#64748b',
  cursor: 'pointer',
  transition: 'all 0.15s',
})

export function ActivityTimeline({ activity, period, onPeriodChange }) {
  const emptyText = period === 'today'
    ? '今日尚無更新'
    : period === '7days' ? '過去七天無更新' : '過去30天無更新'
  return (
    <div className="glass-section">
      <div className="section-head">
        <span className="section-title">📋 {PERIOD_LABELS[period]}</span>
        <span className="section-meta">
          {new Date().toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })}
        </span>
      </div>
      <div style={TAB_STYLE}>
        {['today', '7days', '30days'].map(p => (
          <button
            key={p}
            type="button"
            style={tabBtnStyle(p === period)}
            onClick={() => onPeriodChange(p)}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="section-body">
        {activity.length === 0 ? (
          <div className="empty-state">{emptyText}</div>
        ) : activity.map((a, i) => (
          <div key={a.id + i} className="tl-item">
            <div className={`tl-dot ${dotClass[a.type]}`} />
            <div className="tl-body">
              <div className="tl-time">{a.time}</div>
              <div className="tl-title">{typeIcon[a.type]} {a.title}</div>
              {a.storeName && <div className="tl-store">🏪 {a.storeName}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
