import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { kitchenPrinter } from '../../lib/kitchenPrinter'
import { useAuth, useOrgId } from '../../contexts/AuthContext'
import { useTenant } from '../../contexts/TenantContext'
import { toast } from '../../lib/toast'

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  page: {
    minHeight: '100dvh',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontFamily: 'system-ui, sans-serif',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-primary)',
    padding: '12px 16px',
    position: 'sticky',
    top: 0,
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexShrink: 0,
  },
  headerLeft:  { display: 'flex', flexDirection: 'column', gap: 1 },
  h1:          { margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' },
  sub:         { margin: 0, fontSize: 12, color: 'var(--text-muted)' },
  headerRight: { display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 },
  iconBtn: (primary) => ({
    padding: '7px 12px',
    borderRadius: 8,
    border: primary ? 'none' : '1px solid var(--border-primary)',
    background: primary ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: primary ? '#fff' : 'var(--text-secondary)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }),
  center: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    flex: 1, gap: 16, padding: 32, textAlign: 'center',
  },

  // ── Table select ─────────────────────────────────────────────────────────────
  tableGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 12, padding: 20,
  },
  tableCard: (status) => ({
    background: 'var(--bg-card)',
    border: `2px solid ${
      status === 'empty' ? 'var(--accent-green)' :
      status === 'busy'  ? 'var(--accent-orange)' :
                           'var(--accent-red)'
    }`,
    borderRadius: 14, padding: '18px 12px',
    cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    transition: 'all 0.15s',
  }),
  tableNum: { fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' },
  tableBadge: (status) => ({
    fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
    background:
      status === 'empty' ? 'var(--accent-green-dim)' :
      status === 'busy'  ? 'var(--accent-orange-dim)' :
                           'var(--accent-red-dim)',
    color:
      status === 'empty' ? 'var(--accent-green)' :
      status === 'busy'  ? 'var(--accent-orange)' :
                           'var(--accent-red)',
  }),
  tableCap: { fontSize: 12, color: 'var(--text-muted)' },

  // ── Order phase ───────────────────────────────────────────────────────────────
  orderBody: { display: 'flex', flex: 1, overflow: 'hidden' },
  catBar: {
    display: 'flex', gap: 8, padding: '10px 14px',
    overflowX: 'auto', background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-primary)',
    scrollbarWidth: 'none', flexShrink: 0,
  },
  catBtn: (active) => ({
    flexShrink: 0, padding: '7px 16px', borderRadius: 20, border: 'none',
    cursor: 'pointer', fontSize: 13,
    fontWeight: active ? 700 : 500,
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    transition: 'all 0.15s',
  }),
  itemGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: 10, padding: '14px 14px 140px',
    overflowY: 'auto', flex: 1,
  },
  itemCard: (inCart) => ({
    background: 'var(--bg-card)',
    border: `2px solid ${inCart ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
    borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
    position: 'relative', transition: 'border-color 0.15s',
  }),
  img: { width: '100%', height: 90, objectFit: 'cover', display: 'block' },
  imgPH: {
    width: '100%', height: 75,
    background: 'var(--bg-secondary)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 24, color: 'var(--text-muted)',
  },
  cardBody: { padding: '8px 10px 10px' },
  itemName:  { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 2 },
  itemPrice: { fontSize: 14, fontWeight: 700, color: 'var(--accent-cyan)' },
  badge: {
    position: 'absolute', top: 6, right: 6,
    background: 'var(--accent-cyan)', color: '#fff',
    borderRadius: 12, fontSize: 12, fontWeight: 700, padding: '2px 7px',
  },
  qtyRow: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, justifyContent: 'flex-end' },
  qtyBtn: (rm) => ({
    width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer',
    background: rm ? 'var(--accent-red)' : 'var(--accent-cyan)', color: '#fff',
    fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0,
  }),

  // ── Right panel ───────────────────────────────────────────────────────────────
  panel: {
    width: 300, borderLeft: '1px solid var(--border-primary)',
    background: 'var(--bg-secondary)',
    display: 'flex', flexDirection: 'column',
    overflowY: 'auto', flexShrink: 0,
  },
  panelHead: {
    padding: '12px 14px 8px',
    fontSize: 13, fontWeight: 700, color: 'var(--text-muted)',
    letterSpacing: '0.5px', textTransform: 'uppercase',
    borderBottom: '1px solid var(--border-primary)',
  },
  panelRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 14px', gap: 8,
    borderBottom: '1px solid var(--border-primary)',
    fontSize: 13,
  },
  panelRowName: { flex: 1, color: 'var(--text-primary)', fontWeight: 500, lineHeight: 1.3 },
  panelRowAmt:  { color: 'var(--text-secondary)', fontWeight: 600, flexShrink: 0, fontSize: 12 },
  panelEmpty: { padding: '16px 14px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' },
  panelFoot: {
    marginTop: 'auto', borderTop: '1px solid var(--border-primary)',
    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
  },
  panelTotal: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  panelTotalLabel: { fontSize: 13, color: 'var(--text-muted)' },
  panelTotalAmt: { fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' },

  // ── Footer (mobile) ───────────────────────────────────────────────────────────
  footer: {
    position: 'fixed', bottom: 0, left: 0, right: 0,
    background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-primary)',
    padding: '10px 14px', zIndex: 30,
    display: 'flex', gap: 8, alignItems: 'center',
  },
  footChip: { fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 },
  footBtn: (primary, disabled) => ({
    flex: 1, padding: '11px 0', borderRadius: 10, border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? 'var(--bg-card)' :
                primary  ? 'var(--accent-cyan)' : 'var(--accent-green)',
    color: disabled ? 'var(--text-muted)' : '#fff',
    fontSize: 14, fontWeight: 700, transition: 'background 0.15s',
  }),

  // ── Note popup ────────────────────────────────────────────────────────────────
  overlay: { position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  noteBox: { background: 'var(--bg-card)', borderRadius: 14, padding: 20, width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 },
  noteTitle: { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  textarea: { width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '10px 12px', fontSize: 14, color: 'var(--text-primary)', outline: 'none', resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
  rowBtn: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  smallBtn: (p) => ({ padding: '7px 18px', borderRadius: 8, border: `1px solid ${p ? 'var(--accent-cyan)' : 'var(--border-primary)'}`, background: p ? 'var(--accent-cyan)' : 'var(--bg-card)', color: p ? '#fff' : 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }),

  // ── Error banner ──────────────────────────────────────────────────────────────
  errBanner: { margin: '8px 14px 0', padding: '10px 14px', background: 'var(--accent-red-dim)', border: '1px solid var(--accent-red)', borderRadius: 8, fontSize: 13, color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: 8 },

  // ── Checkout modal ────────────────────────────────────────────────────────────
  coBox: { position: 'relative', zIndex: 1, background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-primary)', width: '100%', maxWidth: 420, maxHeight: '90dvh', display: 'flex', flexDirection: 'column' },
  coHead: { padding: '16px 20px 12px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  coTitle: { fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' },
  coClose: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: 4 },
  coBody: { overflowY: 'auto', flex: 1, padding: '0 20px' },
  coSection: { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase', padding: '12px 0 4px' },
  coRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--border-primary)', fontSize: 14, gap: 8 },
  coTotal: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 20px', background: 'var(--bg-secondary)', borderTop: '2px solid var(--border-primary)', flexShrink: 0 },
  coPayMethods: { display: 'flex', gap: 8, padding: '10px 20px', flexWrap: 'wrap', borderBottom: '1px solid var(--border-primary)', flexShrink: 0 },
  coPayBtn: (active) => ({ padding: '8px 16px', borderRadius: 8, border: `1.5px solid ${active ? 'var(--accent-cyan)' : 'var(--border-primary)'}`, background: active ? 'var(--accent-cyan-dim)' : 'var(--bg-card)', color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)', fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer' }),
  coFoot: { padding: '14px 20px', display: 'flex', gap: 10, flexShrink: 0 },
}

function Spinner() {
  return (
    <>
      <div style={{ width: 36, height: 36, border: '3px solid var(--border-primary)', borderTopColor: 'var(--accent-cyan)', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  )
}

// ── Checkout Modal ─────────────────────────────────────────────────────────────
const PAY_METHODS = [
  { key: 'cash',     label: '現金' },
  { key: 'card',     label: '信用卡' },
  { key: 'line_pay', label: 'LINE Pay' },
  { key: 'jkopay',  label: '街口' },
  { key: 'other',   label: '其他' },
]

function CheckoutModal({ tableNumber, allItems, orgId, storeId, orderId, onClose, onDone }) {
  const [payMethod, setPayMethod] = useState('cash')
  const [busy, setBusy] = useState(false)

  const total = allItems.reduce((s, i) => s + Number(i.unit_price) * i.quantity, 0)

  async function confirm() {
    setBusy(true)
    try {
      await supabase.from('pos_payments').insert({
        organization_id: orgId,
        store_id: storeId,
        order_id: orderId,
        amount: total,
        payment_method: payMethod,
      })
      await supabase.from('pos_orders').update({
        status: 'paid',
        paid_at: new Date().toISOString(),
      }).eq('id', orderId)

      toast.success(`T${tableNumber} 結帳完成 NT$${total.toLocaleString()}`)
      onDone()
    } catch (e) {
      toast.error('結帳失敗：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div style={S.overlay}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div style={S.coBox}>
        <div style={S.coHead}>
          <span style={S.coTitle}>結帳 — 桌號 T{tableNumber}</span>
          <button style={S.coClose} onClick={onClose}>×</button>
        </div>

        <div style={S.coBody}>
          <div style={S.coSection}>品項明細</div>
          {allItems.map((item, i) => (
            <div key={item.id ?? i} style={S.coRow}>
              <span style={{ flex: 1, color: 'var(--text-primary)' }}>{item.name} <span style={{ color: 'var(--text-muted)' }}>×{item.quantity}</span></span>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600, flexShrink: 0 }}>NT${(Number(item.unit_price) * item.quantity).toLocaleString()}</span>
            </div>
          ))}
          {allItems.length === 0 && (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>無品項</div>
          )}
        </div>

        <div style={S.coTotal}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-muted)' }}>應收合計</span>
          <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>NT${total.toLocaleString()}</span>
        </div>

        <div style={{ padding: '10px 20px 4px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>付款方式</div>
        <div style={S.coPayMethods}>
          {PAY_METHODS.map(m => (
            <button key={m.key} style={S.coPayBtn(payMethod === m.key)} onClick={() => setPayMethod(m.key)}>{m.label}</button>
          ))}
        </div>

        <div style={S.coFoot}>
          <button style={{ ...S.smallBtn(false), flex: 1 }} onClick={onClose} disabled={busy}>取消</button>
          <button
            style={{ flex: 2, padding: '12px 0', borderRadius: 10, border: 'none', cursor: busy ? 'not-allowed' : 'pointer', background: busy ? 'var(--bg-card)' : 'var(--accent-green)', color: busy ? 'var(--text-muted)' : '#fff', fontSize: 15, fontWeight: 800, opacity: busy ? 0.7 : 1 }}
            onClick={confirm} disabled={busy}
          >
            {busy ? '結帳中…' : '確認收款'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Right-side order panel ────────────────────────────────────────────────────
function OrderPanel({ existingItems, cart, items, storeId, orgId, orderId, tableNumber, onSubmit, onCheckout, submitBusy }) {
  const cartEntries = Object.entries(cart).filter(([, v]) => v.qty > 0)
  const newTotal    = cartEntries.reduce((s, [id, v]) => {
    const item = items.find(i => i.id === id)
    return s + (item ? Number(item.unit_price) * v.qty : 0)
  }, 0)
  const existTotal  = existingItems.reduce((s, i) => s + Number(i.unit_price) * i.quantity, 0)
  const grandTotal  = existTotal + newTotal
  const newCount    = cartEntries.reduce((s, [, v]) => s + v.qty, 0)

  return (
    <div style={S.panel}>
      {/* Existing items */}
      {existingItems.length > 0 && (
        <>
          <div style={S.panelHead}>已點 · NT${existTotal.toLocaleString()}</div>
          {existingItems.map((item, i) => (
            <div key={item.id ?? i} style={S.panelRow}>
              <span style={S.panelRowName}>{item.name}</span>
              <span style={S.panelRowAmt}>×{item.quantity}　NT${(Number(item.unit_price) * item.quantity).toLocaleString()}</span>
            </div>
          ))}
        </>
      )}

      {/* Cart (new items) */}
      {cartEntries.length > 0 && (
        <>
          <div style={{ ...S.panelHead, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>新增 · NT${newTotal.toLocaleString()}</div>
          {cartEntries.map(([id, v]) => {
            const item = items.find(i => i.id === id)
            if (!item) return null
            return (
              <div key={id} style={S.panelRow}>
                <span style={S.panelRowName}>{item.name}</span>
                <span style={{ ...S.panelRowAmt, color: 'var(--accent-cyan)' }}>×{v.qty}　NT${(Number(item.unit_price) * v.qty).toLocaleString()}</span>
              </div>
            )
          })}
        </>
      )}

      {existingItems.length === 0 && cartEntries.length === 0 && (
        <div style={S.panelEmpty}>尚未點餐</div>
      )}

      {/* Footer */}
      <div style={S.panelFoot}>
        <div style={S.panelTotal}>
          <span style={S.panelTotalLabel}>合計</span>
          <span style={S.panelTotalAmt}>NT${grandTotal.toLocaleString()}</span>
        </div>
        {newCount > 0 && (
          <button
            style={{ width: '100%', padding: '10px 0', borderRadius: 10, border: 'none', cursor: submitBusy ? 'not-allowed' : 'pointer', background: submitBusy ? 'var(--bg-card)' : 'var(--accent-cyan)', color: submitBusy ? 'var(--text-muted)' : '#fff', fontSize: 14, fontWeight: 700 }}
            onClick={onSubmit} disabled={submitBusy}
          >
            {submitBusy ? '送出中…' : `送廚房（${newCount} 品）`}
          </button>
        )}
        {orderId && (
          <button
            style={{ width: '100%', padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--accent-green)', color: '#fff', fontSize: 14, fontWeight: 700 }}
            onClick={onCheckout}
          >
            結帳 NT${grandTotal.toLocaleString()}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function WaiterMode() {
  const navigate  = useNavigate()
  const { user, profile } = useAuth()
  const orgId     = useOrgId()
  const { tenant } = useTenant()
  const storeId   = profile?.store_id ?? null

  const [phase,         setPhase]         = useState('loading')
  const [errMsg,        setErrMsg]        = useState('')
  const [tables,        setTables]        = useState([])
  const [activeOrders,  setActiveOrders]  = useState([])
  const [selTable,      setSelTable]      = useState(null)
  const [orderId,       setOrderId]       = useState(null)
  const [existingItems, setExistingItems] = useState([])
  const [categories,    setCategories]    = useState([])
  const [items,         setItems]         = useState([])
  const [selCat,        setSelCat]        = useState(null)
  const [cart,          setCart]          = useState({})
  const [submitBusy,    setSubmitBusy]    = useState(false)
  const [showCheckout,  setShowCheckout]  = useState(false)
  const [showNote,      setShowNote]      = useState(false)
  const [noteTarget,    setNoteTarget]    = useState(null)
  const [noteDraft,     setNoteDraft]     = useState('')
  const [showQr,        setShowQr]        = useState(false)
  const [qrUrl,         setQrUrl]         = useState('')
  const [genQr,         setGenQr]         = useState(false)
  const [wide,          setWide]          = useState(typeof window !== 'undefined' && window.innerWidth >= 900)
  const qrCanvasRef = useRef(null)
  const storeName   = profile?.store ?? ''

  useEffect(() => {
    const fn = () => setWide(window.innerWidth >= 900)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  // ── Boot: load tables + active orders ─────────────────────────────────────
  useEffect(() => {
    if (!user)    { setErrMsg('auth');     setPhase('error'); return }
    if (!storeId) { setErrMsg('no_store'); setPhase('error'); return }

    async function boot() {
      const [{ data: tbl, error: tErr }, { data: ords, error: oErr }] = await Promise.all([
        supabase.from('res_tables').select('id, table_number, capacity').eq('store_id', storeId).eq('is_active', true).order('table_number'),
        supabase.from('pos_orders').select('id, table_id, status').in('status', ['open', 'submitted']).eq('store_id', storeId),
      ])
      if (tErr || oErr) throw tErr ?? oErr
      setTables(tbl ?? [])
      setActiveOrders(ords ?? [])
      setPhase('select_table')
    }
    boot().catch(e => { setErrMsg(e?.message ?? '載入失敗'); setPhase('error') })
  }, [user, storeId])

  // ── Load menu when entering order phase ───────────────────────────────────
  useEffect(() => {
    if (phase !== 'order' || !storeId) return
    async function loadMenu() {
      const [{ data: cats }, { data: menuItems }] = await Promise.all([
        supabase.from('pos_menu_categories').select('id, name').eq('store_id', storeId).eq('is_active', true).order('display_order'),
        supabase.from('pos_menu_items').select('id, name, unit_price, description, image_url, category_id').eq('store_id', storeId).eq('is_available', true).order('display_order'),
      ])
      setCategories(cats ?? [])
      setItems(menuItems ?? [])
      if (cats?.length) setSelCat(cats[0].id)
    }
    loadMenu().catch(e => setErrMsg(e?.message ?? '菜單載入失敗'))
  }, [phase, storeId])

  // ── QR canvas ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showQr || !qrUrl || !qrCanvasRef.current) return
    QRCode.toCanvas(qrCanvasRef.current, qrUrl, { width: 220, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
  }, [showQr, qrUrl])

  // ── Derived ───────────────────────────────────────────────────────────────
  const cartEntries = Object.entries(cart).filter(([, v]) => v.qty > 0)
  const cartCount   = cartEntries.reduce((s, [, v]) => s + v.qty, 0)
  const cartTotal   = cartEntries.reduce((s, [id, v]) => {
    const item = items.find(i => i.id === id)
    return s + (item ? Number(item.unit_price) * v.qty : 0)
  }, 0)
  const visibleItems = selCat ? items.filter(i => i.category_id === selCat) : items

  const tableStatus = (tableId) => {
    const order = activeOrders.find(o => o.table_id === tableId)
    if (!order) return 'empty'
    return 'busy'
  }

  // ── Cart mutations ────────────────────────────────────────────────────────
  const addItem = useCallback((itemId) => {
    setCart(prev => {
      if (prev[itemId]) return { ...prev, [itemId]: { ...prev[itemId], qty: prev[itemId].qty + 1 } }
      return { ...prev, [itemId]: { qty: 1, note: '' } }
    })
  }, [])

  const adjustQty = useCallback((itemId, delta) => {
    setCart(prev => {
      const cur = prev[itemId]
      if (!cur) return prev
      const next = Math.max(0, cur.qty + delta)
      if (next === 0) { const { [itemId]: _r, ...rest } = prev; return rest }
      return { ...prev, [itemId]: { ...cur, qty: next } }
    })
  }, [])

  const openNotePopup = useCallback((e, itemId) => {
    e.stopPropagation()
    setNoteTarget(itemId)
    setNoteDraft(cart[itemId]?.note ?? '')
  }, [cart])

  const saveItemNote = useCallback(() => {
    if (!noteTarget) return
    setCart(prev => {
      const cur = prev[noteTarget]
      if (!cur) return prev
      return { ...prev, [noteTarget]: { ...cur, note: noteDraft.trim() } }
    })
    setNoteTarget(null)
  }, [noteTarget, noteDraft])

  // ── Select table ──────────────────────────────────────────────────────────
  async function selectTable(table) {
    const activeOrder = activeOrders.find(o => o.table_id === table.id)
    setSelTable(table)
    setCart({})
    setErrMsg('')

    if (activeOrder) {
      setOrderId(activeOrder.id)
      const { data: existing } = await supabase
        .from('pos_order_items')
        .select('id, name, unit_price, quantity, note')
        .eq('order_id', activeOrder.id)
        .order('created_at')
      setExistingItems(existing ?? [])
    } else {
      setOrderId(null)
      setExistingItems([])
    }
    setPhase('order')
  }

  // ── Generate QR ───────────────────────────────────────────────────────────
  async function generateQR() {
    if (!selTable || !storeId) return
    setGenQr(true)
    try {
      const { data: session, error } = await supabase.from('qr_order_sessions').insert({
        organization_id: orgId,
        store_id: storeId,
        table_id: selTable.id,
        token: crypto.randomUUID(),
        expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      }).select('token').single()
      if (error) throw error
      setQrUrl(`${window.location.origin}/menu/${storeId}/${selTable.id}?token=${session.token}`)
      setShowQr(true)
    } catch (e) {
      toast.error('QR 產生失敗：' + (e.message || ''))
    } finally {
      setGenQr(false)
    }
  }

  // ── Submit cart to kitchen ────────────────────────────────────────────────
  async function handleSubmit() {
    if (cartCount === 0 || !selTable) return
    setSubmitBusy(true)
    setErrMsg('')
    try {
      let currentOrderId = orderId

      if (!currentOrderId) {
        const { data: newOrder, error: oErr } = await supabase
          .from('pos_orders')
          .insert({ organization_id: orgId, store_id: storeId, table_id: selTable.id, status: 'open', opened_by: user.id })
          .select('id').single()
        if (oErr) throw oErr
        currentOrderId = newOrder.id
        setOrderId(currentOrderId)
        setActiveOrders(prev => [...prev, { id: currentOrderId, table_id: selTable.id, status: 'open' }])
      }

      const rows = cartEntries.map(([id, v]) => {
        const item = items.find(i => i.id === id)
        return {
          order_id:        currentOrderId,
          item_type:       'menu',
          menu_item_id:    id,
          name:            item?.name ?? '',
          unit_price:      item?.unit_price ?? 0,
          quantity:        v.qty,
          note:            v.note || null,
          source:          'staff',
          sent_to_kitchen: true,
        }
      })

      const { error: iErr } = await supabase.from('pos_order_items').insert(rows)
      if (iErr) throw iErr

      // Append to local existing items for display
      setExistingItems(prev => [...prev, ...rows.map(r => ({ ...r, id: r.menu_item_id + Date.now() }))])
      setCart({})
      toast.success('已送廚房')
    } catch (e) {
      setErrMsg(e?.message ?? '送出失敗')
    } finally {
      setSubmitBusy(false)
    }
  }

  // ── Back to table list ─────────────────────────────────────────────────────
  function backToTables() {
    setPhase('select_table')
    setSelTable(null)
    setOrderId(null)
    setExistingItems([])
    setCart({})
    setErrMsg('')
  }

  // ── After checkout ─────────────────────────────────────────────────────────
  function afterCheckout() {
    setActiveOrders(prev => prev.filter(o => o.table_id !== selTable?.id))
    setShowCheckout(false)
    backToTables()
  }

  // ────────────────────────────────────────────────────────────────────────────
  // RENDERS
  // ────────────────────────────────────────────────────────────────────────────

  if (phase === 'loading') return (
    <div style={S.page}><div style={S.center}><Spinner /><span style={{ fontSize: 14, color: 'var(--text-muted)' }}>載入中…</span></div></div>
  )

  if (phase === 'error') {
    const msg = errMsg === 'auth' ? '請先登入' : errMsg === 'no_store' ? '無法取得門市資料，請聯繫管理員' : errMsg
    return (
      <div style={S.page}>
        <div style={S.center}>
          <div style={{ fontSize: 42, color: 'var(--accent-red)' }}>!</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent-red)' }}>載入失敗</div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{msg}</div>
          <button style={S.smallBtn(false)} onClick={() => navigate('/pos')}>返回 POS</button>
        </div>
      </div>
    )
  }

  // ── SELECT TABLE ──────────────────────────────────────────────────────────
  if (phase === 'select_table') return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.headerLeft}>
          <h1 style={S.h1}>服務員點餐</h1>
          {storeName && <p style={S.sub}>{storeName}</p>}
        </div>
        <button style={S.iconBtn(false)} onClick={() => navigate('/pos')}>← 返回</button>
      </div>

      {tables.length === 0 ? (
        <div style={S.center}>
          <div style={{ fontSize: 40 }}>🪑</div>
          <div style={{ fontSize: 15, color: 'var(--text-muted)' }}>尚未設定桌位</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>請先至「訂位管理 → 桌台設定」新增桌台</div>
          <button style={S.smallBtn(false)} onClick={() => navigate('/pos')}>返回 POS</button>
        </div>
      ) : (
        <>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, padding: '12px 20px 0', flexWrap: 'wrap' }}>
            {[{ status: 'empty', label: '空桌' }, { status: 'busy', label: '用餐中' }].map(({ status, label }) => (
              <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: status === 'empty' ? 'var(--accent-green)' : 'var(--accent-orange)' }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
              </div>
            ))}
          </div>
          <div style={S.tableGrid}>
            {tables.map(t => {
              const status = tableStatus(t.id)
              return (
                <div key={t.id} style={S.tableCard(status)} onClick={() => selectTable(t)}>
                  <span style={S.tableNum}>T{t.table_number}</span>
                  <span style={S.tableBadge(status)}>{status === 'empty' ? '空桌' : '用餐中'}</span>
                  {t.capacity && <span style={S.tableCap}>{t.capacity} 人</span>}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )

  // ── ORDER ─────────────────────────────────────────────────────────────────
  const allCheckoutItems = existingItems

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <h1 style={S.h1}>桌號 T{selTable?.table_number}</h1>
          {storeName && <p style={S.sub}>{storeName}</p>}
        </div>
        <div style={S.headerRight}>
          <button style={S.iconBtn(false)} onClick={backToTables}>← 返回</button>
          <button style={S.iconBtn(false)} onClick={generateQR} disabled={genQr} title="產生 QR 點餐連結">
            {genQr ? '…' : '📱 QR'}
          </button>
          {orderId && (
            <button style={S.iconBtn(true)} onClick={() => setShowCheckout(true)}>💳 結帳</button>
          )}
          {!wide && cartCount > 0 && (
            <button style={S.iconBtn(true)} disabled={submitBusy} onClick={handleSubmit}>
              {submitBusy ? '送出中…' : `送廚房 (${cartCount})`}
            </button>
          )}
        </div>
      </div>

      {/* Category bar */}
      <div style={S.catBar}>
        <button style={S.catBtn(!selCat)} onClick={() => setSelCat(null)}>全部</button>
        {categories.map(c => (
          <button key={c.id} style={S.catBtn(selCat === c.id)} onClick={() => setSelCat(c.id)}>{c.name}</button>
        ))}
      </div>

      {/* Error */}
      {errMsg && (
        <div style={S.errBanner}>
          <span style={{ flex: 1 }}>{errMsg}</span>
          <button onClick={() => setErrMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
        </div>
      )}

      {/* Body: items + optional right panel */}
      <div style={S.orderBody}>
        {/* Item grid */}
        <div style={{ ...S.itemGrid, paddingBottom: wide ? 32 : 140 }}>
          {visibleItems.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', paddingTop: 40, color: 'var(--text-muted)', fontSize: 14 }}>此分類暫無品項</div>
          )}
          {visibleItems.map(item => {
            const entry = cart[item.id]
            const qty   = entry?.qty ?? 0
            const inCart = qty > 0
            return (
              <div key={item.id} style={S.itemCard(inCart)} onClick={() => addItem(item.id)}>
                {inCart && <span style={S.badge}>×{qty}</span>}
                {item.image_url
                  ? <img src={item.image_url} alt={item.name} style={S.img} />
                  : <div style={S.imgPH}>🍽️</div>
                }
                <div style={S.cardBody}>
                  <div style={S.itemName}>{item.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 3 }}>
                    <span style={S.itemPrice}>NT${Number(item.unit_price).toLocaleString()}</span>
                    {inCart && (
                      <div style={S.qtyRow} onClick={e => e.stopPropagation()}>
                        <button style={S.qtyBtn(true)}  onClick={() => adjustQty(item.id, -1)}>−</button>
                        <span style={{ fontSize: 13, fontWeight: 700, minWidth: 18, textAlign: 'center' }}>{qty}</span>
                        <button style={S.qtyBtn(false)} onClick={() => adjustQty(item.id, 1)}>+</button>
                      </div>
                    )}
                  </div>
                  {inCart && (
                    <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: entry?.note ? 'var(--accent-cyan)' : 'var(--text-muted)', padding: '2px 0' }}
                        onClick={(e) => openNotePopup(e, item.id)}
                      >
                        {entry?.note ? '📝 已備註' : '+ 備註'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Right panel (wide only) */}
        {wide && (
          <OrderPanel
            existingItems={existingItems}
            cart={cart}
            items={items}
            storeId={storeId}
            orgId={orgId}
            orderId={orderId}
            tableNumber={selTable?.table_number}
            onSubmit={handleSubmit}
            onCheckout={() => setShowCheckout(true)}
            submitBusy={submitBusy}
          />
        )}
      </div>

      {/* Mobile footer */}
      {!wide && (existingItems.length > 0 || cartCount > 0) && (
        <div style={S.footer}>
          <span style={S.footChip}>
            {existingItems.reduce((s, i) => s + i.quantity, 0) + cartCount} 品
          </span>
          {cartCount > 0 && (
            <button style={S.footBtn(false, submitBusy)} disabled={submitBusy} onClick={handleSubmit}>
              {submitBusy ? '送出…' : `送廚房 NT$${cartTotal.toLocaleString()}`}
            </button>
          )}
          {orderId && (
            <button style={S.footBtn(true, false)} onClick={() => setShowCheckout(true)}>結帳</button>
          )}
        </div>
      )}

      {/* Item note popup */}
      {noteTarget && createPortal(
        <div style={S.overlay}>
          <div onClick={() => setNoteTarget(null)} style={{ position: 'absolute', inset: 0 }} />
          <div style={S.noteBox}>
            <p style={S.noteTitle}>備註 — {items.find(i => i.id === noteTarget)?.name}</p>
            <textarea rows={3} style={S.textarea} value={noteDraft} onChange={e => setNoteDraft(e.target.value)} placeholder="例：不要蔥、少辣、分開裝…" autoFocus />
            <div style={S.rowBtn}>
              <button style={S.smallBtn(false)} onClick={() => setNoteTarget(null)}>取消</button>
              <button style={S.smallBtn(true)} onClick={saveItemNote}>確認</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* QR popup */}
      {showQr && qrUrl && createPortal(
        <div style={S.overlay}>
          <div onClick={() => setShowQr(false)} style={{ position: 'absolute', inset: 0 }} />
          <div style={{ ...S.noteBox, alignItems: 'center', maxWidth: 320 }}>
            <p style={{ ...S.noteTitle, textAlign: 'center' }}>掃碼點餐 — T{selTable?.table_number}</p>
            <div style={{ background: '#fff', borderRadius: 12, padding: 10 }}>
              <canvas ref={qrCanvasRef} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all', textAlign: 'center' }}>{qrUrl}</div>
            <button style={S.smallBtn(false)} onClick={() => setShowQr(false)}>關閉</button>
          </div>
        </div>,
        document.body
      )}

      {/* Checkout modal */}
      {showCheckout && orderId && (
        <CheckoutModal
          tableNumber={selTable?.table_number}
          allItems={allCheckoutItems}
          orgId={orgId}
          storeId={storeId}
          orderId={orderId}
          onClose={() => setShowCheckout(false)}
          onDone={afterCheckout}
        />
      )}
    </div>
  )
}
