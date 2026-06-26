import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

const METHOD_LABEL = {
  cash:     '現金',
  card:     '信用卡',
  line_pay: 'LINE Pay',
  jkopay:   '街口',
  other:    '其他',
}

export default function ZReport() {
  const { storeId } = useTenant()
  const [shifts,     setShifts]     = useState([])
  const [selShift,   setSelShift]   = useState(null)
  const [payments,   setPayments]   = useState([])
  const [orderCount, setOrderCount] = useState(0)
  const [actualCash, setActualCash] = useState('')
  const [openFloat,  setOpenFloat]  = useState('')
  const [closing,    setClosing]    = useState(false)
  const [loading,    setLoading]    = useState(false)

  // Load recent shifts for this store
  useEffect(() => {
    if (!storeId) return
    supabase
      .from('pos_shifts')
      .select('id, status, opened_at, closed_at, order_counter, opening_float, closing_cash')
      .eq('store_id', storeId)
      .order('opened_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setShifts(data ?? [])
        if (data?.length) {
          setSelShift(data[0])
          setOpenFloat(String(data[0].opening_float ?? 0))
        }
      })
  }, [storeId])

  // Load payments for the selected shift
  useEffect(() => {
    if (!selShift) return
    setLoading(true)
    supabase
      .from('pos_orders')
      .select('id')
      .eq('shift_id', selShift.id)
      .eq('status', 'paid')
      .then(async ({ data: orders }) => {
        if (!orders?.length) {
          setPayments([])
          setOrderCount(0)
          setLoading(false)
          return
        }
        setOrderCount(orders.length)
        const { data: pmts } = await supabase
          .from('pos_payments')
          .select('id, amount, payment_method')
          .in('order_id', orders.map(o => o.id))
        setPayments(pmts ?? [])
        setLoading(false)
      })
    setActualCash('')
    setOpenFloat(String(selShift.opening_float ?? 0))
  }, [selShift])

  // Aggregate by payment method
  const byMethod = payments.reduce((acc, p) => {
    acc[p.payment_method] = (acc[p.payment_method] ?? 0) + Number(p.amount)
    return acc
  }, {})
  const totalRevenue = Object.values(byMethod).reduce((s, v) => s + v, 0)
  const cashRevenue  = byMethod.cash ?? 0
  const floatAmt     = Number(openFloat) || 0
  const expectedCash = floatAmt + cashRevenue
  const variance     = actualCash !== '' ? Number(actualCash) - expectedCash : null

  function printZReport() {
    const lines = Object.entries(byMethod)
      .map(([m, amt]) => `${(METHOD_LABEL[m] ?? m).padEnd(10)}  $${Number(amt).toLocaleString()}`)
      .join('\n')
    const varLine = variance !== null
      ? `差異金額: ${variance >= 0 ? '+' : ''}${variance.toLocaleString()} 元`
      : ''
    const win = window.open('', '_blank', 'width=400,height=600')
    if (!win) return
    win.document.write(`<pre style="font-family:monospace;font-size:13px;padding:20px;line-height:1.7">
Z 報表 — ${fmtDate(selShift?.opened_at)}
${'='.repeat(36)}
${selShift?.status === 'open' ? '● 進行中' : '✓ 已結班'}
${'─'.repeat(36)}
收款明細
${lines}
${'─'.repeat(36)}
合計          $${totalRevenue.toLocaleString()}
結帳訂單：${orderCount} 筆
${'─'.repeat(36)}
開班備用金：$${floatAmt.toLocaleString()}
現金收款：  $${cashRevenue.toLocaleString()}
理論在抽屜：$${expectedCash.toLocaleString()}
${actualCash !== '' ? `實際點鈔：  $${Number(actualCash).toLocaleString()}` : ''}
${varLine}
${'='.repeat(36)}
列印時間：${new Date().toLocaleString('zh-TW')}
</pre>`)
    win.document.close()
    win.print()
  }

  async function closeShift() {
    if (!selShift || selShift.status === 'closed' || closing) return
    setClosing(true)
    await supabase
      .from('pos_shifts')
      .update({
        status:        'closed',
        closed_at:     new Date().toISOString(),
        opening_float: floatAmt,
        closing_cash:  actualCash !== '' ? Number(actualCash) : null,
      })
      .eq('id', selShift.id)
    const updated = { ...selShift, status: 'closed', closing_cash: Number(actualCash), opening_float: floatAmt }
    setSelShift(updated)
    setShifts(prev => prev.map(s => s.id === selShift.id ? updated : s))
    setClosing(false)
  }

  function selectShift(id) {
    const s = shifts.find(x => x.id === id)
    if (s) setSelShift(s)
  }

  return (
    <div style={{ padding: 28, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>Z 報表 / 交班結算</h1>

      {/* Shift selector */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 28 }}>
        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>班別：</span>
        <select
          value={selShift?.id ?? ''}
          onChange={e => selectShift(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
        >
          <option value="">選擇班別…</option>
          {shifts.map(s => (
            <option key={s.id} value={s.id}>
              {fmtDate(s.opened_at)} {s.status === 'open' ? '（進行中）' : '（已結班）'}
            </option>
          ))}
        </select>
        {selShift && (
          <span style={{ fontSize: 12, fontWeight: 600, color: selShift.status === 'open' ? 'var(--accent-green)' : 'var(--text-muted)' }}>
            {selShift.status === 'open' ? '● 進行中' : '✓ 已結班'}
          </span>
        )}
        {selShift && (
          <button
            onClick={printZReport}
            style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginLeft: 'auto' }}
          >
            🖨 列印 Z 報表
          </button>
        )}
      </div>

      {selShift && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

          {/* Left: payment breakdown */}
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: 20, border: '1px solid var(--border-primary)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>收款明細</div>

            {loading ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', paddingTop: 24 }}>載入中…</div>
            ) : (
              <>
                {Object.entries(byMethod).map(([method, amount]) => (
                  <Row key={method} label={METHOD_LABEL[method] ?? method} value={`$${Number(amount).toLocaleString()}`} />
                ))}
                {Object.keys(byMethod).length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', paddingTop: 24 }}>本班無已結帳訂單</div>
                )}
                <div style={{ borderTop: '2px solid var(--border-primary)', marginTop: 12, paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700 }}>
                  <span style={{ color: 'var(--text-primary)' }}>合計</span>
                  <span style={{ color: 'var(--accent-cyan)' }}>${totalRevenue.toLocaleString()}</span>
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                  結帳訂單：{orderCount} 筆 ／ 訂單流水：{selShift.order_counter}
                </div>
              </>
            )}
          </div>

          {/* Right: cash reconciliation */}
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: 20, border: '1px solid var(--border-primary)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>現金盤點</div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>開班備用金</label>
              <input
                type="number"
                value={openFloat}
                onChange={e => setOpenFloat(e.target.value)}
                disabled={selShift.status === 'closed'}
                placeholder="0"
                style={{ ...S.input, width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            <Row label="現金收款"   value={`$${cashRevenue.toLocaleString()}`} />
            <Row label="理論在抽屜" value={`$${expectedCash.toLocaleString()}`} bold accent />

            <div style={{ margin: '16px 0 12px' }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>實際點鈔</label>
              <input
                type="number"
                value={actualCash}
                onChange={e => setActualCash(e.target.value)}
                disabled={selShift.status === 'closed'}
                placeholder="輸入點鈔金額…"
                style={{
                  ...S.input,
                  width: '100%',
                  boxSizing: 'border-box',
                  borderColor: variance !== null && Math.abs(variance) > 100 ? 'var(--accent-red)' : 'var(--border-primary)',
                }}
              />
            </div>

            {variance !== null && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 14,
                background: Math.abs(variance) > 100 ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)',
                border: `1px solid ${Math.abs(variance) > 100 ? 'var(--accent-red)' : 'var(--accent-green)'}`,
              }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>差異金額</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: Math.abs(variance) > 100 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                  {variance >= 0 ? '+' : ''}{variance.toLocaleString()} 元
                </div>
                {Math.abs(variance) > 100 && (
                  <div style={{ fontSize: 12, color: 'var(--accent-red)', marginTop: 4 }}>⚠ 差異超過 $100，請複查收款紀錄</div>
                )}
              </div>
            )}

            {selShift.status === 'open' ? (
              <button
                onClick={closeShift}
                disabled={closing || actualCash === ''}
                style={{
                  width: '100%', padding: 11, borderRadius: 8, border: 'none',
                  background: actualCash === '' ? 'var(--bg-tertiary)' : 'var(--accent-cyan)',
                  color: actualCash === '' ? 'var(--text-muted)' : '#fff',
                  fontSize: 14, fontWeight: 700,
                  cursor: actualCash === '' ? 'not-allowed' : 'pointer',
                }}
              >
                {closing ? '結班中…' : '確認結班'}
              </button>
            ) : (
              <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', paddingTop: 8 }}>
                <div>已於 {fmtDate(selShift.closed_at)} 結班</div>
                {selShift.closing_cash != null && (
                  <div style={{ marginTop: 4 }}>實際點鈔：${Number(selShift.closing_cash).toLocaleString()}</div>
                )}
              </div>
            )}
          </div>

        </div>
      )}

      {!selShift && shifts.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 60, color: 'var(--text-muted)', fontSize: 14 }}>
          尚無班別資料，請先在收銀台開始第一筆訂單
        </div>
      )}
    </div>
  )
}

function Row({ label, value, bold, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border-primary)', fontSize: 14 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500, color: accent ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const S = {
  input: {
    padding: '9px 12px', borderRadius: 8,
    border: '1px solid var(--border-primary)',
    background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    fontSize: 14, outline: 'none',
  },
}
