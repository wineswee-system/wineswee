-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 招募系統 — SECURITY DEFINER RPCs
-- ----------------------------------------------------------------------------
-- 對應 LIFF 4 個頁面：
--   1. /recruitment              → liff_get_recruitment_hub
--   2. /recruitment/candidate/:id → liff_get_candidate_detail
--   3. /recruitment/interview/:id → liff_get_interview_detail
--   4. /recruitment/interview/:id/eval → liff_submit_interview_eval
--
-- 權限：使用者必須是該面試的 interviewer，或該候選人 job 的 created_by，
-- 或該候選人的 created_by（HR）才能看
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Hub：我相關的面試 + 候選人 ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_get_recruitment_hub(
  p_line_user_id TEXT
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
       rj.created_by = v_emp.id
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
END $$;

REVOKE ALL ON FUNCTION public.liff_get_recruitment_hub(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.liff_get_recruitment_hub(TEXT) TO authenticated, anon;


-- ─── 2. 候選人詳情（含面試紀錄、評核範本）────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_get_candidate_detail(
  p_line_user_id TEXT,
  p_candidate_id INT
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
    IF v_job.created_by = v_emp.id THEN v_can_view := TRUE; END IF;
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
      'description', v_job.description
    ) ELSE NULL END,
    'evaluation_template', CASE WHEN v_tpl.id IS NOT NULL THEN jsonb_build_object(
      'id', v_tpl.id, 'name', v_tpl.name, 'dimensions', v_tpl.dimensions
    ) ELSE NULL END,
    'interviews', v_interviews
  );
END $$;

REVOKE ALL ON FUNCTION public.liff_get_candidate_detail(TEXT, INT) FROM public;
GRANT EXECUTE ON FUNCTION public.liff_get_candidate_detail(TEXT, INT) TO authenticated, anon;


-- ─── 3. 面試詳情（含候選人摘要、評核範本）────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_get_interview_detail(
  p_line_user_id TEXT,
  p_interview_id INT
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp    employees;
  v_iv     interviews;
  v_cand   candidates;
  v_job    recruitment_jobs;
  v_tpl    interview_evaluation_templates;
  v_prior  jsonb;
BEGIN
  SELECT * INTO v_emp FROM public._liff_resolve_employee(p_line_user_id);
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthorized');
  END IF;

  SELECT * INTO v_iv FROM interviews WHERE id = p_interview_id;
  IF v_iv.id IS NULL OR v_iv.organization_id <> v_emp.organization_id THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  -- 必須是面試官
  IF v_iv.interviewer_id <> v_emp.id THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT * INTO v_cand FROM candidates WHERE id = v_iv.candidate_id;
  IF v_cand.job_id IS NOT NULL THEN
    SELECT * INTO v_job FROM recruitment_jobs WHERE id = v_cand.job_id;
    IF v_job.evaluation_template_id IS NOT NULL THEN
      SELECT * INTO v_tpl FROM interview_evaluation_templates WHERE id = v_job.evaluation_template_id;
    END IF;
  END IF;

  -- 前次面試紀錄（同候選人，不含本場）
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', iv.id, 'round', iv.round,
    'scheduled_at', iv.scheduled_at,
    'interviewer_name', e.name,
    'result', iv.result, 'score', iv.score,
    'note', iv.note
  ) ORDER BY iv.scheduled_at), '[]'::jsonb)
    INTO v_prior
    FROM interviews iv
    LEFT JOIN employees e ON e.id = iv.interviewer_id
   WHERE iv.candidate_id = v_iv.candidate_id
     AND iv.id <> p_interview_id;

  RETURN jsonb_build_object(
    'interview', jsonb_build_object(
      'id', v_iv.id,
      'round', v_iv.round,
      'scheduled_at', v_iv.scheduled_at,
      'location', v_iv.location,
      'result', v_iv.result,
      'score', v_iv.score,
      'scores', v_iv.scores,
      'note', v_iv.note
    ),
    'candidate', jsonb_build_object(
      'id', v_cand.id, 'name', v_cand.name,
      'email', v_cand.email, 'phone', v_cand.phone,
      'source', v_cand.source, 'stage', v_cand.stage,
      'resume_url', v_cand.resume_url, 'tags', v_cand.tags
    ),
    'job', CASE WHEN v_job.id IS NOT NULL THEN jsonb_build_object(
      'id', v_job.id, 'title', v_job.title, 'dept', v_job.dept
    ) ELSE NULL END,
    'evaluation_template', CASE WHEN v_tpl.id IS NOT NULL THEN jsonb_build_object(
      'id', v_tpl.id, 'name', v_tpl.name, 'dimensions', v_tpl.dimensions
    ) ELSE NULL END,
    'prior_interviews', v_prior
  );
END $$;

REVOKE ALL ON FUNCTION public.liff_get_interview_detail(TEXT, INT) FROM public;
GRANT EXECUTE ON FUNCTION public.liff_get_interview_detail(TEXT, INT) TO authenticated, anon;


-- ─── 4. 提交評核（多維度評分 + 結果 + 備註）──────────────────────────
CREATE OR REPLACE FUNCTION public.liff_submit_interview_eval(
  p_line_user_id TEXT,
  p_interview_id INT,
  p_scores       JSONB,   -- 多維度 { dim_key: score }，沒範本就傳 {}
  p_score        INT,     -- 總分（加權平均，或單一 1-5）
  p_result       TEXT,    -- '通過' / '不通過'
  p_note         TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp employees;
  v_iv  interviews;
BEGIN
  SELECT * INTO v_emp FROM public._liff_resolve_employee(p_line_user_id);
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_iv FROM interviews WHERE id = p_interview_id;
  IF v_iv.id IS NULL OR v_iv.organization_id <> v_emp.organization_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_iv.interviewer_id <> v_emp.id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_result NOT IN ('通過', '不通過') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_result');
  END IF;

  UPDATE interviews
     SET scores = COALESCE(p_scores, '{}'::jsonb),
         score  = p_score,
         result = p_result,
         note   = COALESCE(p_note, note),
         updated_at = NOW()
   WHERE id = p_interview_id;
  -- DB trigger 會自動：
  --   · '不通過' → candidate.stage='淘汰'
  --   · 推 hr-notify type='interview_completed' 給 HR

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.liff_submit_interview_eval(TEXT, INT, JSONB, INT, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.liff_submit_interview_eval(TEXT, INT, JSONB, INT, TEXT, TEXT) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
