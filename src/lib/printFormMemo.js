/**
 * 表單簽呈列印 — 自訂表單（form_submissions + form_templates）adapter
 *
 * 把 submission + template 映射成通用簽呈格式，丟給 printSignOff。
 * 所有版面細節（簽核欄、樣式、列印）都在 printSignOff 那邊。
 */

import { printSignOff } from './printSignOff'

/**
 * @param submission   form_submissions row（含 data, status, applicant, approver, created_at, reject_reason, approved_at）
 * @param template     form_templates row（含 name, fields）
 * @param applicant    申請人 employee row（name, name_en, dept, store…）
 * @param companyName  公司名稱
 * @param logoUrl      公司 LOGO URL（可省）
 * @param chainSteps   approval_chain_steps array
 * @param approverMap  { emp_id: emp_name }
 */
export function printFormMemo({
  submission,
  template,
  applicant,
  companyName = '本公司',
  logoUrl = '',
  chainSteps = [],
  approverMap = {},
}) {
  const fields = template?.fields || []

  // 把 type=file 的欄位抽出來當附件，其餘做成說明 rows
  const attachments = []
  const fieldRows = []
  for (const f of fields) {
    const v = submission?.data?.[f.key]
    if (f.type === 'file' || f.type === 'image' || f.type === 'attachment') {
      // 可能是單一 URL 或陣列
      const urls = Array.isArray(v) ? v : (v ? [v] : [])
      for (const url of urls) {
        if (typeof url === 'string' && url) {
          const name = url.split('?')[0].split('/').pop() || f.label || '附件'
          attachments.push({ url, name })
        } else if (url && typeof url === 'object' && url.url) {
          attachments.push(url)
        }
      }
    } else {
      fieldRows.push([f.label, fmtFieldValue(v, f)])
    }
  }

  printSignOff({
    companyName,
    logoUrl,
    docTitle: template?.name || '表單',
    docNo: submission?.id,
    applicant,
    date: fmtDate(submission?.created_at),
    subject: template?.name || '—',
    sections: [
      { title: '說明', rows: fieldRows },
    ],
    status: submission?.status || '申請中',
    rejectReason: submission?.reject_reason || '',
    chainSteps,
    approverMap,
    finalApprover: submission?.approver
      ? { name: submission.approver.name || submission.approver_name || '', approved_at: submission.approved_at }
      : undefined,
    attachments,
  })
}

function fmtFieldValue(v, field) {
  if (v == null || v === '') return '—'
  if (field?.type === 'checkbox') return v ? '是' : '否'
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

function fmtDate(s) {
  if (!s) return ''
  return s.slice(0, 10).replace(/-/g, '/')
}
