import { useMemo, useState } from 'react'

const PRIORITY_COLORS = { 高: '#ef4444', 中: '#f59e0b', 低: '#10b981' }
const DAY_PX = 32

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000)
}

function GanttRow({ task, offset, span, dayLabels, hovered, setHovered, onTaskClick }) {
  return (
    <div
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
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{task.assignee || '未指派'}</div>
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
  )
}

export default function TaskTimeline({ tasks, dependencies = [], onTaskClick, groupByProject = false, projects = [] }) {
  const [hovered, setHovered] = useState(null)

  // project id → name lookup
  const projNameMap = useMemo(() => {
    const m = new Map()
    for (const p of projects) m.set(p.id, p.name)
    return m
  }, [projects])

  const MAX_DAYS = 180 // 防爆：日期區間超過半年就 clip，避免 89 tasks × 4000 days DOM 炸瀏覽器
  const { rows, start, days, clipped } = useMemo(() => {
    const withDates = tasks.filter(t => t.planned_start || t.due_date)
    if (!withDates.length) return { rows: [], start: new Date(), days: 0, clipped: false }

    const parse = (s) => {
      if (!s) return null
      const d = new Date(s)
      return isNaN(d.getTime()) ? null : d
    }
    const starts = withDates.map(t => parse(t.planned_start) || parse(t.due_date)).filter(Boolean)
    const ends = withDates.map(t => parse(t.due_date) || parse(t.planned_start)).filter(Boolean)
    if (!starts.length) return { rows: [], start: new Date(), days: 0, clipped: false }

    let minDate = new Date(Math.min(...starts.map(d => d.getTime())))
    let maxDate = new Date(Math.max(...ends.map(d => d.getTime())))
    minDate.setDate(minDate.getDate() - 2)
    maxDate.setDate(maxDate.getDate() + 2)
    let totalDays = daysBetween(minDate, maxDate) + 1
    let isClipped = false
    if (totalDays > MAX_DAYS) {
      // clip 成「今天 ± 90 天」視窗
      const now = new Date(); now.setHours(0, 0, 0, 0)
      minDate = new Date(now); minDate.setDate(now.getDate() - 30)
      maxDate = new Date(now); maxDate.setDate(now.getDate() + MAX_DAYS - 30)
      totalDays = MAX_DAYS
      isClipped = true
    }

    const rows = withDates.map(t => {
      const s = parse(t.planned_start) || parse(t.due_date)
      const e = parse(t.due_date) || parse(t.planned_start)
      if (!s || !e) return null
      // 在 clip 視窗外的任務跳過
      if (e < minDate || s > maxDate) return null
      const clampedStart = s < minDate ? minDate : s
      const clampedEnd = e > maxDate ? maxDate : e
      const offset = daysBetween(minDate, clampedStart)
      const span = Math.max(1, daysBetween(clampedStart, clampedEnd) + 1)
      return { task: t, offset, span }
    }).filter(Boolean)

    return { rows, start: minDate, days: totalDays, clipped: isClipped }
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
      {clipped && (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--accent-orange)', background: 'var(--accent-orange-dim)', borderBottom: '1px solid var(--border-subtle)' }}>
          ⚠ 任務日期區間超過 {MAX_DAYS} 天，已 clip 成「今天前後 {MAX_DAYS} 天」視窗（避免渲染負擔）
        </div>
      )}
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

        {/* Rows — optionally grouped by project */}
        {(() => {
          if (!groupByProject) {
            return rows.map(({ task, offset, span }) => (
              <GanttRow key={task.id} task={task} offset={offset} span={span} dayLabels={dayLabels} hovered={hovered} setHovered={setHovered} onTaskClick={onTaskClick} />
            ))
          }
          // Group rows by project_id — use a Map to handle non-contiguous orderings
          const groups = []
          const groupMap = new Map()
          for (const row of rows) {
            const pid = row.task.project_id ?? '__none__'
            if (!groupMap.has(pid)) {
              const g = { pid, rows: [] }
              groupMap.set(pid, g)
              groups.push(g)
            }
            groupMap.get(pid).rows.push(row)
          }
          return groups.map(({ pid, rows: gRows }) => {
            const projName = pid === '__none__' ? '直接任務' : (projNameMap.get(Number(pid)) || `專案 #${pid}`)
            return (
              <div key={pid}>
                <div style={{
                  display: 'flex', borderBottom: '1px solid var(--border-medium)',
                  background: 'var(--bg-secondary)', position: 'sticky', left: 0,
                }}>
                  <div style={{ width: 220, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)', borderRight: '1px solid var(--border-medium)' }}>
                    📁 {projName}
                  </div>
                  <div style={{ flex: 1, height: 28, background: 'var(--accent-cyan-dim)', opacity: 0.3 }} />
                </div>
                {gRows.map(({ task, offset, span }) => (
                  <GanttRow key={task.id} task={task} offset={offset} span={span} dayLabels={dayLabels} hovered={hovered} setHovered={setHovered} onTaskClick={onTaskClick} />
                ))}
              </div>
            )
          })
        })()}
      </div>
      {depMap.size > 0 && (
        <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)' }}>
          依賴關係：{depMap.size} 條前置條件（點任務查看詳情）
        </div>
      )}
    </div>
  )
}
