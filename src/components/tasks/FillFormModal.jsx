import { useEffect } from 'react'
import { ModalOverlay } from '../Modal'
import CustomFormFill from '../../pages/workflow/CustomFormFill'
import { embeddedFillPath } from './bindingFillUrl'

/**
 * FillFormModal — 在任務面板內直接填寫綁定表單（不開新分頁）
 *
 * - form_submission（自訂表單）→ 內嵌 CustomFormFill（輕量、真 inline）。
 * - 重型表單（費用 / 調撥 / 稽核 / 各申請·驗收段）→ 用 iframe 以 ?embedded=1 載入該頁，
 *   該頁送出成功後 postMessage('binding_fill_done') → 本元件關閉 + reload。
 *
 * props:
 *  - binding:  { id, form_type, form_template_id, form_label, form_id }
 *  - bindings: 同任務全部綁定（重型「驗收段」需判斷申請段是否完成）
 *  - onClose():  關閉
 *  - onDone():   送出成功後 caller reload
 */
export default function FillFormModal({ binding, bindings = [], onClose, onDone }) {
  const isCustom = binding && binding.form_type === 'form_submission'
  const iframeSrc = !isCustom && binding ? embeddedFillPath(binding, bindings) : null

  // 監聽重型 iframe 的送出成功訊息
  useEffect(() => {
    if (isCustom || !iframeSrc) return
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === 'binding_fill_done') {
        onClose?.()
        onDone?.()
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [isCustom, iframeSrc, onClose, onDone])

  if (!binding) return null

  const header = (
    <div className="modal-shell-header">
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
        填寫表單：{binding.form_label || '表單'}
      </h3>
      <button onClick={() => onClose?.()} aria-label="Close"
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, flexShrink: 0, fontSize: 18, lineHeight: 1 }}>
        ✕
      </button>
    </div>
  )

  // ── 自訂表單：inline CustomFormFill ──
  if (isCustom) {
    return (
      <ModalOverlay onClose={() => onClose?.()}>
        <div className="modal-shell modal-lg" style={{ animation: 'fadeIn 0.15s ease', display: 'flex', flexDirection: 'column' }}>
          {header}
          <div className="modal-shell-body" style={{ padding: 20 }}>
            <CustomFormFill
              templateId={binding.form_template_id}
              bindingId={binding.id}
              embedded
              onClose={() => { onClose?.(); onDone?.() }}
            />
          </div>
        </div>
      </ModalOverlay>
    )
  }

  // ── 重型表單：無法導頁（例如驗收段尚被鎖）→ 提示後關閉 ──
  if (!iframeSrc) {
    onClose?.()
    return null
  }

  // ── 重型表單：iframe inline ──
  return (
    <ModalOverlay onClose={() => onClose?.()}>
      <div className="modal-shell modal-xl" style={{ animation: 'fadeIn 0.15s ease', display: 'flex', flexDirection: 'column', height: 'min(88vh, 900px)' }}>
        {header}
        <div className="modal-shell-body" style={{ padding: 0, flex: 1, minHeight: 0 }}>
          <iframe
            title={`填寫：${binding.form_label || ''}`}
            src={iframeSrc}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          />
        </div>
      </div>
    </ModalOverlay>
  )
}
