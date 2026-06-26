import { useState } from 'react'
import { Plus, Minus, Trash2, ShoppingCart, CreditCard, Search, User, X, Tag } from 'lucide-react'

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
  availableCoupons = [],
  selectedCoupon = null,
  onCouponSelect,
  couponsLoading = false,
  couponDiscount = 0,
  paymentSplits = [],
  onPaymentSplitsChange = () => {},
  onUpdateItemCourse = () => {},
}) {
  const [memberQuery, setMemberQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [splitMode, setSplitMode] = useState(false)

  const roundedTotal = Math.round(total)
  const roundingAdj = roundedTotal - total

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
                  <button
                    onClick={() => onUpdateItemCourse(c.id, (c.course || 1) % 3 + 1)}
                    title="切換上菜輪次"
                    style={{ marginLeft: 6, fontSize: 11, padding: '2px 6px',
                             background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)',
                             border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                    輪{c.course || 1}
                  </button>
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
            {/* Coupon picker */}
            <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Tag size={11} /> 可用優惠券 {couponsLoading ? '…' : `(${availableCoupons.length})`}
              </div>
              {availableCoupons.length === 0 && !couponsLoading && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>無可用優惠券</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {availableCoupons.map(ca => {
                  const isSel = selectedCoupon?.id === ca.id
                  const notQualified = (ca.coupons?.min_purchase || 0) > 0 && subtotal < (ca.coupons?.min_purchase || 0)
                  return (
                    <button
                      key={ca.id}
                      onClick={() => onCouponSelect(isSel ? null : ca)}
                      style={{
                        textAlign: 'left', padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                        border: isSel ? '1px solid var(--accent-green)' : '1px solid var(--border-primary)',
                        background: isSel ? 'var(--accent-green-dim)' : 'transparent',
                        color: notQualified && !isSel ? 'var(--text-muted)' : isSel ? 'var(--accent-green)' : 'var(--text-secondary)',
                        opacity: notQualified && !isSel ? 0.6 : 1,
                      }}
                    >
                      <strong>{ca.coupons?.code}</strong> {ca.coupons?.name}
                      {ca.coupons?.type === 'pct_off'   && ` — ${ca.coupons.value}% OFF`}
                      {ca.coupons?.type === 'fixed_off' && ` — 折抵 NT$${Number(ca.coupons.value).toLocaleString()}`}
                      {notQualified && ` (需滿 NT$${Number(ca.coupons?.min_purchase).toLocaleString()})`}
                    </button>
                  )
                })}
              </div>
            </div>
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
          {selectedCoupon && couponDiscount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, color: 'var(--accent-green)' }}>
              <span>優惠券 ({selectedCoupon.coupons?.code})</span>
              <span>- NT$ {couponDiscount.toLocaleString()}</span>
            </div>
          )}
          {pointsUsed > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, color: 'var(--accent-cyan)' }}>
              <span>點數折抵 ({pointsUsed.toLocaleString()}點)</span>
              <span>- NT$ {pointsDiscount.toLocaleString()}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
            <span>稅金 (5%)</span><span>NT$ {tax.toLocaleString()}</span>
          </div>
          {Math.abs(roundingAdj) >= 0.01 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12,
                          color: 'var(--text-muted)', marginBottom: 2 }}>
              <span>四捨五入</span>
              <span>{roundingAdj > 0 ? '+' : ''}{roundingAdj.toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18, margin: '12px 0', color: 'var(--accent-cyan)' }}>
            <span>合計</span><span>NT$ {roundedTotal.toLocaleString()}</span>
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
            {selectedMember?.credit_balance > 0 && (
              <button
                onClick={() => setSelectedPayment('house_account')}
                style={{
                  marginTop: 6,
                  padding: '8px 14px',
                  background: selectedPayment === 'house_account' ? 'var(--accent-purple-dim)' : 'var(--bg-secondary)',
                  color: selectedPayment === 'house_account' ? 'var(--accent-purple)' : 'var(--text-secondary)',
                  border: `1px solid ${selectedPayment === 'house_account' ? 'var(--accent-purple)' : 'var(--border-primary)'}`,
                  borderRadius: 8,
                  cursor: selectedMember.credit_balance >= roundedTotal ? 'pointer' : 'not-allowed',
                  opacity: selectedMember.credit_balance >= roundedTotal ? 1 : 0.5,
                  fontSize: 13, width: '100%',
                }}>
                掛帳 (餘額 NT${selectedMember.credit_balance})
              </button>
            )}
            {selectedPayment === 'house_account' && selectedMember?.credit_balance < roundedTotal && (
              <div style={{ fontSize: 12, color: 'var(--accent-red)', marginTop: 4 }}>
                餘額不足，差 NT${roundedTotal - selectedMember.credit_balance}
              </div>
            )}
            {/* Split Payment Toggle */}
            <button
              onClick={() => { setSplitMode(v => !v); onPaymentSplitsChange([]) }}
              style={{ marginTop: 8, fontSize: 12, padding: '4px 10px',
                       background: splitMode ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
                       color: splitMode ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                       border: '1px solid var(--border-primary)', borderRadius: 6, cursor: 'pointer' }}>
              分帳付款
            </button>
            {splitMode && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {paymentSplits.map((split, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <select value={split.method} onChange={e => {
                      const next = [...paymentSplits]; next[i] = { ...split, method: e.target.value }
                      onPaymentSplitsChange(next)
                    }} style={{ flex: 1, padding: '4px 8px', background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-primary)', borderRadius: 6,
                                color: 'var(--text-primary)' }}>
                      {paymentMethodMap.map(m => (
                        <option key={m.code} value={m.code}>{m.label}</option>
                      ))}
                    </select>
                    <input type="number" value={split.amount} min={0}
                      onChange={e => {
                        const next = [...paymentSplits]; next[i] = { ...split, amount: Number(e.target.value) }
                        onPaymentSplitsChange(next)
                      }}
                      style={{ width: 90, padding: '4px 8px', background: 'var(--bg-secondary)',
                               border: '1px solid var(--border-primary)', borderRadius: 6,
                               color: 'var(--text-primary)', textAlign: 'right' }}
                    />
                    <button onClick={() => onPaymentSplitsChange(paymentSplits.filter((_, j) => j !== i))}
                      style={{ padding: '4px 8px', background: 'var(--accent-red-dim)', color: 'var(--accent-red)',
                               border: 'none', borderRadius: 6, cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
                <button onClick={() => onPaymentSplitsChange([...paymentSplits, { method: paymentMethodMap[0]?.code || 'cash', amount: 0 }])}
                  style={{ alignSelf: 'flex-start', fontSize: 12, padding: '4px 10px',
                           background: 'var(--bg-hover)', border: '1px solid var(--border-primary)',
                           borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  ＋ 新增付款方式
                </button>
                {(() => {
                  const splitsTotal = paymentSplits.reduce((s, p) => s + p.amount, 0)
                  const remaining = roundedTotal - splitsTotal
                  return remaining !== 0 && (
                    <div style={{ fontSize: 12, color: remaining > 0 ? 'var(--accent-orange)' : 'var(--accent-red)' }}>
                      {remaining > 0 ? `尚差 NT$${remaining}` : `超出 NT$${Math.abs(remaining)}`}
                    </div>
                  )
                })()}
              </div>
            )}
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
            結帳 — NT$ {roundedTotal.toLocaleString()}
          </button>
        </div>
      </div>
    </div>
  )
}
