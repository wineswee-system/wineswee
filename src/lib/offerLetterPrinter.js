import { toast } from './toast'

/**
 * 列印錄取通知書（A4 信件格式）
 *
 * @param {Object} ol        offer_letters row（含 ol.candidates.name via join）
 * @param {Object} opts
 * @param {string} opts.companyName   公司全名
 * @param {string} [opts.logoUrl]     LOGO URL
 * @param {Window} [opts._win]        預先開好的 window（避免 popup blocker）
 */
export function printOfferLetter(ol, opts = {}) {
  if (!ol) return

  const candidateName = ol.candidates?.name || '—'
  const companyName   = opts.companyName || ''
  const logoUrl       = opts.logoUrl     || ''
  const fmtDate  = (s) => s ? String(s).slice(0, 10).replace(/-/g, '/') : '—'
  const fmtMoney = (n) => n != null ? `NT$ ${Number(n).toLocaleString()}` : '—'
  const signedDate = fmtDate(ol.approved_at || ol.created_at)

  const bodyContent = ol.filled_html?.trim()
    ? ol.filled_html
    : buildDefaultBody({ candidateName, companyName, ol, fmtDate })

  const termsTable = !ol.filled_html?.trim() ? `
    <table class="terms-table">
      <tr><th>職位</th><td>${ol.position || '—'}</td></tr>
      <tr><th>部門</th><td>${ol.dept || '—'}</td></tr>
      <tr><th>月薪</th><td>${fmtMoney(ol.salary)}</td></tr>
      <tr><th>到職日</th><td>${fmtDate(ol.start_date)}</td></tr>
      <tr><th>試用期</th><td>${ol.probation_days ? ol.probation_days + ' 天' : '—'}</td></tr>
    </table>` : ''

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8" />
  <title>錄取通知書 — ${candidateName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif;
      font-size: 14px; color: #1a1a1a; background: #fff;
    }
    @media print {
      @page { size: A4 portrait; margin: 20mm 20mm 20mm 20mm; }
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .no-print { display: none; }
    }
    .page { max-width: 720px; margin: 40px auto; padding: 48px 56px; background: #fff; border: 1px solid #ddd; }
    .header {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 32px; padding-bottom: 16px; border-bottom: 2px solid #1a1a1a;
    }
    .header-logo img { max-height: 48px; max-width: 140px; }
    .header-title { text-align: right; }
    .header-title h1 { font-size: 22px; font-weight: 700; letter-spacing: 4px; }
    .header-title .doc-no { font-size: 12px; color: #666; margin-top: 4px; }
    .body-content { font-size: 14px; line-height: 2; margin-bottom: 32px; }
    .body-content p { margin-bottom: 12px; }
    .body-content ul { margin: 8px 0 12px 24px; }
    .body-content li { margin-bottom: 4px; }
    .terms-table { width: 100%; border-collapse: collapse; margin: 16px 0 24px; font-size: 13px; }
    .terms-table th {
      background: #f5f5f5; border: 1px solid #ddd; padding: 8px 12px;
      text-align: left; font-weight: 600; width: 30%;
    }
    .terms-table td { border: 1px solid #ddd; padding: 8px 12px; }
    .signature-section { margin-top: 48px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
    .sig-box { border-top: 1px solid #999; padding-top: 8px; }
    .sig-box .sig-label { font-size: 12px; color: #666; margin-bottom: 32px; }
    .sig-box .sig-name { font-size: 13px; font-weight: 600; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 11px; color: #999; text-align: center; }
    .print-btn {
      display: block; margin: 16px auto; padding: 10px 32px;
      background: #0ea5e9; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer;
    }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">列印 / 儲存 PDF</button>
  <div class="page">
    <div class="header">
      <div class="header-logo">
        ${logoUrl
          ? `<img src="${logoUrl}" alt="${companyName}" />`
          : `<span style="font-size:18px;font-weight:700;">${companyName}</span>`}
      </div>
      <div class="header-title">
        <h1>錄取通知書</h1>
        <div class="doc-no">編號：${ol.id}｜日期：${signedDate}</div>
      </div>
    </div>

    <div class="body-content">${bodyContent}</div>
    ${termsTable}

    <div class="signature-section">
      <div class="sig-box">
        <div class="sig-label">應聘人確認簽名</div>
        <div class="sig-name">${candidateName}</div>
      </div>
      <div class="sig-box">
        <div class="sig-label">公司授權代表</div>
        <div class="sig-name">${companyName}</div>
      </div>
    </div>

    <div class="footer">${companyName}｜錄取通知書（編號 ${ol.id}）｜本文件請妥善保存</div>
  </div>
  <button class="print-btn no-print" onclick="window.print()">列印 / 儲存 PDF</button>
</body>
</html>`

  const win = opts._win || window.open('', '_blank')
  if (!win) { toast('請允許彈出視窗以列印錄取通知書'); return }
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
}

function buildDefaultBody({ candidateName, companyName, ol, fmtDate }) {
  return `
<p>親愛的 <strong>${candidateName}</strong> 您好，</p>
<p>感謝您應徵本公司 <strong>${ol.position || '—'}</strong> 一職。經本公司審慎評估，我們誠摯地邀請您加入 ${companyName}。</p>
<p>以下為錄取條件，請詳閱後簽名確認：</p>
<p>請於收到本通知後 <strong>5 個工作日內</strong>回覆確認，逾期視同婉拒。如有任何問題，歡迎聯繫人資部門。</p>
<p>期待您的加入，祝商祺。</p>
<p style="margin-top:24px;">${companyName}<br/>${fmtDate(ol.approved_at || ol.created_at)}</p>`
}
