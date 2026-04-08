/**
 * Consistent page header with title, description, and action slots
 */
export default function PageHeader({ icon: Icon, title, description, actions, children, accentColor }) {
  return (
    <div className="page-hdr">
      <div className="page-hdr-left">
        {Icon && (
          <div className="page-hdr-icon" style={accentColor ? { '--ph-color': accentColor } : undefined}>
            <Icon size={22} />
          </div>
        )}
        <div>
          <h2 className="page-hdr-title">{title}</h2>
          {description && <p className="page-hdr-desc">{description}</p>}
        </div>
      </div>
      <div className="page-hdr-actions">
        {actions}
        {children}
      </div>
    </div>
  )
}
