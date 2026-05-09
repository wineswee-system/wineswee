/**
 * 各 HR 表單 → 簽呈 PDF adapters
 *
 * 每個 export 都收 (row, opts) 然後丟給 printSignOff。
 * opts 至少要 { companyName, logoUrl }；可選 chainSteps / approverMap / approverName。
 *
 * 新增表單只要在這裡多加 10 行 mapping，不用碰 printSignOff 本體。
 */

import { printSignOff } from './printSignOff'

// ─── 共用 helpers ───
const fmtDate = (s) => s ? String(s).slice(0, 10).replace(/-/g, '/') : ''
const fmtMoney = (n) => n != null ? `NT$ ${Number(n).toLocaleString()}` : ''
const baseOpts = (opts = {}) => ({
  companyName: opts.companyName || '',
  logoUrl: opts.logoUrl || '',
  chainSteps: opts.chainSteps || [],
  approverMap: opts.approverMap || {},
  // 任何 caller 可以直接傳 attachments 進來；adapter 也可以再合併自己從 row 抽出來的
  attachments: opts.attachments || [],
  // 簽章圖 map：{ '簽核人姓名': 'url' }
  signatures: opts.signatures || {},
  // 預先開好的 window（避免 popup blocker），由 caller 在 click handler 同步開
  _win: opts._win,
})

// 把單一 attachment_url（TEXT 欄位）轉成標準陣列格式
const singleUrlToAtt = (url) => {
  if (!url) return []
  const name = String(url).split('?')[0].split('/').pop() || '附件'
  return [{ url, name }]
}

// 把 leave_requests.attachments（jsonb 陣列，元素可能是字串或 {url,name}）標準化
const normalizeAttList = (arr) => {
  if (!Array.isArray(arr)) return []
  return arr.map((it, i) => {
    if (typeof it === 'string') {
      const name = it.split('?')[0].split('/').pop() || `附件 ${i + 1}`
      return { url: it, name }
    }
    return it
  }).filter(a => a?.url)
}

// ─── 1. 請假申請 leave_requests ───
export function printLeaveSignOff(row, opts = {}) {
  if (!row) return
  const period = row.start_date === row.end_date || !row.end_date
    ? fmtDate(row.start_date) + (row.start_time ? ` ${row.start_time}~${row.end_time || ''}` : '')
    : `${fmtDate(row.start_date)} ~ ${fmtDate(row.end_date)}`
  const duration = row.hours && row.hours < 8
    ? `${row.hours} 小時`
    : `${row.days || 0} 天`

  const base = baseOpts(opts)
  const rowAtts = normalizeAttList(row.attachments)
  const attachments = [...base.attachments, ...rowAtts]

  printSignOff({
    ...base,
    attachments,
    docTitle: '請假申請',
    docNo: row.id,
    applicant: { name: row.employee, dept: opts.dept || '' },
    date: fmtDate(row.created_at) || fmtDate(row.start_date),
    subject: `${row.type || '請假'} 申請（${duration}）`,
    sections: [{
      title: '說明',
      rows: [
        ['假別', row.type || ''],
        ['期間', period],
        ['天/時數', duration],
        ['事由', row.reason || ''],
      ],
    }],
    status: row.status || '',
    rejectReason: row.reject_reason || '',
    finalApprover: row.approver && row.approver !== '-'
      ? { name: row.approver, approved_at: row.approved_at }
      : undefined,
    simpleSign: ['呈文者', '直屬主管', '人資核章'],
    simpleSignApproverIdx: 1,  // 中間「直屬主管」是實際核可者
  })
}

// ─── 2. 加班申請 overtime_requests ───
export function printOvertimeSignOff(row, opts = {}) {
  if (!row) return
  printSignOff({
    ...baseOpts(opts),
    docTitle: row.is_pre_approval ? '預先加班申請' : '加班補登申請',
    docNo: row.id,
    applicant: { name: row.employee, dept: opts.dept || '' },
    date: fmtDate(row.created_at) || fmtDate(row.date),
    subject: `${fmtDate(row.date)} 加班 ${row.hours || 0} 小時`,
    sections: [{
      title: '說明',
      rows: [
        ['加班類型', row.is_pre_approval ? '預先申請' : '事後補登'],
        ['加班日期', fmtDate(row.date)],
        ['時數', `${row.hours || 0} 小時`],
        ['事由', row.reason || ''],
      ],
    }],
    status: row.status || '',
    rejectReason: row.reject_reason || '',
    finalApprover: row.approver
      ? { name: row.approver, approved_at: row.approved_at }
      : undefined,
    simpleSign: ['呈文者', '直屬主管', '人資核章'],
    simpleSignApproverIdx: 1,  // 中間「直屬主管」是實際核可者
  })
}

// ─── 3. 出差申請 business_trips ───
export function printTripSignOff(row, opts = {}) {
  if (!row) return
  const period = row.start_date === row.end_date || !row.end_date
    ? fmtDate(row.start_date)
    : `${fmtDate(row.start_date)} ~ ${fmtDate(row.end_date)}`
  printSignOff({
    ...baseOpts(opts),
    docTitle: '出差申請',
    docNo: row.id,
    applicant: { name: row.employee, dept: opts.dept || '' },
    date: fmtDate(row.created_at) || fmtDate(row.start_date),
    subject: `${row.destination || '出差'}（${period}）`,
    sections: [{
      title: '說明',
      rows: [
        ['出差地點', row.destination || ''],
        ['期間', period],
        ['預估費用', fmtMoney(row.budget)],
        ['出差目的', row.purpose || ''],
      ],
    }],
    status: row.status || '',
    rejectReason: row.reject_reason || '',
    finalApprover: row.approver
      ? { name: row.approver, approved_at: row.approved_at }
      : undefined,
    simpleSign: ['呈文者', '直屬主管', '人資/財務'],
    simpleSignApproverIdx: 1,
  })
}

// ─── 4. 費用報銷 expenses（單階段，跟 expense_requests 兩階段不同）───
export function printExpenseSimpleSignOff(row, opts = {}) {
  if (!row) return
  printSignOff({
    ...baseOpts(opts),
    docTitle: '費用報銷',
    docNo: row.id,
    applicant: { name: row.employee, dept: opts.dept || '' },
    date: fmtDate(row.created_at) || fmtDate(row.date),
    subject: `${row.category || '費用'} ${fmtMoney(row.amount)}`,
    sections: [{
      title: '說明',
      rows: [
        ['費用類別', row.category || ''],
        ['發生日期', fmtDate(row.date)],
        ['金額', fmtMoney(row.amount)],
        ['是否有收據', row.receipt ? '有' : '無'],
        ['用途', row.description || ''],
      ],
    }],
    status: row.status || '',
    rejectReason: row.reject_reason || '',
    finalApprover: row.approver
      ? { name: row.approver, approved_at: row.approved_at }
      : undefined,
    simpleSign: ['呈文者', '直屬主管', '財務核章'],
    simpleSignApproverIdx: 1,
  })
}

// ─── 5. 補打卡 clock_corrections ───
//   type 'clock_in'/'clock_out'（LIFF 老資料可能還有 '上班打卡'/'下班打卡' 中文值）
//   correction_time、approver
export function printClockCorrectionSignOff(row, opts = {}) {
  if (!row) return
  const typeRaw = row.type || ''
  const typeLabel = (typeRaw === 'clock_in' || typeRaw === '上班打卡') ? '上班打卡'
                  : (typeRaw === 'clock_out' || typeRaw === '下班打卡') ? '下班打卡'
                  : typeRaw
  const time = row.correction_time || ''
  const approverName = row.approver?.name || row.approver || ''

  printSignOff({
    ...baseOpts(opts),
    docTitle: '補打卡申請',
    docNo: row.id,
    applicant: { name: row.employee, dept: opts.dept || '' },
    date: fmtDate(row.created_at) || fmtDate(row.date),
    subject: `${fmtDate(row.date)} ${typeLabel} ${time}`,
    sections: [{
      title: '說明',
      rows: [
        ['日期', fmtDate(row.date)],
        ['打卡類型', typeLabel],
        ['補登時間', time],
        ['原因', row.reason || ''],
      ],
    }],
    status: row.status || '',
    rejectReason: row.reject_reason || '',
    finalApprover: approverName
      ? { name: approverName, approved_at: row.approved_at }
      : undefined,
    simpleSign: ['呈文者', '直屬主管', '人資核章'],
    simpleSignApproverIdx: 1,  // 中間「直屬主管」是實際核可者
  })
}

// ─── 6. 離職申請 resignation_requests ───
// row 預期已 join employee:employees(id,name,name_en,position) + approver:employees!approver_id(name)
export function printResignationSignOff(row, opts = {}) {
  if (!row) return
  const base = baseOpts(opts)
  const attachments = [...base.attachments, ...singleUrlToAtt(row.attachment_url)]

  printSignOff({
    ...base,
    attachments,
    docTitle: '離職申請',
    docNo: row.id,
    applicant: {
      name: row.employee?.name || '',
      name_en: row.employee?.name_en,
      dept: opts.dept || row.employee?.position || '',
    },
    date: fmtDate(row.created_at),
    subject: `離職申請（預計 ${fmtDate(row.planned_resign_date)} 離職）`,
    sections: [
      {
        title: '說明',
        rows: [
          ['預計離職日', fmtDate(row.planned_resign_date)],
          ['離職原因', row.reason || ''],
          ['原因說明', row.reason_detail || ''],
        ],
      },
      ...(row.handover_notes ? [{
        title: '交接事項',
        text: row.handover_notes,
      }] : []),
    ],
    status: row.status || '',
    rejectReason: row.reject_reason || '',
    finalApprover: row.approver
      ? {
          name: row.approver.name || row.approver,
          signature_url: row.approver.signature_url,
          approved_at: row.approved_at,
        }
      : undefined,
    simpleSign: ['呈文者', '直屬主管', '人資核章'],
    simpleSignApproverIdx: 1,  // 中間「直屬主管」是實際核可者
  })
}

// ─── 7. 人事異動 personnel_transfer_requests ───
// row 預期已 join employee:employees(...) + approver + departments / stores 對照
export function printTransferSignOff(row, opts = {}) {
  if (!row) return
  // 兼容兩種 row shape：(a) 已 join old_dept/new_dept/old_store/new_store 物件
  //                       (b) 純 FK id + opts.deptMap / storeMap 對照
  const resolveName = (joined, mapVal, fkVal) => joined?.name || mapVal?.[fkVal] || (typeof fkVal === 'string' ? fkVal : '')
  const oldDept  = resolveName(row.old_dept,  opts.deptMap,  row.old_department_id  ?? row.old_department)
  const newDept  = resolveName(row.new_dept,  opts.deptMap,  row.new_department_id  ?? row.new_department)
  const oldStore = resolveName(row.old_store, opts.storeMap, row.old_store_id       ?? row.old_store)
  const newStore = resolveName(row.new_store, opts.storeMap, row.new_store_id       ?? row.new_store)

  const changeRows = []
  if (oldDept !== newDept || newDept) changeRows.push(['部門', `${oldDept || '—'}  →  ${newDept || '—'}`])
  if (oldStore !== newStore || newStore) changeRows.push(['門市', `${oldStore || '—'}  →  ${newStore || '—'}`])
  if (row.new_position) changeRows.push(['職務', `${row.old_position || '—'}  →  ${row.new_position || '—'}`])
  if (row.new_role) changeRows.push(['角色', `${row.old_role || '—'}  →  ${row.new_role || '—'}`])
  if (row.new_base_salary != null) changeRows.push(['底薪', `${fmtMoney(row.old_base_salary)}  →  ${fmtMoney(row.new_base_salary)}`])

  const base = baseOpts(opts)
  const attachments = [...base.attachments, ...singleUrlToAtt(row.attachment_url)]

  printSignOff({
    ...base,
    attachments,
    docTitle: '人事異動申請',
    docNo: row.id,
    applicant: {
      name: row.employee?.name || '',
      name_en: row.employee?.name_en,
      dept: oldDept || row.employee?.position || '',
    },
    date: fmtDate(row.created_at),
    subject: `${row.transfer_type || '異動'}（生效日 ${fmtDate(row.effective_date)}）`,
    sections: [
      {
        title: '異動內容',
        rows: [
          ['異動類型', row.transfer_type || ''],
          ['生效日期', fmtDate(row.effective_date)],
          ...changeRows,
        ],
      },
      ...(row.reason ? [{ title: '異動原因', text: row.reason }] : []),
    ],
    status: row.status || '',
    rejectReason: row.reject_reason || '',
    finalApprover: row.approver
      ? {
          name: row.approver.name || row.approver,
          signature_url: row.approver.signature_url,
          approved_at: row.approved_at,
        }
      : undefined,
    simpleSign: ['呈文者', '直屬主管', '人資核章'],
    simpleSignApproverIdx: 1,  // 中間「直屬主管」是實際核可者
  })
}
