// 薪資財務報表 — 首頁「財務用列表」(各門市彙總) + 各門市逐人明細,兩頁共用同一套欄位結構。
// 資料源:preview_payroll(與批次計薪/入帳同源,已疊入微調 manual_bonus/manual_deduction)。
// 保險依會計公式重算並拆項:(月投保級距/30)×在職天數×費率;滿月=30天、未滿月=實際在職天數。
//   勞保自付 普通11.5%×20% / 就業1%×20%;勞保費 普通11.5%×70% / 就業1%×70% / 職災0.19%。
// 加班費全歸免稅(保留免稅/應稅兩欄,應稅=0);假別逐類浮動;「其他加項/其他扣款」殘差欄確保本月實發加得回。
import XLSX from 'xlsx-js-style'

const n = (v) => (typeof v === 'number' ? v : Number(v) || 0)
const R = (v) => Math.round(v)
const LEAVE_FACTOR = { 事假: 1, 家庭照顧假: 1, 天災假: 1, 無薪假: 1, 病假: 0.5, 生理假: 0.5, 普通傷病假: 0.5 }
const STD_LV = ['事假', '家庭照顧假', '天災假', '病假', '生理假']

// 逐人 enrich
function enrich(p) {
  const hr = n(p._hourly_rate), bt = {}
  for (const r of (p._leave_rows || [])) {
    const f = LEAVE_FACTOR[r.type]; if (!f) continue
    bt[r.type] = (bt[r.type] || 0) + R(n(r.hours) * hr * f)
  }
  p._lv = bt
  const daily = n(p.insuredLabor) / 30
  const idays = p.is_partial_month ? n(p.in_service_days) : 30   // 滿月=30,未滿月=實際天數
  p._li_ord = R(daily * idays * 0.115 * 0.20)
  p._li_emp = R(daily * idays * 0.01 * 0.20)
  p._li_sub = p._li_ord + p._li_emp
  p._er_ord = R(daily * idays * 0.115 * 0.70)
  p._er_emp = R(daily * idays * 0.01 * 0.70)
  p._er_occ = R(daily * idays * 0.0019)
  p._er_sub = p._er_ord + p._er_emp + p._er_occ
  p._ot = n(p.regular_overtime_pay) + n(p.extra_overtime_pay)     // 加班費全免稅
  const lvSum = Object.values(bt).reduce((a, b) => a + b, 0)
  const late = n(p.lateDeduction) + n(p.earlyLeaveDeduction) + n(p.awolDeduction)
  p._salSub = n(p.base_salary) + n(p.meal_allowance) + n(p.role_allowance) + n(p.night_allowance) + n(p.cross_store_allowance) + n(p.transport_allowance) + n(p.unused_leave_payout) + n(p.comp_time_settled_pay) - lvSum - late
  p._payable = p._salSub + p._ot
  p._net = n(p.netSalary) + n(p.manual_bonus) - n(p.manual_deduction)
  p._erTotal = R(p._net + p._er_sub + n(p.healthEmployer) + n(p.pensionEmployer))
  // 其他加項/其他減項殘差:確保 應付 + Σ其他加項 − Σ其他減項 = 本月實發
  const addItem = n(p.severance_amount) + n(p.attendance_bonus) + n(p.policyBonus) + n(p.manual_bonus)
  const dedItem = p._li_sub + n(p.healthInsurance) + n(p.pension) + n(p.nhi_supplementary) + n(p.legal_deduction) + n(p.incomeTax) + n(p.manual_deduction)
  const recon = p._net - p._payable - addItem + dedItem
  p._resAdd = recon > 0 ? recon : 0
  p._resDed = recon < 0 ? -recon : 0
}

// ── 樣式 ──
const bd = { style: 'thin', color: { rgb: 'B0B0B0' } }, allB = { top: bd, bottom: bd, left: bd, right: bd }
const S = {
  title: { font: { bold: true, sz: 14 }, alignment: { horizontal: 'center', vertical: 'center' } },
  sub: { font: { bold: true, sz: 12 }, alignment: { horizontal: 'center', vertical: 'center' } },
  h: { font: { bold: true, sz: 9, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '2F5597' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: allB },
  txt: { alignment: { horizontal: 'center', vertical: 'center' }, border: allB, font: { sz: 9 } },
  num: { alignment: { horizontal: 'right', vertical: 'center' }, border: allB, font: { sz: 9 }, numFmt: '#,##0' },
  tT: { font: { bold: true, sz: 9 }, alignment: { horizontal: 'center', vertical: 'center' }, fill: { patternType: 'solid', fgColor: { rgb: 'FCE4D6' } }, border: allB },
  tN: { font: { bold: true, sz: 9 }, alignment: { horizontal: 'right', vertical: 'center' }, fill: { patternType: 'solid', fgColor: { rgb: 'FCE4D6' } }, border: allB, numFmt: '#,##0' },
}
const cell = (v, s) => ({ v: v == null ? '' : v, t: typeof v === 'number' ? 'n' : 's', s })

// ── 統一欄位定義(首頁與明細共用);opt:1 = 全公司皆0則隱藏 ──
function financeCols(LV) {
  const F = []
  F.push({ r3: '當月薪資', r4: '底薪', r5: '', w: 11, get: p => n(p.base_salary) })
  ;[['伙食津貼', p => n(p.meal_allowance)], ['主管加給', p => n(p.role_allowance)], ['夜班津貼', p => n(p.night_allowance)], ['跨區津貼', p => n(p.cross_store_allowance)], ['交通津貼', p => n(p.transport_allowance), 1], ['特休代金', p => n(p.unused_leave_payout)], ['補休代金', p => n(p.comp_time_settled_pay)]].forEach(([h, g, opt]) => F.push({ r3: '薪資加項', r4: h, r5: '', w: 9, opt, get: g }))
  LV.forEach((t, i) => F.push({ r3: '薪資減項', r4: t, r5: '', w: 9, opt: i >= STD_LV.length ? 1 : 0, get: p => n(p._lv[t]) }))
  ;[['遲到', p => n(p.lateDeduction)], ['早退', p => n(p.earlyLeaveDeduction)], ['曠職', p => n(p.awolDeduction)]].forEach(([h, g]) => F.push({ r3: '薪資減項', r4: h, r5: '', w: 8, get: g }))
  F.push({ r3: '薪資小計', r4: '', r5: '', w: 11, get: p => p._salSub })
  F.push({ r3: '加班費', r4: '免稅', r5: '', w: 10, get: p => p._ot })
  F.push({ r3: '加班費', r4: '應稅', r5: '', w: 10, get: () => 0 })
  F.push({ r3: '應付薪資小計', r4: '', r5: '', w: 12, get: p => p._payable })
  F.push({ r3: '其他加項', r4: '資遣費', r5: '', w: 10, opt: 1, get: p => n(p.severance_amount) })
  F.push({ r3: '其他加項', r4: '全勤獎金', r5: '', w: 9, opt: 1, get: p => n(p.attendance_bonus) })
  F.push({ r3: '其他加項', r4: '獎金', r5: '', w: 9, opt: 1, get: p => n(p.policyBonus) })
  F.push({ r3: '其他加項', r4: '微調加項', r5: '', w: 10, opt: 1, get: p => n(p.manual_bonus) })
  F.push({ r3: '其他加項', r4: '其他加項', r5: '', w: 10, opt: 1, get: p => p._resAdd })
  F.push({ r3: '其他減項', r4: '勞保自付', r5: '普通事故', w: 10, get: p => p._li_ord })
  F.push({ r3: '其他減項', r4: '勞保自付', r5: '就業保險', w: 10, get: p => p._li_emp })
  F.push({ r3: '其他減項', r4: '勞保自付', r5: '小計', w: 9, get: p => p._li_sub })
  F.push({ r3: '其他減項', r4: '健保自付', r5: '', w: 9, get: p => n(p.healthInsurance) })
  F.push({ r3: '其他減項', r4: '勞退自提', r5: '', w: 9, get: p => n(p.pension) })
  F.push({ r3: '其他減項', r4: '補充保費', r5: '', w: 9, opt: 1, get: p => n(p.nhi_supplementary) })
  F.push({ r3: '其他減項', r4: '法定扣款', r5: '', w: 9, opt: 1, get: p => n(p.legal_deduction) })
  F.push({ r3: '其他減項', r4: '所得稅', r5: '', w: 8, opt: 1, get: p => n(p.incomeTax) })
  F.push({ r3: '其他減項', r4: '微調扣款', r5: '', w: 10, opt: 1, get: p => n(p.manual_deduction) })
  F.push({ r3: '其他減項', r4: '其他扣款', r5: '', w: 10, opt: 1, get: p => p._resDed })
  F.push({ r3: '本月實發薪資', r4: '', r5: '', w: 12, get: p => p._net })
  F.push({ r3: '勞保費', r4: '', r5: '普通事故', w: 10, get: p => p._er_ord })
  F.push({ r3: '勞保費', r4: '', r5: '就業保險', w: 10, get: p => p._er_emp })
  F.push({ r3: '勞保費', r4: '', r5: '職災保險', w: 10, get: p => p._er_occ })
  F.push({ r3: '勞保費', r4: '', r5: '小計', w: 9, get: p => p._er_sub })
  F.push({ r3: '健保費', r4: '', r5: '', w: 9, get: p => n(p.healthEmployer) })
  F.push({ r3: '勞退新制提繳', r4: '', r5: '', w: 12, get: p => n(p.pensionEmployer) })
  F.push({ r3: '公司負擔總計', r4: '', r5: '', w: 12, get: p => p._erTotal })
  return F
}

// ── 三層表頭 + 資料 + 合計(首頁與明細共用)──
// leftDefs: 前置欄 [{h,w,txt}](首頁=單位/人數;明細=員編/姓名/部門/到職日/計薪方式)
// records:  [{left:[...], p?}] — 首頁一列一門市(vals 傳入);明細一列一人(用 F.get(p))
function buildSheet(company, subtitle, leftDefs, F, records) {
  const NID = leftDefs.length, NC = NID + F.length, aoa = []
  aoa.push([cell(company, S.title), ...Array(NC - 1).fill(cell('', S.title))])
  aoa.push([cell(subtitle, S.sub), ...Array(NC - 1).fill(cell('', S.sub))])
  const h2 = Array(NC).fill(null), h3 = Array(NC).fill(null), h4 = Array(NC).fill(null)
  leftDefs.forEach((d, i) => { h2[i] = cell(d.h, S.h); h3[i] = cell('', S.h); h4[i] = cell('', S.h) })
  F.forEach((c, i) => { const col = NID + i; h2[col] = cell(c.r3, S.h); h3[col] = cell(c.r4, S.h); h4[col] = cell(c.r5, S.h) })
  aoa.push(h2, h3, h4)
  const tot = Array(F.length).fill(0)
  for (const rec of records) {
    const row = leftDefs.map((d, i) => cell(rec.left[i], d.txt ? S.txt : S.num))
    F.forEach((c, i) => { const v = R(rec.vals ? rec.vals[i] : c.get(rec.p)); tot[i] += v; row.push(cell(v, S.num)) })
    aoa.push(row)
  }
  const trow = [cell(records.totalLabel || '合計', S.tT), ...Array(NID - 1).fill(cell('', S.tT))]
  if (records.totalCount != null) trow[1] = cell(records.totalCount, S.tN)
  F.forEach((c, i) => trow.push(cell(R(tot[i]), S.tN)))
  aoa.push(trow)
  const ws = {}, last = aoa.length - 1
  for (let r = 0; r < aoa.length; r++) for (let c = 0; c < NC; c++) ws[XLSX.utils.encode_cell({ r, c })] = aoa[r][c]
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: last, c: NC - 1 } })
  ws['!cols'] = [...leftDefs.map(d => ({ wch: d.w })), ...F.map(c => ({ wch: c.w }))]
  // merges
  const M = [{ s: { r: 0, c: 0 }, e: { r: 0, c: NC - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: NC - 1 } }]
  leftDefs.forEach((d, i) => M.push({ s: { r: 2, c: i }, e: { r: 4, c: i } }))   // 前置欄跨三列
  let i = 0
  while (i < F.length) {   // r3 頂群組
    let j = i; while (j + 1 < F.length && F[j + 1].r3 === F[i].r3) j++
    const c0 = NID + i, c1 = NID + j, a4 = F.slice(i, j + 1).every(c => c.r4 === ''), a5 = F.slice(i, j + 1).every(c => c.r5 === '')
    if (a4 && a5) M.push({ s: { r: 2, c: c0 }, e: { r: 4, c: c1 } })
    else if (a4 && !a5) M.push({ s: { r: 2, c: c0 }, e: { r: 3, c: c1 } })
    else M.push({ s: { r: 2, c: c0 }, e: { r: 2, c: c1 } })
    i = j + 1
  }
  i = 0
  while (i < F.length) {   // r4 中層
    if (F[i].r4 === '') { i++; continue }
    let j = i; while (j + 1 < F.length && F[j + 1].r3 === F[i].r3 && F[j + 1].r4 === F[i].r4) j++
    const c0 = NID + i, c1 = NID + j
    if (F.slice(i, j + 1).every(c => c.r5 === '')) M.push({ s: { r: 3, c: c0 }, e: { r: 4, c: c1 } })
    else M.push({ s: { r: 3, c: c0 }, e: { r: 3, c: c1 } })
    i = j + 1
  }
  M.push({ s: { r: last, c: 0 }, e: { r: last, c: records.totalCount != null ? 0 : Math.max(NID - 1, 0) } })
  ws['!merges'] = M
  ws['!rows'] = [{ hpt: 24 }, { hpt: 20 }, { hpt: 16 }, { hpt: 16 }, { hpt: 26 }]
  return ws
}

/**
 * 產生薪資財務報表(首頁財務用列表彙總 + 各門市逐人明細,兩頁同結構)
 * @param rows    preview_payroll 逐人明細(已疊入微調)
 * @param empMap  Map<employee_id, {employee_number, join_date, store, employment_type, salary_type}>
 * @param month   '2026-07'
 * @param company 公司抬頭
 */
export function exportPayrollRegister(rows, empMap, month, company = '') {
  rows.forEach(enrich)
  // 浮動假別:標準5類固定 + 額外出現有值者
  const extraLv = [...new Set(rows.flatMap(p => Object.keys(p._lv)))].filter(t => !STD_LV.includes(t) && rows.some(p => n(p._lv[t]) > 0))
  const LV = [...STD_LV, ...extraLv]
  const F0 = financeCols(LV)
  const F = F0.filter(c => !c.opt || rows.some(p => n(c.get(p)) !== 0))   // opt 欄全0則隱藏;首頁明細共用
  // 依門市分組
  const groups = new Map()
  for (const p of rows) {
    let s = p.store || empMap.get(p.employee_id)?.store || '未分類'
    if (/總部|總公司/.test(s) || !s) s = '總部'
    if (!groups.has(s)) groups.set(s, [])
    groups.get(s).push(p)
  }
  const order = [...groups.entries()].sort((a, b) => (a[0] === '總部' ? -1 : b[0] === '總部' ? 1 : a[0].localeCompare(b[0], 'zh-Hant')))

  const wb = XLSX.utils.book_new()
  // 首頁:財務用列表(單位/人數 + 各門市加總)
  const finRecords = order.map(([store, list]) => ({ left: [store, list.length], vals: F.map(c => list.reduce((a, p) => a + n(c.get(p)), 0)) }))
  finRecords.totalLabel = '總計'
  finRecords.totalCount = rows.length
  const finLeft = [{ h: '單位', w: 16, txt: 1 }, { h: '本月人數', w: 6 }]
  XLSX.utils.book_append_sheet(wb, buildSheet(company, '財務用列表  ' + month, finLeft, F, finRecords), '財務用列表')
  // 各門市明細:同結構,前置改身分欄,一列一人
  const detLeft = [{ h: '員工編號', w: 12, txt: 1 }, { h: '中文姓名', w: 9, txt: 1 }, { h: '部門', w: 15, txt: 1 }, { h: '到職日', w: 12, txt: 1 }, { h: '計薪方式', w: 9, txt: 1 }]
  for (const [name, list] of order) {
    const recs = list.map(p => { const e = empMap.get(p.employee_id); return { left: [e?.employee_number || '', p.employee || '', p.dept || '', p.join_date || e?.join_date || '', p._is_hourly ? '時薪' : '月薪'], p } })
    const safe = name.replace(/[\\/?*[\]:]/g, '').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, buildSheet(company, name + '  薪資表', detLeft, F, recs), safe)
  }
  XLSX.writeFile(wb, `薪資財務報表_${month}.xlsx`)
}
