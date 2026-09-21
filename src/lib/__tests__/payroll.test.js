import { describe, it, expect } from 'vitest'
import {
  LABOR_INSURANCE_BRACKETS,
  HEALTH_INSURANCE_BRACKETS,
  calculateLaborInsurance,
  calculateHealthInsurance,
  calculateLaborPension,
  calculateIncomeTax,
  calculateMonthlyWithholding,
  calculateNetSalary,
} from '../payroll.js'

// ═════════════════════════════════════════════════════════════
//  Bracket Tables Sanity
// ═════════════════════════════════════════════════════════════

describe('Bracket Tables (hardcoded fallback)', () => {
  it('labor insurance brackets are sorted ascending', () => {
    for (let i = 1; i < LABOR_INSURANCE_BRACKETS.length; i++) {
      expect(LABOR_INSURANCE_BRACKETS[i]).toBeGreaterThan(LABOR_INSURANCE_BRACKETS[i - 1])
    }
  })

  it('labor insurance starts with PT min 11100, ends at 45800', () => {
    expect(LABOR_INSURANCE_BRACKETS[0]).toBe(11100)
    expect(LABOR_INSURANCE_BRACKETS[LABOR_INSURANCE_BRACKETS.length - 1]).toBe(45800)
  })

  it('health insurance brackets are sorted ascending', () => {
    for (let i = 1; i < HEALTH_INSURANCE_BRACKETS.length; i++) {
      expect(HEALTH_INSURANCE_BRACKETS[i]).toBeGreaterThan(HEALTH_INSURANCE_BRACKETS[i - 1])
    }
  })

  it('health insurance ends at 313000 (2026 cap)', () => {
    expect(HEALTH_INSURANCE_BRACKETS[HEALTH_INSURANCE_BRACKETS.length - 1]).toBe(313000)
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateLaborInsurance
// ═════════════════════════════════════════════════════════════

describe('calculateLaborInsurance (hardcoded path)', () => {
  // 2026 費率：普通事故 11.5% + 就保 1% = 12.5%；65+ 免就保 → 11.5%
  it('HR-U01: minimum bracket for low salary', () => {
    const result = calculateLaborInsurance(25000)
    expect(result.insured_salary).toBe(29500)
    expect(result.employee_share).toBe(Math.round(29500 * 0.125 * 0.2))
    expect(result.employer_share).toBe(Math.round(29500 * 0.125 * 0.7))
  })

  it('HR-U02: maximum bracket for high salary (cap 45800)', () => {
    const result = calculateLaborInsurance(80000)
    expect(result.insured_salary).toBe(45800)
    expect(result.employee_share).toBe(Math.round(45800 * 0.125 * 0.2))
  })

  it('HR-U03: mid bracket lookup', () => {
    const result = calculateLaborInsurance(36000)
    // 36000 落在 34800~36300 級 → 取 36300
    expect(result.insured_salary).toBe(36300)
  })

  it('uses 11.5% rate for age >= 65 (no 就保)', () => {
    const result = calculateLaborInsurance(35000, { employeeAge: 65 })
    expect(result.employee_share).toBe(Math.round(result.insured_salary * 0.115 * 0.2))
    expect(result.employer_share).toBe(Math.round(result.insured_salary * 0.115 * 0.7))
  })

  it('employee + employer + gov = total', () => {
    const result = calculateLaborInsurance(40000)
    expect(result.total).toBe(Math.round(result.insured_salary * 0.125))
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateLaborInsurance — DB brackets path（新）
// ═════════════════════════════════════════════════════════════

// 模擬 DB labor_ins_brackets 列（2026 級距，含官方公告 premium）
const MOCK_LABOR_2026 = [
  { year: 2026, grade:  8, insured_salary: 11100, min_salary:  9901, employee_premium:  277, employer_premium: 1034 }, // PT min
  { year: 2026, grade: 25, insured_salary: 29500, min_salary: 28591, employee_premium:  738, employer_premium: 2644 },
  { year: 2026, grade: 30, insured_salary: 36300, min_salary: 34801, employee_premium:  908, employer_premium: 3252 },
  { year: 2026, grade: 35, insured_salary: 45800, min_salary: 43901, employee_premium: 1145, employer_premium: 4104 }, // cap
  { year: 2026, grade: 40, insured_salary: 57800, min_salary: 55401, employee_premium: 1145, employer_premium: 4129 }, // 凍結
]

describe('calculateLaborInsurance (DB brackets path)', () => {
  it('uses DB employee_premium for FT min', () => {
    const result = calculateLaborInsurance(25000, { brackets: MOCK_LABOR_2026 })
    expect(result.insured_salary).toBe(29500)
    expect(result.employee_share).toBe(738) // DB 官方值，不是公式算
    expect(result.employer_share).toBe(2644)
  })

  it('uses DB employee_premium for mid bracket', () => {
    const result = calculateLaborInsurance(36000, { brackets: MOCK_LABOR_2026 })
    expect(result.insured_salary).toBe(36300)
    expect(result.employee_share).toBe(908)
    expect(result.employer_share).toBe(3252)
  })

  it('PT forcePartTimeMin uses 11100 DB row', () => {
    const result = calculateLaborInsurance(15000, { brackets: MOCK_LABOR_2026, isPartTime: true })
    expect(result.insured_salary).toBe(11100)
    expect(result.employee_share).toBe(277)
  })

  it('65+ subtracts 就保 share from DB premium', () => {
    const result = calculateLaborInsurance(35000, { brackets: MOCK_LABOR_2026, employeeAge: 65 })
    // grade 30, insured 36300, employee 908 - round(36300*0.01*0.2) = 908 - 73 = 835
    expect(result.insured_salary).toBe(36300)
    expect(result.employee_share).toBe(908 - Math.round(36300 * 0.01 * 0.2))
    expect(result.employer_share).toBe(3252 - Math.round(36300 * 0.01 * 0.7))
  })

  // 高薪員工：勞保自己 cap 在 45,800，不需呼叫端先 cap
  // 這是解 "Math.min(45800) cap 拖低健保" 的關鍵
  it('high salary caps at 45800 internally (legal labor max)', () => {
    const result = calculateLaborInsurance(60000, { brackets: MOCK_LABOR_2026 })
    expect(result.insured_salary).toBe(45800)
    expect(result.employee_share).toBe(1145)
    expect(result.employer_share).toBe(4104)
  })
})

// ═════════════════════════════════════════════════════════════
//  整合：高薪員工 勞保健保 上限分離（生產 bug 復現）
// ═════════════════════════════════════════════════════════════

describe('high-salary labor/health cap separation', () => {
  it('passes uncapped salary; labor self-caps, health uses real bracket', () => {
    const salary = 57500
    const labor = calculateLaborInsurance(salary, { brackets: MOCK_LABOR_2026 })
    const health = calculateHealthInsurance(salary, { brackets: MOCK_HEALTH_2026 })

    // 勞保 cap 45800
    expect(labor.insured_salary).toBe(45800)
    // 健保依實薪查 → 不被 45800 拖低（mock 含到 313000）
    expect(health.insured_salary).toBeGreaterThanOrEqual(45800)
    // 兩者不同 → BatchPayrollModal 會顯示「勞 X / 健 Y」
    expect(labor.insured_salary).not.toBe(health.insured_salary)
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateHealthInsurance
// ═════════════════════════════════════════════════════════════

describe('calculateHealthInsurance (hardcoded path)', () => {
  it('HR-U04: single person (0 dependents)', () => {
    const result = calculateHealthInsurance(40000, 0)
    // 月薪 40000 落在 38200~40100 級 → 取 40100
    expect(result.insured_salary).toBe(40100)
    expect(result.employee_share).toBe(Math.round(40100 * 0.0517 * 0.3 * 1))
    expect(result.dependents).toBe(0)
  })

  it('HR-U05: with 3 dependents', () => {
    const result = calculateHealthInsurance(40000, 3)
    expect(result.dependents).toBe(3)
    expect(result.employee_share).toBe(
      Math.round(result.insured_salary * 0.0517 * 0.3 * 4)
    )
    const singleResult = calculateHealthInsurance(40000, 0)
    expect(result.employee_share).toBeGreaterThan(singleResult.employee_share * 3)
  })

  it('caps dependents at 3', () => {
    const result = calculateHealthInsurance(40000, 5)
    expect(result.dependents).toBe(3)
  })

  it('employer uses average dependents ratio 1.56 (2026)', () => {
    const result = calculateHealthInsurance(40000, 0)
    expect(result.employer_share).toBe(
      Math.round(result.insured_salary * 0.0517 * 0.6 * 1.56)
    )
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateHealthInsurance — DB brackets path（新）
// ═════════════════════════════════════════════════════════════

// 模擬 DB health_ins_brackets 列（2026 級距）
const MOCK_HEALTH_2026 = [
  { year: 2026, grade: 25, insured_salary: 29500, min_salary: 28591, employee_premium:  458, employer_premium: 1428 },
  { year: 2026, grade: 32, insured_salary: 40100, min_salary: 38201, employee_premium:  622, employer_premium: 1940 },
  { year: 2026, grade: 35, insured_salary: 45800, min_salary: 43901, employee_premium:  710, employer_premium: 2216 },
  { year: 2026, grade: 82, insured_salary: 313000, min_salary: 303001, employee_premium: 4855, employer_premium: 15146 },
]

describe('calculateHealthInsurance (DB brackets path)', () => {
  it('uses DB employee_premium for solo', () => {
    const result = calculateHealthInsurance(40000, { brackets: MOCK_HEALTH_2026 })
    expect(result.insured_salary).toBe(40100)
    expect(result.employee_share).toBe(622) // 官方值
    expect(result.employer_share).toBe(1940) // 已含 1.56 倍係數
  })

  it('multiplies employee premium by (1 + dependents)', () => {
    const result = calculateHealthInsurance(40000, { dependents: 2, brackets: MOCK_HEALTH_2026 })
    expect(result.employee_share).toBe(622 * 3) // 本人 + 2 眷
    expect(result.dependents).toBe(2)
  })

  it('caps dependents at 3', () => {
    const result = calculateHealthInsurance(40000, { dependents: 10, brackets: MOCK_HEALTH_2026 })
    expect(result.dependents).toBe(3)
    expect(result.employee_share).toBe(622 * 4)
  })

  it('high salary lands on grade 82 (313000)', () => {
    const result = calculateHealthInsurance(500000, { brackets: MOCK_HEALTH_2026 })
    expect(result.insured_salary).toBe(313000)
    expect(result.employee_share).toBe(4855)
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateLaborPension
// ═════════════════════════════════════════════════════════════

describe('calculateLaborPension', () => {
  it('HR-U06: employer 6% contribution', () => {
    const result = calculateLaborPension(40000)
    expect(result.employer_contribution).toBe(2400) // 40000 * 0.06
    expect(result.employee_voluntary).toBe(0)
    expect(result.wage_grade).toBe(40000)
  })

  it('caps wage at 150000 ceiling', () => {
    const result = calculateLaborPension(200000)
    expect(result.wage_grade).toBe(150000)
    expect(result.employer_contribution).toBe(9000) // 150000 * 0.06
  })

  it('voluntary contribution within 0-6%', () => {
    const result = calculateLaborPension(50000, 0.06)
    expect(result.employee_voluntary).toBe(3000) // 50000 * 0.06
  })

  it('clamps voluntary rate to max 6%', () => {
    const result = calculateLaborPension(50000, 0.10)
    expect(result.employee_voluntary).toBe(3000) // capped at 6%
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateMonthlyWithholding
// ═════════════════════════════════════════════════════════════

describe('calculateMonthlyWithholding', () => {
  it('HR-U07: low salary — no withholding', () => {
    const result = calculateMonthlyWithholding(30000)
    expect(result.withholding_amount).toBe(0)
    expect(result.rate).toBe('0%')
  })

  it('boundary: exactly 40020 — no withholding', () => {
    const result = calculateMonthlyWithholding(40020)
    expect(result.withholding_amount).toBe(0)
  })

  it('5% bracket: 50000', () => {
    const result = calculateMonthlyWithholding(50000)
    expect(result.withholding_amount).toBe(Math.round((50000 - 40020) * 0.05))
    expect(result.rate).toBe('5%')
  })

  it('12% bracket: 70000', () => {
    const result = calculateMonthlyWithholding(70000)
    expect(result.withholding_amount).toBe(Math.round(999 + (70000 - 60000) * 0.12))
    expect(result.rate).toBe('12%')
  })

  it('20% bracket: 100000', () => {
    const result = calculateMonthlyWithholding(100000)
    expect(result.withholding_amount).toBe(Math.round(3399 + (100000 - 80000) * 0.20))
    expect(result.rate).toBe('20%')
  })

  it('HR-U08: high salary 30% bracket: 150000', () => {
    const result = calculateMonthlyWithholding(150000)
    expect(result.withholding_amount).toBe(Math.round(11399 + (150000 - 120000) * 0.30))
    expect(result.rate).toBe('30%')
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateIncomeTax (annual)
// ═════════════════════════════════════════════════════════════

describe('calculateIncomeTax', () => {
  it('low annual salary has low or zero tax', () => {
    const result = calculateIncomeTax(360000) // 30K/month
    // After exemptions and deductions, taxable income likely 0
    expect(result.annual_estimated_tax).toBeLessThanOrEqual(5000)
    expect(result.effective_rate).toBeLessThan(0.05)
  })

  it('higher salary has progressive tax', () => {
    const result = calculateIncomeTax(1800000) // 150K/month
    expect(result.annual_estimated_tax).toBeGreaterThan(0)
    expect(result.monthly_withholding).toBeGreaterThan(0)
    expect(result.effective_rate).toBeGreaterThan(0)
  })

  it('married with dependents reduces tax', () => {
    const single = calculateIncomeTax(1200000)
    const married = calculateIncomeTax(1200000, { married: true, dependentCount: 2 })
    expect(married.annual_estimated_tax).toBeLessThan(single.annual_estimated_tax)
  })

  it('voluntary pension reduces taxable income', () => {
    const withoutPension = calculateIncomeTax(1200000)
    const withPension = calculateIncomeTax(1200000, { voluntaryPension: 108000 })
    expect(withPension.annual_estimated_tax).toBeLessThanOrEqual(withoutPension.annual_estimated_tax)
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateNetSalary
// ═════════════════════════════════════════════════════════════

describe('calculateNetSalary', () => {
  it('HR-U09: net = gross - all deductions', () => {
    const result = calculateNetSalary(40000)
    expect(result.gross).toBe(40000)
    expect(result.laborInsurance).toBeGreaterThan(0)
    expect(result.healthInsurance).toBeGreaterThan(0)
    expect(result.netSalary).toBe(
      result.gross - result.laborInsurance - result.healthInsurance - result.pension - result.incomeTax
    )
  })

  it('includes overtime and bonus in gross', () => {
    const result = calculateNetSalary(40000, { overtimePay: 5000, bonus: 10000 })
    expect(result.gross).toBe(55000)
  })

  it('HR-U11: boundary value — salary at bracket edge', () => {
    // Test salary exactly at a bracket value
    const result = calculateNetSalary(29500)
    expect(result.laborInsurance).toBeGreaterThan(0)
    expect(result.healthInsurance).toBeGreaterThan(0)
    expect(result.netSalary).toBeLessThan(29500)
  })

  it('handles all deduction types', () => {
    const result = calculateNetSalary(50000, {
      dependents: 2,
      voluntaryPensionRate: 0.06,
      overtimePay: 3000,
      bonus: 5000,
      otherDeductions: 1000,
      employeeAge: 30,
    })
    expect(result.gross).toBe(58000)
    expect(result.pension).toBeGreaterThan(0) // voluntary pension
    expect(result.totalDeductions).toBeGreaterThan(result.laborInsurance + result.healthInsurance)
  })
})
