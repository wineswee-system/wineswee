import Modal from '../../../components/Modal'
import { LEAVE_TYPES } from '../../../lib/leavePolicy'

// Props: open, onClose
export default function LeavePolicyModal({ open, onClose }) {
  if (!open) return null

  return (
    <Modal title="假別法規參照" onClose={onClose} onSubmit={onClose} submitLabel="關閉">
      <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {LEAVE_TYPES.map(t => (
          <div key={t.code} style={{
            padding: '14px 0', borderBottom: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t.name}</span>
              <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' }}>{t.law}</span>
              {t.paid ? (
                <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-green-dim)', color: 'var(--accent-green)' }}>有薪</span>
              ) : (
                <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-red-dim)', color: 'var(--accent-red)' }}>無薪</span>
              )}
              {t.gender && (
                <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'var(--accent-pink-dim)', color: 'var(--accent-pink)' }}>{t.gender === 'female' ? '限女性' : '限男性'}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 4 }}>{t.description}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <strong>薪資：</strong>{t.salary}
              {t.maxDays && <span> · <strong>上限：</strong>{t.maxDays} 天/年</span>}
              {t.allowHourly && <span> · 可按小時請假</span>}
            </div>
            {t.conditions && (
              <div style={{ marginTop: 6, paddingLeft: 12 }}>
                {t.conditions.map((c, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>
                    • {c.desc}：<strong>{c.days} 天</strong>{c.salary ? `（${c.salary}）` : ''}
                  </div>
                ))}
              </div>
            )}
            {t.settlement && <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4 }}>⚠ {t.settlement}</div>}
            {t.note && <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 4 }}>💡 {t.note}</div>}
            {t.note2026 && <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 4, padding: '6px 10px', borderRadius: 6, background: 'var(--accent-orange-dim)' }}>🆕 {t.note2026}</div>}
          </div>
        ))}
      </div>
    </Modal>
  )
}
