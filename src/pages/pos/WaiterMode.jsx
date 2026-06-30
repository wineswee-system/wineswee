import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { useAuth, useOrgId } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'
import POSVariantModal from './components/POSVariantModal'

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
@media print{@page{margin:2mm;size:80mm auto}button{display:none}}
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

function CheckoutModal({ tableNumber, orgId, storeId, orderId, storeName, onClose, onDone }) {
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

  // Fetch items + order meta (opened_at, order_number, note) on mount
  useEffect(() => {
    Promise.all([
      supabase.from('pos_order_items')
        .select('id, name, unit_price, quantity')
        .eq('order_id', orderId)
        .is('voided_at', null)
        .order('created_at'),
      supabase.from('pos_orders')
        .select('opened_at, order_number, note')
        .eq('id', orderId)
        .maybeSingle(),
    ]).then(([itemsRes, orderRes]) => {
      setDbItems(itemsRes.data ?? [])
      setOrderInfo(orderRes.data ?? {})
      setLoading(false)
    })
  }, [orderId])

  const subtotal    = dbItems.reduce((s, i) => s + Number(i.unit_price) * i.quantity, 0)
  const taxAmount   = Math.round(subtotal * 5 / 105)   // 含稅 5%（結帳前小計含稅）
  const discAmount  = discVal
    ? discType === 'percent'
      ? Math.round(subtotal * Math.min(parseFloat(discVal) || 0, 100) / 100)
      : Math.min(parseFloat(discVal) || 0, subtotal)
    : 0
  const total = subtotal - discAmount

  function printReceipt() {
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
      const invLine = invType === 'mobile'  ? `<div style="font-size:11px;color:#666;margin-top:2px">手機載具：${carrierId || '—'}</div>`
                    : invType === 'company' ? `<div style="font-size:11px;color:#666;margin-top:2px">統編：${buyerTaxId}　${buyerCompany}</div>`
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
@media print{@page{margin:2mm;size:80mm auto}}
</style></head><body>
<div class="center bold" style="font-size:14px;margin-bottom:2px">${storeName || '威士威'}</div>
<div>內用:${orderNum}</div>
<div class="center bold" style="font-size:13px;letter-spacing:1px">內用==結帳單==</div>
<hr>
<div>列印時間${printTime} 機01</div>
<div>單:${orderNum}</div>
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
${discAmount > 0 ? `<div class="r"><span>折扣</span><span>-${discAmount.toLocaleString()}</span></div>` : ''}
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
    setBusy(true)
    try {
      const { error: pErr } = await supabase.from('pos_payments').insert({
        organization_id: orgId,
        store_id: storeId,
        order_id: orderId,
        amount: total,
        payment_method: payMethod,
      })
      if (pErr) throw pErr

      const orderUpdate = {
        status:   'paid',
        paid_at:  new Date().toISOString(),
        tax_amount: taxAmount,
        ...(discAmount > 0 && {
          discount_type:   discType,
          discount_value:  parseFloat(discVal) || 0,
          discount_amount: discAmount,
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

      toast.success(`T${tableNumber} 結帳完成 NT$${total.toLocaleString()}`)
      printReceipt()
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

        <div style={S.coTotal}>
          {discAmount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
              <span>小計</span><span>NT${subtotal.toLocaleString()}</span>
            </div>
          )}
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-muted)' }}>應收合計</span>
          <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>NT${total.toLocaleString()}</span>
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
            <button key={m.key} style={S.coPayBtn(payMethod === m.key)} onClick={() => setPayMethod(m.key)}>{m.label}</button>
          ))}
        </div>

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
            onClick={confirm} disabled={busy || loading || dbItems.length === 0}
          >
            {busy ? '結帳中…' : '確認收款'}
          </button>
        </div>
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
        const defaultId = (storeId && list.some(s => s.id === storeId)) ? storeId : list[0]?.id ?? null
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
@media print{@page{margin:4mm;size:80mm auto}body{padding:8px}}
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
          .insert({ organization_id: orgId, store_id: effectiveStoreId, table_id: selTable.id, status: 'open', opened_by: user.id, order_type: orderType })
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
          onClose={() => setShowCheckout(false)}
          onDone={afterCheckout}
        />
      )}
    </div>
  )
}
