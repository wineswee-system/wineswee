import { ArrowUpRight, ArrowDownRight } from 'lucide-react'

/**
 * Premium metric/KPI card with animated hover, icon, trend indicator
 */
export default function Metric({ icon: Icon, label, value, change, trend, sub, color = 'var(--accent-cyan)' }) {
  return (
    <div className="metric-card" style={{ '--mc-color': color }}>
      <div className="metric-card-glow" />
      <div className="metric-card-bar" />
      <div className="metric-card-body">
        {Icon && (
          <div className="metric-card-icon">
            <Icon size={22} strokeWidth={2} />
          </div>
        )}
        <div className="metric-card-content">
          <span className="metric-card-label">{label}</span>
          <div className="metric-card-value">{value}</div>
          {(change || sub) && (
            <div className="metric-card-footer">
              {change && (
                <span className={`metric-card-trend ${trend === 'up' ? 'up' : trend === 'down' ? 'down' : ''}`}>
                  {trend === 'up' && <ArrowUpRight size={12} />}
                  {trend === 'down' && <ArrowDownRight size={12} />}
                  {change}
                </span>
              )}
              {sub && <span className="metric-card-sub">{sub}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
