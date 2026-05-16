// ProcessMyTasksPanel — extracted from TeamDashboard.jsx
// "我的待辦任務" card in the Process tab
import { ChevronRight, ListChecks, CheckCircle2 } from 'lucide-react'
import LoadingSpinner from '../../../components/LoadingSpinner'

const C = {
  cyan: 'var(--accent-cyan)',
  green: 'var(--accent-green)',
  greenDim: 'var(--accent-green-dim)',
  orange: 'var(--accent-orange)',
  orangeDim: 'var(--accent-orange-dim)',
  red: 'var(--accent-red)',
  redDim: 'var(--accent-red-dim)',
  muted: 'var(--text-muted)',
  card: 'var(--bg-card)',
  bg2: 'var(--bg-secondary)',
  border: 'var(--border-medium)',
  borderSubtle: 'var(--border-subtle)',
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000)
const fmtDate = (d) => {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

export default function ProcessMyTasksPanel({ myTasks, processLoading, navigate }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ListChecks size={16} style={{ color: C.cyan }} /> 我的待辦任務
          {myTasks.length > 0 && (
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>({myTasks.length})</span>
          )}
        </h3>
        <button onClick={() => navigate('/process/tasks')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: C.cyan, display: 'flex', alignItems: 'center', gap: 4 }}>
          全部 <ChevronRight size={12} />
        </button>
      </div>

      {processLoading ? <LoadingSpinner /> : myTasks.length === 0 ? (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
          <CheckCircle2 size={28} style={{ color: C.green, marginBottom: 8 }} /><br />
          🎉 沒有待辦任務
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {myTasks.slice(0, 8).map(t => {
            const today = todayStr()
            const overdue = t.due_date && t.due_date < today
            const due = t.due_date ? daysBetween(t.due_date, today) : null
            return (
              <div key={t.id}
                onClick={() => navigate('/process/tasks')}
                style={{
                  padding: 12, borderRadius: 10, border: `1px solid ${C.borderSubtle}`,
                  background: C.bg2, cursor: 'pointer',
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.cyan }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderSubtle }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, flexShrink: 0,
                  background: t.priority === '高' ? C.redDim : t.priority === '低' ? C.greenDim : C.orangeDim,
                  color: t.priority === '高' ? C.red : t.priority === '低' ? C.green : C.orange,
                }}>{t.priority || '中'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: 'flex', gap: 8 }}>
                    {t.workflow && <span>📋 {t.workflow}</span>}
                    <span>狀態：{t.status}</span>
                  </div>
                </div>
                {t.due_date && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, flexShrink: 0,
                    color: overdue ? C.red : due <= 3 ? C.orange : C.muted,
                  }}>
                    {overdue ? `🚨 逾期 ${Math.abs(due)}天` : `⏰ ${fmtDate(t.due_date)}`}
                  </span>
                )}
              </div>
            )
          })}
          {myTasks.length > 8 && (
            <div style={{ textAlign: 'center', fontSize: 11, color: C.muted, marginTop: 4 }}>
              還有 {myTasks.length - 8} 個任務 → 看全部
            </div>
          )}
        </div>
      )}
    </div>
  )
}
