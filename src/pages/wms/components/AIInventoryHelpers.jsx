import { Loader2 } from 'lucide-react'

// ─── Shared display helpers for AI Inventory tabs ────────────

export function ResultCard({ title, children, loading }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div className="card-title">{title}</div>
        {loading && <Loader2 size={16} className="spin" style={{ color: 'var(--accent-cyan)' }} />}
      </div>
      <div className="card-body" style={{ padding: 16 }}>{children}</div>
    </div>
  )
}

export function Badge({ color, children }) {
  const bg = {
    critical: 'var(--accent-red)', high: 'var(--accent-red)',
    warning: 'var(--accent-orange)', medium: 'var(--accent-orange)',
    low: 'var(--accent-green)', info: 'var(--accent-cyan)',
    good: 'var(--accent-green)', stable: 'var(--accent-cyan)',
    improving: 'var(--accent-green)', deteriorating: 'var(--accent-red)',
  }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 600,
      background: `${bg[color] || 'var(--accent-cyan)'}22`,
      color: bg[color] || 'var(--accent-cyan)',
    }}>{children}</span>
  )
}

export function KVTable({ data }) {
  if (!data || data.length === 0) return null
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--glass-light)' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{d.label}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{d.value}</span>
        </div>
      ))}
    </div>
  )
}

export function ActionList({ items }) {
  if (!items || items.length === 0) return (
    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>AI 尚未產生建議</div>
  )
  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead><tr>{Object.keys(items[0]).map(k => <th key={k}>{k}</th>)}</tr></thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>{Object.values(item).map((v, j) => (
              <td key={j} style={{ fontSize: 12 }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
