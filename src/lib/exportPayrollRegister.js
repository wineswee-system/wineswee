// 薪資計算報表(每門市一張工作表,對齊會計薪資帳表格式)
// 資料來源:preview_payroll RPC 回傳的引擎逐人明細(與入帳同源)。
import XLSX from 'xlsx-js-style'

const NUMFMT = '#,##0'
const n = (v) => (typeof v === 'number' ? v : Number(v) || 0)

// 31 欄定義(對應參考檔 A–AE)
const COLS = [
  { h: '員工編號', txt: true, get: (p, e) => e?.employee_number || '' },
  { h: '中文姓名', txt: true, get: (p) => p.employee || '' },
  { h: '部門', txt: true, get: (p) => p.dept || '' },
  { h: '到職日/復職日', txt: true, get: (p, e) => (p.join_date || e?.join_date || '') },
  { h: '計薪方式', txt: true, get: (p) => (p._is_hourly ? '時薪' : '月薪') },
  // ── 薪資結構 ──
  { h: '基本薪資', get: (p) => n(p.base_salary) },
  { h: '伙食費', get: (p) => n(p.meal_allowance) },
  { h: '職務津貼', get: (p) => n(p.role_allowance) },
  { h: '夜間津貼', get: (p) => n(p.night_allowance) },
  { h: '跨店津貼', get: (p) => n(p.cross_store_allowance) },
  // ── 薪資科目加項 ──
  { h: '免稅加班費', get: (p) => n(p.regular_overtime_pay) },
  { h: '特休未休折抵費', get: (p) => n(p.unused_leave_payout) },
  { h: '額外加班費', get: (p) => n(p.extra_overtime_pay) },
  { h: '底薪', get: () => 0 },
  { h: '補發前月差額', get: () => 0 },
  // ── 薪資科目扣項 ──
  { h: '勞保費', get: (p) => n(p.laborInsurance) },
  { h: '健保費', get: (p) => n(p.healthInsurance) },
  { h: '勞退新制提繳', get: (p) => n(p.pension) },
  { h: '請假扣款(應稅)', get: (p) => n(p.unpaidDeduction) },
  { h: '請假扣款(免稅)', get: (p) => n(p.halfPayDeduction) },
  { h: '法扣項目', get: (p) => n(p.legal_deduction) },
  { h: '遲到早退未出勤金額', get: (p) => n(p.lateDeduction) + n(p.earlyLeaveDeduction) + n(p.awolDeduction) },
  { h: '補充保費', get: (p) => n(p.nhi_supplementary) },
  { h: '所得稅', get: (p) => n(p.incomeTax) },
  // ── 薪資總計 ──
  { h: '應稅所得', get: (p) => Math.max(0, n(p.gross) - n(p.regular_overtime_pay) - n(p.meal_allowance) - n(p.unused_leave_payout) - n(p.unpaidDeduction)) },
  { h: '應發總額', get: (p) => n(p.gross) },
  { h: '應減總額', get: (p) => n(p.totalDeductions) },
  { h: '實發金額', get: (p) => n(p.netSalary) },
  // ── 公司負擔 ──
  { h: '勞保費', get: (p) => n(p.laborEmployer) },
  { h: '健保費', get: (p) => n(p.healthEmployer) },
  { h: '勞退新制提繳', get: (p) => n(p.pensionEmployer) },
]
const NCOL = COLS.length // 31

// 群組表頭(起始欄 → 標題),跨到下一個群組前
const GROUPS = [
  { c: 5, span: 5, label: '薪資結構' },
  { c: 10, span: 5, label: '薪資科目加項' },
  { c: 15, span: 9, label: '薪資科目扣項' },
  { c: 24, span: 4, label: '薪資總計' },
  { c: 28, span: 3, label: '公司負擔' },
]

const COL_W = [12, 9, 15, 13, 9, 9, 7, 9, 10, 10, 13, 15, 11, 7, 13, 13, 7, 13, 14, 14, 9, 19, 9, 7, 9, 9, 9, 9, 9, 7, 13]

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

function buildSheet(storeName, rows, empMap, company) {
  const aoa = [] // rows of cells
  // Row 0: 公司名
  aoa.push([cell(company, titleStyle), ...Array(NCOL - 1).fill(cell('', titleStyle))])
  // Row 1: {門市} 薪資表
  aoa.push([cell(`${storeName}  薪資表`, subTitleStyle), ...Array(NCOL - 1).fill(cell('', subTitleStyle))])
  // Row 2: 群組表頭
  const g = Array(NCOL).fill(null).map(() => cell('', groupHdrStyle))
  for (let c = 0; c < 5; c++) g[c] = cell(COLS[c].h, colHdrStyle) // 基本資訊直接放欄名(A3:A4 合併)
  for (const grp of GROUPS) g[grp.c] = cell(grp.label, groupHdrStyle)
  aoa.push(g)
  // Row 3: 欄名
  aoa.push(COLS.map((col, i) => cell(i < 5 ? '' : col.h, colHdrStyle)))
  // 資料列
  const totals = Array(NCOL).fill(0)
  for (const p of rows) {
    const e = empMap.get(p.employee_id)
    const row = COLS.map((col, i) => {
      const v = col.get(p, e)
      if (!col.txt && typeof v === 'number') totals[i] += v
      return cell(v, col.txt ? cellTxt : cellNum)
    })
    aoa.push(row)
  }
  // 合計列
  const tRow = COLS.map((col, i) => {
    if (i === 0) return cell('合計', totalTxt)
    if (i < 5) return cell('', totalTxt)
    return cell(Math.round(totals[i]), totalNum)
  })
  aoa.push(tRow)

  // 手動寫入(保留每格的 style 物件 .s)
  const ws2 = {}
  const lastRow = aoa.length - 1
  for (let r = 0; r < aoa.length; r++) {
    for (let c = 0; c < NCOL; c++) {
      const cc = aoa[r][c]
      ws2[XLSX.utils.encode_cell({ r, c })] = cc
    }
  }
  ws2['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: NCOL - 1 } })
  ws2['!cols'] = COL_W.map(w => ({ wch: w }))
  ws2['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: NCOL - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: NCOL - 1 } },
    ...[0, 1, 2, 3, 4].map(c => ({ s: { r: 2, c }, e: { r: 3, c } })),
    ...GROUPS.map(grp => ({ s: { r: 2, c: grp.c }, e: { r: 2, c: grp.c + grp.span - 1 } })),
    { s: { r: lastRow, c: 0 }, e: { r: lastRow, c: 4 } },
  ]
  ws2['!rows'] = [{ hpt: 24 }, { hpt: 20 }, { hpt: 18 }, { hpt: 30 }]
  return ws2
}

/**
 * 產生薪資計算報表(多門市工作表)
 * @param rows   preview_payroll 回傳的引擎逐人明細陣列
 * @param empMap Map<employee_id, {employee_number, join_date, store}>
 * @param month  '2026-06'
 * @param company 公司抬頭
 */
export function exportPayrollRegister(rows, empMap, month, company = '') {
  // 依門市分組(威耀總部/空 → 總部)
  const groups = new Map()
  for (const p of rows) {
    let store = p.store || empMap.get(p.employee_id)?.store || '未分類'
    if (/總部|總公司/.test(store) || !store) store = '總部'
    if (!groups.has(store)) groups.set(store, [])
    groups.get(store).push(p)
  }
  // 總部排最前,其餘按名稱
  const names = [...groups.keys()].sort((a, b) => (a === '總部' ? -1 : b === '總部' ? 1 : a.localeCompare(b, 'zh-Hant')))

  const wb = XLSX.utils.book_new()
  for (const name of names) {
    const ws = buildSheet(name, groups.get(name), empMap, company)
    // sheet 名稱上限 31 字、去非法字元
    const safe = name.replace(/[\\/?*[\]:]/g, '').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, safe)
  }
  XLSX.writeFile(wb, `薪資計算_${month}.xlsx`)
}
