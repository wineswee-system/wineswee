// ProcessStuckWorkflowsPanel — extracted from TeamDashboard.jsx
// "卡關提示" card in the Process tab — lists workflows stuck >= 3 days
import { Hourglass } from 'lucide-react'

const C = {
  red: 'var(--accent-red)',
  orange: 'var(--accent-orange)',
  muted: 'var(--text-muted)',
  card: 'var(--bg-card)',
  bg2: 'var(--bg-secondary)',
  border: 'var(--border-medium)',
  borderSubtle: 'var(--border-subtle)',
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000)

export default function ProcessStuckWorkflowsPanel({ activeWorkflows, wfTasksMap, navigate }) {
  const today = todayStr()
  const stuck = activeWorkflows.filter(w => w.started_at && daysBetween(today, w.started_at.slice(0, 10)) >= 3)

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <h3 style={{ margin: 0, marginBottom: 12, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Hourglass size={16} style={{ color: C.red }} /> 卡關提示
      </h3>
      {stuck.length === 0 ? (
        <div style={{ padding: '20px 8px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
          ✅ 沒有卡關流程
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {stuck.slice(0, 6).map(w => {
            const days = daysBetween(today, w.started_at.slice(0, 10))
            const tasks = wfTasksMap[w.id] || []
            const total = tasks.length
            const done = tasks.filter(t => t.status === '已完成').length
            const current = tasks.find(t => ['進行中', '待簽核'].includes(t.status))
            return (
              <div key={w.id}
                onClick={() => navigate('/process/workflows')}
                style={{
                  padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  background: C.bg2, border: `1px solid ${C.borderSubtle}`,
                  fontSize: 12, transition: 'border-color .12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.red }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderSubtle }}
              >
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                  {w.template_name || '未命名流程'}
                </div>
                {current && (
                  <div style={{ color: C.orange, fontSize: 11, marginBottom: 2 }}>
                    卡在第 {current.step_order}/{total} 關：{current.title}
                    {current.assignee && <span style={{ color: C.muted }}> · 等 {current.assignee}</span>}
                  </div>
                )}
                <div style={{ color: C.muted, fontSize: 11, display: 'flex', gap: 6, justifyContent: 'space-between' }}>
                  <span>發起：{w.started_by || '—'}{total > 0 && ` · ${done}/${total}`}</span>
                  <span style={{ color: days >= 7 ? C.red : C.orange, fontWeight: 700 }}>
                    🚨 {days} 天
                  </span>
                </div>
              </div>
            )
          })}
          {stuck.length > 6 && (
            <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 4 }}>
              還有 {stuck.length - 6} 個
            </div>
          )}
        </div>
      )}
    </div>
  )
}
