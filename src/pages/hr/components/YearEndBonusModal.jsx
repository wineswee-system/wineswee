import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Modal, { Field } from '../../../components/Modal'
import { toast } from '../../../lib/toast'
import { confirm } from '../../../lib/confirm'
import { useAuth } from '../../../contexts/AuthContext'

// Props: open, onClose, runs, onComplete
export default function YearEndBonusModal({ open, onClose, runs, onComplete }) {
  const { profile } = useAuth()
  const [yearEndYear, setYearEndYear] = useState(new Date().getFullYear())
  const [yearEndMonths, setYearEndMonths] = useState('')  // 空字串=用 salary_structures 預設
  const [generatingYearEnd, setGeneratingYearEnd] = useState(false)

  const handleGenerateYearEnd = async () => {
    if (!yearEndYear) return
    if (!(await confirm({ message: `確定產生 ${yearEndYear} 年度年終獎金結算？\n${yearEndMonths ? `所有員工統一給 ${yearEndMonths} 個月` : '依員工 salary_structures 各自的設定計算'}\n\n注意：同年度只能跑一次，重跑需先刪除既有 run。` }))) return
    setGeneratingYearEnd(true)
    try {
      const { data, error } = await supabase.rpc('generate_year_end_bonus', {
        p_year: yearEndYear,
        p_months_override: yearEndMonths ? Number(yearEndMonths) : null,
        p_created_by: profile?.id ?? null,
      })
      if (error) throw error
      const result = data?.[0] || data
      toast.error(`年終獎金結算完成！\n發放 ${result?.records_created || 0} 人，總金額 NT$ ${(result?.total_amount || 0).toLocaleString()}`)
      onComplete()
      onClose()
    } catch (err) {
      console.error('Year-end bonus failed:', err)
      toast.error('結算失敗：' + (err.message || '未知錯誤'))
    } finally {
      setGeneratingYearEnd(false)
    }
  }

  if (!open) return null

  return (
    <Modal title="年終獎金結算" onClose={onClose} onSubmit={handleGenerateYearEnd} submitLabel={generatingYearEnd ? '結算中...' : '產生年終獎金'}>
      <Field label="年度">
        <input className="form-input" type="number" value={yearEndYear} onChange={e => setYearEndYear(Number(e.target.value))} min="2020" max="2099" />
      </Field>
      <Field label="統一月數覆寫（空白=用各員工 salary_structures 設定）">
        <input className="form-input" type="number" step="0.5" value={yearEndMonths} onChange={e => setYearEndMonths(e.target.value)} placeholder="例：1.5" />
      </Field>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: 12, borderRadius: 8, lineHeight: 1.6 }}>
        <b>計算方式：</b>每員工年終 = base_salary × 月數<br />
        <b>稅務：</b>使用月度扣繳級距計算所得稅<br />
        <b>二代健保：</b>累計年度獎金超過月投保 4 倍門檻時，超出部分扣 2.11%<br />
        <b>注意：</b>同年度只能跑 1 次（pay_period='YYYY-13'），重跑需先刪除既有 run<br />
        <b>對象：</b>當年度在職 + 當年度離職員工
      </div>
    </Modal>
  )
}
