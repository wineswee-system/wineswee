import { useState } from 'react'
import { supabase } from '../lib/supabase'

const STATUS_LABEL = {
  pending:   '待確認',
  confirmed: '已確認',
  seated:    '已入座',
  completed: '已完成',
  cancelled: '已取消',
  no_show:   '未到場',
}

const STATUS_COLOR = {
  pending:   '#f97316',
  confirmed: '#3b82f6',
  seated:    '#0891b2',
  completed: '#22c55e',
  cancelled: '#888',
  no_show:   '#ef4444',
}

export default function LookupPage() {
  const [phone, setPhone]           = useState('')
  const [code, setCode]             = useState('')
  const [loading, setLoading]       = useState(false)
  const [booking, setBooking]       = useState(null)
  const [storeName, setStoreName]   = useState('')
  const [notFound, setNotFound]     = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelled, setCancelled]   = useState(false)
  const [error, setError]           = useState('')

  async function lookup(e) {
    e.preventDefault()
    setLoading(true)
    setBooking(null)
    setNotFound(false)
    setError('')
    setCancelled(false)

    const { data, error: qErr } = await supabase
      .from('reservations')
      .select('*')
      .eq('guest_phone', phone.trim())
      .eq('confirmation_code', code.trim().toUpperCase())
      .maybeSingle()

    setLoading(false)
    if (qErr || !data) { setNotFound(true); return }
    setBooking(data)

    supabase.from('stores').select('name').eq('id', data.store_id).maybeSingle()
      .then(({ data: s }) => setStoreName(s?.name ?? ''))
  }

  async function cancel() {
    if (!booking) return
    setCancelling(true)
    setError('')
    const { error: uErr } = await supabase
      .from('reservations')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', booking.id)
      .eq('confirmation_code', booking.confirmation_code)
    setCancelling(false)
    if (uErr) { setError(uErr.message); return }
    setCancelled(true)
    setBooking(prev => ({ ...prev, status: 'cancelled' }))
  }

  const canCancel = booking &&
    !['cancelled', 'completed', 'seated', 'no_show'].includes(booking.status) &&
    !cancelled

  return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 64 }}>
      <div style={{ width: '100%', background: '#fff', borderBottom: '1px solid #e5e5e0', padding: '20px 24px' }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a' }}>線上訂位</span>
      </div>

      <div style={{ width: '100%', maxWidth: 480, marginTop: 48 }}>
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 2px 12px #0002', padding: 32, marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>查詢 / 取消訂位</h2>

          <form onSubmit={lookup} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="手機號碼">
              <input placeholder="0912-345-678" value={phone}
                onChange={e => setPhone(e.target.value)}
                required style={INPUT} />
            </Field>
            <Field label="確認碼">
              <input placeholder="ABC123" value={code}
                onChange={e => setCode(e.target.value)}
                required maxLength={6}
                style={{ ...INPUT, letterSpacing: 4, textTransform: 'uppercase', fontWeight: 700, fontSize: 18 }} />
            </Field>
            <button type="submit" disabled={loading || !phone || !code}
              style={{ ...BTN, opacity: (loading || !phone || !code) ? 0.5 : 1, marginTop: 4 }}>
              {loading ? '查詢中…' : '查詢'}
            </button>
          </form>

          {notFound && (
            <div style={{ marginTop: 20, padding: '12px 16px', background: '#fff5f5', borderRadius: 8, color: '#e53e3e', fontSize: 14 }}>
              查無訂位資料，請確認手機號碼及確認碼是否正確。
            </div>
          )}
        </div>

        {booking && (
          <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 2px 12px #0002', padding: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>訂位資訊</h3>
              <span style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                background: (STATUS_COLOR[booking.status] ?? '#888') + '22',
                color: STATUS_COLOR[booking.status] ?? '#888',
              }}>
                {STATUS_LABEL[booking.status] ?? booking.status}
              </span>
            </div>

            {storeName && <SummaryRow label="餐廳" value={storeName} />}
            <SummaryRow label="日期" value={booking.reservation_date} />
            <SummaryRow label="時段" value={`${booking.reservation_time?.slice(0, 5)} 起，${booking.duration_hours} 小時`} />
            <SummaryRow label="人數" value={`${booking.party_size} 人`} />
            <SummaryRow label="訂位人" value={booking.guest_name} />
            {booking.special_requests && <SummaryRow label="備註" value={booking.special_requests} />}

            {cancelled && (
              <div style={{ marginTop: 20, padding: '12px 16px', background: '#f0fff4', borderRadius: 8, color: '#16a34a', fontSize: 14, fontWeight: 600 }}>
                訂位已取消。
              </div>
            )}

            {error && (
              <div style={{ marginTop: 20, padding: '12px 16px', background: '#fff5f5', borderRadius: 8, color: '#e53e3e', fontSize: 14 }}>
                {error}
              </div>
            )}

            {canCancel && (
              <button onClick={cancel} disabled={cancelling}
                style={{ ...BTN, marginTop: 24, background: '#fee2e2', color: '#dc2626', opacity: cancelling ? 0.6 : 1 }}>
                {cancelling ? '取消中…' : '取消此訂位'}
              </button>
            )}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: '#888' }}>
          <a href="/" style={{ color: '#0891b2', textDecoration: 'none' }}>← 回到訂位首頁</a>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  )
}

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f0f0ec', fontSize: 14 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ fontWeight: 600, color: '#111' }}>{value}</span>
    </div>
  )
}

const INPUT = {
  width: '100%', padding: '10px 12px', border: '1px solid #e0e0da',
  borderRadius: 8, fontSize: 15, outline: 'none', background: '#fafaf8',
  boxSizing: 'border-box',
}
const BTN = {
  padding: '13px 0', background: '#0891b2', color: '#fff',
  border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700,
  cursor: 'pointer', width: '100%',
}
