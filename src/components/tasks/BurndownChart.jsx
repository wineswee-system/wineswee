import { useMemo } from 'react'

/**
 * BurndownChart — Pure-SVG task burndown for a project.
 *
 * Props:
 *   tasks      — Array<{ status, completed_at, created_at }>
 *   startDate  — project start date string 'YYYY-MM-DD'
 *   endDate    — project end date string 'YYYY-MM-DD'
 */
export default function BurndownChart({ tasks = [], startDate, endDate }) {
  const chart = useMemo(() => {
    if (!tasks.length) return null

    const now = new Date()
    const allCreatedMs = tasks.map(t => new Date(t.created_at).getTime()).filter(ms => !isNaN(ms))
    const start = startDate
      ? new Date(startDate)
      : allCreatedMs.length ? new Date(allCreatedMs.reduce((a, b) => Math.min(a, b), Infinity)) : null
    const end = endDate
      ? new Date(endDate)
      : new Date(now.getTime() + 7 * 86400000)

    if (!start || isNaN(start) || isNaN(end) || start >= end) return null

    const totalDays = Math.ceil((end - start) / 86400000)
    if (totalDays < 1) return null

    const total = tasks.length

    // Pre-sort completed timestamps (ms) once — avoids O(done × elapsed) Date construction
    const doneTsMs = tasks
      .filter(t => t.completed_at && t.status === '已完成')
      .map(t => new Date(t.completed_at).getTime())
      .sort((a, b) => a - b)

    // actual burndown: remaining tasks at each elapsed day up to today
    const elapsed = Math.max(0, Math.min(totalDays, Math.ceil((now - start) / 86400000)))
    const points = Array.from({ length: elapsed + 1 }, (_, d) => {
      const cutoff = start.getTime() + d * 86400000
      // binary-search: count how many doneTsMs <= cutoff
      let lo = 0, hi = doneTsMs.length
      while (lo < hi) { const mid = (lo + hi) >> 1; doneTsMs[mid] <= cutoff ? (lo = mid + 1) : (hi = mid) }
      return { day: d, remaining: total - lo }
    })

    // x-axis labels
    const tickCount = Math.min(7, totalDays + 1)
    const xLabels = Array.from({ length: tickCount }, (_, i) => {
      const d = Math.round(i * totalDays / Math.max(tickCount - 1, 1))
      const dt = new Date(start.getTime() + d * 86400000)
      return { day: d, label: `${dt.getMonth() + 1}/${dt.getDate()}` }
    })

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
      f,
      val: Math.round(total * (1 - f)),
    }))

    return { points, totalDays, total, elapsed, xLabels, yTicks }
  }, [tasks, startDate, endDate])

  if (!chart) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        尚無足夠資料生成燃盡圖。請確認專案已設定開始日期與任務。
      </div>
    )
  }

  const { points, totalDays, total, elapsed, xLabels, yTicks } = chart
  const W = 560; const H = 220
  const PAD = { top: 16, right: 20, bottom: 36, left: 40 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom

  const xS = (d) => PAD.left + (d / totalDays) * cW
  const yS = (r) => PAD.top + cH - (r / total) * cH

  const idealD = `M${xS(0)},${yS(total)} L${xS(totalDays)},${yS(0)}`
  const actualD = points.length > 1
    ? points.map((p, i) =>
        `${i === 0 ? 'M' : 'L'}${xS(p.day).toFixed(1)},${yS(p.remaining).toFixed(1)}`
      ).join(' ')
    : null

  const todayX = xS(Math.min(elapsed, totalDays))
  const remaining = points.length ? points[points.length - 1].remaining : total
  const completedCount = total - remaining

  return (
    <div>
      {/* summary pills */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { label: '總任務', val: total, color: 'var(--accent-blue)' },
          { label: '已完成', val: completedCount, color: 'var(--accent-green)' },
          { label: '剩餘', val: remaining, color: 'var(--accent-orange)' },
          { label: '完成率', val: `${total > 0 ? Math.round((completedCount / total) * 100) : 0}%`, color: 'var(--accent-cyan)' },
        ].map(s => (
          <div key={s.label} style={{
            padding: '5px 12px', borderRadius: 8,
            background: 'var(--glass-light)', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.label}</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.val}</span>
          </div>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, display: 'block' }}>
        {/* grid lines + y-axis labels */}
        {yTicks.map(({ f, val }) => {
          const y = PAD.top + f * cH
          return (
            <g key={f}>
              <line x1={PAD.left} y1={y} x2={PAD.left + cW} y2={y}
                stroke="var(--border-subtle)" strokeDasharray="4 3" strokeWidth={0.7} />
              <text x={PAD.left - 5} y={y + 4} textAnchor="end" fontSize={9} fill="var(--text-muted)">{val}</text>
            </g>
          )
        })}

        {/* today vertical marker — elapsed always ≥0 (Math.max), always ≤totalDays (Math.min) */}
        {elapsed < totalDays && (
          <g>
            <line x1={todayX} y1={PAD.top} x2={todayX} y2={PAD.top + cH}
              stroke="var(--accent-orange)" strokeDasharray="4 3" strokeWidth={1.4} opacity={0.65} />
            <text x={todayX} y={PAD.top - 3} textAnchor="middle" fontSize={9} fill="var(--accent-orange)">今</text>
          </g>
        )}

        {/* ideal line */}
        <path d={idealD} fill="none" stroke="var(--border-medium)"
          strokeWidth={1.5} strokeDasharray="7 4" />

        {/* actual burndown */}
        {actualD && (
          <>
            <path d={actualD} fill="none" stroke="var(--accent-cyan)" strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" />
            {/* endpoint dots */}
            {[points[0], points[points.length - 1]].map((p, i) => (
              <circle key={i} cx={xS(p.day)} cy={yS(p.remaining)} r={3.5}
                fill="var(--bg-secondary)" stroke="var(--accent-cyan)" strokeWidth={2} />
            ))}
          </>
        )}

        {/* x-axis date labels */}
        {xLabels.map(({ day, label }) => (
          <text key={day} x={xS(day)} y={PAD.top + cH + 14} textAnchor="middle"
            fontSize={9} fill="var(--text-muted)">{label}</text>
        ))}

        {/* legend */}
        <g transform={`translate(${PAD.left + cW - 158}, ${PAD.top + 5})`}>
          <line x1={0} y1={6} x2={18} y2={6} stroke="var(--border-medium)"
            strokeWidth={1.5} strokeDasharray="6 3" />
          <text x={22} y={10} fontSize={10} fill="var(--text-muted)">理想線</text>
          <line x1={68} y1={6} x2={86} y2={6} stroke="var(--accent-cyan)" strokeWidth={2} />
          <text x={90} y={10} fontSize={10} fill="var(--text-secondary)">實際剩餘</text>
        </g>
      </svg>
    </div>
  )
}
