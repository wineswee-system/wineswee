/**
 * 表單簽呈列印（HTML 列印版）
 *
 * 把 form_submissions + 對應 template + chain steps 渲染成公司簽呈格式：
 *   - Header: 公司名 + 簽呈
 *   - 表頭：呈文單位 / 呈文者 / 呈文日期 / 副本
 *   - 一、主旨 (template.name)
 *   - 二、說明 (form data 條列)
 *   - 以上，呈請核示
 *   - 簽核欄（鏈步驟 + 蓋章區）
 */

function safe(s) {
  if (s == null) return ''
  return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
}

function fmtDate(s) {
  if (!s) return ''
  return s.slice(0, 10).replace(/-/g, '/')
}

function fmtFieldValue(v, field) {
  if (v == null || v === '') return '—'
  if (field?.type === 'checkbox') return v ? '是' : '否'
  if (field?.type === 'date') return v
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

/**
 * @param submission   - form_submissions row（含 data, status, applicant, approver, created_at, reject_reason）
 * @param template     - form_templates row（含 name, fields, category）
 * @param applicant    - 申請人 employee row（name, name_en, dept, position, store）
 * @param companyName  - 公司名稱（如「威耀時代股份有限公司」）
 * @param chainSteps   - approval_chain_steps array（含 step_order, label, role_name, target_emp_id）
 * @param approverMap  - { emp_id: emp_name } 對應簽核人姓名（可選）
 */
export function printFormMemo({ submission, template, applicant, companyName = '本公司', chainSteps = [], approverMap = {} }) {
  const appDept = applicant?.store || applicant?.dept || applicant?.departments?.name || applicant?.stores?.name || '—'
  const appName = `${applicant?.name || ''}${applicant?.name_en ? ` (${applicant.name_en})` : ''}`
  const submitDate = fmtDate(submission?.created_at)
  const status = submission?.status || '申請中'

  // 副本：列出簽核鏈中所有指定簽核人姓名（去重）
  const ccNames = [...new Set(
    (chainSteps || [])
      .map(s => s.target_emp_id ? approverMap[s.target_emp_id] : (s.role_name || s.label || ''))
      .filter(Boolean)
  )].join('、')

  // 表單欄位條列
  const fieldsHtml = (template?.fields || [])
    .map(f => {
      const v = fmtFieldValue(submission?.data?.[f.key], f)
      return `<div class="field-row"><span class="field-label">${safe(f.label)}：</span><span class="field-value">${safe(v)}</span></div>`
    })
    .join('')

  // 簽核欄：依 chainSteps 排序，每個 step 一個格子
  // status logic：
  //   - 已核准 → 全部 step 視為已通過（顯示 approver name + 日）
  //   - 已駁回 → 顯示在哪一關被駁回（簡化版：顯示 reject_reason）
  //   - 申請中 → 所有 step 顯示等候中
  const stepsHtml = (chainSteps && chainSteps.length > 0)
    ? chainSteps.map((step, idx) => {
        const stepLabel = step.label || step.role_name || `第 ${idx + 1} 關`
        const stepTarget = step.target_emp_id ? approverMap[step.target_emp_id] : (step.role_name || '')
        let cellContent = ''
        let cellStatus = ''
        if (status === '已核准') {
          // 簡化：把 approver 寫在最後一關（其他關以「已核」帶過）
          if (idx === chainSteps.length - 1 && submission?.approver) {
            cellContent = `<div class="approved">✓ ${safe(submission.approver.name || submission.approver_name || '')}</div><div class="date">${fmtDate(submission.approved_at)}</div>`
          } else {
            cellContent = `<div class="approved">✓ 核可</div>`
          }
          cellStatus = 'approved'
        } else if (status === '已駁回') {
          cellContent = idx === 0 ? `<div class="rejected">✗ 駁回</div><div class="reason">${safe(submission.reject_reason || '')}</div>` : `<div class="pending">—</div>`
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
    : '<div class="no-chain">本表單未設定簽核鏈，請手動簽章</div>'

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>${safe(companyName)} 簽呈 — ${safe(template?.name || '表單')}</title>
<style>
  @page { size: A4 portrait; margin: 1.8cm; }
  @media print { .no-print { display: none !important; } body { padding: 0; } }
  body {
    font-family: "Microsoft JhengHei", "PMingLiU", sans-serif;
    color: #000;
    font-size: 12pt;
    line-height: 1.7;
    padding: 24px 32px;
    max-width: 18cm;
    margin: 0 auto;
  }
  .toolbar {
    background: #f0f4f8;
    border: 1px solid #ccc;
    padding: 12px 16px;
    margin-bottom: 18px;
    border-radius: 6px;
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .toolbar button {
    padding: 6px 14px;
    font-size: 12pt;
    cursor: pointer;
    border-radius: 4px;
    border: 1px solid #888;
    background: #fff;
  }
  .toolbar button.primary {
    background: #0b5cad;
    color: white;
    border-color: #0b5cad;
  }
  h1 {
    font-size: 22pt;
    text-align: center;
    margin: 0 0 18px 0;
    font-weight: 700;
    letter-spacing: 4px;
  }
  table.header {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 18px;
    border: 2px solid #000;
  }
  table.header td {
    border: 1px solid #000;
    padding: 8px 14px;
    font-size: 12pt;
  }
  table.header td.label {
    background: #f0f0f0;
    width: 14%;
    font-weight: 700;
    text-align: center;
  }
  .section-title {
    font-size: 13pt;
    font-weight: 700;
    margin: 16px 0 8px 0;
  }
  .section-content {
    padding-left: 24px;
    line-height: 1.8;
  }
  .subject {
    font-size: 13pt;
    font-weight: 600;
  }
  .field-row {
    display: flex;
    gap: 12px;
    margin-bottom: 8px;
    align-items: flex-start;
  }
  .field-label {
    flex-shrink: 0;
    min-width: 80px;
    font-weight: 700;
    color: #333;
  }
  .field-value {
    flex: 1;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .ending {
    margin-top: 24px;
    font-size: 13pt;
    font-weight: 700;
    text-align: left;
  }
  .sign-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 12px;
    margin-top: 24px;
  }
  .sign-cell {
    border: 1.5px solid #000;
    min-height: 110px;
    display: flex;
    flex-direction: column;
  }
  .sign-cell .sign-header {
    background: #f0f0f0;
    border-bottom: 1px solid #000;
    padding: 4px 8px;
    font-size: 11pt;
    font-weight: 700;
    text-align: center;
  }
  .sign-cell .sign-target {
    background: #fafafa;
    padding: 3px 6px;
    font-size: 10pt;
    color: #555;
    text-align: center;
    border-bottom: 1px dashed #999;
  }
  .sign-cell .sign-stamp {
    flex: 1;
    padding: 12px 6px;
    font-size: 11pt;
    text-align: center;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
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
    margin-top: 28px;
    padding-top: 8px;
    border-top: 1px solid #888;
    display: flex;
    justify-content: space-between;
    font-size: 9pt;
    color: #555;
  }
  .no-chain {
    padding: 20px;
    text-align: center;
    color: #888;
    border: 1.5px dashed #ccc;
    margin-top: 24px;
  }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button class="primary" onclick="window.print()">🖨 列印 / 另存 PDF</button>
    <button onclick="window.close()">關閉</button>
    <span style="color:#666;font-size:10pt;margin-left:auto">提示：列印對話框可選「另存為 PDF」</span>
  </div>

  <h1>${safe(companyName)} 簽呈</h1>

  <table class="header">
    <tr>
      <td class="label">呈文單位</td>
      <td>${safe(appDept)}</td>
      <td class="label">呈文者</td>
      <td>${safe(appName)}</td>
    </tr>
    <tr>
      <td class="label">呈文日期</td>
      <td>${safe(submitDate)}</td>
      <td class="label">副本</td>
      <td>${safe(ccNames || '—')}</td>
    </tr>
  </table>

  <div class="section-title">一、主旨</div>
  <div class="section-content">
    <div class="subject">${safe(template?.name || '—')}</div>
  </div>

  <div class="section-title">二、說明</div>
  <div class="section-content">
    ${fieldsHtml || '<div style="color:#888">（無填寫內容）</div>'}
  </div>

  <div class="ending">以上，呈請核示。</div>

  <div class="sign-row">
    ${stepsHtml}
  </div>

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
