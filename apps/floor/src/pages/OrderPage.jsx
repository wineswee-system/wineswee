import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { useStore } from '../contexts/StoreContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  getTable, getOrCreateOrder, getOrderItems,
  getMenuCategories, getMenuItems, getPosProducts, getPosProductByBarcode,
  addOrderItem, updateOrderItemQty, cancelOrderItem,
  submitToKitchen, mergeOrders, createQrSession, getOpenOrders, getLastPayment,
} from '../lib/posDb'
import PaymentModal from '../components/PaymentModal'
import { printKitchenTicket, printCancelTicket, printProductPullTicket, printReceipt } from '../lib/sunmiPrint'

export default function OrderPage() {
  const { tableId } = useParams()
  const { storeId } = useStore()
  const { employee } = useAuth()
  const navigate = useNavigate()

  const orgId = employee?.organization_id

  const [table, setTable]               = useState(null)
  const [order, setOrder]               = useState(null)
  const [orderItems, setOrderItems]     = useState([])
  const [tab, setTab]                   = useState('menu')
  const [categories, setCategories]     = useState([])
  const [selCategory, setSelCategory]   = useState(null)
  const [menuItems, setMenuItems]       = useState([])
  const [products, setProducts]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [submitting, setSubmitting]     = useState(false)
  const [scanFeedback, setScanFeedback] = useState('')

  const [showPayment,   setShowPayment]   = useState(false)
  const [showMerge,     setShowMerge]     = useState(false)
  const [mergeList,     setMergeList]     = useState([])
  const [qrSession,     setQrSession]     = useState(null)
  const [confirmCancel, setConfirmCancel] = useState(null)
  const [qrApproveMode, setQrApproveMode] = useState('manual') // 'manual' | 'auto'

  const stateRef = useRef({})
  stateRef.current = { order, orderItems, storeId, table, qrApproveMode }

  useEffect(() => {
    if (!storeId || !orgId || !tableId) return
    async function init() {
      setLoading(true)
      const [{ data: tbl }, { data: cats }] = await Promise.all([
        getTable(tableId),
        getMenuCategories(storeId),
      ])
      setTable(tbl)
      setCategories(cats ?? [])
      const { data: ord } = await getOrCreateOrder(storeId, orgId, tableId, employee?.id)
      setOrder(ord)
      if (ord) {
        const { data: items } = await getOrderItems(ord.id)
        setOrderItems(items ?? [])
      }

      // Load QR approval mode for auto-confirm behaviour
      const { data: settings } = await supabase
        .from('pos_store_settings')
        .select('qr_approval_mode')
        .eq('store_id', storeId)
        .maybeSingle()
      if (settings?.qr_approval_mode) setQrApproveMode(settings.qr_approval_mode)

      setLoading(false)
    }
    init()
  }, [storeId, orgId, tableId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!storeId) return
    getMenuItems(storeId, selCategory).then(({ data }) => setMenuItems(data ?? []))
  }, [storeId, selCategory])

  useEffect(() => {
    if (tab !== 'product' || !storeId) return
    getPosProducts(storeId).then(({ data }) => setProducts(data ?? []))
  }, [tab, storeId])

  // Realtime: guest self-order additions
  // When qr_approval_mode = 'auto', new guest items are sent to kitchen immediately.
  // When 'manual' (default), staff sees the 🔔 banner and taps ✓ to confirm.
  useEffect(() => {
    if (!order?.id) return
    const orderId = order.id
    const ch = supabase
      .channel(`pos-order-${orderId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'pos_order_items',
        filter: `order_id=eq.${orderId}`,
      }, async (payload) => {
        const { data: fresh } = await getOrderItems(orderId)
        setOrderItems(fresh ?? [])

        // Auto-confirm: if the new item is from guest and mode is auto, send to kitchen
        const { qrApproveMode: mode, order: ord, table: tbl } = stateRef.current
        if (mode === 'auto' && payload.new?.source === 'guest' && !payload.new?.sent_to_kitchen) {
          await submitToKitchen(orderId)
          const guestItems = (fresh ?? []).filter(i => i.source === 'guest' && !i.sent_to_kitchen)
          if (guestItems.length > 0) await printKitchenTicket(ord, tbl, guestItems, '客人點餐')
          const { data: confirmed } = await getOrderItems(orderId)
          setOrderItems(confirmed ?? [])
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'pos_order_items',
        filter: `order_id=eq.${orderId}`,
      }, async () => {
        const { data } = await getOrderItems(orderId)
        setOrderItems(data ?? [])
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [order?.id])

  // Barcode scanner (Sunmi D2 rapid keydown → Enter)
  useEffect(() => {
    if (tab !== 'product') return
    let buf = '', last = 0
    function onKey(e) {
      const now = performance.now()
      if (now - last > 100) buf = ''
      last = now
      if (e.key === 'Enter') {
        if (buf.length >= 3) handleBarcodeScanned(buf)
        buf = ''
      } else if (e.key.length === 1) {
        buf += e.key
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBarcodeScanned(barcode) {
    const { order: ord, storeId: sid } = stateRef.current
    if (!ord?.id) return
    const { data: product } = await getPosProductByBarcode(sid, barcode)
    if (!product) {
      setScanFeedback(`找不到條碼：${barcode}`)
      setTimeout(() => setScanFeedback(''), 2500)
      return
    }
    await addOrIncrement(ord.id, 'product', product)
    setScanFeedback(`已加入：${product.name}`)
    setTimeout(() => setScanFeedback(''), 1500)
  }

  async function addOrIncrement(orderId, type, item) {
    const existing = type === 'menu'
      ? orderItems.find(i => i.menu_item_id === item.id)
      : orderItems.find(i => i.pos_product_id === item.id)
    if (existing) {
      await updateOrderItemQty(existing.id, existing.quantity + 1)
    } else {
      const price = type === 'menu' ? item.unit_price : item.retail_price
      await addOrderItem(orderId, {
        itemType: type,
        menuItemId:   type === 'menu'    ? item.id : undefined,
        posProductId: type === 'product' ? item.id : undefined,
        name: item.name, unitPrice: price, taxRate: item.tax_rate,
      })
    }
    refreshItems()
  }

  async function refreshItems() {
    if (!order?.id) return
    const { data } = await getOrderItems(order.id)
    setOrderItems(data ?? [])
  }

  async function handleQtyChange(item, delta) {
    await updateOrderItemQty(item.id, item.quantity + delta)
    refreshItems()
  }

  function handleCancel(item) {
    if (item.sent_to_kitchen) {
      setConfirmCancel(item)
    } else {
      cancelOrderItem(item.id).then(refreshItems)
    }
  }

  async function confirmCancelItem(item) {
    const { order: ord, table: tbl } = stateRef.current
    await cancelOrderItem(item.id)
    await printCancelTicket(item, ord, tbl)
    setConfirmCancel(null)
    refreshItems()
  }

  async function handleKitchen() {
    if (!order?.id || submitting) return
    const unsent = orderItems.filter(i => !i.sent_to_kitchen)
    if (!unsent.length) return
    setSubmitting(true)

    const foodItems = unsent.filter(i => i.item_type === 'menu')
    const prodItems = unsent.filter(i => i.item_type !== 'menu')

    await submitToKitchen(order.id)
    await refreshItems()

    if (foodItems.length) await printKitchenTicket(order, table, foodItems)
    if (prodItems.length) await printProductPullTicket(order, table, prodItems)

    setSubmitting(false)
  }

  async function handleGuestConfirm(item) {
    await submitToKitchen(order.id)
    await printKitchenTicket(order, table, [item], '客人點餐')
    refreshItems()
  }

  async function handleGenerateQr() {
    if (!order?.id) return
    const { data: session } = await createQrSession(storeId, orgId, tableId, order.id)
    if (session) {
      const base = import.meta.env.VITE_BOOKING_URL ?? window.location.origin
      const url  = `${base}/menu/${storeId}/${tableId}?token=${session.token}`
      setQrSession({ token: session.token, url })
    }
  }

  async function handleReprint() {
    if (!order?.id) return
    const { data: pay } = await getLastPayment(order.id)
    if (!pay) return
    await printReceipt({ storeName: '', order, table, items: orderItems, payment: pay })
  }

  async function handleOpenMerge() {
    const { data } = await getOpenOrders(storeId)
    setMergeList((data ?? []).filter(o => o.id !== order?.id))
    setShowMerge(true)
  }

  async function handleMerge(sourceOrderId) {
    if (!order?.id) return
    await mergeOrders(sourceOrderId, order.id)
    setShowMerge(false)
    refreshItems()
  }

  const subtotal     = orderItems.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  const unsentCount  = orderItems.filter(i => !i.sent_to_kitchen).length
  const guestPending = orderItems.filter(i => i.source === 'guest' && !i.sent_to_kitchen)
  const isWalkIn     = !order?.reservation_id

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280', background: '#f1f5f9', fontSize: 15 }}>
        載入中…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f1f5f9', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', height: 56, background: '#fff', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
        <button onClick={() => navigate('/seating')} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '0 4px' }}>←</button>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>T{table?.table_number}</span>
          <span style={{ fontSize: 13, color: '#6b7280' }}>{table?.capacity}人桌</span>
          {order?.order_number && <span style={{ fontSize: 12, color: '#9ca3af' }}>#{order.order_number}</span>}
        </div>

        <div style={{ display: 'flex', gap: 4, marginLeft: 20, background: '#f1f5f9', borderRadius: 8, padding: 3 }}>
          {[['menu', '菜單'], ['product', '商品']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              background: tab === key ? '#fff' : 'transparent',
              color: tab === key ? '#0891b2' : '#6b7280',
              border: 'none', borderRadius: 6, padding: '5px 18px',
              fontSize: 14, fontWeight: tab === key ? 700 : 400, cursor: 'pointer',
              boxShadow: tab === key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
            }}>{label}</button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {isWalkIn && !qrSession && (
            <IconBtn onClick={handleGenerateQr} title="生成 QR 自助點餐">📱</IconBtn>
          )}
          {qrSession && <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>QR 已產生</span>}
          <IconBtn onClick={handleOpenMerge} title="合併桌">🔁</IconBtn>
          <IconBtn onClick={handleReprint} title="重印收據">🖨</IconBtn>
          <span style={{ fontSize: 13, color: '#6b7280' }}>{employee?.name}</span>
        </div>
      </div>

      {guestPending.length > 0 && (
        <div style={{ padding: '8px 20px', background: '#fdf4ff', borderBottom: '1px solid #e9d5ff', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 18 }}>🔔</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed' }}>客人新增 {guestPending.length} 項待確認</span>
        </div>
      )}

      {/* ── Main body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {tab === 'menu' && (
          <div style={{ width: 108, flexShrink: 0, background: '#fff', borderRight: '1px solid #e2e8f0', overflowY: 'auto' }}>
            {[{ id: null, name: '全部' }, ...categories].map(cat => (
              <button key={cat.id ?? 'all'} onClick={() => setSelCategory(cat.id)} style={{
                display: 'block', width: '100%', padding: '13px 14px', textAlign: 'left',
                border: 'none', cursor: 'pointer',
                background: selCategory === cat.id ? '#e0f2fe' : 'transparent',
                borderLeft: `3px solid ${selCategory === cat.id ? '#0891b2' : 'transparent'}`,
                fontSize: 14, color: selCategory === cat.id ? '#0369a1' : '#374151',
                fontWeight: selCategory === cat.id ? 700 : 400,
              }}>{cat.name}</button>
            ))}
          </div>
        )}

        <div style={{ flex: 1, padding: 14, overflowY: 'auto' }}>
          {tab === 'product' && (
            <div style={{
              marginBottom: 10, padding: '8px 14px', borderRadius: 8, fontSize: 13,
              background: scanFeedback ? (scanFeedback.startsWith('找不到') ? '#fef2f2' : '#f0fdf4') : '#eff6ff',
              border: `1px solid ${scanFeedback ? (scanFeedback.startsWith('找不到') ? '#fecaca' : '#bbf7d0') : '#bfdbfe'}`,
              color: scanFeedback ? (scanFeedback.startsWith('找不到') ? '#dc2626' : '#16a34a') : '#1e40af',
            }}>
              {scanFeedback || '掃描條碼自動加入，或點選下方商品'}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(138px, 1fr))', gap: 10 }}>
            {(tab === 'menu' ? menuItems : products).map(item => {
              const price   = tab === 'menu' ? item.unit_price : item.retail_price
              const inOrder = tab === 'menu'
                ? orderItems.find(o => o.menu_item_id === item.id)
                : orderItems.find(o => o.pos_product_id === item.id)
              return (
                <button key={item.id}
                  onClick={() => addOrIncrement(order?.id, tab === 'menu' ? 'menu' : 'product', item)}
                  style={{
                    background: '#fff', border: `2px solid ${inOrder ? '#0891b2' : '#e2e8f0'}`,
                    borderRadius: 10, padding: 12, cursor: 'pointer', textAlign: 'left',
                    display: 'flex', flexDirection: 'column', gap: 4, position: 'relative',
                  }}>
                  {inOrder && (
                    <span style={{
                      position: 'absolute', top: 7, right: 8, background: '#0891b2', color: '#fff',
                      borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '1px 7px',
                    }}>×{inOrder.quantity}</span>
                  )}
                  {item.image_url && (
                    <div style={{ width: '100%', height: 68, borderRadius: 6, overflow: 'hidden', marginBottom: 4 }}>
                      <img src={item.image_url} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  )}
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', lineHeight: 1.3 }}>{item.name}</div>
                  <div style={{ fontSize: 13, color: '#0891b2', fontWeight: 700 }}>${price}</div>
                  {tab === 'product' && item.barcode && (
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{item.barcode}</div>
                  )}
                </button>
              )
            })}
            {(tab === 'menu' ? menuItems : products).length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', paddingTop: 48, color: '#9ca3af', fontSize: 14 }}>
                {tab === 'menu' ? '此分類暫無菜單' : '尚未設定商品，請在管理後台新增'}
              </div>
            )}
          </div>
        </div>

        {/* ── Order summary ── */}
        <div style={{ width: 296, flexShrink: 0, background: '#fff', borderLeft: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>訂單明細</span>
            {orderItems.length > 0 && (
              <span style={{ fontSize: 12, color: '#6b7280', background: '#f1f5f9', borderRadius: 10, padding: '2px 8px' }}>{orderItems.length} 品</span>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {orderItems.length === 0 && (
              <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', paddingTop: 36 }}>尚未點餐</div>
            )}
            {orderItems.map(item => {
              const isGuest  = item.source === 'guest'
              const guestNew = isGuest && !item.sent_to_kitchen
              return (
                <div key={item.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8,
                  background: guestNew ? '#fdf4ff' : item.sent_to_kitchen ? '#f9fafb' : '#eff6ff',
                  border: `1px solid ${guestNew ? '#e9d5ff' : item.sent_to_kitchen ? '#e2e8f0' : '#bfdbfe'}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {guestNew && '🔔 '}{item.name}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>${item.unit_price} × {item.quantity} = ${item.unit_price * item.quantity}</div>
                    {item.item_type === 'product' && (
                      <span style={{ fontSize: 10, background: '#e0f2fe', color: '#0369a1', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>商品</span>
                    )}
                    {item.item_type === 'custom' && (
                      <span style={{ fontSize: 10, background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>自訂</span>
                    )}
                  </div>

                  {guestNew && (
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <SmBtn color="#16a34a" onClick={() => handleGuestConfirm(item)}>✓</SmBtn>
                      <SmBtn color="#dc2626" onClick={() => handleCancel(item)}>✕</SmBtn>
                    </div>
                  )}

                  {!guestNew && !item.sent_to_kitchen && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <SmBtn onClick={() => handleQtyChange(item, -1)}>−</SmBtn>
                      <span style={{ fontSize: 14, fontWeight: 700, width: 22, textAlign: 'center', color: '#111827' }}>{item.quantity}</span>
                      <SmBtn onClick={() => handleQtyChange(item, +1)}>+</SmBtn>
                      <SmBtn color="#ef4444" onClick={() => handleCancel(item)}>✕</SmBtn>
                    </div>
                  )}

                  {!guestNew && item.sent_to_kitchen && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>已送出</span>
                      <SmBtn color="#ef4444" onClick={() => handleCancel(item)}>✕</SmBtn>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div style={{ padding: '12px 14px', borderTop: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 13, color: '#6b7280' }}>小計（含稅）</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: '#111827' }}>${subtotal.toLocaleString()}</span>
            </div>

            <button onClick={handleKitchen}
              disabled={unsentCount === 0 || submitting}
              style={{
                background: unsentCount > 0 ? '#f97316' : '#e2e8f0',
                color: unsentCount > 0 ? '#fff' : '#9ca3af',
                border: 'none', borderRadius: 9, padding: '11px 0',
                fontSize: 14, fontWeight: 700,
                cursor: unsentCount > 0 ? 'pointer' : 'not-allowed', width: '100%',
              }}>
              {submitting ? '送出中…' : unsentCount > 0 ? `送出廚房（${unsentCount} 項）` : '送出廚房'}
            </button>

            <button
              disabled={orderItems.length === 0}
              onClick={() => setShowPayment(true)}
              style={{
                background: orderItems.length > 0 ? '#0891b2' : '#e2e8f0',
                color: orderItems.length > 0 ? '#fff' : '#9ca3af',
                border: 'none', borderRadius: 9, padding: '11px 0',
                fontSize: 14, fontWeight: 700,
                cursor: orderItems.length > 0 ? 'pointer' : 'not-allowed', width: '100%',
              }}>
              結帳  ${subtotal.toLocaleString()}
            </button>
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {showPayment && (
        <PaymentModal
          order={order} table={table} items={orderItems}
          onClose={() => setShowPayment(false)}
          onPaid={() => { setShowPayment(false); navigate('/seating') }}
        />
      )}

      {showMerge && (
        <Overlay onClose={() => setShowMerge(false)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>🔁 合併桌</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>選擇要合併到本桌的來源桌：</div>
            {mergeList.length === 0
              ? <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>沒有其他可合併的訂單</div>
              : mergeList.map(o => (
                <button key={o.id} onClick={() => handleMerge(o.id)}
                  style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 16px', cursor: 'pointer', textAlign: 'left', fontSize: 14, color: '#111827' }}>
                  <strong>T{o.res_tables?.table_number ?? '?'}</strong>
                  {o.order_number ? ` — #${o.order_number}` : ''}
                </button>
              ))
            }
            <button onClick={() => setShowMerge(false)}
              style={{ background: '#e2e8f0', color: '#374151', border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 14, cursor: 'pointer', width: '100%' }}>
              取消
            </button>
          </div>
        </Overlay>
      )}

      {confirmCancel && (
        <Overlay onClose={() => setConfirmCancel(null)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 320, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>取消已送出品項</div>
            <div style={{ fontSize: 14, color: '#374151' }}>
              <strong>{confirmCancel.name}</strong> 已送廚房。取消後會列印取消單通知廚房。
            </div>
            <button onClick={() => confirmCancelItem(confirmCancel)}
              style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 9, padding: '11px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
              確認取消並列印取消單
            </button>
            <button onClick={() => setConfirmCancel(null)}
              style={{ background: '#e2e8f0', color: '#374151', border: 'none', borderRadius: 9, padding: '10px 0', fontSize: 14, cursor: 'pointer', width: '100%' }}>
              不取消
            </button>
          </div>
        </Overlay>
      )}

      {qrSession && (
        <Overlay onClose={() => setQrSession(null)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 320, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>📱 QR 自助點餐</div>
            <div style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <QRCodeSVG value={qrSession.url} size={200} level="M" />
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'center' }}>讓顧客用手機掃描以自助點餐</div>
            <button
              onClick={() => { navigator.clipboard?.writeText(qrSession.url) }}
              style={{ background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, padding: '8px 0', fontSize: 13, cursor: 'pointer', width: '100%' }}>
              複製連結
            </button>
            <button onClick={() => setQrSession(null)}
              style={{ background: '#e2e8f0', color: '#374151', border: 'none', borderRadius: 9, padding: '10px 0', fontSize: 14, cursor: 'pointer', width: '100%' }}>
              關閉
            </button>
          </div>
        </Overlay>
      )}
    </div>
  )
}

function Overlay({ children, onClose }) {
  return (
    <div onClick={e => e.target === e.currentTarget && onClose?.()}
      style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </div>
  )
}

function IconBtn({ onClick, title, children }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 36, height: 36, borderRadius: 8, border: '1px solid #e2e8f0',
      background: '#fff', cursor: 'pointer', fontSize: 18,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {children}
    </button>
  )
}

function SmBtn({ onClick, color, children }) {
  return (
    <button onClick={onClick} style={{
      width: 26, height: 26, borderRadius: 6,
      border: color ? 'none' : '1px solid #e2e8f0',
      background: color ?? '#fff',
      color: color ? '#fff' : '#374151',
      cursor: 'pointer', fontSize: 14, lineHeight: 1,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {children}
    </button>
  )
}
