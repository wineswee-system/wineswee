import React from 'react'
import {
  Send, BarChart3, Zap, CheckCircle, Clock, AlertCircle, List
} from 'lucide-react'
import { isChannelConfigured } from '../../../lib/messaging'

const TYPE_MAP = { 'Email': 'email', 'LINE 訊息': 'line', 'SMS 簡訊': 'sms' }

const STATUS_BADGE = {
  '草稿': 'badge-neutral',
  '排程中': 'badge-warning',
  '發送中': 'badge-info',
  '已完成': 'badge-success',
  '已取消': 'badge-neutral',
}

const STATUS_ICON = {
  '草稿': <AlertCircle size={12} />,
  '排程中': <Clock size={12} />,
  '發送中': <Send size={12} />,
  '已完成': <CheckCircle size={12} />,
  '已取消': <AlertCircle size={12} />,
}

const AUTO_RULES = [
  { icon: '🎂', title: '生日關懷', desc: '客戶生日當天自動發送祝福與優惠券', trigger: '生日當天', channel: 'LINE/SMS', status: '啟用' },
  { icon: '😴', title: '喚醒沉睡客戶', desc: '半年未下單客戶自動發送促銷簡訊', trigger: '180天未購', channel: 'SMS', status: '啟用' },
  { icon: '🎉', title: '節日問候', desc: '農曆新年、中秋節自動發送祝福', trigger: '節日前3天', channel: 'LINE', status: '啟用' },
  { icon: '📧', title: 'EDM 未開信追蹤', desc: '3天內未開信的客戶標記為高意向，提醒業務致電', trigger: '3天未開', channel: 'Email', status: '啟用' },
  { icon: '🛒', title: '報價後追蹤', desc: '報價後7天無回應自動發提醒', trigger: '報價後7天', channel: 'LINE', status: '停用' },
]

export default function MarketingCampaignsTab({
  filtered, locations, locFilter, setLocFilter, filterBtnStyle,
  sending, handleSendCampaign, updateStatus,
  campaignMessageLogs, expandedLogCampaign, setExpandedLogCampaign,
}) {
  const totalSent = filtered.reduce((sum, c) => sum + (c.sent_count || 0), 0)

  return (
    <>
      {/* Location Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={filterBtnStyle(locFilter === '')} onClick={() => setLocFilter('')}>全部分店</button>
        {locations.map(l => (
          <button key={l.id} style={filterBtnStyle(locFilter === String(l.id))} onClick={() => setLocFilter(String(l.id))}>{l.name}</button>
        ))}
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">行銷活動總數</div><div className="stat-card-value">{filtered.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已完成</div><div className="stat-card-value">{filtered.filter(c => c.status === '已完成').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">排程中</div><div className="stat-card-value">{filtered.filter(c => c.status === '排程中').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">總發送數</div><div className="stat-card-value">{totalSent}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">自動化規則</div><div className="stat-card-value">{AUTO_RULES.filter(r => r.status === '啟用').length}</div>
        </div>
      </div>

      {/* Automation Rules */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Zap size={16} /></span> 自動化規則</div>
          <span className="badge badge-success"><span className="badge-dot"></span>系統自動執行</span>
        </div>
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {AUTO_RULES.map((rule, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 22 }}>{rule.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{rule.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rule.desc}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>觸發：{rule.trigger}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-card)', padding: '2px 8px', borderRadius: 6 }}>{rule.channel}</span>
                <span className={`badge ${rule.status === '啟用' ? 'badge-success' : 'badge-neutral'}`}><span className="badge-dot"></span>{rule.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Campaign List */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><BarChart3 size={16} /></span> 行銷活動列表</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>活動名稱</th><th>分店</th><th>類型</th><th>目標受眾</th><th>預計發送時間</th><th>已發送數</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無行銷活動</td></tr>}
              {filtered.map(c => {
                const chType = TYPE_MAP[c.type] || 'email'
                const chConfigured = isChannelConfigured(chType)
                const logs = campaignMessageLogs[c.id] || []
                return (
                  <React.Fragment key={c.id}>
                    <tr>
                      <td style={{ fontWeight: 600 }}>
                        {c.name}
                        {c._abTest && <span className="badge badge-info" style={{ marginLeft: 6, fontSize: 10 }}>A/B</span>}
                      </td>
                      <td style={{ fontSize: 12 }}>{locations.find(l => l.id === c.location_id)?.name || '-'}</td>
                      <td style={{ fontSize: 12 }}>
                        {c.type}
                        <span className={`badge ${chConfigured ? 'badge-success' : 'badge-info'}`} style={{ marginLeft: 6, fontSize: 9 }}>
                          <span className="badge-dot"></span>{chConfigured ? '已設定' : '模擬模式'}
                        </span>
                      </td>
                      <td><span style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontSize: 11 }}>{c.segment}</span></td>
                      <td style={{ fontSize: 12 }}>{c.scheduled_at ? new Date(c.scheduled_at).toLocaleString('zh-TW') : '-'}</td>
                      <td style={{ fontWeight: 700 }}>{c.sent_count || 0}</td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[c.status] || 'badge-neutral'}`}>
                          <span className="badge-dot"></span>
                          {STATUS_ICON[c.status]} {c.status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {(c.status === '草稿' || c.status === '排程中') && (
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: 11, padding: '3px 10px' }}
                              disabled={sending}
                              onClick={() => handleSendCampaign(c)}
                            >
                              <Send size={11} /> 發送活動
                            </button>
                          )}
                          {c.status === '草稿' && (
                            <button
                              className="btn"
                              style={{ fontSize: 11, padding: '3px 10px', background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)', border: '1px solid var(--accent-orange)' }}
                              onClick={() => updateStatus(c.id, '排程中')}
                            >
                              <Clock size={11} /> 排程
                            </button>
                          )}
                          {c.status === '已完成' && logs.length > 0 && (
                            <button
                              className="btn"
                              style={{ fontSize: 11, padding: '3px 10px', background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)', border: '1px solid var(--accent-blue)' }}
                              onClick={() => setExpandedLogCampaign(expandedLogCampaign === c.id ? null : c.id)}
                            >
                              <List size={11} /> 發送紀錄 ({logs.length})
                            </button>
                          )}
                          {c.status !== '已取消' && c.status !== '已完成' && (
                            <button
                              className="btn"
                              style={{ fontSize: 11, padding: '3px 10px', background: 'var(--glass-light)', color: 'var(--text-muted)', border: '1px solid var(--border-medium)' }}
                              onClick={() => updateStatus(c.id, '已取消')}
                            >
                              取消
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedLogCampaign === c.id && logs.length > 0 && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div style={{ padding: '12px 16px', background: 'var(--glass-light)', borderTop: '1px solid var(--border-subtle)' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>
                              發送紀錄 ({logs.length} 筆)
                            </div>
                            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)' }}>通道</th>
                                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)' }}>收件人</th>
                                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)' }}>狀態</th>
                                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)' }}>時間</th>
                                </tr>
                              </thead>
                              <tbody>
                                {logs.map((log, idx) => (
                                  <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                    <td style={{ padding: '4px 8px' }}>{log.channel || chType}</td>
                                    <td style={{ padding: '4px 8px' }}>{log.recipient || '-'}</td>
                                    <td style={{ padding: '4px 8px' }}>
                                      <span className={`badge ${log.status === 'sent' ? 'badge-success' : log.status === 'simulated' ? 'badge-info' : log.status === 'failed' ? 'badge-error' : 'badge-warning'}`} style={{ fontSize: 10 }}>
                                        <span className="badge-dot"></span>
                                        {log.status === 'sent' ? '已發送' : log.status === 'simulated' ? '模擬' : log.status === 'failed' ? '失敗' : '排隊中'}
                                      </span>
                                    </td>
                                    <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{log.sent_at ? new Date(log.sent_at).toLocaleString('zh-TW') : '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
