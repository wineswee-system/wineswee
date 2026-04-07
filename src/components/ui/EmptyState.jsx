/**
 * Empty state placeholder for pages/sections with no data
 */
export default function EmptyState({ icon: Icon, title = '目前沒有資料', description, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        {Icon ? <Icon size={48} strokeWidth={1.2} /> : (
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 12h8" />
          </svg>
        )}
      </div>
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-desc">{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}
