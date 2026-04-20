import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const PRIORITY_COLORS = { 高: '#ef4444', 中: '#f59e0b', 低: '#10b981' }
const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export default function TaskCalendar({ tasks, onTaskClick, onDayClick }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d
  })

  const grid = useMemo(() => {
    const year = cursor.getFullYear(), month = cursor.getMonth()
    const first = new Date(year, month, 1)
    const lead = first.getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < lead; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [cursor])

  const byDay = useMemo(() => {
    const m = new Map()
    for (const t of tasks) {
      if (!t.due_date) continue
      const key = t.due_date.slice(0, 10)
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(t)
    }
    return m
  }, [tasks])

  const iso = (d) => d.toISOString().slice(0, 10)
  const today = iso(new Date())

  const shift = (n) => {
    const d = new Date(cursor); d.setMonth(d.getMonth() + n); setCursor(d)
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button className="btn btn-secondary" onClick={() => shift(-1)} style={{ padding: '6px 12px' }}><ChevronLeft size={14} /></button>
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          {cursor.getFullYear()} 年 {cursor.getMonth() + 1} 月
        </div>
        <button className="btn btn-secondary" onClick={() => shift(1)} style={{ padding: '6px 12px' }}><ChevronRight size={14} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
        {DAY_LABELS.map(d => (
          <div key={d} style={{ background: 'var(--bg-card)', padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
            {d}
          </div>
        ))}
        {grid.map((d, i) => {
          if (!d) return <div key={i} style={{ background: 'var(--bg-secondary)', minHeight: 90, opacity: 0.4 }} />
          const key = iso(d)
          const dayTasks = byDay.get(key) || []
          const isToday = key === today
          return (
            <div
              key={i}
              onClick={() => onDayClick?.(d)}
              style={{
                background: 'var(--bg-card)', minHeight: 90, padding: 4,
                cursor: onDayClick ? 'pointer' : 'default',
                borderTop: isToday ? '2px solid var(--accent-cyan)' : 'none',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 600, color: isToday ? 'var(--accent-cyan)' : 'var(--text-primary)', marginBottom: 2, padding: '2px 4px' }}>
                {d.getDate()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {dayTasks.slice(0, 3).map(t => (
                  <div
                    key={t.id}
                    onClick={(e) => { e.stopPropagation(); onTaskClick?.(t) }}
                    style={{
                      fontSize: 10, padding: '2px 5px', borderRadius: 3, cursor: 'pointer',
                      background: `color-mix(in srgb, ${PRIORITY_COLORS[t.priority] || '#64748b'} 18%, transparent)`,
                      color: PRIORITY_COLORS[t.priority] || 'var(--text-primary)',
                      borderLeft: `2px solid ${PRIORITY_COLORS[t.priority] || '#64748b'}`,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      textDecoration: t.status === '已完成' ? 'line-through' : 'none',
                      opacity: t.status === '已完成' ? 0.6 : 1,
                    }}
                  >
                    {t.title}
                  </div>
                ))}
                {dayTasks.length > 3 && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '0 5px' }}>
                    +{dayTasks.length - 3} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
