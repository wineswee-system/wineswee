import Modal from '../../../components/Modal'
import { LABOR_STANDARDS, GENDER_EQUALITY, OCCUPATIONAL_SAFETY } from '../../../lib/laborLaw'

export default function LawReferenceModal({ onClose }) {
  return (
    <Modal title="排班相關法規參照" onClose={onClose} onSubmit={onClose} submitLabel="關閉">
      <div style={{ maxHeight: '65vh', overflowY: 'auto' }}>
        {/* 勞基法 */}
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 700 }}>勞基法</span>
          勞動基準法
        </div>
        {Object.values(LABOR_STANDARDS).map(rule => (
          <div key={rule.law} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{rule.title}</span>
              <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' }}>{rule.law}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{rule.desc}</div>
            {rule.note && <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4 }}>⚠ {rule.note}</div>}
            {rule.detail && (
              <div style={{ marginTop: 6, paddingLeft: 12 }}>
                {rule.detail.map((d, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {d}</div>)}
              </div>
            )}
            {rule.rates && (
              <div style={{ marginTop: 8, background: 'var(--glass-light)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>加班費率：</div>
                {rule.rates.map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', padding: '2px 0' }}>
                    <span>{r.desc}</span>
                    <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{r.formula}</span>
                  </div>
                ))}
              </div>
            )}
            {rule.conditions && (
              <div style={{ marginTop: 6, paddingLeft: 12 }}>
                {rule.conditions.map((c, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {c}</div>)}
              </div>
            )}
            {rule.measures && (
              <div style={{ marginTop: 6, paddingLeft: 12 }}>
                {rule.measures.map((m, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {m}</div>)}
              </div>
            )}
            {rule.holidays2026 && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {rule.holidays2026.map(h => (
                  <span key={h.date} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-red-dim)', color: 'var(--accent-red)' }}>
                    {h.date} {h.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* 性平法 */}
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '20px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, background: 'var(--accent-pink-dim)', color: 'var(--accent-pink)', fontWeight: 700 }}>性平法</span>
          性別平等工作法
        </div>
        {Object.values(GENDER_EQUALITY).map(rule => (
          <div key={rule.law} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{rule.title}</span>
              <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-pink-dim)', color: 'var(--accent-pink)' }}>{rule.law}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{rule.desc}</div>
            {rule.impact && <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 4 }}>💡 {rule.impact}</div>}
          </div>
        ))}

        {/* 職安法 */}
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '20px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, background: 'var(--accent-green-dim)', color: 'var(--accent-green)', fontWeight: 700 }}>職安法</span>
          職業安全衛生法
        </div>
        {Object.values(OCCUPATIONAL_SAFETY).map(rule => (
          <div key={rule.law} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{rule.title}</span>
              <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-green-dim)', color: 'var(--accent-green)' }}>{rule.law}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{rule.desc}</div>
            {rule.measures && (
              <div style={{ marginTop: 6, paddingLeft: 12 }}>
                {rule.measures.map((m, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {m}</div>)}
              </div>
            )}
            {rule.prohibitedWork && (
              <div style={{ marginTop: 6, paddingLeft: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-red)', marginBottom: 4 }}>禁止作業：</div>
                {rule.prohibitedWork.map((w, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>• {w}</div>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}
