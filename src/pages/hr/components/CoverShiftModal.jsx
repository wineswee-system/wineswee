export default function CoverShiftModal({ coverModal, setCoverModal, coverLoading, coverCandidates, handleAssignCover }) {
  if (!coverModal) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)', width: '100vw', height: '100vh',
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
          ) : coverCandidates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
              😔 沒有符合條件的人選
              <div style={{ fontSize: 12, marginTop: 8 }}>所有員工當天都有班或不符合 11 小時班距規定</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                找到 {coverCandidates.length} 位可代班人選（依適合度排序）
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
                  <button className="btn btn-sm btn-primary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                    onClick={() => handleAssignCover(c.name, coverModal.date, coverModal.shift)}>
                    指派代班
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
