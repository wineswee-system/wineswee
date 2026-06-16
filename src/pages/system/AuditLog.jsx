import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, Download, User, Filter, X, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { getAuditLogs } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import { SECTIONS, ACTION_TYPES, getActionStyle, formatTime, timeAgo, DiffBadge } from '../../lib/auditLogUtils'
import { useDebouncedValue } from '../../lib/performanceUtils'

const PAGE_SIZE = 50

export default function AuditLog() {
  const { profile, isAdmin, hasPermission } = useAuth()
  // 稽核日誌：admin 或被授予「操作紀錄(audit.view)」權限者（權限設定頁可分人）
  const canViewAudit = isAdmin || hasPermission('audit.view')
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [section, setSection] = useState('all')
  const [view, setView] = useState('timeline')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(new Set())
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({ action: '', from: '', to: '' })

  const debouncedSearch = useDebouncedValue(search, 300)

  const fetchLogs = useCallback(async () => {
    if (!profile?.organization_id || !canViewAudit) { setLoading(false); return }
    setLoading(true)
    setError(null)
    const currentSection = SECTIONS.find(s => s.key === section)
    const params = { orgId: profile.organization_id, limit: PAGE_SIZE, offset: page * PAGE_SIZE }
    if (currentSection?.tables) params.tables = currentSection.tables
    if (filters.action) params.action = filters.action
    if (filters.from) params.from = new Date(filters.from).toISOString()
    if (filters.to) params.to = filters.to + 'T23:59:59Z'
    if (debouncedSearch) params.search = debouncedSearch
    const { data, count, error: err } = await getAuditLogs(params)
    if (err) setError('資料載入失敗，請重新整理頁面')
    else { setLogs(data || []); setTotal(count || 0) }
    setLoading(false)
  }, [profile?.organization_id, isAdmin, page, section, filters.action, filters.from, filters.to, debouncedSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchLogs() }, [fetchLogs])
  useEffect(() => { setPage(0); setExpanded(new Set()) }, [section, filters.action, filters.from, filters.to, debouncedSearch])

  const toggleExpand = (id) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const grouped = useMemo(() => {
    const g = {}
    logs.forEach(l => {
      const date = l.time
        ? new Date(l.time).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })
        : '未知日期'
      if (!g[date]) g[date] = []
      g[date].push(l)
    })
    return g
  }, [logs])

  const stats = useMemo(() => ({
    creates: logs.filter(l => l.action?.includes('新增')).length,
    edits:   logs.filter(l => l.action?.includes('編輯') || l.action?.includes('更新')).length,
    deletes: logs.filter(l => l.action?.includes('刪除')).length,
  }), [logs])

  const exportCSV = () => {
    const header = '時間,操作者,動作,對象,資料表,欄位,原值,新值,IP'
    const rows = logs.map(l =>
      `"${formatTime(l.time).replace(/"/g, '""')}","${(l.user || '').replace(/"/g, '""')}","${(l.action || '').replace(/"/g, '""')}","${(l.target || '').replace(/"/g, '""')}","${(l.target_table || '').replace(/"/g, '""')}","${(l.field_name || '').replace(/"/g, '""')}","${(l.old_value || '').replace(/"/g, '""')}","${(l.new_value || '').replace(/"/g, '""')}","${(l.ip || '').replace(/"/g, '""')}"`
    )
    const blob = new Blob(['﻿' + header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `changelog-${section}-${new Date().toISOString().slice(0, 10)}-p${page + 1}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const activeFilterCount = Object.values(filters).filter(Boolean).length

  if (!canViewAudit) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
      <h2>權限不足</h2>
      <p style={{ color: 'var(--text-secondary)' }}>此頁面僅限管理員存取</p>
    </div>
  )

  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={fetchLogs} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 變更日誌</h2>
            <p>全系統操作稽核與欄位級變更追蹤</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-medium)' }}>
              {['timeline', 'table'].map(v => (
                <button key={v} onClick={() => setView(v)} style={{
                  padding: '6px 14px', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: view === v ? 'var(--accent-cyan)' : 'var(--bg-card)',
                  color: view === v ? '#fff' : 'var(--text-secondary)',
                }}>{v === 'timeline' ? '時間軸' : '表格'}</button>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={exportCSV}><Download size={14} /> 匯出本頁 ({logs.length} 筆)</button>
            <button className="btn btn-secondary" onClick={fetchLogs}><RefreshCw size={14} /></button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總變更數</div>
          <div className="stat-card-value">{total}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">新增</div>
          <div className="stat-card-value">{stats.creates}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">編輯</div>
          <div className="stat-card-value">{stats.edits}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">刪除</div>
          <div className="stat-card-value">{stats.deletes}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {SECTIONS.map(s => (
          <button key={s.key} onClick={() => setSection(s.key)} style={{
            padding: '6px 14px', borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap',
            fontSize: 12, fontWeight: 600, border: '1px solid',
            borderColor: section === s.key ? 'var(--accent-cyan)' : 'var(--border-medium)',
            background: section === s.key ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
            color: section === s.key ? 'var(--accent-cyan)' : 'var(--text-secondary)',
          }}>{s.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input className="form-input" placeholder="搜尋動作或對象..." value={search}
            onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, width: '100%' }} />
        </div>
        <button className={`btn ${showFilters ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowFilters(v => !v)}>
          <Filter size={14} /> 篩選{activeFilterCount > 0 && ` (${activeFilterCount})`}
        </button>
        {activeFilterCount > 0 && (
          <button className="btn btn-secondary" onClick={() => setFilters({ action: '', from: '', to: '' })}>
            <X size={14} /> 清除
          </button>
        )}
      </div>

      {showFilters && (
        <div className="card" style={{ padding: 16, marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>動作類型</label>
            <select className="form-input" value={filters.action} onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}>
              <option value="">全部</option>
              {ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>開始日期</label>
            <input className="form-input" type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>結束日期</label>
            <input className="form-input" type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
          </div>
        </div>
      )}

      {loading ? <LoadingSpinner /> : view === 'timeline' ? (
        <div>
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date} style={{ marginBottom: 24 }}>
              <div style={{
                fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)',
                marginBottom: 12, padding: '6px 12px',
                background: 'var(--glass-light)', borderRadius: 8,
                display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
                {date}
                <span style={{ fontSize: 11, fontWeight: 400 }}>({items.length} 筆)</span>
              </div>

              <div style={{ position: 'relative', paddingLeft: 32 }}>
                <div style={{ position: 'absolute', left: 13, top: 0, bottom: 0, width: 2, background: 'var(--border-subtle)', borderRadius: 1 }} />
                {items.map(log => {
                  const cfg = getActionStyle(log.action)
                  const Icon = cfg.icon
                  const hasDiff = log.old_value || log.new_value
                  const isOpen = expanded.has(log.id)
                  return (
                    <div key={log.id} style={{
                      position: 'relative', marginBottom: 8,
                      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                      borderRadius: 12, padding: '14px 16px',
                      cursor: hasDiff ? 'pointer' : 'default',
                    }} onClick={() => hasDiff && toggleExpand(log.id)}>
                      <div style={{ position: 'absolute', left: -26, top: 18, width: 10, height: 10, borderRadius: '50%', background: cfg.color, border: '2px solid var(--bg-primary)', boxShadow: `0 0 0 3px ${cfg.dim}` }} />
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: cfg.dim, color: cfg.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon size={16} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{log.user}</span>
                            <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: cfg.dim, color: cfg.color }}>{log.action}</span>
                            {log.target_table && (
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>
                                {log.target_table}
                              </span>
                            )}
                            {hasDiff && (
                              <span style={{ fontSize: 11, color: 'var(--accent-orange)', marginLeft: 'auto' }}>
                                {isOpen ? '▲ 收起' : '▼ 查看變更'}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{log.target}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                            <span>{formatTime(log.time)}</span>
                            <span>{timeAgo(log.time)}</span>
                            {log.ip && <span style={{ fontFamily: 'monospace' }}>{log.ip}</span>}
                          </div>
                          {isOpen && hasDiff && (
                            <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8, borderLeft: '3px solid var(--accent-orange)' }}>
                              {log.field_name && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
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
            </div>
          ))}
          {logs.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 13 }}>
              沒有符合條件的變更紀錄
            </div>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>時間</th><th>操作者</th><th>動作</th><th>對象</th><th>資料表</th><th>欄位變更</th><th>IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => {
                  const cfg = getActionStyle(log.action)
                  const hasDiff = log.old_value || log.new_value
                  return (
                    <tr key={log.id} style={{ cursor: hasDiff ? 'pointer' : 'default' }}
                      onClick={() => hasDiff && toggleExpand(log.id)}>
                      <td>
                        <div style={{ fontSize: 12 }}>{formatTime(log.time)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(log.time)}</div>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <User size={14} style={{ color: 'var(--text-muted)' }} />
                          {log.user}
                        </span>
                      </td>
                      <td><span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: cfg.dim, color: cfg.color }}>{log.action}</span></td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.target}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{log.target_table || '-'}</td>
                      <td>
                        {hasDiff && (
                          <div>
                            {log.field_name && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>{log.field_name}</div>}
                            <DiffBadge oldVal={log.old_value} newVal={log.new_value} />
                          </div>
                        )}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{log.ip}</td>
                    </tr>
                  )
                })}
                {logs.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>沒有符合條件的變更紀錄</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>共 {total} 筆，第 {page + 1} / {totalPages} 頁</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={14} /> 上一頁
            </button>
            <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              下一頁 <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
