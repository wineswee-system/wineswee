import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { commitExpenseDraft } from '../../../lib/commitBindingDraft'
import { toast } from '../../../lib/toast'
import ExpenseFormDraft from './ExpenseFormDraft'

// 費用申請「即時送出」內嵌元件 — 給任務面板「建立後再填」(FillFormModal / SelfFillQueue)用。
// 複用 ExpenseFormDraft（表單 + 擷取）+ commitExpenseDraft（落地），填完直接開單。
//
// props: { bindingId, onClose, onDone }
export default function ExpenseRequestCreate({ bindingId, onClose, onDone }) {
  const { profile } = useAuth()
  const [saving, setSaving] = useState(false)

  const handleCapture = async (draft) => {
    if (saving) return
    setSaving(true)
    try {
      await commitExpenseDraft(bindingId, draft, profile)
      toast.success('已送出申請！')
      onDone?.()
    } catch (err) {
      toast.error('送出失敗：' + (err.message || '未知錯誤'))
      setSaving(false)
    }
  }

  return <ExpenseFormDraft onCapture={handleCapture} onClose={() => onClose?.()} busy={saving} />
}
