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
 * @param {string} [opts.status]          狀態（影響簽核欄樣式）
 * @param {string} [opts.rejectReason]    駁回原因（status='已駁回'/'已拒絕' 用）
 * @param {Array} [opts.chainSteps]       approval_chain_steps：[{ step_order, label, role_name, target_emp_id }]
 * @param {Object} [opts.approverMap]     { emp_id: emp_name } chain 用
 * @param {Object} [opts.finalApprover]   { name, approved_at } 最後核可者顯示用
 * @param {Array<string>} [opts.simpleSign]  無 chain 時的靜態簽核欄 label 陣列
 *                                            預設 ['呈文者', '主管核示', '人資/財務']
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
  } = opts

  const appDept = applicant.store || applicant.dept || applicant.departments?.name || applicant.stores?.name || '—'
  const appName = `${applicant.name || ''}${applicant.name_en ? ` (${applicant.name_en})` : ''}`.trim() || '—'

  // 副本：手動指定優先，否則從 chainSteps 推（去重指定簽核人/角色名）
  const ccText = cc != null ? cc : (
    [...new Set((chainSteps || [])
      .map(s => s.target_emp_id ? approverMap[s.target_emp_id] : (s.role_name || s.label || ''))
      .filter(Boolean))]
      .join('、')
  )

  // 簽核欄
  const signCellsHtml = renderSignCells({ status, rejectReason, chainSteps, approverMap, finalApprover, simpleSign })

  // sections 渲染
  const sectionsHtml = sections.map((sec, idx) => renderSection(sec, idx + 2)).join('')

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>${safe(companyName)} ${safe(docTitle)}${docNo ? ` #${docNo}` : ''}</title>
<style>
  @page { size: A4 portrait; margin: 1.8cm; }
  @media print { .no-print { display: none !important; } body { padding: 0; } }
  * { box-sizing: border-box; }
  body {
    font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", "PMingLiU", "Heiti TC", sans-serif;
    color: #000;
    font-size: 12pt;
    line-height: 1.7;
    padding: 24px 32px;
    max-width: 19cm;
    margin: 0 auto;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .toolbar {
    background: #f0f4f8; border: 1px solid #ccc; padding: 12px 16px;
    margin-bottom: 18px; border-radius: 6px;
    display: flex; gap: 10px; align-items: center;
  }
  .toolbar button {
    padding: 6px 14px; font-size: 12pt; cursor: pointer;
    border-radius: 4px; border: 1px solid #888; background: #fff;
    font-family: inherit;
  }
  .toolbar button.primary { background: #0b5cad; color: white; border-color: #0b5cad; }
  .header-row {
    display: flex; align-items: center; gap: 16px; margin-bottom: 14px;
  }
  .logo {
    width: 64px; height: 64px; object-fit: contain; flex-shrink: 0;
    border-radius: 4px;
  }
  .title-area { flex: 1; text-align: center; }
  .company-name {
    font-size: 22pt; font-weight: 700;
    letter-spacing: 4px; margin: 0;
  }
  .doc-meta {
    font-size: 10pt; color: #666; margin-top: 4px; letter-spacing: 1px;
  }
  table.header {
    width: 100%; border-collapse: collapse;
    margin-bottom: 16px; border: 2px solid #000;
  }
  table.header td {
    border: 1px solid #000; padding: 8px 14px; font-size: 12pt;
  }
  table.header td.label {
    background: #f0f0f0; width: 14%;
    font-weight: 700; text-align: center;
  }
  .section-title {
    font-size: 13pt; font-weight: 700; margin: 14px 0 6px 0;
  }
  .section-content {
    padding-left: 24px; line-height: 1.8;
  }
  .subject {
    font-size: 13pt; font-weight: 600;
  }
  .text-content {
    white-space: pre-wrap; word-wrap: break-word;
  }
  .field-row {
    display: flex; gap: 12px; margin-bottom: 6px; align-items: flex-start;
  }
  .field-label {
    flex-shrink: 0; min-width: 90px; font-weight: 700; color: #333;
  }
  .field-value {
    flex: 1; white-space: pre-wrap; word-wrap: break-word;
  }
  table.data {
    width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 11pt;
  }
  table.data th, table.data td {
    border: 1px solid #999; padding: 5px 8px;
  }
  table.data th {
    background: #eef4f7; font-weight: 600; text-align: center;
  }
  table.data tfoot td {
    font-weight: 700; background: #fafafa;
  }
  .ending {
    margin-top: 22px; font-size: 13pt; font-weight: 700;
  }
  .sign-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 12px; margin-top: 22px;
  }
  .sign-cell {
    border: 1.5px solid #000; min-height: 110px;
    display: flex; flex-direction: column;
  }
  .sign-cell .sign-header {
    background: #f0f0f0; border-bottom: 1px solid #000;
    padding: 4px 8px; font-size: 11pt; font-weight: 700; text-align: center;
  }
  .sign-cell .sign-target {
    background: #fafafa; padding: 3px 6px; font-size: 10pt;
    color: #555; text-align: center; border-bottom: 1px dashed #999;
  }
  .sign-cell .sign-stamp {
    flex: 1; padding: 12px 6px; font-size: 11pt; text-align: center;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
  }
  .sign-cell .approved { color: #0a6b2e; font-weight: 700; }
  .sign-cell .rejected { color: #b91c1c; font-weight: 700; }
  .sign-cell .cancelled { color: #888; font-weight: 700; }
  .sign-cell .pending { color: #888; }
  .sign-cell .date { font-size: 10pt; color: #555; margin-top: 2px; }
  .sign-cell .reason { font-size: 9.5pt; color: #b91c1c; margin-top: 4px; padding: 0 4px; }
  .sign-cell.approved { background: rgba(34,197,94,0.05); }
  .sign-cell.rejected { background: rgba(239,68,68,0.05); }
  .footer {
    margin-top: 26px; padding-top: 8px; border-top: 1px solid #888;
    display: flex; justify-content: space-between; font-size: 9pt; color: #555;
  }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button class="primary" onclick="window.print()">🖨 列印 / 另存 PDF</button>
    <button onclick="window.close()">關閉</button>
    <span style="color:#666;font-size:10pt;margin-left:auto">提示：列印對話框可選「另存為 PDF」</span>
  </div>

  <div class="header-row">
    ${logoUrl ? `<img class="logo" src="${safe(logoUrl)}" alt="logo" onerror="this.style.display='none'" />` : '<div class="logo"></div>'}
    <div class="title-area">
      <div class="company-name">${safe(companyName || '　　　　')} 簽呈</div>
      <div class="doc-meta">${safe(docTitle || '')}${docNo ? `　|　文件編號 #${safe(String(docNo))}` : ''}${status ? `　|　狀態：${safe(status)}` : ''}</div>
    </div>
    <div style="width:64px"></div>
  </div>

  <table class="header">
    <tr>
      <td class="label">呈文單位</td><td>${safe(appDept)}</td>
      <td class="label">呈文者</td><td>${safe(appName)}</td>
    </tr>
    <tr>
      <td class="label">呈文日期</td><td>${safe(date || '—')}</td>
      <td class="label">副本</td><td>${safe(ccText || '—')}</td>
    </tr>
  </table>

  <div class="section-title">一、主旨</div>
  <div class="section-content">
    <div class="subject">${safe(subject || '—')}</div>
  </div>

  ${sectionsHtml}

  <div class="ending">以上，呈請核示。</div>

  <div class="sign-row">${signCellsHtml}</div>

  <div class="footer">
    <div>產製日期：${new Date().toLocaleString('zh-TW')}</div>
    <div>SME Ops System · 表單系統</div>
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

const NUM_LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

function renderSection(sec, idx) {
  const numLabel = NUM_LABELS[idx - 1] || `第${idx}`
  const titleHtml = `<div class="section-title">${numLabel}、${safe(sec.title || '')}</div>`

  if (sec.text != null) {
    return `${titleHtml}<div class="section-content"><div class="text-content">${safe(sec.text) || '<span style="color:#888">—</span>'}</div></div>`
  }
  if (Array.isArray(sec.rows) && sec.rows.length > 0) {
    const rowsHtml = sec.rows
      .filter(r => r && r.length >= 2 && r[1] != null && r[1] !== '')
      .map(([label, value]) => `<div class="field-row"><span class="field-label">${safe(label)}：</span><span class="field-value">${safe(value)}</span></div>`)
      .join('')
    return `${titleHtml}<div class="section-content">${rowsHtml || '<div style="color:#888">—</div>'}</div>`
  }
  if (sec.table) {
    const { head = [], body = [], foot = [] } = sec.table
    const headHtml = head.length > 0 ? `<thead><tr>${head.map(h => `<th>${safe(h)}</th>`).join('')}</tr></thead>` : ''
    const bodyHtml = `<tbody>${body.map(row => `<tr>${row.map(cell => `<td>${safe(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
    const footHtml = foot.length > 0 ? `<tfoot>${foot.map(row => `<tr>${row.map(cell => `<td>${safe(cell)}</td>`).join('')}</tr>`).join('')}</tfoot>` : ''
    return `${titleHtml}<div class="section-content"><table class="data">${headHtml}${bodyHtml}${footHtml}</table></div>`
  }
  return ''
}

function renderSignCells({ status, rejectReason, chainSteps, approverMap, finalApprover, simpleSign }) {
  // 沒有 chainSteps → 靜態 3 格（無核章邏輯）
  if (!chainSteps || chainSteps.length === 0) {
    return simpleSign.map(label => `
      <div class="sign-cell">
        <div class="sign-header">${safe(label)}</div>
        <div class="sign-target">　</div>
        <div class="sign-stamp"><div class="pending">　</div></div>
      </div>
    `).join('')
  }

  // 有 chainSteps → 智慧渲染
  return chainSteps.map((step, idx) => {
    const stepLabel = step.label || step.role_name || `第 ${idx + 1} 關`
    const stepTarget = step.target_emp_id ? approverMap[step.target_emp_id] : (step.role_name || '')

    let cellContent = ''
    let cellStatus = ''

    if (status === '已核准' || status === '已核銷') {
      if (idx === chainSteps.length - 1 && finalApprover?.name) {
        cellContent = `<div class="approved">✓ ${safe(finalApprover.name)}</div>` +
                      (finalApprover.approved_at ? `<div class="date">${safe(fmtDate(finalApprover.approved_at))}</div>` : '')
      } else {
        cellContent = `<div class="approved">✓ 核可</div>`
      }
      cellStatus = 'approved'
    } else if (status === '已駁回' || status === '已拒絕' || status === '已退回') {
      cellContent = idx === 0
        ? `<div class="rejected">✗ 駁回</div>${rejectReason ? `<div class="reason">${safe(rejectReason)}</div>` : ''}`
        : `<div class="pending">—</div>`
      cellStatus = idx === 0 ? 'rejected' : 'pending'
    } else if (status === '已取消') {
      cellContent = `<div class="cancelled">已取消</div>`
      cellStatus = 'cancelled'
    } else {
      cellContent = `<div class="pending">⏸ 等候中</div>`
      cellStatus = 'pending'
    }

    return `
      <div class="sign-cell ${cellStatus}">
        <div class="sign-header">${safe(stepLabel)}</div>
        <div class="sign-target">${safe(stepTarget || '—')}</div>
        <div class="sign-stamp">${cellContent}</div>
      </div>`
  }).join('')
}

function fmtDate(s) {
  if (!s) return ''
  const d = typeof s === 'string' ? s.slice(0, 10) : new Date(s).toISOString().slice(0, 10)
  return d.replace(/-/g, '/')
}
