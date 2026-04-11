import { ChevronRight } from 'lucide-react'

export default function ActiveInstancesList({ instances, getStats, onSelect }) {
  if (instances.length === 0) {
    return <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>目前沒有進行中的流程。從「流程範本」部署即可建立。</div>
  }

  return (
    <div>
      {instances.map(inst => {
        const stats = getStats(inst.id)
        return (
          <div key={inst.id} className="card" style={{ marginBottom: 12, cursor: 'pointer', transition: 'border-color 0.2s' }}
            onClick={() => onSelect(inst)}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-cyan)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = ''}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{inst.store || inst.template_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inst.template_name} · {inst.started_at?.slice(0, 10)}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, whiteSpace: 'nowrap' }}>
                <div style={{ display: 'flex', gap: 14, fontSize: 13 }}>
                  <span>⬜ {stats.pending}</span>
                  <span style={{ color: 'var(--accent-cyan)' }}>🔄 {stats.inProgress}</span>
                  <span style={{ color: 'var(--accent-green)' }}>✅ {stats.completed}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-cyan)' }}>{stats.pct}%</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stats.completed}/{stats.total}</div>
                  </div>
                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: `conic-gradient(var(--accent-cyan) ${stats.pct * 3.6}deg, var(--border-medium) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{stats.pct}%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
