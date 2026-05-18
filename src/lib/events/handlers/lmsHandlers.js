import { supabase } from '../../supabase.js'

/**
 * LMS event handlers.
 * Subscribes to cross-module events that affect learning records and HR development plans.
 */
export function registerLMSHandlers(bus) {
  // ── Course completed → update HR development plan if linked ──
  bus.subscribe('lms.course.completed', async function onCourseCompletedUpdateDevPlan(event) {
    const { employee_id, course_title, passed } = event.payload
    if (!passed) return

    await supabase
      .from('employee_development_plans')
      .update({ status: '已完成', completed_date: new Date().toISOString().slice(0, 10) })
      .eq('employee_id', employee_id)
      .ilike('course_name', `%${course_title}%`)
      .eq('status', '進行中')
      .then(({ error }) => {
        if (error) console.warn('[LMS] Dev plan update failed:', error.message)
      })
  })

  // ── Certificate issued → notify employee ──
  bus.subscribe('lms.certificate.issued', async function onCertificateIssuedNotify(event) {
    const { employee_name, course_title, certificate_number } = event.payload

    await supabase.from('notifications').insert({
      type: '結業證書',
      title: `恭喜 ${employee_name || '您'} 完成「${course_title}」並獲得證書（${certificate_number}）`,
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[LMS] Certificate notification failed:', error.message)
    })
  })

  // ── Enrollment created → notify learner ──
  bus.subscribe('lms.enrollment.created', async function onEnrollmentCreatedNotify(event) {
    const { employee_name, course_title, due_date, enrolled_by } = event.payload
    const dueText = due_date ? `，截止日期：${due_date}` : ''
    const byText = enrolled_by && enrolled_by !== 'self' ? `（由 ${enrolled_by} 指派）` : ''

    await supabase.from('notifications').insert({
      type: '課程報名',
      title: `${employee_name || '您'} 已報名「${course_title}」${byText}${dueText}`,
      read: false,
    }).then(({ error }) => {
      if (error) console.warn('[LMS] Enrollment notification failed:', error.message)
    })
  })

  // ── HR employee onboarded → auto-enroll in required courses ──
  bus.subscribe('hr.employee.onboarded', async function onEmployeeOnboardedAutoEnroll(event) {
    const { employee_id, employee_name } = event.payload
    if (!employee_id) return

    const { data: requiredCourses } = await supabase
      .from('lms_courses')
      .select('id, title')
      .eq('is_required', true)
      .eq('status', '發布')

    if (!requiredCourses?.length) return

    for (const course of requiredCourses) {
      const { data: enrollment, error } = await supabase
        .from('lms_enrollments')
        .insert({ course_id: course.id, employee_id, enrolled_by: '系統自動' })
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
