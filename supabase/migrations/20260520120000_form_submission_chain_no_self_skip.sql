-- ════════════════════════════════════════════════════════════════════════════
-- form_submission_chain_approve：移除 self-skip while loop
-- 2026-05-20
--
-- 20260520020000 已將函式改成 5-param（加 p_reject_attachments），
-- 但同時保留了 self-skip loop。
-- 本 migration：DROP 兩個 overload，重建單一 5-param 版本，不含 self-skip。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.form_submission_chain_approve(INT, INT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.form_submission_chain_approve(INT, INT, TEXT, TEXT, JSONB);

CREATE FUNCTION public.form_submission_chain_approve(
  p_id                 INT,
  p_approver_id        INT,
  p_action             TEXT,
  p_reason             TEXT  DEFAULT NULL,
  p_reject_attachments JSONB DEFAULT '[]'::jsonb
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
  v_new_current INT;
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
         SET status = '已駁回',
             reject_reason = btrim(p_reason),
             reject_attachments = COALESCE(p_reject_attachments, '[]'::jsonb),
             approver_id = p_approver_id, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected_no_chain');
    END IF;
  END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = COALESCE(v_sub.current_step, 0);
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
  END IF;

  IF NOT public._employee_matches_chain_step(p_approver_id, v_step.id, v_sub.applicant_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  -- 加簽 guard
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

  -- reject 結案 + 寫 attachments
  IF p_action = 'reject' THEN
    UPDATE form_submissions
       SET status = '已駁回',
           reject_reason = btrim(p_reason),
           reject_attachments = COALESCE(p_reject_attachments, '[]'::jsonb),
           approver_id = p_approver_id, approved_at = NOW()
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected',
      'rejected_at_step', v_sub.current_step);
  END IF;

  -- approve：直接 +1，不 skip
  v_new_current := COALESCE(v_sub.current_step, 0) + 1;
  v_is_last     := (v_new_current >= v_total_steps);

  IF v_is_last THEN
    UPDATE form_submissions
       SET status = '已核准', approver_id = p_approver_id, approved_at = NOW(),
           current_step = v_total_steps - 1
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved', 'is_last_step', true);
  ELSE
    UPDATE form_submissions SET current_step = v_new_current WHERE id = p_id;
    SELECT * INTO v_next_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = v_new_current;
    RETURN json_build_object(
      'ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', v_new_current, 'is_last_step', false,
      'next_step_label', v_next_step.label
    );
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.form_submission_chain_approve(INT, INT, TEXT, TEXT, JSONB)
  TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
