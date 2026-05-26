import { Sparkles, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react'
import { isAbsence, getDayLabel, formatShiftLabel } from '../../../lib/scheduleUtils'

// ══════════════════════════════════════════════════════════════
//  AI Draft Review Panel
//  Shown when aiDraft is present and mainTab === 'schedule'
// ══════════════════════════════════════════════════════════════
export default function AiDraftReviewPanel({
  aiDraft,
  filtered,
  activeDates,
  viewMode,
  autoScheduling,
  onFixViolations,
}) {
  return (
    <div style={{ marginBottom: 16, padding: 16, borderRadius: 12, background: 'var(--bg-card)', border: '2px solid var(--accent-cyan)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={18} style={{ color: 'var(--accent-orange)' }} />
          AI 排班草稿
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
            ({aiDraft.meta?.model || 'Gemini'} · {aiDraft.assignments?.length || 0} 筆)
          </span>
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {aiDraft.errors?.length > 0 && (
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
              onClick={onFixViolations} disabled={autoScheduling}>
              <RefreshCw size={12} /> AI 修正違規
            </button>
          )}
        </div>
      </div>

      {/* Reasoning */}
      {aiDraft.reasoning && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, padding: '8px 12px', background: 'var(--glass-light)', borderRadius: 8 }}>
          <strong>AI 排班邏輯：</strong> {aiDraft.reasoning}
        </div>
      )}

      {/* Errors */}
      {aiDraft.errors?.length > 0 && (
        <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#ef4444', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} /> {aiDraft.errors.length} 個違規
          </div>
          {aiDraft.errors.map((v, i) => (
            <div key={i} style={{ fontSize: 12, color: '#fca5a5', paddingLeft: 20 }}>
              [{v.constraint}] {v.message}
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {aiDraft.warnings?.length > 0 && (
        <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#f59e0b', marginBottom: 4 }}>
            ⚠️ {aiDraft.warnings.length} 個警告
          </div>
          {aiDraft.warnings.map((v, i) => (
            <div key={i} style={{ fontSize: 12, color: '#fcd34d', paddingLeft: 20 }}>
              [{v.constraint}] {v.message}
            </div>
          ))}
        </div>
      )}

      {/* All clear */}
      {(aiDraft.errors?.length === 0 && aiDraft.warnings?.length === 0) && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle size={14} style={{ color: '#22c55e' }} />
          <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>排班完全符合勞基法規定</span>
        </div>
      )}

      {/* Draft preview table */}
      <div style={{ marginTop: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-medium)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1 }}>員工</th>
              {activeDates.map(d => {
                const dow = getDayLabel(d)
                const isWeekend = [5, 6].includes(new Date(d).getDay()) // Fri + Sat
                return (
                  <th key={d} style={{ textAlign: 'center', padding: '6px 2px', color: isWeekend ? 'var(--accent-red)' : 'var(--text-muted)', minWidth: viewMode === 'month' ? 40 : 70, fontSize: viewMode === 'month' ? 10 : 12 }}>
                    {d.slice(5)}<br /><span style={{ fontSize: 9 }}>{dow}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map(emp => {
              const empAssignments = aiDraft.assignments?.filter(a => a.employee === emp.name) || []
              return (
                <tr key={emp.name} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 500, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1 }}>{emp.name}</td>
                  {activeDates.map(date => {
                    const a = empAssignments.find(a => a.date === date)
                    const shift = a?.shift
                    const isRest = isAbsence(shift)
                    const hasError = aiDraft.errors?.some(v => v.employee === emp.name && v.message.includes(date))
                    return (
                      <td key={date} style={{
                        textAlign: 'center', padding: '2px', verticalAlign: 'middle',
                        background: hasError ? 'rgba(239,68,68,0.15)' : isRest ? 'var(--glass-light)' : shift ? 'rgba(34,197,94,0.08)' : 'transparent',
                        borderRadius: 4, fontSize: viewMode === 'month' ? 9 : 11,
                      }}>
                        {isRest ? (
                          <span style={{ color: 'var(--text-muted)' }}>{shift}</span>
                        ) : shift ? (
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{formatShiftLabel(shift)}</span>
                        ) : '-'}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
