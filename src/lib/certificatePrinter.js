import { toast } from './toast'

export function printCertificate(cert, { courseName, employeeName, companyName = '' } = {}) {
  if (!cert) return

  const fmtDate = (s) => s ? new Date(s).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'
  const issueDate = fmtDate(cert.issued_at)
  const expiryDate = cert.expires_at ? fmtDate(cert.expires_at) : null
  const scoreBlock = cert.score != null
    ? `<div class="score">測驗成績：<strong>${cert.score}</strong> 分</div>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8" />
  <title>結業證書 — ${employeeName || '—'}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif;
      background: #f0f0f0; display: flex; justify-content: center; padding: 32px 16px;
    }
    @media print {
      @page { size: A4 landscape; margin: 0; }
      body { background: #fff; padding: 0; }
      .no-print { display: none !important; }
      .cert { box-shadow: none !important; }
    }
    .no-print {
      text-align: center; margin-bottom: 20px;
    }
    .no-print button {
      padding: 10px 32px; background: #06b6d4; color: #fff;
      border: none; border-radius: 6px; font-size: 14px; cursor: pointer;
    }
    .cert {
      width: 277mm; min-height: 190mm;
      background: #fff;
      border: 1px solid #ddd;
      box-shadow: 0 4px 24px rgba(0,0,0,0.12);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 40px 56px;
      position: relative;
      text-align: center;
    }
    .cert::before {
      content: '';
      position: absolute; inset: 12px;
      border: 2px solid #06b6d4;
      border-radius: 4px;
      pointer-events: none;
    }
    .cert::after {
      content: '';
      position: absolute; inset: 16px;
      border: 0.5px solid #b2e8f5;
      border-radius: 2px;
      pointer-events: none;
    }
    .cert-label {
      font-size: 13px; letter-spacing: 6px; color: #888; margin-bottom: 16px;
    }
    .cert-title {
      font-size: 40px; font-weight: 900; letter-spacing: 12px;
      color: #1a3a5c; margin-bottom: 28px;
    }
    .cert-body {
      font-size: 16px; color: #444; line-height: 2; margin-bottom: 24px;
    }
    .cert-body .name {
      font-size: 26px; font-weight: 700; color: #1a3a5c;
      border-bottom: 2px solid #06b6d4; padding-bottom: 4px; display: inline-block;
      margin: 4px 12px;
    }
    .cert-body .course {
      font-size: 20px; font-weight: 700; color: #06b6d4; margin: 4px 8px;
    }
    .score {
      font-size: 14px; color: #666; margin-bottom: 24px;
    }
    .cert-meta {
      display: flex; gap: 48px; justify-content: center;
      font-size: 13px; color: #888; margin-bottom: 32px;
    }
    .cert-meta span strong { color: #444; }
    .sig-row {
      display: flex; gap: 80px; justify-content: center; margin-top: 8px;
    }
    .sig-box {
      text-align: center; width: 140px;
    }
    .sig-box .sig-line {
      border-top: 1px solid #888; padding-top: 6px; margin-bottom: 4px;
    }
    .sig-box .sig-label { font-size: 12px; color: #888; }
    .cert-stamp {
      position: absolute; bottom: 32px; right: 48px;
      width: 72px; height: 72px; border-radius: 50%;
      border: 2px solid #06b6d4; display: flex; align-items: center; justify-content: center;
      font-size: 10px; color: #06b6d4; font-weight: 700; letter-spacing: 1px;
      opacity: 0.4; text-align: center; line-height: 1.3;
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()">列印 / 儲存 PDF</button>
  </div>
  <div class="cert">
    <div class="cert-label">CERTIFICATE OF COMPLETION</div>
    <div class="cert-title">結 業 證 書</div>

    <div class="cert-body">
      茲證明<span class="name">${employeeName || '—'}</span>已圓滿完成<br />
      <span class="course">《${courseName || '—'}》</span><br />
      全部課程，特頒此證書以資鼓勵。
    </div>

    ${scoreBlock}

    <div class="cert-meta">
      <span>頒發日期：<strong>${issueDate}</strong></span>
      <span>證書編號：<strong>${cert.certificate_number || '—'}</strong></span>
      ${expiryDate ? `<span>有效期限：<strong>${expiryDate}</strong></span>` : ''}
    </div>

    <div class="sig-row">
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-label">學員簽名</div>
      </div>
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-label">核准人</div>
      </div>
    </div>

    ${companyName ? `<div class="cert-stamp">${companyName}</div>` : ''}
  </div>
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) { toast('請允許彈出視窗以列印證書'); return }
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
}
