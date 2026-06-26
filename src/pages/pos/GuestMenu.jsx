import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

// ── 色票：米白 / 酒紅 / 金色 ─────────────────────────────────────────────────
const C = {
  cream:    '#faf7f1',
  card:     '#ffffff',
  border:   '#e8e2d8',
  wine:     '#7b2136',
  wineDark: '#5a1728',
  wineDim:  '#f9eeee',
  gold:     '#c9a455',
  goldDim:  '#fdf8ec',
  text:     '#1e0d09',
  sub:      '#6b5147',
  muted:    '#b0a09a',
  white:    '#ffffff',
}

// ── i18n ─────────────────────────────────────────────────────────────────────
const T = {
  zh: {
    langLabel: '中',
    tableNo: '桌號',
    welcomeTitle: (name) => name || '歡迎光臨',
    welcomeMsg: '感謝您今日的光臨\n祝您用餐愉快，享受每一口美味',
    welcomeSub: '請點選下方按鈕開始點餐',
    startBtn: '開始點餐',
    all: '全部',
    viewOrder: '查看餐點',
    yourOrder: '已選餐點',
    total: '合計',
    placeOrder: '確認送出',
    notePlaceholder: '備註（例：不要蔥、少辣、過敏食材）',
    loading: '載入中…',
    submitting: '送出點餐中…',
    doneTitle: '點餐已送出！',
    doneMsg: '店員確認後即送往廚房\n感謝您的耐心等候',
    doneSub: '祝您用餐愉快',
    continueOrder: '繼續點餐',
    errTitle: '無法載入菜單',
    noItems: '此分類暫無品項',
  },
  en: {
    langLabel: 'EN',
    tableNo: 'Table',
    welcomeTitle: (name) => name || 'Welcome',
    welcomeMsg: 'Thank you for dining with us today\nWe wish you a wonderful meal',
    welcomeSub: 'Tap below to start ordering',
    startBtn: 'Start Ordering',
    all: 'All',
    viewOrder: 'View Order',
    yourOrder: 'Your Order',
    total: 'Total',
    placeOrder: 'Place Order',
    notePlaceholder: 'Notes (e.g. no onions, mild spice, allergies)',
    loading: 'Loading…',
    submitting: 'Placing order…',
    doneTitle: 'Order Placed!',
    doneMsg: 'Staff will confirm and send to kitchen\nThank you for your patience',
    doneSub: 'Enjoy your meal!',
    continueOrder: 'Continue Ordering',
    errTitle: 'Failed to Load Menu',
    noItems: 'No items in this category',
  },
  ja: {
    langLabel: '日',
    tableNo: 'テーブル',
    welcomeTitle: (name) => name || 'ようこそ',
    welcomeMsg: 'ご来店ありがとうございます\nごゆっくりお楽しみください',
    welcomeSub: '下のボタンからご注文をどうぞ',
    startBtn: '注文する',
    all: 'すべて',
    viewOrder: 'ご注文を確認',
    yourOrder: 'ご注文内容',
    total: '合計',
    placeOrder: '注文を確定する',
    notePlaceholder: '備考（例：ネギ抜き、辛さ控えめ、アレルギーなど）',
    loading: '読み込み中…',
    submitting: '注文を送信中…',
    doneTitle: 'ご注文を承りました！',
    doneMsg: 'スタッフが確認後にキッチンへ送ります\nしばらくお待ちください',
    doneSub: 'ごゆっくりお楽しみください',
    continueOrder: '引き続き注文する',
    errTitle: 'メニューを読み込めません',
    noItems: 'このカテゴリーには商品がありません',
  },
  ko: {
    langLabel: '한',
    tableNo: '테이블',
    welcomeTitle: (name) => name || '환영합니다',
    welcomeMsg: '오늘 방문해 주셔서 감사합니다\n맛있는 식사가 되시길 바랍니다',
    welcomeSub: '아래 버튼을 눌러 주문을 시작하세요',
    startBtn: '주문 시작',
    all: '전체',
    viewOrder: '주문 확인',
    yourOrder: '주문 내역',
    total: '합계',
    placeOrder: '주문 확정',
    notePlaceholder: '요청사항（예：파 빼주세요, 덜 맵게, 알레르기 식재료）',
    loading: '불러오는 중…',
    submitting: '주문 전송 중…',
    doneTitle: '주문이 접수되었습니다！',
    doneMsg: '직원이 확인 후 주방으로 전달합니다\n잠시만 기다려 주세요',
    doneSub: '맛있는 식사 되세요',
    continueOrder: '계속 주문하기',
    errTitle: '메뉴를 불러올 수 없습니다',
    noItems: '이 카테고리에 메뉴가 없습니다',
  },
}

// ── Inline styles ─────────────────────────────────────────────────────────────
const S = {
  page: {
    minHeight: '100dvh', background: C.cream, overscrollBehavior: 'none',
    fontFamily: "'Noto Sans TC', 'PingFang TC', system-ui, sans-serif", color: C.text,
    WebkitTapHighlightColor: 'transparent',
  },

  // ── 歡迎頁 ──
  welcome: {
    minHeight: '100dvh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', padding: '40px 32px',
    background: `linear-gradient(160deg, ${C.wineDark} 0%, ${C.wine} 100%)`,
    position: 'relative', overflow: 'hidden', textAlign: 'center',
  },
  welDecor1: {
    position: 'absolute', top: -60, right: -60, width: 220, height: 220,
    borderRadius: '50%', border: '1px solid rgba(201,164,85,.2)', pointerEvents: 'none',
  },
  welDecor2: {
    position: 'absolute', bottom: -80, left: -50, width: 260, height: 260,
    borderRadius: '50%', border: '1px solid rgba(201,164,85,.12)', pointerEvents: 'none',
  },
  // 語言切換（歡迎頁右上角）
  langBarWelcome: {
    position: 'absolute', top: 18, right: 18, display: 'flex', gap: 4,
  },
  // 語言切換（Menu header 內）
  langBarHeader: { display: 'flex', gap: 4, flexShrink: 0 },
  langBtn: (active) => ({
    padding: '4px 10px', borderRadius: 20, border: `1px solid ${active ? C.gold : 'rgba(255,255,255,.3)'}`,
    background: active ? C.gold : 'transparent',
    color: active ? C.wineDark : 'rgba(255,255,255,.75)',
    fontSize: 12, fontWeight: 700, cursor: 'pointer', lineHeight: 1.4,
  }),
  langBtnMenu: (active) => ({
    padding: '4px 10px', borderRadius: 20,
    border: `1px solid ${active ? C.wine : C.border}`,
    background: active ? C.wine : 'transparent',
    color: active ? C.white : C.sub,
    fontSize: 12, fontWeight: 700, cursor: 'pointer', lineHeight: 1.4,
  }),
  logoWrap: {
    width: 100, height: 100, borderRadius: 22,
    background: 'rgba(255,255,255,.12)',
    border: '1.5px solid rgba(201,164,85,.4)',
    overflow: 'hidden', marginBottom: 24, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44,
  },
  welLine:  { width: 40, height: 1.5, background: C.gold, margin: '0 auto 20px', opacity: .8 },
  welName:  { fontSize: 26, fontWeight: 800, color: C.white, letterSpacing: '1px', marginBottom: 8 },
  welTable: {
    display: 'inline-block', padding: '4px 18px', borderRadius: 20,
    border: '1px solid rgba(201,164,85,.5)', color: C.gold,
    fontSize: 13, fontWeight: 600, marginBottom: 20,
  },
  welGreet: { fontSize: 15, color: 'rgba(255,255,255,.8)', lineHeight: 1.9, maxWidth: 280, marginBottom: 36, whiteSpace: 'pre-line' },
  welBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    background: C.gold, color: C.wineDark, border: 'none', borderRadius: 14,
    width: '100%', maxWidth: 280, height: 54, fontSize: 17, fontWeight: 800,
    cursor: 'pointer', boxShadow: '0 4px 20px rgba(201,164,85,.5)',
  },

  // ── Header ──
  header: {
    background: C.card, borderBottom: `1px solid ${C.border}`,
    padding: '13px 16px', position: 'sticky', top: 0, zIndex: 20,
    display: 'flex', alignItems: 'center', gap: 10,
  },
  headerLogoBox: {
    width: 38, height: 38, borderRadius: 9, overflow: 'hidden', flexShrink: 0,
    background: C.wine, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
  },
  storeName: { margin: 0, fontSize: 15, fontWeight: 800, color: C.wine, letterSpacing: '-0.3px', lineHeight: 1.2 },
  tableTag: {
    display: 'inline-block', marginTop: 2,
    padding: '1px 10px', borderRadius: 20,
    background: C.goldDim, color: C.gold, fontSize: 11, fontWeight: 700,
  },
  cartChip: {
    flexShrink: 0, background: C.wine, color: C.white, borderRadius: 20,
    padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
    border: 'none', whiteSpace: 'nowrap',
  },

  // ── Category bar ──
  catBar: {
    background: C.card, borderBottom: `1px solid ${C.border}`,
    display: 'flex', gap: 6, padding: '10px 14px',
    overflowX: 'auto', scrollbarWidth: 'none',
    position: 'sticky', top: 66, zIndex: 19,
  },
  catPill: (a) => ({
    flexShrink: 0, padding: '7px 16px', borderRadius: 20,
    border: `1.5px solid ${a ? C.wine : C.border}`,
    background: a ? C.wine : 'transparent',
    color: a ? C.white : C.sub,
    fontSize: 13, fontWeight: a ? 700 : 500,
    cursor: 'pointer', whiteSpace: 'nowrap',
  }),

  // ── Section header ──
  sectionHead: {
    padding: '16px 16px 6px', fontSize: 11, fontWeight: 800, color: C.gold,
    letterSpacing: '1.5px', textTransform: 'uppercase',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  sectionLine: { flex: 1, height: 1, background: `linear-gradient(to right, ${C.gold}44, transparent)` },

  // ── Item row ──
  itemRow: (inCart) => ({
    background: C.card, borderBottom: `1px solid ${C.border}`,
    display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
    borderLeft: `3px solid ${inCart ? C.wine : 'transparent'}`,
    transition: 'border-left-color .15s', minHeight: 80,
  }),
  thumb:   { width: 68, height: 68, borderRadius: 10, objectFit: 'cover', flexShrink: 0, background: C.border },
  thumbPH: {
    width: 68, height: 68, borderRadius: 10,
    background: `linear-gradient(135deg, ${C.goldDim}, ${C.wineDim})`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 24, flexShrink: 0,
  },
  itemBody:  { flex: 1, minWidth: 0 },
  itemName:  { fontSize: 14, fontWeight: 700, lineHeight: 1.4, color: C.text, marginBottom: 2 },
  itemDesc:  {
    fontSize: 12, color: C.muted, lineHeight: 1.45, marginBottom: 5,
    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
  },
  itemPrice: { fontSize: 15, fontWeight: 800, color: C.wine },

  // ── Qty controls ──
  addBtn: {
    width: 36, height: 36, borderRadius: 10, border: 'none',
    background: C.wine, color: C.white, fontSize: 22,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', flexShrink: 0, lineHeight: 1,
  },
  qtyRow: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  qtyBtn: (color) => ({
    width: 32, height: 32, borderRadius: 8, border: `1.5px solid ${color}`,
    background: 'transparent', color, fontSize: 20,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', lineHeight: 1,
  }),
  qtyNum: { fontSize: 15, fontWeight: 800, width: 22, textAlign: 'center', color: C.text },

  // ── Footer cart bar ──
  cartBar: {
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 30,
    background: C.card, borderTop: `1px solid ${C.border}`,
    padding: '10px 16px',
  },
  cartBtn: {
    width: '100%', display: 'flex', alignItems: 'center',
    background: C.wine, color: C.white, borderRadius: 14, border: 'none',
    cursor: 'pointer', padding: '0 18px', height: 54, gap: 10,
    boxShadow: '0 4px 16px rgba(123,33,54,.35)',
  },
  cartCountBadge: {
    background: C.gold, color: C.wineDark, borderRadius: 20,
    padding: '3px 12px', fontSize: 13, fontWeight: 800, flexShrink: 0,
  },
  cartLabel:     { flex: 1, fontSize: 16, fontWeight: 800, textAlign: 'center' },
  cartTotalText: { fontSize: 15, fontWeight: 700, flexShrink: 0 },

  // ── Bottom sheet ──
  sheet:       { position: 'fixed', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' },
  sheetBg:     { position: 'absolute', inset: 0, background: 'rgba(30,13,9,.55)' },
  sheetBox:    { position: 'relative', background: C.card, borderRadius: '20px 20px 0 0', maxHeight: '85dvh', display: 'flex', flexDirection: 'column' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, background: C.border, margin: '12px auto 0', flexShrink: 0 },
  sheetTitle:  { padding: '14px 20px 12px', fontSize: 16, fontWeight: 800, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  sheetClose:  { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: C.sub, lineHeight: 1, padding: 4 },
  sheetBody:   { overflowY: 'auto', flex: 1, padding: '0 20px', WebkitOverflowScrolling: 'touch' },
  sheetRow:    { display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderBottom: `1px solid ${C.border}` },
  sheetNote:   { padding: '12px 20px 4px', flexShrink: 0 },
  noteInput:   { width: '100%', background: C.cream, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: '10px 14px', fontSize: 14, outline: 'none', resize: 'none', fontFamily: 'inherit', color: C.text, boxSizing: 'border-box' },
  sheetFoot:   { padding: '14px 20px', display: 'flex', gap: 12, alignItems: 'center', borderTop: `1px solid ${C.border}`, flexShrink: 0 },
  submitBtn:   { padding: '0 28px', height: 52, borderRadius: 14, border: 'none', background: C.wine, color: C.white, fontSize: 16, fontWeight: 800, cursor: 'pointer', flexShrink: 0, boxShadow: '0 4px 12px rgba(123,33,54,.3)' },

  // ── State screens ──
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', padding: 32, gap: 14, textAlign: 'center', background: C.cream },
}

// ── Logo: 優先用 DB logo_url；次用 /logo.png；最後顯示首字 ───────────────────
function LogoImg({ logoUrl, storeName = '', size = 100, radius = 22, fontSize = 44, style = {} }) {
  const [src, setSrc] = useState(logoUrl || '/logo.png')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (logoUrl) { setSrc(logoUrl); setFailed(false) }
  }, [logoUrl])

  const baseStyle = { width: size, height: size, borderRadius: radius, overflow: 'hidden', flexShrink: 0, ...style }
  if (failed || (!logoUrl && !src)) {
    return (
      <div style={{ ...baseStyle, background: C.wine, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.gold, fontSize, fontWeight: 800 }}>
        {storeName.charAt(0) || '🍽'}
      </div>
    )
  }
  return (
    <div style={baseStyle}>
      <img src={src} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={() => {
          if (src !== '/logo.png') { setSrc('/logo.png') }
          else { setFailed(true) }
        }} />
    </div>
  )
}

function Spinner() {
  return (
    <>
      <div style={{ width: 38, height: 38, border: `3px solid ${C.border}`, borderTopColor: C.wine, borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  )
}

function LangToggle({ lang, setLang, variant = 'welcome' }) {
  const btnStyle = variant === 'welcome' ? S.langBtn : S.langBtnMenu
  return (
    <div style={variant === 'welcome' ? S.langBarWelcome : S.langBarHeader}>
      {['zh', 'en', 'ja', 'ko'].map(l => (
        <button key={l} style={btnStyle(lang === l)} onClick={() => setLang(l)}>
          {T[l].langLabel}
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function GuestMenu() {
  const { storeId, tableId } = useParams()
  const [searchParams]       = useSearchParams()
  const token                = searchParams.get('token')

  const [phase,      setPhase]      = useState('loading')
  const [errMsg,     setErrMsg]     = useState('')
  const [orderId,    setOrderId]    = useState(null)
  const [storeName,  setStoreName]  = useState('')
  const [tableNo,    setTableNo]    = useState('')
  const [logoUrl,    setLogoUrl]    = useState('')
  const [categories, setCategories] = useState([])
  const [items,      setItems]      = useState([])
  const [selCat,     setSelCat]     = useState(null)
  const [cart,       setCart]       = useState({})
  const [note,       setNote]       = useState('')
  const [showCart,   setShowCart]   = useState(false)
  const [lang,       setLang]       = useState('zh')

  const catBarRef = useRef(null)
  const t = T[lang]

  // ── Boot ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !storeId || !tableId) {
      setErrMsg('連結無效，請請店員重新產生 QR 碼'); setPhase('error'); return
    }
    async function boot() {
      const { data: session } = await supabase
        .from('qr_order_sessions').select('order_id, expires_at')
        .eq('token', token).eq('store_id', storeId).eq('table_id', tableId).maybeSingle()
      if (!session) { setErrMsg('QR 碼無效或已失效，請請店員重新產生'); setPhase('error'); return }
      if (new Date(session.expires_at) < new Date()) { setErrMsg('QR 碼已過期，請請店員重新產生'); setPhase('error'); return }
      setOrderId(session.order_id)

      const [{ data: store }, { data: table }] = await Promise.all([
        supabase.from('stores').select('name, organization_id').eq('id', storeId).maybeSingle(),
        supabase.from('res_tables').select('table_number').eq('id', tableId).maybeSingle(),
      ])
      setStoreName(store?.name ?? '')
      setTableNo(table?.table_number ?? '')

      // 讀公司 logo（Settings 那個）
      if (store?.organization_id) {
        const { data: org } = await supabase
          .from('organizations').select('logo_url').eq('id', store.organization_id).maybeSingle()
        if (org?.logo_url) setLogoUrl(org.logo_url)
      }

      const [{ data: cats }, { data: menuItems }] = await Promise.all([
        supabase.from('pos_menu_categories').select('id, name, display_order')
          .eq('store_id', storeId).eq('is_active', true).order('display_order'),
        supabase.from('pos_menu_items')
          .select('id, name, description, unit_price, tax_rate, image_url, category_id')
          .eq('store_id', storeId).eq('is_available', true).order('display_order'),
      ])
      setCategories(cats ?? [])
      setItems(menuItems ?? [])
      setPhase('welcome')
    }
    boot().catch(() => { setErrMsg('載入失敗，請重新整理頁面'); setPhase('error') })
  }, [token, storeId, tableId])

  // ── Cart ─────────────────────────────────────────────────────────────────────
  const setQty = useCallback((itemId, delta, cur) => {
    setCart(c => ({ ...c, [itemId]: Math.max(0, (cur || 0) + delta) }))
  }, [])

  const cartEntries = Object.entries(cart).filter(([, q]) => q > 0)
  const cartCount   = cartEntries.reduce((s, [, q]) => s + q, 0)
  const cartTotal   = cartEntries.reduce((s, [id, q]) => {
    const item = items.find(i => i.id === id)
    return s + (item ? Number(item.unit_price) * q : 0)
  }, 0)

  const grouped = categories.map(cat => ({
    cat, catItems: items.filter(i => i.category_id === cat.id),
  })).filter(g => g.catItems.length > 0)

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (cartCount === 0 || !orderId) return
    setShowCart(false)
    setPhase('submitting')
    const orderItems = cartEntries.map(([id, qty]) => {
      const item = items.find(i => i.id === id)
      return { itemType: 'menu', menuItemId: id, posProductId: null, name: item.name, unitPrice: item.unit_price, taxRate: item.tax_rate, quantity: qty, note: note.trim() }
    })
    const { error } = await supabase.functions.invoke('submit-guest-order', {
      body: { token, storeId, tableId, orderId, items: orderItems, note: note.trim() },
    })
    if (error) { setErrMsg(error.message || '送出失敗，請稍後再試'); setPhase('menu'); return }
    setPhase('done')
  }

  // ── Item row ─────────────────────────────────────────────────────────────────
  const renderItem = (item) => {
    const qty = cart[item.id] || 0
    return (
      <div key={item.id} style={S.itemRow(qty > 0)}>
        {item.image_url
          ? <img src={item.image_url} alt={item.name} style={S.thumb} />
          : <div style={S.thumbPH}>🍽️</div>
        }
        <div style={S.itemBody}>
          <div style={S.itemName}>{item.name}</div>
          {item.description && <div style={S.itemDesc}>{item.description}</div>}
          <div style={S.itemPrice}>NT$ {Number(item.unit_price).toLocaleString()}</div>
        </div>
        <div style={{ flexShrink: 0 }}>
          {qty === 0
            ? <button style={S.addBtn} onClick={() => setQty(item.id, 1, 0)}>+</button>
            : (
              <div style={S.qtyRow}>
                <button style={S.qtyBtn(C.wine)} onClick={() => setQty(item.id, -1, qty)}>−</button>
                <span style={S.qtyNum}>{qty}</span>
                <button style={S.qtyBtn(C.wine)} onClick={() => setQty(item.id, 1, qty)}>+</button>
              </div>
            )
          }
        </div>
      </div>
    )
  }

  // ── Screens ───────────────────────────────────────────────────────────────────

  if (phase === 'loading') return (
    <div style={S.page}><div style={S.center}><Spinner /><div style={{ fontSize: 14, color: C.sub }}>{t.loading}</div></div></div>
  )

  if (phase === 'error') return (
    <div style={S.page}>
      <div style={S.center}>
        <div style={{ fontSize: 52 }}>😞</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.wine }}>{t.errTitle}</div>
        <div style={{ fontSize: 14, color: C.sub, lineHeight: 1.7, maxWidth: 280 }}>{errMsg}</div>
      </div>
    </div>
  )

  if (phase === 'welcome') return (
    <div style={S.page}>
      <div style={S.welcome}>
        <div style={S.welDecor1} />
        <div style={S.welDecor2} />

        {/* 語言切換 */}
        <LangToggle lang={lang} setLang={setLang} variant="welcome" />

        {/* Logo */}
        <div style={S.logoWrap}>
          <LogoImg logoUrl={logoUrl} storeName={storeName} size={100} radius={0} fontSize={44} />
        </div>

        <div style={S.welLine} />
        <div style={S.welName}>{t.welcomeTitle(storeName)}</div>
        {tableNo && <div style={S.welTable}>{t.tableNo} {tableNo}</div>}

        <div style={S.welGreet}>
          {t.welcomeMsg}
          {'\n'}<span style={{ color: C.gold, fontSize: 13 }}>{t.welcomeSub}</span>
        </div>

        <button style={S.welBtn} onClick={() => setPhase('menu')}>
          <span>{t.startBtn}</span>
          <span style={{ fontSize: 20 }}>→</span>
        </button>
      </div>
    </div>
  )

  if (phase === 'submitting') return (
    <div style={S.page}><div style={S.center}><Spinner /><div style={{ fontSize: 14, color: C.sub }}>{t.submitting}</div></div></div>
  )

  if (phase === 'done') return (
    <div style={S.page}>
      <div style={S.center}>
        <div style={{ fontSize: 64 }}>🍽️</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.wine }}>{t.doneTitle}</div>
        <div style={{ fontSize: 14, color: C.sub, lineHeight: 1.9, maxWidth: 280, whiteSpace: 'pre-line' }}>
          {t.doneMsg}{'\n'}<span style={{ color: C.gold }}>{t.doneSub}</span>
        </div>
        <button onClick={() => { setCart({}); setNote(''); setPhase('menu') }}
          style={{ marginTop: 8, padding: '14px 36px', borderRadius: 14, border: 'none', background: C.wine, color: C.white, fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>
          {t.continueOrder}
        </button>
      </div>
    </div>
  )

  // ── Menu ─────────────────────────────────────────────────────────────────────
  const filteredItems = selCat ? items.filter(i => i.category_id === selCat) : []

  return (
    <div style={S.page}>

      {/* Header */}
      <div style={S.header}>
        <div style={S.headerLogoBox}>
          <LogoImg logoUrl={logoUrl} storeName={storeName} size={38} radius={9} fontSize={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.storeName}>{storeName || '自助點餐'}</div>
          {tableNo && <span style={S.tableTag}>{t.tableNo} {tableNo}</span>}
        </div>
        {/* 語言切換 */}
        <LangToggle lang={lang} setLang={setLang} variant="menu" />
        {cartCount > 0 && (
          <button style={S.cartChip} onClick={() => setShowCart(true)}>
            {cartCount} · NT${cartTotal.toLocaleString()}
          </button>
        )}
      </div>

      {/* Category tabs */}
      <div style={S.catBar} ref={catBarRef}>
        <button style={S.catPill(!selCat)} onClick={() => setSelCat(null)}>{t.all}</button>
        {categories.map(c => (
          <button key={c.id} data-cat={c.id} style={S.catPill(selCat === c.id)}
            onClick={() => {
              setSelCat(c.id)
              catBarRef.current?.querySelector(`[data-cat="${c.id}"]`)
                ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
            }}>
            {c.name}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {errMsg && (
        <div style={{ margin: '10px 16px 0', padding: '10px 14px', background: C.wineDim, borderRadius: 10, border: `1px solid ${C.wine}22`, fontSize: 13, color: C.wine, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{errMsg}</span>
          <button onClick={() => setErrMsg('')} style={{ background: 'none', border: 'none', color: C.wine, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Items */}
      <div style={{ paddingBottom: cartCount > 0 ? 90 : 32 }}>
        {selCat
          ? <>
              {filteredItems.map(renderItem)}
              {filteredItems.length === 0 && (
                <div style={{ textAlign: 'center', padding: '48px 24px', color: C.muted, fontSize: 14 }}>{t.noItems}</div>
              )}
            </>
          : grouped.map(({ cat, catItems }) => (
            <div key={cat.id}>
              <div style={S.sectionHead}>
                <span>{cat.name}</span>
                <div style={S.sectionLine} />
              </div>
              {catItems.map(renderItem)}
            </div>
          ))
        }
      </div>

      {/* Cart bar */}
      {cartCount > 0 && (
        <div style={S.cartBar}>
          <button style={S.cartBtn} onClick={() => setShowCart(true)}>
            <span style={S.cartCountBadge}>{cartCount}</span>
            <span style={S.cartLabel}>{t.viewOrder}</span>
            <span style={S.cartTotalText}>NT$ {cartTotal.toLocaleString()}</span>
          </button>
        </div>
      )}

      {/* Cart sheet */}
      {showCart && (
        <div style={S.sheet}>
          <div style={S.sheetBg} onClick={() => setShowCart(false)} />
          <div style={S.sheetBox}>
            <div style={S.sheetHandle} />
            <div style={S.sheetTitle}>
              <span>{t.yourOrder}</span>
              <button style={S.sheetClose} onClick={() => setShowCart(false)}>×</button>
            </div>
            <div style={S.sheetBody}>
              {cartEntries.map(([id, qty]) => {
                const item = items.find(i => i.id === id)
                if (!item) return null
                return (
                  <div key={id} style={S.sheetRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.4 }}>{item.name}</div>
                      <div style={{ fontSize: 13, color: C.wine, marginTop: 3, fontWeight: 700 }}>
                        NT$ {(Number(item.unit_price) * qty).toLocaleString()}
                      </div>
                    </div>
                    <div style={S.qtyRow}>
                      <button style={S.qtyBtn(C.wine)} onClick={() => setQty(id, -1, qty)}>−</button>
                      <span style={S.qtyNum}>{qty}</span>
                      <button style={S.qtyBtn(C.wine)} onClick={() => setQty(id, 1, qty)}>+</button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={S.sheetNote}>
              <textarea rows={2} value={note} onChange={e => setNote(e.target.value)}
                placeholder={t.notePlaceholder} style={S.noteInput} />
            </div>
            <div style={S.sheetFoot}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: '0.5px' }}>{t.total}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: C.wine }}>NT$ {cartTotal.toLocaleString()}</div>
              </div>
              <button style={S.submitBtn} onClick={handleSubmit}>{t.placeOrder}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
