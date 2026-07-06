import { toast } from '../../../lib/toast'

// 財會報表共用「列印 / 另存 PDF」視窗
// 比照 exportPdf.js 的 exportAttendancePdf 做法：jsPDF 未嵌中文字型會亂碼，
// 改用 HTML + window.print()，以系統中文字型輸出，讓使用者列印或另存 PDF。
// 註：此為獨立列印文件（非 app DOM），CSS 變數不存在，故使用列印專用 hex 色。

export const esc = (s) => s == null ? '' : String(s).replace(/[<>&"']/g, c => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]
))

/**
 * 開啟報表列印視窗
 * @param {{title: string, subtitle?: string, bodyHtml: string}} params — bodyHtml 內文字需自行 esc() 過
 */
export function openReportPrintWindow({ title, subtitle, bodyHtml }) {
  const html = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Microsoft JhengHei","PingFang TC","Noto Sans TC","Heiti TC",sans-serif; margin: 24px; color: #1a1a1a; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #0e7490; }
  .sub { font-size: 13px; color: #666; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; }
  th { background: #0e7490; color: #fff; padding: 6px 8px; text-align: left; font-weight: 600; white-space: nowrap; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  td.c, th.c { text-align: center; }
  tr.subtotal td { background: #f0f7f9; font-weight: 600; }
  tr.total td { background: #e2eef2; font-weight: 700; border-top: 2px solid #0e7490; }
  h3.section { font-size: 14px; margin: 20px 0 8px; color: #0e7490; }
  .toolbar { margin-bottom: 16px; }
  .toolbar button { padding: 8px 20px; border-radius: 6px; border: none; background: #0e7490; color: #fff; font-size: 14px; cursor: pointer; }
  @media print { .toolbar { display: none; } body { margin: 0; } }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨 列印 / 另存 PDF</button></div>
  <h1>${esc(title)}</h1>
  <div class="sub">${esc(subtitle || '')}　｜　產生時間：${new Date().toLocaleString('zh-TW')}</div>
  ${bodyHtml}
</body></html>`

  const w = window.open('', '_blank', 'width=1000,height=1200')
  if (!w) { toast.error('無法開啟新視窗，請允許彈出視窗權限'); return }
  w.document.open()
  w.document.write(html)
  w.document.close()
}
