/**
 * Tailwind-powered card component with glassmorphism
 */
export function Card({ children, className = '', padding = true }) {
  return (
    <div className={`rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] backdrop-blur-sm shadow-[var(--shadow-sm)] transition-all duration-200 hover:shadow-[var(--shadow-md)] ${padding ? 'p-5' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function CardHeader({ title, icon, action, children }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        {icon && <span className="text-base">{icon}</span>}
        <h3 className="text-sm font-bold text-[var(--text-primary)]">{title}</h3>
      </div>
      {action}
      {children}
    </div>
  )
}

export function CardGrid({ cols = 2, children, className = '' }) {
  const colClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-4',
    5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
    6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6',
  }
  return (
    <div className={`grid gap-3 ${colClass[cols] || colClass[3]} ${className}`}>
      {children}
    </div>
  )
}
