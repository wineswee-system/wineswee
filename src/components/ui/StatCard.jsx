/**
 * Tailwind-powered stat card component
 * Replaces inline stat-card styles with consistent, polished design
 */
export default function StatCard({ icon: Icon, label, value, color = 'cyan', trend, trendValue }) {
  const colorMap = {
    cyan:   { bg: 'bg-cyan-500/10', text: 'text-cyan-600', border: 'border-cyan-500/15', ring: 'ring-cyan-500/10' },
    blue:   { bg: 'bg-blue-500/10', text: 'text-blue-600', border: 'border-blue-500/15', ring: 'ring-blue-500/10' },
    green:  { bg: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-500/15', ring: 'ring-emerald-500/10' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-600', border: 'border-orange-500/15', ring: 'ring-orange-500/10' },
    red:    { bg: 'bg-red-500/10', text: 'text-red-600', border: 'border-red-500/15', ring: 'ring-red-500/10' },
    purple: { bg: 'bg-purple-500/10', text: 'text-purple-600', border: 'border-purple-500/15', ring: 'ring-purple-500/10' },
    pink:   { bg: 'bg-pink-500/10', text: 'text-pink-600', border: 'border-pink-500/15', ring: 'ring-pink-500/10' },
    yellow: { bg: 'bg-yellow-500/10', text: 'text-yellow-600', border: 'border-yellow-500/15', ring: 'ring-yellow-500/10' },
  }

  const c = colorMap[color] || colorMap.cyan

  return (
    <div className={`relative overflow-hidden rounded-2xl border ${c.border} bg-[var(--bg-card)] p-4 shadow-[var(--shadow-sm)] transition-all duration-200 hover:ring-2 ${c.ring} hover:shadow-[var(--shadow-md)]`}>
      {/* Top accent line */}
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${c.bg} opacity-60`} />

      <div className="flex items-start justify-between mb-2">
        {Icon && (
          <div className={`w-10 h-10 rounded-xl ${c.bg} ${c.text} flex items-center justify-center`}>
            <Icon size={18} />
          </div>
        )}
        {trend && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${trend === 'up' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
            {trend === 'up' ? '↑' : '↓'} {trendValue}
          </span>
        )}
      </div>

      <div className="text-[11px] font-medium text-[var(--text-muted)] mb-1">{label}</div>
      <div className={`text-2xl font-extrabold ${c.text}`}>{value}</div>
    </div>
  )
}
