import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, X, ChefHat, Trash2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'

function beep(freq = 880, duration = 0.3) {
  try {
    const ctx  = new AudioContext()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration)
  } catch {}
}

export default function POSQROrderQueue({ onCountChange }) {
  const [open,        setOpen]        = useState(false)
  const [groups,      setGroups]      = useState([])
  const [loading,     setLoading]     = useState(false)
  const [autoConfirm, setAutoConfirm] = useState(() => {
    try { return localStorage.getItem('qr_auto_confirm') === 'true' } catch { return false }
  })
  const knownIds      = useRef(new Set())
  const autoConfirmRef = useRef(autoConfirm)

  useEffect(() => {
    autoConfirmRef.current = autoConfirm
    try { localStorage.setItem('qr_auto_confirm', String(autoConfirm)) } catch {}
  }, [autoConfirm])

  const fetchPending = useCallback(async () => {
    // Step 1 — pending guest items
    const { data: items, error } = await supabase
      .from('pos_order_items')
      .select('id, order_id, name, quantity, unit_price, note, created_at')
      .eq('source', 'guest')
      .eq('item_status', 'pending')
      .order('created_at', { ascending: true })

    if (error) { console.error('[QRQueue]', error); return }
    if (!items?.length) { setGroups([]); onCountChange?.(0); return }

    // Step 2 — orders for those items (only non-terminal states)
    const orderIds = [...new Set(items.map(i => i.order_id))]
    const { data: orders } = await supabase
      .from('pos_orders')
      .select('id, order_number, status, table_id')
      .in('id', orderIds)
      .not('status', 'in', '(paid,voided,served)')

    const activeOrderIds = new Set((orders ?? []).map(o => o.id))

    // Step 3 — table numbers
    const tableIds = [...new Set((orders ?? []).map(o => o.table_id).filter(Boolean))]
    let tableMap = {}
    if (tableIds.length) {
      const { data: tables } = await supabase
        .from('res_tables')
        .select('id, table_number')
        .in('id', tableIds)
      tableMap = Object.fromEntries((tables ?? []).map(t => [t.id, t.table_number]))
    }
    const orderMeta = Object.fromEntries(
      (orders ?? []).map(o => [o.id, { ...o, tableNumber: tableMap[o.table_id] ?? null }])
    )

    // Group by order_id, skip items whose order is terminal
    const grouped = {}
    for (const item of items) {
      if (!activeOrderIds.has(item.order_id)) continue
      if (!grouped[item.order_id]) {
        const meta = orderMeta[item.order_id] ?? {}
        grouped[item.order_id] = {
          orderId:     item.order_id,
          orderNumber: meta.order_number ?? '—',
          tableNumber: meta.tableNumber ?? null,
          items:       [],
        }
      }
      grouped[item.order_id].items.push(item)
    }

    const result = Object.values(grouped)
    setGroups(result)
    onCountChange?.(result.reduce((s, g) => s + g.items.length, 0))
  }, [onCountChange])

  useEffect(() => { fetchPending() }, [fetchPending])

  // Realtime — new guest items → beep and refresh
  useEffect(() => {
    const channel = supabase
      .channel('qr-order-queue')
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'pos_order_items',
        filter: 'source=eq.guest',
      }, (payload) => {
        const id    = payload.new?.id
        const order = payload.new?.order_id
        if (!id || knownIds.current.has(id)) return
        knownIds.current.add(id)
        if (autoConfirmRef.current && id && order) {
          // Auto-approve: mark item confirmed + send to kitchen silently
          supabase
            .from('pos_order_items')
            .update({ item_status: 'confirmed', sent_to_kitchen: true })
            .eq('id', id)
            .then(() =>
              supabase
                .from('pos_orders')
                .update({ status: 'confirmed' })
                .eq('id', order)
                .in('status', ['open', 'submitted'])
            )
          beep(440, 0.2)
        } else {
          beep(880, 0.4)
          fetchPending()
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchPending])

  const approveGroup = async (orderId, itemIds) => {
    setLoading(true)
    try {
      const { error } = await supabase
        .from('pos_order_items')
        .update({ item_status: 'confirmed', sent_to_kitchen: true })
        .in('id', itemIds)
      if (error) throw error

      await supabase
        .from('pos_orders')
        .update({ status: 'confirmed' })
        .eq('id', orderId)
        .in('status', ['open', 'submitted'])

      toast.success('已送往廚房')
      fetchPending()
    } catch (e) {
      toast.error('操作失敗：' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const rejectGroup = async (itemIds) => {
    setLoading(true)
    try {
      const { error } = await supabase
        .from('pos_order_items')
        .update({ item_status: 'cancelled' })
        .in('id', itemIds)
      if (error) throw error
      toast.success('已拒絕點餐')
      fetchPending()
    } catch (e) {
      toast.error('操作失敗：' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const totalPending = groups.reduce((s, g) => s + g.items.length, 0)
  const hasItems     = totalPending > 0

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          position:   'relative',
          background: hasItems ? 'var(--accent-orange-dim)' : 'var(--bg-tertiary)',
          border:     `1px solid ${hasItems ? 'var(--accent-orange)' : 'var(--border-primary)'}`,
          color:      hasItems ? 'var(--accent-orange)' : 'var(--text-secondary)',
          borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 13, fontWeight: 600,
        }}
      >
        <Bell size={14} />
        QR 點餐
        {hasItems && (
          <span style={{
            background: 'var(--accent-orange)', color: '#fff',
            borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700,
          }}>
            {totalPending}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }}
          />
          <div style={{
            position: 'relative', zIndex: 1, width: 380,
            background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-primary)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{
              padding: '14px 20px', borderBottom: '1px solid var(--border-primary)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>QR 自助點餐</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {hasItems ? `${totalPending} 筆待確認` : '目前無待確認點餐'}
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
                >
                  <X size={18} />
                </button>
              </div>
              {/* Auto-confirm toggle */}
              <label style={{
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                cursor: 'pointer', color: 'var(--text-secondary)',
                padding: '6px 10px', borderRadius: 8,
                background: autoConfirm ? 'var(--accent-green-dim)' : 'var(--bg-primary)',
                border: `1px solid ${autoConfirm ? 'var(--accent-green)' : 'var(--border-primary)'}`,
              }}>
                <input
                  type="checkbox"
                  checked={autoConfirm}
                  onChange={e => setAutoConfirm(e.target.checked)}
                  style={{ accentColor: 'var(--accent-green)' }}
                />
                <span style={{ fontWeight: 600, color: autoConfirm ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                  {autoConfirm ? '自動確認模式 ON' : '手動確認模式'}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {autoConfirm ? '(點餐自動送廚)' : '(需人工審核)'}
                </span>
              </label>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {!hasItems ? (
                <div style={{ textAlign: 'center', paddingTop: 56, color: 'var(--text-muted)', fontSize: 14 }}>
                  目前無待確認的 QR 點餐
                </div>
              ) : (
                groups.map(group => (
                  <div key={group.orderId} style={{
                    background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                    borderRadius: 10, padding: 16, marginBottom: 12,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                        {group.tableNumber ? `桌號 T${group.tableNumber}` : '無桌號'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>#{group.orderNumber}</div>
                    </div>

                    {group.items.map((item, idx) => (
                      <div key={item.id} style={{
                        display: 'flex', justifyContent: 'space-between',
                        padding: '6px 0',
                        borderBottom: idx < group.items.length - 1 ? '1px solid var(--border-primary)' : 'none',
                        fontSize: 13, color: 'var(--text-secondary)',
                      }}>
                        <span>{item.name} × {item.quantity}</span>
                        <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
                          ${(item.unit_price * item.quantity).toLocaleString()}
                        </span>
                      </div>
                    ))}

                    {group.items[0]?.note && (
                      <div style={{
                        marginTop: 8, fontSize: 12, color: 'var(--accent-orange)',
                        padding: '4px 8px', background: 'var(--accent-orange-dim)', borderRadius: 6,
                      }}>
                        備註：{group.items[0].note}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button
                        disabled={loading}
                        onClick={() => approveGroup(group.orderId, group.items.map(i => i.id))}
                        style={{
                          flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                          background: 'var(--accent-green)', color: '#fff',
                          fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          opacity: loading ? 0.6 : 1,
                        }}
                      >
                        <ChefHat size={14} /> 送往廚房
                      </button>
                      <button
                        disabled={loading}
                        onClick={() => rejectGroup(group.items.map(i => i.id))}
                        style={{
                          padding: '8px 12px', borderRadius: 8,
                          border: '1px solid var(--border-primary)',
                          background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                          fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', gap: 6,
                          opacity: loading ? 0.6 : 1,
                        }}
                      >
                        <Trash2 size={14} /> 拒絕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
