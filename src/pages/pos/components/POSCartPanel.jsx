import { Plus, Minus, Trash2, ShoppingCart, CreditCard } from 'lucide-react'

export default function POSCartPanel({
  cart,
  updateQty,
  removeFromCart,
  subtotal,
  discount,
  setDiscount,
  tax,
  total,
  selectedPayment,
  setSelectedPayment,
  cashTendered,
  setCashTendered,
  changeAmount,
  carrierType,
  setCarrierType,
  carrierValue,
  setCarrierValue,
  handleCheckout,
  paymentMethodMap,
}) {
  return (
    <div style={{ flex: '1 1 40%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ marginBottom: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="card-header">
          <div className="card-title"><ShoppingCart size={16} style={{ marginRight: 6 }} /> 購物車 ({cart.reduce((s, c) => s + c.qty, 0)})</div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
          {cart.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>購物車是空的</div>
          )}
          {cart.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-primary)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>NT$ {c.price} x {c.qty}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => updateQty(c.id, -1)} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', borderRadius: 6, padding: '2px 6px', cursor: 'pointer', color: 'var(--text-primary)' }}><Minus size={12} /></button>
                <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 600 }}>{c.qty}</span>
                <button onClick={() => updateQty(c.id, 1)} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', borderRadius: 6, padding: '2px 6px', cursor: 'pointer', color: 'var(--text-primary)' }}><Plus size={12} /></button>
                <button onClick={() => removeFromCart(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: '2px 4px' }}><Trash2 size={14} /></button>
              </div>
              <div style={{ minWidth: 80, textAlign: 'right', fontWeight: 600 }}>NT$ {(c.price * c.qty).toLocaleString()}</div>
            </div>
          ))}
        </div>

        {/* Totals & Payment */}
        <div style={{ padding: 16, borderTop: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', borderRadius: '0 0 12px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
            <span>小計</span><span>NT$ {subtotal.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: 13 }}>
            <span>折扣</span>
            <input
              type="number" min={0} value={discount}
              onChange={e => setDiscount(Math.max(0, Number(e.target.value)))}
              style={{ width: 80, textAlign: 'right', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: 6, padding: '2px 8px', color: 'var(--text-primary)', fontSize: 13 }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
            <span>稅金 (5%)</span><span>NT$ {tax.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18, margin: '12px 0', color: 'var(--accent-cyan)' }}>
            <span>合計</span><span>NT$ {total.toLocaleString()}</span>
          </div>

          {/* Payment method selection */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
              <CreditCard size={12} style={{ marginRight: 4, verticalAlign: -1 }} /> 付款方式
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {paymentMethodMap.map(m => (
                <button
                  key={m.code}
                  onClick={() => setSelectedPayment(m.code)}
                  style={{
                    flex: '1 1 auto',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: selectedPayment === m.code ? '2px solid var(--accent-cyan)' : '1px solid var(--border-primary)',
                    background: selectedPayment === m.code ? 'var(--accent-cyan-dim)' : 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontWeight: selectedPayment === m.code ? 700 : 400,
                    cursor: 'pointer',
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                  }}
                >
                  <span>{m.icon}</span> {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Cash tendered input */}
          {selectedPayment === 'cash' && (
            <div style={{ marginBottom: 10, background: 'var(--bg-primary)', borderRadius: 8, padding: 10, border: '1px solid var(--border-primary)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>收現金額</div>
              <input
                type="number"
                className="form-input"
                placeholder="輸入收到的現金金額"
                value={cashTendered}
                onChange={e => setCashTendered(e.target.value)}
                style={{ width: '100%', fontSize: 18, fontWeight: 700, textAlign: 'right', marginBottom: 4 }}
              />
              {cashTendered && Number(cashTendered) >= total && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, color: 'var(--accent-orange)' }}>
                  <span>找零</span><span>NT$ {changeAmount.toLocaleString()}</span>
                </div>
              )}
              {/* Quick cash buttons */}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {[100, 500, 1000].map(v => (
                  <button key={v} onClick={() => setCashTendered(String(v))} style={{
                    flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid var(--border-primary)',
                    background: 'var(--bg-tertiary)', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600,
                  }}>
                    ${v}
                  </button>
                ))}
                <button onClick={() => setCashTendered(String(total))} style={{
                  flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid var(--accent-cyan)',
                  background: 'var(--accent-cyan-dim)', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600,
                }}>
                  剛好
                </button>
              </div>
            </div>
          )}

          {/* E-Invoice carrier */}
          <div style={{ marginBottom: 10, background: 'var(--bg-primary)', borderRadius: 8, padding: 10, border: '1px solid var(--border-primary)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>電子發票載具</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: carrierType !== 'none' ? 8 : 0 }}>
              {[
                { value: 'none', label: '無' },
                { value: 'phone_barcode', label: '手機條碼' },
                { value: 'natural_person', label: '自然人憑證' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setCarrierType(opt.value); setCarrierValue('') }}
                  style={{
                    flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12,
                    border: carrierType === opt.value ? '2px solid var(--accent-cyan)' : '1px solid var(--border-primary)',
                    background: carrierType === opt.value ? 'var(--accent-cyan-dim)' : 'transparent',
                    color: 'var(--text-primary)', cursor: 'pointer', fontWeight: carrierType === opt.value ? 600 : 400,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {carrierType !== 'none' && (
              <input
                type="text"
                className="form-input"
                placeholder={carrierType === 'phone_barcode' ? '輸入手機條碼 (例: /ABC1234)' : '輸入自然人憑證號碼'}
                value={carrierValue}
                onChange={e => setCarrierValue(e.target.value)}
                style={{ width: '100%', fontSize: 13 }}
              />
            )}
          </div>

          <button
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px 0', fontSize: 16, fontWeight: 700 }}
            onClick={handleCheckout}
            disabled={cart.length === 0}
          >
            結帳 — NT$ {total.toLocaleString()}
          </button>
        </div>
      </div>
    </div>
  )
}
