import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const STEP_LABELS = ['選擇時間', '填寫資料', '確認訂位']

function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export default function BookingPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)

  // Step 0
  const [stores, setStores] = useState([])
  const [storeId, setStoreId] = useState('')
  const [date, setDate] = useState('')
  const [partySize, setPartySize] = useState(2)
  const [duration, setDuration] = useState(1)
  const [slots, setSlots] = useState([])
  const [slot, setSlot] = useState('')
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [rules, setRules] = useState(null)

  // Step 1
  const [guestName, setGuestName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [requests, setRequests] = useState('')

  // Step 2
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('stores')
      .select('id, name, phone')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data?.length) {
          setStores(data)
          setStoreId(data[0].id)
        }
      })
  }, [])

  useEffect(() => {
    if (!storeId) return
    supabase
      .from('reservation_rules')
      .select('*')
      .eq('store_id', storeId)
      .is('day_of_week', null)
      .is('date_override', null)
      .maybeSingle()
      .then(({ data }) => setRules(data))
  }, [storeId])

  const today = new Date()
  const minDate = today.toISOString().slice(0, 10)
  const maxDate = rules
    ? new Date(today.getTime() + rules.max_advance_days * 86400000)
        .toISOString()
        .slice(0, 10)
    : ''

  useEffect(() => {
    if (!storeId || !date || !partySize || !duration) { setSlots([]); return }
    setLoadingSlots(true)
    setSlot('')
    supabase
      .rpc('get_available_slots', {
        p_store_id: storeId,
        p_date: date,
        p_party_size: partySize,
        p_duration_hours: duration,
      })
      .then(({ data, error: e }) => {
        setSlots(e ? [] : (data || []))
        setLoadingSlots(false)
      })
  }, [storeId, date, partySize, duration])

  async function submit() {
    setSubmitting(true)
    setError('')
    const code = genCode()
    const { error: e } = await supabase.from('reservations').insert({
      store_id: storeId,
      reservation_date: date,
      reservation_time: slot,
      party_size: partySize,
      duration_hours: duration,
      guest_name: guestName,
      guest_phone: phone,
      guest_email: email || null,
      special_requests: requests || null,
      confirmation_code: code,
      status: 'pending',
    })
    setSubmitting(false)
    if (e) { setError(e.message); return }
    navigate('/confirm', {
      state: { code, date, slot, partySize, duration, guestName, storeId, stores },
    })
  }

  const maxParty = rules?.max_party_size ?? 10
  const maxHours = rules?.max_booking_hours ?? 3
  const minHours = rules?.min_booking_hours ?? 1

  return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 64 }}>
      <div style={{ width: '100%', background: '#fff', borderBottom: '1px solid #e5e5e0', padding: '20px 24px' }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a' }}>線上訂位</span>
      </div>

      <div style={{ display: 'flex', gap: 0, marginTop: 32, marginBottom: 32, background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px #0001', overflow: 'hidden' }}>
        {STEP_LABELS.map((label, i) => (
          <div key={i} style={{
            padding: '12px 32px',
            background: i === step ? '#0891b2' : '#fff',
            color: i === step ? '#fff' : i < step ? '#0891b2' : '#888',
            fontWeight: i === step ? 700 : 400,
            fontSize: 14,
            borderRight: i < 2 ? '1px solid #e5e5e0' : 'none',
          }}>
            {i + 1}. {label}
          </div>
        ))}
      </div>

      <div style={{ width: '100%', maxWidth: 520, background: '#fff', borderRadius: 16, boxShadow: '0 2px 12px #0002', padding: 32 }}>

        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>選擇訂位資訊</h2>

            <Field label="餐廳">
              <select value={storeId} onChange={e => setStoreId(e.target.value)} style={SELECT}>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>

            <Field label="日期">
              <input type="date" value={date} min={minDate} max={maxDate}
                onChange={e => setDate(e.target.value)} style={INPUT} />
            </Field>

            <Field label="訂位人數">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[2, 3, 4, 5, 6, 7, 8].map(n => (
                  <button key={n} onClick={() => setPartySize(n)}
                    style={{ ...PILL, background: n === partySize ? '#0891b2' : '#f5f4f0', color: n === partySize ? '#fff' : '#333' }}>
                    {n}人
                  </button>
                ))}
              </div>
              {(() => {
                const s = stores.find(x => x.id === storeId)
                return (
                  <div style={{ marginTop: 10, fontSize: 13, color: '#666', background: '#f5f4f0', borderRadius: 8, padding: '10px 12px', lineHeight: 1.6 }}>
                    8 人以上請來電預約：
                    <span style={{ fontWeight: 700, color: '#333' }}>{s?.name ?? '—'}</span>
                    {s?.phone && <span style={{ marginLeft: 6, color: '#0891b2', fontWeight: 600 }}>📞 {s.phone}</span>}
                  </div>
                )
              })()}
            </Field>

            <Field label="用餐時間">
              <div style={{ display: 'flex', gap: 8 }}>
                {Array.from({ length: maxHours - minHours + 1 }, (_, i) => i + minHours).map(h => (
                  <button key={h} onClick={() => setDuration(h)}
                    style={{ ...PILL, background: h === duration ? '#0891b2' : '#f5f4f0', color: h === duration ? '#fff' : '#333' }}>
                    {h}小時
                  </button>
                ))}
              </div>
            </Field>

            <Field label="可用時段">
              {!date && <div style={{ color: '#888', fontSize: 14 }}>請先選擇日期</div>}
              {date && loadingSlots && <div style={{ color: '#888', fontSize: 14 }}>載入中…</div>}
              {date && !loadingSlots && slots.length === 0 && (
                <div style={{ color: '#e53e3e', fontSize: 14 }}>該日無可用時段</div>
              )}
              {date && !loadingSlots && slots.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {slots.map(s => (
                    <button key={s.slot_time} onClick={() => setSlot(s.slot_time)}
                      style={{ ...PILL, background: slot === s.slot_time ? '#0891b2' : '#f5f4f0', color: slot === s.slot_time ? '#fff' : '#333' }}>
                      {s.slot_time.slice(0, 5)}
                      <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.8 }}>({s.available_table_count}桌)</span>
                    </button>
                  ))}
                </div>
              )}
            </Field>

            <button disabled={!storeId || !date || !slot}
              onClick={() => setStep(1)}
              style={{ ...BTN, opacity: (!storeId || !date || !slot) ? 0.4 : 1, marginTop: 8 }}>
              下一步
            </button>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>填寫聯絡資料</h2>

            <Field label="姓名 *">
              <input placeholder="訂位人姓名" value={guestName}
                onChange={e => setGuestName(e.target.value)} style={INPUT} />
            </Field>
            <Field label="手機 *">
              <input placeholder="0912-345-678" value={phone}
                onChange={e => setPhone(e.target.value)} style={INPUT} />
            </Field>
            <Field label="Email">
              <input type="email" placeholder="（選填）" value={email}
                onChange={e => setEmail(e.target.value)} style={INPUT} />
            </Field>
            <Field label="備註">
              <textarea placeholder="過敏原、兒童椅、慶生蛋糕…（選填）"
                value={requests} onChange={e => setRequests(e.target.value)}
                rows={3} style={{ ...INPUT, resize: 'vertical' }} />
            </Field>

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button onClick={() => setStep(0)}
                style={{ ...BTN, background: '#f5f4f0', color: '#333', flex: 1 }}>
                上一步
              </button>
              <button disabled={!guestName || !phone}
                onClick={() => setStep(2)}
                style={{ ...BTN, flex: 2, opacity: (!guestName || !phone) ? 0.4 : 1 }}>
                下一步
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>確認訂位資訊</h2>

            <SummaryRow label="餐廳" value={stores.find(s => s.id === storeId)?.name ?? '—'} />
            <SummaryRow label="日期" value={date} />
            <SummaryRow label="時段" value={`${slot.slice(0, 5)} 起，${duration} 小時`} />
            <SummaryRow label="人數" value={`${partySize} 人`} />
            <SummaryRow label="姓名" value={guestName} />
            <SummaryRow label="手機" value={phone} />
            {email && <SummaryRow label="Email" value={email} />}
            {requests && <SummaryRow label="備註" value={requests} />}


            {error && (
              <div style={{ color: '#e53e3e', fontSize: 13, background: '#fff5f5', padding: '10px 14px', borderRadius: 8 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button onClick={() => setStep(1)}
                style={{ ...BTN, background: '#f5f4f0', color: '#333', flex: 1 }}>
                修改
              </button>
              <button onClick={submit} disabled={submitting}
                style={{ ...BTN, flex: 2, opacity: submitting ? 0.6 : 1 }}>
                {submitting ? '送出中…' : '確認送出'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 24, fontSize: 13, color: '#888' }}>
        已有訂位？
        <a href="/lookup" style={{ color: '#0891b2', textDecoration: 'none', marginLeft: 4 }}>
          查詢 / 取消訂位
        </a>
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
const SELECT = { ...INPUT }
const PILL = {
  padding: '7px 14px', border: 'none', borderRadius: 20,
  fontSize: 14, cursor: 'pointer', fontWeight: 500,
}
const BTN = {
  padding: '13px 0', background: '#0891b2', color: '#fff',
  border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700,
  cursor: 'pointer', width: '100%',
}
