-- ============================================================
-- LIFF：我的教育訓練
--
-- 員工自助場景：
--   1. liff_list_training_courses：列出公司開課中的所有課程（依員工 tenant 過濾）
--   2. liff_list_my_enrollments：我已報名/已上過的課
--   3. liff_enroll_course：自助報名
--   4. liff_cancel_enrollment：取消報名（只能取消自己的「已報名」狀態）
--
-- 安全性：
--   - 所有寫入動作都驗證員工身份來自 LINE binding
--   - 取消報名有防呆：只能取消自己的、且狀態必須是「已報名」（已開始/完成的不能取消）
--   - 報名前檢查：課程必須是「開課中」且未額滿
-- ============================================================

-- ═══ 1. liff_list_training_courses ═══
CREATE OR REPLACE FUNCTION public.liff_list_training_courses(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'courses', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',              c.id,
        'title',           c.title,
        'description',     c.description,
        'category',        c.category,
        'duration_hours',  c.duration_hours,
        'instructor',      c.instructor,
        'max_enrollment',  c.max_enrollment,
        'status',          c.status,
        'enrolled_count',  (SELECT count(*) FROM public.training_enrollments te WHERE te.course_id = c.id),
        'i_enrolled',      EXISTS (
          SELECT 1 FROM public.training_enrollments te
          WHERE te.course_id = c.id AND te.employee = emp.name
        ),
        'my_status',       (
          SELECT te.status FROM public.training_enrollments te
          WHERE te.course_id = c.id AND te.employee = emp.name
          LIMIT 1
        )
      ) ORDER BY c.id DESC), '[]'::json)
      FROM public.training_courses c
      WHERE c.status = '開課中'
        AND (c.tenant_id IS NULL OR c.tenant_id = emp.tenant_id)
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_training_courses(text) TO anon, authenticated;


-- ═══ 2. liff_list_my_enrollments ═══
CREATE OR REPLACE FUNCTION public.liff_list_my_enrollments(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'enrollments', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',              te.id,
        'course_id',       te.course_id,
        'course_title',    c.title,
        'category',        c.category,
        'duration_hours',  c.duration_hours,
        'instructor',      c.instructor,
        'status',          te.status,
        'score',           te.score,
        'completed_at',    te.completed_at,
        'created_at',      te.created_at
      ) ORDER BY
        CASE te.status WHEN '已完成' THEN 2 WHEN '未通過' THEN 3 ELSE 1 END,
        te.created_at DESC
      ), '[]'::json)
      FROM public.training_enrollments te
      JOIN public.training_courses c ON c.id = te.course_id
      WHERE te.employee = emp.name
    ),
    'summary', (
      SELECT json_build_object(
        'total',       count(*),
        'in_progress', count(*) FILTER (WHERE status IN ('已報名', '進行中')),
        'completed',   count(*) FILTER (WHERE status = '已完成'),
        'failed',      count(*) FILTER (WHERE status = '未通過'),
        'total_hours', COALESCE(sum(c.duration_hours) FILTER (WHERE te.status = '已完成'), 0)
      )
      FROM public.training_enrollments te
      JOIN public.training_courses c ON c.id = te.course_id
      WHERE te.employee = emp.name
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_enrollments(text) TO anon, authenticated;


-- ═══ 3. liff_enroll_course ═══
CREATE OR REPLACE FUNCTION public.liff_enroll_course(
  p_line_user_id text,
  p_course_id    int
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  course     training_courses;
  curr_count int;
  new_id     int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO course FROM public.training_courses WHERE id = p_course_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'COURSE_NOT_FOUND');
  END IF;

  IF course.status <> '開課中' THEN
    RETURN json_build_object('ok', false, 'error', 'COURSE_CLOSED');
  END IF;

  -- tenant 隔離：員工不能跨 tenant 報名
  IF course.tenant_id IS NOT NULL AND course.tenant_id <> emp.tenant_id THEN
    RETURN json_build_object('ok', false, 'error', 'TENANT_MISMATCH');
  END IF;

  -- 重複報名檢查
  IF EXISTS (SELECT 1 FROM public.training_enrollments WHERE course_id = p_course_id AND employee = emp.name) THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_ENROLLED');
  END IF;

  -- 額滿檢查
  SELECT count(*) INTO curr_count FROM public.training_enrollments WHERE course_id = p_course_id;
  IF course.max_enrollment IS NOT NULL AND curr_count >= course.max_enrollment THEN
    RETURN json_build_object('ok', false, 'error', 'COURSE_FULL');
  END IF;

  INSERT INTO public.training_enrollments (course_id, employee, status, tenant_id)
  VALUES (p_course_id, emp.name, '已報名', emp.tenant_id)
  RETURNING id INTO new_id;

  RETURN json_build_object('ok', true, 'enrollment_id', new_id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_enroll_course(text, int) TO anon, authenticated;


-- ═══ 4. liff_cancel_enrollment ═══
CREATE OR REPLACE FUNCTION public.liff_cancel_enrollment(
  p_line_user_id   text,
  p_enrollment_id  int
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  n   int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 只能取消「自己的」+「已報名」狀態（已開始/完成的不能取消）
  DELETE FROM public.training_enrollments
   WHERE id = p_enrollment_id
     AND employee = emp.name
     AND status = '已報名';
  GET DIAGNOSTICS n = ROW_COUNT;

  IF n = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'CANNOT_CANCEL');
  END IF;

  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_cancel_enrollment(text, int) TO anon, authenticated;
