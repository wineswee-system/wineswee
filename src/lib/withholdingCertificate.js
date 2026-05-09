import { toast } from './toast'
/**
 * 各類所得扣繳暨免扣繳憑單 — HTML 列印版
 *
 * 開新視窗渲染後 user 可：
 *   1. 直接 Ctrl+P 列印給員工
 *   2. 列印對話框選「另存為 PDF」
 *
 * 三種格式（依稅務署分類）：
 *   50 — 薪資所得（最常用，員工年度薪資+扣繳稅額）
 *   52 — 利息／股利／其他所得
 *   54 — 執行業務所得（律師、會計師、設計師等個人勞務）
 */

const FORMAT_TITLES = {
  '50': '各類所得扣繳暨免扣繳憑單（50 號 — 薪資所得）',
  '52': '各類所得扣繳暨免扣繳憑單（52 號 — 其他所得）',
  '54': '各類所得扣繳暨免扣繳憑單（54 號 — 執行業務所得）',
}

const INCOME_CATEGORY_LABELS = {
  '50': '薪資',
  '52': '其他所得',
  '54': '執行業務所得',
}

const FORMAT_CODE = {
  '50': '50M',  // 在職期間（每月給付）
  '52': '52',
  '54': '9A',
}

function fmt(n) {
  return Number(n || 0).toLocaleString('zh-TW')
}

function safe(s) {
  if (s == null) return ''
  return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
}

/**
 * 開新視窗列印單一張扣繳憑單
 *
 * @param {Object} record  — 扣繳記錄（從 tax_withholding_records 或 v_payroll_summary_monthly 加總）
 * @param {Object} employee — 員工資料 (id, name, id_number, address)
 * @param {Object} company  — 扣繳單位 (name, tax_id, address, withholder_name, withholder_id)
 * @param {String} format   — '50' | '52' | '54'
 */
export function printWithholdingCertificate({ record, employee, company, format = '50' }) {
  const title = FORMAT_TITLES[format] || FORMAT_TITLES['50']
  const categoryLabel = INCOME_CATEGORY_LABELS[format] || '薪資'
  const formatCode = FORMAT_CODE[format] || '50M'

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>${safe(title)} — ${safe(employee?.name || '')} ${record?.year || ''}</title>
<style>
  @page { size: A4 portrait; margin: 1.2cm; }
  @media print {
    .no-print { display: none !important; }
    body { padding: 0; }
  }
  body {
    font-family: "Microsoft JhengHei", "PMingLiU", sans-serif;
    color: #111;
    font-size: 11pt;
    line-height: 1.5;
    padding: 20px;
    max-width: 19cm;
    margin: 0 auto;
  }
  .toolbar {
    background: #f0f4f8;
    border: 1px solid #ccc;
    padding: 12px 16px;
    margin-bottom: 16px;
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
    font-size: 16pt;
    margin: 0 0 4px 0;
    text-align: center;
    border-bottom: 2px solid #000;
    padding-bottom: 6px;
  }
  .subtitle {
    text-align: center;
    font-size: 10pt;
    margin-bottom: 12px;
    color: #555;
  }
  .year-box {
    text-align: center;
    margin-bottom: 12px;
    font-size: 13pt;
    font-weight: 700;
  }
  .section {
    border: 1.5px solid #000;
    margin-bottom: 8px;
  }
  .section-title {
    background: #d0e0f0;
    padding: 4px 10px;
    font-weight: 700;
    border-bottom: 1px solid #000;
    font-size: 11pt;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5pt;
  }
  td, th {
    border: 1px solid #888;
    padding: 6px 10px;
    vertical-align: middle;
  }
  td.label {
    background: #f4f8fc;
    font-weight: 600;
    width: 28%;
    text-align: right;
  }
  td.value {
    background: #fff;
  }
  td.value-right {
    background: #fff;
    text-align: right;
    font-family: Consolas, monospace;
  }
  td.label-narrow {
    background: #f4f8fc;
    font-weight: 600;
    width: 18%;
    text-align: right;
  }
  .footer {
    margin-top: 20px;
    padding-top: 10px;
    border-top: 1px solid #888;
    display: flex;
    justify-content: space-between;
    font-size: 9pt;
    color: #555;
  }
  .signature-row {
    display: flex;
    justify-content: space-between;
    margin-top: 30px;
    padding-top: 20px;
  }
  .sig-box {
    width: 30%;
    text-align: center;
    border-top: 1px solid #000;
    padding-top: 4px;
    font-size: 10pt;
  }
  .note {
    background: #fffbe6;
    border: 1px dashed #d4a017;
    padding: 6px 10px;
    margin-top: 12px;
    font-size: 9pt;
    color: #555;
  }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button class="primary" onclick="window.print()">🖨 列印 / 另存 PDF</button>
    <button onclick="window.close()">關閉</button>
    <span style="color:#666;font-size:10pt;margin-left:auto">提示：列印對話框可選「另存為 PDF」</span>
  </div>

  <h1>${safe(title)}</h1>
  <p class="subtitle">Withholding Tax Statement — Republic of China</p>
  <div class="year-box">中華民國 ${(record?.year || new Date().getFullYear()) - 1911} 年度（${safe(record?.year || '')}）</div>

  <!-- 扣繳單位 -->
  <div class="section">
    <div class="section-title">壹、扣繳單位</div>
    <table>
      <tr>
        <td class="label">扣繳單位統一編號</td>
        <td class="value">${safe(company?.tax_id || '')}</td>
        <td class="label-narrow">名稱</td>
        <td class="value">${safe(company?.name || '')}</td>
      </tr>
      <tr>
        <td class="label">扣繳單位地址</td>
        <td class="value" colspan="3">${safe(company?.address || '')}</td>
      </tr>
      <tr>
        <td class="label">扣繳義務人</td>
        <td class="value">${safe(company?.withholder_name || '')}</td>
        <td class="label-narrow">身分證字號</td>
        <td class="value">${safe(company?.withholder_id || '')}</td>
      </tr>
    </table>
  </div>

  <!-- 所得人 -->
  <div class="section">
    <div class="section-title">貳、所得人</div>
    <table>
      <tr>
        <td class="label">所得人姓名</td>
        <td class="value">${safe(employee?.name || '')}</td>
        <td class="label-narrow">身分證字號</td>
        <td class="value">${safe(employee?.id_number || '')}</td>
      </tr>
      <tr>
        <td class="label">所得人地址</td>
        <td class="value" colspan="3">${safe(employee?.address || '')}</td>
      </tr>
    </table>
  </div>

  <!-- 所得資料 -->
  <div class="section">
    <div class="section-title">參、所得資料</div>
    <table>
      <tr>
        <td class="label">所得格式</td>
        <td class="value">${formatCode}（${categoryLabel}）</td>
        <td class="label-narrow">所得起迄</td>
        <td class="value">${safe(record?.year || '')}/01/01 ~ ${safe(record?.year || '')}/12/31</td>
      </tr>
      <tr>
        <td class="label">給付總額（A）</td>
        <td class="value-right" style="font-weight:700;font-size:12pt">NT$ ${fmt(record?.gross_salary)}</td>
        <td class="label-narrow">扣繳稅額（B）</td>
        <td class="value-right" style="font-weight:700;color:#b34700">NT$ ${fmt(record?.tax_withheld)}</td>
      </tr>
      ${format === '50' ? `
      <tr>
        <td class="label">勞工保險費（員工負擔）</td>
        <td class="value-right">NT$ ${fmt(record?.labor_insurance)}</td>
        <td class="label-narrow">全民健保費（員工負擔）</td>
        <td class="value-right">NT$ ${fmt(record?.health_insurance)}</td>
      </tr>
      <tr>
        <td class="label">勞工退休金（員工自提）</td>
        <td class="value-right">NT$ ${fmt(record?.pension_employee)}</td>
        <td class="label-narrow">勞工退休金（雇主提繳）</td>
        <td class="value-right">NT$ ${fmt(record?.pension_employer)}</td>
      </tr>
      <tr>
        <td class="label">二代健保補充保費</td>
        <td class="value-right">NT$ ${fmt(record?.nhi_supplementary)}</td>
        <td class="label-narrow">獎金合計</td>
        <td class="value-right">NT$ ${fmt(record?.bonus_total)}</td>
      </tr>
      ` : ''}
      <tr>
        <td class="label">所得淨額 (A − 員工自付保費等)</td>
        <td class="value-right" colspan="3" style="font-weight:700">NT$ ${fmt(record?.taxable_income)}</td>
      </tr>
    </table>
  </div>

  <!-- 簽章 -->
  <div class="signature-row">
    <div class="sig-box">扣繳單位印鑑</div>
    <div class="sig-box">扣繳義務人簽章</div>
    <div class="sig-box">所得人簽收</div>
  </div>

  <div class="note">
    <b>說明：</b>
    本憑單依《所得稅法》第 88 條及《各類所得扣繳率標準》產出。
    所得人申報綜合所得稅時，請以本憑單之給付總額及扣繳稅額為準。
    如有疑義，請洽扣繳單位人事部門。
  </div>

  <div class="footer">
    <div>產製日期：${new Date().toLocaleString('zh-TW')}</div>
    <div>系統：SME Ops System</div>
  </div>
</body>
</html>`

  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) {
    toast.error('無法開啟新視窗，請允許彈出視窗權限')
    return
  }
  w.document.write(html)
  w.document.close()
}


/**
 * 批次列印多人憑單（一張一頁）
 */
export function printBatchCertificates({ records, employees, company, format = '50' }) {
  const empMap = {}
  ;(employees || []).forEach(e => { empMap[e.name] = e })

  const pages = records.map(record => {
    const emp = empMap[record.employee] || { name: record.employee }
    const title = FORMAT_TITLES[format] || FORMAT_TITLES['50']
    const categoryLabel = INCOME_CATEGORY_LABELS[format] || '薪資'
    const formatCode = FORMAT_CODE[format] || '50M'

    return `
<div class="cert-page">
  <h1>${safe(title)}</h1>
  <div class="year-box">中華民國 ${(record?.year || new Date().getFullYear()) - 1911} 年度（${safe(record?.year || '')}）</div>
  <table class="cert-table">
    <tr><td class="label">扣繳單位</td><td colspan="3">${safe(company?.name || '')} (${safe(company?.tax_id || '')})</td></tr>
    <tr><td class="label">所得人</td><td>${safe(emp?.name || '')}</td><td class="label">身分證</td><td>${safe(emp?.id_number || '')}</td></tr>
    <tr><td class="label">所得格式</td><td>${formatCode}（${categoryLabel}）</td><td class="label">所得期間</td><td>${safe(record?.year || '')}/01/01 ~ ${safe(record?.year || '')}/12/31</td></tr>
    <tr><td class="label">給付總額</td><td class="num">NT$ ${fmt(record?.gross_salary)}</td><td class="label">扣繳稅額</td><td class="num">NT$ ${fmt(record?.tax_withheld)}</td></tr>
    ${format === '50' ? `
    <tr><td class="label">勞保(員工)</td><td class="num">NT$ ${fmt(record?.labor_insurance)}</td><td class="label">健保(員工)</td><td class="num">NT$ ${fmt(record?.health_insurance)}</td></tr>
    <tr><td class="label">勞退(員工自提)</td><td class="num">NT$ ${fmt(record?.pension_employee)}</td><td class="label">勞退(雇主提繳)</td><td class="num">NT$ ${fmt(record?.pension_employer)}</td></tr>
    <tr><td class="label">二代健保補充保費</td><td class="num">NT$ ${fmt(record?.nhi_supplementary)}</td><td class="label">獎金合計</td><td class="num">NT$ ${fmt(record?.bonus_total)}</td></tr>
    ` : ''}
    <tr><td class="label">所得淨額</td><td colspan="3" class="num"><b>NT$ ${fmt(record?.taxable_income)}</b></td></tr>
  </table>
</div>
`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>批次扣繳憑單 — ${records.length} 張 (${records[0]?.year || ''})</title>
<style>
  @page { size: A4 portrait; margin: 1.2cm; }
  body { font-family: "Microsoft JhengHei", "PMingLiU", sans-serif; color: #111; font-size: 11pt; padding: 0; margin: 0; }
  .toolbar { background: #f0f4f8; padding: 12px 16px; border-bottom: 1px solid #ccc; position: sticky; top: 0; z-index: 1000; }
  .toolbar button { padding: 6px 14px; font-size: 12pt; cursor: pointer; margin-right: 8px; border-radius: 4px; border: 1px solid #888; background: #fff; }
  .toolbar button.primary { background: #0b5cad; color: white; border-color: #0b5cad; }
  .cert-page { padding: 20px; page-break-after: always; min-height: 24cm; }
  .cert-page:last-child { page-break-after: auto; }
  h1 { font-size: 14pt; text-align: center; border-bottom: 2px solid #000; padding-bottom: 4px; margin: 0 0 8px 0; }
  .year-box { text-align: center; font-size: 12pt; font-weight: 700; margin-bottom: 8px; }
  .cert-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  .cert-table td { border: 1px solid #888; padding: 6px 10px; }
  .cert-table td.label { background: #f4f8fc; font-weight: 600; width: 22%; text-align: right; }
  .cert-table td.num { text-align: right; font-family: Consolas, monospace; }
  @media print {
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button class="primary" onclick="window.print()">🖨 列印全部 ${records.length} 張</button>
    <button onclick="window.close()">關閉</button>
    <span style="color:#666;font-size:10pt;margin-left:8px">提示：列印對話框可選「另存為 PDF」會合併成單一 PDF</span>
  </div>
  ${pages}
</body>
</html>`

  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) { toast.error('無法開啟新視窗，請允許彈出視窗權限'); return }
  w.document.write(html)
  w.document.close()
}
