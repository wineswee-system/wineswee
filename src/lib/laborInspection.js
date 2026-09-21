/**
 * 勞檢15項報表產生引擎
 *
 * 依據勞動部勞動條件檢查所需之15項標準文件，
 * 提供純函式產生各項報表資料及合規驗證。
 */

// ══════════════════════════════════════
//  勞檢15項定義
// ══════════════════════════════════════

export const INSPECTION_ITEMS = [
  { id: 1,  name: '勞工名卡',           description: '全體員工基本資料冊，含姓名、身分證字號、到職日、職務等',    required: true },
  { id: 2,  name: '出勤紀錄',           description: '逐日出勤時間記錄，應保存5年（勞基法§30-6）',             required: true },
  { id: 3,  name: '工資清冊',           description: '各項工資明細，含加班費、津貼、扣款等（勞基法§23）',       required: true },
  { id: 4,  name: '加班申請/紀錄',      description: '延長工時申請表及實際加班時數紀錄',                        required: true },
  { id: 5,  name: '請假紀錄',           description: '各類假別申請及核准紀錄',                                  required: true },
  { id: 6,  name: '勞工保險投保資料',   description: '勞保加退保紀錄及投保薪資級距',                            required: true },
  { id: 7,  name: '健保投保資料',       description: '全民健保加退保紀錄及眷屬投保',                            required: true },
  { id: 8,  name: '勞退提繳資料',       description: '勞工退休金提繳紀錄（6%雇主提繳+自提）',                  required: true },
  { id: 9,  name: '排班表',             description: '班表應於一個月前公告（勞基法§30）',                       required: true },
  { id: 10, name: '職安衛生管理',       description: '職業安全衛生管理計畫及執行紀錄',                          required: true },
  { id: 11, name: '工作規則',           description: '僱用30人以上應訂立工作規則報備（勞基法§70）',             required: true },
  { id: 12, name: '勞資會議紀錄',       description: '每3個月至少召開一次勞資會議（勞基法§83）',                required: true },
  { id: 13, name: '性騷擾防治措施',     description: '僱用10人以上應訂定性騷擾防治措施（性平法§13）',           required: true },
  { id: 14, name: '職業災害統計',       description: '職災發生率統計及通報紀錄',                                required: true },
  { id: 15, name: '勞動條件自主檢查表', description: '各項勞動條件自主檢核結果',                                required: true },
]

// ── Helpers ──

const now = () => new Date().toISOString()

const STATUS = { PASS: '通過', FAIL: '未通過', WARN: '待確認' }

function checkStatus(condition, warnCondition) {
  if (condition) return STATUS.PASS
  if (warnCondition) return STATUS.WARN
  return STATUS.FAIL
}

function formatMonth(month) {
  if (!month) return '未指定'
  return month // expects 'YYYY-MM'
}

// ══════════════════════════════════════
//  1. 勞工名卡
// ══════════════════════════════════════

export function generateEmployeeRoster(employees = []) {
  const items = employees.map(emp => ({
    label: emp.name,
    value: `${emp.dept || '—'} / ${emp.position || '—'} / 到職日: ${emp.hire_date || emp.join_date || '未登錄'}`,
    status: checkStatus(
      emp.name && (emp.hire_date || emp.start_date) && emp.id_number,
      emp.name && (emp.hire_date || emp.start_date)
    ),
  }))

  const complete = items.filter(i => i.status === STATUS.PASS).length
  return {
    title: '勞工名卡',
    items,
    summary: `共 ${employees.length} 名員工，${complete} 筆資料完整，${items.filter(i => i.status === STATUS.FAIL).length} 筆缺漏`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  2. 出勤紀錄
// ══════════════════════════════════════

export function generateAttendanceReport(attendance = [], employees = [], month) {
  const monthStr = formatMonth(month)
  const monthRecords = attendance.filter(a => a.date?.startsWith(monthStr))

  const items = employees.map(emp => {
    const empRecords = monthRecords.filter(r => r.employee === emp.name || r.employee_id === emp.id)
    const hasClockIn = empRecords.every(r => r.clock_in)
    const hasClockOut = empRecords.every(r => r.clock_out)
    return {
      label: emp.name,
      value: `出勤 ${empRecords.length} 天，${hasClockIn && hasClockOut ? '打卡完整' : '有缺卡紀錄'}`,
      status: checkStatus(hasClockIn && hasClockOut && empRecords.length > 0, empRecords.length > 0),
    }
  })

  const passed = items.filter(i => i.status === STATUS.PASS).length
  return {
    title: '出勤紀錄',
    items,
    summary: `${monthStr} 共 ${employees.length} 人，${passed} 人出勤紀錄完整`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  3. 工資清冊
// ══════════════════════════════════════

export function generatePayrollRegister(salaryRecords = [], employees = [], month) {
  const monthStr = formatMonth(month)
  const monthSalary = salaryRecords.filter(s => s.month === monthStr || s.pay_period === monthStr)

  const items = employees.map(emp => {
    const rec = monthSalary.find(s => s.employee === emp.name || s.employee_id === emp.id)
    const baseSalary = rec?.base_salary || rec?.salary || 0
    const minWage = 29500
    return {
      label: emp.name,
      value: rec ? `底薪 NT$${Number(baseSalary).toLocaleString()}，實發 NT$${Number(rec.net_salary || rec.net || 0).toLocaleString()}` : '無薪資紀錄',
      status: checkStatus(rec && baseSalary >= minWage, rec && baseSalary > 0),
    }
  })

  const paid = items.filter(i => i.status !== STATUS.FAIL).length
  return {
    title: '工資清冊',
    items,
    summary: `${monthStr} 共 ${employees.length} 人，${paid} 人有薪資紀錄`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  4. 加班申請/紀錄
// ══════════════════════════════════════

export function generateOvertimeReport(overtimeRecords = [], employees = [], month) {
  const monthStr = formatMonth(month)
  const monthOT = overtimeRecords.filter(o => o.date?.startsWith(monthStr))

  const items = employees.map(emp => {
    const empOT = monthOT.filter(o => o.employee === emp.name || o.employee_id === emp.id)
    const totalHours = empOT.reduce((sum, o) => sum + (Number(o.hours) || 0), 0)
    const withinLimit = totalHours <= 46
    return {
      label: emp.name,
      value: `加班 ${totalHours} 小時（${empOT.length} 筆）`,
      status: checkStatus(withinLimit && empOT.every(o => o.status === '已核准'), totalHours <= 54),
    }
  })

  const totalOT = monthOT.reduce((s, o) => s + (Number(o.hours) || 0), 0)
  return {
    title: '加班申請/紀錄',
    items,
    summary: `${monthStr} 加班總時數 ${totalOT} 小時，${items.filter(i => i.status === STATUS.FAIL).length} 人超時`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  5. 請假紀錄
// ══════════════════════════════════════

export function generateLeaveReport(leaveRecords = [], employees = [], month) {
  const monthStr = formatMonth(month)
  const monthLeave = leaveRecords.filter(l => l.start_date?.startsWith(monthStr) || l.date?.startsWith(monthStr))

  const items = employees.map(emp => {
    const empLeave = monthLeave.filter(l => l.employee === emp.name || l.employee_id === emp.id)
    const allApproved = empLeave.every(l => l.status === '已核准' || l.status === '已銷假')
    return {
      label: emp.name,
      value: `請假 ${empLeave.length} 筆${empLeave.length > 0 ? '（' + [...new Set(empLeave.map(l => l.leave_type || l.type))].join('、') + '）' : ''}`,
      status: checkStatus(empLeave.length === 0 || allApproved, empLeave.length >= 0),
    }
  })

  return {
    title: '請假紀錄',
    items,
    summary: `${monthStr} 共 ${monthLeave.length} 筆請假紀錄`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  6. 勞工保險投保資料
// ══════════════════════════════════════

export function generateLaborInsuranceReport(employees = []) {
  const items = employees.map(emp => {
    const hasInsurance = emp.labor_insurance !== false && emp.status === '在職'
    const insuredSalary = emp.insured_salary || emp.labor_insurance_salary
    return {
      label: emp.name,
      value: insuredSalary ? `投保薪資 NT$${Number(insuredSalary).toLocaleString()}` : '未登錄投保薪資',
      status: checkStatus(hasInsurance && insuredSalary, hasInsurance),
    }
  })

  return {
    title: '勞工保險投保資料',
    items,
    summary: `共 ${employees.length} 人，${items.filter(i => i.status === STATUS.PASS).length} 人投保資料完整`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  7. 健保投保資料
// ══════════════════════════════════════

export function generateNHIReport(employees = []) {
  const items = employees.map(emp => {
    const hasNHI = emp.health_insurance !== false && emp.status === '在職'
    const nhiSalary = emp.nhi_salary || emp.health_insurance_salary || emp.insured_salary
    return {
      label: emp.name,
      value: nhiSalary ? `健保投保薪資 NT$${Number(nhiSalary).toLocaleString()}` : '未登錄健保投保資料',
      status: checkStatus(hasNHI && nhiSalary, hasNHI),
    }
  })

  return {
    title: '健保投保資料',
    items,
    summary: `共 ${employees.length} 人，${items.filter(i => i.status === STATUS.PASS).length} 人健保資料完整`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  8. 勞退提繳資料
// ══════════════════════════════════════

export function generatePensionReport(employees = [], salaryRecords = [], month) {
  const monthStr = formatMonth(month)
  const monthSalary = salaryRecords.filter(s => s.month === monthStr || s.pay_period === monthStr)

  const items = employees.map(emp => {
    const rec = monthSalary.find(s => s.employee === emp.name || s.employee_id === emp.id)
    const pensionBase = emp.pension_salary || emp.insured_salary || rec?.base_salary || 0
    const employerRate = 0.06
    const contribution = Math.round(pensionBase * employerRate)
    return {
      label: emp.name,
      value: pensionBase > 0 ? `提繳薪資 NT$${Number(pensionBase).toLocaleString()}，雇主提繳 NT$${contribution.toLocaleString()}` : '未登錄提繳資料',
      status: checkStatus(pensionBase > 0, emp.status === '在職'),
    }
  })

  return {
    title: '勞退提繳資料',
    items,
    summary: `${monthStr} 共 ${employees.length} 人，${items.filter(i => i.status === STATUS.PASS).length} 人提繳資料完整`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  9. 排班表
// ══════════════════════════════════════

export function generateScheduleReport(schedules = [], employees = [], month) {
  const monthStr = formatMonth(month)
  const monthSchedules = schedules.filter(s => s.date?.startsWith(monthStr) || s.month === monthStr)

  const items = employees.map(emp => {
    const empSch = monthSchedules.filter(s => s.employee === emp.name || s.employee_id === emp.id)
    return {
      label: emp.name,
      value: empSch.length > 0 ? `已排 ${empSch.length} 天班` : '未排班',
      status: checkStatus(empSch.length > 0, false),
    }
  })

  const scheduled = items.filter(i => i.status === STATUS.PASS).length
  return {
    title: '排班表',
    items,
    summary: `${monthStr} 共 ${employees.length} 人，${scheduled} 人已排班`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  10. 職安衛生管理
// ══════════════════════════════════════

export function generateSafetyReport(incidents = []) {
  const checkItems = [
    { label: '職安衛生管理計畫', key: 'safety_plan' },
    { label: '安全衛生教育訓練紀錄', key: 'safety_training' },
    { label: '作業環境測定紀錄', key: 'environment_monitoring' },
    { label: '健康檢查紀錄', key: 'health_check' },
    { label: '消防安全檢查', key: 'fire_safety' },
    { label: '急救人員名冊', key: 'first_aid_staff' },
  ]

  const items = checkItems.map(item => ({
    label: item.label,
    value: '需確認文件是否備妥',
    status: STATUS.WARN,
  }))

  if (incidents.length > 0) {
    items.push({
      label: '職災事件',
      value: `近期 ${incidents.length} 件職災紀錄`,
      status: incidents.length > 3 ? STATUS.FAIL : STATUS.WARN,
    })
  }

  return {
    title: '職安衛生管理',
    items,
    summary: `${checkItems.length} 項安全衛生檢查項目待確認，${incidents.length} 件職災紀錄`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  11. 工作規則
// ══════════════════════════════════════

export function generateWorkRulesChecklist() {
  const ruleItems = [
    { label: '工作時間與休息', desc: '正常工時、彈性工時、休息時間規定' },
    { label: '工資相關', desc: '薪資計算方式、發薪日、加班費計算' },
    { label: '請假規則', desc: '各類假別天數及請假程序' },
    { label: '獎懲規定', desc: '獎勵及懲戒事項與程序' },
    { label: '資遣解僱', desc: '預告期間、資遣費計算' },
    { label: '退休規定', desc: '退休條件及退休金' },
    { label: '災害傷病補償', desc: '職災補償辦法' },
    { label: '安全衛生', desc: '工作場所安全衛生規範' },
    { label: '福利措施', desc: '員工福利項目' },
    { label: '申訴管道', desc: '勞工申訴辦法及處理程序' },
  ]

  const items = ruleItems.map(rule => ({
    label: rule.label,
    value: rule.desc,
    status: STATUS.WARN,
  }))

  return {
    title: '工作規則',
    items,
    summary: `共 ${ruleItems.length} 項工作規則需備妥，僱用30人以上應報備主管機關`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  12. 勞資會議紀錄
// ══════════════════════════════════════

export function generateMeetingReport(meetings = []) {
  const sorted = [...meetings].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const lastMeeting = sorted[0]
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  const items = sorted.length > 0
    ? sorted.map(m => ({
        label: m.date || '未記錄日期',
        value: m.title || m.subject || '勞資會議',
        status: checkStatus(m.minutes || m.content, true),
      }))
    : [{ label: '無會議紀錄', value: '依法每3個月應召開一次勞資會議', status: STATUS.FAIL }]

  const lastDate = lastMeeting?.date ? new Date(lastMeeting.date) : null
  const isRecent = lastDate && lastDate >= threeMonthsAgo

  return {
    title: '勞資會議紀錄',
    items,
    summary: isRecent
      ? `最近一次會議：${lastMeeting.date}，共 ${meetings.length} 筆紀錄`
      : `已超過3個月未召開勞資會議，請儘速安排`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  13. 性騷擾防治措施
// ══════════════════════════════════════

export function generateHarassmentPolicy() {
  const policyItems = [
    { label: '防治措施公告', desc: '於工作場所顯著處公告防治措施' },
    { label: '申訴管道', desc: '設置申訴信箱、專線或指定受理人' },
    { label: '申訴處理程序', desc: '接獲申訴後之調查及處理流程' },
    { label: '教育訓練', desc: '定期辦理性騷擾防治教育訓練' },
    { label: '保密措施', desc: '申訴人及相關人員之隱私保護' },
    { label: '懲戒規定', desc: '對行為人之懲戒處分辦法' },
    { label: '追蹤考核', desc: '案件結案後之追蹤輔導機制' },
  ]

  const items = policyItems.map(p => ({
    label: p.label,
    value: p.desc,
    status: STATUS.WARN,
  }))

  return {
    title: '性騷擾防治措施',
    items,
    summary: '僱用10人以上應訂定性騷擾防治措施、申訴及懲戒辦法（性平法§13）',
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  14. 職業災害統計
// ══════════════════════════════════════

export function generateAccidentStats(incidents = []) {
  const byType = {}
  incidents.forEach(inc => {
    const type = inc.type || inc.category || '其他'
    byType[type] = (byType[type] || 0) + 1
  })

  const items = Object.keys(byType).length > 0
    ? Object.entries(byType).map(([type, count]) => ({
        label: type,
        value: `${count} 件`,
        status: count > 2 ? STATUS.FAIL : STATUS.WARN,
      }))
    : [{ label: '無職災紀錄', value: '本期間無職業災害發生', status: STATUS.PASS }]

  const totalDays = incidents.reduce((s, i) => s + (Number(i.lost_days) || 0), 0)

  return {
    title: '職業災害統計',
    items,
    summary: `共 ${incidents.length} 件職災，損失工日 ${totalDays} 天`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  15. 勞動條件自主檢查表
// ══════════════════════════════════════

export function generateSelfInspection(data = {}) {
  const checkpoints = [
    { key: 'roster',       label: '勞工名卡是否完備' },
    { key: 'attendance',   label: '出勤紀錄是否逐日記載' },
    { key: 'payroll',      label: '工資清冊是否完整' },
    { key: 'overtime',     label: '加班是否符合法定上限' },
    { key: 'leave',        label: '假別天數是否符合規定' },
    { key: 'laborIns',     label: '勞保是否依規投保' },
    { key: 'nhi',          label: '健保是否依規投保' },
    { key: 'pension',      label: '勞退是否足額提繳' },
    { key: 'schedule',     label: '排班是否提前公告' },
    { key: 'safety',       label: '職安衛生是否落實' },
    { key: 'workRules',    label: '工作規則是否報備' },
    { key: 'meeting',      label: '勞資會議是否定期召開' },
    { key: 'harassment',   label: '性騷擾防治措施是否訂定' },
    { key: 'accident',     label: '職災是否依規通報' },
    { key: 'minWage',      label: '工資是否符合基本工資' },
  ]

  const items = checkpoints.map(cp => ({
    label: cp.label,
    value: data[cp.key] === true ? '符合' : data[cp.key] === false ? '不符合' : '待確認',
    status: data[cp.key] === true ? STATUS.PASS : data[cp.key] === false ? STATUS.FAIL : STATUS.WARN,
  }))

  const passed = items.filter(i => i.status === STATUS.PASS).length
  const failed = items.filter(i => i.status === STATUS.FAIL).length

  return {
    title: '勞動條件自主檢查表',
    items,
    summary: `${checkpoints.length} 項檢查：${passed} 項通過、${failed} 項未通過、${checkpoints.length - passed - failed} 項待確認`,
    generatedAt: now(),
  }
}

// ══════════════════════════════════════
//  合規驗證
// ══════════════════════════════════════

/**
 * 綜合驗證所有報表的合規狀態
 * @param {Array} reports - 各報表產生結果陣列
 * @returns {{ score: number, passed: string[], failed: string[], warnings: string[] }}
 */
export function validateCompliance(reports = []) {
  const passed = []
  const failed = []
  const warnings = []

  reports.forEach(report => {
    if (!report || !report.items) return

    const failCount = report.items.filter(i => i.status === STATUS.FAIL).length
    const warnCount = report.items.filter(i => i.status === STATUS.WARN).length
    const totalCount = report.items.length

    if (failCount > 0) {
      failed.push(report.title)
    } else if (warnCount > totalCount * 0.5) {
      warnings.push(report.title)
    } else {
      passed.push(report.title)
    }
  })

  const total = passed.length + failed.length + warnings.length
  const score = total > 0 ? Math.round((passed.length / total) * 100) : 0

  return { score, passed, failed, warnings }
}
