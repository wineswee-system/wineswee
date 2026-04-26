import { useState } from 'react'
import { ChevronRight, MoreVertical, Archive, Trash2, CheckCircle2 } from 'lucide-react'

export default function ActiveInstancesList({ instances, getStats, onSelect, onArchive, onDelete }) {
  const [menuOpenId, setMenuOpenId] = useState(null)

  if (instances.length === 0) {
    return <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>目前沒有進行中的流程。從「流程範本」部署即可建立。</div>
  }

  const handleMenuClick = (e, instId) => {
    e.stopPropagation()
    setMenuOpenId(menuOpenId === instId ? null : instId)
  }

  const handleArchiveClick = (e, inst) => {
    e.stopPropagation()
    setMenuOpenId(null)
    onArchive?.(inst)
  }

  const handleDeleteClick = (e, inst) => {
    e.stopPropagation()
    setMenuOpenId(null)
    onDelete?.(inst)
  }

  return (
    <div onClick={() => menuOpenId && setMenuOpenId(null)}>
      {instances.map(inst => {
        const stats = getStats(inst.id)
        const isComplete = stats.pct === 100
        return (
          <div key={inst.id} className="card" style={{
            marginBottom: 12, cursor: 'pointer', transition: 'border-color 0.2s',
            borderColor: isComplete ? 'var(--accent-green)' : undefined,
            borderWidth: isComplete ? 2 : undefined,
            position: 'relative',
          }}
            onClick={() => onSelect(inst)}
            onMouseEnter={e => !isComplete && (e.currentTarget.style.borderColor = 'var(--accent-cyan)')}
            onMouseLeave={e => !isComplete && (e.currentTarget.style.borderColor = '')}>
            {isComplete && (
              <div style={{
                position: 'absolute', top: 8, left: 12,
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                background: 'var(--accent-green-dim)', color: 'var(--accent-green)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <CheckCircle2 size={11} /> 已完成 · 可封存
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: isComplete ? 16 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{inst.store || inst.template_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inst.template_name} · {inst.started_at?.slice(0, 10)}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, whiteSpace: 'nowrap' }}>
                <div style={{ display: 'flex', gap: 14, fontSize: 13 }}>
                  <span>⬜ {stats.pending}</span>
                  <span style={{ color: 'var(--accent-cyan)' }}>🔄 {stats.inProgress}</span>
                  <span style={{ color: 'var(--accent-green)' }}>✅ {stats.completed}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: isComplete ? 'var(--accent-green)' : 'var(--accent-cyan)' }}>{stats.pct}%</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stats.completed}/{stats.total}</div>
                  </div>
                  <div style={{
                    width: 48, height: 48, borderRadius: '50%',
                    background: `conic-gradient(${isComplete ? 'var(--accent-green)' : 'var(--accent-cyan)'} ${stats.pct * 3.6}deg, var(--border-medium) 0deg)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{stats.pct}%</div>
                  </div>
                </div>
                {/* ★ 操作 menu */}
                <div style={{ position: 'relative' }}>
                  <button onClick={(e) => handleMenuClick(e, inst.id)} style={{
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
                    <div style={{
                      position: 'absolute', top: '100%', right: 0, marginTop: 4,
                      background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
                      borderRadius: 8, padding: 4, minWidth: 140, zIndex: 10,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                    }}>
                      <button onClick={(e) => handleArchiveClick(e, inst)} style={{
                        width: '100%', padding: '8px 12px', background: 'none', border: 'none',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: 13, color: 'var(--text-primary)', borderRadius: 6, textAlign: 'left',
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <Archive size={14} /> 封存
                      </button>
                      <button onClick={(e) => handleDeleteClick(e, inst)} style={{
                        width: '100%', padding: '8px 12px', background: 'none', border: 'none',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: 13, color: 'var(--accent-red)', borderRadius: 6, textAlign: 'left',
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-red-dim)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <Trash2 size={14} /> 刪除
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* ★ 進度 bar */}
            <div style={{
              marginTop: 10, height: 4, background: 'var(--border-subtle)',
              borderRadius: 2, overflow: 'hidden',
            }}>
              <div style={{
                width: `${stats.pct}%`, height: '100%',
                background: isComplete ? 'var(--accent-green)' : 'var(--accent-cyan)',
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
