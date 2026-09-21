import { useState } from 'react'
import { Plus, GripVertical } from 'lucide-react'
import { updateTask } from '../../lib/db'

// CSS token strings — resolved by the browser, safe for DOM style props.
// (Not hex literals, which would drift from the design token definitions.)
const PRIORITY_COLORS = { 高: 'var(--accent-red)', 中: 'var(--accent-orange)', 低: 'var(--accent-green)' }
const PRIORITY_DIM    = { 高: 'var(--accent-red-dim)', 中: 'var(--accent-orange-dim)', 低: 'var(--accent-green-dim)' }
const PRIORITY_ORDER  = ['高', '中', '低']

const STATUS_COLUMNS = [
  { id: null, name: '未開始', color: 'var(--text-muted)',    dimBg: 'var(--bg-secondary)',     _statusMap: '未開始' },
  { id: null, name: '進行中', color: 'var(--accent-cyan)',   dimBg: 'var(--accent-cyan-dim)',  _statusMap: '進行中' },
  { id: null, name: '已完成', color: 'var(--accent-green)',  dimBg: 'var(--accent-green-dim)', _statusMap: '已完成' },
  { id: null, name: '已擱置', color: 'var(--accent-red)',    dimBg: 'var(--accent-red-dim)',   _statusMap: '已擱置' },
]

function TaskCard({ t, draggedId, onDragStart, onDragEnd, onTaskClick }) {
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, t)}
      onDragEnd={onDragEnd}
      onClick={() => onTaskClick?.(t)}
      role="listitem"
      aria-label={t.title}
      aria-grabbed={draggedId === t.id}
      style={{
        background: 'var(--bg-secondary)', borderRadius: 8, padding: 10,
        border: '1px solid var(--border-subtle)', cursor: 'pointer',
        opacity: draggedId === t.id ? 0.4 : 1,
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <GripVertical size={12} style={{ color: 'var(--text-muted)', marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{t.title}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            {t.priority && (
              <span style={{
                padding: '1px 6px', borderRadius: 3, fontWeight: 600,
                color: PRIORITY_COLORS[t.priority] || 'var(--text-muted)',
                background: PRIORITY_DIM[t.priority] || 'var(--bg-secondary)',
              }}>
                {t.priority}
              </span>
            )}
            {t.due_date && <span>📅 {t.due_date.slice(5)}</span>}
            {t.assignee && <span>👤 {t.assignee}</span>}
            {t.watcher_count > 0 && <span>👁 {t.watcher_count}</span>}
            {t.comment_count > 0 && <span>💬 {t.comment_count}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

function KanbanColumn({ col, tasks, overKey, draggedId, onDragOver, onDragLeave, onDrop, onDragStart, onDragEnd, onTaskClick, onAddTask, compact }) {
  const isOver = overKey === (col.id ?? col._statusMap)
  return (
    <div
      role="group"
      aria-label={col.name}
      onDragOver={e => { e.preventDefault(); onDragOver(col.id ?? col._statusMap) }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) onDragLeave() }}
      onDrop={e => onDrop(e, col)}
      style={{
        minWidth: compact ? 200 : 280,
        flex: compact ? '1 1 200px' : '0 0 280px',
        background: isOver ? (col.dimBg || 'var(--bg-secondary)') : 'var(--bg-card)',
        border: `1px solid ${isOver ? col.color : 'var(--border-medium)'}`,
        borderRadius: 12, padding: 10, transition: 'all 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }} />
          <span style={{ fontSize: compact ? 12 : 13, fontWeight: 700 }}>{col.name}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tasks.length}</span>
        </div>
        {onAddTask && (
          <button
            onClick={() => onAddTask(col)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
            title="新增任務"
            aria-label={`新增任務到 ${col.name}`}
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 40 }}>
        {tasks.map(t => (
          <TaskCard key={t.id} t={t} draggedId={draggedId} onDragStart={onDragStart} onDragEnd={onDragEnd} onTaskClick={onTaskClick} />
        ))}
        {tasks.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 16, opacity: 0.6 }}>
            拖曳任務至此
          </div>
        )}
      </div>
    </div>
  )
}

export default function TaskKanban({ tasks, sections, onTaskClick, onTaskMoved, onAddTask, groupBy }) {
  const [draggedId, setDraggedId] = useState(null)
  const [overSection, setOverSection] = useState(null)

  const columns = sections?.length ? sections : STATUS_COLUMNS

  const onDragStart = (e, t) => {
    setDraggedId(t.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragEnd = () => {
    setDraggedId(null)
    setOverSection(null)
  }

  const onDrop = async (e, col) => {
    e.preventDefault()
    setOverSection(null)
    if (!draggedId) return
    const patch = col.id != null
      ? { section_id: col.id }
      : { status: col._statusMap, section_id: null }
    const { data } = await updateTask(draggedId, patch)
    if (data) onTaskMoved?.(data)
    setDraggedId(null)
  }

  const colTasksFor = (col, subset) => {
    if (col.id != null) return subset.filter(t => t.section_id === col.id)
    return subset.filter(t => t.status === col._statusMap && !t.section_id)
  }

  const sharedColumnProps = {
    overKey: overSection,
    draggedId,
    onDragOver: setOverSection,
    onDragLeave: () => setOverSection(null),
    onDrop,
    onDragStart,
    onDragEnd,
    onTaskClick,
    onAddTask,
  }

  // ── Swimlane mode ──
  if (groupBy) {
    let groups = []
    if (groupBy === 'priority') {
      const present = PRIORITY_ORDER.filter(p => tasks.some(t => t.priority === p))
      groups = present.map(p => ({ key: p, label: p }))
      if (tasks.some(t => !t.priority)) groups.push({ key: '__none__', label: '未設定' })
    } else if (groupBy === 'assignee') {
      const names = [...new Set(tasks.map(t => t.assignee || '__none__'))].sort((a, b) =>
        a === '__none__' ? 1 : b === '__none__' ? -1 : a.localeCompare(b, 'zh-TW')
      )
      groups = names.map(n => ({ key: n, label: n === '__none__' ? '未指派' : n }))
    } else if (groupBy === 'workflow') {
      const wfs = [...new Set(tasks.map(t => t.workflow || '__none__'))].sort((a, b) =>
        a === '__none__' ? 1 : b === '__none__' ? -1 : a.localeCompare(b, 'zh-TW')
      )
      groups = wfs.map(w => ({ key: w, label: w === '__none__' ? '直接任務' : w }))
    }

    const filterGroup = (group) => tasks.filter(t => {
      if (groupBy === 'priority') return group.key === '__none__' ? !t.priority : t.priority === group.key
      if (groupBy === 'assignee') return (t.assignee || '__none__') === group.key
      if (groupBy === 'workflow') return (t.workflow || '__none__') === group.key
      return true
    })

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {groups.map(group => {
          const groupTasks = filterGroup(group)
          return (
            <div key={group.key}>
              <div style={{
                fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)',
                padding: '5px 12px', marginBottom: 8,
                background: 'var(--bg-secondary)',
                borderLeft: '3px solid var(--accent-cyan)',
                borderRadius: '0 6px 6px 0',
                display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
                {group.label}
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>({groupTasks.length})</span>
              </div>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
                {columns.map(col => (
                  <KanbanColumn
                    key={col.id ?? col._statusMap}
                    col={col}
                    tasks={colTasksFor(col, groupTasks)}
                    compact
                    {...sharedColumnProps}
                  />
                ))}
              </div>
            </div>
          )
        })}
        {groups.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>無任務</div>
        )}
      </div>
    )
  }

  // ── Standard kanban ──
  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
      {columns.map(col => (
        <KanbanColumn
          key={col.id ?? col._statusMap}
          col={col}
          tasks={colTasksFor(col, tasks)}
          {...sharedColumnProps}
        />
      ))}
    </div>
  )
}
