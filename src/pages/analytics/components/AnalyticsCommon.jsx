import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

// 共用 helpers 與元件，避免 8 個域內頁複製貼上
// 主檔：src/pages/Analytics.jsx 也用同樣的版型（自己 inline），這份是 Layer 3 用

export const NT = (n) => `NT$ ${Math.round(Number(n) || 0).toLocaleString()}`
export const NT_K = (n) => {
  const v = Math.round(Number(n) || 0)
  if (v >= 1_000_000) return `NT$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `NT$${(v / 1_000).toFixed(0)}K`
  return `NT$${v}`
}
export const PCT = (n, digits = 1) => `${(Number(n) || 0).toFixed(digits)}%`
export const NUM = (n) => (Number(n) || 0).toLocaleString()

export function TrendBadge({ current, baseline, suffix = '', invert = false }) {
  if (baseline === undefined || baseline === null || baseline === 0) {
    return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>無上期資料</span>
  }
  const diff = current - baseline
  const pct = (diff / Math.abs(baseline)) * 100
  const isUp = diff > 0
  const good = invert ? !isUp : isUp
  const color = Math.abs(pct) < 0.5 ? 'var(--text-muted)'
                : good ? 'var(--accent-green)' : 'var(--accent-red)'
  const Icon = Math.abs(pct) < 0.5 ? Minus : (isUp ? TrendingUp : TrendingDown)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color, fontWeight: 600 }}>
      <Icon size={12} />
      {Math.abs(pct).toFixed(1)}%{suffix}
    </span>
  )
}

export function KpiCard({ label, value, sub, baselineLabel, current, baseline, invert, accent = 'cyan', onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12, padding: 16,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
        borderLeft: `3px solid var(--accent-${accent})`,
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {baseline !== undefined && current !== undefined && (
          <TrendBadge current={current} baseline={baseline} invert={invert} />
        )}
        {sub && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</span>}
        {baselineLabel && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>vs {baselineLabel}</span>}
      </div>
    </div>
  )
}

export function SectionHeader({ icon: Icon, title, accent = 'cyan', extra }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, marginTop: 20 }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: `var(--accent-${accent}-dim)`, color: `var(--accent-${accent})`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={16} />
      </div>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
      {extra && <div style={{ marginLeft: 'auto' }}>{extra}</div>}
    </div>
  )
}

export function EmptyState({ msg = '目前沒有資料' }) {
  return (
    <div style={{
      padding: 32, borderRadius: 10, textAlign: 'center',
      color: 'var(--text-muted)', background: 'var(--bg-card)',
      border: '1px dashed var(--border-subtle)',
    }}>
      {msg}
    </div>
  )
}

export function BarRow({ label, value, max, accent = 'cyan', formatter = NUM }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <div style={{ minWidth: 120, fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ flex: 1, height: 18, background: 'var(--bg-elevated)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(pct, 100)}%`,
          background: `var(--accent-${accent})`, transition: 'width 0.3s ease',
        }} />
      </div>
      <div style={{ minWidth: 80, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right' }}>
        {formatter(value)}
      </div>
    </div>
  )
}

export function DataTable({ rows, columns, emptyMsg = '無資料' }) {
  if (!rows || rows.length === 0) return <EmptyState msg={emptyMsg} />
  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>{columns.map(c => <th key={c.key} style={c.headerStyle}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map(c => (
                <td key={c.key} style={c.cellStyle}>
                  {c.render ? c.render(row[c.key], row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
