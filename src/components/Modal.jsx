import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import Spinner from './Spinner'

export default function Modal({ title, onClose, children, onSubmit, submitLabel = '儲存', submitDisabled = false, maxWidth = 640, headerExtra = null }) {
  const modalRef = useRef(null)
  const previousFocusRef = useRef(null)
  const [submitting, setSubmitting] = useState(false)

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const submittingRef = useRef(false)
  submittingRef.current = submitting

  useEffect(() => {
    previousFocusRef.current = document.activeElement
    // 防止背景滾動
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !submittingRef.current) onCloseRef.current()
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

  // submit 包裝：支援 sync / async，提交中按鈕 disable + 顯示 spinner，
  // 防重複點擊；submitting 期間 ESC、backdrop click、cancel 全擋掉
  const handleSubmit = async () => {
    if (submitting || submitDisabled || !onSubmit) return
    setSubmitting(true)
    try {
      await onSubmit()
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    if (submitting) return
    onClose()
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'var(--bg-modal-overlay)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }} onMouseDown={e => { if (e.target === e.currentTarget) handleClose() }}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-busy={submitting}
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
          <button onClick={handleClose} aria-label="Close" disabled={submitting}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.4 : 1, padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        {headerExtra && (
          <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, background: 'var(--bg-secondary)' }}>
            {headerExtra}
          </div>
        )}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1, minHeight: 0, position: 'relative' }}>
          {children}
          {submitting && (
            <div aria-hidden="true" style={{
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.04)',
              backdropFilter: 'blur(1px)', WebkitBackdropFilter: 'blur(1px)',
              cursor: 'wait', pointerEvents: 'all',
            }} />
          )}
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button className="btn btn-secondary" onClick={handleClose} disabled={submitting}
            style={submitting ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
            {onSubmit ? '取消' : '關閉'}
          </button>
          {onSubmit && (
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitDisabled || submitting}
              style={(submitDisabled || submitting) ? { opacity: 0.6, cursor: 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 6 } : { display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {submitting && <Spinner size={12} color="#fff" />}
              {submitting ? '處理中…' : submitLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/**
 * Field — 表單欄位包裝
 * @param {boolean} [error]   true 時加 .field-error class（紅框 + 抖動 + label 變紅）
 * @param {string}  [errorMsg] 錯誤訊息（顯示在欄位下方）
 */
export function Field({ label, children, error, errorMsg }) {
  return (
    <div className={error ? 'field-error' : undefined}>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
      {error && errorMsg && <div className="field-error-msg">⚠ {errorMsg}</div>}
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
