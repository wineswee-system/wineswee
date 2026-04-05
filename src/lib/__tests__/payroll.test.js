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

describe('Bracket Tables', () => {
  it('labor insurance brackets are sorted ascending', () => {
    for (let i = 1; i < LABOR_INSURANCE_BRACKETS.length; i++) {
      expect(LABOR_INSURANCE_BRACKETS[i]).toBeGreaterThan(LABOR_INSURANCE_BRACKETS[i - 1])
    }
  })

  it('labor insurance starts at 29500, ends at 45800', () => {
    expect(LABOR_INSURANCE_BRACKETS[0]).toBe(29500)
    expect(LABOR_INSURANCE_BRACKETS[LABOR_INSURANCE_BRACKETS.length - 1]).toBe(45800)
  })

  it('health insurance brackets are sorted ascending', () => {
    for (let i = 1; i < HEALTH_INSURANCE_BRACKETS.length; i++) {
      expect(HEALTH_INSURANCE_BRACKETS[i]).toBeGreaterThan(HEALTH_INSURANCE_BRACKETS[i - 1])
    }
  })

  it('health insurance ends at 219500', () => {
    expect(HEALTH_INSURANCE_BRACKETS[HEALTH_INSURANCE_BRACKETS.length - 1]).toBe(219500)
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateLaborInsurance
// ═════════════════════════════════════════════════════════════

describe('calculateLaborInsurance', () => {
  it('HR-U01: minimum bracket for low salary', () => {
    const result = calculateLaborInsurance(25000)
    expect(result.insured_salary).toBe(29500)
    // 29500 * 0.12 * 0.2 = 708
    expect(result.employee_share).toBe(Math.round(29500 * 0.12 * 0.2))
    // 29500 * 0.12 * 0.7 = 2478
    expect(result.employer_share).toBe(Math.round(29500 * 0.12 * 0.7))
  })

  it('HR-U02: maximum bracket for high salary', () => {
    const result = calculateLaborInsurance(80000)
    expect(result.insured_salary).toBe(45800)
    expect(result.employee_share).toBe(Math.round(45800 * 0.12 * 0.2))
  })

  it('HR-U03: mid bracket lookup', () => {
    const result = calculateLaborInsurance(36000)
    // 36000 falls between 35100 and 36300 → bracket = 36300
    expect(result.insured_salary).toBe(36300)
  })

  it('uses 10.5% rate for age >= 65', () => {
    const result = calculateLaborInsurance(35000, 65)
    expect(result.employee_share).toBe(Math.round(result.insured_salary * 0.105 * 0.2))
    expect(result.employer_share).toBe(Math.round(result.insured_salary * 0.105 * 0.7))
  })

  it('employee + employer + gov = total', () => {
    const result = calculateLaborInsurance(40000)
    // Total = insured * rate * 100%
    expect(result.total).toBe(Math.round(result.insured_salary * 0.12))
  })
})

// ═════════════════════════════════════════════════════════════
//  calculateHealthInsurance
// ═════════════════════════════════════════════════════════════

describe('calculateHealthInsurance', () => {
  it('HR-U04: single person (0 dependents)', () => {
    const result = calculateHealthInsurance(40000, 0)
    // Bracket for 40000 → 41100
    expect(result.insured_salary).toBe(41100)
    // Employee: 41100 * 0.0517 * 0.3 * (1+0) = 637
    expect(result.employee_share).toBe(Math.round(41100 * 0.0517 * 0.3 * 1))
    expect(result.dependents).toBe(0)
  })

  it('HR-U05: with 3 dependents', () => {
    const result = calculateHealthInsurance(40000, 3)
    expect(result.dependents).toBe(3)
    // Employee share with 3 dependents = insured * 0.0517 * 0.3 * 4
    expect(result.employee_share).toBe(
      Math.round(result.insured_salary * 0.0517 * 0.3 * 4)
    )
    // Should be significantly more than single
    const singleResult = calculateHealthInsurance(40000, 0)
    expect(result.employee_share).toBeGreaterThan(singleResult.employee_share * 3)
  })

  it('caps dependents at 3', () => {
    const result = calculateHealthInsurance(40000, 5)
    expect(result.dependents).toBe(3)
  })

  it('employer uses average dependents ratio 1.57', () => {
    const result = calculateHealthInsurance(40000, 0)
    expect(result.employer_share).toBe(
      Math.round(result.insured_salary * 0.0517 * 0.6 * 1.57)
    )
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
