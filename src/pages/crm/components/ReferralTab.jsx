import { useState } from 'react'
import { Hash, Copy, RefreshCw, Gift, CheckCircle, AlertCircle } from 'lucide-react'

const REFERRER_POINTS = 200
const REFEREE_POINTS = 100

export default function ReferralTab({
  members,
  referralCodes,
  levelBadge,
  handleGenerateReferral,
  copyCode,
  handleApplyReferral,
  redemptions,
  applyingCode,
}) {
  const [applyMemberId, setApplyMemberId] = useState('')
  const [applyCode, setApplyCode] = useState('')
  const [applyResult, setApplyResult] = useState(null)

  const onApply = async () => {
    if (!applyMemberId || !applyCode.trim()) return
    setApplyResult(null)
    const result = await handleApplyReferral(Number(applyMemberId), applyCode.trim())
    setApplyResult(result)
    if (result.success) {
      setApplyCode('')
      setApplyMemberId('')
    }
  }

  // Count uses per referral code
  const useCounts = {}
  for (const r of redemptions) {
    useCounts[r.referral_code_id] = (useCounts[r.referral_code_id] || 0) + 1
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Apply referral code card */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Gift size={16} /></span> 使用推薦碼</div>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            新會員輸入推薦碼，推薦人獲得 <strong>{REFERRER_POINTS} 點</strong>，被推薦人獲得 <strong>{REFEREE_POINTS} 點</strong>。每位會員只能使用一次推薦碼。
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>被推薦會員</label>
              <select
                className="form-input"
                style={{ width: '100%' }}
                value={applyMemberId}
                onChange={e => { setApplyMemberId(e.target.value); setApplyResult(null) }}
              >
                <option value="">選擇會員...</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.member_number} - {m.name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>推薦碼</label>
              <input
                className="form-input"
                style={{ width: '100%' }}
                placeholder="REF-XXXXXX"
                value={applyCode}
                onChange={e => { setApplyCode(e.target.value.toUpperCase()); setApplyResult(null) }}
              />
            </div>
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '8px 16px', whiteSpace: 'nowrap' }}
              onClick={onApply}
              disabled={applyingCode || !applyMemberId || !applyCode.trim()}
            >
              <Gift size={13} /> {applyingCode ? '處理中...' : '兌換推薦獎勵'}
            </button>
          </div>
          {applyResult && (
            <div style={{
              marginTop: 10, padding: '8px 12px', borderRadius: 8, fontSize: 12,
              display: 'flex', alignItems: 'center', gap: 6,
              background: applyResult.success ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)',
              color: applyResult.success ? 'var(--accent-green)' : 'var(--accent-red)',
            }}>
              {applyResult.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
              {applyResult.message}
            </div>
          )}
        </div>
      </div>

      {/* Referral codes table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Hash size={16} /></span> 推薦碼管理</div>
        </div>
        <div style={{ padding: '16px 20px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
          每位會員可產生專屬推薦碼，成功推薦可獲得 <strong>{REFERRER_POINTS} 點</strong>獎勵。每組推薦碼最多可使用 10 次。
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
                const uses = ref ? (useCounts[ref.id] || 0) : 0
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
                    <td>{ref ? `${uses} / ${ref.max_uses}` : '-'}</td>
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

      {/* Recent referral redemptions */}
      {redemptions.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><CheckCircle size={16} /></span> 推薦紀錄</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>推薦人</th><th>被推薦人</th><th>推薦人獲得</th><th>被推薦人獲得</th><th>時間</th></tr>
              </thead>
              <tbody>
                {redemptions.map(r => {
                  const referrer = members.find(m => m.id === r.referrer_id)
                  const referee = members.find(m => m.id === r.referee_id)
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{referrer?.name || `#${r.referrer_id}`}</td>
                      <td style={{ fontWeight: 600 }}>{referee?.name || `#${r.referee_id}`}</td>
                      <td><span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>+{r.referrer_points} 點</span></td>
                      <td><span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>+{r.referee_points} 點</span></td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {r.created_at ? new Date(r.created_at).toLocaleString('zh-TW') : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
