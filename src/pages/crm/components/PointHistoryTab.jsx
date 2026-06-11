import { ChevronDown, ChevronUp } from 'lucide-react'

export default function PointHistoryTab({
  members,
  pointHistory,
  expandedMember,
  setExpandedMember,
  levelBadge,
  formatTime,
}) {
  const memberHistoryFor = (memberId) => pointHistory.filter(h => h.member_id === memberId)

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><span className="card-title-icon">📊</span> 點數紀錄</div>
      </div>
      {pointHistory.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          尚無點數異動紀錄。透過「模擬消費」或「兌換」產生紀錄。
        </div>
      ) : (
        <>
          {/* All history table */}
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>交易編號</th><th>會員</th><th>類型</th><th>點數</th><th>描述</th><th>時間</th></tr>
              </thead>
              <tbody>
                {pointHistory.map(h => {
                  const member = members.find(m => m.id === h.member_id)
                  return (
                    <tr key={h.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{h.id}</td>
                      <td>{member?.name || h.member_id}</td>
                      <td>
                        <span className={`badge ${h.type === 'earn' ? 'badge-green' : 'badge-orange'}`}>
                          <span className="badge-dot"></span>{h.type === 'earn' ? '累點' : '兌換'}
                        </span>
                      </td>
                      <td style={{
                        fontWeight: 700,
                        color: h.points > 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                      }}>
                        {h.points > 0 ? '+' : ''}{h.points}
                      </td>
                      <td style={{ fontSize: 12 }}>{h.description}</td>
                      <td style={{ fontSize: 12 }}>{formatTime(h.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Per-member expandable summary */}
          <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-subtle)' }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>依會員檢視</h4>
            {members.filter(m => memberHistoryFor(m.id).length > 0).map(m => {
              const history = memberHistoryFor(m.id)
              const isExpanded = expandedMember === m.id
              const totalEarned = history.filter(h => h.type === 'earn').reduce((s, h) => s + h.points, 0)
              const totalRedeemed = history.filter(h => h.type === 'redeem').reduce((s, h) => s + Math.abs(h.points), 0)
              return (
                <div key={m.id} style={{
                  border: '1px solid var(--border-subtle)', borderRadius: 8,
                  marginBottom: 8, overflow: 'hidden',
                }}>
                  <div
                    style={{
                      padding: '10px 16px', display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', cursor: 'pointer', background: 'var(--bg-tertiary)',
                    }}
                    onClick={() => setExpandedMember(isExpanded ? null : m.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{m.name}</span>
                      <span className={`badge ${levelBadge(m.level)}`}>
                        <span className="badge-dot"></span>{m.level}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                      <span style={{ color: 'var(--accent-green)' }}>累計 +{totalEarned}</span>
                      <span style={{ color: 'var(--accent-red)' }}>兌換 -{totalRedeemed}</span>
                      <span>{history.length} 筆</span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '0 16px 12px' }}>
                      <div className="data-table-wrapper">
                        <table className="data-table" style={{ marginTop: 8 }}>
                          <thead>
                            <tr><th>類型</th><th>點數</th><th>描述</th><th>時間</th></tr>
                          </thead>
                          <tbody>
                            {history.map(h => (
                              <tr key={h.id}>
                                <td>
                                  <span className={`badge ${h.type === 'earn' ? 'badge-green' : 'badge-orange'}`}>
                                    <span className="badge-dot"></span>{h.type === 'earn' ? '累點' : '兌換'}
                                  </span>
                                </td>
                                <td style={{ fontWeight: 700, color: h.points > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                  {h.points > 0 ? '+' : ''}{h.points}
                                </td>
                                <td style={{ fontSize: 12 }}>{h.description}</td>
                                <td style={{ fontSize: 12 }}>{formatTime(h.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
