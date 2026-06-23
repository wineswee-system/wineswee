import { useLocation, useNavigate } from 'react-router-dom'

export default function ConfirmPage() {
  const { state } = useLocation()
  const navigate = useNavigate()

  if (!state?.code) {
    navigate('/', { replace: true })
    return null
  }

  const { code, date, slot, partySize, duration, guestName, storeId, stores } = state
  const storeName = stores?.find(s => s.id === storeId)?.name ?? '—'

  return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 64 }}>
      <div style={{ width: '100%', background: '#fff', borderBottom: '1px solid #e5e5e0', padding: '20px 24px' }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a' }}>線上訂位</span>
      </div>

      <div style={{ width: '100%', maxWidth: 480, marginTop: 48 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', background: '#d1fae5',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 8 }}>訂位成功！</h1>
          <p style={{ color: '#666', fontSize: 14 }}>請記下確認碼，以便查詢或取消訂位</p>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 2px 12px #0002', padding: 32, marginBottom: 20 }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: 1, marginBottom: 8 }}>確認碼</div>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: 8, color: '#0891b2', fontFamily: 'monospace' }}>
              {code}
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #f0f0ec', margin: '0 0 20px' }} />

          <SummaryRow label="餐廳" value={storeName} />
          <SummaryRow label="日期" value={date} />
          <SummaryRow label="時段" value={`${slot.slice(0, 5)} 起，${duration} 小時`} />
          <SummaryRow label="人數" value={`${partySize} 人`} />
          <SummaryRow label="訂位人" value={guestName} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <a href="/lookup"
            style={{ ...BTN, textDecoration: 'none', textAlign: 'center', display: 'block', background: '#f5f4f0', color: '#0891b2' }}>
            查詢 / 取消訂位
          </a>
          <button onClick={() => navigate('/')} style={BTN}>再訂一次</button>
        </div>
      </div>
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

const BTN = {
  padding: '13px 0', background: '#0891b2', color: '#fff',
  border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700,
  cursor: 'pointer', width: '100%',
}
