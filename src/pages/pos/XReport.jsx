import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Printer } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getCashMovements, recordCashMovement } from '../../lib/db'
import { useTenant } from '../../contexts/TenantContext'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'

const METHOD_LABEL = { cash: '現金', card: '信用卡', line_pay: 'LINE Pay', jkopay: '街口', other: '其他' }
// 零售交易（pos_transactions）付款方式為中文標籤 → 對回報表鍵值；未知標籤原樣顯示
const ZH_TO_CODE = { '現金': 'cash', '信用卡': 'card', 'LINE Pay': 'line_pay', '街口支付': 'jkopay', '其他': 'other' }

function today() { return new Date().toISOString().slice(0, 10) }

export default function XReport() {
  const { tenant, storeId } = useTenant()
  const { profile } = useAuth()
  const orgId = tenant?.organization_id

  const [date,       setDate]       = useState(today)
  const [loading,    setLoading]    = useState(false)
  const [orders,     setOrders]     = useState([])
  const [payments,   setPayments]   = useState([])
  const [retail,     setRetail]     = useState([])   // 零售收銀台交易（pos_transactions）
  const [returns,    setReturns]    = useState([])   // 零售退款（pos_returns）
  const [movements,  setMovements]  = useState([])   // 現金收支（含開班備用金）
  const [topItems,   setTopItems]   = useState([])
  const [openFloat,  setOpenFloat]  = useState('')
  const [actualCash, setActualCash] = useState('')
  const [cashForm,   setCashForm]   = useState({ type: 'cash_out', amount: '', reason: '' })

  // ── Load data ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!storeId || !orgId) return
    setLoading(true)
    try {
      const start = `${date}T00:00:00`
      const end   = `${date}T23:59:59`

      // 內用/QR（pos_orders 模型）＋ 零售（pos_transactions 模型）＋ 現金收支 平行載入
      const [ordsRes, retailRes, returnsRes, movesRes] = await Promise.all([
        supabase.from('pos_orders').select('id')
          .eq('store_id', storeId).eq('status', 'paid')
          .gte('paid_at', start).lte('paid_at', end),
        supabase.from('pos_transactions')
          .select('id, total, payment_method, payment_splits, items, status, created_at')
          .eq('organization_id', orgId).eq('store_id', storeId)
          .gte('created_at', start).lte('created_at', end),
        supabase.from('pos_returns')
          .select('refund_amount, refund_method, created_at')
          .eq('organization_id', orgId).eq('store_id', storeId)
          .not('transaction_id', 'is', null)
          .gte('created_at', start).lte('created_at', end),
        getCashMovements(orgId, { storeId, date }),
      ])

      const ords = ordsRes.data ?? []
      setOrders(ords)
      setRetail(retailRes.data ?? [])
      setReturns(returnsRes.data ?? [])
      const moves = movesRes.data ?? []
      setMovements(moves)

      // 開班備用金：DB 為準（pos_cash_movements.opening_float）
      const floatRow = moves.find(m => m.movement_type === 'opening_float')
      setOpenFloat(floatRow ? String(Number(floatRow.amount)) : '')

      // 內用收款與品項
      let pmts = [], itms = []
      if (ords.length) {
        const ids = ords.map(o => o.id)
        const [{ data: p }, { data: i }] = await Promise.all([
          supabase.from('pos_payments').select('amount, payment_method').in('order_id', ids),
          supabase.from('pos_order_items').select('name, unit_price, quantity').in('order_id', ids).is('voided_at', null),
        ])
        pmts = p ?? []; itms = i ?? []
      }
      setPayments(pmts)

      // 熱銷品項：內用品項 ＋ 零售 items JSONB 合併
      const map = {}
      for (const i of itms) {
        if (!map[i.name]) map[i.name] = { qty: 0, revenue: 0 }
        map[i.name].qty     += i.quantity
        map[i.name].revenue += Number(i.unit_price) * i.quantity
      }
      for (const t of (retailRes.data ?? [])) {
        for (const i of (t.items ?? [])) {
          const name = i.name ?? '未命名'
          if (!map[name]) map[name] = { qty: 0, revenue: 0 }
          map[name].qty     += Number(i.qty ?? 1)
          map[name].revenue += Number(i.price ?? 0) * Number(i.qty ?? 1)
        }
      }
      setTopItems(
        Object.entries(map)
          .map(([name, v]) => ({ name, ...v }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10)
      )
    } finally { setLoading(false) }
  }, [storeId, orgId, date])

  useEffect(() => { load(); setActualCash('') }, [load])

  // 開班備用金：離開欄位時寫入 DB（每店每日一筆，可覆寫）
  async function saveFloat() {
    if (!orgId) return
    const amt = Number(openFloat) || 0
    const { error } = await recordCashMovement({
      movement_type: 'opening_float', amount: amt,
      store_id: storeId, business_date: date,
      created_by: profile?.name ?? null,
    })
    if (error) toast.error('備用金儲存失敗：' + error.message)
  }

  // 領錢/存錢
  async function submitCashMovement() {
    const amt = Number(cashForm.amount)
    if (!amt || amt <= 0) { toast.error('請輸入金額'); return }
    if (!cashForm.reason.trim()) { toast.error('請填寫原因'); return }
    const { error } = await recordCashMovement({
      movement_type: cashForm.type, amount: amt, reason: cashForm.reason.trim(),
      store_id: storeId, business_date: date,
      created_by: profile?.name ?? null,
    })
    if (error) { toast.error('記錄失敗：' + error.message); return }
    setCashForm({ type: 'cash_out', amount: '', reason: '' })
    load()
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const byMethod = payments.reduce((acc, p) => {
    acc[p.payment_method] = (acc[p.payment_method] ?? 0) + Number(p.amount)
    return acc
  }, {})
  // 零售交易併入（分帳逐筆計入各方式）
  for (const t of retail) {
    if (Array.isArray(t.payment_splits) && t.payment_splits.length > 0) {
      for (const s of t.payment_splits) {
        const key = ZH_TO_CODE[s.method] ?? s.method
        byMethod[key] = (byMethod[key] ?? 0) + Number(s.amount)
      }
    } else {
      const key = ZH_TO_CODE[t.payment_method] ?? t.payment_method
      byMethod[key] = (byMethod[key] ?? 0) + Number(t.total)
    }
  }

  const totalRevenue  = Object.values(byMethod).reduce((s, v) => s + v, 0)
  const cashRevenue   = byMethod.cash ?? 0
  const cashIn        = movements.filter(m => m.movement_type === 'cash_in').reduce((s, m) => s + Number(m.amount), 0)
  const cashOut       = movements.filter(m => m.movement_type === 'cash_out').reduce((s, m) => s + Number(m.amount), 0)
  const cashRefunds   = returns.filter(r => r.refund_method === 'cash').reduce((s, r) => s + Number(r.refund_amount), 0)
  const refundsTotal  = returns.reduce((s, r) => s + Number(r.refund_amount), 0)
  const floatAmt      = Number(openFloat) || 0
  const expectedCash  = floatAmt + cashRevenue + cashIn - cashOut - cashRefunds
  const variance      = actualCash !== '' ? Number(actualCash) - expectedCash : null
  const orderCount    = orders.length + retail.length
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
退款：        $${refundsTotal.toLocaleString()}
${'─'.repeat(36)}
開班備用金：  $${floatAmt.toLocaleString()}
現金收款：    $${cashRevenue.toLocaleString()}
存錢(+)：     $${cashIn.toLocaleString()}
領錢(-)：     $${cashOut.toLocaleString()}
現金退款(-)： $${cashRefunds.toLocaleString()}
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
            {isToday ? '● 即時更新 — 不影響結班' : '歷史日期查閱'}（含收銀台零售＋內用/QR）
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
                  {refundsTotal > 0 && <Row label="退款" value={`- NT$ ${refundsTotal.toLocaleString()}`} />}
                  <Row label="合計" value={`NT$ ${totalRevenue.toLocaleString()}`} bold accent />
                </>
              )}
            </div>

            {/* Right: cash management */}
            <div style={card}>
              <div style={sectionTitle}>現金盤點</div>

              <label style={lbl}>開班備用金（存入資料庫，跨裝置一致）</label>
              <input type="number" placeholder="0" value={openFloat}
                onChange={e => setOpenFloat(e.target.value)}
                onBlur={saveFloat}
                style={{ ...inputStyle, marginBottom: 12 }} />

              <Row label="現金收款"   value={`NT$ ${cashRevenue.toLocaleString()}`} />
              {cashIn > 0 && <Row label="存錢 (+)" value={`NT$ ${cashIn.toLocaleString()}`} />}
              {cashOut > 0 && <Row label="領錢 (−)" value={`NT$ ${cashOut.toLocaleString()}`} />}
              {cashRefunds > 0 && <Row label="現金退款 (−)" value={`NT$ ${cashRefunds.toLocaleString()}`} />}
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

              {/* 領錢 / 存錢（寫入 pos_cash_movements ＋ 稽核軌跡） */}
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ ...lbl, marginBottom: 8 }}>現金收支（領錢/存錢）</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select value={cashForm.type}
                    onChange={e => setCashForm(f => ({ ...f, type: e.target.value }))}
                    style={{ ...inputStyle, width: 90, flexShrink: 0 }}>
                    <option value="cash_out">領錢</option>
                    <option value="cash_in">存錢</option>
                  </select>
                  <input type="number" placeholder="金額" value={cashForm.amount}
                    onChange={e => setCashForm(f => ({ ...f, amount: e.target.value }))}
                    style={{ ...inputStyle, width: 90, flexShrink: 0 }} />
                  <input type="text" placeholder="原因（必填）" value={cashForm.reason}
                    onChange={e => setCashForm(f => ({ ...f, reason: e.target.value }))}
                    style={{ ...inputStyle, flex: 1 }} />
                </div>
                <button onClick={submitCashMovement}
                  style={{ width: '100%', padding: '8px 0', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  記錄現金收支
                </button>
                {movements.filter(m => m.movement_type !== 'opening_float').map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <span>{m.movement_type === 'cash_in' ? '存錢' : '領錢'}｜{m.reason}</span>
                    <span style={{ fontWeight: 600, color: m.movement_type === 'cash_in' ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                      {m.movement_type === 'cash_in' ? '+' : '−'}NT$ {Number(m.amount).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
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
