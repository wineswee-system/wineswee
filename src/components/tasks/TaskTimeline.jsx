import { useMemo, useState } from 'react'

const PRIORITY_COLORS = { 高: '#ef4444', 中: '#f59e0b', 低: '#10b981' }
const DAY_PX = 32

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000)
}

export default function TaskTimeline({ tasks, dependencies = [], onTaskClick }) {
  const [hovered, setHovered] = useState(null)

  const { rows, start, days } = useMemo(() => {
    const withDates = tasks.filter(t => t.planned_start || t.due_date)
    if (!withDates.length) return { rows: [], start: new Date(), days: 0 }

    const parse = (s) => s ? new Date(s) : null
    const starts = withDates.map(t => parse(t.planned_start) || parse(t.due_date))
    const ends = withDates.map(t => parse(t.due_date) || parse(t.planned_start))

    const minDate = new Date(Math.min(...starts.map(d => d.getTime())))
    const maxDate = new Date(Math.max(...ends.map(d => d.getTime())))
    minDate.setDate(minDate.getDate() - 2)
    maxDate.setDate(maxDate.getDate() + 2)
    const totalDays = daysBetween(minDate, maxDate) + 1

    const rows = withDates.map(t => {
      const s = parse(t.planned_start) || parse(t.due_date)
      const e = parse(t.due_date) || parse(t.planned_start)
      const offset = daysBetween(minDate, s)
      const span = Math.max(1, daysBetween(s, e) + 1)
      return { task: t, offset, span }
    })

    return { rows, start: minDate, days: totalDays }
  }, [tasks])

  if (rows.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
        時程需要任務有「開始日期」或「截止日期」。
      </div>
    )
  }

  const dayLabels = []
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i)
    dayLabels.push(d)
  }

  const depMap = new Map()
  for (const d of dependencies) {
    if (!depMap.has(d.task_id)) depMap.set(d.task_id, [])
    depMap.get(d.task_id).push(d.depends_on_task_id)
  }

  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <div style={{ minWidth: 220 + days * DAY_PX, position: 'relative' }}>
        {/* Header days */}
        <div style={{ display: 'flex', position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 2, borderBottom: '1px solid var(--border-medium)' }}>
          <div style={{ width: 220, padding: '10px 12px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', borderRight: '1px solid var(--border-medium)' }}>
            任務
          </div>
          {dayLabels.map((d, i) => {
            const isWeekend = d.getDay() === 0 || d.getDay() === 6
            const isMonthStart = d.getDate() === 1
            return (
              <div
                key={i}
                style={{
                  width: DAY_PX, textAlign: 'center', fontSize: 10,
                  padding: '6px 0', color: 'var(--text-muted)',
                  background: isWeekend ? 'var(--bg-secondary)' : 'transparent',
                  borderLeft: isMonthStart ? '1px solid var(--accent-cyan)' : 'none',
                }}
              >
                <div style={{ fontWeight: 600 }}>{d.getDate()}</div>
                {isMonthStart && <div style={{ color: 'var(--accent-cyan)', fontSize: 9 }}>{d.getMonth() + 1}月</div>}
              </div>
            )
          })}
        </div>

        {/* Rows */}
        {rows.map(({ task, offset, span }) => (
          <div
            key={task.id}
            style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', position: 'relative' }}
            onMouseEnter={() => setHovered(task.id)}
            onMouseLeave={() => setHovered(null)}
          >
            <div
              onClick={() => onTaskClick?.(task)}
              style={{
                width: 220, padding: '8px 12px', fontSize: 12, cursor: 'pointer',
                borderRight: '1px solid var(--border-medium)', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
                background: hovered === task.id ? 'var(--glass-light)' : 'transparent',
              }}
            >
              <div style={{ fontWeight: 600 }}>{task.title}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {task.assignee || '未指派'}
              </div>
            </div>
            <div style={{ position: 'relative', flex: 1, height: 44 }}>
              {dayLabels.map((d, i) => {
                const isWeekend = d.getDay() === 0 || d.getDay() === 6
                return <div key={i} style={{ position: 'absolute', left: i * DAY_PX, top: 0, width: DAY_PX, height: '100%', background: isWeekend ? 'var(--bg-secondary)' : 'transparent', opacity: 0.5 }} />
              })}
              <div
                onClick={() => onTaskClick?.(task)}
                title={`${task.title} (${span} 天)`}
                style={{
                  position: 'absolute', left: offset * DAY_PX + 2, top: 10,
                  width: span * DAY_PX - 4, height: 24,
                  background: PRIORITY_COLORS[task.priority] || '#64748b',
                  borderRadius: 4, cursor: 'pointer', display: 'flex',
                  alignItems: 'center', padding: '0 6px', fontSize: 10,
                  color: '#fff', fontWeight: 600, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  opacity: task.status === '已完成' ? 0.5 : 1,
                  boxShadow: hovered === task.id ? '0 0 0 2px var(--accent-cyan)' : 'none',
                }}
              >
                {task.status === '已完成' && '✓ '}{task.title}
              </div>
            </div>
          </div>
        ))}
      </div>
      {depMap.size > 0 && (
        <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)' }}>
          依賴關係：{depMap.size} 條前置條件（點任務查看詳情）
        </div>
      )}
    </div>
  )
}
