import Modal, { Field } from '../../../components/Modal'
import InvoiceLineEditor from './InvoiceLineEditor'

import { fmtNT as fmt } from '../../../lib/currency'
const CARRIER_TYPES = ['手機條碼', '自然人憑證', '無']

export default function InvoiceFormModal({
  form, set, formError, lineItems, totals, skus, currencies,
  updateLineItem, addLineItem, removeLineItem, handleSkuSelect,
  handleAutoNumber, handleCurrencyChange, handleSubmit,
  onClose,
}) {
  return (
    <Modal title="開立發票" onClose={onClose} onSubmit={handleSubmit} width={820}>
      {formError && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--accent-red-dim)', color: 'var(--accent-red)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
          {formError}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="發票號碼" required>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="AB12345678" value={form.invoice_number} onChange={e => set('invoice_number', e.target.value)} />
            <button type="button" className="btn btn-primary" style={{ fontSize: 11, padding: '4px 8px', whiteSpace: 'nowrap' }} onClick={handleAutoNumber}>
              自動產生
            </button>
          </div>
        </Field>
        <Field label="開立日期">
          <input className="form-input" type="date" style={{ width: '100%' }} value={form.invoice_date} onChange={e => set('invoice_date', e.target.value)} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="買受人" required>
          <input className="form-input" type="text" style={{ width: '100%' }} placeholder="買受人名稱" value={form.buyer_name} onChange={e => set('buyer_name', e.target.value)} />
        </Field>
        <Field label="統一編號">
          <input className="form-input" type="text" style={{ width: '100%' }} placeholder="12345678 (8碼)" value={form.buyer_tax_id} onChange={e => set('buyer_tax_id', e.target.value)} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="載具類型">
          <select className="form-input" style={{ width: '100%' }} value={form.carrier_type} onChange={e => set('carrier_type', e.target.value)}>
            {CARRIER_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="訂單參考">
          <input className="form-input" type="text" style={{ width: '100%' }} placeholder="SO-001" value={form.order_ref} onChange={e => set('order_ref', e.target.value)} />
        </Field>
      </div>

      {/* Currency Selection */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="幣別">
          <select className="form-input" style={{ width: '100%' }} value={form.currency} onChange={e => handleCurrencyChange(e.target.value)}>
            {currencies.map(c => (
              <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
            ))}
          </select>
        </Field>
        {form.currency !== 'NTD' && (
          <Field label={`匯率 (1 ${form.currency} = ? NTD)`}>
            <input className="form-input" type="number" step="0.0001" min="0" style={{ width: '100%' }} value={form.exchange_rate} onChange={e => set('exchange_rate', e.target.value)} />
          </Field>
        )}
      </div>

      <InvoiceLineEditor
        lines={lineItems}
        updateFn={updateLineItem}
        addFn={addLineItem}
        removeFn={removeLineItem}
        skuSelectFn={handleSkuSelect}
        totalsObj={totals}
        skus={skus}
      />

      {form.currency !== 'NTD' && (
        <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--accent-cyan)', fontWeight: 600, marginTop: 4 }}>
          NTD 等值: {fmt(Math.round(totals.grandTotal * (parseFloat(form.exchange_rate) || 1)))}
        </div>
      )}
    </Modal>
  )
}
