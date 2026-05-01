import { useState, useRef, useEffect } from 'react'
import { Plus, Rocket, Tag, MoreVertical, Trash2 } from 'lucide-react'

function TemplateMenu({ tpl, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', borderRadius: 4 }}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', zIndex: 200,
          background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', minWidth: 140, padding: 4,
        }}>
          <button
            onClick={e => { e.stopPropagation(); setOpen(false); onDelete(tpl) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '8px 12px', fontSize: 13,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--accent-red)', borderRadius: 6,
            }}
          >
            <Trash2 size={14} /> 刪除範本
          </button>
        </div>
      )}
    </div>
  )
}

export default function TemplatesList({ templates, onDeploy, onDelete, onCreateNew, onManageCategories }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 4 }}>
        {onManageCategories && (
          <button className="btn btn-secondary" onClick={onManageCategories}><Tag size={13} /> 流程分類</button>
        )}
        <button className="btn btn-primary" onClick={onCreateNew}><Plus size={13} /> 新增流程範本</button>
      </div>
      {templates.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無流程範本</div>
      ) : templates.map(tpl => {
        const tplSteps = tpl.steps || []
        return (
          <div key={tpl.id} className="card" style={{ padding: 0 }}>
            <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{tpl.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  <span className="badge badge-cyan" style={{ marginRight: 8 }}>{tpl.category}</span>
                  {tplSteps.length} 個步驟 · {tpl.description || ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="btn btn-sm btn-primary" style={{ padding: '6px 14px' }} onClick={() => onDeploy(tpl)}>
                  <Rocket size={13} /> 部署
                </button>
                {onDelete && <TemplateMenu tpl={tpl} onDelete={onDelete} />}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
