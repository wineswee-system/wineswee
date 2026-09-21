/**
 * Enhanced stat card component with hover glow, animated accent bar, and trend badges
 */
export default function StatCard({ icon: Icon, label, value, color = 'cyan', trend, trendValue }) {
  const colorMap = {
    cyan:   { bg: 'bg-cyan-500/10', text: 'text-cyan-500', border: 'border-cyan-500/15', ring: 'ring-cyan-500/10', glow: 'rgba(34,211,238,0.12)', accent: '#22d3ee' },
    blue:   { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/15', ring: 'ring-blue-500/10', glow: 'rgba(59,130,246,0.12)', accent: '#3b82f6' },
    green:  { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/15', ring: 'ring-emerald-500/10', glow: 'rgba(52,211,153,0.12)', accent: '#34d399' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/15', ring: 'ring-orange-500/10', glow: 'rgba(251,146,60,0.12)', accent: '#fb923c' },
    red:    { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/15', ring: 'ring-red-500/10', glow: 'rgba(248,113,113,0.12)', accent: '#f87171' },
    purple: { bg: 'bg-purple-500/10', text: 'text-purple-500', border: 'border-purple-500/15', ring: 'ring-purple-500/10', glow: 'rgba(167,139,250,0.12)', accent: '#a78bfa' },
    pink:   { bg: 'bg-pink-500/10', text: 'text-pink-500', border: 'border-pink-500/15', ring: 'ring-pink-500/10', glow: 'rgba(244,114,182,0.12)', accent: '#f472b6' },
    yellow: { bg: 'bg-yellow-500/10', text: 'text-yellow-500', border: 'border-yellow-500/15', ring: 'ring-yellow-500/10', glow: 'rgba(251,191,36,0.12)', accent: '#fbbf24' },
  }

  const c = colorMap[color] || colorMap.cyan

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border ${c.border} bg-[var(--bg-card)] p-5 shadow-[var(--shadow-sm)] transition-all duration-300 hover:ring-2 ${c.ring} hover:shadow-lg cursor-default`}
      style={{ '--stat-glow': c.glow }}
    >
      {/* Top accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px] opacity-60 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `linear-gradient(90deg, ${c.accent}, ${c.accent}66)` }}
      />

      {/* Hover glow */}
      <div
        className="absolute -top-12 -right-8 w-32 h-32 rounded-full opacity-0 transition-opacity duration-400 group-hover:opacity-100 pointer-events-none"
        style={{ background: `radial-gradient(circle, ${c.glow} 0%, transparent 70%)` }}
      />

      <div className="relative flex items-start justify-between mb-3">
        {Icon && (
          <div className={`w-11 h-11 rounded-xl ${c.bg} ${c.text} flex items-center justify-center transition-transform duration-300 group-hover:scale-105`}
            style={{ boxShadow: `0 4px 14px ${c.glow}` }}
          >
            <Icon size={20} strokeWidth={2} />
          </div>
        )}
        {trend && (
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${trend === 'up' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
            {trend === 'up' ? '↑' : '↓'} {trendValue}
          </span>
        )}
      </div>

      <div className="relative">
        <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1 tracking-wide uppercase">{label}</div>
        <div className={`text-[26px] font-extrabold ${c.text} leading-none tracking-tight`}>{value}</div>
      </div>
    </div>
  )
}
