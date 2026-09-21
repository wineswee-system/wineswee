-- LIFF 手機上傳作業:開放 anon 上傳 lms-uploads(LIFF 用 anon key)+ 記錄作業 RPC。
-- 對齊 web:作業存 lms_quiz_submissions(needs_review,answers=[{type:file,url,name}]),進「測驗批閱」中心通過/退回。

-- 開放 anon 上傳(read 已是 public)
DROP POLICY IF EXISTS lms_uploads_insert ON storage.objects;
CREATE POLICY lms_uploads_insert ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'lms-uploads');

CREATE OR REPLACE FUNCTION public.liff_lms_submit_assignment(p_line_user_id text, p_lesson_id integer, p_file_url text, p_file_name text)
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
  IF COALESCE(p_file_url, '') = '' THEN RETURN json_build_object('ok', false, 'error', 'NO_FILE'); END IF;

  INSERT INTO lms_quiz_submissions (enrollment_id, lesson_id, course_id, employee_id, answers, auto_points, total_points, needs_review, status, score, grades, graded_by, graded_at, organization_id)
  VALUES (v_enr.id, p_lesson_id, v_lesson.course_id, emp.id,
          json_build_array(json_build_object('type', 'file', 'url', p_file_url, 'name', COALESCE(p_file_name, '檔案')))::jsonb,
          0, 0, true, 'submitted', NULL, '{}'::jsonb, NULL, NULL, emp.organization_id)
  ON CONFLICT (enrollment_id, lesson_id) DO UPDATE
    SET answers = EXCLUDED.answers, needs_review = true, status = 'submitted', score = NULL, grades = '{}'::jsonb, graded_by = NULL, graded_at = NULL;

  RETURN json_build_object('ok', true, 'pending', true);
END $function$;

GRANT EXECUTE ON FUNCTION public.liff_lms_submit_assignment(text, integer, text, text) TO anon, authenticated;
