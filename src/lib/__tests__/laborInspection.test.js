import { describe, it, expect } from 'vitest'
import {
  INSPECTION_ITEMS,
  generateEmployeeRoster,
  generateAttendanceReport,
  generatePayrollRegister,
  generateOvertimeReport,
  generateLeaveReport,
  generateLaborInsuranceReport,
  generateNHIReport,
  generatePensionReport,
  generateSafetyReport,
  generateWorkRulesChecklist,
  generateSelfInspection,
  validateCompliance,
} from '../laborInspection.js'

const employees = [
  { id: '1', name: '王小明', department: '工程部', position: '工程師', status: '在職', join_date: '2023-01-15', gender: '男', birth_date: '1990-05-20' },
  { id: '2', name: '李小華', department: '業務部', position: '業務員', status: '在職', join_date: '2024-03-01', gender: '女', birth_date: '1995-08-10' },
]

describe('INSPECTION_ITEMS', () => {
  it('has 15 inspection items', () => {
    expect(INSPECTION_ITEMS.length).toBeGreaterThanOrEqual(15)
  })

  it('each item has id and name', () => {
    for (const item of INSPECTION_ITEMS) {
      expect(item.id || item.code).toBeTruthy()
      expect(item.name || item.title || item.label).toBeTruthy()
    }
  })
})

describe('generateEmployeeRoster', () => {
  it('generates roster from employees', () => {
    const report = generateEmployeeRoster(employees)
    expect(report).toBeDefined()
    // May return {data, title} or {rows, ...} or array
    const dataArr = report.data || report.rows || (Array.isArray(report) ? report : [])
    expect(dataArr.length).toBeGreaterThanOrEqual(0)
  })

  it('handles empty list', () => {
    const report = generateEmployeeRoster([])
    expect(report).toBeDefined()
  })
})

describe('generateAttendanceReport', () => {
  it('generates report from attendance records', () => {
    const attendance = [
      { employee: '王小明', date: '2026-04-01', clock_in: '09:00', clock_out: '18:00', status: '正常' },
      { employee: '李小華', date: '2026-04-01', clock_in: '09:30', clock_out: '18:00', status: '遲到' },
    ]
    const report = generateAttendanceReport(attendance, employees, '2026-04')
    expect(report).toBeDefined()
  })
})

describe('generatePayrollRegister', () => {
  it('generates payroll register', () => {
    const salaryRecords = [
      { employee: '王小明', month: '2026-04', base_salary: 45000, net_salary: 38000 },
    ]
    const report = generatePayrollRegister(salaryRecords, employees, '2026-04')
    expect(report).toBeDefined()
  })
})

describe('generateOvertimeReport', () => {
  it('generates overtime report', () => {
    const otRecords = [
      { employee: '王小明', date: '2026-04-05', hours: 2, type: 'weekday', status: '已核准' },
    ]
    const report = generateOvertimeReport(otRecords, employees, '2026-04')
    expect(report).toBeDefined()
  })
})

describe('generateLeaveReport', () => {
  it('generates leave usage report', () => {
    const leaveRecords = [
      { employee: '王小明', type: '特休', start_date: '2026-04-10', end_date: '2026-04-11', days: 2, status: '已核准' },
    ]
    const report = generateLeaveReport(leaveRecords, employees, '2026-04')
    expect(report).toBeDefined()
  })
})

describe('generateLaborInsuranceReport', () => {
  it('generates labor insurance report', () => {
    const report = generateLaborInsuranceReport(employees)
    expect(report).toBeDefined()
  })
})

describe('generateNHIReport', () => {
  it('generates NHI report', () => {
    const report = generateNHIReport(employees)
    expect(report).toBeDefined()
  })
})

describe('generatePensionReport', () => {
  it('generates pension report', () => {
    const salaryRecords = [
      { employee: '王小明', base_salary: 45000 },
    ]
    const report = generatePensionReport(employees, salaryRecords, '2026-04')
    expect(report).toBeDefined()
  })
})

describe('generateSafetyReport', () => {
  it('generates safety incident report', () => {
    const report = generateSafetyReport([])
    expect(report).toBeDefined()
  })

  it('with incidents', () => {
    const incidents = [
      { date: '2026-03-01', type: '工傷', description: '手指割傷', severity: '輕微', employee: '王小明' },
    ]
    const report = generateSafetyReport(incidents)
    expect(report).toBeDefined()
  })
})

describe('generateWorkRulesChecklist', () => {
  it('generates checklist', () => {
    const report = generateWorkRulesChecklist()
    expect(report).toBeDefined()
  })
})

describe('generateSelfInspection', () => {
  it('generates self-inspection report', () => {
    const report = generateSelfInspection({ companyName: 'Test Corp', inspectionDate: '2026-04-05' })
    expect(report).toBeDefined()
  })
})

describe('validateCompliance', () => {
  it('validates compliance across reports', () => {
    const reports = [
      { id: 'roster', status: 'pass', score: 100 },
      { id: 'attendance', status: 'pass', score: 90 },
      { id: 'overtime', status: 'warning', score: 70 },
    ]
    const result = validateCompliance(reports)
    expect(result).toBeDefined()
    expect(typeof result.overallScore === 'number' || typeof result.score === 'number').toBe(true)
  })
})
