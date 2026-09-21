-- LIFF 手機端上課:課程詳情 / 標記完成 / 交測驗 的 DEFINER RPC(anon 用),
-- 完課發證在 RPC 內做(手機無事件匯流排)。對齊 web 的 maybeCompleteCourse + lmsHandlers。

-- ── 內部:整門完成則標記+發分級證照(回傳級別;未完成/已完成過回 NULL)──
CREATE OR REPLACE FUNCTION public._liff_lms_finalize(p_enrollment_id integer)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_enr lms_enrollments; v_course lms_courses; v_total int; v_done int; v_score int; v_tier text; v_org bigint; v_name text; v_certnum text;
BEGIN
  SELECT * INTO v_enr FROM lms_enrollments WHERE id = p_enrollment_id;
  IF v_enr.id IS NULL OR v_enr.status = '已完成' THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_total FROM lms_lessons WHERE course_id = v_enr.course_id;
  IF v_total = 0 THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_done FROM lms_progress p JOIN lms_lessons l ON l.id = p.lesson_id
   WHERE p.enrollment_id = p_enrollment_id AND p.completed = true AND l.course_id = v_enr.course_id;
  IF v_done < v_total THEN RETURN NULL; END IF;

  UPDATE lms_enrollments SET status = '已完成', completed_at = now() WHERE id = p_enrollment_id;
  SELECT * INTO v_course FROM lms_courses WHERE id = v_enr.course_id;
  SELECT round(avg(score)) INTO v_score FROM lms_progress WHERE enrollment_id = p_enrollment_id AND score IS NOT NULL;
  v_tier := CASE WHEN v_score IS NOT NULL AND v_score >= COALESCE(v_course.tier_gold_score, 90) THEN '金'
                 WHEN v_score IS NOT NULL AND v_score >= COALESCE(v_course.tier_silver_score, 80) THEN '銀' ELSE '銅' END;
  SELECT organization_id, name INTO v_org, v_name FROM employees WHERE id = v_enr.employee_id;
  v_certnum := 'CERT-' || to_char(now(), 'YYYYMMDD') || '-' || v_enr.course_id || '-' || v_enr.employee_id;

  IF NOT EXISTS (SELECT 1 FROM lms_certificates WHERE course_id = v_enr.course_id AND employee_id = v_enr.employee_id) THEN
    INSERT INTO lms_certificates (enrollment_id, course_id, employee_id, certificate_number, score, tier, issued_at, organization_id)
    VALUES (p_enrollment_id, v_enr.course_id, v_enr.employee_id, v_certnum, v_score, v_tier, now(), v_org);
    INSERT INTO notifications (type, title, read, recipient_emp_id, organization_id)
    VALUES ('結業證書', '恭喜 ' || COALESCE(v_name, '您') || ' 完成「' || v_course.title || '」並獲得' || v_tier || '級證書', false, v_enr.employee_id, v_org);
  END IF;
  RETURN v_tier;
END $function$;

-- ── 課程詳情(章節/單元 + 我的報名/進度)──
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
    )
  );
END $function$;

-- ── 標記文字/影片單元完成 ──
CREATE OR REPLACE FUNCTION public.liff_lms_complete_lesson(p_line_user_id text, p_lesson_id integer)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp employees; v_lesson lms_lessons; v_enr lms_enrollments; v_tier text;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  SELECT * INTO v_lesson FROM lms_lessons WHERE id = p_lesson_id;
  IF v_lesson.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'LESSON_NOT_FOUND'); END IF;
  IF v_lesson.type IN ('quiz', 'assignment') THEN RETURN json_build_object('ok', false, 'error', 'NEED_ACTION'); END IF;
  SELECT * INTO v_enr FROM lms_enrollments WHERE course_id = v_lesson.course_id AND employee_id = emp.id;
  IF v_enr.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_ENROLLED'); END IF;

  INSERT INTO lms_progress (enrollment_id, lesson_id, completed, completed_at)
  VALUES (v_enr.id, p_lesson_id, true, now())
  ON CONFLICT (enrollment_id, lesson_id) DO UPDATE SET completed = true, completed_at = now();

  v_tier := public._liff_lms_finalize(v_enr.id);
  RETURN json_build_object('ok', true, 'course_completed', v_tier IS NOT NULL, 'tier', v_tier);
END $function$;

-- ── 交測驗(前端已依 quiz_data 算分,傳 score/passed;伺服器存檔 + 判完課)──
CREATE OR REPLACE FUNCTION public.liff_lms_submit_quiz(p_line_user_id text, p_lesson_id integer, p_score integer, p_passed boolean)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp employees; v_lesson lms_lessons; v_enr lms_enrollments; v_tier text;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  SELECT * INTO v_lesson FROM lms_lessons WHERE id = p_lesson_id;
  IF v_lesson.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'LESSON_NOT_FOUND'); END IF;
  SELECT * INTO v_enr FROM lms_enrollments WHERE course_id = v_lesson.course_id AND employee_id = emp.id;
  IF v_enr.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_ENROLLED'); END IF;

  INSERT INTO lms_progress (enrollment_id, lesson_id, completed, score, completed_at)
  VALUES (v_enr.id, p_lesson_id, COALESCE(p_passed, false), p_score, CASE WHEN p_passed THEN now() ELSE NULL END)
  ON CONFLICT (enrollment_id, lesson_id) DO UPDATE
    SET completed = COALESCE(p_passed, false), score = p_score, completed_at = CASE WHEN p_passed THEN now() ELSE NULL END;

  IF p_passed THEN v_tier := public._liff_lms_finalize(v_enr.id); END IF;
  RETURN json_build_object('ok', true, 'score', p_score, 'passed', p_passed, 'course_completed', v_tier IS NOT NULL, 'tier', v_tier);
END $function$;

GRANT EXECUTE ON FUNCTION public.liff_lms_course_detail(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_lms_complete_lesson(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_lms_submit_quiz(text, integer, integer, boolean) TO anon, authenticated;
