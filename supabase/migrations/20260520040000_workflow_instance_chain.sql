-- ════════════════════════════════════════════════════════════════════════════
-- workflow_instances 整體完成後簽核鏈
-- ────────────────────────────────────────────────────────────────────────────
-- 場景：流程所有任務完成後，需要一個簽核鏈（主管確認、老闆最終核准）
--   才能把 instance.status 設為「已完成」。
--
-- 架構與 form_submission_chain_approve 相同：
--   - completion_chain_id → 指定哪條 approval_chains
--   - chain_current_step  → 目前走到第幾關（0-indexed）
--   - chain_status        → '未啟動'|'簽核中'|'已核准'|'已駁回'
--   - applicant_emp_id    → 啟動流程的員工（for applicant_xxx target_type 動態解析）
--
-- RPC:
--   workflow_instance_start_chain(p_instance_id)
--     → 所有任務完成後呼叫，啟動簽核鏈
--   workflow_instance_chain_approve(p_instance_id, p_approver_id, p_action, p_reason)
--     → 每關簽核人呼叫，同 form_submission_chain_approve 邏輯
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. ALTER schema ──────────────────────────────────────────────────────
ALTER TABLE public.workflow_instances
  ADD COLUMN IF NOT EXISTS completion_chain_id  INT
    REFERENCES public.approval_chains(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chain_current_step   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chain_status         TEXT NOT NULL DEFAULT '未啟動',
  ADD COLUMN IF NOT EXISTS applicant_emp_id     INT
    REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.workflow_instances
  DROP CONSTRAINT IF EXISTS chk_workflow_chain_status;

ALTER TABLE public.workflow_instances
  ADD CONSTRAINT chk_workflow_chain_status
    CHECK (chain_status IN ('未啟動','簽核中','已核准','已駁回'));


-- ─── 2. workflow_instance_start_chain ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.workflow_instance_start_chain(
  p_instance_id INT
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inst  workflow_instances;
  v_step  approval_chain_steps;
BEGIN
  SELECT * INTO v_inst FROM workflow_instances WHERE id = p_instance_id;
  IF v_inst.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_inst.completion_chain_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_CHAIN');
  END IF;
  IF v_inst.chain_status <> '未啟動' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_STARTED',
      'chain_status', v_inst.chain_status);
  END IF;

  UPDATE workflow_instances
     SET chain_status       = '簽核中',
         chain_current_step = 0
   WHERE id = p_instance_id;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_inst.completion_chain_id AND step_order = 0;

  RETURN json_build_object(
    'ok',               true,
    'event',            'chain_started',
    'first_step_label', v_step.label,
    'first_step_role',  v_step.role_name
  );
END $$;

GRANT EXECUTE ON FUNCTION public.workflow_instance_start_chain(INT)
  TO authenticated, anon;


-- ─── 3. workflow_instance_chain_approve ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.workflow_instance_chain_approve(
  p_instance_id  INT,
  p_approver_id  INT,
  p_action       TEXT,           -- 'approve' / 'reject'
  p_reason       TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inst        workflow_instances;
  v_step        approval_chain_steps;
  v_total_steps INT;
  v_is_last     BOOLEAN;
  v_next_step   approval_chain_steps;
BEGIN
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_inst FROM workflow_instances WHERE id = p_instance_id;
  IF v_inst.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_inst.chain_status <> '簽核中' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_IN_CHAIN',
      'chain_status', v_inst.chain_status);
  END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id      = v_inst.completion_chain_id
     AND step_order    = v_inst.chain_current_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
  END IF;

  -- 簽核人必須是當前 step 合法對象
  IF NOT public._employee_matches_chain_step(
       p_approver_id, v_step.id, v_inst.applicant_emp_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps
   WHERE chain_id = v_inst.completion_chain_id;

  v_is_last := (v_inst.chain_current_step + 1 >= v_total_steps);

  IF p_action = 'reject' THEN
    UPDATE workflow_instances
       SET chain_status = '已駁回', status = '已退回'
     WHERE id = p_instance_id;
    RETURN json_build_object(
      'ok', true, 'status', '已退回', 'event', 'rejected',
      'rejected_at_step', v_inst.chain_current_step
    );
  END IF;

  -- approve
  IF v_is_last THEN
    UPDATE workflow_instances
       SET chain_status = '已核准',
           status       = '已完成',
           completed_at = NOW()
     WHERE id = p_instance_id;
    RETURN json_build_object(
      'ok', true, 'status', '已完成', 'event', 'approved', 'is_last_step', true
    );
  ELSE
    UPDATE workflow_instances
       SET chain_current_step = chain_current_step + 1
     WHERE id = p_instance_id;

    SELECT * INTO v_next_step FROM approval_chain_steps
     WHERE chain_id   = v_inst.completion_chain_id
       AND step_order = v_inst.chain_current_step + 1;

    RETURN json_build_object(
      'ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', v_inst.chain_current_step + 1,
      'is_last_step', false,
      'next_step_label', v_next_step.label
    );
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.workflow_instance_chain_approve(INT, INT, TEXT, TEXT)
  TO authenticated, anon;


COMMIT;

NOTIFY pgrst, 'reload schema';
