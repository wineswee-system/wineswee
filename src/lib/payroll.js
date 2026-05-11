/**
 * 台灣薪資計算引擎 — 勞健保 & 所得稅
 *
 * 涵蓋：
 * 1. 勞工保險（勞保）— 普通事故 + 就業保險
 * 2. 全民健康保險（健保）
 * 3. 勞工退休金（新制 6%）
 * 4. 所得稅扣繳（薪資所得扣繳稅額表）
 * 5. 每月實領薪資計算
 *
 * 2026 適用費率與級距
 * - 基本工資：月薪 NT$29,500
 * - 勞保費率：12%（普通事故 + 就業保險）
 * - 健保費率：5.17%
 * - 勞退雇主提繳：6%
 */

// ══════════════════════════════════════
//  投保薪資級距表
// ══════════════════════════════════════

/**
 * 勞工保險投保薪資級距（2025/114 + 2026/115 通用）
 * 來源：勞動部勞工保險局公告
 *
 * 結構：
 *  - PT 部分工時級距：11,100 ~ 28,590（17 級）
 *  - 正職級距：29,500 ~ 45,800（最高 11 級，2026 基本工資 29,500 起）
 *  - 註：2025/01 起最低 28,800、2026/01 起最低 29,500
 */
export const LABOR_INSURANCE_PT_BRACKETS = [
  11100, 12540, 13500, 15840, 16500, 17280, 17880,
  19047, 20008, 21009, 22000, 23100, 24000, 25250,
  26400, 27600, 28590,
];
export const LABOR_INSURANCE_FT_BRACKETS = [
  29500, 30300, 31800, 33300, 34800, 36300,
  38200, 40100, 42000, 43900, 45800,
];
export const LABOR_INSURANCE_BRACKETS = [
  ...LABOR_INSURANCE_PT_BRACKETS,
  ...LABOR_INSURANCE_FT_BRACKETS,
];

/**
 * 部分工時勞工最低投保級距（勞保）
 * 時薪 PT 實際薪資不滿基本工資時適用
 */
export const LABOR_INSURANCE_PT_MIN = 11100;

/**
 * 全民健保投保薪資級距（2026/115年）
 * 53 級，最低 NT$29,500 ～ 最高 NT$313,000
 * 來源：衛福部中央健康保險署 115/01/01 適用
 */
export const HEALTH_INSURANCE_BRACKETS = [
  29500, 30300, 31800, 33300, 34800, 36300,
  38200, 40100, 42000, 43900, 45800, 48200,
  50600, 53000, 55400, 57800, 60800, 63800,
  66800, 69800, 72800, 76500, 80200, 83900,
  87600, 92100, 96600, 101100, 105600, 110100,
  115500, 120900, 126300, 131700, 137100, 142500,
  147900, 156400, 162800, 169200, 175600, 182000,
  189500, 197000, 204500, 212000, 219500, 228000,
  240000, 252000, 264000, 276000, 288000, 300000,
  313000,
];

/**
 * 部分工時健保最低投保級距（= 健保第 1 級）
 */
export const HEALTH_INSURANCE_PT_MIN = 29500;

/**
 * 勞退月提繳工資級距（2026）
 * 天花板 NT$150,000
 */
const PENSION_WAGE_CEILING = 150000;

// ══════════════════════════════════════
//  工具函數
// ══════════════════════════════════════

/**
 * 對應投保薪資級距 — 取不低於實際薪資的最近級距
 * @param {number} salary - 實際月薪
 * @param {number[]} brackets - 級距表
 * @returns {number} 投保薪資
 */
function matchBracket(salary, brackets) {
  const min = brackets[0];
  const max = brackets[brackets.length - 1];

  if (salary <= min) return min;
  if (salary >= max) return max;

  // 找到第一個 >= salary 的級距
  for (let i = 0; i < brackets.length; i++) {
    if (brackets[i] >= salary) {
      return brackets[i];
    }
  }
  return max;
}

// ══════════════════════════════════════
//  1. 勞工保險計算
// ══════════════════════════════════════

/**
 * 計算勞工保險費（2026/115年）
 *
 * 費率：
 * - 普通事故保險 11.5% + 就業保險 1% = 12.5%
 * - 分攤比例：勞工 20%、雇主 70%、政府 10%
 * - 65 歲以上免就保 → 11.5%
 *
 * 部分工時 PT：強制最低投保 NT$11,100
 *
 * @param {number} monthlySalary - 月薪
 * @param {object} [options={}]
 * @param {number} [options.employeeAge=30] - 員工年齡
 * @param {boolean} [options.isPartTime=false] - 是否部分工時 PT
 * @returns {{ insured_salary: number, employee_share: number, employer_share: number, total: number }}
 */
export function calculateLaborInsurance(monthlySalary, options = {}) {
  const opts = typeof options === 'number' ? { employeeAge: options } : options;
  const {
    employeeAge = 30,
    isPartTime = false,
    // 廠商實務：所有 PT 一律投保最低 11,100（即使實薪更高）
    // 設 false 才按法規依實薪對齊 PT 級距
    forcePartTimeMin = true,
  } = opts;

  let insuredSalary;
  if (isPartTime) {
    if (forcePartTimeMin) {
      // 廠商實務：固定 11,100（少投保，違反勞動部規定但常見）
      insuredSalary = LABOR_INSURANCE_PT_MIN;
    } else {
      // 法規：按實薪對齊 PT 級距 (11,100~28,590) 或正職級距 (29,500+)
      insuredSalary = Math.max(
        LABOR_INSURANCE_PT_MIN,
        matchBracket(monthlySalary, LABOR_INSURANCE_BRACKETS)
      );
    }
  } else {
    // 月薪正職：按 base+role 對齊正職級距 (29,500~45,800)
    insuredSalary = matchBracket(monthlySalary, LABOR_INSURANCE_FT_BRACKETS);
  }

  // 65 歲以上免就保 → 僅普通事故 11.5%
  const premiumRate = employeeAge >= 65 ? 0.115 : 0.125;

  const employeeShare = Math.round(insuredSalary * premiumRate * 0.2);
  const employerShare = Math.round(insuredSalary * premiumRate * 0.7);
  const total = Math.round(insuredSalary * premiumRate);

  return { insured_salary: insuredSalary, employee_share: employeeShare, employer_share: employerShare, total };
}

// ══════════════════════════════════════
//  2. 全民健保計算
// ══════════════════════════════════════

/**
 * 計算全民健康保險費（2026/115年）
 *
 * 費率：5.17%
 * 分攤比例：被保險人 30%、雇主 60%、政府 10%
 * 眷屬：本人 + 眷屬（最多計 3 口）
 * 雇主：以平均眷口數 0.57 計算
 *
 * 部分工時 PT：強制最低投保 NT$29,500
 *
 * @param {number} monthlySalary - 月薪
 * @param {object|number} [options=0] - 眷屬數（舊用法）或物件 { dependents, isPartTime }
 * @returns {{ insured_salary: number, employee_share: number, employer_share: number, dependents: number }}
 */
export function calculateHealthInsurance(monthlySalary, options = 0) {
  const opts = typeof options === 'number' ? { dependents: options } : options;
  const { dependents = 0, isPartTime = false } = opts;

  let insuredSalary;
  if (isPartTime) {
    // PT 最低 29,500；超過依級距匹配
    insuredSalary = Math.max(HEALTH_INSURANCE_PT_MIN, matchBracket(monthlySalary, HEALTH_INSURANCE_BRACKETS));
  } else {
    insuredSalary = matchBracket(monthlySalary, HEALTH_INSURANCE_BRACKETS);
  }

  const premiumRate = 0.0517;
  const cappedDependents = Math.min(dependents, 3);
  const avgDependentsRatio = 1.57;

  const employeeShare = Math.round(insuredSalary * premiumRate * 0.3 * (1 + cappedDependents));
  const employerShare = Math.round(insuredSalary * premiumRate * 0.6 * avgDependentsRatio);

  return { insured_salary: insuredSalary, employee_share: employeeShare, employer_share: employerShare, dependents: cappedDependents };
}

// ══════════════════════════════════════
//  3. 勞工退休金（新制）
// ══════════════════════════════════════

/**
 * 計算勞工退休金提繳金額
 *
 * - 雇主強制提繳：月提繳工資 × 6%
 * - 勞工自願提繳：月提繳工資 × 0~6%（可從薪資所得中扣除，節稅用）
 * - 月提繳工資上限：NT$150,000
 *
 * @param {number} monthlySalary - 月薪
 * @param {number} [voluntaryRate=0] - 勞工自願提繳比率（0~6%）
 * @returns {{ employer_contribution: number, employee_voluntary: number, wage_grade: number }}
 */
export function calculateLaborPension(monthlySalary, voluntaryRate = 0) {
  // 月提繳工資不得超過上限
  const wageGrade = Math.min(monthlySalary, PENSION_WAGE_CEILING);

  // 雇主強制提繳 6%
  const employerContribution = Math.round(wageGrade * 0.06);

  // 勞工自願提繳（0% ~ 6%）
  const clampedRate = Math.max(0, Math.min(voluntaryRate, 0.06));
  const employeeVoluntary = Math.round(wageGrade * clampedRate);

  return {
    employer_contribution: employerContribution,
    employee_voluntary: employeeVoluntary,
    wage_grade: wageGrade,
  };
}

// ══════════════════════════════════════
//  4. 所得稅扣繳計算（年度）
// ══════════════════════════════════════

/**
 * 2026 綜合所得稅稅率級距
 */
const TAX_BRACKETS = [
  { min: 0,         max: 590000,   rate: 0.05, cumDeduction: 0 },
  { min: 590001,    max: 1330000,  rate: 0.12, cumDeduction: 41300 },
  { min: 1330001,   max: 2660000,  rate: 0.20, cumDeduction: 147700 },
  { min: 2660001,   max: 4980000,  rate: 0.30, cumDeduction: 413700 },
  { min: 4980001,   max: Infinity, rate: 0.40, cumDeduction: 911700 },
];

/**
 * 2026 免稅額與扣除額
 */
const TAX_CONSTANTS = {
  personalExemption: 97000,        // 個人免稅額
  standardDeductionSingle: 131000, // 標準扣除額（單身）
  standardDeductionMarried: 262000,// 標準扣除額（已婚合併）
  salarySpecialDeduction: 218000,  // 薪資所得特別扣除額
};

/**
 * 計算年度所得稅估算
 *
 * @param {number} annualSalary - 年薪總額
 * @param {object} [deductions={}] - 扣除額選項
 * @param {boolean} [deductions.married=false] - 是否已婚
 * @param {number} [deductions.dependentCount=0] - 扶養親屬人數
 * @param {number} [deductions.itemizedDeductions=0] - 列舉扣除額（若 > 標準扣除額則採用）
 * @param {number} [deductions.voluntaryPension=0] - 勞退自提金額（免稅）
 * @param {number} [deductions.otherSpecialDeductions=0] - 其他特別扣除額
 * @returns {{ monthly_withholding: number, annual_estimated_tax: number, effective_rate: number }}
 */
export function calculateIncomeTax(annualSalary, deductions = {}) {
  const {
    married = false,
    dependentCount = 0,
    itemizedDeductions = 0,
    voluntaryPension = 0,
    otherSpecialDeductions = 0,
  } = deductions;

  // 免稅額 = 本人 + 配偶(若已婚) + 扶養人數
  const exemptionPersons = 1 + (married ? 1 : 0) + dependentCount;
  const totalExemption = TAX_CONSTANTS.personalExemption * exemptionPersons;

  // 標準扣除額 vs 列舉扣除額，取高者
  const standardDeduction = married
    ? TAX_CONSTANTS.standardDeductionMarried
    : TAX_CONSTANTS.standardDeductionSingle;
  const generalDeduction = Math.max(standardDeduction, itemizedDeductions);

  // 特別扣除額 = 薪資特別扣除額 + 其他
  const specialDeduction =
    TAX_CONSTANTS.salarySpecialDeduction + otherSpecialDeductions;

  // 所得淨額 = 年薪 - 勞退自提(免稅) - 免稅額 - 一般扣除額 - 特別扣除額
  const taxableIncome = Math.max(
    0,
    annualSalary - voluntaryPension - totalExemption - generalDeduction - specialDeduction
  );

  // 依稅率級距計算應納稅額
  let annualTax = 0;
  for (const bracket of TAX_BRACKETS) {
    if (taxableIncome >= bracket.min) {
      annualTax = Math.round(taxableIncome * bracket.rate - bracket.cumDeduction);
    }
  }
  annualTax = Math.max(0, annualTax);

  // 月均扣繳（年稅 / 12）
  const monthlyWithholding = Math.round(annualTax / 12);

  // 有效稅率
  const effectiveRate =
    annualSalary > 0
      ? Math.round((annualTax / annualSalary) * 10000) / 10000
      : 0;

  return {
    monthly_withholding: monthlyWithholding,
    annual_estimated_tax: annualTax,
    effective_rate: effectiveRate,
  };
}

// ══════════════════════════════════════
//  5. 每月薪資扣繳（簡易法）
// ══════════════════════════════════════

/**
 * 每月薪資所得扣繳速算
 *
 * 依據薪資所得扣繳稅額表（簡化版）：
 * - 月薪 ≤ NT$40,020：免扣繳
 * - NT$40,021 ~ NT$60,000：超過 NT$40,020 部分 × 5%
 * - NT$60,001 ~ NT$80,000：NT$999 + 超過 NT$60,000 部分 × 12%
 * - NT$80,001 ~ NT$120,000：NT$3,399 + 超過 NT$80,000 部分 × 20%
 * - NT$120,001 以上：NT$11,399 + 超過 NT$120,000 部分 × 30%
 *
 * @param {number} monthlySalary - 月薪（扣繳前）
 * @returns {{ withholding_amount: number, rate: string }}
 */
export function calculateMonthlyWithholding(monthlySalary) {
  if (monthlySalary <= 40020) {
    return { withholding_amount: 0, rate: '0%' };
  }

  if (monthlySalary <= 60000) {
    const amount = Math.round((monthlySalary - 40020) * 0.05);
    return { withholding_amount: amount, rate: '5%' };
  }

  if (monthlySalary <= 80000) {
    const amount = Math.round(999 + (monthlySalary - 60000) * 0.12);
    return { withholding_amount: amount, rate: '12%' };
  }

  if (monthlySalary <= 120000) {
    const amount = Math.round(3399 + (monthlySalary - 80000) * 0.20);
    return { withholding_amount: amount, rate: '20%' };
  }

  // 超過 120,000
  const amount = Math.round(11399 + (monthlySalary - 120000) * 0.30);
  return { withholding_amount: amount, rate: '30%' };
}

// ══════════════════════════════════════
//  6. 計算實領薪資（每月）
// ══════════════════════════════════════

/**
 * 計算每月實領薪資（淨額）
 *
 * gross（應發）= 底薪 + 加班費 + 獎金
 * net（實領）= gross - 勞保 - 健保 - 勞退自提 - 所得稅扣繳
 *
 * @param {number} grossSalary - 底薪（月薪）
 * @param {object} [options={}] - 其他選項
 * @param {number} [options.dependents=0] - 健保眷屬人數
 * @param {number} [options.voluntaryPensionRate=0] - 勞退自願提繳比率（0~0.06）
 * @param {number} [options.overtimePay=0] - 加班費
 * @param {number} [options.bonus=0] - 獎金
 * @param {number} [options.otherDeductions=0] - 其他扣款（請假扣薪等）
 * @param {number} [options.employeeAge=30] - 員工年齡
 * @returns {{
 *   gross: number,
 *   laborInsurance: number,
 *   healthInsurance: number,
 *   pension: number,
 *   incomeTax: number,
 *   totalDeductions: number,
 *   netSalary: number
 * }}
 */
export function calculateNetSalary(grossSalary, options = {}) {
  const {
    dependents = 0,
    voluntaryPensionRate = 0,
    overtimePay = 0,
    bonus = 0,
    otherDeductions = 0,
    employeeAge = 30,
    // 新增：投保薪資基數（不傳就用 grossSalary）
    // 廠商規則：月薪人員用 base + role_allowance，PT 用 PT 最低
    insuredSalary,
    // 新增：是否部分工時 PT
    isPartTime = false,
    // 新增：是否扣所得稅（個人申報為主，預設不扣）
    withholdTax = false,
  } = options;

  // 應發薪資總額
  const totalGross = grossSalary + overtimePay + bonus;

  // 投保金額（沒傳就 fallback 用 grossSalary）
  const insuranceBase = insuredSalary != null ? insuredSalary : grossSalary;

  // 勞保
  const labor = calculateLaborInsurance(insuranceBase, { employeeAge, isPartTime });
  const laborInsurance = labor.employee_share;

  // 健保
  const health = calculateHealthInsurance(insuranceBase, { dependents, isPartTime });
  const healthInsurance = health.employee_share;

  // 勞退自提（以底薪計算）
  const pension = calculateLaborPension(grossSalary, voluntaryPensionRate);
  const pensionSelfContribution = pension.employee_voluntary;

  // 所得稅：預設不扣（個人 5 月自行申報）；若公司要代扣可設 withholdTax: true
  const incomeTax = withholdTax ? calculateMonthlyWithholding(totalGross).withholding_amount : 0;

  // 扣除合計
  const totalDeductions =
    laborInsurance + healthInsurance + pensionSelfContribution + incomeTax + otherDeductions;

  // 實領薪資
  const netSalary = totalGross - totalDeductions;

  return {
    gross: totalGross,
    laborInsurance,
    healthInsurance,
    pension: pensionSelfContribution,
    incomeTax,
    totalDeductions,
    netSalary,
  };
}

// ══════════════════════════════════════
//  7. 特休未休折算工資
// ══════════════════════════════════════

/**
 * 計算特休未休折算工資（勞基法 §38-4）
 * 到職週年未休完的特休，應於次月薪資結清折算
 *
 * @param {number} baseSalary - 月薪
 * @param {number} unusedDays - 未休天數
 * @returns {{ dailyRate: number, totalPayout: number }}
 */
export function calculateAnnualLeavePayout(baseSalary, unusedDays) {
  const dailyRate = Math.round(baseSalary / 30)
  const totalPayout = dailyRate * unusedDays
  return { dailyRate, totalPayout }
}

// ══════════════════════════════════════
//  8. 加班費計算（勞基法 §24）
// ══════════════════════════════════════

/**
 * 計算加班費
 *
 * 平日加班：
 * - 前 2 小時：時薪 × 1.34（加給 1/3）
 * - 第 3~4 小時：時薪 × 1.67（加給 2/3）
 *
 * 休息日加班：
 * - 前 2 小時：時薪 × 1.34
 * - 第 3~8 小時：時薪 × 1.67
 * - 第 9~12 小時：時薪 × 2.67
 *
 * 國定假日/例假日加班：
 * - 全額加倍：時薪 × 2
 *
 * @param {number} baseSalary - 月薪
 * @param {number} hours - 加班時數
 * @param {'weekday'|'restday'|'holiday'} type - 加班類型
 * @returns {{ hourlyRate: number, overtimePay: number, breakdown: string }}
 */
export function calculateOvertimePay(baseSalary, hours, type = 'weekday') {
  const hourlyRate = Math.round(baseSalary / 30 / 8)
  let pay = 0
  let breakdown = ''

  if (type === 'holiday') {
    // 國定假日/例假日：加倍
    pay = hourlyRate * 2 * hours
    breakdown = `${hours}h × ${hourlyRate} × 2 = ${pay}`
  } else if (type === 'restday') {
    // 休息日
    const h1 = Math.min(hours, 2)
    const h2 = Math.min(Math.max(hours - 2, 0), 6)
    const h3 = Math.max(hours - 8, 0)
    pay = Math.round(hourlyRate * h1 * 1.34 + hourlyRate * h2 * 1.67 + hourlyRate * h3 * 2.67)
    breakdown = `前${h1}h×1.34${h2 > 0 ? ` + ${h2}h×1.67` : ''}${h3 > 0 ? ` + ${h3}h×2.67` : ''}`
  } else {
    // 平日
    const h1 = Math.min(hours, 2)
    const h2 = Math.max(hours - 2, 0)
    pay = Math.round(hourlyRate * h1 * 1.34 + hourlyRate * h2 * 1.67)
    breakdown = `前${h1}h×1.34${h2 > 0 ? ` + ${h2}h×1.67` : ''}`
  }

  return { hourlyRate, overtimePay: pay, breakdown }
}
