export default function ArchivedInstancesList({ instances, getStats, onSelect, onDelete }) {
  if (instances.length === 0) {
    return <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無封存流程</div>
  }

  return (
    <div>
      {instances.map(inst => {
        const stats = getStats(inst.id)
        return (
          <div key={inst.id} className="card" style={{ marginBottom: 12, cursor: 'pointer', opacity: 0.7 }} onClick={() => onSelect(inst)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{inst.template_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inst.store} · 完成：{inst.completed_at?.slice(0, 10)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ color: 'var(--accent-green)', fontWeight: 700, fontSize: 13 }}>✅ 已完成 ({stats.total} 步)</span>
                {onDelete && (
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(inst) }}
                    title="刪除此封存流程"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', padding: 4, borderRadius: 4,
                      display: 'flex', alignItems: 'center',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--accent-red)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
