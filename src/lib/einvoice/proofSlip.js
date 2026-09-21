/**
 * 電子發票證明聯（B2C 紙本）產生器
 *
 * 依財政部「電子發票證明聯一維及二維條碼規格」：
 * - 一維條碼：Code 39，內容 = 期別(民國年3+偶數月2) + 字軌號碼(10) + 隨機碼(4)
 * - 左 QR：77 碼固定欄位 + 營業人自用區 + 品目欄位（部分品項）
 * - 右 QR：'**' + 其餘品項
 *
 * 注意：左 QR 的 24 碼「加密驗證資訊」需以財政部核發之 AES 金鑰加密
 * （通常由加值服務中心產生）。未設定金鑰時以 '*' 填充 — 版面與掃描
 * 定位皆正確，惟財政部 App 驗證需待正式金鑰/供應商回傳值。
 */

// ── 民國日期 / 期別 ──────────────────────────────────────────

/** 民國年月日 7 碼，例 2026-07-05 → '1150705' */
export function rocDate7(d) {
  const y = d.getFullYear() - 1911
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/** 證明聯抬頭期別，例 2026-07 → '115年07-08月'（雙月一期，起自奇數月） */
export function rocPeriodLabel(d) {
  const y = d.getFullYear() - 1911
  const m = d.getMonth() + 1
  const odd = m % 2 === 1 ? m : m - 1
  return `${y}年${String(odd).padStart(2, '0')}-${String(odd + 1).padStart(2, '0')}月`
}

/** 一維條碼期別 5 碼（民國年 3 + 期別「偶數月」2），例 2026-07 → '11508' */
export function periodBarcode5(d) {
  const y = d.getFullYear() - 1911
  const m = d.getMonth() + 1
  const even = m % 2 === 0 ? m : m + 1
  return `${String(y).padStart(3, '0')}${String(even).padStart(2, '0')}`
}

/** 一維條碼完整內容（19 碼）：期別5 + 發票號碼10 + 隨機碼4 */
export function buildBarcodeContent(d, invoiceNumber, randomCode) {
  return `${periodBarcode5(d)}${invoiceNumber}${randomCode}`
}

// ── Code 39 一維條碼（SVG）─────────────────────────────────────

// 標準 Code 39 編碼表（12 模組 / 字元，窄:寬 = 1:2）
const CODE39 = {
  '0': '101001101101', '1': '110100101011', '2': '101100101011', '3': '110110010101',
  '4': '101001101011', '5': '110100110101', '6': '101100110101', '7': '101001011011',
  '8': '110100101101', '9': '101100101101',
  A: '110101001011', B: '101101001011', C: '110110100101', D: '101011001011',
  E: '110101100101', F: '101101100101', G: '101010011011', H: '110101001101',
  I: '101101001101', J: '101011001101', K: '110101010011', L: '101101010011',
  M: '110110101001', N: '101011010011', O: '110101101001', P: '101101101001',
  Q: '101010110011', R: '110101011001', S: '101101011001', T: '101011011001',
  U: '110010101011', V: '100110101011', W: '110011010101', X: '100101101011',
  Y: '110010110101', Z: '100110110101',
  '-': '100101011011', '.': '110010101101', ' ': '100110101101', '*': '100101101101',
  $: '100100100101', '/': '100100101001', '+': '100101001001', '%': '101001001001',
}

/**
 * 產生 Code 39 條碼 SVG 字串
 * @param {string} content - 條碼內容（不含起止符 *，自動加上）
 * @param {{unit?: number, height?: number}} [opts]
 */
export function code39Svg(content, { unit = 2, height = 44 } = {}) {
  const chars = `*${String(content).toUpperCase()}*`.split('')
  const bits = chars
    .map(c => CODE39[c])
    .filter(Boolean)
    .join('0') // 字元間隔 1 窄單位
  let x = 0
  const rects = []
  for (let i = 0; i < bits.length; ) {
    if (bits[i] === '1') {
      let run = 0
      while (bits[i + run] === '1') run++
      rects.push(`<rect x="${x * unit}" y="0" width="${run * unit}" height="${height}"/>`)
      x += run; i += run
    } else {
      x++; i++
    }
  }
  const width = bits.length * unit
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"><g fill="#000">${rects.join('')}</g></svg>`
}

// ── 二維條碼（左右一對）────────────────────────────────────────

const hex8 = n => Math.round(Number(n) || 0).toString(16).toUpperCase().padStart(8, '0')

/**
 * 產生證明聯左右 QR 內容
 * @param {{
 *   invoiceNumber: string,       // 'AB12345678'（10 碼，不含 -）
 *   date: Date,                  // 發票開立日期
 *   randomCode: string,          // 4 碼隨機碼
 *   salesAmount: number,         // 銷售額（未稅）
 *   totalAmount: number,         // 總計（含稅）
 *   buyerTaxId?: string|null,    // 買方統編（B2C 為 null → '00000000'）
 *   sellerTaxId: string,         // 賣方統編 8 碼
 *   items?: Array<{name: string, quantity: number, unitPrice: number}>,
 *   encrypted?: string|null,     // 24 碼加密驗證資訊（加值中心回傳；null → '*' 填充）
 *   leftItemCount?: number,      // 放進左 QR 的品項數（其餘進右 QR）
 * }} p
 * @returns {{left: string, right: string}}
 */
export function buildQRPair(p) {
  const {
    invoiceNumber, date, randomCode, salesAmount, totalAmount,
    buyerTaxId = null, sellerTaxId, items = [], encrypted = null, leftItemCount = 2,
  } = p

  const enc = (encrypted || '').padEnd(24, '*').slice(0, 24)
  const itemSeg = i => `:${i.name}:${i.quantity}:${i.unitPrice}`
  const leftItems = items.slice(0, leftItemCount)
  const rightItems = items.slice(leftItemCount)

  const left =
    invoiceNumber +                                   // 發票字軌號碼 10
    rocDate7(date) +                                  // 開立日期 7（民國）
    randomCode +                                      // 隨機碼 4
    hex8(salesAmount) +                               // 銷售額 8（16 進位）
    hex8(totalAmount) +                               // 總計額 8（16 進位）
    ((buyerTaxId || '').trim() || '00000000') +       // 買方統編 8
    String(sellerTaxId || '').padStart(8, '0') +      // 賣方統編 8
    enc +                                             // 加密驗證資訊 24
    ':**********' +                                   // 營業人自用區 10
    `:${items.length}` +                              // 二維條碼記載品目筆數
    `:${items.length}` +                              // 該張發票品目總筆數
    ':1' +                                            // 中文編碼 1 = UTF-8
    leftItems.map(itemSeg).join('')

  const right = '**' + rightItems.map(itemSeg).join('')
  return { left, right }
}

// ── 證明聯版面（HTML，交由 window.print 輸出 80mm 收據）────────

/** 'AB12345678' → 'AB-12345678'（顯示用） */
export function formatInvNo(n) {
  return n && n.length === 10 ? `${n.slice(0, 2)}-${n.slice(2)}` : (n ?? '')
}

/**
 * 組出證明聯（含可選交易明細）之完整列印 HTML
 * @param {{
 *   storeName?: string,
 *   invoiceNumber: string,       // 10 碼
 *   date: Date,                  // 開立日期（期別/日期列用）
 *   randomCode: string,
 *   totalAmount: number,
 *   sellerTaxId: string,
 *   buyerTaxId?: string|null,
 *   barcodeSvg: string,          // code39Svg() 輸出
 *   qrLeftDataUrl: string,       // QRCode.toDataURL(left)
 *   qrRightDataUrl: string,      // QRCode.toDataURL(right)
 *   detailHtml?: string,         // 選附交易明細（接在證明聯下方，虛線裁切）
 * }} p
 */
export function buildProofSlipHtml(p) {
  const {
    storeName = '', invoiceNumber, date, randomCode, totalAmount,
    sellerTaxId, buyerTaxId = null, barcodeSvg, qrLeftDataUrl, qrRightDataUrl,
    detailHtml = '',
  } = p

  const pad = n => String(n).padStart(2, '0')
  const now = new Date()
  const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

  // 紙寬：58mm 熱感機縮版（可印寬 ~48mm，兩個 QR 要縮小才並排得下）；否則 80mm
  const is58 = Number(p.paperWidth) === 58
    || (() => { try { return localStorage.getItem('pos_paper_width') === '58' } catch { return false } })()
  const bodyW = is58 ? '48mm' : '76mm'
  const qrMm  = is58 ? '20mm' : '26mm'
  const pageW = is58 ? '58mm' : '80mm'

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Courier New","Noto Sans TC","微軟正黑體",monospace;
     width:${bodyW};max-width:100%;padding:8px 6px;text-align:center;color:#000;background:#fff}
.store{font-size:14px;font-weight:700;margin-bottom:2px}
.title{font-size:17px;font-weight:900;letter-spacing:2px}
.period{font-size:19px;font-weight:900;letter-spacing:1px;margin-top:2px}
.invno{font-size:20px;font-weight:900;letter-spacing:2px;margin:2px 0 4px}
.meta{font-size:12px;text-align:left;padding:0 6px;line-height:1.6}
.meta .row{display:flex;justify-content:space-between}
.bc{margin:6px 0 2px}
.bc svg{max-width:100%;height:40px}
.qrs{display:flex;justify-content:space-between;padding:2px 8px 0}
.qrs img{width:${qrMm};height:${qrMm}}
hr.cut{border:none;border-top:1px dashed #999;margin:10px 0 8px}
.note{font-size:10px;color:#555;margin-top:4px}
@media print{@page{margin:2mm;size:${pageW} auto}}
</style></head><body>
${storeName ? `<div class="store">${storeName}</div>` : ''}
<div class="title">電子發票證明聯</div>
<div class="period">${rocPeriodLabel(date)}</div>
<div class="invno">${formatInvNo(invoiceNumber)}</div>
<div class="meta">
  <div>${timeStr}</div>
  <div class="row"><span>隨機碼 ${randomCode}</span><span>總計 ${Math.round(Number(totalAmount) || 0).toLocaleString()}</span></div>
  <div class="row"><span>賣方 ${sellerTaxId}</span>${buyerTaxId ? `<span>買方 ${buyerTaxId}</span>` : '<span></span>'}</div>
</div>
<div class="bc">${barcodeSvg}</div>
<div class="qrs">
  <img src="${qrLeftDataUrl}" alt="">
  <img src="${qrRightDataUrl}" alt="">
</div>
<div class="note">退貨或兌獎請持本證明聯</div>
${detailHtml ? `<hr class="cut">${detailHtml}` : ''}
<script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script>
</body></html>`
}
