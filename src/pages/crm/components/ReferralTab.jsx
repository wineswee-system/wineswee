import { Hash, Copy, RefreshCw } from 'lucide-react'

export default function ReferralTab({
  members,
  referralCodes,
  levelBadge,
  handleGenerateReferral,
  copyCode,
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><span className="card-title-icon">🎁</span> 推薦計畫</div>
      </div>
      <div style={{ padding: '16px 20px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
        每位會員可產生專屬推薦碼，成功推薦可獲得 <strong>200 點</strong>獎勵。每組推薦碼最多可使用 10 次。
      </div>
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr><th>會員編號</th><th>姓名</th><th>等級</th><th>推薦碼</th><th>使用次數</th><th>獎勵點數</th><th>操作</th></tr>
          </thead>
          <tbody>
            {members.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無會員</td></tr>}
            {members.map(m => {
              const ref = referralCodes[m.id]
              return (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.member_number}</td>
                  <td>{m.name}</td>
                  <td>
                    <span className={`badge ${levelBadge(m.level)}`}>
                      <span className="badge-dot"></span>{m.level}
                    </span>
                  </td>
                  <td>
                    {ref ? (
                      <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13, color: 'var(--accent-blue)' }}>
                        {ref.code}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>尚未產生</span>
                    )}
                  </td>
                  <td>{ref ? `${ref.uses} / ${ref.max_uses}` : '-'}</td>
                  <td>{ref ? `${ref.bonus_points} 點/次` : '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {!ref ? (
                        <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => handleGenerateReferral(m)}>
                          <Hash size={12} /> 產生推薦碼
                        </button>
                      ) : (
                        <>
                          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => copyCode(ref.code)} title="複製推薦碼">
                            <Copy size={12} /> 複製
                          </button>
                          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => handleGenerateReferral(m)} title="重新產生">
                            <RefreshCw size={12} /> 重新產生
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
