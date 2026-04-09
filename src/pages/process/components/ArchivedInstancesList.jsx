export default function ArchivedInstancesList({ instances, getStats, onSelect }) {
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
                <div style={{ fontSize: 15, fontWeight: 700 }}>{inst.store || inst.template_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inst.template_name} · 完成：{inst.completed_at?.slice(0, 10)}</div>
              </div>
              <span style={{ color: 'var(--accent-green)', fontWeight: 700, fontSize: 13 }}>✅ 已完成 ({stats.total} 步)</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
