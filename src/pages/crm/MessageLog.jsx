import { useState, useEffect } from 'react'
import { Mail, MessageSquare, MessageCircle, Filter, ChevronDown, ChevronUp, Send } from 'lucide-react'
import { getMessageHistory, getChannels } from '../../lib/messaging'
import LoadingSpinner from '../../components/LoadingSpinner'

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

export default function MessageLog() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [channelFilter, setChannelFilter] = useState('')
  const [expandedRow, setExpandedRow] = useState(null)

  const channels = getChannels()

  useEffect(() => {
    loadLogs()
  }, [channelFilter])

  const loadLogs = async () => {
    setLoading(true)
    setError(null)
    try {
      const filters = {}
      if (channelFilter) filters.channel = channelFilter
      const data = await getMessageHistory(filters)
      setLogs(data)
    } catch (err) {
      console.error('Failed to load message logs:', err)
      setError('發送紀錄載入失敗')
    } finally {
      setLoading(false)
    }
  }

  const filterBtnStyle = (active) => ({
    padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-medium)',
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  })

  // Stats
  const totalCount = logs.length
  const sentCount = logs.filter(l => l.status === 'sent').length
  const simulatedCount = logs.filter(l => l.status === 'simulated').length
  const failedCount = logs.filter(l => l.status === 'failed').length

  if (loading) return <LoadingSpinner />
  if (error) return (
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
          <button className="btn btn-secondary" onClick={loadLogs}>
            重新整理
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

      {/* Channel Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Filter size={14} style={{ alignSelf: 'center', color: 'var(--text-muted)' }} />
        {FILTER_TABS.map(tab => (
          <button key={tab.key} style={filterBtnStyle(channelFilter === tab.key)} onClick={() => setChannelFilter(tab.key)}>
            {tab.key && CHANNEL_ICON[tab.key]} {tab.label}
          </button>
        ))}
      </div>

      {/* Message Log Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Send size={16} /></span> 發送紀錄</div>
          <span className="badge badge-neutral">{logs.length} 筆</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
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
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                    尚無發送紀錄
                  </td>
                </tr>
              )}
              {logs.map(log => {
                const st = STATUS_CONFIG[log.status] || STATUS_CONFIG.queued
                const isExpanded = expandedRow === log.id
                return (
                  <tr key={log.id} style={{ cursor: 'pointer' }} onClick={() => setExpandedRow(isExpanded ? null : log.id)}>
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
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Expanded Detail */}
      {expandedRow && (() => {
        const log = logs.find(l => l.id === expandedRow)
        if (!log) return null
        return (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon"><Mail size={16} /></span> 訊息內容</div>
              <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setExpandedRow(null)}>
                收合
              </button>
            </div>
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
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>狀態</div>
                  <div>
                    <span className={`badge ${(STATUS_CONFIG[log.status] || STATUS_CONFIG.queued).badge}`} style={{ fontSize: 10 }}>
                      <span className="badge-dot"></span>{(STATUS_CONFIG[log.status] || STATUS_CONFIG.queued).label}
                    </span>
                  </div>
                </div>
                {log.campaign_id && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>活動 ID</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{log.campaign_id}</div>
                  </div>
                )}
                {log.customer_id && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>客戶 ID</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{log.customer_id}</div>
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>訊息內容</div>
                <div style={{
                  padding: '12px 16px', borderRadius: 10,
                  background: 'var(--glass-light)', border: '1px solid var(--border-subtle)',
                  fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  maxHeight: 300, overflow: 'auto'
                }}>
                  {log.body || '(無內容)'}
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
