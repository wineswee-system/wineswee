import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useStore } from '../contexts/StoreContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  getTable,
  getOrCreateOrder,
  getOrderItems,
  getMenuCategories,
  getMenuItems,
  getPosProducts,
  getPosProductByBarcode,
  addOrderItem,
  updateOrderItemQty,
  submitToKitchen,
} from '../lib/posDb'

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

  // Stable ref so barcode handler always sees latest state without re-registering listeners
  const stateRef = useRef({})
  stateRef.current = { order, orderItems, storeId }

  // Initial load: table info + get/create order + menu categories
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
      setLoading(false)
    }
    init()
  }, [storeId, orgId, tableId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load menu items when category selection or storeId changes
  useEffect(() => {
    if (!storeId) return
    getMenuItems(storeId, selCategory).then(({ data }) => setMenuItems(data ?? []))
  }, [storeId, selCategory])

  // Load physical products when tab switches to 'product'
  useEffect(() => {
    if (tab !== 'product' || !storeId) return
    getPosProducts(storeId).then(({ data }) => setProducts(data ?? []))
  }, [tab, storeId])

  // Realtime: pick up guest self-order additions
  useEffect(() => {
    if (!order?.id) return
    const orderId = order.id
    async function refresh() {
      const { data } = await getOrderItems(orderId)
      setOrderItems(data ?? [])
    }
    const ch = supabase
      .channel(`pos-order-${orderId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pos_order_items',
        filter: `order_id=eq.${orderId}`,
      }, refresh)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [order?.id])

  // Barcode scanner: Sunmi D2 fires rapid keydown events ending with Enter
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
    const { order: ord, orderItems: items, storeId: sid } = stateRef.current
    if (!ord?.id) return
    const { data: product } = await getPosProductByBarcode(sid, barcode)
    if (!product) {
      setScanFeedback(`找不到條碼：${barcode}`)
      setTimeout(() => setScanFeedback(''), 2500)
      return
    }
    const existing = items.find(i => i.pos_product_id === product.id)
    if (existing) {
      await updateOrderItemQty(existing.id, existing.quantity + 1)
    } else {
      await addOrderItem(ord.id, {
        itemType: 'product', posProductId: product.id,
        name: product.name, unitPrice: product.retail_price, taxRate: product.tax_rate,
      })
    }
    setScanFeedback(`已加入：${product.name}`)
    setTimeout(() => setScanFeedback(''), 1500)
    const { data } = await getOrderItems(ord.id)
    setOrderItems(data ?? [])
  }

  async function refreshItems() {
    if (!order?.id) return
    const { data } = await getOrderItems(order.id)
    setOrderItems(data ?? [])
  }

  async function handleAddMenu(item) {
    if (!order?.id) return
    const existing = orderItems.find(i => i.menu_item_id === item.id)
    if (existing) {
      await updateOrderItemQty(existing.id, existing.quantity + 1)
    } else {
      await addOrderItem(order.id, {
        itemType: 'menu', menuItemId: item.id,
        name: item.name, unitPrice: item.unit_price, taxRate: item.tax_rate,
      })
    }
    refreshItems()
  }

  async function handleAddProduct(product) {
    if (!order?.id) return
    const existing = orderItems.find(i => i.pos_product_id === product.id)
    if (existing) {
      await updateOrderItemQty(existing.id, existing.quantity + 1)
    } else {
      await addOrderItem(order.id, {
        itemType: 'product', posProductId: product.id,
        name: product.name, unitPrice: product.retail_price, taxRate: product.tax_rate,
      })
    }
    refreshItems()
  }

  async function handleQtyChange(item, delta) {
    await updateOrderItemQty(item.id, item.quantity + delta)
    refreshItems()
  }

  async function handleKitchen() {
    if (!order?.id || submitting) return
    if (orderItems.filter(i => !i.sent_to_kitchen).length === 0) return
    setSubmitting(true)
    await submitToKitchen(order.id)
    await refreshItems()
    setSubmitting(false)
  }

  const subtotal    = orderItems.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  const unsentCount = orderItems.filter(i => !i.sent_to_kitchen).length
  const displayItems = tab === 'menu' ? menuItems : products

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
        <button onClick={() => navigate('/seating')} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '0 4px' }}>
          ←
        </button>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>T{table?.table_number}</span>
          <span style={{ fontSize: 13, color: '#6b7280' }}>{table?.capacity}人桌</span>
          {order?.order_number && (
            <span style={{ fontSize: 12, color: '#9ca3af' }}>#{order.order_number}</span>
          )}
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 20, background: '#f1f5f9', borderRadius: 8, padding: 3 }}>
          {[['menu', '菜單'], ['product', '商品']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              background: tab === key ? '#fff' : 'transparent',
              color: tab === key ? '#0891b2' : '#6b7280',
              border: 'none', borderRadius: 6, padding: '5px 18px',
              fontSize: 14, fontWeight: tab === key ? 700 : 400, cursor: 'pointer',
              boxShadow: tab === key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
            }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>{employee?.name}</div>
      </div>

      {/* ── Body: category | items | order ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Category sidebar (menu tab only) */}
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
              }}>
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {/* Item grid */}
        <div style={{ flex: 1, padding: 14, overflowY: 'auto' }}>
          {tab === 'product' && (
            <div style={{
              marginBottom: 10, padding: '8px 14px', borderRadius: 8, fontSize: 13,
              background: scanFeedback ? (scanFeedback.startsWith('找不到') ? '#fef2f2' : '#f0fdf4') : '#eff6ff',
              border: `1px solid ${scanFeedback ? (scanFeedback.startsWith('找不到') ? '#fecaca' : '#bbf7d0') : '#bfdbfe'}`,
              color: scanFeedback ? (scanFeedback.startsWith('找不到') ? '#dc2626' : '#16a34a') : '#1e40af',
              transition: 'background 0.2s, color 0.2s',
            }}>
              {scanFeedback || '掃描條碼自動加入，或點選下方商品'}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(138px, 1fr))', gap: 10 }}>
            {displayItems.map(item => {
              const price = tab === 'menu' ? item.unit_price : item.retail_price
              const inOrder = tab === 'menu'
                ? orderItems.find(o => o.menu_item_id === item.id)
                : orderItems.find(o => o.pos_product_id === item.id)
              return (
                <button key={item.id}
                  onClick={() => tab === 'menu' ? handleAddMenu(item) : handleAddProduct(item)}
                  style={{
                    background: '#fff',
                    border: `2px solid ${inOrder ? '#0891b2' : '#e2e8f0'}`,
                    borderRadius: 10, padding: 12, cursor: 'pointer', textAlign: 'left',
                    display: 'flex', flexDirection: 'column', gap: 4, position: 'relative',
                  }}>
                  {inOrder && (
                    <span style={{
                      position: 'absolute', top: 7, right: 8,
                      background: '#0891b2', color: '#fff',
                      borderRadius: 10, fontSize: 11, fontWeight: 700,
                      padding: '1px 7px', lineHeight: '16px',
                    }}>
                      ×{inOrder.quantity}
                    </span>
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

            {displayItems.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', paddingTop: 48, color: '#9ca3af', fontSize: 14 }}>
                {tab === 'menu' ? '此分類暫無菜單' : '尚未設定商品，可先在管理後台新增'}
              </div>
            )}
          </div>
        </div>

        {/* ── Order summary ── */}
        <div style={{ width: 296, flexShrink: 0, background: '#fff', borderLeft: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>訂單明細</span>
            {orderItems.length > 0 && (
              <span style={{ fontSize: 12, color: '#6b7280', background: '#f1f5f9', borderRadius: 10, padding: '2px 8px' }}>
                {orderItems.length} 品
              </span>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {orderItems.length === 0 && (
              <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', paddingTop: 36 }}>尚未點餐</div>
            )}
            {orderItems.map(item => (
              <div key={item.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
                background: item.sent_to_kitchen ? '#f9fafb' : '#eff6ff',
                border: `1px solid ${item.sent_to_kitchen ? '#e2e8f0' : '#bfdbfe'}`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    ${item.unit_price} × {item.quantity} = ${item.unit_price * item.quantity}
                  </div>
                  {item.source === 'guest' && (
                    <div style={{ fontSize: 11, color: '#8b5cf6', fontWeight: 600 }}>顧客點餐</div>
                  )}
                </div>

                {item.sent_to_kitchen ? (
                  <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600, flexShrink: 0 }}>已送出</span>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <SmBtn onClick={() => handleQtyChange(item, -1)}>−</SmBtn>
                    <span style={{ fontSize: 14, fontWeight: 700, width: 22, textAlign: 'center', color: '#111827' }}>
                      {item.quantity}
                    </span>
                    <SmBtn onClick={() => handleQtyChange(item, +1)}>+</SmBtn>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Totals + actions */}
          <div style={{ padding: '12px 14px', borderTop: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 13, color: '#6b7280' }}>小計（未含稅）</span>
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
    </div>
  )
}

function SmBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{
      width: 26, height: 26, borderRadius: 6, border: '1px solid #e2e8f0',
      background: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151',
    }}>
      {children}
    </button>
  )
}
