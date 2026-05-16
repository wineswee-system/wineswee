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

    const employerBurden = (employer_li || 0) + (employer_hi || 0) + (employer_pension || 0)
    const lines = [
      { account_code: '6100', account_name: '薪資費用', debit: totalEmployerCost, credit: 0, memo: `${month} 薪資` },
      { account_code: '2200', account_name: '應付薪資', debit: 0, credit: net_salary, memo: `${month} 實發薪資` },
      ...(employerBurden > 0 ? [{ account_code: '2300', account_name: '應付勞健保/勞退', debit: 0, credit: employerBurden, memo: `${month} 雇主負擔` }] : []),
    ]

    const { data: entry, error: entryError } = await supabase.rpc('secure_create_journal_entry', {
      p_entry_date: `${month}-28`,
      p_description: `薪資費用 - ${month}`,
      p_lines: lines,
      p_source: '薪資計算',
      p_source_id: null,
      p_created_by: '系統',
    })

    if (entryError) throw new Error(`Payroll JE failed: ${entryError.message}`)

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

  // ── Leave approved → deduct used days from entitlement ──
  bus.subscribe('hr.leave.approved', async function onLeaveApprovedDeductEntitlement(event) {
    const { employee, type, days } = event.payload

    const { data: emp } = await supabase.from('employees').select('id').eq('name', employee).maybeSingle()
    if (!emp) return

    const currentYear = new Date().getFullYear()
    const { data: entitlement } = await supabase
      .from('leave_entitlements')
      .select('*')
      .eq('employee_id', emp.id)
      .eq('year', currentYear)
      .eq('leave_type', type)
      .maybeSingle()

    if (!entitlement) return

    await supabase.from('leave_entitlements')
      .update({ used_days: (entitlement.used_days || 0) + days })
      .eq('id', entitlement.id)
      .then(({ error }) => {
        if (error) console.warn(`[HR] Leave entitlement deduction failed for ${employee}:`, error.message)
      })
  })

  // ── Clock out → record hours worked in attendance ──
  bus.subscribe('hr.clock.out', async function onClockOutRecordHours(event) {
    const { employee_id, timestamp, hours } = event.payload
    if (hours == null) return

    const date = new Date(timestamp).toISOString().slice(0, 10)
    await supabase.from('attendance_records')
      .update({ clock_out: timestamp, total_hours: hours })
      .eq('employee_id', employee_id)
      .eq('date', date)
      .then(({ error }) => {
        if (error) console.warn(`[HR] Clock-out record failed for ${employee_id}:`, error.message)
      })
  })

  // ── Probation expiring → notify HR to review ──
  bus.subscribe('hr.probation.expiring', async function onProbationExpiringNotify(event) {
    const { name, end_date, days_remaining } = event.payload

    await supabase.from('notifications').insert({
      type: '試用期提醒',
      title: `${name} 試用期將於 ${end_date} 到期（剩 ${days_remaining} 天）`,
      target_role: 'HR',
      priority: days_remaining <= 7 ? 'high' : 'normal',
      read: false,
    }).then(({ error }) => {
      if (error) console.warn(`[HR] Probation notification failed for ${name}:`, error.message)
    })
  })

  // ── Payslip sent → notify employee via in-app notification ──
  bus.subscribe('hr.payslip.sent', async function onPayslipSentNotify(event) {
    const { employee_id, month, channel } = event.payload

    await supabase.from('notifications').insert({
      type: '薪資單',
      title: `${month} 薪資單已發送`,
      target_employee_id: employee_id,
      message: channel ? `發送管道：${channel}` : null,
      read: false,
    }).then(({ error }) => {
      if (error) console.warn(`[HR] Payslip notification failed for ${employee_id}:`, error.message)
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
