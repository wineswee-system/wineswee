import { useEffect } from 'react'
import { ModalOverlay } from '../Modal'
import CustomFormFill from '../../pages/workflow/CustomFormFill'
import ExpenseRequestCreate from '../../pages/workflow/components/ExpenseRequestCreate'
import ExpenseSimpleCreate from '../../pages/workflow/components/ExpenseSimpleCreate'
import EmbeddedSettleModal from './EmbeddedSettleModal'
import { bindingFillPath } from './bindingFillUrl'

/**
 * FillFormModal — 在任務面板內直接填寫綁定表單（原生內嵌彈窗，不用 iframe）
 *
 * - form_submission（自訂表單）→ 內嵌 CustomFormFill。
 * - expense_request / expense_apply（費用申請）→ 內嵌 ExpenseRequestCreate（自包含原生表單）。
 * - 其他重型（經常性費用 / 調撥 / 稽核 / 各驗收段）→ 暫時開頁（待逐一改成原生內嵌）。
 *
 * props:
 *  - binding:  { id, form_type, form_template_id, form_label, form_id }
 *  - bindings: 同任務全部綁定（驗收段判斷申請段是否完成）
 *  - onClose():  關閉
 *  - onDone():   送出成功後 caller reload
 */
const NATIVE_EXPENSE = new Set(['expense_request', 'expense_apply'])

export default function FillFormModal({ binding, bindings = [], onClose, onDone }) {
  const isCustom = binding?.form_type === 'form_submission'
  const isNativeExpense = !!binding && NATIVE_EXPENSE.has(binding.form_type) && !binding.form_id
  const isSimpleExpense = !!binding && binding.form_type === 'expense' && !binding.form_id  // 經常性費用報銷 → 內嵌填
  const isSettleEmbed = !!binding && binding.form_type === 'expense_settle' && !!binding.form_id
  const isHeavyOpenPage = !!binding && !isCustom && !isNativeExpense && !isSimpleExpense && !isSettleEmbed

  // 重型(經常性費用/調撥/稽核/驗收段)→ 開頁;副作用必須在 effect 內(不可在 render 階段)
  useEffect(() => {
    if (!isHeavyOpenPage) return
    const url = bindingFillPath(binding, bindings)
    if (url) window.open(url, '_blank')
    onClose?.()
  }, [isHeavyOpenPage]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!binding) return null

  const close = () => onClose?.()
  const done = () => { onClose?.(); onDone?.() }

  // ── 自訂表單：inline CustomFormFill ──
  if (isCustom) {
    return (
      <ModalOverlay onClose={close}>
        <div className="modal-shell modal-lg" style={{ animation: 'fadeIn 0.15s ease', display: 'flex', flexDirection: 'column' }}>
          <div className="modal-shell-header">
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>填寫表單：{binding.form_label || '表單'}</h3>
            <button onClick={close} aria-label="Close"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, flexShrink: 0, fontSize: 18, lineHeight: 1 }}>✕</button>
          </div>
          <div className="modal-shell-body" style={{ padding: 20 }}>
            <CustomFormFill templateId={binding.form_template_id} bindingId={binding.id} embedded onClose={done} />
          </div>
        </div>
      </ModalOverlay>
    )
  }

  // ── 費用驗收段（已綁申請單）：inline EmbeddedSettleModal，不開新分頁 ──
  if (isSettleEmbed) {
    return <EmbeddedSettleModal binding={binding} onClose={close} onDone={done} />
  }

  // ── 非經常性費用申請：原生內嵌（ExpenseRequestCreate 自帶 ModalOverlay）──
  if (isNativeExpense) {
    return <ExpenseRequestCreate bindingId={binding.id} onClose={close} onDone={done} />
  }

  // ── 經常性費用報銷：原生內嵌（ExpenseSimpleCreate 自帶 Modal）──
  if (isSimpleExpense) {
    return <ExpenseSimpleCreate bindingId={binding.id} onClose={close} onDone={done} />
  }

  // ── 其他重型：由上面的 useEffect 開頁,這裡不渲染 ──
  return null
}
