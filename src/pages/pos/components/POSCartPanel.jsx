import { useState } from 'react'
import { Plus, Minus, Trash2, ShoppingCart, CreditCard, Search, User, X } from 'lucide-react'

export default function POSCartPanel({
  cart,
  updateQty,
  updateItemType,
  removeFromCart,
  orderNote,
  setOrderNote,
  subtotal,
  discount,
  setDiscount,
  pointsUsed,
  setPointsUsed,
  pointsDiscount,
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
  selectedMember,
  onMemberSearch,
  onMemberClear,
}) {
  const [memberQuery, setMemberQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [notFound, setNotFound] = useState(false)

  async function handleMemberSearch() {
    if (!memberQuery.trim()) return
    setSearching(true)
    setNotFound(false)
    const found = await onMemberSearch(memberQuery)
    setSearching(false)
    if (!found) setNotFound(true)
    else setMemberQuery('')
  }
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
            <div key={c.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
              {/* Per-item dine-in / takeout toggle */}
              <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                {[{ key: 'dine_in', label: '內用' }, { key: 'takeout', label: '外帶' }].map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => updateItemType(c.id, opt.key)}
                    style={{
                      padding: '2px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                      border: c.order_type === opt.key ? '1px solid var(--accent-cyan)' : '1px solid var(--border-primary)',
                      background: c.order_type === opt.key ? 'var(--accent-cyan-dim)' : 'transparent',
                      color: c.order_type === opt.key ? 'var(--accent-cyan)' : 'var(--text-muted)',
                      fontWeight: c.order_type === opt.key ? 700 : 400,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Member Lookup */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-primary)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <User size={12} /> 會員識別
          </div>
          {selectedMember ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--accent-cyan-dim)', border: '1px solid var(--accent-cyan)', borderRadius: 8, padding: '8px 12px' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent-cyan)' }}>{selectedMember.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {selectedMember.level} · 點數 {(selectedMember.available_points || 0).toLocaleString()} · 累計消費 NT$ {((selectedMember.lifetime_spend || selectedMember.total_spent || 0)).toLocaleString()}
                  </div>
                </div>
                <button onClick={onMemberClear} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                  <X size={14} />
                </button>
              </div>
              {(selectedMember.available_points || 0) > 0 && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    折抵點數（1點 = NT$0.5，可用 {(selectedMember.available_points || 0).toLocaleString()} 點）
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="number" min={0} max={selectedMember.available_points || 0} step={1}
                      value={pointsUsed}
                      onChange={e => setPointsUsed(Math.min(Math.max(0, Math.floor(Number(e.target.value) || 0)), selectedMember.available_points || 0))}
                      style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 6, padding: '4px 8px', color: 'var(--text-primary)', fontSize: 12, textAlign: 'right' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>點</span>
                    <button
                      onClick={() => setPointsUsed(selectedMember.available_points || 0)}
                      style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--accent-cyan)', background: 'var(--accent-cyan-dim)', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 11, whiteSpace: 'nowrap' }}
                    >
                      全部折抵
                    </button>
                    {pointsUsed > 0 && (
                      <button onClick={() => setPointsUsed(0)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11 }}>
                        清除
                      </button>
                    )}
                  </div>
                  {pointsUsed > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--accent-cyan)', marginTop: 4 }}>
                      折抵金額：NT$ {pointsDiscount.toLocaleString()}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  placeholder="輸入電話 / 會員編號後按 Enter"
                  value={memberQuery}
                  onChange={e => { setMemberQuery(e.target.value); setNotFound(false) }}
                  onKeyDown={e => e.key === 'Enter' && handleMemberSearch()}
                  style={{ flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 12 }}
                />
                <button
                  onClick={handleMemberSearch}
                  disabled={searching || !memberQuery.trim()}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}
                >
                  {searching ? '…' : <Search size={13} />}
                </button>
              </div>
              {notFound && <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}>找不到會員，以一般顧客結帳</div>}
            </div>
          )}
        </div>

        {/* Order note */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-primary)' }}>
          <textarea
            rows={2}
            placeholder="備註（例：不加冰、少糖）"
            value={orderNote}
            onChange={e => setOrderNote(e.target.value)}
            style={{
              width: '100%', resize: 'none', boxSizing: 'border-box',
              background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
              borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)',
              fontSize: 12, lineHeight: 1.5,
            }}
          />
        </div>

        {/* Totals & Payment */}
        <div style={{ padding: 16, borderTop: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', borderRadius: '0 0 12px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
            <span>小計</span><span>NT$ {subtotal.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: 13 }}>
            <span>手動折扣</span>
            <input
              type="number" min={0} value={discount}
              onChange={e => setDiscount(Math.max(0, Number(e.target.value)))}
              style={{ width: 80, textAlign: 'right', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: 6, padding: '2px 8px', color: 'var(--text-primary)', fontSize: 13 }}
            />
          </div>
          {pointsUsed > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, color: 'var(--accent-cyan)' }}>
              <span>點數折抵 ({pointsUsed.toLocaleString()}點)</span>
              <span>- NT$ {pointsDiscount.toLocaleString()}</span>
            </div>
          )}
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
