import { Star } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'
import { calculateCSATMetrics } from '../../../lib/crmEngine'

function renderStars(score, size = 14) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={size} fill={n <= score ? '#f59e0b' : 'transparent'} color={n <= score ? '#f59e0b' : 'var(--text-muted)'} />
      ))}
    </span>
  )
}

/**
 * CsatTab — CSAT survey list, aggregate metrics, score distribution, and rating modal.
 *
 * Props:
 *   csatSurveys    array
 *   tickets        array
 *   csatModal      ticket object or null (the ticket currently being rated)
 *   csatScore      number (0–5)
 *   csatComment    string
 *   setCsatModal   (ticket | null) => void
 *   setCsatScore   (n) => void
 *   setCsatComment (s) => void
 *   onCSATSubmit   () => void
 */
export default function CsatTab({
  csatSurveys, tickets,
  csatModal, csatScore, csatComment,
  setCsatModal, setCsatScore, setCsatComment,
  onCSATSubmit,
}) {
  const csatMetrics = calculateCSATMetrics(csatSurveys)

  return (
    <>
      {/* Aggregate metrics */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">平均分數</div>
          <div className="stat-card-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {csatMetrics.avg || '-'} <Star size={16} fill="#f59e0b" color="#f59e0b" />
          </div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">滿意率 (4-5分)</div>
          <div className="stat-card-value">{csatMetrics.satisfiedRate || 0}%</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">已回覆</div>
          <div className="stat-card-value">{csatMetrics.count}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">回覆率</div>
          <div className="stat-card-value">{csatMetrics.responseRate || 0}%</div>
        </div>
      </div>

      {/* Score distribution */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📊</span> 分數分佈</div>
        </div>
        <div style={{ padding: '12px 16px 16px', display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          {[5, 4, 3, 2, 1].map(score => {
            const count = csatMetrics.distribution?.[score] || 0
            const maxCount = Math.max(1, ...Object.values(csatMetrics.distribution || {}))
            const pct = (count / maxCount) * 100
            const barColors = { 5: 'var(--accent-green)', 4: 'var(--accent-cyan)', 3: 'var(--accent-orange)', 2: 'var(--accent-red)', 1: 'var(--accent-red)' }
            return (
              <div key={score} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{count}</span>
                <div style={{ width: '100%', height: 80, background: 'var(--glass-light)', borderRadius: 6, display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{ width: '100%', height: `${Math.max(4, pct)}%`, background: barColors[score], borderRadius: 6, transition: 'height 0.3s' }} />
                </div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}>
                  {score} <Star size={11} fill="#f59e0b" color="#f59e0b" />
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Survey list */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">⭐</span> CSAT 問卷列表</div>
          <span className="badge badge-neutral"><span className="badge-dot"></span>共 {csatSurveys.length} 筆</span>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>工單</th><th>客戶</th><th>評分</th><th>留言</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {csatSurveys.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無 CSAT 調查</td></tr>
              )}
              {csatSurveys.map(s => {
                const ticket = tickets.find(t => t.id === s.ticket_id)
                return (
                  <tr key={s.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-muted)' }}>#{String(s.ticket_id).padStart(4, '0')}</td>
                    <td style={{ fontWeight: 600 }}>{s.customer_id}</td>
                    <td>{s.score ? renderStars(s.score) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>未評</span>}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.comment || '-'}</td>
                    <td>
                      {s.score ? (
                        <span className="badge badge-success"><span className="badge-dot"></span>已回覆</span>
                      ) : (
                        <span className="badge badge-warning"><span className="badge-dot"></span>待回覆</span>
                      )}
                    </td>
                    <td>
                      {!s.score && ticket && (
                        <button
                          className="btn" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--accent-purple)', color: '#fff' }}
                          onClick={() => { setCsatModal(ticket); setCsatScore(0); setCsatComment('') }}
                        >
                          填寫評分
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* CSAT Rating Modal */}
      {csatModal && (
        <Modal title={`CSAT 評分 — 工單 #${String(csatModal.id).padStart(4, '0')}`} onClose={() => setCsatModal(null)} onSubmit={onCSATSubmit}>
          <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              客戶：<strong>{csatModal.customer_name}</strong>　主旨：{csatModal.subject}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>請評分（1-5 顆星）</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setCsatScore(n)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, transform: csatScore === n ? 'scale(1.3)' : 'scale(1)', transition: 'transform 0.15s' }}
                >
                  <Star size={28} fill={n <= csatScore ? '#f59e0b' : 'transparent'} color={n <= csatScore ? '#f59e0b' : 'var(--text-muted)'} />
                </button>
              ))}
            </div>
            {csatScore > 0 && (
              <div style={{ fontSize: 13, marginTop: 8, color: 'var(--accent-purple)', fontWeight: 600 }}>
                {['', '非常不滿意', '不滿意', '普通', '滿意', '非常滿意'][csatScore]}
              </div>
            )}
          </div>
          <Field label="留言（選填）">
            <textarea className="form-input" style={{ width: '100%', minHeight: 60 }} placeholder="對此次服務的評價..." value={csatComment} onChange={e => setCsatComment(e.target.value)} />
          </Field>
        </Modal>
      )}
    </>
  )
}
