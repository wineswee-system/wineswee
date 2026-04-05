/**
 * 台灣中小企業 HR 工作流程引擎
 *
 * 涵蓋：
 * 1. 新進人員到職流程（Onboarding）
 * 2. 離職作業流程（Offboarding）
 * 3. 薪資異動管理
 * 4. 薪資單產製
 * 5. 特休結轉/結算
 * 6. 福利管理與總薪酬計算
 *
 * 依據：
 * - 勞動基準法
 * - 勞工保險條例
 * - 全民健康保險法
 * - 勞工退休金條例
 */

import { supabase } from './supabase'

// ══════════════════════════════════════
//  1. 新進人員到職流程
// ══════════════════════════════════════

/**
 * 到職檢核清單
 * required = true 表示為法令或公司必要項目
 */
export const ONBOARDING_CHECKLIST = [
  { id: 'contract', label: '簽訂勞動契約', required: true },
  { id: 'id_copy', label: '身分證影本', required: true },
  { id: 'bank_account', label: '薪轉帳戶資料', required: true },
  { id: 'labor_insurance', label: '勞保加保', required: true },
  { id: 'health_insurance', label: '健保轉入', required: true },
  { id: 'pension', label: '勞退提繳設定', required: true },
  { id: 'it_setup', label: 'IT 帳號/設備', required: false },
  { id: 'orientation', label: '新人導覽', required: false },
  { id: 'training', label: '基礎訓練', required: false },
  { id: 'emergency_contact', label: '緊急聯絡人', required: true },
]

/**
 * 建立到職流程計畫
 *
 * @param {{ id: string, name: string, department?: string, start_date: string }} employee
 * @returns {{ employee_id: string, employee_name: string, department: string, start_date: string, created_at: string, steps: Array }}
 */
export function createOnboardingPlan(employee) {
  const now = new Date().toISOString()

  const steps = ONBOARDING_CHECKLIST.map((item) => ({
    id: item.id,
    label: item.label,
    required: item.required,
    status: 'pending',       // pending | in_progress | completed | skipped
    completed_by: null,
    completed_at: null,
    notes: '',
  }))

  return {
    employee_id: employee.id,
    employee_name: employee.name,
    department: employee.department || '',
    start_date: employee.start_date,
    created_at: now,
    steps,
  }
}

/**
 * 更新到職流程中的某個步驟
 *
 * @param {object} plan - createOnboardingPlan 回傳的計畫物件
 * @param {string} stepId - 步驟 ID（如 'contract'）
 * @param {'pending'|'in_progress'|'completed'|'skipped'} status
 * @param {string} completedBy - 負責人姓名
 * @param {string} [notes=''] - 備註
 * @returns {object} 更新後的計畫（新物件，不 mutate 原本的）
 */
export function updateOnboardingStep(plan, stepId, status, completedBy, notes = '') {
  const now = new Date().toISOString()

  const updatedSteps = plan.steps.map((step) => {
    if (step.id !== stepId) return step
    return {
      ...step,
      status,
      completed_by: status === 'completed' ? completedBy : step.completed_by,
      completed_at: status === 'completed' ? now : step.completed_at,
      notes: notes || step.notes,
    }
  })

  return { ...plan, steps: updatedSteps }
}

/**
 * 取得到職流程進度
 *
 * @param {object} plan - 到職計畫物件
 * @returns {{ total: number, completed: number, percentage: number, required_remaining: string[], optional_remaining: string[] }}
 */
export function getOnboardingProgress(plan) {
  const total = plan.steps.length
  const completed = plan.steps.filter(
    (s) => s.status === 'completed' || s.status === 'skipped'
  ).length

  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

  const requiredRemaining = plan.steps
    .filter((s) => s.required && s.status !== 'completed')
    .map((s) => s.label)

  const optionalRemaining = plan.steps
    .filter((s) => !s.required && s.status !== 'completed' && s.status !== 'skipped')
    .map((s) => s.label)

  return {
    total,
    completed,
    percentage,
    required_remaining: requiredRemaining,
    optional_remaining: optionalRemaining,
  }
}

/**
 * 儲存到職計畫至 Supabase
 *
 * @param {object} plan - 到職計畫物件
 * @returns {Promise<object>}
 */
export async function saveOnboardingPlan(plan) {
  const { data, error } = await supabase
    .from('onboarding_plans')
    .upsert({
      employee_id: plan.employee_id,
      plan_data: plan,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id' })
    .select()
    .single()

  if (error) throw new Error(`到職計畫儲存失敗：${error.message}`)
  return data
}

// ══════════════════════════════════════
//  2. 離職作業流程
// ══════════════════════════════════════

/**
 * 離職檢核清單
 */
export const OFFBOARDING_CHECKLIST = [
  { id: 'resignation', label: '離職申請/通知', required: true },
  { id: 'handover', label: '工作交接', required: true },
  { id: 'leave_settlement', label: '特休結算', required: true },
  { id: 'final_pay', label: '最後薪資計算', required: true },
  { id: 'labor_insurance_out', label: '勞保退保', required: true },
  { id: 'health_insurance_out', label: '健保轉出', required: true },
  { id: 'asset_return', label: '公司資產歸還', required: true },
  { id: 'access_revoke', label: '系統權限撤銷', required: true },
  { id: 'exit_interview', label: '離職面談', required: false },
  { id: 'certificate', label: '離職證明書', required: true },
]

/**
 * 建立離職流程計畫
 *
 * @param {{ id: string, name: string, department?: string, hire_date?: string }} employee
 * @param {string} lastDay - 最後工作日（YYYY-MM-DD）
 * @param {string} reason - 離職原因（自願離職 / 資遣 / 退休 / 其他）
 * @returns {object} 離職計畫物件
 */
export function createOffboardingPlan(employee, lastDay, reason) {
  const now = new Date().toISOString()

  const steps = OFFBOARDING_CHECKLIST.map((item) => ({
    id: item.id,
    label: item.label,
    required: item.required,
    status: 'pending',
    completed_by: null,
    completed_at: null,
    notes: '',
  }))

  return {
    employee_id: employee.id,
    employee_name: employee.name,
    department: employee.department || '',
    hire_date: employee.hire_date || null,
    last_day: lastDay,
    reason,
    created_at: now,
    steps,
  }
}

/**
 * 計算離職最終結算金額
 *
 * 包含：
 * - 最後工作日之比例薪資
 * - 未休特休折算工資
 * - 資遣費（如適用）
 *
 * @param {{ id: string, name: string, hire_date?: string }} employee
 * @param {string} lastDay - 最後工作日（YYYY-MM-DD）
 * @param {number} monthlySalary - 月薪
 * @param {number} unusedLeaveDays - 未休特休天數
 * @returns {{ employee_id: string, employee_name: string, last_day: string, monthly_salary: number, worked_days: number, days_in_month: number, prorated_salary: number, daily_rate: number, unused_leave_days: number, leave_settlement: number, total_settlement: number, breakdown: object[] }}
 */
export function calculateFinalSettlement(employee, lastDay, monthlySalary, unusedLeaveDays) {
  const lastDate = new Date(lastDay)
  const year = lastDate.getFullYear()
  const month = lastDate.getMonth()

  // 該月總天數
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // 最後工作日是當月第幾天（含當天）
  const workedDays = lastDate.getDate()

  // 日薪 = 月薪 / 30（勞基法慣例以 30 天計算）
  const dailyRate = Math.round(monthlySalary / 30 * 100) / 100

  // 比例薪資
  const proratedSalary = Math.round(dailyRate * workedDays * 100) / 100

  // 特休未休折算工資（勞基法 §38-4）
  const leaveSettlement = Math.round(dailyRate * unusedLeaveDays * 100) / 100

  // 合計結算金額
  const totalSettlement = Math.round((proratedSalary + leaveSettlement) * 100) / 100

  const breakdown = [
    { item: '比例薪資', description: `${workedDays} 天 × NT$${dailyRate}`, amount: proratedSalary },
    { item: '特休未休折算', description: `${unusedLeaveDays} 天 × NT$${dailyRate}`, amount: leaveSettlement },
  ]

  return {
    employee_id: employee.id,
    employee_name: employee.name,
    last_day: lastDay,
    monthly_salary: monthlySalary,
    worked_days: workedDays,
    days_in_month: daysInMonth,
    prorated_salary: proratedSalary,
    daily_rate: dailyRate,
    unused_leave_days: unusedLeaveDays,
    leave_settlement: leaveSettlement,
    total_settlement: totalSettlement,
    breakdown,
  }
}

/**
 * 儲存離職計畫至 Supabase
 *
 * @param {object} plan - 離職計畫物件
 * @returns {Promise<object>}
 */
export async function saveOffboardingPlan(plan) {
  const { data, error } = await supabase
    .from('offboarding_plans')
    .upsert({
      employee_id: plan.employee_id,
      plan_data: plan,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id' })
    .select()
    .single()

  if (error) throw new Error(`離職計畫儲存失敗：${error.message}`)
  return data
}

// ══════════════════════════════════════
//  3. 薪資異動管理
// ══════════════════════════════════════

/**
 * 建立薪資異動記錄
 *
 * @param {string} employeeId - 員工 ID
 * @param {number} oldSalary - 原薪資
 * @param {number} newSalary - 新薪資
 * @param {string} effectiveDate - 生效日期（YYYY-MM-DD）
 * @param {string} reason - 異動原因（年度調薪 / 晉升 / 試用期滿 / 其他）
 * @param {string} approvedBy - 核准人
 * @returns {object} 薪資異動記錄
 */
export function createSalaryRevision(employeeId, oldSalary, newSalary, effectiveDate, reason, approvedBy) {
  const diff = Math.round((newSalary - oldSalary) * 100) / 100
  const changePercent = oldSalary > 0
    ? Math.round((diff / oldSalary) * 10000) / 100  // 精確到小數第二位
    : 0

  return {
    employee_id: employeeId,
    old_salary: oldSalary,
    new_salary: newSalary,
    diff,
    change_percent: changePercent,
    effective_date: effectiveDate,
    reason,
    approved_by: approvedBy,
    created_at: new Date().toISOString(),
  }
}

/**
 * 取得薪資異動歷史時間軸
 *
 * @param {object[]} revisions - 薪資異動記錄陣列
 * @returns {{ timeline: object[], current_salary: number|null, total_change_percent: number }}
 */
export function getSalaryHistory(revisions) {
  if (!revisions || revisions.length === 0) {
    return { timeline: [], current_salary: null, total_change_percent: 0 }
  }

  // 依生效日期排序（舊 → 新）
  const sorted = [...revisions].sort(
    (a, b) => new Date(a.effective_date) - new Date(b.effective_date)
  )

  const timeline = sorted.map((rev) => ({
    effective_date: rev.effective_date,
    old_salary: rev.old_salary,
    new_salary: rev.new_salary,
    diff: rev.diff,
    change_percent: rev.change_percent,
    reason: rev.reason,
    approved_by: rev.approved_by,
  }))

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const totalChangePercent = first.old_salary > 0
    ? Math.round(((last.new_salary - first.old_salary) / first.old_salary) * 10000) / 100
    : 0

  return {
    timeline,
    current_salary: last.new_salary,
    total_change_percent: totalChangePercent,
  }
}

/**
 * 儲存薪資異動至 Supabase
 *
 * @param {object} revision - 薪資異動記錄
 * @returns {Promise<object>}
 */
export async function saveSalaryRevision(revision) {
  const { data, error } = await supabase
    .from('salary_revisions')
    .insert(revision)
    .select()
    .single()

  if (error) throw new Error(`薪資異動儲存失敗：${error.message}`)
  return data
}

// ══════════════════════════════════════
//  4. 薪資單產製
// ══════════════════════════════════════

/**
 * 產製薪資單
 *
 * @param {{ id: string, name: string, department?: string }} employee
 * @param {{ period: string, gross_salary: number, labor_insurance: number, health_insurance: number, pension_employee: number, income_tax: number, other_deductions?: number, ytd_gross?: number, ytd_tax?: number, ytd_labor_insurance?: number, ytd_health_insurance?: number }} salaryRecord
 * @param {{ labor_insurance_employer?: number, health_insurance_employer?: number, pension_employer?: number }} [employerContributions={}]
 * @returns {object} 結構化薪資單資料
 */
export function generatePayslip(employee, salaryRecord, employerContributions = {}) {
  const otherDeductions = salaryRecord.other_deductions || 0

  // 扣除項目明細
  const deductions = [
    { item: '勞保費（員工自付）', amount: salaryRecord.labor_insurance },
    { item: '健保費（員工自付）', amount: salaryRecord.health_insurance },
    { item: '勞退自提', amount: salaryRecord.pension_employee },
    { item: '所得稅扣繳', amount: salaryRecord.income_tax },
  ]

  if (otherDeductions > 0) {
    deductions.push({ item: '其他扣除', amount: otherDeductions })
  }

  const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0)
  const netSalary = Math.round((salaryRecord.gross_salary - totalDeductions) * 100) / 100

  // 雇主負擔（供參考）
  const employerItems = [
    { item: '勞保費（雇主負擔）', amount: employerContributions.labor_insurance_employer || 0 },
    { item: '健保費（雇主負擔）', amount: employerContributions.health_insurance_employer || 0 },
    { item: '勞退提繳（雇主 6%）', amount: employerContributions.pension_employer || 0 },
  ]
  const totalEmployerContributions = employerItems.reduce((sum, d) => sum + d.amount, 0)

  // 年度累計
  const ytd = {
    gross: salaryRecord.ytd_gross || salaryRecord.gross_salary,
    tax: salaryRecord.ytd_tax || salaryRecord.income_tax,
    labor_insurance: salaryRecord.ytd_labor_insurance || salaryRecord.labor_insurance,
    health_insurance: salaryRecord.ytd_health_insurance || salaryRecord.health_insurance,
  }

  return {
    // 員工資訊
    employee_id: employee.id,
    employee_name: employee.name,
    department: employee.department || '',

    // 薪資期間
    period: salaryRecord.period,

    // 總額
    gross_salary: salaryRecord.gross_salary,

    // 扣除明細
    deductions,
    total_deductions: Math.round(totalDeductions * 100) / 100,

    // 實領
    net_salary: netSalary,

    // 雇主負擔（供參考）
    employer_contributions: employerItems,
    total_employer_contributions: Math.round(totalEmployerContributions * 100) / 100,

    // 年度累計
    ytd,

    // 產製時間
    generated_at: new Date().toISOString(),
  }
}

// ══════════════════════════════════════
//  5. 特休結轉 / 結算
// ══════════════════════════════════════

/**
 * 計算特休結轉
 *
 * 政策類型：
 * - 'carryover'：結轉至下一年度（最多保留 1 年）
 * - 'payout'：未休天數折算工資
 * - 'forfeit'：未休天數作廢（注意：依勞基法 §38-4，雇主應折算工資，不得任意作廢）
 *
 * @param {number} entitlement - 當年度特休天數
 * @param {number} used - 已使用天數
 * @param {'carryover'|'payout'|'forfeit'} policy - 結轉政策
 * @returns {{ entitlement: number, used: number, unused: number, policy: string, carryover_days: number, payout_days: number, forfeited_days: number, note: string }}
 */
export function calculateLeaveCarryover(entitlement, used, policy) {
  const unused = Math.max(0, entitlement - used)

  let carryoverDays = 0
  let payoutDays = 0
  let forfeitedDays = 0
  let note = ''

  switch (policy) {
    case 'carryover':
      // 最多結轉至下一年度，結轉天數不超過當年度應休天數
      carryoverDays = unused
      note = `${unused} 天結轉至下一年度（限一年內使用完畢）`
      break

    case 'payout':
      // 全數折算工資
      payoutDays = unused
      note = `${unused} 天未休折算工資（依勞基法 §38-4）`
      break

    case 'forfeit':
      // 法律上雇主仍須折算，但有些公司先做結轉提醒
      forfeitedDays = unused
      note = `${unused} 天作廢。提醒：依勞基法 §38-4，期滿未休之特休應折算工資。`
      break

    default:
      // 預設比照 payout
      payoutDays = unused
      note = `未指定政策，預設折算工資 ${unused} 天`
  }

  return {
    entitlement,
    used,
    unused,
    policy,
    carryover_days: carryoverDays,
    payout_days: payoutDays,
    forfeited_days: forfeitedDays,
    note,
  }
}

/**
 * 計算特休未休折算金額
 *
 * 依勞基法 §38-4：
 * 日薪 = 月薪 / 30
 *
 * @param {number} unusedDays - 未休天數
 * @param {number} dailyRate - 日薪（NT$）
 * @returns {{ unused_days: number, daily_rate: number, settlement_amount: number }}
 */
export function calculateLeaveSettlement(unusedDays, dailyRate) {
  const settlementAmount = Math.round(unusedDays * dailyRate * 100) / 100

  return {
    unused_days: unusedDays,
    daily_rate: dailyRate,
    settlement_amount: settlementAmount,
  }
}

// ══════════════════════════════════════
//  6. 福利管理
// ══════════════════════════════════════

/**
 * 標準福利項目（台灣中小企業常見）
 */
export const STANDARD_BENEFITS = [
  { id: 'meal', label: '伙食津貼', default_amount: 2400, taxable: false, note: '每月 NT$2,400 免稅' },
  { id: 'transport', label: '交通津貼', default_amount: 0, taxable: true, note: '依公司政策' },
  { id: 'phone', label: '通訊津貼', default_amount: 0, taxable: true, note: '依公司政策' },
  { id: 'housing', label: '住宅津貼', default_amount: 0, taxable: true, note: '依公司政策' },
  { id: 'professional', label: '專業加給', default_amount: 0, taxable: true, note: '依職級或證照' },
  { id: 'manager', label: '主管加給', default_amount: 0, taxable: true, note: '依職級' },
  { id: 'birthday_gift', label: '生日禮金', default_amount: 1000, taxable: false, note: '職工福利金（年度合計免稅額度內）' },
  { id: 'festival_bonus', label: '三節禮金', default_amount: 1000, taxable: false, note: '端午/中秋/春節（年度合計免稅額度內）' },
]

/**
 * 計算總薪酬成本（Total Compensation）
 *
 * 含：底薪 + 福利津貼 + 獎金 = 公司總支出
 *
 * @param {number} baseSalary - 月底薪
 * @param {{ id: string, amount: number }[]} benefits - 每月福利項目清單
 * @param {{ label: string, amount: number }[]} bonuses - 獎金清單（年度）
 * @returns {{ base_salary: number, monthly_benefits: number, monthly_benefits_detail: object[], annual_base: number, annual_benefits: number, annual_bonuses: number, annual_bonuses_detail: object[], total_annual_compensation: number, total_monthly_equivalent: number }}
 */
export function calculateTotalCompensation(baseSalary, benefits = [], bonuses = []) {
  // 每月福利明細
  const monthlyBenefitsDetail = benefits.map((b) => {
    const def = STANDARD_BENEFITS.find((sb) => sb.id === b.id)
    return {
      id: b.id,
      label: def ? def.label : b.id,
      amount: b.amount,
      taxable: def ? def.taxable : true,
    }
  })

  const monthlyBenefitsTotal = monthlyBenefitsDetail.reduce(
    (sum, b) => sum + b.amount, 0
  )

  // 年度獎金明細
  const annualBonusesDetail = bonuses.map((b) => ({
    label: b.label,
    amount: b.amount,
  }))

  const annualBonusesTotal = annualBonusesDetail.reduce(
    (sum, b) => sum + b.amount, 0
  )

  // 年度計算
  const annualBase = baseSalary * 12
  const annualBenefits = monthlyBenefitsTotal * 12
  const totalAnnualCompensation = annualBase + annualBenefits + annualBonusesTotal
  const totalMonthlyEquivalent = Math.round(totalAnnualCompensation / 12 * 100) / 100

  return {
    base_salary: baseSalary,
    monthly_benefits: Math.round(monthlyBenefitsTotal * 100) / 100,
    monthly_benefits_detail: monthlyBenefitsDetail,
    annual_base: annualBase,
    annual_benefits: Math.round(annualBenefits * 100) / 100,
    annual_bonuses: Math.round(annualBonusesTotal * 100) / 100,
    annual_bonuses_detail: annualBonusesDetail,
    total_annual_compensation: Math.round(totalAnnualCompensation * 100) / 100,
    total_monthly_equivalent: totalMonthlyEquivalent,
  }
}
