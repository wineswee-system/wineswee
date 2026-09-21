-- ════════════════════════════════════════════════════════════════════════════
-- form_submissions 走真實 chain advance（取代「單關 admin 一鍵核准」設計）
-- ────────────────────────────────────────────────────────────────────────────
-- 之前 form_submissions 是 admin 一鍵核准/駁回，跟 chain steps 完全脫鉤
-- (chain UI 只是裝飾)。改成跟 hr_chain_approve (resignation/loa/transfer) 同
-- pattern：每關不同簽核人推進 current_step，最後一關才 status='已核准'。
--
-- 1. ALTER form_submissions ADD current_step INT DEFAULT 0
-- 2. RPC form_submission_chain_approve(p_id, p_approver_id, p_action, p_reason)
--    - 沒設 chain (template.approval_chain_id IS NULL) → admin 一鍵核准 (legacy)
--    - 設了 chain → 走 chain advance：
--      * check 簽核人是當前 step 合法對象 (_employee_matches_chain_step)
--      * approve → current_step++ 或 最後關 status='已核准'
--      * reject → status='已駁回'
--      * 加簽 guard：當前 step 有 pending 加簽時禁止推進
--
-- 不接 ash trigger / 待簽清單 / 加簽（之後再做）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. ALTER schema ──────────────────────────────────────────────────────
ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS current_step INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_form_subs_chain_step
  ON public.form_submissions(template_id, current_step) WHERE status = '申請中';


-- ─── 2. form_submission_chain_approve RPC ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.form_submission_chain_approve(
  p_id          INT,
  p_approver_id INT,
  p_action      TEXT,            -- 'approve' / 'reject'
  p_reason      TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sub         form_submissions;
  v_template    form_templates;
  v_chain_id    INT;
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

  SELECT * INTO v_sub FROM form_submissions WHERE id = p_id;
  IF v_sub.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_sub.status <> '申請中' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  SELECT * INTO v_template FROM form_templates WHERE id = v_sub.template_id;
  v_chain_id := v_template.approval_chain_id;

  -- 沒 chain → admin 一鍵核准 (legacy fallback)
  IF v_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      UPDATE form_submissions
         SET status = '已核准', approver_id = p_approver_id, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved_no_chain');
    ELSE
      UPDATE form_submissions
         SET status = '已駁回', approver_id = p_approver_id, approved_at = NOW(),
             reject_reason = btrim(p_reason)
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected_no_chain');
    END IF;
  END IF;

  -- 有 chain → 走 chain advance
  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = COALESCE(v_sub.current_step, 0);
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
  END IF;

  -- 簽核人必須是當前 step 合法對象
  IF NOT public._employee_matches_chain_step(p_approver_id, v_step.id, v_sub.applicant_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  -- 加簽 guard：當前 step 有 pending 加簽時禁止推進
  IF EXISTS (
    SELECT 1 FROM approval_extra_steps
    WHERE source_table = 'form_submissions'
      AND source_id = p_id
      AND insert_before_step = COALESCE(v_sub.current_step, 0)
      AND status = 'pending'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'PENDING_EXTRA_SIGNER',
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核');
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_chain_id;
  v_is_last := (COALESCE(v_sub.current_step, 0) + 1 >= v_total_steps);

  IF p_action = 'reject' THEN
    UPDATE form_submissions
       SET status = '已駁回', reject_reason = btrim(p_reason),
           approver_id = p_approver_id, approved_at = NOW()
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected',
      'rejected_at_step', v_sub.current_step);
  END IF;

  -- approve
  IF v_is_last THEN
    UPDATE form_submissions
       SET status = '已核准', approver_id = p_approver_id, approved_at = NOW()
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved', 'is_last_step', true);
  ELSE
    UPDATE form_submissions SET current_step = current_step + 1 WHERE id = p_id;
    SELECT * INTO v_next_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = COALESCE(v_sub.current_step, 0) + 1;
    RETURN json_build_object('ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', COALESCE(v_sub.current_step, 0) + 1, 'is_last_step', false,
      'next_step_label', v_next_step.label);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.form_submission_chain_approve(INT, INT, TEXT, TEXT)
  TO authenticated, anon;


-- ─── 3. 加進 _extra_step_allowed_tables（之後加簽 ready）─────────────────
CREATE OR REPLACE FUNCTION public._extra_step_allowed_tables()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'leave_requests','overtime_requests','business_trips','clock_corrections','expenses',
    'resignation_requests','personnel_transfer_requests','leave_of_absence_requests',
    'headcount_requests',
    'expense_requests',
    'tasks',
    'form_submissions'
  ]::text[];
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
