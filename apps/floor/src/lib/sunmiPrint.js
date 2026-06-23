/**
 * Sunmi D2 printing utilities.
 *
 * Primary path: window.SUNMI?.innerPrinter (Sunmi Launcher WebView mode).
 * Fallback: POST text to http://127.0.0.1:8080 (local print proxy).
 * Dev/desktop: logs ticket to console.
 */

function sunmi() {
  return window.SUNMI?.innerPrinter ?? null
}

async function printRaw(lines) {
  const text = lines.join('\n')

  if (sunmi()) {
    sunmi().printText(text)
    sunmi().cutPaper()
    return
  }

  try {
    await fetch('http://127.0.0.1:8080/print', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: text,
    })
  } catch {
    console.info('[sunmiPrint]', text)
  }
}

export function openCashDrawer() {
  if (sunmi()) sunmi().openCashBox()
}

// ── Formatters ───────────────────────────────────────────────────────────────

const WIDTH = 32 // ~32 CJK chars on 80mm paper

function center(str) {
  const pad = Math.max(0, Math.floor((WIDTH - str.length) / 2))
  return ' '.repeat(pad) + str
}

function cols(left, right) {
  const gap = Math.max(1, WIDTH - left.length - right.length)
  return left + ' '.repeat(gap) + right
}

function divider(char = '─') {
  return char.repeat(WIDTH)
}

function timeNow() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDatetime(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}  ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ── Ticket builders ──────────────────────────────────────────────────────────

/** 廚房單 — sent when staff pushes items to kitchen */
export async function printKitchenTicket(order, table, items, label = '送廚房') {
  if (!items.length) return
  await printRaw([
    center(`── ${label} ──`),
    cols(`桌 T${table?.table_number ?? '?'}`, `#${order?.order_number ?? '?'}`),
    cols(`${order?.guest_count ?? 1} 人`, timeNow()),
    divider(),
    ...items.map(i => `${i.name}  x${i.quantity}${i.note ? `  (${i.note})` : ''}`),
    divider(),
    '',
  ])
}

/** 取消單 — printed when a kitchen-sent item is cancelled so kitchen discards it */
export async function printCancelTicket(item, order, table) {
  await printRaw([
    center('═══ 取消 ═══'),
    cols(`桌 T${table?.table_number ?? '?'}`, `#${order?.order_number ?? '?'}`),
    timeNow(),
    divider('─'),
    `【取消】 ${item.name}  x${item.quantity}`,
    divider('─'),
    '請停止製作此品項',
    '',
  ])
}

/** 商品提取單 — physical products (no kitchen step) */
export async function printProductPullTicket(order, table, items) {
  if (!items.length) return
  await printRaw([
    center('── 商品提取 ──'),
    cols(`桌 T${table?.table_number ?? '?'}`, `#${order?.order_number ?? '?'}`),
    timeNow(),
    divider(),
    ...items.map(i => `${i.name}  x${i.quantity}`),
    divider(),
    '',
  ])
}

/** 收據 — full itemized receipt after payment */
export async function printReceipt({ storeName = '', order, table, items, payment, received = 0 }) {
  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  const taxAmt   = Math.round(subtotal * 0.05 / 1.05)
  const total    = payment?.amount ?? subtotal
  const change   = received > 0 ? received - total : 0

  const methodLabel = {
    cash: '現金', card: '信用卡', line_pay: 'LINE Pay', jkopay: '街口支付', other: '其他',
  }[payment?.payment_method] ?? ''

  const lines = [
    center(storeName || '收據'),
    center('================================'),
    formatDatetime(payment?.paid_at || new Date().toISOString()),
    cols(`訂單: #${order?.order_number ?? '?'}`, `桌: T${table?.table_number ?? '?'}`),
    `人數: ${order?.guest_count ?? 1} 人`,
    divider('─'),
    ...items.map(i => cols(`${i.name} x${i.quantity}`, `$${(i.unit_price * i.quantity).toLocaleString()}`)),
    divider('─'),
    cols('小計', `$${subtotal.toLocaleString()}`),
    cols('稅額 (含稅 5%)', `$${taxAmt.toLocaleString()}`),
    cols('合計', `$${total.toLocaleString()}`),
    methodLabel ? cols(methodLabel, `$${total.toLocaleString()}`) : '',
    received > 0 ? cols('找零', `$${change.toLocaleString()}`) : '',
    divider('='),
    payment?.invoice_number ? `電子發票  ${payment.invoice_number}` : '電子發票: 待開立',
    divider('='),
    center('感謝您的光臨！'),
    '',
    '',
  ].filter(l => l !== '')

  await printRaw(lines)
}

/** 退貨單 — printed after a return is processed */
export async function printReturnReceipt({ storeName = '', originalOrderNumber, returnedItems, refundAmount, refundMethod, creditNoteNumber }) {
  const methodLabel = { cash: '現金', card: '信用卡', store_credit: '店鋪金' }[refundMethod] ?? refundMethod

  await printRaw([
    center(storeName || '退貨收據'),
    divider('─'),
    `原訂單: #${originalOrderNumber}`,
    divider('─'),
    ...returnedItems.map(i => cols(`${i.name} x${i.qty}`, `$${(i.unit_price * i.qty).toLocaleString()}`)),
    divider('─'),
    cols('退款方式', methodLabel),
    cols('退款金額', `$${refundAmount.toLocaleString()}`),
    creditNoteNumber ? `折讓發票: ${creditNoteNumber}` : '',
    divider('─'),
    center('謝謝惠顧'),
    '',
  ].filter(l => l !== ''))
}
