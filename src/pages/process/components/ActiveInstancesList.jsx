import { useState, useEffect } from 'react'
import { ChevronRight, MoreVertical, Archive, Trash2, CheckCircle2, FolderOpen, User, Users } from 'lucide-react'

export default function ActiveInstancesList({ instances, getStats, onSelect, onArchive, onDelete, projects = [], lineGroups = [] }) {
  const [menuOpenId, setMenuOpenId] = useState(null)

  useEffect(() => {
    if (!menuOpenId) return
    const close = () => setMenuOpenId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpenId])

  if (instances.length === 0) {
    return <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>目前沒有進行中的流程。從「流程範本」部署即可建立。</div>
  }

  return (
    <div>
      {instances.map(inst => {
        const stats = getStats(inst.id)
        const isComplete = stats.pct === 100
        const accent = isComplete ? 'var(--accent-green)' : 'var(--accent-cyan)'
        const project = projects.find(p => p.id === inst.project_id)
        const instGroups = inst.groups || []
        const hasMeta = project || inst.assignee || instGroups.length > 0

        return (
          <div key={inst.id} className="card" style={{
            marginBottom: 12, padding: '14px 16px', cursor: 'pointer',
            borderColor: isComplete ? 'var(--accent-green)' : undefined,
            transition: 'border-color 0.2s',
          }}
            onClick={() => onSelect(inst)}
            onMouseEnter={e => !isComplete && (e.currentTarget.style.borderColor = 'var(--accent-cyan)')}
            onMouseLeave={e => !isComplete && (e.currentTarget.style.borderColor = '')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* 左：標題 + 副資訊 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inst.store || inst.template_name}
                  </span>
                  {isComplete && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                      background: 'var(--accent-green-dim)', color: 'var(--accent-green)',
                      display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
                    }}>
                      <CheckCircle2 size={10} /> 可封存
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 22, marginBottom: hasMeta ? 6 : 0 }}>
                  {inst.template_name} · {inst.started_at?.slice(0, 10)}
                </div>
                {hasMeta && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginLeft: 22 }}>
                    {project && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', border: '1px solid rgba(168,85,247,0.2)' }}>
                        <FolderOpen size={10} /> {project.name}
                      </span>
                    )}
                    {inst.assignee && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: 'var(--glass-light)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                        <User size={10} /> {inst.assignee}
                      </span>
                    )}
                    {instGroups.map((g, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: '1px solid rgba(6,182,212,0.2)' }}>
                        <Users size={10} /> {g}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 中：步驟統計 */}
              <div style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
                {stats.pending > 0 && <span>⬜ {stats.pending}</span>}
                {stats.inProgress > 0 && <span style={{ color: 'var(--accent-cyan)' }}>🔄 {stats.inProgress}</span>}
                <span style={{ color: 'var(--accent-green)' }}>✅ {stats.completed}</span>
              </div>

              {/* 右：百分比圈圈 */}
              <div style={{
                width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                background: `conic-gradient(${accent} ${stats.pct * 3.6}deg, var(--border-medium) 0deg)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-card)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: accent, lineHeight: 1 }}>{stats.pct}%</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1, marginTop: 2 }}>{stats.completed}/{stats.total}</div>
                </div>
              </div>

              {/* 操作 menu */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === inst.id ? null : inst.id) }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: 6, borderRadius: 6, color: 'var(--text-muted)',
                    display: 'flex', alignItems: 'center',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <MoreVertical size={16} />
                </button>
                {menuOpenId === inst.id && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                      background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
                      borderRadius: 8, padding: 4, minWidth: 130, zIndex: 100,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                    }}
                  >
                    <button
                      onClick={() => { setMenuOpenId(null); onArchive?.(inst) }}
                      style={menuItemStyle('var(--text-primary)')}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <Archive size={14} /> 封存
                    </button>
                    <button
                      onClick={() => { setMenuOpenId(null); onDelete?.(inst) }}
                      style={menuItemStyle('var(--accent-red)')}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-red-dim)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <Trash2 size={14} /> 刪除
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 底部進度 bar */}
            <div style={{
              marginTop: 10, height: 3, background: 'var(--border-subtle)',
              borderRadius: 2, overflow: 'hidden',
            }}>
              <div style={{
                width: `${stats.pct}%`, height: '100%',
                background: accent, transition: 'width 0.3s',
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

const menuItemStyle = (color) => ({
  width: '100%', padding: '8px 12px', background: 'none', border: 'none',
  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
  fontSize: 13, color, borderRadius: 6, textAlign: 'left',
})
