// 薪資計算報表(每門市一張工作表,對齊會計薪資帳表格式)
// 資料來源:preview_payroll RPC 回傳的引擎逐人明細(與入帳同源)。
// 動態欄位:金額類欄位「該次匯出全公司都為 0」→ 自動隱藏(有值才出欄);
//          身分欄與「薪資總計 / 公司負擔」永遠顯示。
import XLSX from 'xlsx-js-style'

const NUMFMT = '#,##0'
const n = (v) => (typeof v === 'number' ? v : Number(v) || 0)

// 欄位定義:group=群組(null=身分欄);always=永遠顯示(不參與隱藏);txt=文字欄;w=欄寬
const COLS = [
  // ── 身分(永遠顯示)──
  { h: '員工編號', group: null, always: true, txt: true, w: 12, get: (p, e) => e?.employee_number || '' },
  { h: '中文姓名', group: null, always: true, txt: true, w: 9, get: (p) => p.employee || '' },
  { h: '部門', group: null, always: true, txt: true, w: 15, get: (p) => p.dept || '' },
  { h: '到職日/復職日', group: null, always: true, txt: true, w: 13, get: (p, e) => (p.join_date || e?.join_date || '') },
  { h: '計薪方式', group: null, always: true, txt: true, w: 9, get: (p) => (p._is_hourly ? '時薪' : '月薪') },
  // ── 薪資結構 ──
  { h: '基本薪資', group: '薪資結構', w: 10, get: (p) => n(p.base_salary) },
  { h: '伙食費', group: '薪資結構', w: 8, get: (p) => n(p.meal_allowance) },
  { h: '職務津貼', group: '薪資結構', w: 9, get: (p) => n(p.role_allowance) },
  { h: '夜間津貼', group: '薪資結構', w: 9, get: (p) => n(p.night_allowance) },
  { h: '跨店津貼', group: '薪資結構', w: 9, get: (p) => n(p.cross_store_allowance) },
  { h: '交通津貼', group: '薪資結構', w: 9, get: (p) => n(p.transport_allowance) },
  // ── 薪資科目加項 ──
  { h: '免稅加班費', group: '薪資科目加項', w: 12, get: (p) => n(p.regular_overtime_pay) },
  { h: '特休未休折抵費', group: '薪資科目加項', w: 15, get: (p) => n(p.unused_leave_payout) },
  { h: '額外加班費', group: '薪資科目加項', w: 11, get: (p) => n(p.extra_overtime_pay) },
  { h: '全勤獎金', group: '薪資科目加項', w: 9, get: (p) => n(p.attendance_bonus) },
  { h: '獎金', group: '薪資科目加項', w: 9, get: (p) => n(p.policyBonus) },
  { h: '補休兌現', group: '薪資科目加項', w: 10, get: (p) => n(p.comp_time_settled_pay) },
  { h: '國定加給', group: '薪資科目加項', w: 9, get: (p) => n(p.holidayBonus) },
  { h: '其他津貼', group: '薪資科目加項', w: 10, get: (p) => n(p.other_custom_total) },
  { h: '底薪', group: '薪資科目加項', w: 8, get: () => 0 },
  { h: '補發前月差額', group: '薪資科目加項', w: 12, get: (p) => n(p.back_pay_adjustment) },  // 逐筆調整:補發(有值才出欄)
  { h: '微調加項', group: '薪資科目加項', w: 10, get: (p) => n(p.manual_bonus) },            // 逐筆調整:紅包等手動加項
  { h: '微調說明', group: '薪資科目加項', txt: true, noteCol: true, w: 20, get: (p) => p._adjust_note || '' },  // 逐筆調整名目(補發/加項/扣款的自訂 label);有值才出欄
  // ── 薪資科目扣項 ──
  { h: '勞保費', group: '薪資科目扣項', w: 9, get: (p) => n(p.laborInsurance) },
  { h: '健保費', group: '薪資科目扣項', w: 9, get: (p) => n(p.healthInsurance) },
  { h: '勞退新制提繳', group: '薪資科目扣項', w: 12, get: (p) => n(p.pension) },
  { h: '請假扣款(應稅)', group: '薪資科目扣項', w: 13, get: (p) => n(p.unpaidDeduction) },
  { h: '請假扣款(免稅)', group: '薪資科目扣項', w: 13, get: (p) => n(p.halfPayDeduction) },
  { h: '法扣項目', group: '薪資科目扣項', w: 9, get: (p) => n(p.legal_deduction) },
  { h: '遲到扣款', group: '薪資科目扣項', w: 9, get: (p) => n(p.lateDeduction) },
  { h: '早退扣款', group: '薪資科目扣項', w: 9, get: (p) => n(p.earlyLeaveDeduction) },
  { h: '曠職扣款', group: '薪資科目扣項', w: 9, get: (p) => n(p.awolDeduction) },
  { h: '補充保費', group: '薪資科目扣項', w: 9, get: (p) => n(p.nhi_supplementary) },
  { h: '微調扣款', group: '薪資科目扣項', w: 10, get: (p) => n(p.manual_deduction) },        // 逐筆調整:手動扣項
  { h: '所得稅', group: '薪資科目扣項', w: 8, get: (p) => n(p.incomeTax) },
  // ── 薪資總計(永遠顯示)──
  { h: '應稅所得', group: '薪資總計', always: true, w: 10, get: (p) => Math.max(0, n(p.gross) - n(p.regular_overtime_pay) - n(p.meal_allowance) - n(p.unused_leave_payout) - n(p.unpaidDeduction)) },
  // 應稅所得:依決策不因微調變動(補發/紅包不併入課稅基礎),維持引擎值
  { h: '應發總額', group: '薪資總計', always: true, w: 10, get: (p) => n(p.gross) + n(p.back_pay_adjustment) + n(p.manual_bonus) },
  { h: '應減總額', group: '薪資總計', always: true, w: 10, get: (p) => n(p.totalDeductions) + n(p.manual_deduction) },
  { h: '實發金額', group: '薪資總計', always: true, w: 11, get: (p) => n(p.netSalary) + n(p.back_pay_adjustment) + n(p.manual_bonus) - n(p.manual_deduction) },
  // ── 公司負擔(永遠顯示)──
  { h: '勞保費', group: '公司負擔', always: true, w: 9, get: (p) => n(p.laborEmployer) },
  { h: '健保費', group: '公司負擔', always: true, w: 9, get: (p) => n(p.healthEmployer) },
  { h: '勞退新制提繳', group: '公司負擔', always: true, w: 12, get: (p) => n(p.pensionEmployer) },
]

// ── 樣式 ──
const border = { style: 'thin', color: { rgb: 'D0D0D0' } }
const allBorder = { top: border, bottom: border, left: border, right: border }
const titleStyle = { font: { bold: true, sz: 14 }, alignment: { horizontal: 'center', vertical: 'center' } }
const subTitleStyle = { font: { bold: true, sz: 12 }, alignment: { horizontal: 'center', vertical: 'center' } }
const groupHdrStyle = { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '2F5597' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: allBorder }
const colHdrStyle = { font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '444444' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: allBorder }
const cellTxt = { alignment: { horizontal: 'center', vertical: 'center' }, border: allBorder, font: { sz: 10 } }
const cellNum = { alignment: { horizontal: 'right', vertical: 'center' }, border: allBorder, font: { sz: 10 }, numFmt: NUMFMT }
const totalTxt = { font: { bold: true, sz: 10 }, alignment: { horizontal: 'center', vertical: 'center' }, fill: { patternType: 'solid', fgColor: { rgb: 'FCE4D6' } }, border: allBorder }
const totalNum = { font: { bold: true, sz: 10 }, alignment: { horizontal: 'right', vertical: 'center' }, fill: { patternType: 'solid', fgColor: { rgb: 'FCE4D6' } }, border: allBorder, numFmt: NUMFMT }

const cell = (v, s) => ({ v: v == null ? '' : v, t: typeof v === 'number' ? 'n' : 's', s })

// 依「該次匯出全部 rows」決定哪些金額欄有值 → 回傳 active 欄位陣列(所有分頁共用同一組欄位)
function activeColumns(allRows, empMap) {
  return COLS.filter(col => {
    if (col.noteCol) return allRows.some(p => (col.get(p, empMap.get(p.employee_id)) || '') !== '')  // 文字說明欄:有內容才出
    if (col.always || col.txt || col.group === null) return true
    // 金額欄:任一員工有非 0 值才保留
    return allRows.some(p => n(col.get(p, empMap.get(p.employee_id))) !== 0)
  })
}

function buildSheet(storeName, rows, empMap, company, cols) {
  const NC = cols.length
  const idCount = cols.filter(c => c.group === null).length
  const aoa = []
  // Row 0/1: 公司名 / 門市薪資表
  aoa.push([cell(company, titleStyle), ...Array(NC - 1).fill(cell('', titleStyle))])
  aoa.push([cell(`${storeName}  薪資表`, subTitleStyle), ...Array(NC - 1).fill(cell('', subTitleStyle))])
  // Row 2: 群組表頭(身分欄放欄名並跨兩列;金額群組跨欄)
  const g = cols.map((col, i) => cell(col.group === null ? col.h : '', col.group === null ? colHdrStyle : groupHdrStyle))
  // 標出每個群組的起點(第一次出現)
  const groupStart = {}
  cols.forEach((col, i) => { if (col.group && groupStart[col.group] === undefined) groupStart[col.group] = i })
  for (const [grp, i] of Object.entries(groupStart)) g[i] = cell(grp, groupHdrStyle)
  aoa.push(g)
  // Row 3: 欄名(身分欄留空,已在 row2 合併)
  aoa.push(cols.map((col) => cell(col.group === null ? '' : col.h, colHdrStyle)))
  // 資料列 + 合計
  const totals = Array(NC).fill(0)
  for (const p of rows) {
    const e = empMap.get(p.employee_id)
    aoa.push(cols.map((col, i) => {
      const v = col.get(p, e)
      if (!col.txt && typeof v === 'number') totals[i] += v
      return cell(v, col.txt ? cellTxt : cellNum)
    }))
  }
  aoa.push(cols.map((col, i) => {
    if (i === 0) return cell('合計', totalTxt)
    if (col.group === null || col.txt) return cell('', totalTxt)  // 身分欄/文字說明欄:合計列留空
    return cell(Math.round(totals[i]), totalNum)
  }))

  const ws = {}
  const lastRow = aoa.length - 1
  for (let r = 0; r < aoa.length; r++)
    for (let c = 0; c < NC; c++) ws[XLSX.utils.encode_cell({ r, c })] = aoa[r][c]
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: NC - 1 } })
  ws['!cols'] = cols.map(col => ({ wch: col.w }))
  // 群組合併(row2):每個群組從第一欄跨到最後一欄
  const groupMerges = []
  for (const grp of Object.keys(groupStart)) {
    const idxs = cols.map((c, i) => (c.group === grp ? i : -1)).filter(i => i >= 0)
    if (idxs.length) groupMerges.push({ s: { r: 2, c: idxs[0] }, e: { r: 2, c: idxs[idxs.length - 1] } })
  }
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: NC - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: NC - 1 } },
    ...Array.from({ length: idCount }, (_, c) => ({ s: { r: 2, c }, e: { r: 3, c } })),
    ...groupMerges,
    { s: { r: lastRow, c: 0 }, e: { r: lastRow, c: Math.max(idCount - 1, 0) } },
  ]
  ws['!rows'] = [{ hpt: 24 }, { hpt: 20 }, { hpt: 18 }, { hpt: 30 }]
  return ws
}

/**
 * 產生薪資計算報表(多門市工作表,動態欄位)
 * @param rows   preview_payroll 回傳的引擎逐人明細陣列
 * @param empMap Map<employee_id, {employee_number, join_date, store}>
 * @param month  '2026-06'
 * @param company 公司抬頭
 */
export function exportPayrollRegister(rows, empMap, month, company = '') {
  const cols = activeColumns(rows, empMap)   // 全公司統一欄位(有值才出欄)
  // 依門市分組(威耀總部/空 → 總部)
  const groups = new Map()
  for (const p of rows) {
    let store = p.store || empMap.get(p.employee_id)?.store || '未分類'
    if (/總部|總公司/.test(store) || !store) store = '總部'
    if (!groups.has(store)) groups.set(store, [])
    groups.get(store).push(p)
  }
  const names = [...groups.keys()].sort((a, b) => (a === '總部' ? -1 : b === '總部' ? 1 : a.localeCompare(b, 'zh-Hant')))

  const wb = XLSX.utils.book_new()
  for (const name of names) {
    const ws = buildSheet(name, groups.get(name), empMap, company, cols)
    const safe = name.replace(/[\\/?*[\]:]/g, '').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, safe)
  }
  XLSX.writeFile(wb, `薪資計算_${month}.xlsx`)
}
