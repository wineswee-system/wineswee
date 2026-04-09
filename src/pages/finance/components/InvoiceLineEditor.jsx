import { Plus, Trash2 } from 'lucide-react'
import { calculateInvoiceTax } from '../../../lib/einvoice'

const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`
const TAX_TYPES = ['應稅', '零稅率', '免稅']

function calcItemAmount(item) {
  return Math.round((item.qty || 0) * (item.unit_price || 0))
}

function SkuSelect({ value, onChange, skus }) {
  return (
    <select className="form-input" style={{ width: '100%' }} value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">-- 選擇品項 --</option>
      {skus.map(s => (
        <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
      ))}
    </select>
  )
}

export default function InvoiceLineEditor({ lines, updateFn, addFn, removeFn, skuSelectFn, totalsObj, skus, label = '發票明細' }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <label style={{ fontWeight: 600, fontSize: 14 }}>{label}</label>
        <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={addFn}>
          <Plus size={12} /> 新增品項
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', border: '1px solid var(--border-color)', borderRadius: 8 }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)' }}>
              <th style={{ padding: '8px', textAlign: 'left', minWidth: 150 }}>品項 (SKU)</th>
              <th style={{ padding: '8px', textAlign: 'left', minWidth: 120 }}>品項名稱 *</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 70 }}>數量</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 100 }}>單價</th>
              <th style={{ padding: '8px', textAlign: 'center', width: 100 }}>稅別</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 100 }}>金額</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 80 }}>稅額</th>
              <th style={{ padding: '8px', width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((li, idx) => {
              const amt = calcItemAmount(li)
              const { taxAmount } = calculateInvoiceTax(
                [{ description: li.product, qty: li.qty, unitPrice: li.unit_price }],
                li.tax_type
              )
              return (
                <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '4px 8px' }}>
                    <SkuSelect value={li.sku_id} onChange={(v) => skuSelectFn(idx, v)} skus={skus} />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input className="form-input" type="text" style={{ width: '100%' }} placeholder="品項名稱" value={li.product} onChange={e => updateFn(idx, 'product', e.target.value)} />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input className="form-input" type="number" style={{ width: '100%', textAlign: 'right' }} min={1} value={li.qty} onChange={e => updateFn(idx, 'qty', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input className="form-input" type="number" style={{ width: '100%', textAlign: 'right' }} min={0} value={li.unit_price} onChange={e => updateFn(idx, 'unit_price', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <select className="form-input" style={{ width: '100%' }} value={li.tax_type} onChange={e => updateFn(idx, 'tax_type', e.target.value)}>
                      {TAX_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>
                    {fmt(amt)}
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                    {fmt(taxAmount)}
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    <button type="button" onClick={() => removeFn(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <div style={{ minWidth: 240, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span>小計：</span><span>{fmt(totalsObj.subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span>稅額：</span><span>{fmt(totalsObj.tax)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '2px solid var(--border-color)', fontWeight: 700, fontSize: 15 }}>
            <span>總計：</span><span>{fmt(totalsObj.grandTotal)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
