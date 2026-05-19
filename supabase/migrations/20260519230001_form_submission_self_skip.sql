-- ════════════════════════════════════════════════════════════════════════════
-- form_submission_chain_approve：approve 後 self-skip loop
-- ────────────────────────────────────────────────────────────────────────────
-- 配合 20260519230000：當下一關 resolve 只解出申請人自己（典型情境：申請人本人
-- 就是 section 督導），自動 current_step++ 跳過，直到非自簽或最後一關。
--
-- 沒解到任何人 ＝ 跟 self-only 同樣處理（也跳過），避免「沒人可簽」卡死。
-- 但保留 fixed_emp 解出空（員工已離職）的 case：fixed_emp 失敗該人工排查不是自動跳。
-- 規則：只有 target_type 屬於 applicant_* 系列 且 resolve 結果 ⊆ {applicant.id} 才跳過。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.form_submission_chain_approve(
  p_id          INT,
  p_approver_id INT,
  p_action      TEXT,
  p_reason      TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sub             form_submissions;
  v_template        form_templates;
  v_chain_id        INT;
  v_step            approval_chain_steps;
  v_total_steps     INT;
  v_is_last         BOOLEAN;
  v_next_step       approval_chain_steps;
  v_new_current     INT;
  v_skip_count      INT := 0;
  v_max_skip        INT := 20;  -- 防呆 cap
  v_next_step_id    INT;
  v_next_target     TEXT;
  v_skipped_steps   INT[] := ARRAY[]::INT[];
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

  -- reject 直接結案
  IF p_action = 'reject' THEN
    UPDATE form_submissions
       SET status = '已駁回', reject_reason = btrim(p_reason),
           approver_id = p_approver_id, approved_at = NOW()
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected',
      'rejected_at_step', v_sub.current_step);
  END IF;

  -- approve：先 +1，然後 self-skip loop
  v_new_current := COALESCE(v_sub.current_step, 0) + 1;

  WHILE v_new_current < v_total_steps AND v_skip_count < v_max_skip LOOP
    SELECT id, target_type INTO v_next_step_id, v_next_target
      FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = v_new_current;

    -- 只對 applicant_* 系列做 self-skip（fixed_emp 解空代表人離職，需人工排查）
    EXIT WHEN v_next_target NOT LIKE 'applicant_%';

    -- 下一關 resolve 結果是否只剩申請人自己（或空）？
    IF NOT EXISTS (
      SELECT 1 FROM public.resolve_chain_step_approvers(v_next_step_id, v_sub.applicant_id)
       WHERE emp_id IS NOT NULL AND emp_id <> v_sub.applicant_id
    ) THEN
      v_skipped_steps := v_skipped_steps || v_new_current;
      v_new_current := v_new_current + 1;
      v_skip_count := v_skip_count + 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;

  v_is_last := (v_new_current >= v_total_steps);

  IF v_is_last THEN
    UPDATE form_submissions
       SET status = '已核准', approver_id = p_approver_id, approved_at = NOW(),
           current_step = v_total_steps - 1
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved',
      'is_last_step', true, 'skipped_steps', v_skipped_steps);
  ELSE
    UPDATE form_submissions SET current_step = v_new_current WHERE id = p_id;
    SELECT * INTO v_next_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = v_new_current;
    RETURN json_build_object('ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', v_new_current, 'is_last_step', false,
      'next_step_label', v_next_step.label,
      'skipped_steps', v_skipped_steps);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.form_submission_chain_approve(INT, INT, TEXT, TEXT)
  TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
