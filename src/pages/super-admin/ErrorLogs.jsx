import { useState, useEffect, useCallback } from 'react'
import {
  Shield, Search, RefreshCw, Download, Filter, AlertOctagon,
  AlertTriangle, XCircle, CheckCircle, ChevronLeft, ChevronRight, X, Clock,
  RotateCcw, GitCommit, FileText, AlertCircle
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getErrorLogs, resolveErrorLog, unresolveErrorLog, getTenants } from '../../lib/db'

const MODULES = ['Auth', 'HR', 'Finance', 'CRM', 'Sales', 'POS', 'WMS', 'Purchase', 'Manufacturing', 'Analytics', 'Process', 'Integration', 'AI', 'System', 'Runtime']

const levelStyle = {
  error: { bg: '#fee2e2', color: '#dc2626', icon: AlertTriangle },
  fatal: { bg: '#fecaca', color: '#991b1b', icon: XCircle },
}

const PAGE_SIZE = 50

function timeAgo(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60) return '剛剛'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`
  return d.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function ErrorLogs() {
  const { isSuperAdmin, profile } = useAuth()
  const [logs, setLogs] = useState([])
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({ tenantId: '', level: '', module: '', resolved: '', from: '', to: '' })
  const [expandedRow, setExpandedRow] = useState(null)
  // Resolve modal state
  const [resolveModal, setResolveModal] = useState(null)  // { id, errorCode, message } | null
  const [resolveNote, setResolveNote] = useState('')
  const [resolveRef, setResolveRef] = useState('')
  const [resolving, setResolving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE }
    if (filters.tenantId) params.tenantId = Number(filters.tenantId)
    if (filters.level) params.level = filters.level
    if (filters.module) params.module = filters.module
    if (filters.resolved !== '') params.resolved = filters.resolved === 'true'
    if (filters.from) params.from = new Date(filters.from).toISOString()
    if (filters.to) params.to = new Date(filters.to + 'T23:59:59').toISOString()
    const { data, error, count } = await getErrorLogs(params)
    if (!error && data) { setLogs(data); setTotal(count || 0) }
    setLoading(false)
  }, [page, filters])

  useEffect(() => {
    getTenants().then(({ data }) => { if (data) setTenants(data) })
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Clicking "resolve" on an unresolved error opens the modal
  const openResolveModal = (log) => {
    setResolveModal({ id: log.id, errorCode: log.error_code, message: log.message })
    setResolveNote('')
    setResolveRef('')
  }

  // Submit the resolve modal
  const handleConfirmResolve = async () => {
    if (!resolveModal) return
    setResolving(true)
    await resolveErrorLog(
      resolveModal.id,
      profile?.name || 'super_admin',
      resolveNote.trim() || null,
      resolveRef.trim()  || null,
    )
    setResolving(false)
    setResolveModal(null)
    fetchData()
  }

  // One-click unresolve (no note needed — history is preserved)
  const handleUnresolve = async (id) => {
    await unresolveErrorLog(id)
    fetchData()
  }

  const filtered = logs.filter(l => {
    if (!search) return true
    const s = search.toLowerCase()
    return (l.message || '').toLowerCase().includes(s) ||
      (l.error_code || '').toLowerCase().includes(s) ||
      (l.component || '').toLowerCase().includes(s) ||
      (l.user || '').toLowerCase().includes(s)
  })

  const resetFilters = () => {
    setFilters({ tenantId: '', level: '', module: '', resolved: '', from: '', to: '' })
    setPage(0)
  }

  const exportCSV = () => {
    const header = '時間,等級,模組,錯誤碼,訊息,元件,使用者,組織,已解決,解決者,解決時間,解決說明,修復參考,復發次數'
    const rows = filtered.map(l =>
      [
        `"${new Date(l.created_at).toLocaleString('zh-TW')}"`,
        `"${l.level}"`,
        `"${l.module || ''}"`,
        `"${l.error_code || ''}"`,
        `"${(l.message || '').replace(/"/g, '""')}"`,
        `"${l.component || ''}"`,
        `"${l.user || ''}"`,
        `"${l.organizations?.name || l.tenants?.name || ''}"`,
        `"${l.resolved ? '是' : '否'}"`,
        `"${l.resolved_by || ''}"`,
        `"${l.resolved_at ? new Date(l.resolved_at).toLocaleString('zh-TW') : ''}"`,
        `"${(l.resolution_note || '').replace(/"/g, '""')}"`,
        `"${(l.fix_reference || '').replace(/"/g, '""')}"`,
        `"${l.recurrence_count || 0}"`,
      ].join(',')
    )
    const blob = new Blob(['\ufeff' + header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `error-logs-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const activeFilterCount = Object.values(filters).filter(Boolean).length

  const unresolvedCount = logs.filter(l => !l.resolved).length
  const fatalCount = logs.filter(l => l.level === 'fatal').length

  if (!isSuperAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
        <Shield size={48} style={{ color: 'var(--accent-red)' }} />
        <h2>超級管理員專屬</h2>
        <p style={{ color: 'var(--text-secondary)' }}>此頁面僅限超級管理員存取</p>
      </div>
    )
  }

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h2><AlertOctagon size={22} style={{ marginRight: 8, color: '#dc2626' }} />錯誤日誌</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>跨組織錯誤追蹤與解決狀態管理</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={exportCSV}><Download size={15} /> 匯出</button>
          <button className="btn btn-secondary" onClick={fetchData}><RefreshCw size={15} /> 重新整理</button>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <div className="stat-card" style={{ "--card-accent": "var(--accent-cyan)", "--card-accent-dim": "var(--accent-cyan-dim)" }}><div className="stat-card-value">{total}</div><div className="stat-card-label">總錯誤數</div></div>
        <div className="stat-card"><div className="stat-card-value" style={{ color: '#dc2626' }}>{unresolvedCount}</div><div className="stat-card-label">未解決</div></div>
        <div className="stat-card"><div className="stat-card-value" style={{ color: '#991b1b' }}>{fatalCount}</div><div className="stat-card-label">Fatal</div></div>
        <div className="stat-card"><div className="stat-card-value" style={{ color: '#16a34a' }}>{total - unresolvedCount}</div><div className="stat-card-label">已解決</div></div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input className="form-input" placeholder="搜尋錯誤訊息、錯誤碼、元件..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 32, width: '100%' }} />
        </div>
        <button className={`btn ${showFilters ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowFilters(!showFilters)}>
          <Filter size={14} /> 篩選{activeFilterCount > 0 && ` (${activeFilterCount})`}
        </button>
        {activeFilterCount > 0 && (
          <button className="btn btn-secondary" onClick={resetFilters}><X size={14} /> 清除篩選</button>
        )}
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="card" style={{ padding: 16, marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>組織</label>
            <select className="form-input" value={filters.tenantId} onChange={e => { setFilters(f => ({ ...f, tenantId: e.target.value })); setPage(0) }}>
              <option value="">全部組織</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>等級</label>
            <select className="form-input" value={filters.level} onChange={e => { setFilters(f => ({ ...f, level: e.target.value })); setPage(0) }}>
              <option value="">全部</option>
              <option value="error">ERROR</option>
              <option value="fatal">FATAL</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>模組</label>
            <select className="form-input" value={filters.module} onChange={e => { setFilters(f => ({ ...f, module: e.target.value })); setPage(0) }}>
              <option value="">全部</option>
              {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>解決狀態</label>
            <select className="form-input" value={filters.resolved} onChange={e => { setFilters(f => ({ ...f, resolved: e.target.value })); setPage(0) }}>
              <option value="">全部</option>
              <option value="false">未解決</option>
              <option value="true">已解決</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>開始日期</label>
            <input className="form-input" type="date" value={filters.from} onChange={e => { setFilters(f => ({ ...f, from: e.target.value })); setPage(0) }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>結束日期</label>
            <input className="form-input" type="date" value={filters.to} onChange={e => { setFilters(f => ({ ...f, to: e.target.value })); setPage(0) }} />
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ overflow: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>時間</th>
              <th style={{ width: 70 }}>等級</th>
              <th style={{ width: 90 }}>模組</th>
              <th style={{ width: 130 }}>錯誤碼</th>
              <th>訊息</th>
              <th style={{ width: 120 }}>組織</th>
              <th style={{ width: 80 }}>狀態</th>
              <th style={{ width: 70 }}>復發</th>
              <th style={{ width: 80 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40 }}>載入中...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>尚無錯誤日誌</td></tr>
            ) : filtered.map(l => {
              const ls = levelStyle[l.level] || levelStyle.error
              const LIcon = ls.icon
              const hasRecurrence = (l.recurrence_count || 0) > 0
              return (
                <tr key={l.id} style={{ cursor: 'pointer', background: l.resolved ? undefined : 'rgba(220,38,38,0.03)' }}>
                  <td onClick={() => setExpandedRow(expandedRow === l.id ? null : l.id)}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={12} style={{ color: 'var(--text-secondary)' }} />{timeAgo(l.created_at)}</span>
                  </td>
                  <td onClick={() => setExpandedRow(expandedRow === l.id ? null : l.id)}>
                    <span className="badge" style={{ background: ls.bg, color: ls.color }}>
                      <LIcon size={11} style={{ marginRight: 3 }} />{l.level.toUpperCase()}
                    </span>
                  </td>
                  <td onClick={() => setExpandedRow(expandedRow === l.id ? null : l.id)}>{l.module || '-'}</td>
                  <td onClick={() => setExpandedRow(expandedRow === l.id ? null : l.id)}>
                    {l.error_code ? (
                      <code style={{ fontSize: 11, background: ls.bg, color: ls.color, padding: '2px 6px', borderRadius: 4 }}>{l.error_code}</code>
                    ) : '-'}
                  </td>
                  <td onClick={() => setExpandedRow(expandedRow === l.id ? null : l.id)} style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.message}
                  </td>
                  <td onClick={() => setExpandedRow(expandedRow === l.id ? null : l.id)}>
                    {(l.organizations?.name || l.tenants?.name)
                      ? <span className="badge badge-neutral">{l.organizations?.name || l.tenants?.name}</span>
                      : '—'}
                  </td>
                  <td onClick={() => setExpandedRow(expandedRow === l.id ? null : l.id)}>
                    {l.resolved ? (
                      <span className="badge badge-success" title={l.resolved_at ? `解決於 ${new Date(l.resolved_at).toLocaleString('zh-TW')}` : ''}>
                        <CheckCircle size={11} style={{ marginRight: 3 }} />已解決
                      </span>
                    ) : (
                      <span className="badge badge-danger"><XCircle size={11} style={{ marginRight: 3 }} />未解決</span>
                    )}
                  </td>
                  {/* Recurrence count — warns if a previously-fixed error reappeared */}
                  <td onClick={() => setExpandedRow(expandedRow === l.id ? null : l.id)}>
                    {hasRecurrence ? (
                      <span className="badge" style={{ background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)' }}
                        title="此錯誤在修復後再次發生">
                        <RotateCcw size={10} style={{ marginRight: 3 }} />{l.recurrence_count}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td>
                    {l.resolved ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        title="標記為未解決"
                        onClick={(e) => { e.stopPropagation(); handleUnresolve(l.id) }}
                      >
                        <XCircle size={14} />
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm"
                        style={{ background: 'var(--accent-green-dim)', color: 'var(--accent-green)', border: 'none' }}
                        title="記錄修復並標記為已解決"
                        onClick={(e) => { e.stopPropagation(); openResolveModal(l) }}
                      >
                        <CheckCircle size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Expanded detail */}
        {expandedRow && (() => {
          const l = filtered.find(x => x.id === expandedRow)
          if (!l) return null
          return (
            <div style={{ padding: 16, background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', fontSize: 13 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                <div><strong>完整時間：</strong>{new Date(l.created_at).toLocaleString('zh-TW')}</div>
                <div><strong>使用者：</strong>{l.user || '-'}</div>
                <div><strong>Email：</strong>{l.user_email || '-'}</div>
                <div><strong>元件：</strong>{l.component || '-'}</div>
                <div><strong>URL：</strong><span style={{ fontSize: 11, wordBreak: 'break-all' }}>{l.url || '-'}</span></div>
                {l.resolved && (
                  <>
                    <div><strong>解決者：</strong>{l.resolved_by || '-'}</div>
                    <div><strong>解決時間：</strong>{l.resolved_at ? new Date(l.resolved_at).toLocaleString('zh-TW') : '-'}</div>
                  </>
                )}
                {/* Resolution details — shown whether resolved or not (history preserved on unresolve) */}
                {l.resolution_note && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <FileText size={13} style={{ color: 'var(--accent-green)' }} />解決說明：
                    </strong>
                    <p style={{ margin: '4px 0 0', padding: '8px 12px', background: 'var(--accent-green-dim)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.5 }}>
                      {l.resolution_note}
                    </p>
                  </div>
                )}
                {l.fix_reference && (
                  <div>
                    <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <GitCommit size={13} style={{ color: 'var(--accent-blue)' }} />修復參考：
                    </strong>
                    <code style={{ fontSize: 12, background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)', padding: '2px 8px', borderRadius: 4, marginTop: 4, display: 'inline-block' }}>
                      {l.fix_reference}
                    </code>
                  </div>
                )}
                {(l.recurrence_count || 0) > 0 && (
                  <div>
                    <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertCircle size={13} style={{ color: 'var(--accent-orange)' }} />復發次數：
                    </strong>
                    <span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>{l.recurrence_count} 次</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 6 }}>（修復後再次發生）</span>
                  </div>
                )}
                {l.stack_trace && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <strong>Stack Trace：</strong>
                    <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, fontSize: 11, marginTop: 4, overflow: 'auto', maxHeight: 200 }}>
                      {l.stack_trace}
                    </pre>
                  </div>
                )}
                {l.metadata && Object.keys(l.metadata).length > 0 && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <strong>Metadata：</strong>
                    <pre style={{ background: 'var(--bg-primary)', padding: 8, borderRadius: 6, fontSize: 11, marginTop: 4, overflow: 'auto' }}>
                      {JSON.stringify(l.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )
        })()}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>共 {total} 筆，第 {page + 1} / {totalPages} 頁</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /> 上一頁</button>
            <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>下一頁 <ChevronRight size={14} /></button>
          </div>
        </div>
      )}

      {/* ── Resolve Modal ─────────────────────────────────────────────────── */}
      {resolveModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setResolveModal(null) }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 520, padding: 24 }}>
            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={18} style={{ color: 'var(--accent-green)' }} />記錄修復並標記為已解決
                </h3>
                {resolveModal.errorCode && (
                  <code style={{ fontSize: 11, background: '#fee2e2', color: '#dc2626', padding: '2px 6px', borderRadius: 4, marginTop: 6, display: 'inline-block' }}>
                    {resolveModal.errorCode}
                  </code>
                )}
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {resolveModal.message}
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setResolveModal(null)}><X size={16} /></button>
            </div>

            {/* Resolution note (what was fixed) */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <FileText size={14} style={{ color: 'var(--accent-green)' }} />
                解決說明
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}>（記錄做了什麼修復）</span>
              </label>
              <textarea
                className="form-input"
                rows={3}
                placeholder="例如：修正了 XYZ 函數中的空值檢查，更新了錯誤處理邏輯..."
                value={resolveNote}
                onChange={e => setResolveNote(e.target.value)}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {/* Fix reference (optional commit/PR/ticket) */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <GitCommit size={14} style={{ color: 'var(--accent-blue)' }} />
                修復參考
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}>（選填：Commit SHA、PR 連結或工單編號）</span>
              </label>
              <input
                className="form-input"
                placeholder="例如：a3f9b12、https://github.com/…/pull/42、JIRA-123"
                value={resolveRef}
                onChange={e => setResolveRef(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setResolveModal(null)} disabled={resolving}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConfirmResolve}
                disabled={resolving}
                style={{ background: 'var(--accent-green)', borderColor: 'var(--accent-green)' }}
              >
                <CheckCircle size={14} />
                {resolving ? '儲存中...' : '確認已解決'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
