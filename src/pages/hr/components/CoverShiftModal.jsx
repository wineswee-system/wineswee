import { useState } from 'react'

export default function CoverShiftModal({ coverModal, setCoverModal, coverLoading, coverCandidates, handleAssignCover, handlePostCoverRequest }) {
  const [reason, setReason] = useState('')
  const [posting, setPosting] = useState(false)
  const [showForceMode, setShowForceMode] = useState(false)

  if (!coverModal) return null

  const eligible = coverCandidates.filter(c => c.isOff && c.valid11h)

  const handleInvite = async () => {
    setPosting(true)
    try { await handlePostCoverRequest(reason) } finally { setPosting(false) }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', width: '100vw', height: '100vh',
    }} onMouseDown={e => { if (e.target === e.currentTarget) setCoverModal(null) }}>
      <div style={{
        width: '100%', maxWidth: 560, maxHeight: '85vh',
        background: 'var(--bg-primary)', border: '1px solid var(--border-medium)',
        borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: 'auto',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>🔄 找人代班</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {coverModal.employee} · {coverModal.date} · {coverModal.shift}
            </div>
          </div>
          <button onClick={() => setCoverModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {coverLoading ? (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              分析可代班人選...
            </div>
          ) : eligible.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
              😔 沒有符合條件的人選
              <div style={{ fontSize: 12, marginTop: 8 }}>所有員工當天都有班或不符合 11 小時班距規定</div>
            </div>
          ) : (
            <>
              {/* ── 邀請模式（推薦） ── */}
              <div style={{
                padding: '14px 16px', borderRadius: 12, marginBottom: 16,
                background: 'var(--accent-orange-dim)', border: '1px solid rgba(245,158,11,0.3)',
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent-orange)', marginBottom: 4 }}>
                  📨 發出代班邀請（推薦）
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                  推 LINE 給 {eligible.length} 位候選人，先搶先贏（24h 過期）
                </div>
                <textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="原因/補充說明（選填）"
                  style={{
                    width: '100%', minHeight: 50, padding: '8px 10px', borderRadius: 8,
                    border: '1px solid var(--border-medium)', background: 'var(--bg-card)',
                    color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit',
                    resize: 'vertical', marginBottom: 10,
                  }} />
                <button disabled={posting} onClick={handleInvite} style={{
                  width: '100%', padding: '10px', borderRadius: 8, border: 'none',
                  background: 'var(--accent-orange)', color: '#fff',
                  fontSize: 14, fontWeight: 800, cursor: 'pointer',
                  opacity: posting ? 0.5 : 1,
                }}>
                  {posting ? '發送中...' : `📨 發出邀請給 ${eligible.length} 位候選人`}
                </button>
              </div>

              {/* ── 候選人列表 + 強制指派（fallback） ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  候選人列表（依適合度排序）
                </div>
                <button onClick={() => setShowForceMode(s => !s)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: 11, textDecoration: 'underline',
                }}>
                  {showForceMode ? '隱藏強制指派' : '顯示強制指派 (緊急)'}
                </button>
              </div>
              {coverCandidates.map((c, i) => (
                <div key={c.name} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: 10, marginBottom: 8,
                  background: i === 0 ? 'var(--accent-green-dim)' : 'var(--bg-card)',
                  border: `1px solid ${i === 0 ? 'rgba(52,211,153,0.3)' : 'var(--border-subtle)'}`,
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {i === 0 && '⭐ '}{c.name}
                      {!c.sameStore && <span style={{ fontSize: 11, color: 'var(--accent-orange)', marginLeft: 6 }}>跨店</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {c.store || '—'} · {c.position || c.dept}
                      {c.isPT && <span className="badge badge-cyan" style={{ marginLeft: 6, fontSize: 10 }}>PT</span>}
                      {c.wouldLoseRest && <span style={{ color: 'var(--accent-orange)', marginLeft: 6 }}>⚠ 僅剩 {c.restDays} 天休</span>}
                    </div>
                  </div>
                  {showForceMode && (
                    <button className="btn btn-sm" style={{
                      fontSize: 11, whiteSpace: 'nowrap',
                      background: 'var(--accent-red-dim)', color: 'var(--accent-red)',
                      border: '1px solid rgba(248,113,113,0.3)',
                    }}
                      onClick={() => handleAssignCover(c.name, coverModal.date, coverModal.shift)}>
                      強制指派
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
