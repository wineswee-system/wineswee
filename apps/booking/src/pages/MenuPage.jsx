import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

export default function MenuPage() {
  const { storeId, tableId } = useParams()
  const [searchParams]       = useSearchParams()
  const token                = searchParams.get('token')

  const [tab,       setTab]       = useState('menu')
  const [cats,      setCats]      = useState([])
  const [selCat,    setSelCat]    = useState(null)
  const [menuItems, setMenuItems] = useState([])
  const [products,  setProducts]  = useState([])
  const [cart,      setCart]      = useState([])   // [{ item, qty, note }]
  const [note,      setNote]      = useState('')
  const [loading,   setLoading]   = useState(true)
  const [tokenOk,   setTokenOk]   = useState(false)
  const [orderId,   setOrderId]   = useState(null)
  const [sending,   setSending]   = useState(false)
  const [sent,      setSent]      = useState(false)
  const [error,     setError]     = useState('')

  // Validate token + load initial data
  useEffect(() => {
    if (!token || !storeId || !tableId) { setLoading(false); return }
    async function init() {
      const { data: session } = await supabase
        .from('qr_order_sessions')
        .select('id, order_id, expires_at, revoked_at')
        .eq('token', token)
        .eq('store_id', storeId)
        .eq('table_id', tableId)
        .maybeSingle()

      if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
        setError('此 QR 碼已失效或過期，請洽詢服務人員')
        setLoading(false)
        return
      }

      setTokenOk(true)
      setOrderId(session.order_id)

      const [{ data: catData }, { data: prodData }] = await Promise.all([
        supabase
          .from('pos_menu_categories')
          .select('id, name, display_order')
          .eq('store_id', storeId)
          .eq('is_active', true)
          .order('display_order'),
        supabase
          .from('pos_products')
          .select('id, name, retail_price, tax_rate, image_url')
          .eq('store_id', storeId)
          .eq('is_available', true)
          .eq('show_in_qr_menu', true)
          .order('name'),
      ])
      setCats(catData ?? [])
      setProducts(prodData ?? [])
      setLoading(false)
    }
    init()
  }, [token, storeId, tableId])

  // Load menu items when category changes
  useEffect(() => {
    if (!storeId || !tokenOk) return
    let q = supabase
      .from('pos_menu_items')
      .select('id, name, description, unit_price, tax_rate, image_url')
      .eq('store_id', storeId)
      .eq('is_available', true)
      .order('display_order')
    if (selCat) q = q.eq('category_id', selCat)
    q.then(({ data }) => setMenuItems(data ?? []))
  }, [storeId, selCat, tokenOk])

  function cartQty(itemId) {
    return cart.find(c => c.item.id === itemId)?.qty ?? 0
  }

  function addToCart(item) {
    setCart(c => {
      const ex = c.find(x => x.item.id === item.id)
      if (ex) return c.map(x => x.item.id === item.id ? { ...x, qty: x.qty + 1 } : x)
      return [...c, { item, qty: 1, note: '' }]
    })
  }

  function removeFromCart(itemId) {
    setCart(c => {
      const ex = c.find(x => x.item.id === itemId)
      if (!ex) return c
      if (ex.qty <= 1) return c.filter(x => x.item.id !== itemId)
      return c.map(x => x.item.id === itemId ? { ...x, qty: x.qty - 1 } : x)
    })
  }

  const cartTotal = cart.reduce((s, c) => {
    return s + (c.item.unit_price ?? c.item.retail_price ?? 0) * c.qty
  }, 0)

  async function handleSubmit() {
    if (!cart.length || !orderId) return
    setSending(true)
    setError('')
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-guest-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON}`,
        },
        body: JSON.stringify({
          token,
          storeId,
          tableId,
          orderId,
          items: cart.map(c => ({
            itemType:     c.item.unit_price !== undefined ? 'menu' : 'product',
            menuItemId:   c.item.unit_price !== undefined ? c.item.id : null,
            posProductId: c.item.unit_price !== undefined ? null : c.item.id,
            name:         c.item.name,
            unitPrice:    c.item.unit_price ?? c.item.retail_price,
            taxRate:      c.item.tax_rate ?? 0.05,
            quantity:     c.qty,
            note:         c.note,
          })),
          note,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setCart([])
      setNote('')
      setSent(true)
      setTimeout(() => setSent(false), 5000)
    } catch (e) {
      setError(`送出失敗：${e.message}`)
    } finally {
      setSending(false)
    }
  }

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return <div style={S.center}>載入中…</div>
  }

  if (!tokenOk) {
    return (
      <div style={S.center}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 16, color: '#374151', textAlign: 'center', maxWidth: 240 }}>{error || '無效的 QR 碼'}</div>
      </div>
    )
  }

  const displayItems = tab === 'menu' ? menuItems : products

  // ── Main UI ───────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ background: '#fff', padding: '14px 20px', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>自助點餐</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>桌號 {tableId?.slice(-4) ?? '?'}</div>
      </div>

      {/* Tab switcher */}
      <div style={{ background: '#fff', padding: '0 20px', borderBottom: '1px solid #e2e8f0', display: 'flex' }}>
        {[['menu', '菜單'], ['product', '商品']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '11px 20px', border: 'none', background: 'transparent',
            borderBottom: `2px solid ${tab === key ? '#0891b2' : 'transparent'}`,
            fontSize: 14, fontWeight: tab === key ? 700 : 400,
            color: tab === key ? '#0891b2' : '#6b7280', cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>

      {/* Category chips (menu only) */}
      {tab === 'menu' && cats.length > 0 && (
        <div style={{ padding: '10px 16px', display: 'flex', gap: 8, overflowX: 'auto', background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
          {[{ id: null, name: '全部' }, ...cats].map(cat => (
            <button key={cat.id ?? 'all'} onClick={() => setSelCat(cat.id)} style={{
              padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              background: selCat === cat.id ? '#0891b2' : '#f1f5f9',
              color: selCat === cat.id ? '#fff' : '#374151',
              fontSize: 13, fontWeight: selCat === cat.id ? 600 : 400,
            }}>{cat.name}</button>
          ))}
        </div>
      )}

      {/* Item list */}
      <div style={{ flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {displayItems.map(item => {
          const price = item.unit_price ?? item.retail_price ?? 0
          const qty   = cartQty(item.id)
          return (
            <div key={item.id} style={{ background: '#fff', borderRadius: 12, padding: 14, display: 'flex', gap: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              {item.image_url && (
                <div style={{ width: 72, height: 72, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
                  <img src={item.image_url} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{item.name}</div>
                {item.description && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{item.description}</div>}
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0891b2', marginTop: 6 }}>${price}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {qty > 0 && (
                  <>
                    <Btn onClick={() => removeFromCart(item.id)}>−</Btn>
                    <span style={{ fontSize: 16, fontWeight: 700, minWidth: 20, textAlign: 'center' }}>{qty}</span>
                  </>
                )}
                <Btn primary onClick={() => addToCart(item)}>+</Btn>
              </div>
            </div>
          )
        })}
        {displayItems.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 48, color: '#9ca3af', fontSize: 14 }}>暫無品項</div>
        )}
      </div>

      {/* Cart bar */}
      {cart.length > 0 && (
        <div style={{ position: 'sticky', bottom: 0, background: '#fff', padding: '14px 20px', borderTop: '1px solid #e2e8f0', boxShadow: '0 -4px 16px rgba(0,0,0,0.08)' }}>
          <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {cart.map(c => (
              <div key={c.item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#374151' }}>
                <span>{c.item.name} ×{c.qty}</span>
                <span>${((c.item.unit_price ?? c.item.retail_price ?? 0) * c.qty).toLocaleString()}</span>
              </div>
            ))}
          </div>

          <textarea
            value={note} onChange={e => setNote(e.target.value)}
            placeholder="備註（過敏、特殊需求…）"
            rows={2}
            style={{ width: '100%', marginBottom: 10, padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, resize: 'none', outline: 'none', boxSizing: 'border-box', color: '#111827' }}
          />

          {error && <div style={{ marginBottom: 8, fontSize: 13, color: '#dc2626' }}>{error}</div>}
          {sent  && <div style={{ marginBottom: 8, fontSize: 13, color: '#16a34a', fontWeight: 600 }}>✅ 已送出！服務人員正在確認您的點餐</div>}

          <button
            onClick={handleSubmit}
            disabled={sending}
            style={{ background: sending ? '#e2e8f0' : '#0891b2', color: sending ? '#9ca3af' : '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer', width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 20px', boxSizing: 'border-box' }}
          >
            <span>{sending ? '送出中…' : '送出點餐'}</span>
            <span>${cartTotal.toLocaleString()}</span>
          </button>
        </div>
      )}
    </div>
  )
}

const S = {
  center: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    color: '#6b7280', fontSize: 15, background: '#f1f5f9',
    fontFamily: 'system-ui, sans-serif',
  },
}

function Btn({ onClick, primary, children }) {
  return (
    <button onClick={onClick} style={{
      width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
      background: primary ? '#0891b2' : '#f1f5f9',
      color: primary ? '#fff' : '#374151',
      fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {children}
    </button>
  )
}
