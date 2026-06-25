import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

// ── Styles (inline — this page runs outside the main app theme/CSS) ──────────
const S = {
  page:      { minHeight: '100dvh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif', color: '#111827' },
  header:    { background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '14px 20px', position: 'sticky', top: 0, zIndex: 10 },
  h1:        { margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' },
  sub:       { margin: '2px 0 0', fontSize: 13, color: '#6b7280' },
  catBar:    { display: 'flex', gap: 8, padding: '10px 16px', overflowX: 'auto', background: '#fff', borderBottom: '1px solid #e2e8f0', scrollbarWidth: 'none' },
  catBtn:    (active) => ({
    flexShrink: 0, padding: '7px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 400,
    background: active ? '#0891b2' : '#f1f5f9', color: active ? '#fff' : '#374151', transition: 'all 0.15s',
  }),
  grid:      { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, padding: 16 },
  card:      (inCart) => ({
    background: '#fff', border: `2px solid ${inCart ? '#0891b2' : '#e2e8f0'}`,
    borderRadius: 12, overflow: 'hidden', cursor: 'pointer', position: 'relative',
    boxShadow: inCart ? '0 0 0 3px rgba(8,145,178,0.15)' : 'none', transition: 'all 0.15s',
  }),
  img:       { width: '100%', height: 110, objectFit: 'cover', display: 'block' },
  imgPlaceholder: { width: '100%', height: 80, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#d1d5db' },
  cardBody:  { padding: '8px 12px 10px' },
  itemName:  { fontSize: 14, fontWeight: 600, color: '#111827', lineHeight: 1.3, marginBottom: 2 },
  itemDesc:  { fontSize: 12, color: '#9ca3af', lineHeight: 1.4, marginBottom: 6, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
  itemPrice: { fontSize: 15, fontWeight: 700, color: '#0891b2' },
  badge:     { position: 'absolute', top: 8, right: 8, background: '#0891b2', color: '#fff', borderRadius: 12, fontSize: 12, fontWeight: 700, padding: '2px 8px' },
  qtyRow:    { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 6 },
  qtyBtn:    (color) => ({
    width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
    background: color ?? '#f1f5f9', color: color ? '#fff' : '#374151',
    fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0,
  }),
  footer:    { position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e2e8f0', padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center' },
  submitBtn: (disabled) => ({
    flex: 1, padding: '13px 0', borderRadius: 10, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? '#e2e8f0' : '#0891b2', color: disabled ? '#9ca3af' : '#fff',
    fontSize: 16, fontWeight: 700, transition: 'background 0.15s',
  }),
  totalChip: { fontSize: 14, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap' },
  center:    { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', padding: 24, gap: 16, textAlign: 'center' },
  noteInput: { width: '100%', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 14, outline: 'none', resize: 'none', boxSizing: 'border-box' },
}

export default function GuestMenu() {
  const { storeId, tableId } = useParams()
  const [searchParams]       = useSearchParams()
  const token                = searchParams.get('token')

  const [phase,      setPhase]      = useState('loading') // loading | error | menu | submitting | done
  const [errMsg,     setErrMsg]     = useState('')
  const [orderId,    setOrderId]    = useState(null)
  const [storeName,  setStoreName]  = useState('')
  const [tableNo,    setTableNo]    = useState('')
  const [categories, setCategories] = useState([])
  const [items,      setItems]      = useState([])
  const [selCat,     setSelCat]     = useState(null)
  const [cart,       setCart]       = useState({})   // { menuItemId: quantity }
  const [note,       setNote]       = useState('')
  const [showNote,   setShowNote]   = useState(false)

  // ── Boot: validate token + load data ──────────────────────────────────────
  useEffect(() => {
    if (!token || !storeId || !tableId) {
      setErrMsg('連結無效，請請店員重新產生 QR 碼')
      setPhase('error')
      return
    }
    async function boot() {
      // 1. Validate QR session (anon read via RLS policy added in 20260625000001_pos_guest_rls)
      const { data: session } = await supabase
        .from('qr_order_sessions')
        .select('order_id, expires_at')
        .eq('token', token)
        .eq('store_id', storeId)
        .eq('table_id', tableId)
        .maybeSingle()

      if (!session) {
        setErrMsg('QR 碼無效或已失效，請請店員重新產生')
        setPhase('error')
        return
      }
      if (new Date(session.expires_at) < new Date()) {
        setErrMsg('QR 碼已過期，請請店員重新產生')
        setPhase('error')
        return
      }
      setOrderId(session.order_id)

      // 2. Load store name + table number
      const [{ data: store }, { data: table }] = await Promise.all([
        supabase.from('stores').select('name').eq('id', storeId).maybeSingle(),
        supabase.from('res_tables').select('table_number').eq('id', tableId).maybeSingle(),
      ])
      setStoreName(store?.name ?? '')
      setTableNo(table?.table_number ?? '')

      // 3. Load menu categories + all available items
      const [{ data: cats }, { data: menuItems }] = await Promise.all([
        supabase.from('pos_menu_categories').select('id, name, display_order').eq('store_id', storeId).eq('is_active', true).order('display_order'),
        supabase.from('pos_menu_items').select('id, name, description, unit_price, tax_rate, image_url, category_id').eq('store_id', storeId).eq('is_available', true).order('display_order'),
      ])
      setCategories(cats ?? [])
      setItems(menuItems ?? [])
      setPhase('menu')
    }
    boot().catch(() => {
      setErrMsg('載入失敗，請重新整理頁面')
      setPhase('error')
    })
  }, [token, storeId, tableId])

  const visibleItems = selCat ? items.filter(i => i.category_id === selCat) : items
  const cartEntries  = Object.entries(cart).filter(([, qty]) => qty > 0)
  const cartTotal    = cartEntries.reduce((s, [id, qty]) => {
    const item = items.find(i => i.id === id)
    return s + (item ? item.unit_price * qty : 0)
  }, 0)
  const cartCount    = cartEntries.reduce((s, [, qty]) => s + qty, 0)

  const setQty = useCallback((itemId, delta, cur) => {
    const next = Math.max(0, (cur || 0) + delta)
    setCart(c => ({ ...c, [itemId]: next }))
  }, [])

  async function handleSubmit() {
    if (cartCount === 0 || !orderId) return
    setPhase('submitting')
    setErrMsg('')

    const orderItems = cartEntries.map(([id, qty]) => {
      const item = items.find(i => i.id === id)
      return {
        itemType:    'menu',
        menuItemId:   id,
        posProductId: null,
        name:         item.name,
        unitPrice:    item.unit_price,
        taxRate:      item.tax_rate,
        quantity:     qty,
        note:         note.trim(),
      }
    })

    const { error } = await supabase.functions.invoke('submit-guest-order', {
      body: { token, storeId, tableId, orderId, items: orderItems, note: note.trim() },
    })

    if (error) {
      setErrMsg(error.message || '送出失敗，請稍後再試')
      setPhase('menu')
      return
    }
    setPhase('done')
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (phase === 'error') return (
    <div style={S.page}>
      <div style={S.center}>
        <div style={{ fontSize: 52 }}>❌</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#dc2626' }}>無法載入菜單</div>
        <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>{errMsg}</div>
      </div>
    </div>
  )

  // ── Loading ────────────────────────────────────────────────────────────────
  if (phase === 'loading') return (
    <div style={S.page}>
      <div style={S.center}>
        <Spinner />
        <div style={{ fontSize: 14, color: '#6b7280' }}>載入菜單中…</div>
      </div>
    </div>
  )

  // ── Done ───────────────────────────────────────────────────────────────────
  if (phase === 'done') return (
    <div style={S.page}>
      <div style={S.center}>
        <div style={{ fontSize: 64 }}>✅</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>已送出點餐！</div>
        <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>
          店員確認後即送往廚房，感謝您的耐心等候 🍽️
        </div>
        <button
          onClick={() => { setCart({}); setNote(''); setPhase('menu') }}
          style={{ marginTop: 8, padding: '11px 28px', borderRadius: 10, border: 'none', background: '#0891b2', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          繼續點餐
        </button>
      </div>
    </div>
  )

  // ── Submitting ─────────────────────────────────────────────────────────────
  if (phase === 'submitting') return (
    <div style={S.page}>
      <div style={S.center}>
        <Spinner />
        <div style={{ fontSize: 14, color: '#6b7280' }}>送出中…</div>
      </div>
    </div>
  )

  // ── Menu ───────────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={S.h1}>{storeName || '自助點餐'}</h1>
            {tableNo && <p style={S.sub}>桌號 T{tableNo}</p>}
          </div>
          {cartCount > 0 && (
            <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: '4px 10px', fontSize: 13, fontWeight: 700, color: '#92400e', flexShrink: 0 }}>
              已選 {cartCount} 品
            </div>
          )}
        </div>
      </div>

      {/* Category tabs */}
      <div style={S.catBar}>
        <button style={S.catBtn(!selCat)} onClick={() => setSelCat(null)}>全部</button>
        {categories.map(c => (
          <button key={c.id} style={S.catBtn(selCat === c.id)} onClick={() => setSelCat(c.id)}>{c.name}</button>
        ))}
      </div>

      {/* Submit error banner */}
      {errMsg && phase === 'menu' && (
        <div style={{ margin: '8px 16px 0', padding: '10px 14px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', fontSize: 13, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}>{errMsg}</span>
          <button onClick={() => setErrMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Menu grid */}
      <div style={{ ...S.grid, paddingBottom: cartCount > 0 ? 96 : 16 }}>
        {visibleItems.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', paddingTop: 48, color: '#9ca3af', fontSize: 14 }}>此分類暫無品項</div>
        )}
        {visibleItems.map(item => {
          const qty = cart[item.id] || 0
          return (
            <div key={item.id} style={S.card(qty > 0)} onClick={() => setQty(item.id, 1, qty)}>
              {qty > 0 && <div style={S.badge}>×{qty}</div>}
              {item.image_url
                ? <img src={item.image_url} alt={item.name} style={S.img} />
                : <div style={S.imgPlaceholder}>🍽️</div>
              }
              <div style={S.cardBody}>
                <div style={S.itemName}>{item.name}</div>
                {item.description && <div style={S.itemDesc}>{item.description}</div>}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                  <span style={S.itemPrice}>${item.unit_price}</span>
                  {qty > 0 && (
                    <div style={S.qtyRow} onClick={e => e.stopPropagation()}>
                      <button style={S.qtyBtn('#ef4444')} onClick={() => setQty(item.id, -1, qty)}>−</button>
                      <span style={{ fontSize: 14, fontWeight: 700, width: 20, textAlign: 'center' }}>{qty}</span>
                      <button style={S.qtyBtn('#0891b2')} onClick={() => setQty(item.id, 1, qty)}>+</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Note input (floats above footer when shown) */}
      {showNote && (
        <div style={{ position: 'fixed', bottom: cartCount > 0 ? 74 : 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e2e8f0', padding: '10px 16px', zIndex: 9 }}>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="備註（例：不要蔥、少辣）"
            rows={2}
            style={S.noteInput}
            autoFocus
          />
        </div>
      )}

      {/* Footer */}
      {cartCount > 0 && (
        <div style={S.footer}>
          <button
            onClick={() => setShowNote(n => !n)}
            title="備註"
            style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: note ? '#0891b2' : '#6b7280' }}>
            📝
          </button>
          <span style={S.totalChip}>${cartTotal.toLocaleString()}</span>
          <button style={S.submitBtn(false)} onClick={handleSubmit}>
            送出點餐（{cartCount} 品）
          </button>
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <>
      <div style={{ width: 40, height: 40, border: '4px solid #e2e8f0', borderTopColor: '#0891b2', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </>
  )
}
