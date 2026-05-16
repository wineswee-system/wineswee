// WorkflowProgressCard + TASK_STATUS_META — extracted from TeamDashboard.jsx
// Expandable card showing a single workflow instance's progress through its steps
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

const C = {
  green: 'var(--accent-green)',
  greenDim: 'var(--accent-green-dim)',
  blue: 'var(--accent-blue)',
  blueDim: 'var(--accent-blue-dim)',
  orange: 'var(--accent-orange)',
  orangeDim: 'var(--accent-orange-dim)',
  red: 'var(--accent-red)',
  redDim: 'var(--accent-red-dim)',
  cyan: 'var(--accent-cyan)',
  muted: 'var(--text-muted)',
  bg2: 'var(--bg-secondary)',
  borderSubtle: 'var(--border-subtle)',
}

const todayStr = () => new Date().toISOString().slice(0, 10)

export const TASK_STATUS_META = {
  '已完成': { icon: '✓', color: C.green, bg: C.greenDim },
  '進行中': { icon: '▶', color: C.blue, bg: C.blueDim },
  '待簽核': { icon: '◐', color: C.orange, bg: C.orangeDim },
  '待處理': { icon: '○', color: C.muted, bg: C.bg2 },
  '已擱置': { icon: '⏸', color: C.red, bg: C.redDim },
}

export default function WorkflowProgressCard({ w, tasks, days, onJump, index }) {
  const [expanded, setExpanded] = useState(false)
  const total = tasks.length
  const done = tasks.filter(t => t.status === '已完成').length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const current = tasks.find(t => ['進行中', '待簽核'].includes(t.status))
  const currentStep = current?.step_order ?? (done > 0 ? done : 1)
  const stuck = days >= 3
  const allDone = total > 0 && done === total

  return (
    <div style={{
      padding: 12, borderRadius: 10, border: `1px solid ${C.borderSubtle}`,
      background: C.bg2, transition: 'border-color .12s',
    }}>
      {/* header — 點 toggle expand */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {index != null && (
              <span style={{ color: 'var(--text-muted)', fontWeight: 600, marginRight: 6 }}>#{index}</span>
            )}
            {w.template_name || '未命名流程'}
          </div>
          <ChevronRight size={14} style={{
            color: C.muted, flexShrink: 0,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform .15s',
          }} />
        </div>

        {/* 進度條 */}
        {total > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              flex: 1, height: 6, borderRadius: 3, background: C.borderSubtle, overflow: 'hidden',
              position: 'relative',
            }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                background: allDone ? C.green : C.blue, transition: 'width .3s',
              }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: allDone ? C.green : C.blue, minWidth: 36, textAlign: 'right' }}>
              {done}/{total}
            </span>
          </div>
        )}

        {/* meta */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, gap: 8 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            發起：{w.started_by || '—'}
          </span>
          <span style={{ color: stuck ? C.red : C.muted, fontWeight: stuck ? 700 : 500, flexShrink: 0 }}>
            {stuck && '🚨 '}已 {days} 天
          </span>
        </div>

        {/* 當前關卡 */}
        {current && !expanded && (
          <div style={{
            marginTop: 2, padding: '6px 8px', borderRadius: 6,
            background: TASK_STATUS_META[current.status]?.bg || C.bg2,
            fontSize: 11, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ color: TASK_STATUS_META[current.status]?.color, fontWeight: 700 }}>
              第 {currentStep} 關
            </span>
            <span style={{ color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {current.title}
            </span>
            {current.assignee && (
              <span style={{ color: C.muted, flexShrink: 0 }}>· {current.assignee}</span>
            )}
          </div>
        )}
      </div>

      {/* 展開：每關細節 */}
      {expanded && total > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tasks.map(t => {
            const meta = TASK_STATUS_META[t.status] || TASK_STATUS_META['待處理']
            const overdue = t.due_date && t.status !== '已完成' && t.due_date < todayStr()
            return (
              <div key={t.id} style={{
                padding: '6px 8px', borderRadius: 6,
                background: meta.bg,
                fontSize: 11, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: meta.color, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                }}>{t.step_order}</span>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                  </span>
                  {t.assignee && (
                    <span style={{ color: C.muted, fontSize: 10 }}>{t.assignee}</span>
                  )}
                </div>
                <span style={{ color: meta.color, fontWeight: 700, fontSize: 10, flexShrink: 0 }}>
                  {t.status}
                </span>
                {overdue && (
                  <span style={{ color: C.red, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>逾期</span>
                )}
              </div>
            )
          })}
          <button
            onClick={(e) => { e.stopPropagation(); onJump?.() }}
            style={{
              marginTop: 4, width: '100%', background: 'transparent',
              border: `1px solid ${C.borderSubtle}`, borderRadius: 6,
              padding: '6px 8px', cursor: 'pointer',
              fontSize: 11, color: C.cyan, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}
          >
            前往流程頁 <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
