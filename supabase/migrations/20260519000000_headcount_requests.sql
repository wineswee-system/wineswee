-- ════════════════════════════════════════════════════════════════════════════
-- 人力需求申請單 (headcount_requests)
-- ────────────────────────────────────────────────────────────────────────────
-- 對齊既有 HR B 類三表（resignation / loa / transfer）pattern：
--   - approval_chain_id + current_step (0-indexed)
--   - status: 申請中 / 已核准 / 已駁回 / 已取消
--   - 走 hr_chain_approve / hr_chain_resolve_first_approvers RPC（用 'headcount' 識別）
--   - 加進 _extra_step_allowed_tables 支援加簽
--   - form_no 自動生成 (YYYYMMDDA001001 格式：日期+'A'+6 位日內流水)
--
-- 不接 HR B LINE flex 推送 trigger (phase 2 再做)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 主表 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.headcount_requests (
  id                    SERIAL PRIMARY KEY,
  form_no               TEXT UNIQUE,                                 -- 自動生成 YYYYMMDDA001001
  organization_id       INT NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  -- 申請人
  employee_id           INT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  applicant_dept_id     INT REFERENCES public.departments(id) ON DELETE SET NULL,
  request_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  -- 需求 metadata
  need_dept_id          INT REFERENCES public.departments(id) ON DELETE SET NULL,
  headcount             INT NOT NULL CHECK (headcount > 0),          -- 需求人數
  new_reason            TEXT,                                        -- 新增人力原因
  -- 職務
  job_title             TEXT NOT NULL,                               -- 職務名稱 (PT/業務助理...)
  job_type              TEXT,                                        -- 兼職 / 正職 / 約聘 / 工讀
  job_description       TEXT,                                        -- 職務說明
  -- 待遇
  salary_type           TEXT,                                        -- 時薪 / 月薪 / 年薪 / 面議
  salary_range          TEXT,                                        -- '220' / '35000~45000' / '面議'
  management_resp       TEXT,                                        -- 管理責任
  business_travel       TEXT,                                        -- 出差外派
  -- 班別
  work_shift            TEXT,                                        -- 上班時段
  rest_policy           TEXT,                                        -- 休假制度
  -- 條件
  experience_required   TEXT,                                        -- 工作經驗
  education_required    TEXT,                                        -- 學歷要求
  major_required        TEXT,                                        -- 科系要求
  tool_required         TEXT,                                        -- 擅長工具
  other_conditions      TEXT,                                        -- 其他條件（multiline）
  -- 簽核
  status                TEXT NOT NULL DEFAULT '申請中',
  approval_chain_id     INT REFERENCES public.approval_chains(id) ON DELETE SET NULL,
  current_step          INT NOT NULL DEFAULT 0,
  approver_id           INT REFERENCES public.employees(id) ON DELETE SET NULL,
  approved_at           TIMESTAMPTZ,
  reject_reason         TEXT,
  -- 附件
  attachment_url        TEXT,
  -- timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_headcount_emp_status
  ON public.headcount_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_headcount_chain_step
  ON public.headcount_requests(approval_chain_id, current_step) WHERE status = '申請中';
CREATE INDEX IF NOT EXISTS idx_headcount_org_status
  ON public.headcount_requests(organization_id, status);

COMMENT ON TABLE public.headcount_requests IS
  '人力需求申請單 — 接 approval_chain，走 hr_chain_approve dispatch (p_table=''headcount'')';
COMMENT ON COLUMN public.headcount_requests.form_no IS
  '表單編號（YYYYMMDDA + 6 位日內流水），_gen_headcount_form_no 自動生成';


-- ─── 2. form_no 生成 trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._gen_headcount_form_no()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_date_part text;
  v_today_count int;
BEGIN
  IF NEW.form_no IS NOT NULL AND NEW.form_no <> '' THEN
    RETURN NEW;
  END IF;
  v_date_part := to_char(COALESCE(NEW.created_at, NOW()) AT TIME ZONE 'Asia/Taipei', 'YYYYMMDD');
  SELECT COUNT(*) + 1 INTO v_today_count
    FROM public.headcount_requests
   WHERE form_no LIKE v_date_part || 'A%';
  NEW.form_no := v_date_part || 'A' || lpad(v_today_count::text, 6, '0');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_headcount_gen_form_no ON public.headcount_requests;
CREATE TRIGGER trg_headcount_gen_form_no
  BEFORE INSERT ON public.headcount_requests
  FOR EACH ROW EXECUTE FUNCTION public._gen_headcount_form_no();


-- ─── 3. updated_at trigger ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._headcount_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_headcount_touch_updated_at ON public.headcount_requests;
CREATE TRIGGER trg_headcount_touch_updated_at
  BEFORE UPDATE ON public.headcount_requests
  FOR EACH ROW EXECUTE FUNCTION public._headcount_touch_updated_at();


-- ─── 4. 把 headcount_requests 加進加簽白名單 ────────────────────────────────
-- 既有版本只列 9 張（HR 5 + HR 異動 3 + expense_request + tasks），補一張
CREATE OR REPLACE FUNCTION public._extra_step_allowed_tables()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    -- HR Forms (5)
    'leave_requests',
    'overtime_requests',
    'business_trips',
    'clock_corrections',
    'expenses',
    -- HR Personnel Changes (3)
    'resignation_requests',
    'personnel_transfer_requests',
    'leave_of_absence_requests',
    -- Headcount Request
    'headcount_requests',
    -- Expense Applications
    'expense_requests',
    -- Task Chain Unified
    'tasks'
  ]::text[];
$$;


-- ─── 5. hr_chain_resolve_first_approvers: 加 'headcount' 分支 ───────────────
-- 1:1 重寫 20260508150000 版本，唯一新增是 CASE p_table 多一條 'headcount'
CREATE OR REPLACE FUNCTION public.hr_chain_resolve_first_approvers(
  p_table     text,
  p_id        int
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table_name text;
  v_chain_id   int;
  v_cur_step   int;
  v_org_id     int;
  v_emp_id     int;
  v_step       record;
  v_ids        int[];
  v_result     json;
BEGIN
  v_table_name := CASE p_table
    WHEN 'resignation' THEN 'resignation_requests'
    WHEN 'loa'         THEN 'leave_of_absence_requests'
    WHEN 'transfer'    THEN 'personnel_transfer_requests'
    WHEN 'headcount'   THEN 'headcount_requests'
    ELSE NULL
  END;
  IF v_table_name IS NULL THEN RETURN '[]'::json; END IF;

  EXECUTE format('SELECT approval_chain_id, current_step, organization_id, employee_id FROM %I WHERE id=$1', v_table_name)
    INTO v_chain_id, v_cur_step, v_org_id, v_emp_id USING p_id;

  IF v_chain_id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = v_cur_step;
  IF v_step.id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT array_agg(e.id) INTO v_ids FROM employees e
   WHERE e.status = '在職' AND e.organization_id = v_org_id
     AND public._employee_matches_chain_step(e.id, v_step.id, v_emp_id);

  SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_result
    FROM employees WHERE id = ANY(COALESCE(v_ids, ARRAY[]::INT[]));

  RETURN COALESCE(v_result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.hr_chain_resolve_first_approvers(text, int) TO authenticated;


-- ─── 6. hr_chain_approve: 加 'headcount' 分支 ──────────────────────────────
-- 1:1 重寫 20260517170000 版本，唯一新增是 CASE p_table 多一條 'headcount'
CREATE OR REPLACE FUNCTION public.hr_chain_approve(
  p_table        text,
  p_id           int,
  p_approver_id  int,
  p_action       text,
  p_reason       text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table_name  text;
  v_record      record;
  v_chain_id    int;
  v_cur_step    int;
  v_total_steps int;
  v_step        record;
  v_is_last     boolean;
  v_next_step   record;
  v_next_ids    int[];
  v_next_json   json;
  v_extra       approval_extra_steps;
BEGIN
  v_table_name := CASE p_table
    WHEN 'resignation' THEN 'resignation_requests'
    WHEN 'loa'         THEN 'leave_of_absence_requests'
    WHEN 'transfer'    THEN 'personnel_transfer_requests'
    WHEN 'headcount'   THEN 'headcount_requests'
    ELSE NULL
  END;
  IF v_table_name IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_TABLE');
  END IF;
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  EXECUTE format('SELECT id, approval_chain_id, current_step, status, employee_id, organization_id FROM %I WHERE id = $1', v_table_name)
    INTO v_record USING p_id;

  IF v_record.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_record.status <> '申請中' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  v_chain_id := v_record.approval_chain_id;
  v_cur_step := v_record.current_step;

  -- 加簽 guard：當前 step 若有 pending 加簽，禁止推進
  v_extra := public.get_pending_extra_step(v_table_name, p_id, COALESCE(v_cur_step, 0));
  IF v_extra.id IS NOT NULL THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'PENDING_EXTRA_SIGNER',
      'extra_step_id', v_extra.id,
      'extra_assignee_id', v_extra.assignee_id,
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
    );
  END IF;

  IF v_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW() WHERE id=$3', v_table_name)
        USING '已核准', p_approver_id, p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved_no_chain');
    ELSE
      EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW(), reject_reason=$3 WHERE id=$4', v_table_name)
        USING '已駁回', p_approver_id, btrim(p_reason), p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected_no_chain');
    END IF;
  END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = v_cur_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
  END IF;

  IF NOT public._employee_matches_chain_step(p_approver_id, v_step.id, v_record.employee_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_chain_id;
  v_is_last := (v_cur_step + 1 >= v_total_steps);

  IF p_action = 'reject' THEN
    EXECUTE format('UPDATE %I SET status=$1, reject_reason=$2, approver_id=$3 WHERE id=$4', v_table_name)
      USING '已駁回', btrim(p_reason), p_approver_id, p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected', 'rejected_at_step', v_cur_step);
  END IF;

  IF v_is_last THEN
    EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW() WHERE id=$3', v_table_name)
      USING '已核准', p_approver_id, p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved', 'is_last_step', true);
  ELSE
    EXECUTE format('UPDATE %I SET current_step=current_step+1 WHERE id=$1', v_table_name) USING p_id;
    SELECT * INTO v_next_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = v_cur_step + 1;
    SELECT array_agg(e.id) INTO v_next_ids FROM employees e
     WHERE e.status='在職' AND e.organization_id = v_record.organization_id
       AND public._employee_matches_chain_step(e.id, v_next_step.id, v_record.employee_id);
    SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_json
      FROM employees WHERE id = ANY(COALESCE(v_next_ids, ARRAY[]::INT[]));
    RETURN json_build_object('ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', v_cur_step + 1, 'is_last_step', false,
      'next_approvers', COALESCE(v_next_json, '[]'::json));
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION public.hr_chain_approve(text, int, int, text, text) TO authenticated, anon;


-- ─── 7. RLS：authenticated 全開（對齊 expense_requests），anon 不開 ─────────
ALTER TABLE public.headcount_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS headcount_requests_auth_all ON public.headcount_requests;
CREATE POLICY headcount_requests_auth_all
  ON public.headcount_requests
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.headcount_requests TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.headcount_requests_id_seq TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
