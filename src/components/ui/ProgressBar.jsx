/**
 * Animated progress bar with label and percentage
 */
export default function ProgressBar({ label, value = 0, color = 'var(--accent-cyan)', showPercent = true, size = 'md' }) {
  const h = size === 'sm' ? 6 : size === 'lg' ? 12 : 8

  return (
    <div className="pbar">
      {(label || showPercent) && (
        <div className="pbar-header">
          {label && <span className="pbar-label">{label}</span>}
          {showPercent && <span className="pbar-value" style={{ color }}>{value}%</span>}
        </div>
      )}
      <div className="pbar-track" style={{ height: h }}>
        <div
          className="pbar-fill"
          style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: `linear-gradient(90deg, ${color}, ${color}aa)` }}
        />
      </div>
    </div>
  )
}
