import React from 'react'
import {
  Send, Eye, BarChart3, MousePointerClick, Mail, MailX, TrendingUp,
  XCircle, List
} from 'lucide-react'
import { calculateEmailMetrics } from '../../../lib/crmEngine'

const EVENT_TYPE_LABEL = {
  'sent': { label: '已發送', color: 'var(--accent-blue)' },
  'delivered': { label: '已送達', color: 'var(--accent-cyan)' },
  'opened': { label: '已開啟', color: 'var(--accent-green)' },
  'clicked': { label: '已點擊', color: 'var(--accent-purple)' },
  'bounced': { label: '退信', color: 'var(--accent-red)' },
  'unsubscribed': { label: '退訂', color: 'var(--accent-orange)' },
}

export default function MarketingTrackingTab({
  filtered, campaignEvents, unsubscribeList,
  selectedTrackingCampaign, setSelectedTrackingCampaign,
  showEventLog, setShowEventLog,
}) {
  const trackingCampaigns = filtered.filter(c => c.status === '已完成' && campaignEvents[c.id])
  const selectedEvents = selectedTrackingCampaign ? (campaignEvents[selectedTrackingCampaign] || []) : []
  const selectedMetrics = selectedEvents.length > 0 ? calculateEmailMetrics(selectedEvents) : null

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">已追蹤活動</div><div className="stat-card-value">{trackingCampaigns.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">總追蹤事件</div><div className="stat-card-value">{Object.values(campaignEvents).reduce((s, e) => s + e.length, 0)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">退訂人數</div><div className="stat-card-value">{unsubscribeList.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">總退信數</div>
          <div className="stat-card-value">
            {Object.values(campaignEvents).reduce((s, evts) => s + evts.filter(e => e.type === 'bounced').length, 0)}
          </div>
        </div>
      </div>

      {/* Campaign selector */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><BarChart3 size={16} /></span> 選擇活動查看追蹤</div>
        </div>
        <div style={{ padding: '0 16px 16px' }}>
          <select className="form-input" style={{ width: '100%', maxWidth: 400 }} value={selectedTrackingCampaign || ''} onChange={e => { setSelectedTrackingCampaign(e.target.value || null); setShowEventLog(false) }}>
            <option value="">-- 請選擇已完成的活動 --</option>
            {trackingCampaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
            ))}
          </select>
        </div>
      </div>

      {selectedMetrics && (
        <>
          {/* Metrics Cards */}
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', marginBottom: 16 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
              <div className="stat-card-label"><Send size={12} /> 已發送</div><div className="stat-card-value">{selectedMetrics.sent}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label"><Mail size={12} /> 已送達</div><div className="stat-card-value">{selectedMetrics.delivered}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedMetrics.deliveryRate}%</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label"><Eye size={12} /> 已開啟</div><div className="stat-card-value">{selectedMetrics.opened}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedMetrics.openRate}%</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
              <div className="stat-card-label"><MousePointerClick size={12} /> 已點擊</div><div className="stat-card-value">{selectedMetrics.clicked}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedMetrics.clickRate}%</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
              <div className="stat-card-label"><XCircle size={12} /> 退信</div><div className="stat-card-value">{selectedMetrics.bounced}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedMetrics.bounceRate}%</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
              <div className="stat-card-label"><MailX size={12} /> 退訂</div><div className="stat-card-value">{selectedMetrics.unsubscribed}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedMetrics.unsubRate}%</div>
            </div>
          </div>

          {/* Visual bar chart */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon"><TrendingUp size={16} /></span> 漏斗分析</div>
            </div>
            <div style={{ padding: '0 16px 16px' }}>
              {[
                { label: '已發送', value: selectedMetrics.sent, color: 'var(--accent-blue)' },
                { label: '已送達', value: selectedMetrics.delivered, color: 'var(--accent-cyan)' },
                { label: '已開啟', value: selectedMetrics.opened, color: 'var(--accent-green)' },
                { label: '已點擊', value: selectedMetrics.clicked, color: 'var(--accent-purple)' },
              ].map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <div style={{ width: 60, fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{item.label}</div>
                  <div style={{ flex: 1, height: 24, background: 'var(--glass-light)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{
                      width: `${selectedMetrics.sent > 0 ? (item.value / selectedMetrics.sent) * 100 : 0}%`,
                      height: '100%', background: item.color, borderRadius: 6,
                      transition: 'width 0.5s ease', minWidth: item.value > 0 ? 20 : 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8,
                    }}>
                      <span style={{ fontSize: 11, color: '#fff', fontWeight: 700 }}>{item.value}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Event Log Toggle */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon"><List size={16} /></span> 追蹤事件明細</div>
              <button className="btn" style={{ fontSize: 11, padding: '4px 12px', background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: '1px solid var(--accent-cyan)' }} onClick={() => setShowEventLog(!showEventLog)}>
                {showEventLog ? '收合' : '展開'} ({selectedEvents.length} 筆)
              </button>
            </div>
            {showEventLog && (
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead><tr><th>時間</th><th>收件人</th><th>事件類型</th><th>詳情</th></tr></thead>
                  <tbody>
                    {selectedEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map((evt, i) => {
                      const meta = EVENT_TYPE_LABEL[evt.type] || { label: evt.type, color: 'var(--text-muted)' }
                      return (
                        <tr key={i}>
                          <td style={{ fontSize: 11 }}>{new Date(evt.timestamp).toLocaleString('zh-TW')}</td>
                          <td style={{ fontSize: 12 }}>{evt.recipient_name || evt.recipient_id}</td>
                          <td>
                            <span style={{ padding: '2px 8px', borderRadius: 6, background: `${meta.color}22`, color: meta.color, fontSize: 11, fontWeight: 600 }}>
                              {meta.label}
                            </span>
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {evt.url || evt.reason || '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {!selectedTrackingCampaign && (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          <BarChart3 size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
          <p>請選擇一個已完成的活動以查看追蹤分析</p>
        </div>
      )}
    </>
  )
}
