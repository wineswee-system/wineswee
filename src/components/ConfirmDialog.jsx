import { useEffect, useState } from 'react'
import Modal from './Modal'
import { _registerConfirmState, _resolveConfirm } from '../lib/confirm'

/**
 * Mount 一次在 App 根，監聽全域 confirm() 呼叫，渲染 Modal
 * 使用者實際呼叫的是 lib/confirm.js 的 confirm()
 */
export default function ConfirmDialog() {
  const [state, setState] = useState({ open: false })

  useEffect(() => {
    _registerConfirmState(setState)
  }, [])

  if (!state.open) return null

  return (
    <Modal
      title={state.title || '確認'}
      onClose={() => _resolveConfirm(false)}
      onSubmit={() => _resolveConfirm(true)}
      submitLabel={state.confirmLabel || '確定'}
      maxWidth={420}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {state.message && (
          <div style={{
            fontSize: 14,
            color: state.danger ? 'var(--accent-red)' : 'var(--text-primary)',
            fontWeight: state.danger ? 600 : 500,
            whiteSpace: 'pre-wrap',
          }}>
            {state.danger && <span style={{ marginRight: 6 }}>⚠️</span>}
            {state.message}
          </div>
        )}
        {state.description && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
            {state.description}
          </div>
        )}
      </div>
    </Modal>
  )
}
