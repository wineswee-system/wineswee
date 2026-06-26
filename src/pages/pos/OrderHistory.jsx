import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import Badge from '../../components/ui/Badge'
import { toast } from '../../lib/toast'

const STATUS_LABEL   = { open: '進行中', submitted: '已送廚', paid: '已結帳', voided: '已作廢' }
const STATUS_VARIANT = { open: 'info', submitted: 'warning', paid: 'success', voided: 'default' }

export default function OrderHistory() {
  const { storeId } = useTenant()
  const [orders,   setOrders]   = useState([])
  const [loading,  setLoading]  = useState(false)
  const [search,   setSearch]   = useState('')
  const [status,   setStatus]   = useState('')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo,   setDateTo]   = useState(() => new Date().toISOString().slice(0, 10))
  const [expanded,   setExpanded]   = useState(null)
  const [itemMap,    setItemMap]    = useState({})
  const [returnModal, setReturnModal] = useState(null) // { order, items }
  const [returnSel,   setReturnSel]   = useState({})   // { [itemId]: true }
  const [returning,   setReturning]   = useState(false)

  async function load() {
    if (!storeId) return
    setLoading(true)
    let q = supabase
      .from('pos_orders')
      .select('id, order_number, status, guest_count, opened_at, paid_at, res_tables(table_number)')
      .eq('store_id', storeId)
      .gte('opened_at', `${dateFrom}T00:00:00`)
      .lte('opened_at', `${dateTo}T23:59:59`)
      .order('opened_at', { ascending: false })
      .limit(200)
    if (status) q = q.eq('status', status)
    const { data } = await q

    let rows = data ?? []
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      rows = rows.filter(o =>
        String(o.order_number).includes(s) ||
        String(o.res_tables?.table_number ?? '').toLowerCase().includes(s)
      )
    }
    setOrders(rows)
    setLoading(false)
  }

  useEffect(() => { load() }, [storeId, dateFrom, dateTo, status])

  async function toggleExpand(orderId) {
    if (expanded === orderId) { setExpanded(null); return }
    if (!itemMap[orderId]) {
      const { data } = await supabase
        .from('pos_order_items')
        .select('id, name, unit_price, quantity, note')
        .eq('order_id', orderId)
        .order('created_at')
      setItemMap(p => ({ ...p, [orderId]: data ?? [] }))
    }
    setExpanded(orderId)
  }

  async function openReturnModal(order) {
    // Ensure items are loaded
    if (!itemMap[order.id]) {
      const { data } = await supabase
        .from('pos_order_items')
        .select('id, name, unit_price, quantity, note')
        .eq('order_id', order.id)
        .order('created_at')
      setItemMap(p => ({ ...p, [order.id]: data ?? [] }))
      setReturnModal({ order, items: data ?? [] })
    } else {
      setReturnModal({ order, items: itemMap[order.id] })
    }
    setReturnSel({})
  }

  async function submitReturn() {
    if (!returnModal) return
    const selItems = returnModal.items.filter(i => returnSel[i.id])
    if (selItems.length === 0) { toast.error('請選擇要退貨的品項'); return }
    setReturning(true)
    try {
      const { error } = await supabase.functions.invoke('process-return', {
        body: {
          orderId: returnModal.order.id,
          items:   selItems.map(i => ({ id: i.id, quantity: i.quantity })),
          reason:  '客戶退貨',
        },
      })
      if (error) throw error
      toast.success('退貨已處理')
      setReturnModal(null)
      load()
    } catch (e) {
      toast.error('退貨失敗：' + (e.message || ''))
    } finally {
      setReturning(false)
    }
  }

  function printOrderReceipt(order, items) {
    const lines = items.map(i => `${i.name} ×${i.quantity}  $${(i.unit_price * i.quantity).toLocaleString()}`).join('\n')
    const win = window.open('', '_blank', 'width=400,height=600')
    if (!win) { toast.error('請允許彈出視窗'); return }
    win.document.write(`<pre style="font-family:monospace;font-size:13px;padding:16px">
訂單 #${order.order_number}
桌號：T${order.res_tables?.table_number ?? '—'}
開單：${fmtTime(order.opened_at)}
結帳：${fmtTime(order.paid_at)}
────────────────────────
${lines}
────────────────────────
</pre>`)
    win.document.close()
    win.print()
  }

  const paidCount = orders.filter(o => o.status === 'paid').length

  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>訂單記錄</h1>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={S.input} />
        <span style={{ color: 'var(--text-muted)' }}>~</span>
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   style={S.input} />
        <select value={status} onChange={e => setStatus(e.target.value)} style={S.input}>
          <option value="">全部狀態</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input
          placeholder="訂單號 / 桌號…"
          value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
          style={{ ...S.input, width: 180 }}
        />
        <button onClick={load} style={S.btn}>查詢</button>
      </div>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[['總筆數', orders.length], ['已結帳', paidCount]].map(([l, v]) => (
          <div key={l} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 10, padding: '10px 20px', minWidth: 100 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-primary)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)' }}>
              {['訂單號', '桌號', '人數', '狀態', '開單時間', '結帳時間', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</td></tr>
            )}
            {!loading && orders.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>查無訂單</td></tr>
            )}
            {orders.flatMap(o => {
              const rows = [
                <tr key={o.id}
                  onClick={() => toggleExpand(o.id)}
                  style={{ borderTop: '1px solid var(--border-primary)', cursor: 'pointer' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>#{o.order_number}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>T{o.res_tables?.table_number ?? '—'}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{o.guest_count ?? '—'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <Badge variant={STATUS_VARIANT[o.status] ?? 'default'}>{STATUS_LABEL[o.status] ?? o.status}</Badge>
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtTime(o.opened_at)}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{o.paid_at ? fmtTime(o.paid_at) : '—'}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 12 }}>{expanded === o.id ? '▲' : '▼'}</td>
                </tr>
              ]
              if (expanded === o.id) {
                rows.push(
                  <tr key={`${o.id}-items`} style={{ background: 'var(--bg-tertiary)' }}>
                    <td colSpan={7} style={{ padding: '10px 28px 16px' }}>
                      {(itemMap[o.id] ?? []).map(i => (
                        <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                          <span>{i.name}{i.note ? ` (${i.note})` : ''} ×{i.quantity}</span>
                          <span>${(i.unit_price * i.quantity).toLocaleString()}</span>
                        </div>
                      ))}
                      {(itemMap[o.id] ?? []).length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>無品項</div>}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button
                          onClick={e => { e.stopPropagation(); printOrderReceipt(o, itemMap[o.id] ?? []) }}
                          style={S.actBtn}
                        >
                          🖨 列印
                        </button>
                        {o.status === 'paid' && (
                          <button
                            onClick={e => { e.stopPropagation(); openReturnModal(o) }}
                            style={{ ...S.actBtn, color: 'var(--accent-red)', border: '1px solid var(--accent-red)', background: 'var(--accent-red-dim)' }}
                          >
                            退貨
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              }
              return rows
            })}
          </tbody>
        </table>
      </div>
      {/* Return modal */}
      {returnModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-primary)', borderRadius: 14, padding: 28, maxWidth: 420, width: '90%' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>
              退貨 — 訂單 #{returnModal.order.order_number}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>選擇要退貨的品項：</div>
            {returnModal.items.map(i => (
              <label key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 14, cursor: 'pointer', color: 'var(--text-primary)' }}>
                <input
                  type="checkbox"
                  checked={!!returnSel[i.id]}
                  onChange={() => setReturnSel(p => ({ ...p, [i.id]: !p[i.id] }))}
                  style={{ accentColor: 'var(--accent-red)' }}
                />
                {i.name} ×{i.quantity} — ${(i.unit_price * i.quantity).toLocaleString()}
              </label>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setReturnModal(null)} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}>取消</button>
              <button
                onClick={submitReturn}
                disabled={returning || Object.values(returnSel).every(v => !v)}
                style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: returning ? 'var(--bg-tertiary)' : 'var(--accent-red)', color: returning ? 'var(--text-muted)' : '#fff', cursor: returning ? 'not-allowed' : 'pointer', fontWeight: 700 }}
              >
                {returning ? '處理中…' : '確認退貨'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

const S = {
  input:  { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' },
  btn:    { padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  actBtn: { padding: '5px 14px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
}
