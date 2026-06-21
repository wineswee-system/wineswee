import { useState, useEffect, useCallback } from 'react'
import {
  Smartphone, Shield, AlertTriangle, XCircle, CheckCircle, RotateCcw,
  FileText, GitCommit, Clock, RefreshCw, Search, X,
  ChevronLeft, ChevronRight, ShoppingCart, Star, ClipboardList,
  Filter, Download,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getErrorLogs, resolveErrorLog, unresolveErrorLog } from '../../lib/db'
import { supabase } from '../../lib/supabase'

const PAGE_SIZE = 50

function timeAgo(ts) {
  if (!ts) return '-'
  const diff = (Date.now() - new Date(ts)) / 1000
  if (diff < 60) return '剛剛'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`
  return new Date(ts).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtDate(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function todayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString()
}

// ── Error tab ────────────────────────────────────────────────────────────────

function ErrorsTab({ profile }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ resolved: '', from: '', to: '' })
  const [showFilters, setShowFilters] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [resolveModal, setResolveModal] = useState(null)
  const [resolveNote, setResolveNote] = useState('')
  const [resolveRef, setResolveRef] = useState('')
  const [resolving, setResolving] = useState(false)

  const fetchErrors = useCallback(async () => {
    setLoading(true)
    const params = { module: 'MemberApp', limit: PAGE_SIZE, offset: page * PAGE_SIZE }
    if (filters.resolved !== '') params.resolved = filters.resolved === 'true'
    if (filters.from) params.from = new Date(filters.from).toISOString()
    if (filters.to) params.to = new Date(filters.to + 'T23:59:59').toISOString()
    const { data, count } = await getErrorLogs(params)
    if (data) { setLogs(data); setTotal(count || 0) }
    setLoading(false)
  }, [page, filters])

  useEffect(() => { fetchErrors() }, [fetchErrors])

  const handleResolve = async () => {
    if (!resolveModal) return
    setResolving(true)
    const resolvedBy = profile?.name || 'super_admin'
    const id = resolveModal.id
    await resolveErrorLog(id, resolvedBy, resolveNote.trim() || null, resolveRef.trim() || null)
    setLogs(prev => prev.map(l => l.id !== id ? l : {
      ...l, resolved: true, resolved_by: resolvedBy, resolved_at: new Date().toISOString(),
      resolution_note: resolveNote.trim() || null, fix_reference: resolveRef.trim() || null,
    }))
    setResolving(false); setResolveModal(null)
  }

  const handleUnresolve = async (id) => {
    await unresolveErrorLog(id)
    setLogs(prev => prev.map(l => l.id !== id ? l : { ...l, resolved: false, resolved_by: null, resolved_at: null }))
  }

  const exportCSV = () => {
    const header = '時間,錯誤碼,訊息,元件,平台,使用者,已解決,復發次數'
    const rows = filtered.map(l => [
      `"${fmtDate(l.created_at)}"`,
      `"${l.error_code || ''}"`,
      `"${(l.message || '').replace(/"/g, '""')}"`,
      `"${l.component || ''}"`,
      `"${l.metadata?.platform || ''}"`,
      `"${l.user || ''}"`,
      `"${l.resolved ? '是' : '否'}"`,
      `"${l.recurrence_count || 0}"`,
    ].join(','))
    const blob = new Blob(['﻿' + header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `memberapp-errors-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  }

  const filtered = logs.filter(l => {
    if (!search) return true
    const s = search.toLowerCase()
    return (l.message || '').toLowerCase().includes(s) ||
      (l.error_code || '').toLowerCase().includes(s) ||
      (l.component || '').toLowerCase().includes(s)
  })

  const unresolved = logs.filter(l => !l.resolved).length
  const todayCount = logs.filter(l => l.created_at >= todayStart()).length
  const platforms = logs.reduce((acc, l) => {
    const p = l.metadata?.platform || 'unknown'
    acc[p] = (acc[p] || 0) + 1; return acc
  }, {})
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const activeFilterCount = Object.values(filters).filter(Boolean).length

  return (
    <>
      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-card-value">{total}</div><div className="stat-card-label">總錯誤數</div></div>
        <div className="stat-card"><div className="stat-card-value" style={{ color: 'var(--accent-red)' }}>{unresolved}</div><div className="stat-card-label">未解決</div></div>
        <div className="stat-card"><div className="stat-card-value" style={{ color: 'var(--accent-orange)' }}>{todayCount}</div><div className="stat-card-label">今日新增</div></div>
        <div className="stat-card">
          <div className="stat-card-value" style={{ fontSize: 13, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(platforms).map(([p, n]) => (
              <span key={p} className="badge badge-neutral" style={{ fontSize: 12 }}>{p} {n}</span>
            ))}
            {Object.keys(platforms).length === 0 && <span style={{ color: 'var(--text-muted)' }}>—</span>}
          </div>
          <div className="stat-card-label">平台分布</div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input className="form-input" placeholder="搜尋錯誤碼、訊息、元件..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, width: '100%' }} />
        </div>
        <button className={`btn ${showFilters ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowFilters(v => !v)}>
          <Filter size={14} /> 篩選{activeFilterCount > 0 && ` (${activeFilterCount})`}
        </button>
        {activeFilterCount > 0 && (
          <button className="btn btn-secondary" onClick={() => { setFilters({ resolved: '', from: '', to: '' }); setPage(0) }}>
            <X size={14} /> 清除
          </button>
        )}
        <button className="btn btn-secondary" onClick={exportCSV}><Download size={14} /> 匯出</button>
        <button className="btn btn-secondary" onClick={fetchErrors}><RefreshCw size={14} /></button>
      </div>

      {showFilters && (
        <div className="card" style={{ padding: 14, marginBottom: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>解決狀態</label>
            <select className="form-input" value={filters.resolved} onChange={e => { setFilters(f => ({ ...f, resolved: e.target.value })); setPage(0) }}>
              <option value="">全部</option>
              <option value="false">未解決</option>
              <option value="true">已解決</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>開始日期</label>
            <input className="form-input" type="date" value={filters.from} onChange={e => { setFilters(f => ({ ...f, from: e.target.value })); setPage(0) }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>結束日期</label>
            <input className="form-input" type="date" value={filters.to} onChange={e => { setFilters(f => ({ ...f, to: e.target.value })); setPage(0) }} />
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ overflow: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 110 }}>時間</th>
              <th style={{ width: 150 }}>錯誤碼</th>
              <th>訊息</th>
              <th style={{ width: 110 }}>元件</th>
              <th style={{ width: 80 }}>平台</th>
              <th style={{ width: 80 }}>狀態</th>
              <th style={{ width: 60 }}>復發</th>
              <th style={{ width: 70 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40 }}>載入中...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>尚無錯誤日誌</td></tr>
            ) : filtered.map(l => (
              <>
                <tr key={l.id} style={{ cursor: 'pointer', background: l.resolved ? undefined : 'rgba(220,38,38,0.03)' }}
                  onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                  <td style={{ fontSize: 12 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11} style={{ color: 'var(--text-secondary)' }} />{timeAgo(l.created_at)}</span></td>
                  <td>
                    {l.error_code
                      ? <code style={{ fontSize: 11, background: '#fee2e2', color: '#dc2626', padding: '2px 6px', borderRadius: 4 }}>{l.error_code}</code>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{l.message}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l.component || '—'}</td>
                  <td>
                    {l.metadata?.platform
                      ? <span className="badge badge-neutral" style={{ fontSize: 11 }}>{l.metadata.platform}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td>
                    {l.resolved
                      ? <span className="badge badge-success"><CheckCircle size={10} style={{ marginRight: 3 }} />已解決</span>
                      : <span className="badge badge-danger"><XCircle size={10} style={{ marginRight: 3 }} />未解決</span>}
                  </td>
                  <td>
                    {(l.recurrence_count || 0) > 0
                      ? <span className="badge" style={{ background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)' }}><RotateCcw size={10} style={{ marginRight: 3 }} />{l.recurrence_count}</span>
                      : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    {l.resolved
                      ? <button className="btn btn-secondary btn-sm" title="標記為未解決" onClick={() => handleUnresolve(l.id)}><XCircle size={13} /></button>
                      : <button className="btn btn-sm" title="記錄修復並標記為已解決"
                          style={{ background: 'var(--accent-green-dim)', color: 'var(--accent-green)', border: 'none' }}
                          onClick={() => { setResolveModal(l); setResolveNote(''); setResolveRef('') }}>
                          <CheckCircle size={13} />
                        </button>}
                  </td>
                </tr>
                {expanded === l.id && (
                  <tr key={`${l.id}-exp`}>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <div style={{ padding: 16, background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', fontSize: 12 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 10 }}>
                          <div><strong>完整時間：</strong>{fmtDate(l.created_at)}</div>
                          <div><strong>使用者 UID：</strong><code style={{ fontSize: 11 }}>{l.user || '—'}</code></div>
                          {l.resolved && <><div><strong>解決者：</strong>{l.resolved_by}</div><div><strong>解決時間：</strong>{fmtDate(l.resolved_at)}</div></>}
                          {l.resolution_note && <div style={{ gridColumn: '1/-1' }}><strong>解決說明：</strong> {l.resolution_note}</div>}
                          {l.fix_reference && <div><strong>修復參考：</strong><code style={{ fontSize: 11 }}>{l.fix_reference}</code></div>}
                        </div>
                        {l.stack_trace && (
                          <div style={{ marginBottom: 10 }}>
                            <strong>Stack Trace：</strong>
                            <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 10, borderRadius: 6, fontSize: 10, marginTop: 4, overflow: 'auto', maxHeight: 180 }}>
                              {l.stack_trace}
                            </pre>
                          </div>
                        )}
                        {l.metadata && (
                          <div>
                            <strong>Metadata：</strong>
                            <pre style={{ background: 'var(--bg-primary)', padding: 8, borderRadius: 6, fontSize: 11, marginTop: 4, overflow: 'auto' }}>
                              {JSON.stringify(l.metadata, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>共 {total} 筆，第 {page + 1} / {totalPages} 頁</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></button>
            <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></button>
          </div>
        </div>
      )}

      {/* Resolve modal */}
      {resolveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setResolveModal(null) }}>
          <div className="card" style={{ width: '100%', maxWidth: 500, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={16} style={{ color: 'var(--accent-green)' }} />記錄修復並標記為已解決
                </h3>
                {resolveModal.error_code && <code style={{ fontSize: 11, background: '#fee2e2', color: '#dc2626', padding: '2px 6px', borderRadius: 4, marginTop: 6, display: 'inline-block' }}>{resolveModal.error_code}</code>}
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resolveModal.message}</p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setResolveModal(null)}><X size={14} /></button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <FileText size={13} style={{ color: 'var(--accent-green)' }} />解決說明
              </label>
              <textarea className="form-input" rows={3} placeholder="記錄做了什麼修復..." value={resolveNote}
                onChange={e => setResolveNote(e.target.value)} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <GitCommit size={13} style={{ color: 'var(--accent-blue)' }} />修復參考
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}>（選填：Commit / PR / 工單）</span>
              </label>
              <input className="form-input" placeholder="例如：a3f9b12" value={resolveRef}
                onChange={e => setResolveRef(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setResolveModal(null)} disabled={resolving}>取消</button>
              <button className="btn btn-primary" onClick={handleResolve} disabled={resolving}
                style={{ background: 'var(--accent-green)', borderColor: 'var(--accent-green)' }}>
                <CheckCircle size={13} />{resolving ? '儲存中...' : '確認已解決'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Activity tab ──────────────────────────────────────────────────────────────

const ACTIVITY_DAYS = 7

function ActivityTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ purchases: 0, points: 0, surveys: 0 })

  const fetchActivity = useCallback(async () => {
    setLoading(true)
    const since = new Date(Date.now() - ACTIVITY_DAYS * 86400 * 1000).toISOString()
    const today = todayStart()

    const [{ data: purchases }, { data: pointTxs }, { data: surveys }] = await Promise.all([
      supabase.from('member_purchases')
        .select('id, total_amount, purchased_at, points_earned, members(name)')
        .gte('purchased_at', since)
        .order('purchased_at', { ascending: false })
        .limit(100),
      supabase.from('point_transactions')
        .select('id, type, points, description, created_at, members(name)')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('survey_invitations')
        .select('id, responded_at, members(name)')
        .eq('status', 'responded')
        .gte('responded_at', since)
        .order('responded_at', { ascending: false })
        .limit(100),
    ])

    setStats({
      purchases: (purchases || []).filter(p => p.purchased_at >= today).length,
      points: (pointTxs || []).filter(p => p.created_at >= today).length,
      surveys: (surveys || []).filter(s => s.responded_at >= today).length,
    })

    const merged = [
      ...(purchases || []).map(p => ({
        id: `p-${p.id}`, ts: p.purchased_at,
        member: p.members?.name || '—',
        label: `消費 $${Number(p.total_amount || 0).toFixed(0)}`,
        sub: p.points_earned > 0 ? `+${p.points_earned} 點` : null,
        icon: ShoppingCart, color: 'var(--accent-cyan)',
      })),
      ...(pointTxs || []).map(p => ({
        id: `pt-${p.id}`, ts: p.created_at,
        member: p.members?.name || '—',
        label: `${_pointLabel(p.type)} ${p.points} 點`,
        sub: p.description || null,
        icon: Star,
        color: (p.type === 'earn' || p.type === 'refund') ? 'var(--accent-green)' : 'var(--accent-red)',
      })),
      ...(surveys || []).map(s => ({
        id: `sv-${s.id}`, ts: s.responded_at,
        member: s.members?.name || '—',
        label: '完成問卷回覆',
        sub: null,
        icon: ClipboardList, color: 'var(--accent-purple)',
      })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts))

    setItems(merged)
    setLoading(false)
  }, [])

  useEffect(() => { fetchActivity() }, [fetchActivity])

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-value">{stats.purchases}</div>
          <div className="stat-card-label">今日購買</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-value">{stats.points}</div>
          <div className="stat-card-label">今日點數交易</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-value">{stats.surveys}</div>
          <div className="stat-card-label">今日問卷完成</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>最近 {ACTIVITY_DAYS} 天的會員動態，共 {items.length} 筆</span>
        <button className="btn btn-secondary btn-sm" onClick={fetchActivity}><RefreshCw size={13} /></button>
      </div>

      <div className="card" style={{ overflow: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>載入中...</div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>最近 {ACTIVITY_DAYS} 天無活動</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>時間</th>
                <th style={{ width: 120 }}>會員</th>
                <th>動作</th>
                <th style={{ width: 140 }}>備註</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const Icon = item.icon
                return (
                  <tr key={item.id}>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={11} />{timeAgo(item.ts)}
                      </span>
                    </td>
                    <td style={{ fontSize: 13, fontWeight: 500 }}>{item.member}</td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                          background: `color-mix(in srgb, ${item.color} 15%, transparent)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon size={13} style={{ color: item.color }} />
                        </span>
                        <span style={{ fontSize: 13 }}>{item.label}</span>
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.sub || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function _pointLabel(type) {
  switch (type) {
    case 'earn': return '獲得'
    case 'redeem': return '兌換'
    case 'refund': return '退還'
    case 'expire': return '到期'
    default: return type
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MemberAppMonitor() {
  const { isSuperAdmin, profile } = useAuth()
  const [tab, setTab] = useState('errors')

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
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Smartphone size={22} style={{ color: 'var(--accent-cyan)' }} />
          <div>
            <h2 style={{ margin: 0 }}>會員 App 監控</h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>MemberApp 錯誤日誌 + 會員活動追蹤</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {[
          { key: 'errors', label: '錯誤日誌', icon: AlertTriangle },
          { key: 'activity', label: '會員活動', icon: Star },
        ].map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '8px 20px', border: 'none', cursor: 'pointer', fontSize: 14,
            background: 'transparent',
            borderBottom: tab === key ? '2px solid var(--accent-cyan)' : '2px solid transparent',
            color: tab === key ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', gap: 6,
            fontWeight: tab === key ? 600 : 400, marginBottom: -1,
          }}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {tab === 'errors' && <ErrorsTab profile={profile} />}
      {tab === 'activity' && <ActivityTab />}
    </div>
  )
}
