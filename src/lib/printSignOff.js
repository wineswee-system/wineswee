/**
 * 通用「簽呈」列印（HTML + window.print()）
 *
 * 任何單筆簽核文件都可以用這個。不依賴特定 schema：
 * 把表單欄位映射成 sections，再丟進來即可。
 *
 * 設計目標：
 *   - 中文用系統字型（Microsoft JhengHei / PingFang TC）→ 不會亂碼
 *   - 版面照台灣公司正式簽呈（公司名+簽呈、呈文表、主旨、說明、…、簽核欄、以上呈請核示）
 *   - 簽核欄智慧渲染：有 chainSteps 就照鏈渲染（已核/駁回/等候），沒有就回退靜態 3 格
 *   - 支援公司 LOGO（URL 帶進來）
 *
 * @param {Object} opts
 * @param {string} opts.companyName       公司全名（例：威耀時代股份有限公司）
 * @param {string} [opts.logoUrl]         LOGO URL（可省）
 * @param {string} opts.docTitle          文件名稱（顯示在標題下方副標 + window title，例：費用申請）
 * @param {string|number} [opts.docNo]    文件編號（例：35）
 * @param {Object} opts.applicant         { name, name_en, dept, position, store }
 * @param {string} opts.date              呈文日期（任意格式字串，例：2026/05/06）
 * @param {string} [opts.cc]              副本（手動指定；否則從 chainSteps 推）
 * @param {string} opts.subject           一、主旨（短句）
 * @param {Array} [opts.sections]         二、三、四… 自由節點：
 *                                          { title, text }                       純文字
 *                                          { title, rows: [[label, value], …] }  key-value 列
 *                                          { title, table: { head, body, foot } } 表格
 * @param {string} [opts.status]          狀態（影響簽核欄樣式 + header badge）
 * @param {string} [opts.rejectReason]    駁回原因（status='已駁回'/'已拒絕' 用）
 * @param {Array} [opts.chainSteps]       approval_chain_steps：[{ step_order, label, role_name, target_emp_id }]
 * @param {Object} [opts.approverMap]     { emp_id: emp_name } chain 用
 * @param {Object} [opts.finalApprover]   { name, approved_at } 最後核可者顯示用
 * @param {Array<string>} [opts.simpleSign]  無 chain 時的靜態簽核欄 label 陣列
 *                                            預設 ['呈文者', '主管核示', '人資/財務']
 * @param {number} [opts.simpleSignApproverIdx]  approved 時 finalApprover 的簽章要印在哪一格
 *                                                預設最後一格；HR 表單通常設 1（中間的主管）
 * @param {Array} [opts.attachments]      附件列表：[{ url, name?, type? }]
 *                                          - 圖檔（image/* 或副檔名 jpg/png/...）會內嵌顯示
 *                                          - 其他檔案只列檔名與「請另行查閱」提示
 * @param {Object} [opts.signatures]      簽章圖 map：{ '簽核人姓名': 'url' }
 *                                          - 該關核可後，用簽核人名字 lookup 簽章圖印在 cell 中
 *                                          - finalApprover.signature_url 可直接傳，會優先覆蓋 map lookup
 */
export function printSignOff(opts = {}) {
  const {
    companyName = '',
    logoUrl = '',
    docTitle = '簽呈',
    docNo,
    applicant = {},
    date = '',
    cc,
    subject = '',
    sections = [],
    status = '',
    rejectReason = '',
    chainSteps = [],
    approverMap = {},
    finalApprover,
    simpleSign = ['呈文者', '主管核示', '人資/財務'],
    simpleSignApproverIdx,
    attachments = [],
    signatures = {},
  } = opts

  const appDept = applicant.store || applicant.dept || applicant.departments?.name || applicant.stores?.name || '—'
  const appName = `${applicant.name || ''}${applicant.name_en ? ` (${applicant.name_en})` : ''}`.trim() || '—'

  // 副本：手動指定優先，否則從 chainSteps 推
  const ccText = cc != null ? cc : (
    [...new Set((chainSteps || [])
      .map(s => s.target_emp_id ? approverMap[s.target_emp_id] : (s.role_name || s.label || ''))
      .filter(Boolean))]
      .join('、')
  )

  // 狀態 badge 顏色
  const statusBadge = renderStatusBadge(status)
  const signCellsHtml = renderSignCells({ status, rejectReason, chainSteps, approverMap, finalApprover, simpleSign, simpleSignApproverIdx, signatures })
  const sectionsHtml = sections.map((sec, idx) => renderSection(sec, idx + 2)).join('')
  const attachmentsHtml = renderAttachments(attachments, sections.length + 2)

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>${safe(companyName)} ${safe(docTitle)}${docNo ? ` #${docNo}` : ''}</title>
<style>
  @page { size: A4 portrait; margin: 1.2cm 1.4cm; }
  @media print {
    .no-print { display: none !important; }
    body { padding: 0; background: #fff; }
    .page { box-shadow: none; padding: 0; border: none; }
    /* 強制章節 / 簽核欄不要切開 */
    .section { page-break-inside: avoid; }
    .sign-row { page-break-inside: avoid; }
    .ending { page-break-after: avoid; }
  }
  * { box-sizing: border-box; }
  html, body { background: #f4f1ea; }
  body {
    font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", "PMingLiU", "Heiti TC", sans-serif;
    color: #1a1a1a;
    font-size: 13.5pt;
    line-height: 1.55;
    margin: 0;
    padding: 20px 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .toolbar {
    max-width: 19cm; margin: 0 auto 16px; background: #fff; border: 1px solid #d8cfb8;
    padding: 12px 16px; border-radius: 8px;
    display: flex; gap: 10px; align-items: center;
    box-shadow: 0 4px 16px rgba(0,0,0,0.06);
  }
  .toolbar button {
    padding: 7px 16px; font-size: 11.5pt; cursor: pointer;
    border-radius: 5px; border: 1px solid #b8a878; background: #fff;
    font-family: inherit;
    transition: all 0.15s;
  }
  .toolbar button:hover { background: #faf6ec; }
  .toolbar button.primary { background: #6e5a2e; color: #fff; border-color: #6e5a2e; }
  .toolbar button.primary:hover { background: #54441f; }
  .page {
    background: #fff; max-width: 19cm; margin: 0 auto;
    padding: 20px 28px 24px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.1);
    border-radius: 2px;
    position: relative;
  }
  /* ─── 頁首：LOGO + 公司名 + 簽呈 + 狀態 ─── */
  .header {
    position: relative;
    padding-bottom: 8px;
    margin-bottom: 12px;
  }
  .header::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0;
    height: 4px;
    background: linear-gradient(to right, #6e5a2e 0%, #6e5a2e 70%, #b8a878 100%);
    border-radius: 2px;
  }
  .header::before {
    content: ''; position: absolute; left: 0; right: 0; bottom: -8px;
    height: 1px; background: #6e5a2e;
  }
  .header-row {
    display: grid; grid-template-columns: 80px 1fr 80px;
    align-items: center; gap: 14px;
  }
  .logo-box {
    width: 80px; height: 80px;
    display: flex; align-items: center; justify-content: center;
  }
  .logo-box img {
    max-width: 100%; max-height: 100%; object-fit: contain;
  }
  .title-area { text-align: center; }
  .company-name {
    font-size: 15pt; font-weight: 600; color: #6e5a2e;
    letter-spacing: 4px; margin: 0 0 4px 0;
  }
  .doc-title {
    font-size: 26pt; font-weight: 800;
    letter-spacing: 12px; margin: 0;
    color: #1a1a1a; padding-left: 12px;  /* offset for letter-spacing */
    line-height: 1.2;
  }
  .doc-meta-side { text-align: right; font-size: 10.5pt; color: #6b6357; }
  .doc-meta-side .doc-no { font-family: ui-monospace, "SF Mono", Consolas, monospace; }
  .status-pill {
    display: inline-block; padding: 3px 12px; border-radius: 12px;
    font-size: 10.5pt; font-weight: 700; margin-top: 6px;
  }
  .status-pill.applying { background: #e8eef8; color: #2f4f8a; }
  .status-pill.approved { background: #e0f0e3; color: #0a6b2e; }
  .status-pill.rejected { background: #f8e3e3; color: #9c1f1f; }
  .status-pill.cancelled { background: #ececec; color: #666; }

  /* ─── 呈文資訊表 ─── */
  table.meta {
    width: 100%; border-collapse: collapse;
    margin-bottom: 12px;
    border: 1.2px solid #2a2a2a;
    background: #fdfcf8;
  }
  table.meta td {
    border: 0.8px solid #888;
    padding: 7px 12px;
    font-size: 13pt;
    vertical-align: middle;
  }
  table.meta td.label {
    background: #efeadc;
    width: 17%;
    font-weight: 700;
    text-align: center;
    color: #4a3f1f;
    letter-spacing: 2px;
    white-space: nowrap;
  }
  table.meta td.value {
    width: 33%;
    background: #fff;
  }

  /* ─── 章節 ─── */
  .section { margin-bottom: 8px; }
  .section-title {
    font-size: 14pt;
    font-weight: 700;
    margin: 10px 0 6px 0;
    color: #2a2a2a;
    display: flex; align-items: baseline; gap: 10px;
    border-bottom: 1px dashed #c8b88a;
    padding-bottom: 3px;
  }
  .section-title .num {
    color: #6e5a2e; font-weight: 800; letter-spacing: 2px;
  }
  .section-content {
    padding-left: 28px;
    line-height: 1.55;
    color: #1a1a1a;
  }
  .subject {
    font-size: 14.5pt; font-weight: 700;
    color: #1a1a1a;
  }
  .text-content {
    white-space: pre-wrap; word-wrap: break-word; font-size: 13pt;
  }
  .field-row {
    display: flex; gap: 14px;
    margin-bottom: 3px;
    align-items: flex-start;
  }
  .field-label {
    flex-shrink: 0; min-width: 116px;
    font-weight: 600; color: #4a3f1f;
    text-align: justify; text-align-last: justify;
    padding-right: 6px;
    font-size: 13.5pt;
  }
  .field-label::after { content: '：'; }
  .field-value {
    flex: 1; white-space: pre-wrap; word-wrap: break-word;
    font-size: 13.5pt;
  }

  /* ─── 內嵌資料表（明細）─── */
  table.data {
    width: 100%; border-collapse: collapse;
    margin-top: 8px; font-size: 12.5pt;
    border: 1px solid #b8a878;
  }
  table.data th, table.data td {
    border: 1px solid #c8b88a;
    padding: 8px 12px;
  }
  table.data th {
    background: #efeadc; font-weight: 700; text-align: center;
    color: #4a3f1f;
  }
  table.data tbody tr:nth-child(even) { background: #faf6ec; }
  table.data tfoot td {
    font-weight: 700; background: #efeadc; color: #4a3f1f;
  }

  /* ─── 結尾 + 簽核欄 ─── */
  .ending {
    margin: 14px 0 12px;
    text-align: right;
    font-size: 14pt; font-weight: 700;
    color: #1a1a1a; letter-spacing: 2px;
    padding-right: 12px;
  }
  .sign-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0;
    border: 1.2px solid #2a2a2a;
    background: #fff;
  }
  .sign-cell {
    border-right: 0.8px solid #888;
    min-height: 88px;
    display: flex; flex-direction: column;
    background: #fff;
  }
  .sign-cell:last-child { border-right: none; }
  .sign-cell .sign-header {
    background: #efeadc; border-bottom: 0.8px solid #888;
    padding: 5px 8px; font-size: 12pt; font-weight: 700;
    text-align: center; color: #4a3f1f; letter-spacing: 2px;
  }
  .sign-cell .sign-target {
    background: #fdfcf8; padding: 3px 8px; font-size: 10.5pt;
    color: #6b6357; text-align: center;
    border-bottom: 1px dashed #b8a878;
    min-height: 20px;
  }
  .sign-cell .sign-stamp {
    flex: 1; padding: 8px 6px;
    font-size: 11.5pt; text-align: center;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    gap: 2px;
  }
  .sign-cell .approved { color: #0a6b2e; font-weight: 700; font-size: 16pt; }
  .sign-cell .rejected { color: #9c1f1f; font-weight: 700; font-size: 16pt; }
  .sign-cell .cancelled { color: #888; font-weight: 700; font-size: 12pt; }
  .sign-cell .pending { color: #aaa; font-size: 11pt; }
  .sign-cell .date { font-size: 10.5pt; color: #6b6357; margin-top: 4px; }
  .sign-cell .reason {
    font-size: 10.5pt; color: #9c1f1f; margin-top: 4px;
    padding: 0 6px; line-height: 1.4;
  }
  .sign-cell.approved-bg { background: rgba(34,197,94,0.04); }
  .sign-cell.rejected-bg { background: rgba(239,68,68,0.04); }
  .sign-cell .placeholder-line {
    color: #cfc7b0; font-size: 10.5pt; letter-spacing: 4px;
  }
  .sign-cell .signature-img {
    max-width: 90%; max-height: 50px;
    object-fit: contain;
    margin-bottom: 2px;
  }
  .sign-cell .signature-name {
    font-size: 10pt; color: #0a6b2e; font-weight: 700;
  }

  /* ─── 附件區 ─── */
  .attachment-item {
    margin-bottom: 14px;
    page-break-inside: avoid;
  }
  .attachment-name {
    font-size: 11.5pt; color: #4a3f1f; font-weight: 600;
    margin-bottom: 6px;
    display: flex; align-items: baseline; gap: 6px;
  }
  .attachment-name .badge {
    font-size: 9pt; color: #6e5a2e;
    background: #efeadc; padding: 1px 8px; border-radius: 8px;
    font-weight: 500;
  }
  .attachment-image {
    border: 1px solid #c8b88a;
    border-radius: 4px;
    padding: 6px;
    background: #fdfcf8;
    display: inline-block;
    max-width: 100%;
  }
  .attachment-image img {
    max-width: 100%;
    max-height: 480px;
    display: block;
    object-fit: contain;
  }
  .attachment-file {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px;
    background: #faf6ec;
    border: 1px solid #e0d5b0;
    border-radius: 4px;
    font-size: 12pt;
    color: #4a3f1f;
  }
  .attachment-file .file-note {
    color: #8a8270; font-size: 10pt; margin-left: auto;
  }

  /* ─── 頁尾 ─── */
  .footer {
    margin-top: 12px; padding-top: 8px;
    border-top: 1px solid #c8b88a;
    display: flex; justify-content: space-between;
    font-size: 9.5pt; color: #8a8270;
    letter-spacing: 0.5px;
  }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button class="primary" onclick="window.print()">🖨 列印 / 另存 PDF</button>
    <button onclick="window.close()">關閉</button>
    <span style="color:#8a8270;font-size:10pt;margin-left:auto">提示：列印對話框可選「另存為 PDF」</span>
  </div>

  <div class="page">
    <div class="header">
      <div class="header-row">
        <div class="logo-box">
          ${logoUrl ? `<img src="${safe(logoUrl)}" alt="logo" onerror="this.style.display='none'" />` : ''}
        </div>
        <div class="title-area">
          ${companyName ? `<div class="company-name">${safe(companyName)}</div>` : ''}
          <h1 class="doc-title">簽　呈</h1>
        </div>
        <div class="doc-meta-side">
          ${docTitle ? `<div>${safe(docTitle)}</div>` : ''}
          ${docNo ? `<div class="doc-no">No. ${safe(String(docNo))}</div>` : ''}
          ${statusBadge}
        </div>
      </div>
    </div>

    <table class="meta">
      <tr>
        <td class="label">呈文單位</td><td class="value">${safe(appDept)}</td>
        <td class="label">呈文者</td><td class="value">${safe(appName)}</td>
      </tr>
      <tr>
        <td class="label">呈文日期</td><td class="value">${safe(date || '—')}</td>
        <td class="label">副本</td><td class="value">${safe(ccText || '—')}</td>
      </tr>
    </table>

    <div class="section">
      <div class="section-title"><span class="num">一、</span>主旨</div>
      <div class="section-content">
        <div class="subject">${safe(subject || '—')}</div>
      </div>
    </div>

    ${sectionsHtml}

    ${attachmentsHtml}

    <div class="ending">以上，呈請核示。</div>

    <div class="sign-row">${signCellsHtml}</div>

    <div class="footer">
      <div>產製日期：${new Date().toLocaleString('zh-TW')}</div>
      <div>SME Ops System · 表單系統</div>
    </div>
  </div>
</body>
</html>`

  const w = window.open('', '_blank', 'width=900,height=1100')
  if (!w) {
    alert('無法開啟新視窗，請允許彈出視窗權限')
    return
  }
  w.document.write(html)
  w.document.close()
}

// ── helpers ──

function safe(s) {
  if (s == null) return ''
  return String(s).replace(/[<>&"']/g, c => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function renderStatusBadge(status) {
  if (!status) return ''
  const map = {
    '申請中': 'applying', '待審核': 'applying',
    '已核准': 'approved', '已核銷': 'approved',
    '已駁回': 'rejected', '已拒絕': 'rejected', '已退回': 'rejected',
    '已取消': 'cancelled',
  }
  const cls = map[status] || 'applying'
  return `<div class="status-pill ${cls}">${safe(status)}</div>`
}

const NUM_LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

function renderSection(sec, idx) {
  const numLabel = NUM_LABELS[idx - 1] || `第${idx}`
  const titleHtml = `<div class="section-title"><span class="num">${numLabel}、</span>${safe(sec.title || '')}</div>`

  if (sec.text != null) {
    return `<div class="section">${titleHtml}<div class="section-content"><div class="text-content">${safe(sec.text) || '<span style="color:#aaa">—</span>'}</div></div></div>`
  }
  if (Array.isArray(sec.rows) && sec.rows.length > 0) {
    const rowsHtml = sec.rows
      .filter(r => r && r.length >= 2 && r[1] != null && r[1] !== '')
      .map(([label, value]) => `<div class="field-row"><span class="field-label">${safe(label)}</span><span class="field-value">${safe(value)}</span></div>`)
      .join('')
    return `<div class="section">${titleHtml}<div class="section-content">${rowsHtml || '<div style="color:#aaa">—</div>'}</div></div>`
  }
  if (sec.table) {
    const { head = [], body = [], foot = [] } = sec.table
    const headHtml = head.length > 0 ? `<thead><tr>${head.map(h => `<th>${safe(h)}</th>`).join('')}</tr></thead>` : ''
    const bodyHtml = `<tbody>${body.map(row => `<tr>${row.map(cell => `<td>${safe(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
    const footHtml = foot.length > 0 ? `<tfoot>${foot.map(row => `<tr>${row.map(cell => `<td>${safe(cell)}</td>`).join('')}</tr>`).join('')}</tfoot>` : ''
    return `<div class="section">${titleHtml}<div class="section-content"><table class="data">${headHtml}${bodyHtml}${footHtml}</table></div></div>`
  }
  return ''
}

function renderApprovedCell({ name, signatureUrl, approvedAt }) {
  if (signatureUrl) {
    return `
      <img src="${safe(signatureUrl)}" alt="${safe(name)}" class="signature-img" onerror="this.outerHTML='<div class=approved>✓</div>'" />
      <div class="signature-name">${safe(name)}</div>
      ${approvedAt ? `<div class="date">${safe(fmtDate(approvedAt))}</div>` : ''}
    `
  }
  return `
    <div class="approved">✓</div>
    <div style="font-weight:700;font-size:10.5pt">${safe(name)}</div>
    ${approvedAt ? `<div class="date">${safe(fmtDate(approvedAt))}</div>` : ''}
  `
}

function renderSignCells({ status, rejectReason, chainSteps, approverMap, finalApprover, simpleSign, simpleSignApproverIdx, signatures = {} }) {
  // 沒有 chainSteps → 靜態 N 格（指定格如有 finalApprover.name 且核可，印簽章）
  if (!chainSteps || chainSteps.length === 0) {
    const targetIdx = simpleSignApproverIdx != null ? simpleSignApproverIdx : (simpleSign.length - 1)
    return simpleSign.map((label, idx) => {
      const isApproved = (status === '已核准' || status === '已核銷') && idx === targetIdx && finalApprover?.name
      if (isApproved) {
        const sigUrl = finalApprover.signature_url || signatures[finalApprover.name]
        return `
          <div class="sign-cell approved-bg">
            <div class="sign-header">${safe(label)}</div>
            <div class="sign-target">${safe(finalApprover.name)}</div>
            <div class="sign-stamp">${renderApprovedCell({ name: finalApprover.name, signatureUrl: sigUrl, approvedAt: finalApprover.approved_at })}</div>
          </div>
        `
      }
      return `
        <div class="sign-cell">
          <div class="sign-header">${safe(label)}</div>
          <div class="sign-target">　</div>
          <div class="sign-stamp"><div class="placeholder-line">簽章 / 日期</div></div>
        </div>
      `
    }).join('')
  }

  // 有 chainSteps → 智慧渲染（優先使用 step.status；沒設則 fallback 用 overall status）
  return chainSteps.map((step, idx) => {
    const stepLabel = step.label || step.role_name || `第 ${idx + 1} 關`
    // 優先：step.name（buildChainSteps 已預先填好）；次之：approverMap lookup；最後：role_name
    const stepTarget = step.name || (step.target_emp_id ? approverMap[step.target_emp_id] : '') || step.role_name || ''

    let cellContent = ''
    let cellStatus = ''

    // per-step status 優先
    let perStepStatus = step.status
    if (!perStepStatus) {
      // fallback to overall status (舊行為)
      if (status === '已核准' || status === '已核銷') perStepStatus = 'completed'
      else if (status === '已駁回' || status === '已拒絕' || status === '已退回') perStepStatus = (idx === 0 ? 'rejected' : 'pending')
      else if (status === '已取消') perStepStatus = 'cancelled'
      else perStepStatus = 'pending'
    }

    if (perStepStatus === 'completed') {
      // 申請人 step 特殊：不蓋章，只顯示 submission timestamp
      if (idx === 0 && (step.label === '申請人' || stepLabel === '申請人')) {
        cellContent = `<div style="font-size:11pt;font-weight:700;color:#0a6b2e">${safe(step.name || stepTarget)}</div>` +
                      (step.completedAt ? `<div class="date">${safe(fmtDate(step.completedAt))}　送出</div>` : '')
      } else {
        const signerName = step.completedBy || stepTarget
        // 簽章優先序：finalApprover.signature_url（最後關）→ signatures[signerName]
        const isLastStep = idx === chainSteps.length - 1
        const sigUrl = (isLastStep && finalApprover?.signature_url) || signatures[signerName]
        cellContent = renderApprovedCell({ name: signerName, signatureUrl: sigUrl, approvedAt: step.completedAt })
      }
      cellStatus = 'approved-bg'
    } else if (perStepStatus === 'rejected') {
      cellContent = `<div class="rejected">✗</div><div style="font-size:10pt;color:#9c1f1f;font-weight:700">駁回</div>` +
                    (step.rejectReason || rejectReason ? `<div class="reason">${safe(step.rejectReason || rejectReason)}</div>` : '')
      cellStatus = 'rejected-bg'
    } else if (perStepStatus === 'current') {
      cellContent = `<div class="pending">⏸ 等候中</div>`
    } else if (perStepStatus === 'cancelled') {
      cellContent = `<div class="cancelled">已取消</div>`
    } else {
      // pending：空格留簽章空間
      cellContent = `<div class="placeholder-line">簽章 / 日期</div>`
    }

    return `
      <div class="sign-cell ${cellStatus}">
        <div class="sign-header">${safe(stepLabel)}</div>
        <div class="sign-target">${safe(stepTarget || '　')}</div>
        <div class="sign-stamp">${cellContent}</div>
      </div>`
  }).join('')
}

function fmtDate(s) {
  if (!s) return ''
  const d = typeof s === 'string' ? s.slice(0, 10) : new Date(s).toISOString().slice(0, 10)
  return d.replace(/-/g, '/')
}

function isImageAttachment(att) {
  if (att.type && att.type.startsWith('image/')) return true
  const target = (att.name || att.url || '').toLowerCase()
  return /\.(jpe?g|png|gif|webp|bmp|svg)(\?|$)/i.test(target)
}

function renderAttachments(attachments, sectionIdx) {
  if (!attachments || attachments.length === 0) return ''
  const numLabel = NUM_LABELS[sectionIdx - 1] || `第${sectionIdx}`

  const itemsHtml = attachments.map((att, i) => {
    if (!att?.url) return ''
    const name = att.name || `附件 ${i + 1}`
    if (isImageAttachment(att)) {
      return `
        <div class="attachment-item">
          <div class="attachment-name">📎 ${safe(name)} <span class="badge">圖檔</span></div>
          <div class="attachment-image"><img src="${safe(att.url)}" alt="${safe(name)}" onerror="this.parentElement.innerHTML='<span style=color:#9c1f1f>（圖檔載入失敗，請另行查閱）</span>'" /></div>
        </div>`
    }
    return `
      <div class="attachment-item">
        <div class="attachment-file">
          <span style="font-size:14pt">📄</span>
          <span>${safe(name)}</span>
          <span class="file-note">非圖檔，請另行查閱</span>
        </div>
      </div>`
  }).join('')

  // 附件區強制換頁，避免擠壞主表
  return `<div class="section attachments-section" style="page-break-before: always; padding-top: 12px">
    <div class="section-title"><span class="num">${numLabel}、</span>附件</div>
    <div class="section-content">${itemsHtml}</div>
  </div>`
}
