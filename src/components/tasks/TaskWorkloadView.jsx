/**
 * TaskWorkloadView — 14-day task workload heatmap per employee.
 *
 * Props:
 *   tasks       {Array}    - active tasks array from parent state
 *   employees   {Array}    - employees array { id, name, dept, position }
 *   onTaskClick {Function} - optional (task) => void to open TaskModal
 *
 * Colour scale (active tasks per cell):
 *   0     → empty
 *   1–2   → green
 *   3–4   → orange
 *   5+    → red
 *   overdue tasks → always red regardless of count
 */
import { useMemo, useState } from 'react'

const DOW = ['日', '一', '二', '三', '四', '五', '六']
const PRIORITY_COLOR = {
  高: 'var(--accent-red)',
  中: 'var(--accent-orange)',
  低: 'var(--accent-green)',
}

function buildDays(n = 14) {
  const base = new Date()
  base.setHours(0, 0, 0, 0)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    return d
  })
}

function toKey(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d)
}

function heatStyle(count, isOverdue) {
  if (count === 0) return { bg: 'transparent', fg: 'var(--text-muted)' }
  if (isOverdue) return { bg: 'var(--accent-red-dim)', fg: 'var(--accent-red)' }
  if (count <= 2) return { bg: 'var(--accent-green-dim)', fg: 'var(--accent-green)' }
  if (count <= 4) return { bg: 'var(--accent-orange-dim)', fg: 'var(--accent-orange)' }
  return { bg: 'var(--accent-red-dim)', fg: 'var(--accent-red)' }
}

// ─── Heat cell ──────────────────────────────────────────────────────────────
function HeatCell({ tasks = [], isOverdue = false, isSelected, isToday, isPast, onClick }) {
  const count = tasks.length
  const { bg, fg } = heatStyle(count, isOverdue)

  return (
    <td
      onClick={count > 0 ? onClick : undefined}
      style={{
        padding: '3px 2px',
        textAlign: 'center',
        verticalAlign: 'middle',
        cursor: count > 0 ? 'pointer' : 'default',
        background: isSelected
          ? 'var(--accent-cyan-dim)'
          : isPast && !isOverdue
          ? 'var(--bg-secondary)'
          : bg,
        border: isSelected
          ? '2px solid var(--accent-cyan)'
          : isToday
          ? '1px solid var(--accent-cyan)'
          : '1px solid transparent',
        borderRadius: 4,
        transition: 'background 0.12s',
        opacity: isPast && !isOverdue && count === 0 ? 0.3 : 1,
        minWidth: 34,
      }}
    >
      {count > 0 && (
        <span
          style={{
            fontWeight: 800,
            fontSize: 13,
            lineHeight: 1,
            color: isSelected ? 'var(--accent-cyan)' : fg,
          }}
        >
          {count}
        </span>
      )}
    </td>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function TaskWorkloadView({ tasks = [], employees = [], onTaskClick }) {
  const [selected, setSelected] = useState(null) // { empId, dateKey }

  const days = useMemo(() => buildDays(14), [])
  const todayKey = useMemo(() => toKey(new Date()), [])

  // Only employees with active tasks
  const activeEmps = useMemo(() => {
    const ids = new Set(
      tasks
        .filter((t) => t.status !== '已完成' && t.status !== '已擱置')
        .map((t) => t.assignee_id)
        .filter(Boolean),
    )
    const empMap = new Map(employees.map((e) => [e.id, e]))
    return [...ids].map((id) => empMap.get(id)).filter(Boolean)
  }, [tasks, employees])

  // taskMap: empId → dateKey → tasks[]  ('overdue', 'none' are special keys)
  const taskMap = useMemo(() => {
    const map = {}
    const add = (empId, key, task) => {
      if (!map[empId]) map[empId] = {}
      if (!map[empId][key]) map[empId][key] = []
      map[empId][key].push(task)
    }
    for (const t of tasks) {
      if (!t.assignee_id) continue
      if (t.status === '已完成' || t.status === '已擱置') continue
      if (!t.due_date) {
        add(t.assignee_id, 'none', t)
      } else if (t.due_date < todayKey) {
        add(t.assignee_id, 'overdue', t)
      } else {
        add(t.assignee_id, t.due_date, t)
      }
    }
    return map
  }, [tasks, todayKey])

  const toggle = (empId, dateKey) =>
    setSelected((s) =>
      s?.empId === empId && s?.dateKey === dateKey ? null : { empId, dateKey },
    )

  const selKey = selected ? `${selected.empId}::${selected.dateKey}` : null
  const selectedTasks = selected ? (taskMap[selected.empId]?.[selected.dateKey] ?? []) : []

  const totalByEmp = (empId) =>
    Object.values(taskMap[empId] || {}).reduce((s, arr) => s + arr.length, 0)

  const thBase = {
    padding: '7px 4px',
    background: 'var(--bg-secondary)',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border-medium)',
    position: 'sticky',
    top: 0,
    zIndex: 1,
    userSelect: 'none',
  }

  return (
    <div>
      {/* ── Table ── */}
      <div
        style={{
          overflowX: 'auto',
          borderRadius: 8,
          border: '1px solid var(--border-medium)',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'separate',
            borderSpacing: 2,
            fontSize: 12,
            minWidth: 560,
          }}
        >
          <thead>
            <tr>
              <th style={{ ...thBase, textAlign: 'left', paddingLeft: 10, width: 130 }}>
                人員
              </th>
              <th
                style={{
                  ...thBase,
                  background: 'var(--accent-red-dim)',
                  color: 'var(--accent-red)',
                  width: 44,
                }}
              >
                逾期
              </th>
              {days.map((d) => {
                const key = toKey(d)
                const isToday = key === todayKey
                const isWeekend = d.getDay() === 0 || d.getDay() === 6
                return (
                  <th
                    key={key}
                    style={{
                      ...thBase,
                      background: isToday
                        ? 'var(--accent-cyan-dim)'
                        : isWeekend
                        ? 'var(--bg-card)'
                        : 'var(--bg-secondary)',
                      color: isToday ? 'var(--accent-cyan)' : 'var(--text-muted)',
                      fontWeight: isToday ? 800 : 600,
                      minWidth: 34,
                    }}
                  >
                    <div>{`${d.getMonth() + 1}/${d.getDate()}`}</div>
                    <div style={{ fontSize: 10, opacity: 0.75 }}>週{DOW[d.getDay()]}</div>
                  </th>
                )
              })}
              <th style={{ ...thBase, width: 44 }}>未定</th>
              <th style={{ ...thBase, width: 44 }}>合計</th>
            </tr>
          </thead>

          <tbody>
            {activeEmps.length === 0 && (
              <tr>
                <td
                  colSpan={days.length + 4}
                  style={{
                    textAlign: 'center',
                    padding: 40,
                    color: 'var(--text-muted)',
                    fontSize: 13,
                  }}
                >
                  目前無指派中的任務
                </td>
              </tr>
            )}

            {activeEmps.map((emp) => {
              const empTasks = taskMap[emp.id] || {}
              const total = totalByEmp(emp.id)
              return (
                <tr key={emp.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {/* Name */}
                  <td style={{ padding: '6px 10px', verticalAlign: 'middle' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 12 }}>
                      {emp.name}
                    </div>
                    {(emp.dept || emp.position) && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                        {emp.dept || emp.position}
                      </div>
                    )}
                  </td>

                  {/* Overdue */}
                  <HeatCell
                    tasks={empTasks['overdue'] || []}
                    isOverdue
                    isSelected={selKey === `${emp.id}::overdue`}
                    onClick={() => toggle(emp.id, 'overdue')}
                  />

                  {/* Per-day */}
                  {days.map((d) => {
                    const key = toKey(d)
                    const isPast = key < todayKey
                    return (
                      <HeatCell
                        key={key}
                        tasks={isPast ? [] : (empTasks[key] || [])}
                        isSelected={selKey === `${emp.id}::${key}`}
                        isToday={key === todayKey}
                        isPast={isPast}
                        onClick={() => toggle(emp.id, key)}
                      />
                    )
                  })}

                  {/* No due date */}
                  <HeatCell
                    tasks={empTasks['none'] || []}
                    isSelected={selKey === `${emp.id}::none`}
                    onClick={() => toggle(emp.id, 'none')}
                  />

                  {/* Total */}
                  <td
                    style={{
                      textAlign: 'center',
                      fontWeight: 700,
                      fontSize: 12,
                      color:
                        total >= 10
                          ? 'var(--accent-red)'
                          : total >= 5
                          ? 'var(--accent-orange)'
                          : 'var(--text-secondary)',
                    }}
                  >
                    {total || ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Detail panel ── */}
      {selected && selectedTasks.length > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 8,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-medium)',
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              marginBottom: 10,
              color: 'var(--text-primary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>
              {activeEmps.find((e) => e.id === selected.empId)?.name} —{' '}
              {selected.dateKey === 'overdue'
                ? '逾期任務'
                : selected.dateKey === 'none'
                ? '無截止日任務'
                : selected.dateKey}
            </span>
            <button
              onClick={() => setSelected(null)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                fontSize: 18,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </div>

          {selectedTasks.map((t) => (
            <div
              key={t.id}
              onClick={() => onTaskClick?.(t)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 4px',
                borderBottom: '1px solid var(--border-subtle)',
                cursor: onTaskClick ? 'pointer' : 'default',
                borderRadius: 4,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: PRIORITY_COLOR[t.priority] || 'var(--accent-blue)',
                }}
              />
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)' }}>
                {t.title}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  background: 'var(--bg-secondary)',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                {t.status}
              </span>
              {t.due_date && selected.dateKey === 'overdue' && (
                <span style={{ fontSize: 10, color: 'var(--accent-red)' }}>{t.due_date}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Legend ── */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginTop: 14,
          fontSize: 11,
          color: 'var(--text-muted)',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {[
          { bg: 'var(--accent-green)', label: '1–2 件' },
          { bg: 'var(--accent-orange)', label: '3–4 件' },
          { bg: 'var(--accent-red)', label: '5+ 件' },
        ].map((l) => (
          <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: l.bg,
                opacity: 0.5,
                flexShrink: 0,
              }}
            />
            {l.label}
          </span>
        ))}
        <span style={{ marginLeft: 'auto' }}>點擊格子查看任務明細</span>
      </div>
    </div>
  )
}
