-- ════════════════════════════════════════════════════════════════════════════
-- 招募系統 3 個自動連動
-- ----------------------------------------------------------------------------
-- 1. 需求單核准 → 自動建職缺
--    headcount_requests.status='已核准' → INSERT into recruitment_jobs
--    + 反向回寫 headcount_requests.job_id
--
-- 2. 面試完成 → 自動推階段
--    interviews.result='不通過' → candidates.stage='淘汰'
--    interviews INSERT 給 stage 在 投遞/篩選 的候選人 → 自動推到 面試
--    （'通過' 不自動往前推，HR 決定何時進「錄取決定」）
--
-- 3. 面試完成 → 推 LINE 給負責 HR
--    interviews.result 從 '待定' 變 '通過'/'不通過' → 推 hr-notify
--    type='interview_completed'
--    收件人：候選人的 created_by + 對應 recruitment_jobs.created_by（去重）
--
-- 所有 trigger 都包 EXCEPTION 防 schema drift
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. headcount_requests 核准 → 建 recruitment_jobs
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_headcount_create_job_on_approve()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_new_job_id INT;
  v_dept_name  TEXT;
  v_creator    INT;
BEGIN
  -- 只在剛從別的 status 變成「已核准」/'approved' 時動
  IF NEW.status NOT IN ('已核准', 'approved') THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  -- 已經有對應 job 就不再建
  IF NEW.job_id IS NOT NULL THEN RETURN NEW; END IF;

  -- 取部門名（need_dept_id → departments.name，沒有 fallback dept text 欄位）
  BEGIN
    SELECT name INTO v_dept_name FROM departments WHERE id = NEW.need_dept_id;
  EXCEPTION WHEN undefined_column THEN
    v_dept_name := NULL;
  END;
  IF v_dept_name IS NULL THEN
    BEGIN v_dept_name := NEW.dept; EXCEPTION WHEN undefined_column THEN END;
  END IF;

  v_creator := COALESCE(NEW.reviewed_by, NEW.created_by, NEW.employee_id);

  -- 建 job：欄位用 BEGIN/EXCEPTION 包，schema 不同也能繼續
  BEGIN
    INSERT INTO recruitment_jobs (
      title, dept, type, headcount, status, posted,
      organization_id, headcount_request_id, created_by, description
    ) VALUES (
      COALESCE(NEW.job_title, NEW.position_title, '未命名職缺'),
      v_dept_name,
      COALESCE(NEW.job_type, '全職'),
      COALESCE(NEW.headcount, 1),
      '招募中',
      CURRENT_DATE,
      NEW.organization_id,
      NEW.id,
      v_creator,
      COALESCE(NEW.job_description, NEW.reason, NULL)
    ) RETURNING id INTO v_new_job_id;
  EXCEPTION WHEN undefined_column THEN
    -- 退化：只塞最基本欄位
    INSERT INTO recruitment_jobs (title, headcount_request_id, organization_id)
    VALUES (
      COALESCE(NEW.job_title, NEW.position_title, '未命名職缺'),
      NEW.id, NEW.organization_id
    ) RETURNING id INTO v_new_job_id;
  END;

  -- 反向回寫
  UPDATE headcount_requests SET job_id = v_new_job_id WHERE id = NEW.id;

  RETURN NEW;
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN NEW;  -- schema 太破不要擋 UPDATE
END $$;

DROP TRIGGER IF EXISTS trg_headcount_create_job ON public.headcount_requests;
CREATE TRIGGER trg_headcount_create_job
  AFTER UPDATE OF status ON public.headcount_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_headcount_create_job_on_approve();


-- ═════════════════════════════════════════════════════════════════════════
-- 2a. interviews INSERT → 候選人 stage 從 '投遞'/'篩選' 推到 '面試'
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_interview_advance_to_face()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_curr_stage TEXT;
  v_hist       jsonb;
BEGIN
  SELECT stage, stage_history INTO v_curr_stage, v_hist
    FROM candidates WHERE id = NEW.candidate_id;
  IF v_curr_stage IS NULL THEN RETURN NEW; END IF;

  IF v_curr_stage IN ('投遞', '篩選') THEN
    UPDATE candidates SET
      stage = '面試',
      stage_history = COALESCE(v_hist, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('stage', '面試', 'changed_at', NOW()::TEXT, 'reason', '安排面試自動推進')
      )
     WHERE id = NEW.candidate_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_interview_insert_advance_stage ON public.interviews;
CREATE TRIGGER trg_interview_insert_advance_stage
  AFTER INSERT ON public.interviews
  FOR EACH ROW EXECUTE FUNCTION public._trg_interview_advance_to_face();


-- ═════════════════════════════════════════════════════════════════════════
-- 2b. interviews.result 變 '不通過' → 候選人 stage='淘汰'
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_interview_fail_to_dropped()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_curr_stage TEXT;
  v_hist       jsonb;
BEGIN
  IF NEW.result IS NOT DISTINCT FROM OLD.result THEN RETURN NEW; END IF;
  IF NEW.result <> '不通過' THEN RETURN NEW; END IF;

  SELECT stage, stage_history INTO v_curr_stage, v_hist
    FROM candidates WHERE id = NEW.candidate_id;
  IF v_curr_stage IS NULL OR v_curr_stage = '淘汰' THEN RETURN NEW; END IF;

  UPDATE candidates SET
    stage = '淘汰',
    hire_status = NULL,
    stage_history = COALESCE(v_hist, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('stage', '淘汰', 'changed_at', NOW()::TEXT,
        'reason', '面試 #' || NEW.id || ' 不通過')
    )
   WHERE id = NEW.candidate_id;

  RETURN NEW;
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_interview_fail_to_dropped ON public.interviews;
CREATE TRIGGER trg_interview_fail_to_dropped
  AFTER UPDATE OF result ON public.interviews
  FOR EACH ROW EXECUTE FUNCTION public._trg_interview_fail_to_dropped();


-- ═════════════════════════════════════════════════════════════════════════
-- 3. 面試完成 → 推 hr-notify 給負責 HR（候選人 created_by + job created_by）
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_interview_notify_completed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url      CONSTANT TEXT := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_anon     CONSTANT TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_cand     candidates;
  v_job_creator INT;
  v_recipient INT;
  v_interviewer_name TEXT;
  v_payload  jsonb;
BEGIN
  -- 只在 result 從 '待定' 變成 '通過'/'不通過' 時推
  IF NEW.result IS NOT DISTINCT FROM OLD.result THEN RETURN NEW; END IF;
  IF NEW.result NOT IN ('通過', '不通過') THEN RETURN NEW; END IF;

  SELECT * INTO v_cand FROM candidates WHERE id = NEW.candidate_id;
  IF v_cand.id IS NULL THEN RETURN NEW; END IF;

  -- 撈 job created_by
  IF v_cand.job_id IS NOT NULL THEN
    SELECT created_by INTO v_job_creator FROM recruitment_jobs WHERE id = v_cand.job_id;
  END IF;

  -- 撈面試官名（給通知顯示用）
  SELECT name INTO v_interviewer_name FROM employees WHERE id = NEW.interviewer_id;

  -- 收件人：候選人 created_by + job created_by 去重；都沒有就不推
  FOR v_recipient IN
    SELECT DISTINCT x FROM (
      VALUES (v_cand.created_by), (v_job_creator)
    ) t(x) WHERE x IS NOT NULL
  LOOP
    v_payload := jsonb_build_object(
      'employee_id', v_recipient,
      'type', 'interview_completed',
      'details', jsonb_build_object(
        'candidate_id', v_cand.id,
        'candidate_name', v_cand.name,
        'interview_id', NEW.id,
        'round', NEW.round,
        'result', NEW.result,
        'score', NEW.score,
        'note', NEW.note,
        'interviewer_name', v_interviewer_name,
        'job_id', v_cand.job_id
      )
    );
    BEGIN
      PERFORM net.http_post(
        url := v_url,
        body := v_payload,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_anon
        ),
        timeout_milliseconds := 5000
      );
    EXCEPTION WHEN OTHERS THEN
      -- 推不出去不要擋 UPDATE
      NULL;
    END;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_interview_notify_completed ON public.interviews;
CREATE TRIGGER trg_interview_notify_completed
  AFTER UPDATE OF result ON public.interviews
  FOR EACH ROW EXECUTE FUNCTION public._trg_interview_notify_completed();

COMMIT;

NOTIFY pgrst, 'reload schema';
