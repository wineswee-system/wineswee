import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export default function NewWorkflowMenu({ onClose, onBlank, onFromTemplate, onAi }) {
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
          borderRadius: 16, padding: 32, width: 420, maxWidth: '92vw',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>新增流程</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            {
              icon: '📄',
              label: '建立空白流程',
              desc: '從頭手動填寫步驟與設定',
              action: onBlank,
            },
            {
              icon: '📁',
              label: '從範本建立',
              desc: '選擇現有 SOP 範本快速部署',
              action: onFromTemplate,
            },
            {
              icon: '🤖',
              label: 'AI 助手建立',
              desc: '描述需求，讓 AI 自動生成流程',
              action: onAi,
            },
          ].map(opt => (
            <button
              key={opt.label}
              onClick={opt.action}
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '16px 20px', borderRadius: 12, cursor: 'pointer',
                background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                textAlign: 'left', transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-cyan)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
            >
              <span style={{ fontSize: 28, lineHeight: 1 }}>{opt.icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>{opt.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
