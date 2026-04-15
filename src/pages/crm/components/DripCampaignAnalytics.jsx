import { X } from 'lucide-react'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

export default function DripCampaignAnalytics({ campaign, metrics, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', borderRadius: 16, width: '100%', maxWidth: 800, maxHeight: '90vh', overflow: 'auto', boxShadow: 'var(--shadow-xl)', animation: 'fadeIn 0.15s ease', padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>{campaign.name} — 分析</h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{campaign.description}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
        </div>

        {/* Funnel */}
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>轉換漏斗</h4>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0, height: 160 }}>
            {[
              { label: '已發送', value: metrics.sent, color: '#94a3b8' },
              { label: '已送達', value: metrics.delivered, color: '#60a5fa' },
              { label: '已開啟', value: metrics.opened, color: '#34d399' },
              { label: '已點擊', value: metrics.clicked, color: '#fbbf24' },
              { label: '已轉換', value: metrics.converted, color: '#f472b6' },
            ].map((item, i) => {
              const maxVal = metrics.sent || 1
              const pct = Math.max((item.value / maxVal) * 100, 8)
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{item.value}</div>
                  <div style={{ width: '70%', height: `${pct}%`, minHeight: 12, background: item.color, borderRadius: '6px 6px 0 0', transition: 'height 0.5s' }} />
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 4 }}>{item.label}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Key Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
          <div className="stat-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>開信率</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#22c55e' }}>{metrics.open_rate}%</div>
          </div>
          <div className="stat-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>點擊率</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#f59e0b' }}>{metrics.click_rate}%</div>
          </div>
          <div className="stat-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>轉換率</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#ec4899' }}>{metrics.conversion_rate}%</div>
          </div>
          <div className="stat-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>歸因營收</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(metrics.revenue_attributed)}</div>
          </div>
        </div>

        {/* Per-step breakdown */}
        {metrics.step_metrics.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>各步驟績效</h4>
            <table className="data-table" style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th>步驟</th>
                  <th>類型</th>
                  <th>主旨</th>
                  <th>發送</th>
                  <th>開啟</th>
                  <th>點擊</th>
                  <th>開信率</th>
                  <th>點擊率</th>
                </tr>
              </thead>
              <tbody>
                {metrics.step_metrics.map((sm, i) => (
                  <tr key={i}>
                    <td>#{sm.step_index + 1}</td>
                    <td>{sm.step_type || '-'}</td>
                    <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sm.subject || '-'}</td>
                    <td>{sm.sent}</td>
                    <td>{sm.opened}</td>
                    <td>{sm.clicked}</td>
                    <td><span className={`badge ${sm.open_rate > 40 ? 'badge-success' : sm.open_rate > 20 ? 'badge-warning' : 'badge-danger'}`}>{sm.open_rate}%</span></td>
                    <td><span className={`badge ${sm.click_rate > 20 ? 'badge-success' : sm.click_rate > 10 ? 'badge-warning' : 'badge-danger'}`}>{sm.click_rate}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Extra metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <div style={{ padding: 12, background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>退訂率</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444' }}>{metrics.unsubscribe_rate}%</div>
          </div>
          <div style={{ padding: 12, background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>退信率</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f59e0b' }}>{metrics.bounce_rate}%</div>
          </div>
          <div style={{ padding: 12, background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>平均每筆轉換營收</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(metrics.avg_revenue_per_conversion)}</div>
          </div>
        </div>

        <div style={{ textAlign: 'right', marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  )
}
