import { useState, useEffect, useCallback } from 'react'
import { Mail, MessageSquare, MessageCircle, Filter, ChevronDown, ChevronUp, Send, Search, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getChannels } from '../../lib/messaging'
import LoadingSpinner from '../../components/LoadingSpinner'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const PAGE_SIZE = 50

const CHANNEL_LABEL = {
  email: 'Email',
  sms: 'SMS 簡訊',
  line: 'LINE',
}

const CHANNEL_ICON = {
  email: <Mail size={13} />,
  sms: <MessageSquare size={13} />,
  line: <MessageCircle size={13} />,
}

const STATUS_CONFIG = {
  sent:      { label: '已發送', badge: 'badge-success' },
  simulated: { label: '模擬',   badge: 'badge-info' },
  failed:    { label: '失敗',   badge: 'badge-error' },
  queued:    { label: '排隊中', badge: 'badge-warning' },
}

const FILTER_TABS = [
  { key: '', label: '全部' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
  { key: 'line', label: 'LINE' },
]

const STATUS_TABS = [
  { key: '', label: '全部狀態' },
  { key: 'sent', label: '已發送' },
  { key: 'simulated', label: '模擬' },
  { key: 'failed', label: '失敗' },
  { key: 'queued', label: '排隊中' },
]

export default function MessageLog() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [channelFilter, setChannelFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expandedRow, setExpandedRow] = useState(null)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [selected, setSelected] = useState(new Set())

  const channels = getChannels()

  const loadLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let query = supabase.from('message_logs').select('*', { count: 'exact' }).order('sent_at', { ascending: false })
      if (channelFilter) query = query.eq('channel', channelFilter)
      if (statusFilter) query = query.eq('status', statusFilter)
      if (search) query = query.or(`recipient.ilike.%${search}%,subject.ilike.%${search}%`)
      query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      const { data, count, error: err } = await query
      if (err) throw err
      setLogs(data || [])
      setTotalCount(count || 0)
    } catch (err) {
      console.error('Failed to load message logs:', err)
      setError('發送紀錄載入失敗')
    } finally {
      setLoading(false)
    }
  }, [channelFilter, statusFilter, search, page])

  useEffect(() => { loadLogs() }, [loadLogs])

  // Reset page when filters change
  useEffect(() => { setPage(0) }, [channelFilter, statusFilter, search])

  const filterBtnStyle = (active) => ({
    padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  })

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === logs.length) setSelected(new Set())
    else setSelected(new Set(logs.map(l => l.id)))
  }

  const bulkResend = async () => {
    if (selected.size === 0) return
    const failedIds = [...selected].filter(async id => {
      const log = logs.find(l => l.id === id)
      return log && log.status === 'failed'
    })
    if (failedIds.length === 0) { toast.error('所選項目中沒有失敗的訊息'); return }
    if (!(await confirm({ message: `確定要重新發送 ${failedIds.length} 筆失敗訊息？` }))) return
    // Mark as queued for resend
    const { error: err } = await supabase.from('message_logs').update({ status: 'queued' }).in('id', failedIds)
    if (err) { toast.error('操作失敗'); return }
    setSelected(new Set())
    loadLogs()
  }

  const bulkDelete = async () => {
    if (selected.size === 0) return
    if (!(await confirm({ message: `確定要刪除 ${selected.size} 筆紀錄？` }))) return
    const { error: err } = await supabase.from('message_logs').delete().in('id', [...selected])
    if (err) { toast.error('刪除失敗'); return }
    setSelected(new Set())
    loadLogs()
  }

  // Stats (from current filtered page)
  const sentCount = logs.filter(l => l.status === 'sent').length
  const simulatedCount = logs.filter(l => l.status === 'simulated').length
  const failedCount = logs.filter(l => l.status === 'failed').length
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  if (error && !logs.length) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={loadLogs} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><Send size={20} /></span> 發送紀錄 Message Log</h2>
            <p>查看所有通道的訊息發送紀錄</p>
          </div>
          <button className="btn btn-secondary" onClick={loadLogs} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={14} /> 重新整理
          </button>
        </div>
      </div>

      {/* Channel config status */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {channels.map(ch => (
          <div key={ch.key} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px', borderRadius: 10,
            background: 'var(--glass-light)', border: '1px solid var(--border-subtle)',
            fontSize: 12
          }}>
            {CHANNEL_ICON[ch.key]} {ch.name}
            <span className={`badge ${ch.configured ? 'badge-success' : 'badge-info'}`} style={{ fontSize: 9 }}>
              <span className="badge-dot"></span>{ch.configured ? '已設定' : '模擬模式'}
            </span>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總紀錄數</div><div className="stat-card-value">{totalCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已發送</div><div className="stat-card-value">{sentCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">模擬</div><div className="stat-card-value">{simulatedCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">失敗</div><div className="stat-card-value">{failedCount}</div>
        </div>
      </div>

      {/* Filters Row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={14} style={{ color: 'var(--text-muted)' }} />
        {FILTER_TABS.map(tab => (
          <button key={tab.key} style={filterBtnStyle(channelFilter === tab.key)} onClick={() => setChannelFilter(tab.key)}>
            {tab.key && CHANNEL_ICON[tab.key]} {tab.label}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: 'var(--border-medium)', margin: '0 4px' }} />
        {STATUS_TABS.map(tab => (
          <button key={tab.key} style={filterBtnStyle(statusFilter === tab.key)} onClick={() => setStatusFilter(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            placeholder="搜尋收件人或主旨..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 30, width: '100%' }}
          />
        </div>
        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>已選 {selected.size} 筆</span>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={bulkResend}>
              重新發送失敗
            </button>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--accent-red)' }} onClick={bulkDelete}>
              刪除
            </button>
          </div>
        )}
      </div>

      {loading && <LoadingSpinner />}

      {/* Message Log Table */}
      {!loading && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Send size={16} /></span> 發送紀錄</div>
            <span className="badge badge-neutral">{totalCount} 筆</span>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" checked={logs.length > 0 && selected.size === logs.length} onChange={toggleSelectAll} />
                  </th>
                  <th>時間</th>
                  <th>通道</th>
                  <th>收件人</th>
                  <th>主旨</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                      尚無發送紀錄
                    </td>
                  </tr>
                )}
                {logs.map(log => {
                  const st = STATUS_CONFIG[log.status] || STATUS_CONFIG.queued
                  const isExpanded = expandedRow === log.id
                  return (
                    <>
                      <tr key={log.id} style={{ cursor: 'pointer' }} onClick={() => setExpandedRow(isExpanded ? null : log.id)}>
                        <td onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(log.id)} onChange={() => toggleSelect(log.id)} />
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {log.sent_at ? new Date(log.sent_at).toLocaleString('zh-TW') : '-'}
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                            {CHANNEL_ICON[log.channel]} {CHANNEL_LABEL[log.channel] || log.channel}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.recipient || '-'}
                        </td>
                        <td style={{ fontSize: 12, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.subject || '-'}
                        </td>
                        <td>
                          <span className={`badge ${st.badge}`} style={{ fontSize: 10 }}>
                            <span className="badge-dot"></span>{st.label}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn"
                            style={{ fontSize: 10, padding: '2px 8px', background: 'var(--glass-light)', color: 'var(--text-muted)', border: '1px solid var(--border-medium)' }}
                            onClick={(e) => { e.stopPropagation(); setExpandedRow(isExpanded ? null : log.id) }}
                          >
                            {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />} 詳情
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${log.id}-detail`}>
                          <td colSpan={7} style={{ padding: 0, background: 'var(--bg-subtle, var(--glass-light))' }}>
                            <div style={{ padding: '16px 20px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                                <div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>通道</div>
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>{CHANNEL_LABEL[log.channel] || log.channel}</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>收件人</div>
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>{log.recipient}</div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>主旨</div>
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>{log.subject || '-'}</div>
                                </div>
                                {log.campaign_id && (
                                  <div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>活動 ID</div>
                                    <div style={{ fontSize: 13, fontWeight: 600 }}>{log.campaign_id}</div>
                                  </div>
                                )}
                              </div>
                              <div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>訊息內容</div>
                                <div style={{
                                  padding: '12px 16px', borderRadius: 10,
                                  background: 'var(--glass-light)', border: '1px solid var(--border-subtle)',
                                  fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                  maxHeight: 200, overflow: 'auto'
                                }}>
                                  {log.body || '(無內容)'}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border-subtle)' }}>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: '4px 12px' }}
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
              >
                上一頁
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                第 {page + 1} / {totalPages} 頁
              </span>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: '4px 12px' }}
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
              >
                下一頁
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
