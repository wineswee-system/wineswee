-- 經常性費用(expenses/報帳)逐關推進 RPC — 2026-07-09
-- 背景:報帳是多關簽核鏈(approval_chain_id + current_step),但前端原本只有「直接 update 已核銷」
--   會跳過中間關(含最後的財務會簽)。做一支跟 expense_request_step_advance 同款的 step-advance,
--   驗證 caller 是當前關簽核人才推進;最後一關才標「已核銷」,中途只推進 current_step。
--   SECURITY DEFINER → 繞 RLS(簽核人可 UPDATE),與非費簽核一致。給儀表板 inline/批次通過用。
-- expenses 狀態:待審核(pending)→ 已核銷(final)/已駁回(reject);名字欄=approver(無 approved_at)。idempotent。

CREATE OR REPLACE FUNCTION public.expense_step_advance(p_id integer, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_emp   employees;
  v_exp   expenses;
  v_step  approval_chain_steps;
  v_total INT;
  v_matches boolean;
  v_extra approval_extra_steps;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF p_action NOT IN ('approve','reject') THEN RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION'); END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_exp FROM expenses WHERE id = p_id;
  IF v_exp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_exp.status <> '待審核' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING', 'current_status', v_exp.status);
  END IF;

  -- 加簽 guard
  v_extra := public.get_pending_extra_step('expenses', p_id, COALESCE(v_exp.current_step, 0));
  IF v_extra.id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'PENDING_EXTRA_SIGNER',
      'extra_step_id', v_extra.id, 'extra_assignee_id', v_extra.assignee_id,
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核');
  END IF;

  -- 沒綁 chain → 舊行為(直接核銷/駁回)
  IF v_exp.approval_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      UPDATE expenses SET status = '已核銷', approver = v_emp.name WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已核銷', 'fully_approved', true);
    ELSE
      UPDATE expenses SET status = '已駁回', reject_reason = p_reason, approver = v_emp.name WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回');
    END IF;
  END IF;

  -- live chain：驗證當前關簽核人
  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_exp.approval_chain_id AND step_order = v_exp.current_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND', 'current_step', v_exp.current_step);
  END IF;
  SELECT public._employee_matches_chain_step(v_emp.id, v_step.id, v_exp.employee_id) INTO v_matches;
  SELECT COUNT(*) INTO v_total FROM approval_chain_steps WHERE chain_id = v_exp.approval_chain_id;

  IF NOT v_matches THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED_FOR_STEP', 'current_step', v_exp.current_step);
  END IF;

  IF p_action = 'reject' THEN
    UPDATE expenses SET status = '已駁回', reject_reason = p_reason, approver = v_emp.name WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'rejected_at_step', v_exp.current_step);
  END IF;

  -- approve：最後一關 → 已核銷；其他 → 推進 current_step
  IF v_exp.current_step + 1 >= v_total THEN
    UPDATE expenses SET status = '已核銷', current_step = v_total, approver = v_emp.name WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核銷', 'fully_approved', true, 'advanced_to_step', v_total);
  ELSE
    UPDATE expenses SET current_step = current_step + 1, approver = v_emp.name WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '簽核中', 'fully_approved', false, 'advanced_to_step', v_exp.current_step + 1);
  END IF;
END $function$;

GRANT EXECUTE ON FUNCTION public.expense_step_advance(integer, text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
