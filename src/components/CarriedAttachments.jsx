import { FileText, X } from 'lucide-react'

// 複製重送：列出從原單帶入的舊附件（可點開檢視、可逐一移除）。
// 各表單的複製功能共用，UX 與費用申請一致。
//   atts：[{ file_name, url, ... }]  url 有值才可點開
//   onRemove(index)：移除某筆（送出時就不會複製它）
export default function CarriedAttachments({ atts = [], onRemove, label = '從原單帶入（送出時一併複製，可移除）' }) {
  if (!atts || atts.length === 0) return null
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>📎 {label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {atts.map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', background: 'var(--accent-cyan-dim)', borderRadius: 6 }}>
            <FileText size={12} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
            {a.url
              ? <a href={a.url} target="_blank" rel="noreferrer" title="點開檢視" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--accent-cyan)', textDecoration: 'underline', cursor: 'pointer' }}>{a.file_name}</a>
              : <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.file_name}</span>}
            <button type="button" onClick={() => onRemove?.(i)} aria-label="移除"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0, lineHeight: 1, flexShrink: 0 }}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
