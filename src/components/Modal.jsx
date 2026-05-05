import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export default function Modal({ title, onClose, children, onSubmit, submitLabel = '儲存', submitDisabled = false, maxWidth = 640 }) {
  const modalRef = useRef(null)
  const previousFocusRef = useRef(null)

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    previousFocusRef.current = document.activeElement
    // 防止背景滾動
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus()
      }
    }
  }, [])

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'var(--bg-modal-overlay)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          borderRadius: 16,
          width: '100%', maxWidth,
          maxHeight: 'calc(100vh - 48px)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          animation: 'fadeIn 0.15s ease',
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {children}
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button className="btn btn-secondary" onClick={onClose}>{onSubmit ? '取消' : '關閉'}</button>
          {onSubmit && (
            <button className="btn btn-primary" onClick={onSubmit} disabled={submitDisabled}
              style={submitDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
              {submitLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

export function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}

/**
 * 通用 Modal Overlay — 給 inline modal 用的 Portal wrapper
 * 用法：<ModalOverlay onClose={fn}><div>你的 modal 內容</div></ModalOverlay>
 */
export function ModalOverlay({ onClose, children, zIndex = 10000 }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const handleKey = (e) => { if (e.key === 'Escape' && onClose) onClose() }
    document.addEventListener('keydown', handleKey)
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', handleKey) }
  }, [onClose])

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex,
      background: 'var(--bg-modal-overlay)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }} onMouseDown={e => { if (e.target === e.currentTarget && onClose) onClose() }}>
      {children}
    </div>,
    document.body
  )
}
