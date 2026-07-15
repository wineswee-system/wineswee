// 在職證明 / 離職證明 — HTML → 開新分頁 → 自動跳列印（另存為 PDF）
// 與 exportPdf.js 的 exportScheduleCalendarPdf 同手法，中文走 CSS 字型，純前端。
import { toast } from './toast'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

// 'YYYY-MM-DD' → 中華民國 YYY 年 M 月 D 日（給不出日期就回空字串）
function rocDate(d) {
  if (!d) return ''
  const s = String(d).slice(0, 10)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return s
  const y = Number(m[1]) - 1911
  return `中華民國 ${y} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`
}

const CERT_TITLE = { employment: '在 職 證 明 書', separation: '離 職 證 明 書' }

/**
 * @param {Object} p
 * @param {'employment'|'separation'} p.type
 * @param {Object} p.employee  { name, id_number, join_date, resign_date, position, dept, store }
 * @param {Object} p.org       { name, tax_id, contact_person, address, logo_url }
 */
export function exportEmployeeCertificate({ type, employee = {}, org = {} }) {
  const isSep = type === 'separation'
  const title = CERT_TITLE[type] || CERT_TITLE.employment

  const empName = employee.name || ''
  const idNo    = employee.id_number || ''
  const birthD  = rocDate(employee.birth_date)
  const dept    = employee.dept || employee.department || ''
  const position = employee.position || ''
  const role    = `${dept}${dept && position ? '　' : ''}${position}`.trim() || '－'
  const joinD   = rocDate(employee.join_date)
  const resignD = rocDate(employee.resign_date)
  const today   = rocDate(new Date().toISOString().slice(0, 10))

  if (isSep && !employee.resign_date) {
    toast.error('此員工沒有離職日，無法開立離職證明')
    return
  }

  // 正文分行顯示（身分證/出生日期各自一行）；離職證明依勞基法精神只記事實
  const idLine = idNo ? `身分證字號：${esc(idNo)}<br>` : ''
  const birthLine = birthD ? `出生日期：${esc(birthD)}<br>` : ''
  const body = isSep
    ? `茲證明　<b>${esc(empName)}</b>　君<br>${idLine}${birthLine}自　<b>${esc(joinD)}</b>　起至　<b>${esc(resignD)}</b>　止<br>任職於本公司，擔任　<b>${esc(role)}</b><br>現已離職，特此證明。`
    : `茲證明　<b>${esc(empName)}</b>　君<br>${idLine}${birthLine}自　<b>${esc(joinD)}</b>　起<br>任職於本公司，現擔任　<b>${esc(role)}</b><br>目前仍在職，特此證明。`

  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>${esc(title)} - ${esc(empName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Microsoft JhengHei","PingFang TC","Noto Sans TC","Heiti TC",sans-serif; color: #111; margin: 0; padding: 32px; }
  .toolbar { text-align: center; margin-bottom: 16px; }
  .toolbar button { padding: 10px 20px; background: #0e7490; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; font-family: inherit; }
  .page { max-width: 760px; margin: 0 auto; padding: 56px 64px; border: 1px solid #ddd; min-height: 250mm; display: flex; flex-direction: column; }
  .org-head { text-align: center; font-size: 22px; font-weight: 700; letter-spacing: 2px; }
  .org-tax { text-align: center; font-size: 12px; color: #555; margin-top: 4px; }
  .logo { display: block; max-height: 64px; margin: 0 auto 8px; }
  h1.title { text-align: center; font-size: 26px; letter-spacing: 8px; margin: 36px 0 40px; font-weight: 700; }
  .body { font-size: 17px; line-height: 2.4; text-align: center; text-indent: 0; }
  .body b { font-weight: 700; }
  /* 公司資訊:左對齊、放大、更靠左、撐到中偏下 */
  .sign { margin-top: auto; margin-left: -16px; font-size: 18px; line-height: 2.2; width: fit-content; max-width: 100%; text-align: left; white-space: nowrap; }
  .sign .seal { color: #b91c1c; }
  /* 日期:置中、推到頁面最底 */
  .date { margin-top: auto; padding-top: 32px; text-align: center; font-size: 16px; }
  @media print { .toolbar { display: none; } .page { border: none; padding: 40px 56px; } body { padding: 0; } }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨️ 列印 / 另存為 PDF</button></div>
  <div class="page">
    ${org.logo_url ? `<img class="logo" src="${esc(org.logo_url)}" alt="logo">` : ''}
    <div class="org-head">${esc(org.name || '')}</div>
    ${org.tax_id ? `<div class="org-tax">統一編號：${esc(org.tax_id)}</div>` : ''}
    <h1 class="title">${esc(title)}</h1>
    <div class="body">${body}</div>
    <div class="sign">
      公司名稱：${esc(org.name || '')}<br>
      ${org.tax_id ? `統一編號：${esc(org.tax_id)}<br>` : ''}
      ${org.address ? `地　　址：${esc(org.address)}<br>` : ''}
      負 責 人：${esc(org.contact_person || '')}
    </div>
    <div class="date">${esc(today)}　開立</div>
  </div>
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 350))</script>
</body></html>`

  const win = window.open('', '_blank')
  if (!win) { toast.error('請允許彈出視窗，才能開立 / 下載證明'); return }
  win.document.open()
  win.document.write(html)
  win.document.close()
}
