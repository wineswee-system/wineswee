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
 *   - 紅框會「持續顯示」直到使用者改該欄位（onChange 配合 clearError）
 *   - 抖動動畫只跑一次（CSS 控制，0.5 秒）
 *
 * @param {HTMLElement} [opts.scrollContainer]  限定 scrollIntoView 搜尋範圍
 *                                              （給 modal 用，避免找到背後其他 form 的錯欄）
 */
export function validateRequired(form, requiredKeys, setErrors, opts = {}) {
  const { zeroInvalid = false, scrollToFirst = true, scrollContainer } = opts
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
      // 等下一個 frame DOM 更新完再滾；限定範圍避免找錯
      setTimeout(() => {
        const root = scrollContainer || document
        const firstError = root.querySelector('.field-error')
        if (firstError && typeof firstError.scrollIntoView === 'function') {
          firstError.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 50)
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
