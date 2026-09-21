import { supabase } from '../../supabase.js'

/** 取員工的 organization_id(通知寫入要帶,才過得了 notifications 的 RLS) */
async function orgOf(employeeId) {
  if (!employeeId) return null
  const { data } = await supabase.from('employees').select('organization_id').eq('id', employeeId).single()
  return data?.organization_id ?? null
}

/**
 * LMS event handlers.
 * Subscribes to cross-module events that affect learning records and HR development plans.
 */
export function registerLMSHandlers(bus) {
  // ── Course completed → issue certificate + update dev plan ──
  bus.subscribe('lms.course.completed', async function onCourseCompleted(event) {
    const { employee_id, enrollment_id, course_id, course_title, passed } = event.payload
    if (!passed) return

    // Update HR development plan if linked
    await supabase
      .from('employee_development_plans')
      .update({ status: '已完成', completed_date: new Date().toISOString().slice(0, 10) })
      .eq('employee_id', employee_id)
      .ilike('course_name', `%${course_title}%`)
      .eq('status', '進行中')
      .then(({ error }) => {
        if (error) console.warn('[LMS] Dev plan update failed:', error.message)
      })

    // Auto-issue certificate
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const certNum = `CERT-${dateStr}-${course_id}-${employee_id}`

    // Fetch best quiz score from progress
    let score = null
    if (enrollment_id) {
      const { data: progRows } = await supabase
        .from('lms_progress')
        .select('score')
        .eq('enrollment_id', enrollment_id)
        .not('score', 'is', null)
      if (progRows?.length) {
        score = Math.round(progRows.reduce((s, r) => s + r.score, 0) / progRows.length)
      }
    }

    // Get org for RLS
    const { data: emp } = await supabase
      .from('employees')
      .select('organization_id, name')
      .eq('id', employee_id)
      .single()

    // 依課程分級門檻(金/銀/銅)判定證照級別;銅=及格線,完課至少為銅
    const { data: crs } = await supabase
      .from('lms_courses')
      .select('passing_score, tier_silver_score, tier_gold_score')
      .eq('id', course_id)
      .single()
    const goldT = crs?.tier_gold_score ?? 90
    const silverT = crs?.tier_silver_score ?? 80
    const tier = (score != null && score >= goldT) ? '金'
      : (score != null && score >= silverT) ? '銀' : '銅'

    const { data: cert, error: certErr } = await supabase
      .from('lms_certificates')
      .insert({
        enrollment_id: enrollment_id ? parseInt(enrollment_id) : null,
        course_id: parseInt(course_id),
        employee_id: parseInt(employee_id),
        certificate_number: certNum,
        score,
        tier,
        issued_at: new Date().toISOString(),
        organization_id: emp?.organization_id,
      })
      .select()
      .single()

    if (certErr) {
      if (!certErr.message.includes('unique')) {
        console.warn('[LMS] Certificate issuance failed:', certErr.message)
      }
      return
    }

    await bus.publish('lms.certificate.issued', {
      certificate_id: String(cert.id),
      certificate_number: certNum,
      course_id: String(course_id),
      course_title,
      employee_id: String(employee_id),
      employee_name: emp?.name || '',
      score,
    }, {
      causation_id: event.id,
      correlation_id: event.metadata?.correlation_id,
    })
  })

  // ── Certificate issued → notify employee ──
  bus.subscribe('lms.certificate.issued', async function onCertificateIssuedNotify(event) {
    const { employee_id, employee_name, course_title, certificate_number } = event.payload

    // notifications INSERT 有 RLS CHECK org_visible(organization_id),必須帶對的 org 才進得去
    const orgId = await orgOf(employee_id)
    if (!orgId) { console.warn('[LMS] 證書通知略過:查無 org', employee_id); return }

    await supabase.from('notifications').insert({
      type: '結業證書',
      title: `恭喜 ${employee_name || '您'} 完成「${course_title}」並獲得證書（${certificate_number}）`,
      read: false,
      recipient_emp_id: employee_id ? parseInt(employee_id) : null,
      organization_id: orgId,
    }).then(({ error }) => {
      if (error) console.warn('[LMS] Certificate notification failed:', error.message)
    })
  })

  // ── Enrollment created → notify learner ──
  bus.subscribe('lms.enrollment.created', async function onEnrollmentCreatedNotify(event) {
    const { employee_id, employee_name, course_title, due_date, enrolled_by } = event.payload
    const dueText = due_date ? `，截止日期：${due_date}` : ''
    const byText = enrolled_by && enrolled_by !== 'self' ? `（由 ${enrolled_by} 指派）` : ''

    const orgId = await orgOf(employee_id)
    if (!orgId) { console.warn('[LMS] 報名通知略過:查無 org', employee_id); return }

    await supabase.from('notifications').insert({
      type: '課程報名',
      title: `${employee_name || '您'} 已報名「${course_title}」${byText}${dueText}`,
      read: false,
      recipient_emp_id: employee_id ? parseInt(employee_id) : null,
      organization_id: orgId,
    }).then(({ error }) => {
      if (error) console.warn('[LMS] Enrollment notification failed:', error.message)
    })
  })

  // ── HR employee onboarded → auto-enroll in required courses ──
  bus.subscribe('hr.employee.onboarded', async function onEmployeeOnboardedAutoEnroll(event) {
    const { employee_id, employee_name } = event.payload
    if (!employee_id) return

    // 事件 payload 不帶 org，從 DB 補取
    const { data: emp } = await supabase
      .from('employees')
      .select('organization_id')
      .eq('id', employee_id)
      .single()

    const organization_id = emp?.organization_id
    if (!organization_id) {
      console.warn('[LMS] auto-enroll skipped: organization_id not found for employee', employee_id)
      return
    }

    const { data: requiredCourses } = await supabase
      .from('lms_courses')
      .select('id, title')
      .eq('is_required', true)
      .eq('status', '發布')
      .eq('organization_id', organization_id)

    if (!requiredCourses?.length) return

    for (const course of requiredCourses) {
      const { data: enrollment, error } = await supabase
        .from('lms_enrollments')
        .insert({ course_id: course.id, employee_id, enrolled_by: '系統自動', organization_id })
        .select()
        .single()

      if (error) {
        if (!error.message.includes('unique')) {
          console.warn('[LMS] Auto-enroll failed:', error.message)
        }
        continue
      }

      await bus.publish('lms.enrollment.created', {
        enrollment_id: String(enrollment.id),
        course_id: String(course.id),
        course_title: course.title,
        employee_id: String(employee_id),
        employee_name: employee_name || '',
        enrolled_by: '系統自動（新進員工）',
      }, {
        causation_id: event.id,
        correlation_id: event.metadata?.correlation_id,
      })
    }
  })
}
