import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Shield, Search, RefreshCw, Download, Filter, Activity,
  ChevronLeft, ChevronRight, X, Clock, Eye, MousePointer,
  LogIn, LogOut, FileDown, Plus, Edit, Trash2, Monitor, Smartphone, Tablet, User
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getUserActivity, getTenants } from '../../lib/db'

const MODULES = ['Auth', 'HR', 'Finance', 'CRM', 'Sales', 'POS', 'WMS', 'Purchase', 'Manufacturing', 'Analytics', 'Process', 'Integration', 'AI', 'System']
const ACTIONS = ['page_view', 'click', 'create', 'update', 'delete', 'search', 'export', 'login', 'logout']

const actionMeta = {
  page_view: { label: '瀏覽頁面', icon: Eye, color: '#6366f1' },
  click:     { label: '點擊操作', icon: MousePointer, color: '#3b82f6' },
  create:    { label: '新增', icon: Plus, color: '#16a34a' },
  update:    { label: '更新', icon: Edit, color: '#f59e0b' },
  delete:    { label: '刪除', icon: Trash2, color: '#dc2626' },
  search:    { label: '搜尋', icon: Search, color: '#8b5cf6' },
  export:    { label: '匯出', icon: FileDown, color: '#06b6d4' },
  login:     { label: '登入', icon: LogIn, color: '#22c55e' },
  logout:    { label: '登出', icon: LogOut, color: '#ef4444' },
}

const deviceIcon = { desktop: Monitor, mobile: Smartphone, tablet: Tablet }

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

export default function UserActivity() {
  const { isSuperAdmin } = useAuth()
  const [logs, setLogs] = useState([])
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({ tenantId: '', userName: '', action: '', module: '', from: '', to: '' })
  const [viewMode, setViewMode] = useState('table') // table | timeline

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE }
    if (filters.tenantId) params.tenantId = Number(filters.tenantId)
    if (filters.userName) params.userName = filters.userName
    if (filters.action) params.action = filters.action
    if (filters.module) params.module = filters.module
    if (filters.from) params.from = new Date(filters.from).toISOString()
    if (filters.to) params.to = new Date(filters.to + 'T23:59:59').toISOString()
    const { data, error, count } = await getUserActivity(params)
    if (!error && data) { setLogs(data); setTotal(count || 0) }
    setLoading(false)
  }, [page, filters])

  useEffect(() => {
    getTenants().then(({ data }) => { if (data) setTenants(data) })
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = logs.filter(l => {
    if (!search) return true
    const s = search.toLowerCase()
    return (l.user_name || '').toLowerCase().includes(s) ||
      (l.detail || '').toLowerCase().includes(s) ||
      (l.page || '').toLowerCase().includes(s) ||
      (l.target || '').toLowerCase().includes(s)
  })

  const resetFilters = () => {
    setFilters({ tenantId: '', userName: '', action: '', module: '', from: '', to: '' })
    setPage(0)
  }

  // Unique users for filter dropdown
  const uniqueUsers = useMemo(() => [...new Set(logs.map(l => l.user_name).filter(Boolean))], [logs])

  // Stats
  const stats = useMemo(() => {
    const uniqueUsersToday = new Set()
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    logs.forEach(l => {
      if (l.created_at && l.created_at.startsWith(todayStr)) uniqueUsersToday.add(l.user_name)
    })
    return {
      total,
      activeUsers: uniqueUsersToday.size,
      pageViews: logs.filter(l => l.action === 'page_view').length,
      actions: logs.filter(l => !['page_view', 'login', 'logout'].includes(l.action)).length,
    }
  }, [logs, total])

  // Module usage breakdown
  const moduleUsage = useMemo(() => {
    const counts = {}
    logs.forEach(l => {
      if (l.module) counts[l.module] = (counts[l.module] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [logs])

  // Group by date for timeline view
  const groupedByDate = useMemo(() => {
    const groups = {}
    filtered.forEach(l => {
      const date = new Date(l.created_at).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
      if (!groups[date]) groups[date] = []
      groups[date].push(l)
    })
    return groups
  }, [filtered])

  const exportCSV = () => {
    const header = '時間,使用者,動作,模組,頁面,目標,詳情,裝置,組織'
    const rows = filtered.map(l =>
      `"${new Date(l.created_at).toLocaleString('zh-TW')}","${l.user_name || ''}","${l.action}","${l.module || ''}","${l.page || ''}","${l.target || ''}","${(l.detail || '').replace(/"/g, '""')}","${l.device || ''}","${l.tenants?.name || ''}"`
    )
    const blob = new Blob(['\ufeff' + header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `user-activity-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const activeFilterCount = Object.values(filters).filter(Boolean).length

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
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title"><Activity size={22} style={{ marginRight: 8, color: '#6366f1' }} />使用者活動</h1>
          <p className="page-subtitle">跨組織使用者行為追蹤與分析</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <button className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: 0 }} onClick={() => setViewMode('table')}>表格</button>
            <button className={`btn btn-sm ${viewMode === 'timeline' ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: 0 }} onClick={() => setViewMode('timeline')}>時間軸</button>
          </div>
          <button className="btn btn-ghost" onClick={exportCSV}><Download size={15} /> 匯出</button>
          <button className="btn btn-ghost" onClick={fetchData}><RefreshCw size={15} /> 重新整理</button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-value">{stats.total}</div><div className="stat-label">總活動數</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: '#6366f1' }}>{stats.activeUsers}</div><div className="stat-label">今日活躍用戶</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: '#3b82f6' }}>{stats.pageViews}</div><div className="stat-label">頁面瀏覽</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: '#f59e0b' }}>{stats.actions}</div><div className="stat-label">操作次數</div></div>
      </div>

      {/* Module Usage Bar */}
      {moduleUsage.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>模組使用分布（本頁）</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {moduleUsage.map(([mod, count]) => {
              const maxCount = moduleUsage[0][1]
              const pct = Math.round((count / maxCount) * 100)
              return (
                <div key={mod} style={{ flex: '1 1 120px', minWidth: 100 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span>{mod}</span><span style={{ color: 'var(--text-secondary)' }}>{count}</span>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#6366f1', borderRadius: 4, transition: 'width 0.3s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input className="input" placeholder="搜尋使用者、頁面、目標..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 32, width: '100%' }} />
        </div>
        <button className={`btn ${showFilters ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowFilters(!showFilters)}>
          <Filter size={14} /> 篩選{activeFilterCount > 0 && ` (${activeFilterCount})`}
        </button>
        {activeFilterCount > 0 && (
          <button className="btn btn-ghost" onClick={resetFilters}><X size={14} /> 清除篩選</button>
        )}
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="card" style={{ padding: 16, marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label className="label">組織</label>
            <select className="input" value={filters.tenantId} onChange={e => { setFilters(f => ({ ...f, tenantId: e.target.value })); setPage(0) }}>
              <option value="">全部組織</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">使用者</label>
            <select className="input" value={filters.userName} onChange={e => { setFilters(f => ({ ...f, userName: e.target.value })); setPage(0) }}>
              <option value="">全部</option>
              {uniqueUsers.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="label">動作</label>
            <select className="input" value={filters.action} onChange={e => { setFilters(f => ({ ...f, action: e.target.value })); setPage(0) }}>
              <option value="">全部</option>
              {ACTIONS.map(a => <option key={a} value={a}>{actionMeta[a]?.label || a}</option>)}
            </select>
          </div>
          <div>
            <label className="label">模組</label>
            <select className="input" value={filters.module} onChange={e => { setFilters(f => ({ ...f, module: e.target.value })); setPage(0) }}>
              <option value="">全部</option>
              {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label">開始日期</label>
            <input className="input" type="date" value={filters.from} onChange={e => { setFilters(f => ({ ...f, from: e.target.value })); setPage(0) }} />
          </div>
          <div>
            <label className="label">結束日期</label>
            <input className="input" type="date" value={filters.to} onChange={e => { setFilters(f => ({ ...f, to: e.target.value })); setPage(0) }} />
          </div>
        </div>
      )}

      {/* Content */}
      {viewMode === 'table' ? (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>時間</th>
                <th style={{ width: 100 }}>使用者</th>
                <th style={{ width: 100 }}>動作</th>
                <th style={{ width: 80 }}>模組</th>
                <th>詳情</th>
                <th style={{ width: 60 }}>裝置</th>
                <th style={{ width: 120 }}>組織</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}>載入中...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>尚無活動記錄</td></tr>
              ) : filtered.map(l => {
                const meta = actionMeta[l.action] || { label: l.action, icon: Activity, color: '#6b7280' }
                const AIcon = meta.icon
                const DIcon = deviceIcon[l.device] || Monitor
                return (
                  <tr key={l.id}>
                    <td><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={12} style={{ color: 'var(--text-secondary)' }} />{timeAgo(l.created_at)}</span></td>
                    <td><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><User size={12} style={{ color: 'var(--text-secondary)' }} />{l.user_name}</span></td>
                    <td>
                      <span className="badge" style={{ background: meta.color + '18', color: meta.color }}>
                        <AIcon size={11} style={{ marginRight: 3 }} />{meta.label}
                      </span>
                    </td>
                    <td>{l.module || '-'}</td>
                    <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.detail || l.target || l.page || '-'}
                    </td>
                    <td style={{ textAlign: 'center' }}><DIcon size={14} style={{ color: 'var(--text-secondary)' }} /></td>
                    <td>
                      {l.tenants?.name ? <span className="badge badge-neutral">{l.tenants.name}</span> : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* Timeline View */
        <div className="card" style={{ padding: 20 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>載入中...</div>
          ) : Object.keys(groupedByDate).length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>尚無活動記錄</div>
          ) : Object.entries(groupedByDate).map(([date, items]) => (
            <div key={date} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1' }} />
                {date}
                <span style={{ fontSize: 11, fontWeight: 400 }}>({items.length} 筆)</span>
              </div>
              <div style={{ borderLeft: '2px solid var(--border)', marginLeft: 3, paddingLeft: 20 }}>
                {items.map(l => {
                  const meta = actionMeta[l.action] || { label: l.action, icon: Activity, color: '#6b7280' }
                  const AIcon = meta.icon
                  return (
                    <div key={l.id} style={{ marginBottom: 12, display: 'flex', alignItems: 'flex-start', gap: 10, position: 'relative' }}>
                      <div style={{
                        position: 'absolute', left: -26, top: 4,
                        width: 12, height: 12, borderRadius: '50%',
                        background: meta.color + '30', border: `2px solid ${meta.color}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 500 }}>{l.user_name}</span>
                          <span className="badge" style={{ background: meta.color + '18', color: meta.color, fontSize: 11 }}>
                            <AIcon size={10} style={{ marginRight: 2 }} />{meta.label}
                          </span>
                          {l.module && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{l.module}</span>}
                          {l.tenants?.name && <span className="badge badge-neutral" style={{ fontSize: 10 }}>{l.tenants.name}</span>}
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                            {new Date(l.created_at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                        {(l.detail || l.target) && (
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                            {l.detail || l.target}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>共 {total} 筆，第 {page + 1} / {totalPages} 頁</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /> 上一頁</button>
            <button className="btn btn-ghost btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>下一頁 <ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  )
}
