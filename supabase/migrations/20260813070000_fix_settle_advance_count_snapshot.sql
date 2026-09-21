-- 2026-08-13 修 expense_settle_step_advance:驗收完成判斷改數凍結快照關數,不數 live 鏈(改鏈後在飛舊單#402卡待驗收)。
CREATE OR REPLACE FUNCTION public.expense_settle_step_advance(p_id integer, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_emp           employees;
  v_req           expense_requests;
  v_total_steps   INT;
  v_step          approval_chain_steps;
  v_matches       boolean;
  v_amount        NUMERIC;
  v_pending_extra INT;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = p_id;
  IF v_req.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_req.status <> '待核銷' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING_SETTLE', 'current_status', v_req.status);
  END IF;

  v_amount := COALESCE(v_req.actual_amount, v_req.estimated_amount, 0);

  -- 有 pending 加簽時不允許推進
  SELECT id INTO v_pending_extra
  FROM approval_extra_steps
  WHERE source_table = 'expense_settles'
    AND source_id = p_id
    AND insert_before_step = v_req.settle_current_step
    AND status = 'pending'
  LIMIT 1;
  IF v_pending_extra IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'PENDING_EXTRA_STEP', 'extra_step_id', v_pending_extra);
  END IF;

  -- 沒掛 settle chain → fallback：admin 一鍵 confirm
  IF v_req.settle_chain_id IS NULL THEN
    BEGIN
      PERFORM secure_create_journal_entry(
        CURRENT_DATE,
        '費用申請核銷 - ' || v_req.employee || ' (' || v_req.title || ')',
        json_build_array(
          json_build_object('account_code', v_req.account_code, 'account_name', v_req.account_name, 'debit', v_amount, 'credit', 0, 'memo', '申請單 #' || v_req.id),
          json_build_object('account_code', '1100', 'account_name', '現金', 'debit', 0, 'credit', v_amount, 'memo', '')
        )::jsonb,
        '費用申請', v_req.id, v_emp.name
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    UPDATE expense_requests SET status = '已核銷', settled_by = v_emp.name, settled_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核銷', 'fully_settled', true, 'fallback', true);
  END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_req.settle_chain_id AND step_order = v_req.settle_current_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND', 'current_step', v_req.settle_current_step);
  END IF;

  -- ★ 修正：補上申請人 id（第 3 參數），動態 target（部門主管/店督導）才解得出簽核人
  SELECT _employee_matches_chain_step(v_emp.id, v_step.id, v_req.employee_id) INTO v_matches;
  IF NOT v_matches THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED_FOR_STEP',
                             'current_step', v_req.settle_current_step);
  END IF;

  -- 舊單改鏈防呆:總關數以凍結快照(request_chain_snapshots)為準,不數 live approval_chain_steps
  --   (改鏈後 live 關數變多→在飛舊單簽完自己快照關卻因 live>快照 永遠翻不到已核銷,#402案)
  SELECT COUNT(*) INTO v_total_steps
    FROM public.request_chain_snapshots
   WHERE request_type = 'expense_settle' AND request_id = p_id;
  IF COALESCE(v_total_steps, 0) = 0 THEN
    SELECT COUNT(*) INTO v_total_steps FROM public.approval_chain_steps WHERE chain_id = v_req.settle_chain_id;
  END IF;

  IF p_action = 'reject' THEN
    UPDATE expense_requests SET status = '核銷已退回', settle_reject_reason = p_reason WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '核銷已退回', 'rejected_at_step', v_req.settle_current_step);
  END IF;

  IF v_req.settle_current_step + 1 >= v_total_steps THEN
    BEGIN
      PERFORM secure_create_journal_entry(
        CURRENT_DATE,
        '費用申請核銷 - ' || v_req.employee || ' (' || v_req.title || ')',
        json_build_array(
          json_build_object('account_code', v_req.account_code, 'account_name', v_req.account_name, 'debit', v_amount, 'credit', 0, 'memo', '申請單 #' || v_req.id),
          json_build_object('account_code', '1100', 'account_name', '現金', 'debit', 0, 'credit', v_amount, 'memo', '')
        )::jsonb,
        '費用申請', v_req.id, v_emp.name
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    UPDATE expense_requests SET status = '已核銷', settle_current_step = v_total_steps,
      settled_by = v_emp.name, settled_at = NOW() WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核銷', 'fully_settled', true,
                             'advanced_to_step', v_total_steps);
  ELSE
    UPDATE expense_requests SET settle_current_step = settle_current_step + 1 WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '核銷中', 'fully_settled', false,
                             'advanced_to_step', v_req.settle_current_step + 1);
  END IF;
END $function$
;

UPDATE public.expense_requests SET status='已核銷', settle_current_step=2, settled_at=COALESCE(settled_at,(SELECT MAX(exited_at) FROM public.approval_step_history WHERE request_type='expense_settle' AND request_id=402)) WHERE id=402 AND status='待核銷' AND settle_current_step=2;
