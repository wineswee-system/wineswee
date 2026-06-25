import { useRef } from 'react'
import { X, Upload, FileText, Image } from 'lucide-react'
import { ModalOverlay } from '../../../components/Modal'
import { clearError } from '../../../lib/formValidation'

// 對齊 ExpenseRequests.jsx 的 CURRENCY_SYMBOL；request.currency 可能是 USD/JPY/EUR/CNY
const CURRENCY_SYMBOL = { TWD: 'NT$', USD: 'US$', JPY: '¥', CNY: '¥', EUR: '€', NZD: 'NZ$', AUD: 'A$' }
const fmt = (n, cur) => {
  if (n == null) return '-'
  const sym = CURRENCY_SYMBOL[cur] || (cur ?? 'NT$')
  return `${sym} ${Number(n).toLocaleString()}`
}

/**
 * SettleModal — settle/reimburse modal.
 *
 * Props:
 *   open           boolean
 *   onClose        () => void
 *   request        object        the expense_request row being settled
 *   settleForm     object        { actual_amount, notes }
 *   setSettleForm  updater fn
 *   settleFiles    File[]
 *   setSettleFiles updater fn
 *   onSubmit       () => void
 *   saving         boolean
 *   errors         object
 *   setErrors      updater fn
 */
export default function SettleModal({
  open, onClose,
  request,
  settleForm, setSettleForm,
  settleFiles, setSettleFiles,
  onSubmit, saving, errors, setErrors,
  settleVerb = '核銷',   // 費用='核銷(驗收)'；叫貨='驗收'
}) {
  if (!open || !request) return null

  const settleFileRef = useRef(null)
  const vb = settleVerb === '驗收' ? '驗收' : '核銷(驗收)'

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="modal-shell"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-shell-header">
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{vb}：{request.title}</h3>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', flexShrink: 0 }} onClick={onClose}><X size={20} /></button>
        </div>

        {/* Body */}
        <div className="modal-shell-body">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
            預估金額：<strong>{fmt(request.estimated_amount, request.currency)}</strong>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Actual amount */}
            <div className={errors.actual_amount ? 'field-error' : undefined}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>實際金額 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              <input
                type="number"
                value={settleForm.actual_amount}
                onChange={e => { setSettleForm(f => ({ ...f, actual_amount: e.target.value })); clearError('actual_amount', setErrors) }}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}
              />
              {errors.actual_amount && <div className="field-error-msg">⚠ 請填寫實際金額</div>}
            </div>

            {/* Notes */}
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>備註</label>
              <textarea
                value={settleForm.notes}
                onChange={e => setSettleForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="選填"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', minHeight: 60, resize: 'vertical' }}
              />
            </div>

            {/* Receipt upload */}
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>收據/發票附件</label>
              <input
                ref={settleFileRef}
                type="file"
                multiple
                accept="image/*,.pdf"
                onChange={e => setSettleFiles(prev => [...prev, ...Array.from(e.target.files)])}
                style={{ display: 'none' }}
              />
              <button className="btn btn-secondary" onClick={() => settleFileRef.current?.click()} style={{ fontSize: 12 }}>
                <Upload size={12} /> 上傳收據
              </button>
              {settleFiles.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {settleFiles.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                      {f.type?.startsWith('image') ? <Image size={12} /> : <FileText size={12} />}
                      {f.name}
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}
                        onClick={() => setSettleFiles(prev => prev.filter((_, j) => j !== i))}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-shell-footer">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={saving}>{saving ? '提交中...' : `提交${vb}`}</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
