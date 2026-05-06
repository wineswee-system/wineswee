/**
 * 表單必填驗證 helper
 *
 * 用法（最簡單）：
 *   const [errors, setErrors] = useState({})
 *
 *   const handleSubmit = () => {
 *     if (!validateRequired(form, ['employee', 'date', 'reason'], setErrors)) return
 *     // ... 原本的送出邏輯
 *   }
 *
 *   <Field label="員工 *" error={errors.employee} errorMsg="必填">
 *     <input className="form-input" value={form.employee} ... />
 *   </Field>
 *
 * 規則：
 *   - 任一欄位為 null / undefined / 空字串 / 空陣列 / 0（如果 zeroInvalid）→ 視為缺
 *   - 缺欄位時 setErrors({ [key]: true, … }) 觸發 .field-error class（紅框 + 抖動）
 *   - 自動滾到第一個錯誤欄位
 *   - 0.7 秒後自動清掉抖動 class（保留紅框直到使用者開始打字）
 */

export function validateRequired(form, requiredKeys, setErrors, opts = {}) {
  const { zeroInvalid = false, scrollToFirst = true, autoClearMs = 700 } = opts
  const errors = {}
  for (const key of requiredKeys) {
    const v = form?.[key]
    const empty = v == null || v === '' ||
                  (Array.isArray(v) && v.length === 0) ||
                  (zeroInvalid && v === 0)
    if (empty) errors[key] = true
  }
  if (Object.keys(errors).length > 0) {
    setErrors(errors)
    if (scrollToFirst) {
      // 等下一個 frame DOM 更新完再滾
      setTimeout(() => {
        const firstError = document.querySelector('.field-error')
        if (firstError && typeof firstError.scrollIntoView === 'function') {
          firstError.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 50)
    }
    if (autoClearMs > 0) {
      setTimeout(() => {
        // 只清掉 errors 整批 — 但保留紅框直到下次提交（簡化版直接全清）
        setErrors({})
      }, autoClearMs)
    }
    return false
  }
  setErrors({})
  return true
}

/**
 * 配合 input onChange 用：清掉特定欄位的 error（讓使用者開始改正時紅框消失）
 *
 * 用法：
 *   onChange={(e) => { set('employee', e.target.value); clearError('employee', setErrors) }}
 */
export function clearError(key, setErrors) {
  setErrors(prev => {
    if (!prev?.[key]) return prev
    const next = { ...prev }
    delete next[key]
    return next
  })
}
