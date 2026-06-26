import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { kitchenPrinter } from '../../lib/kitchenPrinter'
import { useAuth } from '../../contexts/AuthContext'
import { useTenant } from '../../contexts/TenantContext'
import { toast } from '../../lib/toast'

// ── Inline styles (CSS-var only — no hardcoded colors) ─────────────────────
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
    padding: '14px 20px',
    position: 'sticky',
    top: 0,
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: 2 },
  h1: { margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' },
  sub: { margin: 0, fontSize: 13, color: 'var(--text-muted)' },
  headerRight: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 },
  iconBtn: {
    padding: '7px 14px',
    borderRadius: 8,
    border: '1px solid var(--border-primary)',
    background: 'var(--bg-card)',
    color: 'var(--text-secondary)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 16,
    padding: 32,
    textAlign: 'center',
  },

  // ── Table select ───────────────────────────────────────────────────────────
  tableGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
    gap: 12,
    padding: 20,
  },
  tableCard: (busy) => ({
    background: 'var(--bg-card)',
    border: `2px solid ${busy ? 'var(--accent-orange)' : 'var(--accent-green)'}`,
    borderRadius: 14,
    padding: '18px 12px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    transition: 'all 0.15s',
  }),
  tableNum: { fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' },
  tableBadge: (busy) => ({
    fontSize: 12,
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: 20,
    background: busy ? 'var(--accent-orange-dim)' : 'var(--accent-green-dim)',
    color: busy ? 'var(--accent-orange)' : 'var(--accent-green)',
  }),
  tableCap: { fontSize: 12, color: 'var(--text-muted)' },

  // ── Order phase ────────────────────────────────────────────────────────────
  catBar: {
    display: 'flex',
    gap: 8,
    padding: '10px 16px',
    overflowX: 'auto',
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-primary)',
    scrollbarWidth: 'none',
    flexShrink: 0,
  },
  catBtn: (active) => ({
    flexShrink: 0,
    padding: '7px 16px',
    borderRadius: 20,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    background: active ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    transition: 'all 0.15s',
  }),
  itemGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))',
    gap: 12,
    padding: '16px 16px 160px',
    overflowY: 'auto',
    flex: 1,
  },
  itemCard: (inCart) => ({
    background: 'var(--bg-card)',
    border: `2px solid ${inCart ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
    borderRadius: 12,
    overflow: 'hidden',
    cursor: 'pointer',
    position: 'relative',
    transition: 'border-color 0.15s',
  }),
  img: { width: '100%', height: 100, objectFit: 'cover', display: 'block' },
  imgPlaceholder: {
    width: '100%',
    height: 80,
    background: 'var(--bg-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 26,
    color: 'var(--text-muted)',
  },
  cardBody: { padding: '8px 10px 10px' },
  itemName: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 2 },
  itemPrice: { fontSize: 14, fontWeight: 700, color: 'var(--accent-cyan)' },
  qtyCntBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    background: 'var(--accent-cyan)',
    color: '#fff',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 700,
    padding: '2px 7px',
  },
  courseBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    background: 'var(--accent-purple-dim)',
    color: 'var(--accent-purple)',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 7px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  qtyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    justifyContent: 'flex-end',
  },
  qtyBtn: (isRemove) => ({
    width: 26,
    height: 26,
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    background: isRemove ? 'var(--accent-red)' : 'var(--accent-cyan)',
    color: '#fff',
    fontSize: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    flexShrink: 0,
  }),
  notePopup: {
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  noteBox: {
    background: 'var(--bg-card)',
    borderRadius: 14,
    padding: 20,
    width: '100%',
    maxWidth: 360,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  noteTitle: { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  textarea: {
    width: '100%',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
    color: 'var(--text-primary)',
    outline: 'none',
    resize: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  footer: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'var(--bg-secondary)',
    borderTop: '1px solid var(--border-primary)',
    padding: '12px 16px',
    zIndex: 30,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  footerRow: { display: 'flex', alignItems: 'center', gap: 10 },
  submitBtn: (disabled) => ({
    flex: 1,
    padding: '12px 0',
    borderRadius: 10,
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? 'var(--bg-card)' : 'var(--accent-cyan)',
    color: disabled ? 'var(--text-muted)' : '#fff',
    fontSize: 15,
    fontWeight: 700,
    transition: 'background 0.15s',
  }),
  chip: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  noteToggle: (active) => ({
    flexShrink: 0,
    width: 38,
    height: 38,
    borderRadius: 8,
    border: `1px solid ${active ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
    background: active ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
    color: active ? 'var(--accent-cyan)' : 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),
  errBanner: {
    margin: '8px 16px 0',
    padding: '10px 14px',
    background: 'var(--accent-red-dim)',
    border: '1px solid var(--accent-red)',
    borderRadius: 8,
    fontSize: 13,
    color: 'var(--accent-red)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  rowBtn: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  smallBtn: (primary) => ({
    padding: '6px 16px',
    borderRadius: 8,
    border: `1px solid ${primary ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
    background: primary ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: primary ? '#fff' : 'var(--text-secondary)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  }),
}

export default function WaiterMode() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { tenant } = useTenant()
  const storeId = profile?.store_id ?? tenant?.organization_id ?? null

  const [phase, setPhase] = useState('loading') // loading|select_table|order|confirm|done|error
  const [errMsg, setErrMsg] = useState('')

  // Table select state
  const [tables,       setTables]       = useState([])
  const [activeOrders, setActiveOrders] = useState([]) // [{id, table_id}]
  const [selTable,     setSelTable]     = useState(null)

  // Order state
  const [categories, setCategories] = useState([])
  const [items,      setItems]      = useState([])
  const [selCat,     setSelCat]     = useState(null)
  const [cart,       setCart]       = useState({}) // { itemId: { qty, note, course } }
  const [orderNote,  setOrderNote]  = useState('')
  const [showNote,   setShowNote]   = useState(false)

  // Per-item note popup
  const [noteTarget, setNoteTarget] = useState(null)
  const [noteDraft,  setNoteDraft]  = useState('')

  // QR generation + reprint
  const [showQr,     setShowQr]     = useState(false)
  const [qrUrl,      setQrUrl]      = useState('')
  const [genQr,      setGenQr]      = useState(false)
  const [lastOrderId,       setLastOrderId]       = useState(null)
  const [lastOrderItems,    setLastOrderItems]    = useState([])
  const qrCanvasRef = useRef(null)

  const storeName = profile?.store ?? ''

  // ── Boot: load tables + active orders ─────────────────────────────────────
  useEffect(() => {
    if (!user) { setErrMsg('auth'); setPhase('error'); return }
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
    loadMenu().catch(e => { setErrMsg(e?.message ?? '菜單載入失敗') })
  }, [phase, storeId])

  // ── Derived ───────────────────────────────────────────────────────────────
  const busyTableIds = new Set(activeOrders.map(o => o.table_id))
  const visibleItems = selCat ? items.filter(i => i.category_id === selCat) : items
  const cartEntries  = Object.entries(cart).filter(([, v]) => v.qty > 0)
  const cartCount    = cartEntries.reduce((s, [, v]) => s + v.qty, 0)
  const cartTotal    = cartEntries.reduce((s, [id, v]) => {
    const item = items.find(i => i.id === id)
    return s + (item ? item.unit_price * v.qty : 0)
  }, 0)

  // ── Cart mutations ────────────────────────────────────────────────────────
  const addItem = useCallback((itemId) => {
    setCart(prev => {
      if (prev[itemId]) return { ...prev, [itemId]: { ...prev[itemId], qty: prev[itemId].qty + 1 } }
      return { ...prev, [itemId]: { qty: 1, note: '', course: 1 } }
    })
  }, [])

  const adjustQty = useCallback((itemId, delta) => {
    setCart(prev => {
      const cur = prev[itemId]
      if (!cur) return prev
      const next = Math.max(0, cur.qty + delta)
      if (next === 0) {
        const { [itemId]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [itemId]: { ...cur, qty: next } }
    })
  }, [])

  // Cycles course 1→2→3→1
  const cycleCourse = useCallback((e, itemId) => {
    e.stopPropagation()
    setCart(prev => {
      const cur = prev[itemId]
      if (!cur) return prev
      return { ...prev, [itemId]: { ...cur, course: (cur.course % 3) + 1 } }
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

  // ── Walk-in QR generation ─────────────────────────────────────────────────
  async function generateQR() {
    if (!selTable || !storeId) return
    setGenQr(true)
    try {
      const token = crypto.randomUUID()
      const { data: session, error } = await supabase
        .from('qr_order_sessions')
        .insert({
          store_id:   storeId,
          table_id:   selTable.id,
          token,
          expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        })
        .select('token')
        .single()
      if (error) throw error
      setQrUrl(`${window.location.origin}/menu/${storeId}/${selTable.id}?token=${session.token}`)
      setShowQr(true)
    } catch (e) {
      toast.error('QR 產生失敗：' + (e.message || ''))
    } finally {
      setGenQr(false)
    }
  }

  // ── Kitchen ticket reprint ─────────────────────────────────────────────────
  async function handleReprint() {
    if (!lastOrderId) { toast.error('尚無可重印訂單'); return }
    if (!kitchenPrinter.isConnected()) { toast.error('廚房印表機未連線'); return }
    let itemsToPrint = lastOrderItems
    if (!itemsToPrint.length) {
      const { data } = await supabase
        .from('pos_order_items')
        .select('name, quantity, note, course')
        .eq('order_id', lastOrderId)
        .order('created_at')
      itemsToPrint = data ?? []
    }
    kitchenPrinter.reprint({
      orderNumber:  lastOrderId,
      tableNumber:  selTable?.table_number ?? '?',
      items:        itemsToPrint.map(i => ({ name: i.name, qty: i.quantity, note: i.note, course: i.course })),
    })
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (cartCount === 0 || !selTable) return
    setPhase('confirm')
    setErrMsg('')

    try {
      // Reuse existing open order for the table, or create a new one
      const { data: existing } = await supabase
        .from('pos_orders')
        .select('id')
        .eq('store_id', storeId)
        .eq('table_id', selTable.id)
        .in('status', ['open', 'submitted'])
        .maybeSingle()

      let orderId = existing?.id ?? null

      if (!orderId) {
        const { data: newOrder, error: oErr } = await supabase
          .from('pos_orders')
          .insert({ store_id: storeId, table_id: selTable.id, status: 'submitted', opened_by: user.id, guest_count: 1 })
          .select('id')
          .single()
        if (oErr) throw oErr
        orderId = newOrder.id
      }

      const rows = cartEntries.map(([id, v]) => {
        const item = items.find(i => i.id === id)
        return {
          order_id:        orderId,
          store_id:        storeId,
          menu_item_id:    id,
          name:            item?.name ?? '',
          unit_price:      item?.unit_price ?? 0,
          quantity:        v.qty,
          note:            v.note || null,
          course:          v.course,
          sent_to_kitchen: true,
          item_status:     'confirmed',
          source:          'waiter',
        }
      })

      const { error: iErr } = await supabase.from('pos_order_items').insert(rows)
      if (iErr) throw iErr

      // Optimistically mark table as busy so the grid updates when we return
      setActiveOrders(prev =>
        prev.some(o => o.table_id === selTable.id)
          ? prev
          : [...prev, { id: orderId, table_id: selTable.id, status: 'submitted' }]
      )

      // Save for reprint
      setLastOrderId(orderId)
      setLastOrderItems(rows.map(r => ({ name: r.name, qty: r.quantity, note: r.note, course: r.course })))

      setPhase('done')
      setTimeout(() => { setPhase('select_table'); setSelTable(null) }, 1500)
    } catch (e) {
      setErrMsg(e?.message ?? '送出失敗，請稍後再試')
      setPhase('order')
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (phase === 'loading') return (
    <div style={S.page}>
      <div style={S.center}>
        <Spinner />
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>載入中…</span>
      </div>
    </div>
  )

  // ── Error ─────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    if (errMsg === 'auth') return (
      <div style={S.page}>
        <div style={S.center}>
          <div style={{ fontSize: 44 }}>🔒</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>請先登入</div>
          <button style={S.smallBtn(true)} onClick={() => navigate('/login')}>前往登入</button>
        </div>
      </div>
    )
    return (
      <div style={S.page}>
        <div style={S.center}>
          <div style={{ fontSize: 44, color: 'var(--accent-red)' }}>!</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent-red)' }}>載入失敗</div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{errMsg === 'no_store' ? '無法取得店舖資訊，請聯繫管理員' : errMsg}</div>
          <button style={S.smallBtn(false)} onClick={() => navigate('/pos')}>返回 POS</button>
        </div>
      </div>
    )
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (phase === 'done') return (
    <div style={S.page}>
      <div style={S.center}>
        <div style={{ fontSize: 60, color: 'var(--accent-green)' }}>✓</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>訂單已送出廚房！</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>正在返回桌位選擇…</div>
      </div>
    </div>
  )

  // ── Submitting (confirm phase = in-flight) ────────────────────────────────
  if (phase === 'confirm') return (
    <div style={S.page}>
      <div style={S.center}>
        <Spinner />
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>送出中…</span>
      </div>
    </div>
  )

  // ── SELECT TABLE ──────────────────────────────────────────────────────────
  if (phase === 'select_table') return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.headerLeft}>
          <h1 style={S.h1}>服務員點餐</h1>
          {storeName && <p style={S.sub}>{storeName}</p>}
        </div>
        <div style={S.headerRight}>
          <button style={S.iconBtn} onClick={() => navigate('/pos')}>← 返回</button>
        </div>
      </div>

      {tables.length === 0 ? (
        <div style={S.center}>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>尚未設定任何桌位</div>
          <button style={S.smallBtn(false)} onClick={() => navigate('/pos')}>返回 POS</button>
        </div>
      ) : (
        <div style={S.tableGrid}>
          {tables.map(t => {
            const busy = busyTableIds.has(t.id)
            return (
              <div key={t.id} style={S.tableCard(busy)} onClick={() => { setSelTable(t); setCart({}); setOrderNote(''); setPhase('order') }}>
                <span style={S.tableNum}>T{t.table_number}</span>
                <span style={S.tableBadge(busy)}>{busy ? '用餐中' : '空桌'}</span>
                {t.capacity && <span style={S.tableCap}>{t.capacity} 人</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  // ── ORDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <h1 style={S.h1}>桌號 T{selTable?.table_number}</h1>
          {storeName && <p style={S.sub}>{storeName}</p>}
        </div>
        <div style={S.headerRight}>
          <button style={S.iconBtn} onClick={() => { setPhase('select_table'); setSelTable(null) }}>返回</button>
          <button
            style={{ ...S.iconBtn, fontSize: 12 }}
            onClick={generateQR}
            disabled={genQr}
            title="為此桌產生 QR 點餐連結"
          >
            {genQr ? '…' : '生成QR'}
          </button>
          <button
            style={{ ...S.iconBtn, fontSize: 12 }}
            onClick={handleReprint}
            title="重印廚房單"
          >
            🖨 重印
          </button>
          <button
            style={{ ...S.iconBtn, background: cartCount > 0 ? 'var(--accent-cyan)' : 'var(--bg-card)', color: cartCount > 0 ? '#fff' : 'var(--text-muted)', borderColor: cartCount > 0 ? 'var(--accent-cyan)' : 'var(--border-primary)' }}
            disabled={cartCount === 0}
            onClick={handleSubmit}
          >
            送出
          </button>
        </div>
      </div>

      {/* Category tabs */}
      <div style={S.catBar}>
        <button style={S.catBtn(!selCat)} onClick={() => setSelCat(null)}>全部</button>
        {categories.map(c => (
          <button key={c.id} style={S.catBtn(selCat === c.id)} onClick={() => setSelCat(c.id)}>{c.name}</button>
        ))}
      </div>

      {/* Error banner */}
      {errMsg && (
        <div style={S.errBanner}>
          <span style={{ flex: 1 }}>{errMsg}</span>
          <button onClick={() => setErrMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
        </div>
      )}

      {/* Item grid */}
      <div style={S.itemGrid}>
        {visibleItems.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', paddingTop: 48, color: 'var(--text-muted)', fontSize: 14 }}>此分類暫無品項</div>
        )}
        {visibleItems.map(item => {
          const entry  = cart[item.id]
          const qty    = entry?.qty ?? 0
          const inCart = qty > 0
          return (
            <div key={item.id} style={S.itemCard(inCart)} onClick={() => addItem(item.id)}>
              {/* Course badge — click cycles 1→2→3→1 */}
              {inCart && (
                <span style={S.courseBadge} onClick={(e) => cycleCourse(e, item.id)}>
                  輪{entry.course}
                </span>
              )}
              {inCart && <span style={S.qtyCntBadge}>×{qty}</span>}
              {item.image_url
                ? <img src={item.image_url} alt={item.name} style={S.img} />
                : <div style={S.imgPlaceholder}>🍽️</div>
              }
              <div style={S.cardBody}>
                <div style={S.itemName}>{item.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                  <span style={S.itemPrice}>NT${item.unit_price}</span>
                  {inCart && (
                    <div style={S.qtyRow} onClick={e => e.stopPropagation()}>
                      <button style={S.qtyBtn(true)}  onClick={() => adjustQty(item.id, -1)}>−</button>
                      <span style={{ fontSize: 14, fontWeight: 700, minWidth: 20, textAlign: 'center', color: 'var(--text-primary)' }}>{qty}</span>
                      <button style={S.qtyBtn(false)} onClick={() => adjustQty(item.id, 1)}>+</button>
                    </div>
                  )}
                </div>
                {inCart && (
                  <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: entry?.note ? 'var(--accent-cyan)' : 'var(--text-muted)', padding: '2px 0' }}
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

      {/* Footer */}
      <div style={S.footer}>
        <div style={S.footerRow}>
          <button style={S.noteToggle(!!orderNote)} onClick={() => setShowNote(n => !n)} title="桌邊備註">📋</button>
          <span style={S.chip}>{cartCount} 品・NT${cartTotal.toLocaleString()}</span>
          <button style={S.submitBtn(cartCount === 0)} disabled={cartCount === 0} onClick={handleSubmit}>
            送出訂單（NT${cartTotal.toLocaleString()}）
          </button>
        </div>
        {showNote && (
          <textarea
            value={orderNote}
            onChange={e => setOrderNote(e.target.value)}
            placeholder="桌邊備註（例：1 位過敏花生、嬰兒椅 ×1）"
            rows={2}
            style={S.textarea}
            autoFocus
          />
        )}
      </div>

      {/* QR code modal */}
      {showQr && qrUrl && (
        <div style={S.notePopup} onClick={() => setShowQr(false)}>
          <div style={{ ...S.noteBox, alignItems: 'center', gap: 16, maxWidth: 320 }} onClick={e => e.stopPropagation()}>
            <p style={S.noteTitle}>桌號 T{selTable?.table_number} QR 點餐碼</p>
            <canvas
              ref={el => {
                if (el && qrUrl) {
                  QRCode.toCanvas(el, qrUrl, { width: 220, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
                  qrCanvasRef.current = el
                }
              }}
            />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              有效期 4 小時 · 掃碼後可自助點餐
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                style={S.smallBtn(false)}
                onClick={() => {
                  if (!qrCanvasRef.current) return
                  const link = document.createElement('a')
                  link.download = `QR-T${selTable?.table_number}.png`
                  link.href = qrCanvasRef.current.toDataURL('image/png')
                  link.click()
                }}
              >下載</button>
              <button style={S.smallBtn(true)} onClick={() => setShowQr(false)}>關閉</button>
            </div>
          </div>
        </div>
      )}

      {/* Per-item note popup */}
      {noteTarget && (
        <div style={S.notePopup} onClick={() => setNoteTarget(null)}>
          <div style={S.noteBox} onClick={e => e.stopPropagation()}>
            <p style={S.noteTitle}>品項備註 — {items.find(i => i.id === noteTarget)?.name}</p>
            <textarea
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              placeholder="例：不加蔥、少辣、醬料另上"
              rows={3}
              style={S.textarea}
              autoFocus
            />
            <div style={S.rowBtn}>
              <button style={S.smallBtn(false)} onClick={() => setNoteTarget(null)}>取消</button>
              <button style={S.smallBtn(true)}  onClick={saveItemNote}>確認</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <>
      <div style={{ width: 40, height: 40, border: '4px solid var(--border-primary)', borderTopColor: 'var(--accent-cyan)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </>
  )
}
