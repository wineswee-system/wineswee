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
 * 2026/115 適用費率與級距
 * - 基本工資：月薪 NT$29,500
 * - 勞保費率：12.5%（普通事故 11.5% + 就業保險 1%）
 * - 健保費率：5.17%
 * - 勞退雇主強制：6%
 * - 健保平均眷口數：0.56（2026 沿用 113 年調整值）
 *
 * 業務鐵則（與法規差異）：
 * - PT 勞保一律投保 11,100（forcePartTimeMin: true 預設）
 * - 投保基數 = 本薪 + 所有經常性津貼（不含加班費、不含獎金）
 * - 所得稅預設不代扣（員工 5 月自行申報）
 * - 加班費 / 遲到扣 / 缺勤扣 的時薪基準：
 *     正職 = (本薪 + 所有經常性津貼) / 30 / 8
 *     PT   = salary_structures.hourly_rate（如：220）
 *   （日薪同 hourly × 8）
 */

// ══════════════════════════════════════
//  投保薪資級距表
// ══════════════════════════════════════

/**
 * 勞工保險投保薪資級距（2026/115）
 * 來源：勞動部勞工保險局公告
 *
 * 法規結構：
 *  - 部分工時級距 (PT)：2 級 — 11,100、12,540
 *    （月薪資總額 ≤ 11,100 投 11,100；11,101~12,540 投 12,540；
 *      超過 12,540 必須回到全時表，最低 29,500）
 *  - 全時級距：11 級 — 29,500 ~ 45,800（2026 基本工資 29,500 起）
 *
 * 業務鐵則：PT 一律投保 11,100（forcePartTimeMin: true 預設）。
 *           實務上 PT_BRACKETS 第 2 級 (12,540) 因此不會用到，
 *           但仍保留陣列以對齊法規定義（避免未來改業務規則需要）。
 */
export const LABOR_INSURANCE_PT_BRACKETS = [11100, 12540];
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
 * 業務鐵則：PT 一律以此投保。
 */
export const LABOR_INSURANCE_PT_MIN = 11100;

/**
 * 全民健保投保薪資級距（2026/115年）
 * 來源：衛福部中央健康保險署 115/01/01 適用級距金額表
 *
 * 此為 hardcoded fallback；正式計算請從 DB 載入：
 *   import { loadInsuranceBrackets } from './insuranceBrackets'
 *   const b = await loadInsuranceBrackets(2026)
 *   calculateHealthInsurance(salary, { dependents, brackets: b.health })
 */
export const HEALTH_INSURANCE_BRACKETS = [
  29500, 30300, 31800, 33300, 34800, 36300,
  38200, 40100, 42000, 43900, 45800, 48200,
  50600, 53000, 55400, 57800, 60800, 63800,
  66800, 69800, 72800, 76500, 80200, 83900,
  87600, 92100, 96600, 101100, 105600, 110100,
  115500, 120900, 126300, 131700, 137100, 142500,
  147900, 150000, 156400, 162800, 169200, 175600,
  182000, 189500, 197000, 204500, 212000, 219500,
  228200, 236900, 245600, 254300, 263000, 273000,
  283000, 293000, 303000, 313000,
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
 * 計算當月在職天數（給新進、離職、留停切換月使用）
 *
 * 全部用 local midnight 比對，避開 JS Date 'YYYY-MM-DD' 字串會被當 UTC 解析的時區陷阱
 * （例：'2026-04-07' 在 UTC+8 會解成 4/7 早上 8 點，跟 4/30 午夜相減少 1 天）。
 *
 * @param {string|Date} hireDate - 到職日（含當天）
 * @param {string|Date|null} resignDate - 離職日（含當天），null 表示在職中
 * @param {string} payPeriod - 'YYYY-MM' 計薪月份
 * @returns {{ inServiceDays: number, monthDays: number }}
 */
export function calculateInServiceDays(hireDate, resignDate, payPeriod) {
  // 把 Date 或 'YYYY-MM-DD' 字串都拉到「該日的 local midnight」整數時間戳，
  // 用整數天數差直接算，避開時區/小時誤差。
  const toLocalMidnight = (input) => {
    if (input == null) return null;
    if (input instanceof Date) {
      return new Date(input.getFullYear(), input.getMonth(), input.getDate());
    }
    // 字串 → 切 'YYYY-MM-DD'（也能容忍 'YYYY-MM-DDTHH:MM:SS'）
    const m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };

  const [year, month] = payPeriod.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0); // 該月最後一天
  const monthDays = monthEnd.getDate();

  const hire = toLocalMidnight(hireDate) || monthStart;
  const resign = toLocalMidnight(resignDate) || monthEnd;

  // 該月在職起訖（取交集）
  const periodStart = hire > monthStart ? hire : monthStart;
  const periodEnd = resign < monthEnd ? resign : monthEnd;

  if (periodEnd < periodStart) {
    return { inServiceDays: 0, monthDays };
  }

  // 兩個 date 都是 local midnight，相減一定是整數天 × 86400000
  const inServiceDays = Math.round((periodEnd - periodStart) / (1000 * 60 * 60 * 24)) + 1;
  return { inServiceDays, monthDays };
}

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
 * @param {number} [options.employeeAge=30]
 * @param {boolean} [options.isPartTime=false]
 * @param {boolean} [options.forcePartTimeMin=true] - PT 是否強制 11,100
 * @param {Array} [options.brackets] - DB labor_ins_brackets 陣列（推薦）
 *   若提供 → 用 DB 的 employee_premium/employer_premium（含災保，官方公告值）
 *   若不提供 → fallback 走 hardcoded 級距 + 公式計算（向下相容）
 * @returns {{ insured_salary: number, employee_share: number, employer_share: number, total: number }}
 */
export function calculateLaborInsurance(monthlySalary, options = {}) {
  const opts = typeof options === 'number' ? { employeeAge: options } : options;
  const {
    employeeAge = 30,
    isPartTime = false,
    // 業務鐵則：所有 PT 一律投保 11,100（不論實薪多少）。
    // 設 false 才走法規版本（依實薪對齊 PT 2 級或全時級距）。
    forcePartTimeMin = true,
    brackets,
  } = opts;

  // ── 路徑 A：用 DB brackets（推薦）──
  if (Array.isArray(brackets) && brackets.length > 0) {
    let row
    if (isPartTime && forcePartTimeMin) {
      row = brackets.find(b => b.insured_salary === 11100)
    } else {
      // FT 從 29,500 起算
      // 勞保法定上限 45,800（grade 35）—— 在這裡 cap 月薪，
      // 不依賴呼叫端先 cap，這樣健保用同一份 monthlySalary 才不會被誤拖低
      const cappedSalary = Math.min(monthlySalary, 45800)
      row = brackets.find(b => b.insured_salary >= 29500 && b.insured_salary >= cappedSalary)
        || brackets.find(b => b.insured_salary === 45800)
        || brackets[brackets.length - 1]
    }
    if (row) {
      let empShare = row.employee_premium || 0
      let erShare  = row.employer_premium || 0
      // 65 歲以上免就保 → 員工/雇主皆扣掉就保 1% 對應份額
      if (employeeAge >= 65) {
        empShare = Math.max(0, empShare - Math.round(row.insured_salary * 0.01 * 0.2))
        erShare  = Math.max(0, erShare  - Math.round(row.insured_salary * 0.01 * 0.7))
      }
      return {
        insured_salary: row.insured_salary,
        employee_share: empShare,
        employer_share: erShare,
        total: empShare + erShare,
      }
    }
    // row 找不到 → 落到下面 hardcoded path
  }

  // ── 路徑 B：hardcoded fallback（向下相容）──
  let insuredSalary;
  if (isPartTime) {
    if (forcePartTimeMin) {
      insuredSalary = LABOR_INSURANCE_PT_MIN;
    } else {
      insuredSalary = matchBracket(monthlySalary, LABOR_INSURANCE_BRACKETS);
    }
  } else {
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
 * 雇主端：以「1 + 全國平均眷口數 0.56」= 1.56 計算（雇主負擔已內含此係數）
 *
 * 健保無 PT 例外 — 受僱者一律從第 1 級 29,500 起跳。
 *
 * @param {number} monthlySalary
 * @param {object|number} [options=0] - 眷屬數（舊用法）或物件 { dependents, brackets, isPartTime }
 * @param {number} [options.dependents=0]
 * @param {Array} [options.brackets] - DB health_ins_brackets 陣列（推薦）
 *   若提供 → 用 DB 的 employee_premium（本人份額）× (1+眷屬數) 與 employer_premium（已含 1.56 倍係數）
 *   若不提供 → fallback 走 hardcoded 級距 + 公式計算
 * @returns {{ insured_salary: number, employee_share: number, employer_share: number, dependents: number }}
 */
export function calculateHealthInsurance(monthlySalary, options = 0) {
  const opts = typeof options === 'number' ? { dependents: options } : options;
  const { dependents = 0, brackets } = opts;
  const cappedDependents = Math.min(dependents, 3);

  // ── 路徑 A：用 DB brackets（推薦）──
  if (Array.isArray(brackets) && brackets.length > 0) {
    const row = brackets.find(b => b.insured_salary >= 29500 && b.insured_salary >= monthlySalary)
      || brackets[brackets.length - 1]
    if (row) {
      // employee_premium = 本人份額（DB 已四捨五入過官方公告值）
      // 眷屬以本人份額 × (1+N) 計算（official 健保表也是這樣定義）
      const employeeShare = (row.employee_premium || 0) * (1 + cappedDependents)
      // employer_premium 已內含 1.56 倍係數，不另乘
      const employerShare = row.employer_premium || 0
      return {
        insured_salary: row.insured_salary,
        employee_share: employeeShare,
        employer_share: employerShare,
        dependents: cappedDependents,
      }
    }
  }

  // ── 路徑 B：hardcoded fallback ──
  const insuredSalary = matchBracket(monthlySalary, HEALTH_INSURANCE_BRACKETS);
  const premiumRate = 0.0517;
  const employerCoefficient = 1.56;

  const employeeShare = Math.round(insuredSalary * premiumRate * 0.3 * (1 + cappedDependents));
  const employerShare = Math.round(insuredSalary * premiumRate * 0.6 * employerCoefficient);

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
    // 新增：DB brackets（推薦，從 insuranceBrackets.loadInsuranceBrackets() 拿）
    //   { labor: [...], health: [...] }
    //   未傳 → calculateLaborInsurance/HealthInsurance 走 hardcoded fallback
    brackets,
    // 新增：員工是否有保勞保 / 健保（false → 該險自付歸 0、雇主負擔也歸 0）
    skipLaborInsurance = false,
    skipHealthInsurance = false,
  } = options;

  // 應發薪資總額
  const totalGross = grossSalary + overtimePay + bonus;

  // 投保金額（沒傳就 fallback 用 grossSalary）
  const insuranceBase = insuredSalary != null ? insuredSalary : grossSalary;

  // 勞保（toggle off → 全歸 0）
  const labor = skipLaborInsurance
    ? { employee_share: 0, employer_share: 0, insured_salary: 0 }
    : calculateLaborInsurance(insuranceBase, {
        employeeAge, isPartTime,
        brackets: brackets?.labor,
      });
  const laborInsurance = labor.employee_share;

  // 健保（toggle off → 全歸 0）
  const health = skipHealthInsurance
    ? { employee_share: 0, employer_share: 0, insured_salary: 0 }
    : calculateHealthInsurance(insuranceBase, {
        dependents, isPartTime,
        brackets: brackets?.health,
      });
  const healthInsurance = health.employee_share;

  // 勞退自提（以底薪計算）
  const pension = calculateLaborPension(grossSalary, voluntaryPensionRate);
  const pensionSelfContribution = pension.employee_voluntary;

  // 所得稅：預設不扣（個人 5 月自行申報）；若公司要代扣可設 withholdTax: true
  const incomeTax = withholdTax ? calculateMonthlyWithholding(totalGross).withholding_amount : 0;

  // 扣除合計
  const totalDeductions =
    laborInsurance + healthInsurance + pensionSelfContribution + incomeTax + otherDeductions;

  // 實領薪資 — 無條件進位到整數元
  const netSalary = Math.ceil(totalGross - totalDeductions);

  // 雇主負擔合計（不計入員工扣項，僅供 audit 報表用）
  const employerTotalCost = totalGross + labor.employer_share + health.employer_share + pension.employer_contribution;

  return {
    gross: totalGross,
    // 投保金額（給薪資單顯示）
    insuredLabor: labor.insured_salary,
    insuredHealth: health.insured_salary,
    // 員工自付
    laborInsurance,
    healthInsurance,
    pension: pensionSelfContribution,
    incomeTax,
    totalDeductions,
    netSalary,
    // 雇主負擔（給薪資單顯示，不影響 netSalary）
    laborEmployer: labor.employer_share,
    healthEmployer: health.employer_share,
    pensionEmployer: pension.employer_contribution,
    employerTotalCost,
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
