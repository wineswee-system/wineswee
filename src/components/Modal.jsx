import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCircle2 } from 'lucide-react'
import Spinner from './Spinner'
import { confirm } from '../lib/confirm'

/**
 * Modal — 表單對話框
 *
 * @param {string|object} [successMessage] 送出成功後顯示的訊息。
 *   - 傳 string → 顯示「✓ <字串>」綠色 success state，3 秒自動關閉
 *   - 傳 object → { title, hint, autoCloseMs } 完整客製
 *   - 不傳 → 維持舊行為（submit 完直接關 modal，由呼叫端自己用 toast）
 *
 * @param {number|string} [maxWidth] modal 寬度上限。
 *   - 'sm' (400) / 'md' (560) / 'lg' (760) / 'xl' (960) / 'full'
 *   - 或直接給 number (px) — 會自動套用 min(maxWidth, 95vw) fluid 公式
 *   - 預設 'md'（560px）
 */
// 寬度語意 → CSS class 名稱（會去拿 index.css 的 .modal-shell.modal-* 規則）
const SIZE_TO_CLASS = { sm: 'modal-sm', md: '', lg: 'modal-lg', xl: 'modal-xl', full: 'modal-full' }

export default function Modal({
  title, onClose, children,
  onSubmit, submitLabel = '儲存', submitDisabled = false,
  maxWidth = 'md', headerExtra = null,
  successMessage = null,
  isDirty = false,
}) {
  const modalRef = useRef(null)
  const previousFocusRef = useRef(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(null)  // null | { title, hint }

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const submittingRef = useRef(false)
  submittingRef.current = submitting
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty

  useEffect(() => {
    previousFocusRef.current = document.activeElement
    // 防止背景滾動
    document.body.style.overflow = 'hidden'

    const handleKeyDown = async (e) => {
      if (e.key === 'Escape' && !submittingRef.current) {
        if (isDirtyRef.current) {
          const ok = await confirm({ title: '有未儲存的變更', message: '關閉後，未儲存的變更將遺失。', confirmLabel: '關閉', cancelLabel: '繼續編輯', danger: true })
          if (!ok) return
        }
        onCloseRef.current()
      }
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
  // 若有傳 successMessage，submit 成功後自動切到 success state 並倒數關閉
  const handleSubmit = async () => {
    if (submitting || submitDisabled || !onSubmit) return
    setSubmitting(true)
    let result
    try {
      result = await onSubmit()
    } finally {
      setSubmitting(false)
    }
    // submit 完成後若有 successMessage → 顯示綠色 success state，N 秒後 auto close
    // 呼叫端可以從 onSubmit 回傳 false 取消（例如驗證失敗已自行 toast 過）
    if (successMessage && result !== false) {
      const successConf = typeof successMessage === 'string'
        ? { title: '已送出', hint: successMessage, autoCloseMs: 2500 }
        : { title: '已送出', autoCloseMs: 2500, ...successMessage }
      setSuccess(successConf)
      setTimeout(() => {
        setSuccess(null)
        onCloseRef.current?.()
      }, successConf.autoCloseMs)
    }
  }

  const handleClose = async () => {
    if (submitting) return
    if (isDirty) {
      const ok = await confirm({ title: '有未儲存的變更', message: '關閉後，未儲存的變更將遺失。', confirmLabel: '關閉', cancelLabel: '繼續編輯', danger: true })
      if (!ok) return
    }
    onClose()
  }

  // 寬度策略：string → CSS class；number → inline style 套 min() 公式
  const isStringSize = typeof maxWidth === 'string'
  const sizeClass = isStringSize ? (SIZE_TO_CLASS[maxWidth] ?? '') : ''
  const numericStyle = !isStringSize && typeof maxWidth === 'number'
    ? { width: `min(${maxWidth}px, calc(100vw - 32px))` }
    : null

  return createPortal(
    <div className="modal-overlay-root" style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'var(--bg-modal-overlay)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'clamp(8px, 2vw, 24px)',
    }} onMouseDown={e => { if (e.target === e.currentTarget) handleClose() }}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-busy={submitting}
        aria-label={title}
        className={`modal-shell ${sizeClass}`.trim()}
        style={{
          ...(numericStyle || {}),
          animation: 'fadeIn 0.15s ease',
        }}>
        {/* HEADER：固定不縮 */}
        <div className="modal-shell-header">
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h3>
          <button onClick={handleClose} aria-label="Close" disabled={submitting}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.4 : 1, padding: 4, flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>
        {headerExtra && (
          <div style={{ flexShrink: 0, padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
            {headerExtra}
          </div>
        )}
        {/* BODY：拿剩餘空間，內容過多自己 scroll */}
        <div className="modal-shell-body">
          {success ? (
            <SuccessState title={success.title} hint={success.hint} />
          ) : (
            <>
              {children}
              {submitting && (
                <div aria-hidden="true" style={{
                  position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.04)',
                  backdropFilter: 'blur(1px)', WebkitBackdropFilter: 'blur(1px)',
                  cursor: 'wait', pointerEvents: 'all',
                }} />
              )}
            </>
          )}
        </div>
        {!success && (
          <div className="modal-shell-footer">
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
        )}
      </div>
    </div>,
    document.body
  )
}

/**
 * Field — 表單欄位包裝
 * @param {boolean} [error]   true 時加 .field-error class（紅框 + 抖動 + label 變紅）
 * @param {string}  [errorMsg] 錯誤訊息（顯示在欄位下方）
 * @param {boolean} [required] true 時 label 後加紅色 *（廠商反映「必填欄位要明確」）
 * @param {string}  [hint]     label 旁的灰字提示（例：「選填」、「最多 200 字」）
 */
export function Field({ label, children, error, errorMsg, required, hint }) {
  return (
    <div className={error ? 'field-error' : undefined}>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
        <span>{label}</span>
        {required && <span style={{ color: 'var(--accent-red)', fontWeight: 700 }} aria-label="必填">*</span>}
        {hint && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400, opacity: 0.7 }}>· {hint}</span>}
      </label>
      {children}
      {error && errorMsg && <div className="field-error-msg">⚠ {errorMsg}</div>}
    </div>
  )
}

/**
 * SuccessState — Modal 內的「已送出」綠色全屏狀態
 * 廠商反映：送出後沒有明確的「已送出」反饋，user 不知道有沒有成功
 */
function SuccessState({ title = '已送出', hint }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: '40px 24px',
      animation: 'fadeIn 0.2s ease',
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: 'var(--accent-green-dim)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <CheckCircle2 size={48} color="var(--accent-green)" strokeWidth={2.5} />
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-green)' }}>{title}</div>
      {hint && <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6 }}>{hint}</div>}
    </div>
  )
}

/**
 * 通用 Modal Overlay — 給 inline modal 用的 Portal wrapper
 * 用法：<ModalOverlay onClose={fn}><div>你的 modal 內容</div></ModalOverlay>
 */
export function ModalOverlay({ onClose, children, zIndex = 10000, isDirty = false }) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const handleKey = async (e) => {
      if (e.key !== 'Escape' || !onCloseRef.current) return
      if (isDirtyRef.current) {
        const ok = await confirm({ title: '有未儲存的變更', message: '關閉後，未儲存的變更將遺失。', confirmLabel: '關閉', cancelLabel: '繼續編輯', danger: true })
        if (!ok) return
      }
      onCloseRef.current()
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', handleKey) }
  }, [])

  const guardedClose = async () => {
    if (!onCloseRef.current) return
    if (isDirtyRef.current) {
      const ok = await confirm({ title: '有未儲存的變更', message: '關閉後，未儲存的變更將遺失。', confirmLabel: '關閉', cancelLabel: '繼續編輯', danger: true })
      if (!ok) return
    }
    onCloseRef.current()
  }

  return createPortal(
    <div className="modal-overlay-root" style={{
      position: 'fixed', inset: 0, zIndex,
      background: 'var(--bg-modal-overlay)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'clamp(8px, 2vw, 24px)',
    }} onMouseDown={e => { if (e.target === e.currentTarget) guardedClose() }}>
      {children}
    </div>,
    document.body
  )
}
