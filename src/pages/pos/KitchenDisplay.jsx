import { useState, useEffect, useCallback } from 'react'
import { ChefHat, CheckCircle2, Clock, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../lib/toast'

const ITEM_STATUS = {
  confirmed: { label: '待製作', color: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)' },
  preparing: { label: '製作中', color: 'var(--accent-blue)',   bg: 'var(--accent-blue-dim)'   },
  ready:     { label: '完成',   color: 'var(--accent-green)',  bg: 'var(--accent-green-dim)'  },
}

const NEXT_STATUS = { confirmed: 'preparing', preparing: 'ready' }

function elapsedLabel(isoStr) {
  const sec = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (sec < 60) return `${sec}秒`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}分${s}秒`
}

function beep() {
  try {
    const ctx  = new AudioContext()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 660
    gain.gain.setValueAtTime(0.35, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.5)
  } catch {}
}

export default function KitchenDisplay() {
  const [orders,  setOrders]  = useState([])
  const [loading, setLoading] = useState(true)
  const [tick,    setTick]    = useState(0)

  const fetchOrders = useCallback(async () => {
    // Step 1 — items sent to kitchen that are not yet done
    const { data: items, error } = await supabase
      .from('pos_order_items')
      .select('id, order_id, name, quantity, note, item_status, created_at, source')
      .eq('sent_to_kitchen', true)
      .in('item_status', ['confirmed', 'preparing', 'ready'])
      .order('created_at', { ascending: true })

    if (error) { console.error('[Kitchen]', error); return }
    if (!items?.length) { setOrders([]); setLoading(false); return }

    // Step 2 — parent orders (exclude terminal states)
    const orderIds = [...new Set(items.map(i => i.order_id))]
    const { data: ordersData } = await supabase
      .from('pos_orders')
      .select('id, order_number, status, table_id')
      .in('id', orderIds)
      .not('status', 'in', '(paid,voided,served)')

    const activeIds = new Set((ordersData ?? []).map(o => o.id))
    const orderMeta = Object.fromEntries((ordersData ?? []).map(o => [o.id, o]))

    // Step 3 — table numbers
    const tableIds = [...new Set((ordersData ?? []).map(o => o.table_id).filter(Boolean))]
    let tableMap = {}
    if (tableIds.length) {
      const { data: tables } = await supabase
        .from('res_tables')
        .select('id, table_number')
        .in('id', tableIds)
      tableMap = Object.fromEntries((tables ?? []).map(t => [t.id, t.table_number]))
    }

    // Group by order
    const grouped = {}
    for (const item of items) {
      if (!activeIds.has(item.order_id)) continue
      if (!grouped[item.order_id]) {
        const meta = orderMeta[item.order_id] ?? {}
        grouped[item.order_id] = {
          orderId:     item.order_id,
          orderNumber: meta.order_number ?? '—',
          tableNumber: tableMap[meta.table_id] ?? null,
          items:       [],
          firstAt:     item.created_at,
        }
      }
      const g = grouped[item.order_id]
      g.items.push(item)
      if (item.created_at < g.firstAt) g.firstAt = item.created_at
    }

    setOrders(
      Object.values(grouped).sort((a, b) => new Date(a.firstAt) - new Date(b.firstAt))
    )
    setLoading(false)
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // 1-second clock for elapsed display
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Realtime — new items sent to kitchen
  useEffect(() => {
    const knownIds = new Set()
    const channel = supabase
      .channel('kitchen-display')
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'pos_order_items',
        filter: 'sent_to_kitchen=eq.true',
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const id = payload.new?.id
          if (id && !knownIds.has(id)) { knownIds.add(id); beep() }
        }
        fetchOrders()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchOrders])

  const markItem = async (itemId, orderId, nextStatus) => {
    const { error } = await supabase
      .from('pos_order_items')
      .update({ item_status: nextStatus })
      .eq('id', itemId)

    if (error) { toast.error('更新失敗：' + error.message); return }

    if (nextStatus === 'ready') {
      const order = orders.find(o => o.orderId === orderId)
      if (order) {
        const allReady = order.items.every(i => i.id === itemId || i.item_status === 'ready')
        if (allReady) {
          await supabase.from('pos_orders').update({ status: 'ready' }).eq('id', orderId)
        }
      }
    }
    fetchOrders()
  }

  const markOrderAllReady = async (orderId, itemIds) => {
    const { error } = await supabase
      .from('pos_order_items')
      .update({ item_status: 'ready' })
      .in('id', itemIds)

    if (error) { toast.error('更新失敗：' + error.message); return }
    await supabase.from('pos_orders').update({ status: 'ready' }).eq('id', orderId)
    fetchOrders()
  }

  const activeOrders = orders.filter(o => o.items.some(i => i.item_status !== 'ready'))
  const readyOrders  = orders.filter(o => o.items.every(i => i.item_status === 'ready'))

  if (loading) return (
    <div className="fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>載入中…</div>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🍳</span> 廚房顯示器</h2>
            <p>即時顯示待製作訂單 — 點擊品項切換狀態</p>
          </div>
          <button
            className="btn"
            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={fetchOrders}
          >
            <RefreshCw size={14} /> 重新整理
          </button>
        </div>
      </div>

      {activeOrders.length === 0 && readyOrders.length === 0 ? (
        <div style={{ textAlign: 'center', paddingTop: 80, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>🍽️</div>
          <div style={{ fontSize: 16 }}>目前無待製作訂單</div>
        </div>
      ) : (
        <>
          {activeOrders.length > 0 && (
            <section style={{ marginBottom: 32 }}>
              <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase' }}>
                待製作 ({activeOrders.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 16 }}>
                {activeOrders.map(order => (
                  <OrderCard
                    key={order.orderId}
                    order={order}
                    tick={tick}
                    onMarkItem={markItem}
                    onMarkAllReady={markOrderAllReady}
                  />
                ))}
              </div>
            </section>
          )}

          {readyOrders.length > 0 && (
            <section>
              <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: 1, color: 'var(--accent-green)', marginBottom: 12, textTransform: 'uppercase' }}>
                已完成 — 待取餐 ({readyOrders.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 16 }}>
                {readyOrders.map(order => (
                  <OrderCard
                    key={order.orderId}
                    order={order}
                    tick={tick}
                    onMarkItem={markItem}
                    onMarkAllReady={markOrderAllReady}
                    dimmed
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function OrderCard({ order, tick, onMarkItem, onMarkAllReady, dimmed }) {
  void tick  // causes re-render each second for elapsed time

  const allReady    = order.items.every(i => i.item_status === 'ready')
  const nonReadyIds = order.items.filter(i => i.item_status !== 'ready').map(i => i.id)
  const minutes     = (Date.now() - new Date(order.firstAt).getTime()) / 60000
  const urgency     = minutes > 15 ? 'var(--accent-red)' : minutes > 8 ? 'var(--accent-orange)' : 'var(--text-muted)'

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: `1px solid ${allReady ? 'var(--accent-green)' : 'var(--border-primary)'}`,
      borderRadius: 12, overflow: 'hidden',
      opacity: dimmed ? 0.65 : 1,
      transition: 'opacity 0.2s',
    }}>
      <div style={{
        padding: '11px 16px',
        background: allReady ? 'var(--accent-green-dim)' : 'var(--bg-tertiary)',
        borderBottom: '1px solid var(--border-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
            {order.tableNumber ? `T${order.tableNumber}` : '—'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>#{order.orderNumber}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: urgency, fontSize: 12, fontWeight: 600 }}>
          <Clock size={12} />
          {elapsedLabel(order.firstAt)}
        </div>
      </div>

      <div style={{ padding: '10px 14px' }}>
        {order.items.map(item => {
          const s    = ITEM_STATUS[item.item_status] ?? ITEM_STATUS.confirmed
          const next = NEXT_STATUS[item.item_status]
          return (
            <div
              key={item.id}
              onClick={() => next && onMarkItem(item.id, order.orderId, next)}
              title={next ? `點擊 → ${ITEM_STATUS[next]?.label}` : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 10px', borderRadius: 8, marginBottom: 6,
                background: s.bg,
                cursor: next ? 'pointer' : 'default',
                userSelect: 'none',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {item.name} × {item.quantity}
                </div>
                {item.note && (
                  <div style={{ fontSize: 11, color: 'var(--accent-orange)', marginTop: 1 }}>
                    備註：{item.note}
                  </div>
                )}
              </div>
              {item.item_status === 'ready'
                ? <CheckCircle2 size={16} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                : (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: s.color,
                    background: 'rgba(0,0,0,0.12)', padding: '2px 8px', borderRadius: 10,
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {s.label}
                  </span>
                )
              }
            </div>
          )
        })}
      </div>

      {!allReady && (
        <div style={{ padding: '0 14px 14px' }}>
          <button
            onClick={() => onMarkAllReady(order.orderId, nonReadyIds)}
            style={{
              width: '100%', padding: '9px 0', borderRadius: 8, border: 'none',
              background: 'var(--accent-green)', color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <CheckCircle2 size={14} /> 全部完成
          </button>
        </div>
      )}
    </div>
  )
}
