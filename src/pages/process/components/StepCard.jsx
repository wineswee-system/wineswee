import { ChevronUp, ChevronDown, Trash2, CheckSquare, Shield, FileText, Zap } from 'lucide-react'

const PRIORITY_COLOR = {
  '高': 'var(--accent-red)',
  '中': 'var(--accent-orange)',
  '低': 'var(--accent-green)',
}

const iconBtn = {
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  padding: '2px 3px',
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
}

/**
 * StepCard — TemplateStudio 左欄的單一步驟卡片
 *
 * Props:
 *   step       — { title, role, priority, checklist_id, approval_chain_id, required_forms, trigger_template_id }
 *   index      — 0-based position in the steps array
 *   total      — total number of steps
 *   isActive   — bool, highlights the selected step
 *   onClick    — called when the card body is clicked
 *   onMoveUp   — () => void — move this step one position up
 *   onMoveDown — () => void — move this step one position down
 *   onRemove   — (index: number) => void
 */
export default function StepCard({ step, index, total, isActive, onClick, onMoveUp, onMoveDown, onRemove }) {
  const badges = []
  if (step.checklist_id)
    badges.push({ icon: <CheckSquare size={10} />, color: 'var(--accent-green)', label: '清單' })
  if (step.approval_chain_id)
    badges.push({ icon: <Shield size={10} />, color: 'var(--accent-purple)', label: '簽核' })
  if (step.required_forms?.length > 0)
    badges.push({ icon: <FileText size={10} />, color: 'var(--accent-cyan)', label: `表單×${step.required_forms.length}` })
  if (step.trigger_template_id)
    badges.push({ icon: <Zap size={10} />, color: 'var(--accent-orange)', label: '觸發' })

  return (
    <div
      onClick={onClick}
      style={{
        padding: '9px 10px',
        borderRadius: 8,
        border: isActive ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
        background: isActive ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
        cursor: 'pointer',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Step number circle */}
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        background: isActive ? 'var(--accent-cyan)' : 'var(--bg-secondary)',
        color: isActive ? '#fff' : 'var(--text-muted)',
        fontSize: 11, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {index + 1}
      </div>

      {/* Step info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {step.title || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>（未命名步驟）</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
          {step.role && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 4,
              background: 'var(--bg-secondary)', color: 'var(--text-muted)',
            }}>
              {step.role}
            </span>
          )}
          {step.priority && (
            <span style={{ fontSize: 10, fontWeight: 700, color: PRIORITY_COLOR[step.priority] || 'var(--text-muted)' }}>
              ● {step.priority}
            </span>
          )}
          {badges.map((b, i) => (
            <span key={i} style={{
              fontSize: 10, display: 'flex', alignItems: 'center', gap: 2,
              color: b.color, background: 'var(--glass-light)',
              padding: '1px 5px', borderRadius: 4,
            }}>
              {b.icon} {b.label}
            </span>
          ))}
        </div>
      </div>

      {/* Move ↑↓ + delete buttons */}
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          style={{ ...iconBtn, opacity: index === 0 ? 0.25 : 1 }}
          title="上移"
        >
          <ChevronUp size={12} />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === total - 1}
          style={{ ...iconBtn, opacity: index === total - 1 ? 0.25 : 1 }}
          title="下移"
        >
          <ChevronDown size={12} />
        </button>
        <button
          type="button"
          onClick={() => onRemove(index)}
          style={{ ...iconBtn, color: 'var(--accent-red)' }}
          title="刪除步驟"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}
