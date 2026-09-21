/**
 * Consistent chart wrapper card with title and optional actions
 */
export default function ChartCard({ icon: Icon, title, action, height = 280, children, className = '' }) {
  return (
    <div className={`chart-card ${className}`}>
      <div className="chart-card-header">
        <div className="chart-card-title">
          {Icon && <Icon size={16} className="chart-card-icon" />}
          <h3>{title}</h3>
        </div>
        {action && <div className="chart-card-action">{action}</div>}
      </div>
      <div className="chart-card-body" style={{ height }}>
        {children}
      </div>
    </div>
  )
}
