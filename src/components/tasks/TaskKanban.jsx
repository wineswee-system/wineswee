import { useState } from 'react'
import { Plus, GripVertical } from 'lucide-react'
import { updateTask } from '../../lib/db'

const PRIORITY_COLORS = { 高: '#ef4444', 中: '#f59e0b', 低: '#10b981' }

export default function TaskKanban({ tasks, sections, onTaskClick, onTaskMoved, onAddTask }) {
  const [draggedId, setDraggedId] = useState(null)
  const [overSection, setOverSection] = useState(null)

  const columns = sections?.length
    ? sections
    : [
        { id: null, name: '未開始', color: '#94a3b8', _statusMap: '未開始' },
        { id: null, name: '進行中', color: '#06b6d4', _statusMap: '進行中' },
        { id: null, name: '已完成', color: '#10b981', _statusMap: '已完成' },
        { id: null, name: '已擱置', color: '#ef4444', _statusMap: '已擱置' },
      ]

  const tasksFor = (col) => {
    if (col.id != null) return tasks.filter(t => t.section_id === col.id)
    return tasks.filter(t => (t.status === col._statusMap) && !t.section_id)
  }

  const onDragStart = (e, t) => {
    setDraggedId(t.id)
    e.dataTransfer.effectAllowed = 'move'
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

  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
      {columns.map(col => {
        const colTasks = tasksFor(col)
        const isOver = overSection === (col.id ?? col._statusMap)
        return (
          <div
            key={col.id ?? col._statusMap}
            onDragOver={e => { e.preventDefault(); setOverSection(col.id ?? col._statusMap) }}
            onDragLeave={() => setOverSection(null)}
            onDrop={e => onDrop(e, col)}
            style={{
              minWidth: 280, flex: '0 0 280px',
              background: isOver ? 'color-mix(in srgb, var(--accent-cyan) 10%, var(--bg-card))' : 'var(--bg-card)',
              border: `1px solid ${isOver ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
              borderRadius: 12, padding: 10, transition: 'all 0.15s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{col.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{colTasks.length}</span>
              </div>
              {onAddTask && (
                <button
                  onClick={() => onAddTask(col)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
                  title="新增任務"
                >
                  <Plus size={14} />
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 40 }}>
              {colTasks.map(t => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={e => onDragStart(e, t)}
                  onClick={() => onTaskClick?.(t)}
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
                          <span style={{ padding: '1px 6px', borderRadius: 3, color: PRIORITY_COLORS[t.priority] || 'var(--text-muted)', background: `color-mix(in srgb, ${PRIORITY_COLORS[t.priority] || '#64748b'} 15%, transparent)`, fontWeight: 600 }}>
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
              ))}
              {colTasks.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: 16, opacity: 0.6 }}>
                  拖曳任務至此
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
