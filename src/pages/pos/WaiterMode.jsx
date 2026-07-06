import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { useAuth, useOrgId } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import { parseTableQR } from '../../lib/tableQR'
import { createBarcodeListener, playBeep } from '../../lib/barcodeScanner'
import { kickCashDrawer, connectThermalPrinter } from '../../lib/receiptPrinter'
import { issueInvoice } from '../../lib/invoiceService'
import { buildQRPair, code39Svg, buildBarcodeContent, buildProofSlipHtml, formatInvNo } from '../../lib/einvoice/proofSlip'
import { getEventBus } from '../../lib/events/index.js'
import POSVariantModal from './components/POSVariantModal'

// 收據紙寬（門市熱感機）：pos_paper_width='58' → 58mm，否則 80mm。用於各列印版面的 @page size。
const posPaperPage = () => { try { return localStorage.getItem('pos_paper_width') === '58' ? '58mm' : '80mm' } catch { return '80mm' } }

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

  // ── Table select ──────────────────────────────────────────────────────────
  tableGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 12, padding: 20,
  },
  tableCard: (status) => ({
    background: 'var(--bg-card)',
    border: `2px solid ${
      status === 'empty' ? 'var(--accent-green)' : 'var(--accent-orange)'
    }`,
    borderRadius: 14, padding: '18px 12px',
    cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    transition: 'transform 0.1s',
  }),
  tableNum:  { fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' },
  tableBadge: (status) => ({
    fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
    background: status === 'empty' ? 'var(--accent-green-dim)' : 'var(--accent-orange-dim)',
    color:      status === 'empty' ? 'var(--accent-green)'     : 'var(--accent-orange)',
  }),
  tableCap:  { fontSize: 12, color: 'var(--text-muted)' },

  // ── Order body ────────────────────────────────────────────────────────────
  orderBody: { display: 'flex', flex: 1, overflow: 'hidden' },

  // ── Category sidebar (wide) ───────────────────────────────────────────────
  catSidebar: {
    width: 190, flexShrink: 0,
    borderRight: '1px solid var(--border-primary)',
    background: 'var(--bg-secondary)',
    overflowY: 'auto', padding: '10px 8px',
    display: 'flex', flexDirection: 'column', gap: 2,
  },
  catSideBtn: (active) => ({
    width: '100%', textAlign: 'left',
    padding: '10px 14px', borderRadius: 8, border: 'none',
    cursor: 'pointer', fontSize: 14,
    fontWeight: active ? 700 : 400,
    background: active ? 'var(--accent-cyan)' : 'transparent',
    color: active ? '#fff' : 'var(--text-secondary)',
    transition: 'all 0.12s',
  }),

  // ── Category bar (mobile) ─────────────────────────────────────────────────
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
    transition: 'all 0.12s',
  }),

  // ── Menu area ─────────────────────────────────────────────────────────────
  menuArea: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' },

  // ── Item grid ─────────────────────────────────────────────────────────────
  itemGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
    gap: 10, padding: '14px',
    alignContent: 'start',
  },

  // ── Item card (clean, no emoji placeholder) ───────────────────────────────
  itemCard: (inCart) => ({
    background: 'var(--bg-card)',
    border: `2px solid ${inCart ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
    borderRadius: 12,
    cursor: 'pointer',
    position: 'relative',
    transition: 'border-color 0.12s',
    overflow: 'hidden',
  }),
  itemImg:  { width: '100%', height: 90, objectFit: 'cover', display: 'block' },
  cardBody: { padding: '12px 14px 13px' },
  itemName: {
    fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
    lineHeight: 1.35, marginBottom: 6,
    display: '-webkit-box', WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  itemPriceRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  itemPrice: { fontSize: 15, fontWeight: 700, color: 'var(--accent-cyan)', flexShrink: 0 },
  addBtn: {
    width: 30, height: 30, borderRadius: 7, border: 'none', cursor: 'pointer',
    background: 'var(--accent-cyan)', color: '#fff',
    fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1, flexShrink: 0,
  },
  qtyRow: { display: 'flex', alignItems: 'center', gap: 4 },
  qtyBtn: (rm) => ({
    width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
    background: rm ? 'var(--accent-red)' : 'var(--accent-cyan)', color: '#fff',
    fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1, flexShrink: 0,
  }),
  qtyNum: { fontSize: 13, fontWeight: 700, minWidth: 20, textAlign: 'center' },
  cartBadge: {
    position: 'absolute', top: 6, right: 6,
    background: 'var(--accent-cyan)', color: '#fff',
    borderRadius: 12, fontSize: 11, fontWeight: 700, padding: '2px 7px',
  },
  noteBtn: {
    marginTop: 7, background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 12, padding: 0, display: 'block',
  },

  // ── Right panel ───────────────────────────────────────────────────────────
  panel: {
    width: 300, borderLeft: '1px solid var(--border-primary)',
    background: 'var(--bg-secondary)',
    display: 'flex', flexDirection: 'column',
    flexShrink: 0,
  },
  panelScroll: { flex: 1, overflowY: 'auto' },
  panelHead: {
    padding: '12px 14px 8px',
    fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
    letterSpacing: '0.6px', textTransform: 'uppercase',
    borderBottom: '1px solid var(--border-primary)',
  },
  panelRow: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '8px 14px', gap: 8,
    borderBottom: '1px solid var(--border-primary)',
    fontSize: 13,
  },
  panelRowName: { flex: 1, color: 'var(--text-primary)', fontWeight: 500, lineHeight: 1.3 },
  panelRowAmt:  { color: 'var(--text-secondary)', fontWeight: 600, flexShrink: 0, fontSize: 12 },
  panelEmpty:  { padding: '24px 14px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' },
  panelFoot: {
    borderTop: '2px solid var(--border-primary)',
    padding: '14px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
  },
  panelTotal: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 0 8px' },
  panelTotalLabel: { fontSize: 13, color: 'var(--text-muted)' },
  panelTotalAmt:   { fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' },
  panelBtn: (color) => ({
    width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
    cursor: 'pointer',
    background: `var(--accent-${color})`,
    color: '#fff', fontSize: 15, fontWeight: 700,
  }),
  panelBtnDisabled: {
    width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
    cursor: 'not-allowed',
    background: 'var(--bg-card)',
    color: 'var(--text-muted)', fontSize: 15, fontWeight: 700,
  },

  // ── Mobile footer ─────────────────────────────────────────────────────────
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
    fontSize: 14, fontWeight: 700,
  }),

  // ── Modals ────────────────────────────────────────────────────────────────
  overlay: {
    position: 'fixed', inset: 0, zIndex: 60,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  noteBox: {
    background: 'var(--bg-card)', borderRadius: 14, padding: 20,
    width: '100%', maxWidth: 360,
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  noteTitle: { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  textarea: {
    width: '100%', background: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)', borderRadius: 8,
    padding: '10px 12px', fontSize: 14, color: 'var(--text-primary)',
    outline: 'none', resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  },
  rowBtn: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  smallBtn: (p) => ({
    padding: '7px 18px', borderRadius: 8,
    border: `1px solid ${p ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
    background: p ? 'var(--accent-cyan)' : 'var(--bg-card)',
    color: p ? '#fff' : 'var(--text-secondary)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
  }),
  errBanner: {
    margin: '8px 14px 0', padding: '10px 14px',
    background: 'var(--accent-red-dim)', border: '1px solid var(--accent-red)',
    borderRadius: 8, fontSize: 13, color: 'var(--accent-red)',
    display: 'flex', alignItems: 'center', gap: 8,
  },

  // ── Checkout modal ────────────────────────────────────────────────────────
  coBox: {
    position: 'relative', zIndex: 1,
    background: 'var(--bg-card)', borderRadius: 16,
    border: '1px solid var(--border-primary)',
    width: '100%', maxWidth: 420, maxHeight: '90dvh',
    display: 'flex', flexDirection: 'column',
  },
  coHead: {
    padding: '16px 20px 12px', borderBottom: '1px solid var(--border-primary)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
  },
  coTitle:  { fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' },
  coClose:  { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: 4 },
  coBody:   { overflowY: 'auto', flex: 1, padding: '0 20px' },
  coSection:{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase', padding: '12px 0 4px' },
  coRow:    { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid var(--border-primary)', fontSize: 14, gap: 8 },
  coTotal:  { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 20px', background: 'var(--bg-secondary)', borderTop: '2px solid var(--border-primary)', flexShrink: 0 },
  coPayMethods: { display: 'flex', gap: 8, padding: '10px 20px', flexWrap: 'wrap', borderBottom: '1px solid var(--border-primary)', flexShrink: 0 },
  coPayBtn: (active) => ({
    padding: '8px 16px', borderRadius: 8,
    border: `1.5px solid ${active ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
    background: active ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
    color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
    fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer',
  }),
  coFoot: { padding: '14px 20px', display: 'flex', gap: 10, flexShrink: 0 },
}

// ── Kitchen slip printer ───────────────────────────────────────────────────────
function printKitchenSlip(tableNumber, rows) {
  try {
    const now     = new Date()
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    const totalQty = rows.reduce((s, r) => s + (r.quantity ?? r.qty ?? 1), 0)
    const itemRows = rows.map(r => {
      const qty  = r.quantity ?? r.qty ?? 1
      const note = r.note ? `<tr><td colspan="2" style="font-size:12px;color:#444;padding:0 0 5px 4px">⚑ ${r.note}</td></tr>` : ''
      return `<tr><td style="font-size:16px;font-weight:700;padding:4px 0">${r.name ?? r.item_name ?? ''}</td><td style="font-size:16px;font-weight:700;text-align:right;white-space:nowrap">× ${qty}</td></tr>${note}`
    }).join('')

    const win = window.open('', '_blank', 'width=320,height=480')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Noto Sans TC","微軟正黑體",monospace;padding:12px 10px;width:100%}
.hdr{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.tnum{font-size:34px;font-weight:900;letter-spacing:1px}
.time{font-size:15px;color:#333;font-weight:600}
hr{border:none;border-top:2px dashed #000;margin:8px 0}
table{width:100%;border-collapse:collapse}
.foot{font-size:12px;color:#666;text-align:right;margin-top:6px}
@media print{@page{margin:2mm;size:${posPaperPage()} auto}button{display:none}}
</style></head><body>
<div class="hdr"><span class="tnum">T${tableNumber}</span><span class="time">${timeStr}</span></div>
<hr>
<table>${itemRows}</table>
<hr>
<div class="foot">共 ${totalQty} 品</div>
</body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); setTimeout(() => win.close(), 800) }, 350)
  } catch (_) { /* 印表機未就緒時靜默，不影響送廚房主流程 */ }
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

const PAY_LABEL = { cash: '現金', card: '信用卡', line_pay: 'LINE Pay', jkopay: '街口', other: '其他' }

// 非現金收款一律走銀行收單（實體刷卡機 / 銀行掃碼），不經線上金流閘道：
// card → 銀行刷卡機；line_pay / jkopay → 掃顧客出示的付款碼後確認
const TERMINAL_METHODS = { card: '銀行刷卡機', line_pay: 'LINE Pay', jkopay: '街口' }

// 錢包付款碼：16-19 碼數字（EAN-13 商品條碼最長 13 碼，不會誤判）
const WALLET_CODE_RE = /^\d{16,19}$/

// 手機載具條碼：/ + 7 碼（0-9 A-Z + - .）
const CARRIER_RE = /^\/[0-9A-Z+\-.]{7}$/

// 點數折抵匯率（與 POSTerminal 一致：1 點 = NT$0.5）
const POINT_RATE = 0.5

function CheckoutModal({ tableNumber, orgId, storeId, orderId, storeName, cashier, openDrawer, onClose, onDone }) {
  const [payMethod, setPayMethod] = useState('cash')
  const [busy,      setBusy]      = useState(false)
  const [dbItems,   setDbItems]   = useState([])
  const [orderInfo, setOrderInfo] = useState({})
  const [loading,   setLoading]   = useState(true)
  const [discType,     setDiscType]     = useState('percent')
  const [discVal,      setDiscVal]      = useState('')
  const [invType,      setInvType]      = useState('none')   // 'none' | 'mobile' | 'company'
  const [carrierId,    setCarrierId]    = useState('')
  const [buyerTaxId,   setBuyerTaxId]   = useState('')
  const [buyerCompany, setBuyerCompany] = useState('')
  const [noteVal,      setNoteVal]      = useState('')
  const [memberPhone,  setMemberPhone]  = useState('')
  const [member,       setMember]       = useState(null)   // { id, name, phone, level, total_points }
  const [memberBusy,   setMemberBusy]   = useState(false)
  const [couponCode,   setCouponCode]   = useState('')
  const [coupon,       setCoupon]       = useState(null)   // applied coupon (+ assignmentId if member-owned)
  const [couponBusy,   setCouponBusy]   = useState(false)
  const [memberCoupons, setMemberCoupons] = useState([])   // bound member's unused, valid coupons
  const [pointsUsed,   setPointsUsed]   = useState('')     // points to redeem for dollars
  const [cashTendered, setCashTendered] = useState('')     // 現金實收金額
  const [walletCode,   setWalletCode]   = useState('')     // 掃到的顧客錢包付款碼
  const [paymentId,    setPaymentId]    = useState(null)   // 本次收款的 pos_payments.id（開發票用）
  const [invoiceNo,    setInvoiceNo]    = useState(null)   // 已開立的發票號碼
  const [invoiceMeta,  setInvoiceMeta]  = useState(null)   // { number, randomCode, salesAmount, taxAmount, invoiceDate }
  const [invoiceBusy,  setInvoiceBusy]  = useState(false)
  const [sellerTaxId,  setSellerTaxId]  = useState('')     // 賣方統編（organizations.tax_id，證明聯用）
  const [stage,        setStage]        = useState('form') // 'form' | 'paid'
  const [awaitCarrier, setAwaitCarrier] = useState(false)  // paid stage: waiting for carrier scan
  const [carrierSaved, setCarrierSaved] = useState(null)   // carrier the e-invoice was saved to
  const [carrierInput, setCarrierInput] = useState('')
  const [svcPct,       setSvcPct]       = useState(10)     // 服務費 %（門市設定，預設 10）
  const [svcOn,        setSvcOn]        = useState(true)   // 本單是否收服務費
  const [termDone,     setTermDone]     = useState(false)  // 銀行刷卡機交易已完成
  const [termAuthCode, setTermAuthCode] = useState('')     // 刷卡授權碼（選填）

  // Fetch items + order meta (opened_at, order_number, note) on mount
  useEffect(() => {
    Promise.all([
      supabase.from('pos_order_items')
        .select('id, name, unit_price, quantity, pos_product_id')
        .eq('order_id', orderId)
        .is('voided_at', null)
        .order('created_at'),
      supabase.from('pos_orders')
        .select('opened_at, order_number, note, member_id, members(id, name, phone, level, total_points, available_points)')
        .eq('id', orderId)
        .maybeSingle(),
      supabase.from('pos_store_settings')
        .select('service_charge_pct')
        .eq('organization_id', orgId)
        .eq('store_id', storeId)
        .maybeSingle(),
      supabase.from('organizations')
        .select('tax_id')
        .eq('id', orgId)
        .maybeSingle(),
    ]).then(([itemsRes, orderRes, settingsRes, orgRes]) => {
      const pct = Number(settingsRes?.data?.service_charge_pct)
      if (Number.isFinite(pct)) setSvcPct(pct)
      setSellerTaxId(orgRes?.data?.tax_id ?? '')
      setDbItems(itemsRes.data ?? [])
      const ord = orderRes.data ?? {}
      setOrderInfo(ord)
      setNoteVal(ord.note ?? '')
      if (ord.members) {
        setMember(ord.members)
        setMemberPhone(ord.members.phone ?? '')
      }
      setLoading(false)
    })
  }, [orderId])

  // 手動查詢：手機 / 會員編號 / 會員卡 QR token 皆可
  async function searchMember() {
    const q = memberPhone.trim()
    if (!q) return
    setMemberBusy(true)
    const { data } = await supabase.from('members')
      .select('id, name, phone, level, total_points, available_points')
      .eq('organization_id', orgId)
      .or(`phone.ilike.%${q}%,member_number.ilike.%${q}%,qr_token.eq.${q}`)
      .limit(1)
    setMemberBusy(false)
    const found = data?.[0] ?? null
    if (found) { setMember(found); setMemberPhone(found.phone ?? '') }
    else toast.error('查無此會員')
  }

  // 綁定會員後載入其未使用、可折抵的優惠券（app 錢包同步：coupon_assignments）
  useEffect(() => {
    if (!member?.id) { setMemberCoupons([]); setPointsUsed(''); return }
    supabase.from('coupon_assignments')
      .select('id, expires_at, coupons(id, code, name, type, value, min_purchase, valid_until, status)')
      .eq('member_id', member.id)
      .is('used_at', null)
      .then(({ data }) => {
        const now = new Date()
        setMemberCoupons((data ?? []).filter(a =>
          a.coupons &&
          a.coupons.status === 'active' &&
          ['pct_off', 'fixed_off'].includes(a.coupons.type) &&
          (!a.expires_at || new Date(a.expires_at) > now) &&
          (!a.coupons.valid_until || new Date(a.coupons.valid_until) > now)
        ))
      })
  }, [member?.id])

  const subtotal    = dbItems.reduce((s, i) => s + Number(i.unit_price) * i.quantity, 0)
  const taxAmount   = Math.round(subtotal * 5 / 105)   // 含稅 5%（結帳前小計含稅）
  const discAmount  = discVal
    ? discType === 'percent'
      ? Math.round(subtotal * Math.min(parseFloat(discVal) || 0, 100) / 100)
      : Math.min(parseFloat(discVal) || 0, subtotal)
    : 0
  const couponDiscount = coupon
    ? coupon.type === 'pct_off'
      ? Math.floor(subtotal * (Number(coupon.value) || 0) / 100)
      : Math.min(Math.max(0, subtotal - discAmount), Number(coupon.value) || 0)
    : 0
  // 內用服務費（以餐點小計計算，折扣前；可整單免收）
  const serviceCharge = svcOn ? Math.round(subtotal * svcPct / 100) : 0
  const pointsAvailable = member?.available_points ?? 0
  const pointsNum       = Math.max(0, Math.min(Math.floor(Number(pointsUsed) || 0), pointsAvailable))
  const pointsDiscount  = Math.min(
    Math.floor(pointsNum * POINT_RATE),
    Math.max(0, subtotal + serviceCharge - discAmount - couponDiscount)
  )
  const total = Math.max(0, subtotal + serviceCharge - discAmount - couponDiscount - pointsDiscount)

  // 會員錢包選券（出示 app 優惠券畫面 → 店員點選）
  function applyMemberCoupon(a) {
    const c = a.coupons
    if (Number(c.min_purchase) > subtotal) {
      toast.error(`未達低消 NT$${Number(c.min_purchase).toLocaleString()}`)
      return
    }
    setCoupon({ ...c, assignmentId: a.id })
    toast.success(`已套用「${c.name}」`)
  }

  // ── 優惠碼套用（打字或掃描）──────────────────────────────────
  // 回傳 'applied' | 'invalid' | 'notfound'，掃描分流時據此決定是否再試商品條碼
  async function applyCoupon(codeRaw, { silent = false } = {}) {
    const code = (codeRaw ?? couponCode).trim()
    if (!code) return 'notfound'
    setCouponBusy(true)
    try {
      const { data } = await supabase.from('coupons')
        .select('id, code, name, type, value, min_purchase, valid_from, valid_until, status, usage_limit_total, used_count')
        .eq('organization_id', orgId)
        .ilike('code', code)
        .limit(1)
      const c = data?.[0]
      if (!c) {
        if (!silent) toast.error('查無此優惠碼')
        return 'notfound'
      }
      const now = new Date()
      if (c.status !== 'active')                                  { toast.error('此優惠券未啟用'); return 'invalid' }
      if (c.valid_from && new Date(c.valid_from) > now)           { toast.error('此優惠券尚未生效'); return 'invalid' }
      if (c.valid_until && new Date(c.valid_until) <= now)        { toast.error('此優惠券已過期'); return 'invalid' }
      if (c.usage_limit_total && c.used_count >= c.usage_limit_total) { toast.error('此優惠券已達使用上限'); return 'invalid' }
      if (!['pct_off', 'fixed_off'].includes(c.type))             { toast.error('此券型不支援結帳折抵'); return 'invalid' }
      if (Number(c.min_purchase) > subtotal)                      { toast.error(`未達低消 NT$${Number(c.min_purchase).toLocaleString()}`); return 'invalid' }

      // 通用碼 vs 會員專屬券：有發放紀錄（assignments）的券視為會員專屬，
      // 必須綁定持券會員才能用；無發放紀錄的碼為通用碼，任何人可輸入
      const { count: issuedCount } = await supabase.from('coupon_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('coupon_id', c.id)
      let assignmentId = null
      if ((issuedCount ?? 0) > 0) {
        if (!member) { toast.error('此為會員專屬優惠券，請先綁定會員'); return 'invalid' }
        const { data: asg } = await supabase.from('coupon_assignments')
          .select('id')
          .eq('coupon_id', c.id).eq('member_id', member.id)
          .is('used_at', null)
          .limit(1)
        if (!asg?.[0]) { toast.error('此會員未持有此優惠券（或已使用）'); return 'invalid' }
        assignmentId = asg[0].id
      }
      setCoupon({ ...c, assignmentId })
      setCouponCode('')
      toast.success(`已套用「${c.name}」`)
      return 'applied'
    } finally {
      setCouponBusy(false)
    }
  }

  // ── 掃商品條碼 → 加入本單 ────────────────────────────────────
  async function addProductItem(p) {
    const existing = dbItems.find(i => i.pos_product_id === p.id)
    if (existing) {
      const { error } = await supabase.from('pos_order_items')
        .update({ quantity: existing.quantity + 1 })
        .eq('id', existing.id)
      if (error) { playBeep(false); toast.error('加入失敗：' + error.message); return }
      setDbItems(prev => prev.map(i => i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i))
    } else {
      const { data, error } = await supabase.from('pos_order_items')
        .insert({
          order_id:       orderId,
          item_type:      'product',
          pos_product_id: p.id,
          name:           p.name,
          unit_price:     p.retail_price,
          quantity:       1,
          source:         'staff',
        })
        .select('id, name, unit_price, quantity, pos_product_id')
        .single()
      if (error) { playBeep(false); toast.error('加入失敗：' + error.message); return }
      setDbItems(prev => [...prev, data])
    }
    playBeep(true)
    toast.success(`已加入 ${p.name}`)
  }

  // ── 開立電子發票（冪等；失敗不擋流程，付款維持 pending 由發票查詢頁補開）──
  // 回傳 { number, randomCode, salesAmount, taxAmount, invoiceDate } 或 null
  async function ensureInvoice(pid = paymentId) {
    if (invoiceMeta) return invoiceMeta
    if (!pid) return null
    setInvoiceBusy(true)
    const res = await issueInvoice(pid)
    setInvoiceBusy(false)
    if (res.ok) {
      const meta = {
        number:      res.invoiceNumber,
        randomCode:  res.randomCode,
        salesAmount: res.salesAmount,
        taxAmount:   res.taxAmount,
        invoiceDate: res.invoiceDate,
      }
      setInvoiceNo(res.invoiceNumber)
      setInvoiceMeta(meta)
      return meta
    }
    toast.info(res.error || '發票將稍後補開')
    return null
  }

  // ── 列印電子發票證明聯（含交易明細，虛線裁切）──────────────────
  async function printProofSlip(inv) {
    const invDate = inv.invoiceDate ? new Date(`${inv.invoiceDate}T00:00:00`) : new Date()
    const salesAmt = inv.salesAmount ?? Math.round(total / 1.05)
    const buyer = invType === 'company' && buyerTaxId ? buyerTaxId : null
    const qrItems = dbItems.map(i => ({ name: i.name, quantity: i.quantity, unitPrice: Number(i.unit_price) }))

    const { left, right } = buildQRPair({
      invoiceNumber: inv.number,
      date:          invDate,
      randomCode:    inv.randomCode,
      salesAmount:   salesAmt,
      totalAmount:   total,
      buyerTaxId:    buyer,
      sellerTaxId,
      items:         qrItems,
    })
    let qrL = '', qrR = ''
    try {
      ;[qrL, qrR] = await Promise.all([
        QRCode.toDataURL(left,  { margin: 0, width: 160 }),
        QRCode.toDataURL(right, { margin: 0, width: 160 }),
      ])
    } catch { /* QR 產生失敗仍列印其餘內容 */ }

    const row = (label, amt, bold = false) =>
      `<div style="display:flex;justify-content:space-between${bold ? ';font-weight:800;border-top:1px dashed #999;margin-top:4px;padding-top:2px' : ''}"><span>${label}</span><span>${amt}</span></div>`
    const detailHtml = `
<div style="text-align:left;font-size:12px;line-height:1.7">
  <div style="text-align:center;font-weight:700;margin-bottom:4px">交易明細</div>
  ${dbItems.map(i => row(`${i.name} ×${i.quantity}`, (Number(i.unit_price) * i.quantity).toLocaleString())).join('')}
  ${serviceCharge > 0 ? row(`服務費(${svcPct}%)`, serviceCharge.toLocaleString()) : ''}
  ${discAmount > 0 ? row('折扣', `-${discAmount.toLocaleString()}`) : ''}
  ${couponDiscount > 0 ? row(`優惠券(${coupon.code})`, `-${couponDiscount.toLocaleString()}`) : ''}
  ${pointsDiscount > 0 ? row(`點數折抵(${pointsNum}點)`, `-${pointsDiscount.toLocaleString()}`) : ''}
  ${row('合計', total.toLocaleString(), true)}
</div>`

    const html = buildProofSlipHtml({
      storeName,
      invoiceNumber:  inv.number,
      date:           invDate,
      randomCode:     inv.randomCode,
      totalAmount:    total,
      sellerTaxId,
      buyerTaxId:     buyer,
      barcodeSvg:     code39Svg(buildBarcodeContent(invDate, inv.number, inv.randomCode)),
      qrLeftDataUrl:  qrL,
      qrRightDataUrl: qrR,
      detailHtml,
    })
    const win = window.open('', '_blank', 'width=340,height=680')
    if (!win) { toast.error('請允許彈出視窗以列印證明聯'); return }
    win.document.write(html)
    win.document.close()
    win.focus()
  }

  // ── 付款後存載具（電子發票）────────────────────────────────
  async function saveCarrier(code) {
    const { error } = await supabase.from('pos_orders')
      .update({ carrier_type: 'mobile', carrier_id: code })
      .eq('id', orderId)
    if (error) { playBeep(false); toast.error('載具儲存失敗：' + error.message); return }
    // 同步掛到付款（issue-invoice 讀 pos_payments 為主）再開立
    if (paymentId) {
      await supabase.from('pos_payments')
        .update({ carrier_type: '3J0002', carrier_number: code })
        .eq('id', paymentId)
    }
    setCarrierSaved(code)
    setAwaitCarrier(false)
    setCarrierInput('')
    playBeep(true)
    const inv = await ensureInvoice()
    toast.success(inv ? `電子發票 ${formatInvNo(inv.number)} 已存入載具 ${code}` : `載具 ${code} 已登錄，發票開立後自動歸戶`)
  }

  // ── 結帳中掃描分流：載具 → 會員卡 QR → 優惠碼 → 商品條碼 ──────
  // 掃描一律精確比對（qr_token / code / barcode），避免模糊查詢誤配
  async function handleScan(code) {
    const codeUp = code.trim().toUpperCase()
    // 付款完成階段：只接收手機載具條碼
    if (stage === 'paid') {
      if (CARRIER_RE.test(codeUp)) await saveCarrier(codeUp)
      else playBeep(false)
      return
    }
    // 付款前掃到載具條碼 → 直接帶入發票欄位
    if (CARRIER_RE.test(codeUp)) {
      setInvType('mobile')
      setCarrierId(codeUp)
      playBeep(true)
      toast.success(`已帶入手機載具 ${codeUp}`)
      return
    }
    // 顧客錢包付款碼（LINE Pay / 街口出示付款碼，銀行掃碼收單）
    if ((payMethod === 'line_pay' || payMethod === 'jkopay') && WALLET_CODE_RE.test(codeUp)) {
      setWalletCode(codeUp)
      setTermDone(true)
      playBeep(true)
      toast.success(`已讀取${TERMINAL_METHODS[payMethod]}付款碼，請確認收款`)
      return
    }
    if (parseTableQR(code)) return // 桌卡 QR，結帳中無意義
    const { data: memData } = await supabase.from('members')
      .select('id, name, phone, level, total_points, available_points')
      .eq('organization_id', orgId)
      .eq('qr_token', code)
      .limit(1)
    const mem = memData?.[0]
    if (mem) {
      setMember(mem); setMemberPhone(mem.phone ?? '')
      playBeep(true); toast.success(`已綁定會員 ${mem.name}`)
      return
    }
    const couponResult = await applyCoupon(code, { silent: true })
    if (couponResult === 'applied') { playBeep(true); return }
    if (couponResult === 'invalid') { playBeep(false); return } // 原因已 toast
    const { data: prods } = await supabase.from('pos_products')
      .select('id, name, retail_price')
      .eq('organization_id', orgId)
      .eq('barcode', code)
      .eq('is_available', true)
      .limit(1)
    if (prods?.[0]) { await addProductItem(prods[0]); return }
    playBeep(false)
    toast.error('無法辨識的條碼 / QR')
  }

  // 掃描槍全域監聽（modal 開啟期間）；handler 走 ref 避免 stale closure
  const scanRef = useRef(handleScan)
  scanRef.current = handleScan
  useEffect(() => createBarcodeListener(code => scanRef.current(code)), [])

  function printReceipt(invNo = invoiceNo) {
    try {
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const printTime = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
      const openedDate = orderInfo.opened_at ? new Date(orderInfo.opened_at) : now
      const openTime = `${pad(openedDate.getHours())}:${pad(openedDate.getMinutes())}:${pad(openedDate.getSeconds())}`
      const openedStr = `${openedDate.getFullYear()}-${pad(openedDate.getMonth()+1)}-${pad(openedDate.getDate())} ${pad(openedDate.getHours())}:${pad(openedDate.getMinutes())}`
      const orderNum = orderInfo.order_number || orderId?.toString().slice(-8).toUpperCase() || '-'
      const orderNote = orderInfo.note || ''

      const itemRows = dbItems.map(i => {
        const amt = Number(i.unit_price) * i.quantity
        return `<tr>
          <td style="padding:2px 0;font-size:13px;word-break:break-all">${i.name}</td>
          <td style="text-align:center;font-size:13px;padding:2px 4px;white-space:nowrap">${i.quantity}</td>
          <td style="text-align:right;font-size:13px;white-space:nowrap">${amt.toLocaleString()}</td>
        </tr>`
      }).join('')
      const carrierShown = invType === 'mobile' ? (carrierId || carrierSaved) : carrierSaved
      const invLine = carrierShown             ? `<div style="font-size:11px;color:#666;margin-top:2px">手機載具：${carrierShown}</div>`
                    : invType === 'company'    ? `<div style="font-size:11px;color:#666;margin-top:2px">統編：${buyerTaxId}　${buyerCompany}</div>`
                    : ''
      const win = window.open('', '_blank', 'width=320,height=680')
      if (!win) return
      win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Courier New","Noto Sans TC","微軟正黑體",monospace;padding:10px 10px;font-size:12px;line-height:1.7}
.center{text-align:center}
.bold{font-weight:700}
hr{border:none;border-top:1px dashed #000;margin:4px 0}
table{width:100%;border-collapse:collapse}
table th{font-size:12px;font-weight:400;border-bottom:1px dashed #000;padding-bottom:3px}
.th-name{text-align:left}
.th-qty{text-align:center}
.th-amt{text-align:right}
.r{display:flex;justify-content:space-between;font-size:12px;padding:2px 0}
.total{display:flex;justify-content:space-between;font-size:15px;font-weight:800;padding:3px 0}
@media print{@page{margin:2mm;size:${posPaperPage()} auto}}
</style></head><body>
<div class="center bold" style="font-size:14px;margin-bottom:2px">${storeName || '威士威'}</div>
<div>內用:${orderNum}</div>
<div class="center bold" style="font-size:13px;letter-spacing:1px">內用==結帳單==</div>
<hr>
<div>列印時間${printTime} 機01</div>
<div>單:${orderNum}</div>
${invNo ? `<div class="bold">發票號碼:${invNo.length === 10 ? invNo.slice(0, 2) + '-' + invNo.slice(2) : invNo}</div>` : ''}
<div>送達時間:${openedStr}</div>
<div>桌:T${tableNumber}</div>
<div>開:${openTime}</div>
<hr>
<table>
  <thead><tr>
    <th class="th-name">品名</th>
    <th class="th-qty">數量</th>
    <th class="th-amt">金額</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>
<hr>
${serviceCharge > 0 ? `<div class="r"><span>服務費(${svcPct}%)</span><span>${serviceCharge.toLocaleString()}</span></div>` : ''}
${discAmount > 0 ? `<div class="r"><span>折扣</span><span>-${discAmount.toLocaleString()}</span></div>` : ''}
${couponDiscount > 0 ? `<div class="r"><span>優惠券(${coupon.code})</span><span>-${couponDiscount.toLocaleString()}</span></div>` : ''}
${pointsDiscount > 0 ? `<div class="r"><span>點數折抵(${pointsNum}點)</span><span>-${pointsDiscount.toLocaleString()}</span></div>` : ''}
<div class="total"><span>合計:</span><span>${total.toLocaleString()}</span></div>
<hr>
<div class="r"><span>付款方式</span><span class="bold">${PAY_LABEL[payMethod] ?? payMethod}</span></div>
${invLine}
${orderNote ? `<div>備註:${orderNote}</div>` : ''}
<hr>
<div class="center" style="margin-top:6px;font-weight:600">謝謝惠顧</div>
</body></html>`)
      win.document.close()
      win.focus()
      setTimeout(() => win.print(), 400)
    } catch (_) {}
  }

  async function confirm() {
    // 非現金走銀行收單：需先於刷卡機／掃碼完成交易並確認
    if (TERMINAL_METHODS[payMethod] && !termDone) {
      toast.error(payMethod === 'card'
        ? '請先於銀行刷卡機完成交易，並按「已完成刷卡」'
        : `請先掃描顧客的${TERMINAL_METHODS[payMethod]}付款碼，或於掃碼機完成後按「已完成收款」`)
      return
    }
    // 現金：有輸入實收金額時不可低於應收
    if (payMethod === 'cash' && cashTendered !== '' && Number(cashTendered) < total) {
      toast.error('實收金額不足')
      return
    }
    setBusy(true)
    try {
      const { data: payRow, error: pErr } = await supabase.from('pos_payments').insert({
        organization_id: orgId,
        store_id: storeId,
        order_id: orderId,
        amount: total,
        payment_method: payMethod,
        // 付款前已掃載具 → 直接掛在付款上（issue-invoice 以 pos_payments 為主、pos_orders 為輔）
        ...(invType === 'mobile' && carrierId && { carrier_type: '3J0002', carrier_number: carrierId }),
      }).select('id').single()
      if (pErr) throw pErr
      setPaymentId(payRow.id)

      const totalDiscount = discAmount + couponDiscount + pointsDiscount
      const noteParts = [
        noteVal.trim(),
        couponDiscount > 0 ? `[優惠券 ${coupon.code} -NT$${couponDiscount}]` : '',
        pointsDiscount > 0 ? `[點數折抵 ${pointsNum}點 -NT$${pointsDiscount}]` : '',
        payMethod === 'card' && termAuthCode.trim() ? `[刷卡授權碼 ${termAuthCode.trim()}]` : '',
        walletCode ? `[${TERMINAL_METHODS[payMethod] ?? ''}付款碼 ${walletCode}]` : '',
        payMethod === 'cash' && cashTendered !== '' ? `[現金實收 NT$${Number(cashTendered)} 找零 NT$${Math.max(0, Number(cashTendered) - total)}]` : '',
      ]
      const orderUpdate = {
        status:   'paid',
        paid_at:  new Date().toISOString(),
        tax_amount: taxAmount,
        service_charge: serviceCharge,
        note:     noteParts.filter(Boolean).join(' ') || null,
        member_id: member?.id ?? null,
        ...(totalDiscount > 0 && {
          discount_type:   discAmount > 0 ? discType : 'fixed',
          discount_value:  discAmount > 0 ? (parseFloat(discVal) || 0) : couponDiscount + pointsDiscount,
          discount_amount: totalDiscount,
        }),
        ...(invType !== 'none' && {
          carrier_type:  invType,
          carrier_id:    invType === 'mobile'  ? carrierId    : null,
          buyer_tax_id:  invType === 'company' ? buyerTaxId   : null,
          buyer_company: invType === 'company' ? buyerCompany : null,
        }),
      }
      const { error: uErr } = await supabase.from('pos_orders').update(orderUpdate).eq('id', orderId)
      if (uErr) throw uErr

      // 會員持券核銷（同 POSTerminal redeemCoupon 模式：蓋 used_at，失敗不擋結帳）
      if (coupon?.assignmentId) {
        supabase.from('coupon_assignments')
          .update({ used_at: new Date().toISOString() })
          .eq('id', coupon.assignmentId)
          .then(({ error }) => { if (error) console.error('[checkout] coupon redeem failed', error) })
      }

      // 發佈交易完成事件 → CRM 累點＋點數折抵、WMS 零售品扣庫存
      // 點數增減統一由 crmHandlers 處理（earn + redeem），這裡不直接改 DB 以免重複扣點
      try {
        const bus = getEventBus()
        await bus.publish('pos.transaction.completed', {
          transaction_id: String(orderId),
          transaction_number: orderInfo.order_number || String(orderId).slice(-8).toUpperCase(),
          store: storeName || '門市',
          cashier: cashier || '服務員',
          total,
          payment_method: payMethod,
          // 只帶零售商品（有 pos_product_id）：菜單餐點不參與 WMS 名稱比對扣庫存
          items: dbItems.filter(i => i.pos_product_id).map(i => ({ name: i.name, qty: i.quantity })),
          ...(member && { customer_id: member.id, points_used: pointsNum }),
        })
      } catch (e) {
        console.warn('[waiter] event publish failed:', e.message)
      }

      // 現金收款 → 自動開錢箱（RJ45 接收據機踢出埠）＋稽核紀錄
      if (payMethod === 'cash') {
        openDrawer?.('sale', cashTendered !== '' ? `實收 NT$${Number(cashTendered)}` : null)
      }

      toast.success(`T${tableNumber} 結帳完成 NT$${total.toLocaleString()}`)
      // 進入結帳後流程：詢問列印收據或存入載具
      if (invType === 'mobile' && carrierId) setCarrierSaved(carrierId)
      setStage('paid')
      // 發票資料已齊（載具已掃 / 統編已填）→ 立即開立；未定者待顧客選擇後開立
      if (invType !== 'none') ensureInvoice(payRow.id)
    } catch (e) {
      toast.error('結帳失敗：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div style={S.overlay}>
      <div onClick={stage === 'paid' ? async () => { await ensureInvoice(); onDone() } : onClose} style={{ position: 'absolute', inset: 0 }} />
      <div style={S.coBox}>
        {stage === 'paid' ? (
          <>
            <div style={S.coHead}>
              <span style={S.coTitle}>結帳完成 — 桌號 T{tableNumber}</span>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ textAlign: 'center', padding: '6px 0' }}>
                <div style={{ fontSize: 14, color: 'var(--accent-green)', fontWeight: 700 }}>✓ 已收款（{PAY_LABEL[payMethod] ?? payMethod}）</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>NT${total.toLocaleString()}</div>
                {payMethod === 'cash' && cashTendered !== '' && (
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 6 }}>
                    實收 NT${Number(cashTendered).toLocaleString()} ·{' '}
                    <span style={{ color: 'var(--accent-green)', fontWeight: 800 }}>
                      找零 NT${Math.max(0, Number(cashTendered) - total).toLocaleString()}
                    </span>
                  </div>
                )}
                {invoiceNo ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>
                    發票號碼 {invoiceNo.length === 10 ? `${invoiceNo.slice(0, 2)}-${invoiceNo.slice(2)}` : invoiceNo}
                  </div>
                ) : invoiceBusy ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>發票開立中…</div>
                ) : null}
              </div>

              {carrierSaved ? (
                <>
                  <div style={{ textAlign: 'center', padding: '8px 10px', borderRadius: 8, background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)', color: 'var(--accent-green)', fontSize: 13, fontWeight: 600 }}>
                    電子發票已存入載具 {carrierSaved}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>是否需要列印明細？</div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                      onClick={async () => { const inv = await ensureInvoice(); printReceipt(inv?.number ?? invoiceNo); onDone() }}>
                      列印明細
                    </button>
                    <button
                      style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', background: 'var(--accent-green)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                      onClick={async () => { await ensureInvoice(); onDone() }}>
                      不用，完成
                    </button>
                  </div>
                </>
              ) : awaitCarrier ? (
                <>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
                    請掃描手機載具條碼（/ 開頭共 8 碼），或手動輸入
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      placeholder="/ABC1234"
                      value={carrierInput}
                      maxLength={8}
                      onChange={e => setCarrierInput(e.target.value.toUpperCase())}
                      onKeyDown={e => e.key === 'Enter' && CARRIER_RE.test(carrierInput) && saveCarrier(carrierInput)}
                      style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 15, letterSpacing: 2, outline: 'none' }}
                    />
                    <button
                      disabled={!CARRIER_RE.test(carrierInput)}
                      onClick={() => saveCarrier(carrierInput)}
                      style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: CARRIER_RE.test(carrierInput) ? 'var(--accent-cyan)' : 'var(--bg-card)', color: CARRIER_RE.test(carrierInput) ? '#fff' : 'var(--text-muted)', fontSize: 13, fontWeight: 700, cursor: CARRIER_RE.test(carrierInput) ? 'pointer' : 'not-allowed' }}>
                      存入
                    </button>
                  </div>
                  <button onClick={() => setAwaitCarrier(false)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 4 }}>
                    ← 返回
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>發票 / 收據如何處理？</div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      disabled={invoiceBusy}
                      style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, cursor: invoiceBusy ? 'wait' : 'pointer' }}
                      onClick={async () => {
                        const inv = await ensureInvoice()
                        // 有隨機碼 → 列印正式證明聯（含明細）；否則退回明細單（發票待補開）
                        if (inv?.randomCode) await printProofSlip(inv)
                        else printReceipt(inv?.number ?? null)
                        onDone()
                      }}>
                      🖨 列印發票收據
                    </button>
                    <button
                      style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: '1px solid var(--accent-cyan)', background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                      onClick={() => setAwaitCarrier(true)}>
                      📱 存入載具
                    </button>
                  </div>
                  <button onClick={async () => { await ensureInvoice(); onDone() }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 4 }}>
                    皆不需要，完成
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
        <div style={S.coHead}>
          <span style={S.coTitle}>結帳 — 桌號 T{tableNumber}</span>
          <button style={S.coClose} onClick={onClose}>×</button>
        </div>

        <div style={S.coBody}>
          <div style={S.coSection}>
            品項明細
            <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>掃商品條碼可加購</span>
          </div>
          {loading && <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>載入中…</div>}
          {!loading && dbItems.length === 0 && (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>無品項</div>
          )}
          {dbItems.map((item) => (
            <div key={item.id} style={S.coRow}>
              <span style={{ flex: 1, color: 'var(--text-primary)' }}>
                {item.name} <span style={{ color: 'var(--text-muted)' }}>×{item.quantity}</span>
              </span>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600, flexShrink: 0 }}>
                NT${(Number(item.unit_price) * item.quantity).toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        {/* Discount row */}
        <div style={{ padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>折扣</span>
          <div style={{ display: 'flex', gap: 2 }}>
            {[['percent', '%'], ['fixed', 'NT$']].map(([v, l]) => (
              <button key={v} onClick={() => { setDiscType(v); setDiscVal('') }}
                style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid', fontSize: 11, cursor: 'pointer',
                  borderColor: discType === v ? 'var(--accent-orange)' : 'var(--border-default)',
                  background: discType === v ? 'var(--accent-orange-dim)' : 'var(--bg-secondary)',
                  color: discType === v ? 'var(--accent-orange)' : 'var(--text-muted)' }}>{l}</button>
            ))}
          </div>
          <input
            type="number" min="0" max={discType === 'percent' ? 100 : undefined}
            placeholder={discType === 'percent' ? '0' : '0'}
            value={discVal}
            onChange={e => setDiscVal(e.target.value)}
            style={{ width: 72, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
          />
          {discAmount > 0 && (
            <span style={{ fontSize: 12, color: 'var(--accent-orange)', marginLeft: 4 }}>- NT${discAmount.toLocaleString()}</span>
          )}
        </div>

        {/* Service charge row */}
        <div style={{ padding: '0 20px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>服務費</span>
          <button onClick={() => setSvcOn(v => !v)}
            style={{ padding: '2px 10px', borderRadius: 6, border: '1px solid', fontSize: 11, cursor: 'pointer',
              borderColor: svcOn ? 'var(--accent-cyan)' : 'var(--border-default)',
              background: svcOn ? 'var(--accent-cyan-dim)' : 'var(--bg-secondary)',
              color: svcOn ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
            {svcOn ? `${svcPct}%` : '免收'}
          </button>
          {serviceCharge > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>+ NT${serviceCharge.toLocaleString()}</span>
          )}
        </div>

        {/* Coupon code row */}
        <div style={{ padding: '0 20px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>優惠碼</span>
          {coupon ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 8, background: 'var(--accent-purple-dim)', border: '1px solid var(--accent-purple)' }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--accent-purple)' }}>{coupon.code} · {coupon.name}</span>
              <span style={{ fontSize: 12, color: 'var(--accent-purple)', flexShrink: 0 }}>- NT${couponDiscount.toLocaleString()}</span>
              <button onClick={() => setCoupon(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 15, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
            </div>
          ) : (
            <>
              <input
                placeholder="輸入 / 掃描優惠券代碼"
                value={couponCode}
                onChange={e => setCouponCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && applyCoupon()}
                style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
              />
              <button onClick={() => applyCoupon()} disabled={couponBusy}
                style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: 'var(--accent-purple)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: couponBusy ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                {couponBusy ? '…' : '套用'}
              </button>
            </>
          )}
        </div>

        <div style={S.coTotal}>
          {(discAmount > 0 || couponDiscount > 0 || pointsDiscount > 0 || serviceCharge > 0) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
              <span>小計</span><span>NT${subtotal.toLocaleString()}</span>
            </div>
          )}
          {serviceCharge > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
              <span>服務費（{svcPct}%）</span><span>+ NT${serviceCharge.toLocaleString()}</span>
            </div>
          )}
          {couponDiscount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13, color: 'var(--accent-purple)', marginBottom: 4 }}>
              <span>優惠券 {coupon.code}</span><span>- NT${couponDiscount.toLocaleString()}</span>
            </div>
          )}
          {pointsDiscount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13, color: 'var(--accent-green)', marginBottom: 4 }}>
              <span>點數折抵（{pointsNum} 點）</span><span>- NT${pointsDiscount.toLocaleString()}</span>
            </div>
          )}
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-muted)' }}>應收合計</span>
          <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>NT${total.toLocaleString()}</span>
        </div>

        {/* 備註 */}
        <div style={{ padding: '10px 20px 4px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>備註</div>
        <div style={{ padding: '0 20px 10px' }}>
          <input
            placeholder="輸入備註（選填）"
            value={noteVal}
            onChange={e => setNoteVal(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* 會員綁定 */}
        <div style={{ padding: '10px 20px 4px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>會員</div>
        <div style={{ padding: '0 20px 10px' }}>
          {member ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--accent-cyan-dim)', border: '1px solid var(--accent-cyan)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)' }}>{member.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{member.phone} · {member.level} · 可用 {pointsAvailable.toLocaleString()} 點</div>
                </div>
                <button onClick={() => { setMember(null); setMemberPhone(''); setPointsUsed(''); if (coupon?.assignmentId) setCoupon(null) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
              </div>

              {/* 會員錢包優惠券（app 內優惠券，點選套用） */}
              {memberCoupons.length > 0 && !coupon && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {memberCoupons.map(a => (
                    <button key={a.id} onClick={() => applyMemberCoupon(a)}
                      style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid var(--accent-purple)', background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      🎟 {a.coupons.name}
                    </button>
                  ))}
                </div>
              )}

              {/* 點數折抵 */}
              {pointsAvailable > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>點數折抵</span>
                  <input
                    type="number" min="0" max={pointsAvailable} value={pointsUsed}
                    onChange={e => setPointsUsed(e.target.value)}
                    placeholder="0"
                    style={{ width: 80, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
                  />
                  <button
                    onClick={() => setPointsUsed(String(Math.min(pointsAvailable, Math.ceil(Math.max(0, subtotal + serviceCharge - discAmount - couponDiscount) / POINT_RATE))))}
                    style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    全折
                  </button>
                  {pointsDiscount > 0 && (
                    <span style={{ fontSize: 12, color: 'var(--accent-green)', fontWeight: 600 }}>- NT${pointsDiscount.toLocaleString()}</span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>1點=NT${POINT_RATE}</span>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                placeholder="手機 / 會員編號（可掃會員 QR）"
                value={memberPhone}
                onChange={e => setMemberPhone(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchMember()}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
              />
              <button onClick={searchMember} disabled={memberBusy}
                style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: memberBusy ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                {memberBusy ? '…' : '搜尋'}
              </button>
            </div>
          )}
        </div>

        {/* Invoice section */}
        <div style={{ padding: '10px 20px 4px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>發票</div>
        <div style={{ padding: '4px 20px 6px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['none','不開立'],['mobile','手機載具'],['company','公司統編']].map(([v, l]) => (
            <button key={v} onClick={() => setInvType(v)}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid', fontSize: 12, fontWeight: invType === v ? 700 : 500, cursor: 'pointer',
                borderColor: invType === v ? 'var(--accent-purple)' : 'var(--border-primary)',
                background:  invType === v ? 'var(--accent-purple-dim)' : 'var(--bg-card)',
                color:       invType === v ? 'var(--accent-purple)' : 'var(--text-muted)',
              }}>{l}</button>
          ))}
        </div>
        {invType === 'mobile' && (
          <div style={{ padding: '0 20px 10px' }}>
            <input
              placeholder="手機條碼 /ABC-1234"
              value={carrierId}
              onChange={e => setCarrierId(e.target.value.toUpperCase())}
              maxLength={8}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
        )}
        {invType === 'company' && (
          <div style={{ padding: '0 20px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              placeholder="統一編號（8 碼）"
              value={buyerTaxId}
              onChange={e => setBuyerTaxId(e.target.value.replace(/\D/g, '').slice(0, 8))}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            />
            <input
              placeholder="公司抬頭"
              value={buyerCompany}
              onChange={e => setBuyerCompany(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
        )}

        <div style={{ padding: '10px 20px 4px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>付款方式</div>
        <div style={S.coPayMethods}>
          {PAY_METHODS.map(m => (
            <button key={m.key} style={S.coPayBtn(payMethod === m.key)} onClick={() => { setPayMethod(m.key); setTermDone(false); setWalletCode('') }}>{m.label}</button>
          ))}
        </div>

        {/* 信用卡 → 銀行實體刷卡機（EDC），交易完成後由店員確認 */}
        {payMethod === 'card' && (
          <div style={{ margin: '0 20px 10px', padding: '10px 12px', borderRadius: 8, background: 'var(--accent-orange-dim)', border: '1px solid var(--accent-orange)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--accent-orange)', fontWeight: 600 }}>
              請於銀行刷卡機刷卡 NT${total.toLocaleString()}，交易核准後按「已完成刷卡」
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                placeholder="授權碼（選填）"
                value={termAuthCode}
                onChange={e => setTermAuthCode(e.target.value)}
                style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
              />
              <button onClick={() => setTermDone(v => !v)}
                style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                  border: termDone ? 'none' : '1px solid var(--border-primary)',
                  background: termDone ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                  color: termDone ? '#fff' : 'var(--text-secondary)' }}>
                {termDone ? '✓ 已完成刷卡' : '已完成刷卡'}
              </button>
            </div>
          </div>
        )}

        {/* LINE Pay / 街口：掃顧客出示的付款碼（銀行掃碼收單） */}
        {(payMethod === 'line_pay' || payMethod === 'jkopay') && (
          <div style={{ margin: '0 20px 10px', padding: '10px 12px', borderRadius: 8, background: 'var(--accent-orange-dim)', border: '1px solid var(--accent-orange)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--accent-orange)', fontWeight: 600 }}>
              請顧客出示 {TERMINAL_METHODS[payMethod]} 付款碼，以掃描槍掃描收款 NT${total.toLocaleString()}
            </div>
            {walletCode ? (
              <div style={{ fontSize: 12, color: 'var(--accent-green)', fontWeight: 700 }}>
                ✓ 已讀取付款碼 …{walletCode.slice(-6)}
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => setTermDone(v => !v)}
                  style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                    border: termDone ? 'none' : '1px solid var(--border-primary)',
                    background: termDone ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                    color: termDone ? '#fff' : 'var(--text-secondary)' }}>
                  {termDone ? '✓ 已完成收款' : '已完成收款（掃碼機）'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 現金：實收金額 / 找零，確認後自動開錢箱 */}
        {payMethod === 'cash' && (() => {
          const tendered = cashTendered === '' ? null : Number(cashTendered)
          const change = tendered != null ? tendered - total : 0
          return (
            <div style={{ margin: '0 20px 10px', padding: '10px 12px', borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>實收金額</span>
                <input
                  type="number" min="0"
                  value={cashTendered}
                  onChange={e => setCashTendered(e.target.value)}
                  placeholder={String(total)}
                  style={{ flex: 1, minWidth: 70, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, outline: 'none' }}
                />
                {[['剛好', total], ['$500', 500], ['$1000', 1000]].map(([label, v]) => (
                  <button key={label} onClick={() => setCashTendered(String(v))}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {label}
                  </button>
                ))}
              </div>
              {tendered != null && (change >= 0 ? (
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent-green)', textAlign: 'right' }}>
                  找零 NT${change.toLocaleString()}
                </div>
              ) : (
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-red)', textAlign: 'right' }}>
                  不足 NT${Math.abs(change).toLocaleString()}
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>確認收款後將自動開啟錢箱</div>
            </div>
          )
        })()}

        <div style={S.coFoot}>
          <button style={{ ...S.smallBtn(false), flex: 1 }} onClick={onClose} disabled={busy}>取消</button>
          <button
            style={{
              flex: 2, padding: '12px 0', borderRadius: 10, border: 'none',
              cursor: busy || loading ? 'not-allowed' : 'pointer',
              background: busy || loading ? 'var(--bg-card)' : 'var(--accent-green)',
              color: busy || loading ? 'var(--text-muted)' : '#fff',
              fontSize: 15, fontWeight: 800,
            }}
            onClick={confirm}
            disabled={busy || loading || dbItems.length === 0
              || (!!TERMINAL_METHODS[payMethod] && !termDone)
              || (payMethod === 'cash' && cashTendered !== '' && Number(cashTendered) < total)}
          >
            {busy ? '結帳中…'
              : TERMINAL_METHODS[payMethod] && !termDone ? (payMethod === 'card' ? '待刷卡機確認' : '待掃碼確認')
              : payMethod === 'cash' && cashTendered !== '' && Number(cashTendered) < total ? '實收不足'
              : '確認收款'}
          </button>
        </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

// ── Right-side order panel ─────────────────────────────────────────────────────
function OrderPanel({ existingItems, cart, items, orgId, orderId, tableNumber, onSubmit, onCheckout, onVoidItem, submitBusy }) {
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
      <div style={S.panelScroll}>
        {existingItems.length === 0 && cartEntries.length === 0 && (
          <div style={S.panelEmpty}>尚未點餐</div>
        )}

        {existingItems.length > 0 && (
          <>
            <div style={S.panelHead}>已點 · NT${existTotal.toLocaleString()}</div>
            {existingItems.map((item, i) => (
              <div key={item.id ?? i} style={{ ...S.panelRow, alignItems: 'center' }}>
                <span style={{ ...S.panelRowName, flex: 1 }}>{item.name}</span>
                <span style={S.panelRowAmt}>×{item.quantity}　NT${(Number(item.unit_price) * item.quantity).toLocaleString()}</span>
                {onVoidItem && (
                  <button onClick={() => onVoidItem(item.id)} title="作廢"
                    style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', fontSize: 15, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
                )}
              </div>
            ))}
          </>
        )}

        {cartEntries.length > 0 && (
          <>
            <div style={{ ...S.panelHead, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>
              未送廚房 · NT${newTotal.toLocaleString()}
            </div>
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
      </div>

      <div style={S.panelFoot}>
        <div style={S.panelTotal}>
          <span style={S.panelTotalLabel}>合計</span>
          <span style={S.panelTotalAmt}>NT${grandTotal.toLocaleString()}</span>
        </div>
        {newCount > 0 && (
          <button
            style={submitBusy ? S.panelBtnDisabled : S.panelBtn('cyan')}
            onClick={onSubmit} disabled={submitBusy}
          >
            {submitBusy ? '送出中…' : `送廚房（${newCount} 品）`}
          </button>
        )}
        {(orderId || existingItems.length > 0 || newCount > 0) && (
          <button style={S.panelBtn('green')} onClick={onCheckout}>
            結帳
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function WaiterMode() {
  const navigate           = useNavigate()
  const { user, profile }  = useAuth()
  const orgId              = useOrgId()
  const storeId            = profile?.store_id ?? null

  const [phase,         setPhase]         = useState('loading')
  const [errMsg,        setErrMsg]        = useState('')
  const [stores,        setStores]        = useState([])
  const [storeIdSel,    setStoreIdSel]    = useState(null)
  const [tables,        setTables]        = useState([])
  const [activeOrders,  setActiveOrders]  = useState([])
  const [selTable,      setSelTable]      = useState(null)
  const [orderId,       setOrderId]       = useState(null)
  const [existingItems, setExistingItems] = useState([])
  const [orderType,     setOrderType]     = useState('dine_in')
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
  const [qrExpiry,      setQrExpiry]      = useState(null)
  const [wide,          setWide]          = useState(typeof window !== 'undefined' && window.innerWidth >= 900)
  const [variantMap,    setVariantMap]    = useState({}) // itemId → variantGroups[]
  const [variantTarget, setVariantTarget] = useState(null) // item being configured
  const qrCanvasRef = useRef(null)

  // 收據機 / 錢箱（錢箱以 RJ45 接收據機踢出埠，經 Web Serial 送 ESC/POS 脈衝開啟）
  const [thermalPort,     setThermalPort]     = useState(null)
  const [showDrawerModal, setShowDrawerModal] = useState(false)
  const [drawerReason,    setDrawerReason]    = useState('現金校正')
  const [drawerNote,      setDrawerNote]      = useState('')

  // Deep link from a scanned table QR: /pos/waiter?store=X&table=Y&checkout=1
  const [deepLink] = useState(() => {
    const sp = new URLSearchParams(window.location.search)
    return sp.get('table')
      ? { store: sp.get('store'), table: sp.get('table'), checkout: sp.get('checkout') === '1' }
      : null
  })
  const deepLinkDone = useRef(false)

  const effectiveStoreId = storeIdSel ?? storeId
  const storeName = stores.find(s => s.id === effectiveStoreId)?.name ?? profile?.store ?? ''

  useEffect(() => {
    const fn = () => setWide(window.innerWidth >= 900)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  // ── Boot: load stores list ────────────────────────────────────────────────
  useEffect(() => {
    if (!user)  { setErrMsg('auth');     setPhase('error'); return }
    if (!orgId) { setErrMsg('no_store'); setPhase('error'); return }
    supabase.from('stores').select('id, name').eq('organization_id', orgId).order('name')
      .then(({ data }) => {
        const list = data ?? []
        setStores(list)
        const deepLinkStoreId = deepLink?.store
          ? list.find(s => String(s.id) === String(deepLink.store))?.id ?? null
          : null
        const defaultId = deepLinkStoreId
          ?? ((storeId && list.some(s => s.id === storeId)) ? storeId : list[0]?.id ?? null)
        setStoreIdSel(defaultId)
      })
  }, [user, orgId, storeId])

  // ── Load tables when store changes ────────────────────────────────────────
  useEffect(() => {
    if (!effectiveStoreId) return
    setPhase('loading')
    async function loadTables() {
      const [{ data: tbl, error: tErr }, { data: ords, error: oErr }] = await Promise.all([
        supabase.from('res_tables').select('id, table_number, capacity').eq('store_id', effectiveStoreId).eq('is_active', true).order('table_number'),
        supabase.from('pos_orders').select('id, table_id, status').in('status', ['open', 'submitted']).eq('store_id', effectiveStoreId),
      ])
      if (tErr || oErr) throw tErr ?? oErr
      setTables(tbl ?? [])
      setActiveOrders(ords ?? [])
      setSelTable(null); setOrderId(null); setExistingItems([]); setCart({})

      // Scanned table QR deep link — jump straight to that table (and checkout)
      if (deepLink && !deepLinkDone.current) {
        deepLinkDone.current = true
        navigate(window.location.pathname, { replace: true }) // consume params so refresh won't re-trigger
        const target = (tbl ?? []).find(t => String(t.id) === String(deepLink.table))
        if (target) {
          const activeOrder = (ords ?? []).find(o => o.table_id === target.id)
          setSelTable(target); setOrderType('dine_in')
          if (activeOrder) {
            setOrderId(activeOrder.id)
            const { data: existing } = await supabase
              .from('pos_order_items').select('id, name, unit_price, quantity, note')
              .eq('order_id', activeOrder.id).order('created_at')
            setExistingItems(existing ?? [])
            if (deepLink.checkout) setShowCheckout(true)
          } else if (deepLink.checkout) {
            toast.info(`T${target.table_number} 尚無訂單，請先點餐`)
          }
          setPhase('order')
          return
        }
        toast.error('找不到桌台，請確認桌卡是否屬於此門市')
      }

      setPhase('select_table')
    }
    loadTables().catch(e => { setErrMsg(e?.message ?? '載入失敗'); setPhase('error') })
  }, [effectiveStoreId])

  // ── Load menu when entering order phase ───────────────────────────────────
  useEffect(() => {
    if (phase !== 'order' || !effectiveStoreId) return
    async function loadMenu() {
      const [{ data: cats }, { data: menuItems }, { data: variantRows }] = await Promise.all([
        supabase.from('pos_menu_categories').select('id, name').eq('store_id', effectiveStoreId).eq('is_active', true).order('display_order'),
        supabase.from('pos_menu_items').select('id, name, unit_price, description, image_url, category_id').eq('store_id', effectiveStoreId).eq('is_available', true).order('display_order'),
        supabase.from('pos_menu_item_variants').select('id, menu_item_id, group_name, options, is_required, sort_order').order('sort_order'),
      ])
      setCategories(cats ?? [])
      setItems(menuItems ?? [])
      if (cats?.length) setSelCat(cats[0].id)
      // Build variantMap: itemId → sorted variantGroups[]
      const vmap = {}
      ;(variantRows ?? []).forEach(r => {
        if (!vmap[r.menu_item_id]) vmap[r.menu_item_id] = []
        vmap[r.menu_item_id].push({ id: r.id, group_name: r.group_name, options: r.options, is_required: r.is_required })
      })
      setVariantMap(vmap)
    }
    loadMenu().catch(e => setErrMsg(e?.message ?? '菜單載入失敗'))
  }, [phase, effectiveStoreId])

  // ── Poll active orders every 30s while on table-select screen ────────────
  useEffect(() => {
    if (phase !== 'select_table' || !effectiveStoreId) return
    const id = setInterval(async () => {
      const { data: ords } = await supabase
        .from('pos_orders').select('id, table_id, status')
        .in('status', ['open', 'submitted']).eq('store_id', effectiveStoreId)
      if (ords) setActiveOrders(ords)
    }, 30000)
    return () => clearInterval(id)
  }, [phase, effectiveStoreId])

  // ── Scan a table QR card while on the table-select screen ────────────────
  // USB/藍牙掃描槍讀桌卡 → 直接進該桌；已有訂單則直接開結帳
  useEffect(() => {
    if (phase !== 'select_table') return
    return createBarcodeListener((code) => {
      const parsed = parseTableQR(code)
      if (!parsed) return
      const table = tables.find(t => String(t.id) === String(parsed.tableId))
      if (!table) {
        playBeep(false)
        toast.error('找不到此桌台，請確認桌卡是否屬於此門市')
        return
      }
      playBeep(true)
      const hasOrder = activeOrders.some(o => o.table_id === table.id)
      selectTable(table).then(() => { if (hasOrder) setShowCheckout(true) })
    })
  }, [phase, tables, activeOrders])

  // ── QR canvas ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showQr || !qrUrl || !qrCanvasRef.current) return
    QRCode.toCanvas(qrCanvasRef.current, qrUrl, { width: 220, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
  }, [showQr, qrUrl])

  // ── Derived ───────────────────────────────────────────────────────────────
  const cartEntries  = Object.entries(cart).filter(([, v]) => v.qty > 0)
  const cartCount    = cartEntries.reduce((s, [, v]) => s + v.qty, 0)
  const cartTotal    = cartEntries.reduce((s, [id, v]) => {
    const item = items.find(i => i.id === id)
    return s + (item ? Number(item.unit_price) * v.qty : 0)
  }, 0)
  const visibleItems = selCat ? items.filter(i => i.category_id === selCat) : items
  const tableStatus  = (tableId) => activeOrders.find(o => o.table_id === tableId) ? 'busy' : 'empty'

  // ── Cart mutations ────────────────────────────────────────────────────────
  const addItem = useCallback((item) => {
    const groups = variantMap[item.id]
    if (groups?.length) {
      setVariantTarget(item)
      return
    }
    setCart(prev => prev[item.id]
      ? { ...prev, [item.id]: { ...prev[item.id], qty: prev[item.id].qty + 1 } }
      : { ...prev, [item.id]: { qty: 1, note: '' } }
    )
  }, [variantMap])

  const addVariantItem = useCallback(({ id: cartKey, name, price, qty, _baseItemId }) => {
    setCart(prev => prev[cartKey]
      ? { ...prev, [cartKey]: { ...prev[cartKey], qty: prev[cartKey].qty + qty } }
      : { ...prev, [cartKey]: { qty, note: '', name, unit_price: price, menu_item_id: _baseItemId } }
    )
    setVariantTarget(null)
  }, [])

  const adjustQty = useCallback((itemId, delta) => {
    setCart(prev => {
      const cur  = prev[itemId]
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

  // ── 收據機 / 錢箱 ──────────────────────────────────────────────────────────
  async function connectDrawer() {
    if (thermalPort) {
      try { await thermalPort.close() } catch {}
      setThermalPort(null)
      toast.info('已中斷收據機／錢箱連線')
      return
    }
    const result = await connectThermalPrinter()
    if (result.connected) { setThermalPort(result.port); toast.success('已連接收據機／錢箱') }
    else toast.error(result.error || '連接失敗')
  }

  // 開錢箱＋寫入稽核紀錄（reason: sale / correction / refund / other）
  async function openDrawerLogged(reason, note = null, orderIdArg = null) {
    if (!thermalPort) {
      toast.error('尚未連接收據機／錢箱，請先按「連接錢箱」')
      return false
    }
    try {
      await kickCashDrawer(thermalPort)
    } catch (e) {
      toast.error('開錢箱失敗：' + e.message)
      return false
    }
    supabase.from('pos_drawer_events').insert({
      organization_id: orgId,
      store_id:        effectiveStoreId,
      order_id:        orderIdArg,
      reason,
      note,
      opened_by:       profile?.id ?? null,
    }).then(({ error }) => { if (error) console.error('[drawer] audit log failed', error) })
    return true
  }

  // ── Select table ──────────────────────────────────────────────────────────
  async function selectTable(table) {
    const activeOrder = activeOrders.find(o => o.table_id === table.id)
    setSelTable(table); setCart({}); setErrMsg(''); setOrderType('dine_in')
    if (activeOrder) {
      setOrderId(activeOrder.id)
      const { data: existing } = await supabase
        .from('pos_order_items').select('id, name, unit_price, quantity, note')
        .eq('order_id', activeOrder.id).order('created_at')
      setExistingItems(existing ?? [])
    } else {
      setOrderId(null)
      setExistingItems([])
    }
    setPhase('order')
  }

  // ── Generate QR ───────────────────────────────────────────────────────────
  async function generateQR() {
    if (!selTable || !effectiveStoreId) return
    setGenQr(true)
    try {
      const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000)
      const { data: session, error } = await supabase.from('qr_order_sessions').insert({
        organization_id: orgId,
        store_id: effectiveStoreId,
        table_id: selTable.id,
        token: crypto.randomUUID(),
        expires_at: expiresAt.toISOString(),
      }).select('token').single()
      if (error) throw error
      setQrUrl(`${window.location.origin}/menu/${effectiveStoreId}/${selTable.id}?token=${session.token}`)
      setQrExpiry(expiresAt)
      setShowQr(true)
    } catch (e) {
      toast.error('QR 產生失敗：' + (e.message || ''))
    } finally {
      setGenQr(false)
    }
  }

  // ── QR modal actions ─────────────────────────────────────────────────────
  async function printQrCard() {
    if (!qrUrl || !selTable) return
    try {
      const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 220, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
      const now = new Date()
      const fmt = (d) => `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
      const expiryTime = qrExpiry ? fmt(qrExpiry) : '—'
      const win = window.open('', '_blank', 'width=320,height=520')
      if (!win) { toast.error('請允許彈出視窗'); return }
      win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Noto Sans TC","微軟正黑體",sans-serif;text-align:center;padding:16px 12px}
.store{font-size:12px;color:#888;margin-bottom:6px}
hr{border:none;border-top:1px dashed #ccc;margin:10px 0}
.tnum{font-size:42px;font-weight:900;letter-spacing:2px;margin:6px 0}
.opentime{font-size:12px;color:#555;margin-bottom:10px}
img{display:block;margin:0 auto}
.hint{font-size:13px;font-weight:600;margin-top:10px}
.expiry{font-size:11px;color:#aaa;margin-top:4px}
@media print{@page{margin:4mm;size:${posPaperPage()} auto}body{padding:8px}}
</style></head><body>
<div class="store">${storeName || '威士威'}</div>
<hr>
<div class="tnum">T${selTable.table_number}</div>
<div class="opentime">開桌 ${fmt(now)}</div>
<img src="${qrDataUrl}" width="180" height="180" />
<div class="hint">掃碼點餐</div>
<div class="expiry">有效至 ${expiryTime}（4 小時）</div>
<hr>
</body></html>`)
      win.document.close()
      win.focus()
      setTimeout(() => win.print(), 400)
    } catch (e) {
      toast.error('列印失敗：' + (e.message || ''))
    }
  }

  function downloadQr() {
    if (!qrCanvasRef.current) return
    const link = document.createElement('a')
    link.download = `T${selTable?.table_number}-QR.png`
    link.href = qrCanvasRef.current.toDataURL('image/png')
    link.click()
  }

  // ── Submit cart to kitchen — returns orderId on success ───────────────────
  async function handleSubmit() {
    if (cartCount === 0 || !selTable) return null
    setSubmitBusy(true)
    setErrMsg('')
    try {
      let currentOrderId = orderId
      if (!currentOrderId) {
        const { data: newOrder, error: oErr } = await supabase
          .from('pos_orders')
          .insert({ organization_id: orgId, store_id: effectiveStoreId, table_id: selTable.id, status: 'open', opened_by: profile?.id ?? null, order_type: orderType })
          .select('id').single()
        if (oErr) throw oErr
        currentOrderId = newOrder.id
        setOrderId(currentOrderId)
        setActiveOrders(prev => [...prev, { id: currentOrderId, table_id: selTable.id, status: 'open' }])
      }
      const rows = cartEntries.map(([id, v]) => {
        // Variant entries store name/unit_price/menu_item_id directly; plain entries resolve from items[]
        const base = v.menu_item_id ? null : items.find(i => i.id === id)
        return {
          order_id:        currentOrderId,
          item_type:       'menu',
          menu_item_id:    v.menu_item_id ?? id,
          name:            v.name ?? base?.name ?? '',
          unit_price:      v.unit_price ?? base?.unit_price ?? 0,
          quantity:        v.qty,
          note:            v.note || null,
          source:          'staff',
          sent_to_kitchen: true,
        }
      })
      const { error: iErr } = await supabase.from('pos_order_items').insert(rows)
      if (iErr) throw iErr
      setExistingItems(prev => [...prev, ...rows.map(r => ({ ...r, id: r.menu_item_id + Date.now() }))])
      setCart({})
      toast.success('已送廚房')
      printKitchenSlip(selTable.table_number, rows)
      return currentOrderId
    } catch (e) {
      setErrMsg(e?.message ?? '送出失敗')
      return null
    } finally {
      setSubmitBusy(false)
    }
  }

  // ── Void a submitted item ─────────────────────────────────────────────────
  async function handleVoidItem(itemId) {
    const { error } = await supabase.rpc('pos_void_item', { p_item_id: itemId })
    if (error) { toast.error('作廢失敗：' + error.message); return }
    setExistingItems(prev => prev.filter(i => i.id !== itemId))
    toast.success('品項已作廢')
  }

  // ── Open checkout: auto-submit pending cart first ─────────────────────────
  async function openCheckout() {
    let finalOrderId = orderId
    if (cartCount > 0) {
      finalOrderId = await handleSubmit()
      if (!finalOrderId) return // submit failed, don't open checkout
    }
    if (!finalOrderId && existingItems.length === 0) {
      toast.error('請先點餐')
      return
    }
    setShowCheckout(true)
  }

  // ── Back to table list ────────────────────────────────────────────────────
  function backToTables() {
    setPhase('select_table')
    setSelTable(null); setOrderId(null); setExistingItems([]); setCart({}); setErrMsg('')
  }

  function afterCheckout() {
    setActiveOrders(prev => prev.filter(o => o.table_id !== selTable?.id))
    setShowCheckout(false)
    backToTables()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDERS
  // ─────────────────────────────────────────────────────────────────────────

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
        <div style={S.headerRight}>
          {stores.length > 1 && (
            <select
              value={effectiveStoreId ?? ''}
              onChange={e => setStoreIdSel(Number(e.target.value))}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' }}
            >
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button style={S.iconBtn(false)} onClick={connectDrawer}>{thermalPort ? '✓ 錢箱' : '連接錢箱'}</button>
          <button style={S.iconBtn(false)} onClick={() => { setDrawerReason('現金校正'); setDrawerNote(''); setShowDrawerModal(true) }}>開錢箱</button>
          <button style={S.iconBtn(false)} onClick={() => navigate('/pos')}>← 返回</button>
        </div>
      </div>

      {tables.length === 0 ? (
        <div style={S.center}>
          <div style={{ fontSize: 15, color: 'var(--text-muted)' }}>尚未設定桌位</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>請先至「訂位管理 → 桌台設定」新增桌台</div>
          <button style={S.smallBtn(false)} onClick={() => navigate('/pos')}>返回 POS</button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, padding: '14px 20px 4px', flexWrap: 'wrap' }}>
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

      {/* 開錢箱（非收款）— 現金校正等原因，留稽核紀錄 */}
      {showDrawerModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => setShowDrawerModal(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 14, padding: 20, width: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>開啟錢箱（非收款）</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>非收款開箱將留存稽核紀錄，請選擇原因</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['現金校正', '找零補鈔', '其他'].map(r => (
                <button key={r} onClick={() => setDrawerReason(r)}
                  style={{ padding: '5px 12px', borderRadius: 999, border: '1px solid', fontSize: 12, cursor: 'pointer',
                    borderColor: drawerReason === r ? 'var(--accent-cyan)' : 'var(--border-primary)',
                    background: drawerReason === r ? 'var(--accent-cyan-dim)' : 'var(--bg-tertiary)',
                    color: drawerReason === r ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}>
                  {r}
                </button>
              ))}
            </div>
            <input
              placeholder="補充說明（選填）"
              value={drawerNote}
              onChange={e => setDrawerNote(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowDrawerModal(false)}
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                取消
              </button>
              <button
                onClick={async () => {
                  const ok = await openDrawerLogged(
                    drawerReason === '其他' ? 'other' : 'correction',
                    [drawerReason, drawerNote.trim()].filter(Boolean).join('：')
                  )
                  if (ok) { toast.success('錢箱已開啟'); setShowDrawerModal(false); setDrawerNote('') }
                }}
                style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                開啟錢箱
              </button>
            </div>
          </div>
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
          <div style={{ display: 'flex', gap: 4, marginTop: 4, marginBottom: 2 }}>
            {[['dine_in', '🍽 內用'], ['takeout', '📦 外帶']].map(([v, l]) => (
              <button key={v} onClick={() => setOrderType(v)} style={{
                padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                borderColor: orderType === v ? 'var(--accent-cyan)' : 'var(--border-default)',
                background:  orderType === v ? 'var(--accent-cyan-dim)' : 'transparent',
                color:       orderType === v ? 'var(--accent-cyan)' : 'var(--text-muted)',
              }}>{l}</button>
            ))}
          </div>
          {storeName && <p style={S.sub}>{storeName}</p>}
        </div>
        <div style={S.headerRight}>
          <button style={S.iconBtn(false)} onClick={backToTables}>← 換桌</button>
          <button style={S.iconBtn(false)} onClick={generateQR} disabled={genQr} title="產生 QR 點餐連結 / 列印桌卡">
            {genQr ? '…' : 'QR / 桌卡'}
          </button>
          {!wide && cartCount > 0 && (
            <button style={S.iconBtn(false)} disabled={submitBusy} onClick={handleSubmit}>
              {submitBusy ? '送出…' : `送廚房(${cartCount})`}
            </button>
          )}
          {!wide && (
            <button style={S.iconBtn(true)} onClick={openCheckout}>結帳</button>
          )}
        </div>
      </div>

      {/* Mobile category bar */}
      {!wide && (
        <div style={S.catBar}>
          <button style={S.catBtn(!selCat)} onClick={() => setSelCat(null)}>全部</button>
          {categories.map(c => (
            <button key={c.id} style={S.catBtn(selCat === c.id)} onClick={() => setSelCat(c.id)}>{c.name}</button>
          ))}
        </div>
      )}

      {/* Error banner */}
      {errMsg && (
        <div style={S.errBanner}>
          <span style={{ flex: 1 }}>{errMsg}</span>
          <button onClick={() => setErrMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
        </div>
      )}

      {/* Body */}
      <div style={S.orderBody}>
        {/* Left category sidebar (wide only) */}
        {wide && (
          <div style={S.catSidebar}>
            <button style={S.catSideBtn(!selCat)} onClick={() => setSelCat(null)}>全部</button>
            {categories.map(c => (
              <button key={c.id} style={S.catSideBtn(selCat === c.id)} onClick={() => setSelCat(c.id)}>{c.name}</button>
            ))}
          </div>
        )}

        {/* Menu area */}
        <div style={S.menuArea}>
          <div style={{ ...S.itemGrid, paddingBottom: wide ? 32 : 140 }}>
            {visibleItems.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', paddingTop: 40, color: 'var(--text-muted)', fontSize: 14 }}>此分類暫無品項</div>
            )}
            {visibleItems.map(item => {
              const hasVariants = variantMap[item.id]?.length > 0
              const entry  = cart[item.id]
              const qty    = entry?.qty ?? 0
              const inCart = qty > 0
              return (
                <div key={item.id} style={S.itemCard(inCart)} onClick={() => addItem(item)}>
                  {qty > 0 && <span style={S.cartBadge}>×{qty}</span>}
                  {hasVariants && qty === 0 && (
                    <span style={{ position: 'absolute', top: 6, left: 8, fontSize: 10, color: 'var(--text-muted)' }}>選項</span>
                  )}
                  {item.image_url && <img src={item.image_url} alt={item.name} style={S.itemImg} />}
                  <div style={S.cardBody}>
                    <div style={S.itemName}>{item.name}</div>
                    <div style={S.itemPriceRow}>
                      <span style={S.itemPrice}>NT${Number(item.unit_price).toLocaleString()}</span>
                      {inCart && !hasVariants ? (
                        <div style={S.qtyRow} onClick={e => e.stopPropagation()}>
                          <button style={S.qtyBtn(true)}  onClick={() => adjustQty(item.id, -1)}>−</button>
                          <span style={S.qtyNum}>{qty}</span>
                          <button style={S.qtyBtn(false)} onClick={() => adjustQty(item.id, 1)}>+</button>
                        </div>
                      ) : (
                        <button style={S.addBtn} onClick={e => { e.stopPropagation(); addItem(item) }}>+</button>
                      )}
                    </div>
                    {inCart && !hasVariants && (
                      <button
                        style={{ ...S.noteBtn, color: entry?.note ? 'var(--accent-cyan)' : 'var(--text-muted)' }}
                        onClick={e => openNotePopup(e, item.id)}
                      >
                        {entry?.note ? `備註：${entry.note}` : '+ 備註'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right order panel (wide only) */}
        {wide && (
          <OrderPanel
            existingItems={existingItems}
            cart={cart}
            items={items}
            orgId={orgId}
            orderId={orderId}
            tableNumber={selTable?.table_number}
            onSubmit={handleSubmit}
            onCheckout={openCheckout}
            onVoidItem={handleVoidItem}
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
          <button style={S.footBtn(true, false)} onClick={openCheckout}>結帳</button>
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
              <button style={S.smallBtn(true)}  onClick={saveItemNote}>確認</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* QR popup */}
      {showQr && qrUrl && createPortal(
        <div style={S.overlay}>
          <div onClick={() => setShowQr(false)} style={{ position: 'absolute', inset: 0 }} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg-card)', borderRadius: 20, padding: '24px 20px 20px', maxWidth: 320, width: '90%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {/* Close */}
            <button onClick={() => setShowQr(false)} style={{ position: 'absolute', top: 12, right: 14, background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4 }}>×</button>

            {/* Title + countdown */}
            <div style={{ textAlign: 'center', marginTop: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>桌號 T{selTable?.table_number}</div>
              {qrExpiry && (() => {
                const diff = Math.max(0, qrExpiry - Date.now())
                const hrs  = Math.floor(diff / 3600000)
                const mins = Math.floor((diff % 3600000) / 60000)
                return <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{hrs > 0 ? `${hrs} 小時 ${mins} 分後到期` : `${mins} 分後到期`}</div>
              })()}
            </div>

            {/* QR */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 12 }}>
              <canvas ref={qrCanvasRef} />
            </div>

            {/* URL */}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', wordBreak: 'break-all', textAlign: 'center', maxWidth: 270, lineHeight: 1.5 }}>{qrUrl}</div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <button onClick={printQrCard}
                style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: 'var(--accent-cyan)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                🖨 列印
              </button>
              <button onClick={downloadQr}
                style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                ↓ 下載
              </button>
              <button onClick={generateQR} disabled={genQr} title="重新產生 QR"
                style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer' }}>
                {genQr ? '…' : '↻'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Variant selection modal */}
      {variantTarget && (
        <POSVariantModal
          item={variantTarget}
          variantGroups={variantMap[variantTarget.id] ?? []}
          onAdd={addVariantItem}
          onClose={() => setVariantTarget(null)}
        />
      )}

      {/* Checkout modal */}
      {showCheckout && orderId && (
        <CheckoutModal
          tableNumber={selTable?.table_number}
          orgId={orgId}
          storeId={effectiveStoreId}
          orderId={orderId}
          storeName={storeName}
          cashier={profile?.name ?? profile?.email ?? '服務員'}
          openDrawer={(reason, note) => openDrawerLogged(reason, note, orderId)}
          onClose={() => setShowCheckout(false)}
          onDone={afterCheckout}
        />
      )}
    </div>
  )
}
