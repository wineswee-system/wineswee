import { supabase } from '../../supabase.js'

/**
 * HR event handlers.
 * Subscribes to events that affect employee records and HR workflows.
 */
export function registerHRHandlers(bus) {
  // ── Employee onboarded → create initial records ──
  bus.subscribe('hr.employee.onboarded', async function onEmployeeOnboarded(event) {
    const { employee_id, name, dept, position } = event.payload

    // Create initial leave entitlements for the new employee
    const currentYear = new Date().getFullYear()
    const leaveTypes = [
      { type: '特休', days: 0, note: '依到職日計算' },
      { type: '病假', days: 30, note: '年度上限' },
      { type: '事假', days: 14, note: '年度上限' },
    ]

    for (const leave of leaveTypes) {
      await supabase.from('leave_entitlements').insert({
        employee_id,
        year: currentYear,
        leave_type: leave.type,
        total_days: leave.days,
        used_days: 0,
        note: leave.note,
      }).then(({ error }) => {
        if (error) console.warn(`[HR] Leave entitlement creation failed for ${name}:`, error.message)
      })
    }
  })

  // ── Salary calculated → create payroll journal entry ──
  bus.subscribe('hr.salary.calculated', async function onSalaryCalculatedCreateJE(event) {
    const { employee_id, month, net_salary, gross_salary, employer_li, employer_hi, employer_pension } = event.payload

    const totalEmployerCost = (gross_salary || net_salary) + (employer_li || 0) + (employer_hi || 0) + (employer_pension || 0)
    const entryNumber = `JE-PAY-${month}-${String(Date.now()).slice(-4)}`

    const { data: entry, error: entryError } = await supabase.from('journal_entries').insert({
      entry_number: entryNumber,
      entry_date: `${month}-28`,
      description: `薪資費用 - ${month}`,
      source: '薪資計算',
      source_id: `payroll-${month}-${employee_id}`,
      status: '已過帳',
      created_by: '系統',
    }).select().single()

    if (entryError) throw new Error(`Payroll JE failed: ${entryError.message}`)

    if (entry) {
      await supabase.from('journal_lines').insert([
        {
          entry_id: entry.id,
          account_code: '6100',
          account_name: '薪資費用',
          debit: totalEmployerCost,
          credit: 0,
          memo: `${month} 薪資`,
        },
        {
          entry_id: entry.id,
          account_code: '2200',
          account_name: '應付薪資',
          debit: 0,
          credit: net_salary,
          memo: `${month} 實發薪資`,
        },
        ...((employer_li || 0) + (employer_hi || 0) + (employer_pension || 0) > 0 ? [{
          entry_id: entry.id,
          account_code: '2300',
          account_name: '應付勞健保/勞退',
          debit: 0,
          credit: (employer_li || 0) + (employer_hi || 0) + (employer_pension || 0),
          memo: `${month} 雇主負擔`,
        }] : []),
      ])
    }

    await bus.publish('finance.journal.posted', {
      entry_id: entry.id,
      entry_number: entryNumber,
      amount: totalEmployerCost,
    }, {
      causation_id: event.id,
      correlation_id: event.metadata.correlation_id,
    })
  })

  // ── Clock in → update daily attendance status ──
  bus.subscribe('hr.clock.in', async function onClockIn(event) {
    const { employee_id, timestamp, location } = event.payload
    const clockTime = new Date(timestamp)
    const date = clockTime.toISOString().slice(0, 10)

    // Check for late arrival (after 09:00)
    const hour = clockTime.getHours()
    const minute = clockTime.getMinutes()
    const isLate = hour > 9 || (hour === 9 && minute > 0)

    if (isLate) {
      await supabase.from('attendance_records').update({
        late_flag: true,
        late_minutes: (hour - 9) * 60 + minute,
      }).eq('employee_id', employee_id).eq('date', date)
    }
  })

  // ── Offboarding started → revoke access across modules ──
  bus.subscribe('hr.offboarding.started', async function onOffboardingStarted(event) {
    const { employee_id, name, dept, last_working_date } = event.payload

    // Deactivate POS access
    await supabase.from('employees').update({ status: '離職中' }).eq('id', employee_id)
      .then(({ error }) => { if (error) console.warn(`[HR] Failed to update status for ${name}:`, error.message) })

    // Notify related modules via events
    await bus.publish('pos.access.revoked', { employee_id, name, reason: '離職流程' }, {
      causation_id: event.id,
      correlation_id: event.metadata?.correlation_id,
    }).catch(() => {})

    await bus.publish('wms.access.revoked', { employee_id, name, reason: '離職流程' }, {
      causation_id: event.id,
      correlation_id: event.metadata?.correlation_id,
    }).catch(() => {})
  })

  // ── High attrition risk → log for HR review ──
  bus.subscribe('hr.attrition.high_risk', async function onHighAttritionRisk(event) {
    const { employee_id, name, risk_score, factors } = event.payload

    await supabase.from('notifications').insert({
      type: 'attrition_alert',
      title: `離職風險警示：${name}`,
      message: `風險分數 ${risk_score}，因素：${(factors || []).join('、')}`,
      target_role: 'HR',
      priority: 'high',
    }).then(({ error }) => {
      if (error) console.warn(`[HR] Failed to create attrition notification for ${name}:`, error.message)
    })
  })

  // ── Survey completed → generate summary notification ──
  bus.subscribe('hr.survey.completed', async function onSurveyCompleted(event) {
    const { survey_id, title, response_count, overall_score } = event.payload

    await supabase.from('notifications').insert({
      type: 'survey_result',
      title: `問卷已結束：${title}`,
      message: `收到 ${response_count} 份回覆，整體分數 ${overall_score ?? '-'}/5`,
      target_role: 'HR',
      priority: 'normal',
    }).then(({ error }) => {
      if (error) console.warn(`[HR] Failed to create survey notification:`, error.message)
    })
  })
}
