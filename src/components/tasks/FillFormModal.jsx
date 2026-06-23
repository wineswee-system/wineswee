import { ModalOverlay } from '../Modal'
import CustomFormFill from '../../pages/workflow/CustomFormFill'

/**
 * FillFormModal — 在任務面板內直接填寫綁定表單（不開新分頁）
 *
 * Phase 1：只支援 form_submission（自訂表單）→ 內嵌 CustomFormFill。
 * 重型表單（費用 / 調撥 / 稽核）目前仍由 caller 走 navTo 開頁，Phase 2 再用 iframe inline。
 *
 * props:
 *  - binding: { id, form_type, form_template_id, form_label }
 *  - onClose():    關閉（取消 / ESC / 背景點擊）
 *  - onDone():     送出成功後 caller reload 用（送出成功會先呼叫 onClose 再 onDone）
 */
export default function FillFormModal({ binding, onClose, onDone }) {
  if (!binding) return null

  if (binding.form_type !== 'form_submission') {
    // 防呆：非自訂表單不該進這裡（caller 應走 navTo），直接關閉
    onClose?.()
    return null
  }

  const handleClose = () => {
    onClose?.()
  }

  return (
    <ModalOverlay onClose={handleClose}>
      <div
        className="modal-shell modal-lg"
        style={{ animation: 'fadeIn 0.15s ease', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal-shell-header">
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
            填寫表單：{binding.form_label || '自訂表單'}
          </h3>
          <button onClick={handleClose} aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, flexShrink: 0, fontSize: 18, lineHeight: 1 }}>
            ✕
          </button>
        </div>
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
