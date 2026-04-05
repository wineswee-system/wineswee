import { useState, useEffect } from 'react'
import { Search, Download, Clock, User, Edit3, Trash2, Plus, Eye, Settings, LogIn } from 'lucide-react'
import { getAuditLogs } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'

const actionConfig = {
  '新增': { icon: Plus, color: 'var(--accent-green)', dim: 'var(--accent-green-dim)' },
  '編輯': { icon: Edit3, color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)' },
  '更新': { icon: Edit3, color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)' },
  '刪除': { icon: Trash2, color: 'var(--accent-red)', dim: 'var(--accent-red-dim)' },
  '檢視': { icon: Eye, color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)' },
  '登入': { icon: LogIn, color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)' },
  '設定': { icon: Settings, color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
}

function getActionStyle(action) {
  for (const [key, cfg] of Object.entries(actionConfig)) {
    if (action?.includes(key)) return cfg
  }
  return { icon: Clock, color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)' }
}

export default function AuditLog() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [view, setView] = useState('timeline') // 'timeline' | 'table'

  useEffect(() => {
    getAuditLogs().then(({ data }) => {
      setLogs(data || [])
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const formatTime = (ts) => ts ? new Date(ts).toLocaleString('zh-TW') : '-'
  const formatRelative = (ts) => {
    if (!ts) return ''
    const diff = Date.now() - new Date(ts).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return '剛剛'
    if (mins < 60) return `${mins} 分鐘前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} 小時前`
    const days = Math.floor(hours / 24)
    return `${days} 天前`
  }

  const filtered = logs.filter(l =>
    search === '' ||
    l.user?.includes(search) ||
    l.action?.includes(search) ||
    l.target?.includes(search)
  )

  // Group by date
  const grouped = {}
  filtered.forEach(l => {
    const date = l.time ? new Date(l.time).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' }) : '未知日期'
    if (!grouped[date]) grouped[date] = []
    grouped[date].push(l)
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📜</span> 操作紀錄</h2>
            <p>系統操作稽核日誌</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-medium)' }}>
              <button
                onClick={() => setView('timeline')}
                style={{
                  padding: '6px 14px', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: view === 'timeline' ? 'var(--accent-cyan)' : 'var(--bg-card)',
                  color: view === 'timeline' ? '#fff' : 'var(--text-secondary)',
                }}
              >時間軸</button>
              <button
                onClick={() => setView('table')}
                style={{
                  padding: '6px 14px', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: view === 'table' ? 'var(--accent-cyan)' : 'var(--bg-card)',
                  color: view === 'table' ? '#fff' : 'var(--text-secondary)',
                }}
              >表格</button>
            </div>
            <button className="btn btn-secondary"><Download size={14} /> 匯出紀錄</button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總操作次數</div>
          <div className="stat-card-value">{logs.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">新增操作</div>
          <div className="stat-card-value">{logs.filter(l => l.action?.includes('新增')).length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">編輯操作</div>
          <div className="stat-card-value">{logs.filter(l => l.action?.includes('編輯') || l.action?.includes('更新')).length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">刪除操作</div>
          <div className="stat-card-value">{logs.filter(l => l.action?.includes('刪除')).length}</div>
        </div>
      </div>

      {/* Search */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div className="search-bar" style={{ margin: 0 }}>
          <Search className="search-icon" />
          <input
            type="text" placeholder="搜尋操作者、動作或對象..."
            className="form-input" style={{ paddingLeft: 38 }}
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Timeline View */}
      {view === 'timeline' ? (
        <div>
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date} style={{ marginBottom: 24 }}>
              <div style={{
                fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)',
                marginBottom: 12, padding: '6px 12px',
                background: 'var(--glass-light)', borderRadius: 8,
                display: 'inline-block',
              }}>{date}</div>

              <div style={{ position: 'relative', paddingLeft: 32 }}>
                {/* Timeline line */}
                <div style={{
                  position: 'absolute', left: 13, top: 0, bottom: 0, width: 2,
                  background: 'var(--border-subtle)', borderRadius: 1,
                }} />

                {items.map(log => {
                  const cfg = getActionStyle(log.action)
                  const Icon = cfg.icon
                  return (
                    <div key={log.id} style={{
                      position: 'relative', marginBottom: 8,
                      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                      borderRadius: 12, padding: '14px 16px',
                      transition: 'border-color 0.2s',
                    }}>
                      {/* Timeline dot */}
                      <div style={{
                        position: 'absolute', left: -26, top: 18,
                        width: 10, height: 10, borderRadius: '50%',
                        background: cfg.color, border: '2px solid var(--bg-primary)',
                        boxShadow: `0 0 0 3px ${cfg.dim}`,
                      }} />

                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                          background: cfg.dim, color: cfg.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon size={16} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{log.user}</span>
                            <span style={{
                              padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                              background: cfg.dim, color: cfg.color,
                            }}>{log.action}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{log.target}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                            <span>{formatTime(log.time)}</span>
                            <span>{formatRelative(log.time)}</span>
                            {log.ip && <span style={{ fontFamily: 'monospace' }}>{log.ip}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 13 }}>
              沒有符合條件的操作紀錄
            </div>
          )}
        </div>
      ) : (
        /* Table View */
        <div className="card">
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>#</th><th>操作者</th><th>動作</th><th>操作對象</th><th>時間</th><th>IP 位址</th></tr>
              </thead>
              <tbody>
                {filtered.map(log => {
                  const cfg = getActionStyle(log.action)
                  return (
                    <tr key={log.id}>
                      <td style={{ color: 'var(--text-muted)' }}>{log.id}</td>
                      <td style={{ fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <User size={14} style={{ color: 'var(--text-muted)' }} />
                          {log.user}
                        </div>
                      </td>
                      <td>
                        <span style={{
                          padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                          background: cfg.dim, color: cfg.color,
                        }}>{log.action}</span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{log.target}</td>
                      <td style={{ fontSize: 12 }}>
                        <div>{formatTime(log.time)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{formatRelative(log.time)}</div>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{log.ip}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
