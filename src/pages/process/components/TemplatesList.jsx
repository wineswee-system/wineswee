import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Rocket, Tag, MoreVertical, Trash2 } from 'lucide-react'

function TemplateMenu({ tpl, onDelete }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (btnRef.current?.contains(e.target)) return
      if (menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = (e) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      // 寬度 140，右對齊到按鈕右緣
      setPos({ top: r.bottom + 4, left: r.right - 140 })
    }
    setOpen(v => !v)
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', borderRadius: 4 }}
      >
        <MoreVertical size={16} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
            background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
            borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', minWidth: 140, padding: 4,
          }}
        >
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
        </div>,
        document.body
      )}
    </>
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
