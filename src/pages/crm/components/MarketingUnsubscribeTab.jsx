import React from 'react'
import { Users, MailX, RefreshCw } from 'lucide-react'
import { isUnsubscribed } from '../../../lib/crmEngine'

export default function MarketingUnsubscribeTab({
  allCustomers, unsubscribeList, handleRemoveUnsub,
}) {
  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">退訂總數</div><div className="stat-card-value">{unsubscribeList.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">Email 退訂</div><div className="stat-card-value">{unsubscribeList.filter(u => u.channel === 'email').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">SMS 退訂</div><div className="stat-card-value">{unsubscribeList.filter(u => u.channel === 'sms').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">全管道退訂</div><div className="stat-card-value">{unsubscribeList.filter(u => u.channel === 'all').length}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><MailX size={16} /></span> 退訂名單</div>
          <span className="badge badge-neutral">{unsubscribeList.length} 筆</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>客戶</th><th>退訂管道</th><th>原因</th><th>退訂時間</th><th>操作</th></tr></thead>
            <tbody>
              {unsubscribeList.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>目前沒有退訂紀錄</td></tr>}
              {unsubscribeList.map(u => {
                const customer = allCustomers.find(c => c.id === u.customer_id)
                return (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{customer?.name || u.customer_id}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: u.channel === 'all' ? 'var(--accent-red-dim)' : 'var(--accent-orange-dim)',
                        color: u.channel === 'all' ? 'var(--accent-red)' : 'var(--accent-orange)',
                      }}>
                        {u.channel === 'all' ? '全部管道' : u.channel.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.reason || '-'}</td>
                    <td style={{ fontSize: 12 }}>{new Date(u.created_at).toLocaleString('zh-TW')}</td>
                    <td>
                      <button
                        className="btn"
                        style={{ fontSize: 11, padding: '3px 10px', background: 'var(--accent-green-dim)', color: 'var(--accent-green)', border: '1px solid var(--accent-green)' }}
                        onClick={() => handleRemoveUnsub(u.id)}
                      >
                        <RefreshCw size={11} /> 恢復訂閱
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick check: show who is currently unsubscribed */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Users size={16} /></span> 客戶退訂狀態</div>
        </div>
        <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {allCustomers.map(c => {
            const emailUnsub = isUnsubscribed(unsubscribeList, c.id, 'email')
            const smsUnsub = isUnsubscribed(unsubscribeList, c.id, 'sms')
            const lineUnsub = isUnsubscribed(unsubscribeList, c.id, 'line')
            const allUnsub = isUnsubscribed(unsubscribeList, c.id, 'all')
            return (
              <div key={c.id} style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{c.name}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, background: (emailUnsub || allUnsub) ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)', color: (emailUnsub || allUnsub) ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                    Email {(emailUnsub || allUnsub) ? '已退訂' : '正常'}
                  </span>
                  <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, background: (smsUnsub || allUnsub) ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)', color: (smsUnsub || allUnsub) ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                    SMS {(smsUnsub || allUnsub) ? '已退訂' : '正常'}
                  </span>
                  <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, background: (lineUnsub || allUnsub) ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)', color: (lineUnsub || allUnsub) ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                    LINE {(lineUnsub || allUnsub) ? '已退訂' : '正常'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
