import { useMemo } from 'react'

// 流程甘特圖:每個步驟一條橫條(開始→截止),依狀態上色 + 今天線。可橫向捲動。
const DAY = 30 // px / 天

const parse = (s) => s ? new Date(`${String(s).slice(0, 10)}T00:00:00`) : null
const addDays = (d, n) => new Date(d.getTime() + n * 86400000)
const daysBetween = (a, b) => Math.round((b - a) / 86400000)
const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`
const DONE = ['已完成', '已確認', '完成']

export default function WorkflowGantt({ steps = [], instance }) {
  const rows = useMemo(() => [...steps].sort((a, b) => (a.step_order || 0) - (b.step_order || 0)), [steps])

  const model = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    // 每步的 start / end
    let prevDue = parse(instance?.planned_start)
    const bars = rows.map(s => {
      const due = parse(s.due_date)
      let start = parse(s.planned_start) || prevDue || due
      if (due && start && start > due) start = due
      if (due) prevDue = due
      return { step: s, start: start || due, end: due || start }
    })
    const dates = []
    bars.forEach(b => { if (b.start) dates.push(b.start); if (b.end) dates.push(b.end) })
    if (parse(instance?.planned_start)) dates.push(parse(instance.planned_start))
    if (parse(instance?.planned_end)) dates.push(parse(instance.planned_end))
    if (!dates.length) return null
    let min = new Date(Math.min(...dates)), max = new Date(Math.max(...dates))
    min = addDays(min, -1); max = addDays(max, 1)
    if (today < min) min = today
    if (today > max) max = today
    const totalDays = Math.max(1, daysBetween(min, max))
    return { bars, min, max, totalDays, today }
  }, [rows, instance])

  if (!model) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
      此流程的步驟尚未設定日期,無法畫甘特圖。到「步驟任務」設定截止日後就會出現。
    </div>
  }

  const { bars, min, totalDays, today } = model
  const trackW = totalDays * DAY
  const xOf = (d) => (daysBetween(min, d) / totalDays) * trackW
  const todayX = xOf(today)

  // 週刻度
  const ticks = []
  for (let i = 0; i <= totalDays; i += 7) ticks.push({ x: (i / totalDays) * trackW, label: fmt(addDays(min, i)) })

  const colorOf = (step, overdue) => {
    if (DONE.includes(step.status)) return 'var(--accent-green)'
    if (overdue) return 'var(--accent-red)'
    if (step.status === '進行中') return 'var(--accent-cyan)'
    return 'var(--border-medium)'
  }

  const LABEL_W = 210
  const gridBg = `repeating-linear-gradient(90deg, transparent, transparent ${DAY * 7 - 1}px, var(--border-subtle) ${DAY * 7 - 1}px, var(--border-subtle) ${DAY * 7}px)`

  return (
    <div style={{ padding: '4px 2px 12px' }}>
      {/* 圖例 */}
      <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, flexWrap: 'wrap' }}>
        {[['已完成', 'var(--accent-green)'], ['進行中', 'var(--accent-cyan)'], ['待處理', 'var(--border-medium)'], ['逾期', 'var(--accent-red)']].map(([l, c]) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: c }} />{l}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
          <span style={{ width: 2, height: 12, background: 'var(--accent-red)' }} />今天
        </span>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
        <div style={{ minWidth: LABEL_W + trackW }}>
          {/* 日期軸 */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
            <div style={{ width: LABEL_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, background: 'var(--bg-secondary)',
              borderRight: '1px solid var(--border-subtle)', padding: '7px 12px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>步驟</div>
            <div style={{ position: 'relative', width: trackW, height: 30 }}>
              {ticks.map((t, i) => (
                <div key={i} style={{ position: 'absolute', left: t.x, top: 0, height: '100%', display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 4, borderLeft: '1px solid var(--border-subtle)', height: '100%', display: 'flex', alignItems: 'center' }}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 每步一列 */}
          {bars.map(({ step, start, end }) => {
            const overdue = end && end < today && !DONE.includes(step.status)
            const left = start ? xOf(start) : 0
            const width = Math.max(DAY * 0.7, (start && end ? xOf(end) - xOf(start) : DAY))
            const color = colorOf(step, overdue)
            const wideEnough = width > 90
            return (
              <div key={step.id} style={{ display: 'flex', borderTop: '1px solid var(--border-subtle)', minHeight: 34 }}>
                <div style={{ width: LABEL_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-card)',
                  borderRight: '1px solid var(--border-subtle)', padding: '6px 12px', overflow: 'hidden' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {step.step_order}. {step.title}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{step.assignee || '未指派'}</div>
                </div>
                <div style={{ position: 'relative', width: trackW, backgroundImage: gridBg }}>
                  {todayX >= 0 && todayX <= trackW && (
                    <div style={{ position: 'absolute', left: todayX, top: 0, bottom: 0, width: 2, background: 'var(--accent-red)', opacity: 0.45 }} />
                  )}
                  <div title={`${step.title}${end ? `（截止 ${fmt(end)}）` : ''}`}
                    style={{ position: 'absolute', left, width, top: 7, height: 20, borderRadius: 6, background: color,
                      display: 'flex', alignItems: 'center', paddingLeft: 8, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}>
                    {wideEnough && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{step.title}</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
