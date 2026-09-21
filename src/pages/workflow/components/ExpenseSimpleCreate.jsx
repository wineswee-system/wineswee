import { useAuth } from '../../../contexts/AuthContext'
import { commitSimpleExpenseDraft } from '../../../lib/commitBindingDraft'
import { toast } from '../../../lib/toast'
import ExpenseSimpleDraft from './ExpenseSimpleDraft'

// 經常性費用報銷「即時送出」內嵌元件 — 給任務面板綁定表單「去填寫」用（取代開新分頁）。
// 複用 ExpenseSimpleDraft（自帶 Modal + empId）+ commitSimpleExpenseDraft（落地，已含 org/employee_id）。
//
// props: { bindingId, onClose, onDone }
export default function ExpenseSimpleCreate({ bindingId, onClose, onDone }) {
  const { profile } = useAuth()

  const handleCapture = async (draft) => {
    try {
      await commitSimpleExpenseDraft(bindingId, draft, profile)
      toast.success('已送出報銷！')
      onDone?.()
    } catch (err) {
      toast.error('送出失敗：' + (err.message || '未知錯誤'))
    }
  }

  return <ExpenseSimpleDraft onCapture={handleCapture} onClose={() => onClose?.()} />
}
