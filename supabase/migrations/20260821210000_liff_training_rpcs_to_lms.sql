-- LIFF 教育訓練搬遷:4 支 RPC 從舊 training_* 改讀寫新 lms_*(web/LIFF 同一套資料)。
-- 保留函式名、參數、回傳鍵與錯誤碼不變 → LIFF 前端(Training.jsx)零改動。
-- 映射:duration_hours←estimated_hours、status '開課中'←'發布'、employee(名字)←employee_id、
--       instructor/max_enrollment 新模型無 → 回 null;score 取結業證書分數。

-- ── 可報名課程清單 ──
CREATE OR REPLACE FUNCTION public.liff_list_training_courses(p_line_user_id text)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  RETURN json_build_object('ok', true, 'courses', (
    SELECT COALESCE(json_agg(json_build_object(
      'id',              c.id,
      'title',           c.title,
      'description',     c.description,
      'category',        c.category,
      'duration_hours',  c.estimated_hours,
      'instructor',      NULL,
      'max_enrollment',  NULL,
      'status',          c.status,
      'enrolled_count',  (SELECT count(*) FROM public.lms_enrollments e WHERE e.course_id = c.id),
      'i_enrolled',      EXISTS (SELECT 1 FROM public.lms_enrollments e WHERE e.course_id = c.id AND e.employee_id = emp.id),
      'my_status',       (SELECT e.status FROM public.lms_enrollments e WHERE e.course_id = c.id AND e.employee_id = emp.id LIMIT 1)
    ) ORDER BY c.id DESC), '[]'::json)
    FROM public.lms_courses c
    WHERE c.status = '發布'
      AND (c.organization_id IS NULL OR c.organization_id = emp.organization_id)
  ));
END $function$;

-- ── 我的報名/學習 ──
CREATE OR REPLACE FUNCTION public.liff_list_my_enrollments(p_line_user_id text)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  RETURN json_build_object(
    'ok', true,
    'enrollments', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',             e.id,
        'course_id',      e.course_id,
        'course_title',   c.title,
        'category',       c.category,
        'duration_hours', c.estimated_hours,
        'instructor',     NULL,
        'status',         e.status,
        'score',          (SELECT cert.score FROM public.lms_certificates cert
                           WHERE cert.course_id = e.course_id AND cert.employee_id = emp.id
                           ORDER BY cert.issued_at DESC LIMIT 1),
        'completed_at',   e.completed_at,
        'created_at',     e.enrolled_at
      ) ORDER BY CASE e.status WHEN '已完成' THEN 2 WHEN '未通過' THEN 3 ELSE 1 END, e.enrolled_at DESC
      ), '[]'::json)
      FROM public.lms_enrollments e
      JOIN public.lms_courses c ON c.id = e.course_id
      WHERE e.employee_id = emp.id
    ),
    'summary', (
      SELECT json_build_object(
        'total',       count(*),
        'in_progress', count(*) FILTER (WHERE e.status IN ('已報名', '進行中')),
        'completed',   count(*) FILTER (WHERE e.status = '已完成'),
        'failed',      count(*) FILTER (WHERE e.status = '未通過'),
        'total_hours', COALESCE(sum(c.estimated_hours) FILTER (WHERE e.status = '已完成'), 0)
      )
      FROM public.lms_enrollments e
      JOIN public.lms_courses c ON c.id = e.course_id
      WHERE e.employee_id = emp.id
    )
  );
END $function$;

-- ── 報名課程 ──
CREATE OR REPLACE FUNCTION public.liff_enroll_course(p_line_user_id text, p_course_id integer)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp employees; course lms_courses; new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO course FROM public.lms_courses WHERE id = p_course_id;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'COURSE_NOT_FOUND'); END IF;
  IF course.status <> '發布' THEN RETURN json_build_object('ok', false, 'error', 'COURSE_CLOSED'); END IF;
  IF course.organization_id IS NOT NULL AND course.organization_id <> emp.organization_id THEN
    RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
  END IF;
  IF EXISTS (SELECT 1 FROM public.lms_enrollments WHERE course_id = p_course_id AND employee_id = emp.id) THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_ENROLLED');
  END IF;

  INSERT INTO public.lms_enrollments (course_id, employee_id, status, enrolled_by, organization_id)
  VALUES (p_course_id, emp.id, '進行中', 'self', emp.organization_id)
  RETURNING id INTO new_id;

  RETURN json_build_object('ok', true, 'enrollment_id', new_id);
END $function$;

-- ── 取消報名(未完成才可取消)──
CREATE OR REPLACE FUNCTION public.liff_cancel_enrollment(p_line_user_id text, p_enrollment_id integer)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp employees; n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  DELETE FROM public.lms_enrollments
   WHERE id = p_enrollment_id AND employee_id = emp.id AND status <> '已完成';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN json_build_object('ok', false, 'error', 'CANNOT_CANCEL'); END IF;

  RETURN json_build_object('ok', true);
END $function$;
