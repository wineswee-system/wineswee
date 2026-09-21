import { supabase } from '../supabase'
import { getEventBus } from '../events/EventBus'

/**
 * 判定整門課是否完成,並在完成時標記 enrollment + 發 lms.course.completed(觸發自動發證)。
 *
 * 規則:一門課的每個單元都必須有一筆 completed=true 的 lms_progress 才算完成。
 * quiz 單元的 completed 只有「測驗達及格分」時才會是 true(見 QuizEngine),
 * 因此「沒通過測驗 → 該單元不算完成 → 整門課不算完成 → 不發證」。
 *
 * 以 DB 重新查詢為準,不吃前端 state,避免 LessonPlayer/QuizEngine 兩條路徑狀態不同步。
 *
 * @param {{ enrollment: {id:number, employee_id:number, status?:string}, course: {id:number, title:string} }} args
 * @returns {Promise<boolean>} 課程是否已完成(含先前就已完成的情況)
 */
export async function maybeCompleteCourse({ enrollment, course }) {
  if (!enrollment?.id || !course?.id) return false

  const [{ data: lessons, error: le }, { data: prog, error: pe }] = await Promise.all([
    supabase.from('lms_lessons').select('id').eq('course_id', course.id),
    supabase.from('lms_progress').select('lesson_id, completed').eq('enrollment_id', enrollment.id),
  ])
  if (le || pe) {
    console.warn('[LMS] 完成判定查詢失敗:', (le || pe).message)
    return false
  }

  const total = (lessons || []).length
  if (!total) return false // 沒有任何單元的課不自動結業

  const doneSet = new Set((prog || []).filter(p => p.completed).map(p => p.lesson_id))
  const allDone = (lessons || []).every(l => doneSet.has(l.id))
  if (!allDone) return false

  // 已是已完成就不重發事件(避免重覆發證)
  if (enrollment.status !== '已完成') {
    const { error: ue } = await supabase.from('lms_enrollments')
      .update({ status: '已完成', completed_at: new Date().toISOString() })
      .eq('id', enrollment.id)
    if (ue) { console.warn('[LMS] 標記課程完成失敗:', ue.message); return false }

    await getEventBus().publish('lms.course.completed', {
      enrollment_id: String(enrollment.id),
      course_id: String(course.id),
      course_title: course.title,
      employee_id: String(enrollment.employee_id),
      passed: true,
    })
  }
  return true
}

/**
 * 實體課簽到 → 完課。
 * 若課程另有線上單元,仍需全部完成(沿用 maybeCompleteCourse);
 * 若沒有線上單元(純實體上課),簽到即視為完成並發證。
 */
export async function completePhysicalAttendance({ enrollment, course }) {
  if (!enrollment?.id || !course?.id) return false

  const { data: lessons } = await supabase.from('lms_lessons').select('id').eq('course_id', course.id)
  if ((lessons || []).length) return maybeCompleteCourse({ enrollment, course })

  if (enrollment.status !== '已完成') {
    const { error: ue } = await supabase.from('lms_enrollments')
      .update({ status: '已完成', completed_at: new Date().toISOString() })
      .eq('id', enrollment.id)
    if (ue) { console.warn('[LMS] 實體課完成標記失敗:', ue.message); return false }

    await getEventBus().publish('lms.course.completed', {
      enrollment_id: String(enrollment.id),
      course_id: String(course.id),
      course_title: course.title,
      employee_id: String(enrollment.employee_id),
      passed: true,
    })
  }
  return true
}
