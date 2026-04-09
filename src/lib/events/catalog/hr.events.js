export const HR_EVENTS = {
  'hr.employee.onboarded': {
    domain: 'hr',
    action: 'employee.onboarded',
    version: 1,
    description: '新員工報到完成',
    payload: {
      employee_id: { type: 'string', required: true },
      name: { type: 'string', required: true },
      dept: { type: 'string', required: false },
      position: { type: 'string', required: false },
    },
  },
  'hr.leave.approved': {
    domain: 'hr',
    action: 'leave.approved',
    version: 1,
    description: '請假單核准',
    payload: {
      leave_id: { type: 'string', required: true },
      employee: { type: 'string', required: true },
      type: { type: 'string', required: true },
      days: { type: 'number', required: true },
    },
  },
  'hr.salary.calculated': {
    domain: 'hr',
    action: 'salary.calculated',
    version: 1,
    description: '薪資計算完成',
    payload: {
      employee_id: { type: 'string', required: true },
      month: { type: 'string', required: true },
      net_salary: { type: 'number', required: true },
    },
  },
  'hr.expense.approved': {
    domain: 'hr',
    action: 'expense.approved',
    version: 1,
    description: '費用報銷核准',
    payload: {
      expense_id: { type: 'string', required: true },
      employee: { type: 'string', required: true },
      category: { type: 'string', required: true },
      amount: { type: 'number', required: true },
      description: { type: 'string', required: false },
      date: { type: 'string', required: false },
    },
  },
  'hr.clock.in': {
    domain: 'hr',
    action: 'clock.in',
    version: 1,
    description: '員工打卡上班',
    payload: {
      employee_id: { type: 'string', required: true },
      timestamp: { type: 'string', required: true },
      location: { type: 'string', required: false },
    },
  },
  'hr.clock.out': {
    domain: 'hr',
    action: 'clock.out',
    version: 1,
    description: '員工打卡下班',
    payload: {
      employee_id: { type: 'string', required: true },
      timestamp: { type: 'string', required: true },
      hours: { type: 'number', required: false },
    },
  },
}
