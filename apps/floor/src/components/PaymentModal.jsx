import { useState } from 'react'
import { completePayment } from '../lib/posDb'
import { printReceipt, openCashDrawer } from '../lib/sunmiPrint'
import { useAuth } from '../contexts/AuthContext'
import { useStore } from '../contexts/StoreContext'

const METHODS = [
  { key: 'cash',     label: '現金',     icon: '💵' },
  { key: 'card',     label: '信用卡',   icon: '💳' },
  { key: 'line_pay', label: 'LINE Pay', icon: '🟢' },
  { key: 'jkopay',   label: '街口支付', icon: '🔵' },
  { key: 'other',    label: '其他',     icon: '🔁' },
]

const CARRIER_TYPES = [
  { key: '',        label: '不需要發票',    placeholder: '',               pattern: null },
  { key: '3J0002',  label: '手機條碼',      placeholder: '/XXXXXXX',       pattern: /^\/[A-Z0-9+\-.]{7}$/ },
  { key: 'CQ0001',  label: '自然人憑證',    placeholder: 'XX00000000000000', pattern: /^[A-Z]{2}[0-9]{14}$/ },
  { key: 'ECA0001', label: '悠遊卡/一卡通', placeholder: '卡號',            pattern: /^.{8,}$/ },
]

// Steps: review → method → amount → carrier → processing → done
export default function PaymentModal({ order, table, items, onClose, onPaid }) {
  const { employee } = useAuth()
  const { storeId }  = useStore()
  const orgId = employee?.organization_id

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  const taxAmt   = Math.round(subtotal * 0.05 / 1.05)

  const [splitMode,   setSplitMode]   = useState(false)
  const [splitCount,  setSplitCount]  = useState(2)
  const [splitIdx,    setSplitIdx]    = useState(0)

  const [step,        setStep]        = useState('review')
  const [method,      setMethod]      = useState('')
  const [received,    setReceived]    = useState('')
  const [carrierType, setCarrierType] = useState('')
  const [carrierId,   setCarrierId]   = useState('')
  const [carrierErr,  setCarrierErr]  = useState('')
  const [lastPay,     setLastPay]     = useState(null)
  const [error,       setError]       = useState('')

  const splitTotal  = splitMode ? splitCount : 1
  const payAmount   = splitMode ? Math.ceil((subtotal / splitCount) * 100) / 100 : subtotal

  function validateCarrier() {
    if (!carrierType) return true
    const ct = CARRIER_TYPES.find(c => c.key === carrierType)
    if (ct?.pattern && !ct.pattern.test(carrierId.trim())) {
      setCarrierErr(`格式錯誤（範例: ${ct.placeholder}）`)
      return false
    }
    return true
  }

  async function handleConfirm() {
    if (!validateCarrier()) return
    setStep('processing')
    setError('')

    const { data: payment, error: payErr } = await completePayment({
      orderId: order.id, storeId, orgId, employeeId: employee?.id,
      amount: payAmount, method,
      carrierType: carrierType || null,
      carrierId: carrierId.trim() || null,
      splitIndex: splitIdx + 1, splitTotal,
    })

    if (payErr) {
      setError(`付款失敗：${payErr.message}`)
      setStep('carrier')
      return
    }

    setLastPay(payment)
    if (method === 'cash') openCashDrawer()

    await printReceipt({
      storeName: '', order, table, items, payment,
      received: method === 'cash' ? parseFloat(received) || 0 : 0,
    })

    if (splitMode && splitIdx < splitCount - 1) {
      setSplitIdx(i => i + 1)
      setMethod(''); setReceived(''); setCarrierType(''); setCarrierId('')
      setStep('method')
    } else {
      setStep('done')
      onPaid?.(payment)
    }
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const overlay = {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  const card = {
    background: '#fff', borderRadius: 16, padding: 28,
    width: 380, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 18,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  }
  const btnStyle = (color = '#0891b2', disabled = false) => ({
    background: disabled ? '#e2e8f0' : color,
    color: disabled ? '#9ca3af' : '#fff',
    border: 'none', borderRadius: 10, padding: '13px 0',
    fontSize: 15, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer', width: '100%',
  })
  const inp = {
    width: '100%', background: '#f1f5f9', border: '1px solid #e2e8f0',
    borderRadius: 8, color: '#111827', padding: '10px 12px',
    fontSize: 15, outline: 'none', boxSizing: 'border-box',
  }

  // ── REVIEW ──────────────────────────────────────────────────────────────────
  if (step === 'review') return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose?.()}>
      <div style={card}>
        <TitleBar title="確認訂單" order={order} onClose={onClose} />

        <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map(i => (
            <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#374151' }}>
              <span>{i.name} ×{i.quantity}</span>
              <span>${(i.unit_price * i.quantity).toLocaleString()}</span>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <TRow label="小計" value={`$${subtotal.toLocaleString()}`} />
          <TRow label="稅額 (含稅 5%)" value={`$${taxAmt.toLocaleString()}`} muted />
          <TRow label="合計" value={`$${subtotal.toLocaleString()}`} bold />
        </div>

        <div style={{ background: '#f8fafc', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>分帳結帳</span>
            <Toggle on={splitMode} onChange={setSplitMode} />
          </div>
          {splitMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: '#6b7280' }}>均分</span>
              <SmBtn onClick={() => setSplitCount(c => Math.max(2, c - 1))}>−</SmBtn>
              <span style={{ fontSize: 16, fontWeight: 700, minWidth: 24, textAlign: 'center' }}>{splitCount}</span>
              <SmBtn onClick={() => setSplitCount(c => Math.min(10, c + 1))}>+</SmBtn>
              <span style={{ fontSize: 13, color: '#6b7280' }}>人</span>
              <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: '#0891b2' }}>
                每人 ${Math.ceil(subtotal / splitCount).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        <button style={btnStyle()} onClick={() => setStep('method')}>選擇付款方式 →</button>
      </div>
    </div>
  )

  // ── METHOD ──────────────────────────────────────────────────────────────────
  if (step === 'method') return (
    <div style={overlay}>
      <div style={card}>
        <TitleBar
          title={splitMode ? `付款方式（第 ${splitIdx + 1}/${splitCount} 位）` : '付款方式'}
          order={order}
          sub={`合計: $${payAmount.toLocaleString()}`}
          onClose={onClose}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {METHODS.map(m => (
            <button key={m.key}
              onClick={() => { setMethod(m.key); setStep('amount') }}
              style={{ background: '#f1f5f9', border: '2px solid #e2e8f0', borderRadius: 12, padding: '18px 0', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 28 }}>{m.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{m.label}</span>
            </button>
          ))}
        </div>
        <button style={btnStyle('#6b7280')} onClick={() => setStep('review')}>← 返回</button>
      </div>
    </div>
  )

  // ── AMOUNT ──────────────────────────────────────────────────────────────────
  if (step === 'amount') {
    const isCash = method === 'cash'
    const cashOk = !isCash || (received !== '' && parseFloat(received) >= payAmount)
    return (
      <div style={overlay}>
        <div style={card}>
          <TitleBar title={isCash ? '現金付款' : '確認付款'} order={order} onClose={onClose} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>應付金額</div>
            <div style={{ fontSize: 38, fontWeight: 800, color: '#111827' }}>${payAmount.toLocaleString()}</div>
          </div>
          {isCash ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>收到金額</label>
              <input type="number" value={received}
                onChange={e => setReceived(e.target.value)}
                style={inp} placeholder="輸入收到金額" autoFocus />
              {received !== '' && parseFloat(received) >= payAmount && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#f0fdf4', borderRadius: 8 }}>
                  <span style={{ fontSize: 15, color: '#16a34a', fontWeight: 600 }}>找零</span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: '#16a34a' }}>
                    ${(parseFloat(received) - payAmount).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: 16, background: '#eff6ff', borderRadius: 10, textAlign: 'center', fontSize: 14, color: '#1e40af' }}>
              請於{method === 'card' ? '刷卡機' : '掃描 QR'}完成付款後，點擊確認
            </div>
          )}
          <button style={btnStyle('#0891b2', !cashOk)} disabled={!cashOk} onClick={() => setStep('carrier')}>
            {isCash ? '確認收款 →' : '已完成付款 →'}
          </button>
          <button style={btnStyle('#6b7280')} onClick={() => setStep('method')}>← 返回</button>
        </div>
      </div>
    )
  }

  // ── CARRIER ─────────────────────────────────────────────────────────────────
  if (step === 'carrier') {
    const selCT = CARRIER_TYPES.find(c => c.key === carrierType)
    return (
      <div style={overlay}>
        <div style={card}>
          <TitleBar title="電子發票" order={order} onClose={onClose} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {CARRIER_TYPES.map(ct => (
              <button key={ct.key}
                onClick={() => { setCarrierType(ct.key); setCarrierId(''); setCarrierErr('') }}
                style={{
                  background: carrierType === ct.key ? '#e0f2fe' : '#f1f5f9',
                  border: `2px solid ${carrierType === ct.key ? '#0891b2' : '#e2e8f0'}`,
                  borderRadius: 10, padding: '12px 16px', cursor: 'pointer', textAlign: 'left',
                  fontSize: 14, fontWeight: carrierType === ct.key ? 700 : 400,
                  color: carrierType === ct.key ? '#0369a1' : '#374151',
                }}>
                {ct.label}
              </button>
            ))}
          </div>
          {carrierType && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{selCT?.label} 號碼</label>
              <input type="text" value={carrierId}
                onChange={e => { setCarrierId(e.target.value.toUpperCase()); setCarrierErr('') }}
                placeholder={selCT?.placeholder}
                style={{ ...inp, borderColor: carrierErr ? '#ef4444' : '#e2e8f0' }}
                autoCapitalize="characters" />
              {carrierErr && <span style={{ fontSize: 12, color: '#ef4444' }}>{carrierErr}</span>}
            </div>
          )}
          {error && <div style={{ padding: '10px 14px', background: '#fef2f2', borderRadius: 8, fontSize: 13, color: '#dc2626' }}>{error}</div>}
          <button style={btnStyle()} onClick={handleConfirm}>確認付款並開立發票</button>
          <button style={btnStyle('#6b7280')} onClick={() => setStep('amount')}>← 返回</button>
        </div>
      </div>
    )
  }

  // ── PROCESSING ───────────────────────────────────────────────────────────────
  if (step === 'processing') return (
    <div style={overlay}>
      <div style={card}>
        <div style={{ textAlign: 'center', padding: '40px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <Spinner />
          <div style={{ fontSize: 16, color: '#374151' }}>處理中…</div>
        </div>
      </div>
    </div>
  )

  // ── DONE ─────────────────────────────────────────────────────────────────────
  return (
    <div style={overlay}>
      <div style={card}>
        <div style={{ textAlign: 'center', padding: '16px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 52 }}>✅</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>付款完成</div>
          <div style={{ fontSize: 14, color: '#6b7280' }}>收據已列印</div>
        </div>
        <button style={btnStyle()} onClick={onClose}>關閉</button>
        <button
          style={{ background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%' }}
          onClick={() => printReceipt({ storeName: '', order, table, items, payment: lastPay, received: method === 'cash' ? parseFloat(received) : 0 })}>
          🖨 重印收據
        </button>
      </div>
    </div>
  )
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function TitleBar({ title, order, sub, onClose }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>{title}</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
          {sub ?? (order?.order_number ? `訂單 #${order.order_number}` : '')}
        </div>
      </div>
      {onClose && (
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1 }}>×</button>
      )}
    </div>
  )
}

function TRow({ label, value, bold, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: bold ? 16 : 14 }}>
      <span style={{ color: muted ? '#9ca3af' : '#6b7280' }}>{label}</span>
      <span style={{ fontWeight: bold ? 800 : 500, color: bold ? '#111827' : '#374151' }}>{value}</span>
    </div>
  )
}

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
      background: on ? '#0891b2' : '#d1d5db', position: 'relative', transition: 'background 0.2s',
    }}>
      <span style={{
        position: 'absolute', top: 3, left: on ? 22 : 3,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  )
}

function SmBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{
      width: 32, height: 32, borderRadius: 8, border: '1px solid #e2e8f0',
      background: '#fff', cursor: 'pointer', fontSize: 18, lineHeight: 1,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151',
    }}>
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <>
      <div style={{ width: 44, height: 44, border: '4px solid #e2e8f0', borderTopColor: '#0891b2', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </>
  )
}
