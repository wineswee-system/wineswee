import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Copy, Trash2, CheckCircle, Circle, Clock, PauseCircle, ChevronRight, UserCheck } from 'lucide-react'

const STATUS_OPTS = [
  { v: '未開始', icon: <Circle size={13} />,       color: 'var(--text-muted)' },
  { v: '進行中', icon: <Clock size={13} />,        color: 'var(--accent-cyan)' },
  { v: '已完成', icon: <CheckCircle size={13} />,  color: 'var(--accent-green)' },
  { v: '已擱置', icon: <PauseCircle size={13} />,  color: 'var(--accent-red)' },
]

const ITEM = {
  display: 'flex', alignItems: 'center', gap: 9,
  padding: '7px 13px', fontSize: 13, cursor: 'pointer',
  borderRadius: 5, color: 'var(--text-primary)',
  border: 'none', background: 'none', width: '100%', textAlign: 'left',
}

const SEP = <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />

export default function TaskContextMenu({
  task,
  x, y,
  onClose,
  onEdit,
  onDuplicate,
  onStatusChange,
  onDelete,
  assigneeOptions = [],
  onAssign,
}) {
  const ref = useRef(null)
  const [showStatus, setShowStatus] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [pos, setPos] = useState({ x, y })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth  - r.width  - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    })
  }, [x, y])

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKey  = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const hi    = e => { e.currentTarget.style.background = 'var(--bg-secondary)' }
  const lo    = e => { e.currentTarget.style.background = 'none' }
  const hiRed = e => { e.currentTarget.style.background = 'var(--accent-red-dim)'; e.currentTarget.style.color = 'var(--accent-red)' }
  const loRed = e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-primary)' }

  const SubMenu = ({ children, style }) => (
    <div style={{
      position: 'absolute', top: 0, left: '100%', marginLeft: 4,
      background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
      borderRadius: 9, padding: 5, minWidth: 150,
      boxShadow: '0 8px 24px rgba(0,0,0,0.3)', zIndex: 100001,
      maxHeight: 260, overflowY: 'auto',
      ...style,
    }}>{children}</div>
  )

  return createPortal(
    <div ref={ref} onClick={e => e.stopPropagation()} style={{
      position: 'fixed', top: pos.y, left: pos.x, zIndex: 99999,
      background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
      borderRadius: 10, padding: 5, minWidth: 210,
      boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      animation: 'fadeIn 0.1s ease',
    }}>
      <div style={{ padding: '3px 13px 7px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)', marginBottom: 4 }}>
        tk-{task.id} · {task.title?.slice(0, 26)}{(task.title?.length ?? 0) > 26 ? '…' : ''}
      </div>

      <button style={ITEM} onMouseEnter={hi} onMouseLeave={lo} onClick={() => { onEdit(task); onClose() }}>
        <Pencil size={14} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} /> 編輯任務
      </button>
      <button style={ITEM} onMouseEnter={hi} onMouseLeave={lo} onClick={() => { onDuplicate?.(task); onClose() }}>
        <Copy size={14} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} /> 複製任務
      </button>

      {SEP}

      {/* Status sub-menu */}
      <div style={{ position: 'relative' }}
        onMouseEnter={() => { setShowStatus(true); setShowAssign(false) }}
        onMouseLeave={() => setShowStatus(false)}>
        <button style={{ ...ITEM, justifyContent: 'space-between' }} onMouseEnter={hi} onMouseLeave={lo}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Clock size={14} style={{ color: 'var(--accent-orange)', flexShrink: 0 }} /> 更改狀態
          </span>
          <ChevronRight size={13} style={{ color: 'var(--text-muted)' }} />
        </button>
        {showStatus && (
          <SubMenu>
            {STATUS_OPTS.map(s => (
              <button key={s.v}
                style={{ ...ITEM, fontWeight: task.status === s.v ? 700 : 400, color: task.status === s.v ? s.color : 'var(--text-primary)' }}
                onMouseEnter={hi} onMouseLeave={lo}
                onClick={() => { onStatusChange?.(task.id, s.v); onClose() }}>
                <span style={{ color: s.color }}>{s.icon}</span> {s.v}
                {task.status === s.v && <span style={{ marginLeft: 'auto', fontSize: 10, color: s.color }}>●</span>}
              </button>
            ))}
          </SubMenu>
        )}
      </div>

      {/* Assign sub-menu */}
      {assigneeOptions.length > 0 && (
        <div style={{ position: 'relative' }}
          onMouseEnter={() => { setShowAssign(true); setShowStatus(false) }}
          onMouseLeave={() => setShowAssign(false)}>
          <button style={{ ...ITEM, justifyContent: 'space-between' }} onMouseEnter={hi} onMouseLeave={lo}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <UserCheck size={14} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} /> 指派負責人
            </span>
            <ChevronRight size={13} style={{ color: 'var(--text-muted)' }} />
          </button>
          {showAssign && (
            <SubMenu>
              {assigneeOptions.map(name => (
                <button key={name}
                  style={{ ...ITEM, fontWeight: task.assignee === name ? 700 : 400, color: task.assignee === name ? 'var(--accent-cyan)' : 'var(--text-primary)' }}
                  onMouseEnter={hi} onMouseLeave={lo}
                  onClick={() => { onAssign?.(task.id, name); onClose() }}>
                  👤 {name}
                  {task.assignee === name && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--accent-cyan)' }}>●</span>}
                </button>
              ))}
            </SubMenu>
          )}
        </div>
      )}

      {SEP}

      <button style={ITEM} onMouseEnter={hiRed} onMouseLeave={loRed}
        onClick={() => { onDelete?.(task.id); onClose() }}>
        <Trash2 size={14} style={{ flexShrink: 0 }} /> 刪除任務
      </button>
    </div>,
    document.body
  )
}
