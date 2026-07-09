-- Tier4 B 組:招募 2 支 + 報名 1 支欄位對齊 — 2026-07-08
-- liff_get_recruitment_hub:recruitment_jobs 無 created_by(candidates 才有)→只用 c.created_by。
-- liff_get_candidate_detail:recruitment_jobs 無 created_by/description→移職缺建立者檢查+description 回 NULL。
-- liff_list_my_enrollments:status 在 te/c 皆有→summary 三處 bare status 加 te. 前綴。
-- (目標 2 支因 performance_goals 是骨架表,待老闆補欄再接)

CREATE OR REPLACE FUNCTION public.liff_get_recruitment_hub(p_line_user_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp           employees;
  v_upcoming      jsonb;
  v_past          jsonb;
  v_my_candidates jsonb;
BEGIN
  SELECT * INTO v_emp FROM public._liff_resolve_employee(p_line_user_id);
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthorized');
  END IF;

  -- 「我是面試官」即將/今天的面試（未來 14 天 + 今天）
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', iv.id,
    'candidate_id', iv.candidate_id,
    'candidate_name', c.name,
    'job_title', rj.title,
    'round', iv.round,
    'scheduled_at', iv.scheduled_at,
    'location', iv.location,
    'result', iv.result
  ) ORDER BY iv.scheduled_at), '[]'::jsonb)
    INTO v_upcoming
    FROM interviews iv
    LEFT JOIN candidates c ON c.id = iv.candidate_id
    LEFT JOIN recruitment_jobs rj ON rj.id = c.job_id
   WHERE iv.interviewer_id = v_emp.id
     AND iv.scheduled_at >= NOW() - INTERVAL '1 day'
     AND iv.scheduled_at <= NOW() + INTERVAL '14 days';

  -- 「我面過但還沒打分」過去 30 天
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', iv.id,
    'candidate_id', iv.candidate_id,
    'candidate_name', c.name,
    'job_title', rj.title,
    'round', iv.round,
    'scheduled_at', iv.scheduled_at,
    'result', iv.result
  ) ORDER BY iv.scheduled_at DESC), '[]'::jsonb)
    INTO v_past
    FROM interviews iv
    LEFT JOIN candidates c ON c.id = iv.candidate_id
    LEFT JOIN recruitment_jobs rj ON rj.id = c.job_id
   WHERE iv.interviewer_id = v_emp.id
     AND iv.scheduled_at < NOW()
     AND iv.scheduled_at >= NOW() - INTERVAL '30 days'
     AND iv.result = '待定';

  -- 「我負責招的候選人」（job.created_by = me，stage 還在進行中）
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'stage', c.stage,
    'job_title', rj.title,
    'created_at', c.created_at::DATE,
    'tags', c.tags
  ) ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_my_candidates
    FROM candidates c
    LEFT JOIN recruitment_jobs rj ON rj.id = c.job_id
   WHERE c.organization_id = v_emp.organization_id
     AND (
       FALSE  -- recruitment_jobs 無 created_by,只看 candidates.created_by
       OR c.created_by = v_emp.id
     )
     AND c.stage NOT IN ('已錄取', '淘汰');

  RETURN jsonb_build_object(
    'me', jsonb_build_object('id', v_emp.id, 'name', v_emp.name),
    'upcoming_interviews', v_upcoming,
    'past_pending_eval', v_past,
    'my_candidates', v_my_candidates,
    'generated_at', NOW()
  );
END $function$;

CREATE OR REPLACE FUNCTION public.liff_get_candidate_detail(p_line_user_id text, p_candidate_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp        employees;
  v_cand       candidates;
  v_job        recruitment_jobs;
  v_tpl        interview_evaluation_templates;
  v_interviews jsonb;
  v_can_view   BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_emp FROM public._liff_resolve_employee(p_line_user_id);
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthorized');
  END IF;

  SELECT * INTO v_cand FROM candidates WHERE id = p_candidate_id;
  IF v_cand.id IS NULL OR v_cand.organization_id <> v_emp.organization_id THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  -- 權限：我是面試官 OR 我建檔 OR 我建職缺
  IF EXISTS (SELECT 1 FROM interviews WHERE candidate_id = p_candidate_id AND interviewer_id = v_emp.id) THEN
    v_can_view := TRUE;
  END IF;
  IF v_cand.created_by = v_emp.id THEN v_can_view := TRUE; END IF;
  IF v_cand.job_id IS NOT NULL THEN
    SELECT * INTO v_job FROM recruitment_jobs WHERE id = v_cand.job_id;
    -- recruitment_jobs 無 created_by 欄,移除職缺建立者檢查
  END IF;
  IF NOT v_can_view THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  -- 職缺的評核範本
  IF v_job.evaluation_template_id IS NOT NULL THEN
    SELECT * INTO v_tpl FROM interview_evaluation_templates WHERE id = v_job.evaluation_template_id;
  END IF;

  -- 該候選人所有面試
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', iv.id,
    'round', iv.round,
    'scheduled_at', iv.scheduled_at,
    'location', iv.location,
    'interviewer_id', iv.interviewer_id,
    'interviewer_name', e.name,
    'result', iv.result,
    'score', iv.score,
    'scores', iv.scores,
    'note', iv.note,
    'is_mine', (iv.interviewer_id = v_emp.id)
  ) ORDER BY iv.scheduled_at), '[]'::jsonb)
    INTO v_interviews
    FROM interviews iv
    LEFT JOIN employees e ON e.id = iv.interviewer_id
   WHERE iv.candidate_id = p_candidate_id;

  RETURN jsonb_build_object(
    'candidate', jsonb_build_object(
      'id', v_cand.id,
      'name', v_cand.name,
      'email', v_cand.email,
      'phone', v_cand.phone,
      'source', v_cand.source,
      'stage', v_cand.stage,
      'notes', v_cand.notes,
      'resume_url', v_cand.resume_url,
      'tags', v_cand.tags,
      'created_at', v_cand.created_at::DATE
    ),
    'job', CASE WHEN v_job.id IS NOT NULL THEN jsonb_build_object(
      'id', v_job.id,
      'title', v_job.title,
      'dept', v_job.dept,
      'location', v_job.location,
      'description', NULL  -- recruitment_jobs 無 description 欄
    ) ELSE NULL END,
    'evaluation_template', CASE WHEN v_tpl.id IS NOT NULL THEN jsonb_build_object(
      'id', v_tpl.id, 'name', v_tpl.name, 'dimensions', v_tpl.dimensions
    ) ELSE NULL END,
    'interviews', v_interviews
  );
END $function$;

CREATE OR REPLACE FUNCTION public.liff_list_my_enrollments(p_line_user_id text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        'in_progress', count(*) FILTER (WHERE te.status IN ('已報名', '進行中')),
        'completed',   count(*) FILTER (WHERE te.status = '已完成'),
        'failed',      count(*) FILTER (WHERE te.status = '未通過'),
        'total_hours', COALESCE(sum(c.duration_hours) FILTER (WHERE te.status = '已完成'), 0)
      )
      FROM public.training_enrollments te
      JOIN public.training_courses c ON c.id = te.course_id
      WHERE te.employee = emp.name
    )
  );
END $function$;

NOTIFY pgrst, 'reload schema';
