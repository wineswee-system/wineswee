-- LIFF 手機端支援申論題:course_detail 多回傳測驗批閱狀態 + 新增「含申論則送批閱」RPC。
-- 對齊 web QuizEngine:含申論的測驗存 lms_quiz_submissions(needs_review),不立即完成,等後台批閱。

-- ── course_detail 加 submissions(測驗批閱狀態)──
CREATE OR REPLACE FUNCTION public.liff_lms_course_detail(p_line_user_id text, p_course_id integer)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp employees; v_course lms_courses; v_enr lms_enrollments;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  SELECT * INTO v_course FROM lms_courses WHERE id = p_course_id AND status = '發布'
    AND (organization_id IS NULL OR organization_id = emp.organization_id);
  IF v_course.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'COURSE_NOT_FOUND'); END IF;
  SELECT * INTO v_enr FROM lms_enrollments WHERE course_id = p_course_id AND employee_id = emp.id;

  RETURN json_build_object(
    'ok', true,
    'course', json_build_object('id', v_course.id, 'title', v_course.title, 'description', v_course.description,
       'category', v_course.category, 'difficulty', v_course.difficulty, 'estimated_hours', v_course.estimated_hours,
       'passing_score', v_course.passing_score, 'tier_silver_score', v_course.tier_silver_score, 'tier_gold_score', v_course.tier_gold_score,
       'is_required', v_course.is_required, 'delivery_mode', v_course.delivery_mode),
    'enrollment', CASE WHEN v_enr.id IS NULL THEN NULL ELSE json_build_object('id', v_enr.id, 'status', v_enr.status) END,
    'sections', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', s.id, 'title', s.title, 'sort_order', s.sort_order,
        'lessons', (SELECT COALESCE(json_agg(json_build_object(
            'id', l.id, 'title', l.title, 'type', l.type, 'content', l.content,
            'duration_minutes', l.duration_minutes, 'quiz_data', l.quiz_data, 'sort_order', l.sort_order
          ) ORDER BY l.sort_order), '[]'::json) FROM lms_lessons l WHERE l.section_id = s.id)
      ) ORDER BY s.sort_order), '[]'::json) FROM lms_sections s WHERE s.course_id = p_course_id
    ),
    'progress', (
      SELECT COALESCE(json_object_agg(pr.lesson_id, json_build_object('completed', pr.completed, 'score', pr.score)), '{}'::json)
      FROM lms_progress pr WHERE v_enr.id IS NOT NULL AND pr.enrollment_id = v_enr.id
    ),
    'submissions', (
      SELECT COALESCE(json_object_agg(sub.lesson_id, json_build_object('status', sub.status, 'needs_review', sub.needs_review, 'score', sub.score)), '{}'::json)
      FROM lms_quiz_submissions sub WHERE v_enr.id IS NOT NULL AND sub.enrollment_id = v_enr.id
    )
  );
END $function$;

-- ── 含申論的測驗:存作答等後台批閱(不算完成)──
CREATE OR REPLACE FUNCTION public.liff_lms_submit_quiz_review(p_line_user_id text, p_lesson_id integer, p_answers jsonb, p_auto_points numeric, p_total_points numeric)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp employees; v_lesson lms_lessons; v_enr lms_enrollments;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  SELECT * INTO v_lesson FROM lms_lessons WHERE id = p_lesson_id;
  IF v_lesson.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'LESSON_NOT_FOUND'); END IF;
  SELECT * INTO v_enr FROM lms_enrollments WHERE course_id = v_lesson.course_id AND employee_id = emp.id;
  IF v_enr.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_ENROLLED'); END IF;

  INSERT INTO lms_quiz_submissions (enrollment_id, lesson_id, course_id, employee_id, answers, auto_points, total_points, needs_review, status, score, grades, graded_by, graded_at, organization_id)
  VALUES (v_enr.id, p_lesson_id, v_lesson.course_id, emp.id, COALESCE(p_answers, '[]'::jsonb), COALESCE(p_auto_points, 0), COALESCE(p_total_points, 0), true, 'submitted', NULL, '{}'::jsonb, NULL, NULL, emp.organization_id)
  ON CONFLICT (enrollment_id, lesson_id) DO UPDATE
    SET answers = EXCLUDED.answers, auto_points = EXCLUDED.auto_points, total_points = EXCLUDED.total_points,
        needs_review = true, status = 'submitted', score = NULL, grades = '{}'::jsonb, graded_by = NULL, graded_at = NULL;

  RETURN json_build_object('ok', true, 'pending', true);
END $function$;

GRANT EXECUTE ON FUNCTION public.liff_lms_submit_quiz_review(text, integer, jsonb, numeric, numeric) TO anon, authenticated;
