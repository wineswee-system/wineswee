import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { getAuditLogs } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import { getActionStyle, formatTime, timeAgo, DiffBadge } from '../lib/auditLogUtils'

const PAGE_SIZE = 30

/**
 * Embeddable changelog panel for detail views (project, task, employee, workflow).
 *
 * Props:
 *   tables      — array of target_table values (e.g. ['tasks'])
 *   targetId    — optional record ID to scope to a single record
 *   orgId       — organization_id for tenant scoping
 *   currentUser — optional display name; enables "僅看我的" toggle
 */
export default function ChangelogPanel({ tables, targetId, orgId: orgIdProp, currentUser }) {
  const { profile, hasPermission } = useAuth()
  // Non-super-admins always query their own org to prevent cross-tenant data exposure
  const resolvedOrgId = hasPermission('nav.group.super_admin') ? orgIdProp : profile?.organization_id

  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(new Set())
  const [onlyMine, setOnlyMine] = useState(false)

  // Use stable string dep instead of array reference to avoid infinite re-fetch
  const tablesKey = tables?.join(',') ?? ''

  const fetchLogs = useCallback(async () => {
    if (!resolvedOrgId) { setLogs([]); setTotal(0); setLoading(false); return }
    setLoading(true)
    setError(null)
    const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE, orgId: resolvedOrgId }
    const tablesList = tablesKey ? tablesKey.split(',') : null
    if (tablesList?.length) params.tables = tablesList
    if (targetId != null) params.targetId = targetId
    if (onlyMine && currentUser) params.userName = currentUser
    const { data, count, error: err } = await getAuditLogs(params)
    if (err) { setError('無法載入變更紀錄'); setLoading(false); return }
    setLogs(data || [])
    setTotal(count || 0)
    setLoading(false)
  }, [resolvedOrgId, tablesKey, targetId, page, onlyMine, currentUser]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchLogs() }, [fetchLogs])
  useEffect(() => { setPage(p => p === 0 ? p : 0) }, [tablesKey, targetId, onlyMine, resolvedOrgId])

  const toggleExpand = (id) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const countLabel = onlyMine && currentUser ? `共 ${total} 筆（我的）` : `共 ${total} 筆變更紀錄`

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>
      載入中...
    </div>
  )

  if (error) return (
    <div style={{ textAlign: 'center', padding: 24, color: 'var(--accent-red)', fontSize: 13 }}>
      {error}
      <button className="btn btn-ghost btn-sm" onClick={() => { setError(null); fetchLogs() }} style={{ marginLeft: 8 }}>
        重試
      </button>
    </div>
  )

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{countLabel}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {currentUser && (
            <button
              onClick={() => setOnlyMine(v => !v)}
              style={{
                padding: '4px 10px', borderRadius: 6, border: '1px solid', fontSize: 11,
                fontWeight: 600, cursor: 'pointer',
                borderColor: onlyMine ? 'var(--accent-cyan)' : 'var(--border-medium)',
                background: onlyMine ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
                color: onlyMine ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              }}
            >
              僅看我的
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={fetchLogs} style={{ padding: '4px 8px' }} aria-label="重新整理">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Timeline */}
      {logs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
          尚無變更紀錄
        </div>
      ) : (
        <div style={{ position: 'relative', paddingLeft: 28 }}>
          <div style={{ position: 'absolute', left: 9, top: 0, bottom: 0, width: 2, background: 'var(--border-subtle)', borderRadius: 1 }} />

          {logs.map(log => {
            const cfg = getActionStyle(log.action)
            const Icon = cfg.icon
            const hasDiff = log.old_value || log.new_value
            const isOpen = expanded.has(log.id)

            return (
              <div key={log.id} style={{
                position: 'relative', marginBottom: 10,
                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                borderRadius: 10, padding: '10px 14px',
                cursor: hasDiff ? 'pointer' : 'default',
              }} onClick={() => hasDiff && toggleExpand(log.id)}>
                <div style={{
                  position: 'absolute', left: -22, top: 14,
                  width: 8, height: 8, borderRadius: '50%',
                  background: cfg.color, border: '2px solid var(--bg-primary)',
                }} />

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: cfg.dim, color: cfg.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={13} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{log.user}</span>
                      <span style={{
                        padding: '1px 7px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                        background: cfg.dim, color: cfg.color,
                      }}>{log.action}</span>
                      {log.target_table && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: 3 }}>
                          {log.target_table}
                        </span>
                      )}
                      {hasDiff && (
                        <span style={{ fontSize: 10, color: 'var(--accent-orange)', marginLeft: 'auto' }}>
                          {isOpen ? '▲' : '▼'}
                        </span>
                      )}
                    </div>

                    {log.target && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>{log.target}</div>
                    )}

                    <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
                      <span>{formatTime(log.time)}</span>
                      <span>{timeAgo(log.time)}</span>
                    </div>

                    {isOpen && hasDiff && (
                      <div style={{
                        marginTop: 8, padding: '6px 10px',
                        background: 'var(--bg-secondary)', borderRadius: 6,
                        borderLeft: '2px solid var(--accent-orange)',
                      }}>
                        {log.field_name && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                            欄位：<strong style={{ color: 'var(--text-secondary)' }}>{log.field_name}</strong>
                          </div>
                        )}
                        <DiffBadge oldVal={log.old_value} newVal={log.new_value} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>第 {page + 1} / {totalPages} 頁</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ padding: '3px 8px' }}>
              <ChevronLeft size={12} />
            </button>
            <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{ padding: '3px 8px' }}>
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
