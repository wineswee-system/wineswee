import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileCheck, ChevronRight, CheckCircle2, AlertTriangle } from 'lucide-react'

const C = {
  cyan: 'var(--accent-cyan)',
  green: 'var(--accent-green)',
  orange: 'var(--accent-orange)',
  red: 'var(--accent-red)',
  purple: 'var(--accent-purple)',
  muted: 'var(--text-muted)',
  card: 'var(--bg-card)',
  bg2: 'var(--bg-secondary)',
  border: 'var(--border-medium)',
  borderSubtle: 'var(--border-subtle)',
}

// ──────────────────────────────────────────────
// 子元件：待簽核 row
// ──────────────────────────────────────────────
function PendingRow({ item, onClick }) {
  const isOverdue = item.daysOpen >= 3
  const p = item.progress
  const pct = p && p.total > 0 ? Math.round((p.current / p.total) * 100) : 0
  return (
    <div
      onClick={() => onClick?.(item)}
      style={{
        padding: 12, borderRadius: 10, border: `1px solid ${C.borderSubtle}`,
        background: C.bg2, cursor: 'pointer',
        transition: 'border-color .12s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.cyan }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderSubtle }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
          background: item.kindColor + '20', color: item.kindColor, flexShrink: 0,
        }}>{item.kindLabel}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {item.title}
          </div>
          {item.subtitle && (
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{item.subtitle}</div>
          )}
          {p && p.total > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <div style={{
                flex: 1, height: 4, borderRadius: 2, background: C.borderSubtle, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', width: `${pct}%`, background: item.kindColor,
                  transition: 'width .3s',
                }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: item.kindColor, minWidth: 30, textAlign: 'right' }}>
                {p.current}/{p.total} 關
              </span>
            </div>
          )}
        </div>
        {isOverdue && (
          <span style={{ fontSize: 10, fontWeight: 700, color: C.red, flexShrink: 0 }}>
            🚨 {item.daysOpen}天
          </span>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// PendingApprovalsPanel
// Props:
//   pendingUnified — array of unified pending items (sorted overdue-first)
//   alerts         — array of alert objects { icon, color, text }
// ──────────────────────────────────────────────
export default function PendingApprovalsPanel({ pendingUnified, alerts }) {
  const navigate = useNavigate()
  const [showAllPending, setShowAllPending] = useState(false)
  const pendingDisplay = showAllPending ? pendingUnified : pendingUnified.slice(0, 5)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
      gap: 16,
    }} className="dash-two-col">
      {/* 待簽核 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileCheck size={16} style={{ color: C.purple }} /> 待簽核
            {pendingUnified.length > 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>({pendingUnified.length})</span>
            )}
          </h3>
          <button
            onClick={() => navigate('/process/approvals')}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: C.cyan, display: 'flex', alignItems: 'center', gap: 4 }}>
            全部 <ChevronRight size={12} />
          </button>
        </div>

        {pendingUnified.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
            <CheckCircle2 size={28} style={{ color: C.green, marginBottom: 8 }} /><br />
            🎉 今日無待簽案件
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pendingDisplay.map(item => (
                <PendingRow key={item.id} item={item} onClick={() => navigate(item.target)} />
              ))}
            </div>
            {pendingUnified.length > 5 && (
              <button
                onClick={() => setShowAllPending(s => !s)}
                style={{ marginTop: 10, width: '100%', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 8, padding: 8, cursor: 'pointer', fontSize: 12, color: C.muted }}>
                {showAllPending ? '收起' : `展開全部 ${pendingUnified.length} 筆`}
              </button>
            )}
          </>
        )}
      </div>

      {/* 警示 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} style={{ color: C.orange }} /> 警示
          {alerts.length > 0 && (
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>({alerts.length})</span>
          )}
        </h3>
        {alerts.length === 0 ? (
          <div style={{ padding: '20px 8px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
            ✅ 一切正常
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.slice(0, 6).map((a, i) => (
              <div key={i} style={{
                padding: '8px 10px', borderRadius: 8,
                background: C.bg2, border: `1px solid ${C.borderSubtle}`,
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12,
              }}>
                <span style={{ fontSize: 16 }}>{a.icon}</span>
                <span style={{ color: a.color, fontWeight: 500, flex: 1 }}>{a.text}</span>
              </div>
            ))}
            {alerts.length > 6 && (
              <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 4 }}>
                還有 {alerts.length - 6} 則
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
