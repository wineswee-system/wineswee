import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Printer } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { useAuth } from '../../contexts/AuthContext'

const METHOD_LABEL = { cash: '現金', card: '信用卡', line_pay: 'LINE Pay', jkopay: '街口', other: '其他' }

function today() { return new Date().toISOString().slice(0, 10) }
function floatKey(storeId, date) { return `posFloat_${storeId}_${date}` }

export default function XReport() {
  const { storeId } = useTenant()
  const { profile } = useAuth()

  const [date,       setDate]       = useState(today)
  const [loading,    setLoading]    = useState(false)
  const [orders,     setOrders]     = useState([])
  const [payments,   setPayments]   = useState([])
  const [topItems,   setTopItems]   = useState([])
  const [openFloat,  setOpenFloat]  = useState('')
  const [actualCash, setActualCash] = useState('')

  // ── Persist opening float per store per day ───────────────────────────────
  useEffect(() => {
    if (!storeId) return
    const saved = localStorage.getItem(floatKey(storeId, date))
    setOpenFloat(saved ?? '')
    setActualCash('')
  }, [storeId, date])

  function saveFloat(val) {
    setOpenFloat(val)
    if (storeId) localStorage.setItem(floatKey(storeId, date), val)
  }

  // ── Load data ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    try {
      const start = `${date}T00:00:00`
      const end   = `${date}T23:59:59`

      // Paid orders for the day
      const { data: ords } = await supabase
        .from('pos_orders')
        .select('id')
        .eq('store_id', storeId)
        .eq('status', 'paid')
        .gte('paid_at', start)
        .lte('paid_at', end)

      setOrders(ords ?? [])
      if (!ords?.length) { setPayments([]); setTopItems([]); setLoading(false); return }

      const ids = ords.map(o => o.id)

      // Payments + items in parallel
      const [{ data: pmts }, { data: itms }] = await Promise.all([
        supabase.from('pos_payments').select('amount, payment_method').in('order_id', ids),
        supabase.from('pos_order_items').select('name, unit_price, quantity').in('order_id', ids).is('voided_at', null),
      ])

      setPayments(pmts ?? [])

      // Aggregate top items
      const map = {}
      for (const i of (itms ?? [])) {
        if (!map[i.name]) map[i.name] = { qty: 0, revenue: 0 }
        map[i.name].qty     += i.quantity
        map[i.name].revenue += Number(i.unit_price) * i.quantity
      }
      setTopItems(
        Object.entries(map)
          .map(([name, v]) => ({ name, ...v }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10)
      )
    } finally { setLoading(false) }
  }, [storeId, date])

  useEffect(() => { load() }, [load])

  // ── Derived ───────────────────────────────────────────────────────────────
  const byMethod = payments.reduce((acc, p) => {
    acc[p.payment_method] = (acc[p.payment_method] ?? 0) + Number(p.amount)
    return acc
  }, {})
  const totalRevenue  = Object.values(byMethod).reduce((s, v) => s + v, 0)
  const cashRevenue   = byMethod.cash ?? 0
  const floatAmt      = Number(openFloat) || 0
  const expectedCash  = floatAmt + cashRevenue
  const variance      = actualCash !== '' ? Number(actualCash) - expectedCash : null
  const orderCount    = orders.length
  const avgTicket     = orderCount ? Math.round(totalRevenue / orderCount) : 0

  // ── Print ─────────────────────────────────────────────────────────────────
  function printX() {
    const lines = Object.entries(byMethod)
      .map(([m, v]) => `${(METHOD_LABEL[m] ?? m).padEnd(10)}  $${Number(v).toLocaleString()}`)
      .join('\n')
    const win = window.open('', '_blank', 'width=400,height=700')
    if (!win) return
    win.document.write(`<pre style="font-family:monospace;font-size:13px;padding:20px;line-height:1.8">
X 報表 (今日快報)
${'='.repeat(36)}
日期：${date}
${'─'.repeat(36)}
收款明細
${lines || '（尚無收款）'}
${'─'.repeat(36)}
營業額：      $${totalRevenue.toLocaleString()}
結帳訂單：    ${orderCount} 筆
平均客單：    $${avgTicket.toLocaleString()}
${'─'.repeat(36)}
開班備用金：  $${floatAmt.toLocaleString()}
現金收款：    $${cashRevenue.toLocaleString()}
理論在抽屜：  $${expectedCash.toLocaleString()}
${actualCash !== '' ? `實際點鈔：    $${Number(actualCash).toLocaleString()}` : '（未點鈔）'}
${variance !== null ? `現金差異：    ${variance >= 0 ? '+' : ''}${variance.toLocaleString()} 元` : ''}
${'='.repeat(36)}
列印時間：${new Date().toLocaleString('zh-TW')}
</pre>`)
    win.document.close()
    win.print()
  }

  const isToday = date === today()

  return (
    <div style={{ padding: 28, maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            X 報表 · 今日快報
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            {isToday ? '● 即時更新 — 不影響結班' : '歷史日期查閱'}
          </p>
        </div>
        <div style={{ flex: 1 }} />
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14 }} />
        <button onClick={load}
          style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={13} /> 重整
        </button>
        <button onClick={printX}
          style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Printer size={13} /> 列印
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', paddingTop: 60, color: 'var(--text-muted)' }}>載入中…</div>}

      {!loading && (
        <>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: '今日營收', value: `NT$ ${totalRevenue.toLocaleString()}`, accent: 'var(--accent-cyan)' },
              { label: '結帳單數', value: `${orderCount} 單`,                     accent: 'var(--accent-green)' },
              { label: '平均客單', value: `NT$ ${avgTicket.toLocaleString()}`,    accent: 'var(--text-primary)' },
            ].map(({ label, value, accent }) => (
              <div key={label} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 10, padding: '16px 20px' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: accent }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* Left: payment breakdown */}
            <div style={card}>
              <div style={sectionTitle}>收款明細</div>
              {Object.keys(byMethod).length === 0 ? (
                <div style={{ textAlign: 'center', paddingTop: 24, fontSize: 13, color: 'var(--text-muted)' }}>
                  {isToday ? '今日尚無收款' : '此日期無資料'}
                </div>
              ) : (
                <>
                  {Object.entries(byMethod).map(([m, v]) => (
                    <Row key={m} label={METHOD_LABEL[m] ?? m} value={`NT$ ${Number(v).toLocaleString()}`} />
                  ))}
                  <Row label="合計" value={`NT$ ${totalRevenue.toLocaleString()}`} bold accent />
                </>
              )}
            </div>

            {/* Right: cash management */}
            <div style={card}>
              <div style={sectionTitle}>現金盤點</div>

              <label style={lbl}>開班備用金</label>
              <input type="number" placeholder="0" value={openFloat}
                onChange={e => saveFloat(e.target.value)}
                style={{ ...inputStyle, marginBottom: 12 }} />

              <Row label="現金收款"   value={`NT$ ${cashRevenue.toLocaleString()}`} />
              <Row label="理論在抽屜" value={`NT$ ${expectedCash.toLocaleString()}`} bold accent />

              <label style={{ ...lbl, marginTop: 14 }}>實際點鈔</label>
              <input type="number" placeholder="輸入點鈔金額…" value={actualCash}
                onChange={e => setActualCash(e.target.value)}
                style={{
                  ...inputStyle,
                  borderColor: variance !== null && Math.abs(variance) > 100 ? 'var(--accent-red)' : 'var(--border-default)',
                }} />

              {variance !== null && (
                <div style={{
                  marginTop: 12, padding: '10px 14px', borderRadius: 8,
                  background: Math.abs(variance) > 100 ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)',
                  border: `1px solid ${Math.abs(variance) > 100 ? 'var(--accent-red)' : 'var(--accent-green)'}`,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>現金差異</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: Math.abs(variance) > 100 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                    {variance >= 0 ? '+' : ''}{variance.toLocaleString()} 元
                  </div>
                  {Math.abs(variance) > 100 && (
                    <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 2 }}>⚠ 差異超過 $100，請複查</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Top items */}
          {topItems.length > 0 && (
            <div style={{ ...card, marginTop: 16 }}>
              <div style={sectionTitle}>熱銷品項 TOP 10</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    {['#', '品項', '數量', '金額'].map(h => (
                      <th key={h} style={{ padding: '5px 10px', textAlign: h === '品項' ? 'left' : 'right', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topItems.map((item, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '8px 10px', color: 'var(--text-muted)', textAlign: 'right', width: 28 }}>{i + 1}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>{item.name}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>{item.qty}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--accent-cyan)', fontWeight: 600 }}>NT$ {Math.round(item.revenue).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Row({ label, value, bold, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 14 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500, color: accent ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

const card        = { background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 12, padding: 20 }
const sectionTitle = { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }
const lbl          = { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }
const inputStyle   = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }
