-- ════════════════════════════════════════════════════════════════════════════
-- 修正：核銷簽核「按了不推進下一關」— expense_settle_step_advance 漏傳申請人 id
--
-- Bug：核銷推進時判斷簽核人權限的這行
--     SELECT _employee_matches_chain_step(v_emp.id, v_step.id) INTO v_matches;
--   只傳 2 個參數，漏了第 3 個 p_applicant_emp_id（申請人 id）。
--   _employee_matches_chain_step 對動態 target_type（applicant_dept_manager /
--   applicant_store_supervisor）要用申請人 id 才解得出該關簽核人。
--
-- 後果：核銷下一關若是「申請人的部門主管 / 店督導」這種動態簽核人，因沒帶申請人 id
--   → 該簽核人被判定不符 → 回 NOT_AUTHORIZED → 按了不推進（通知系統是另一套、會正常
--   通知到人，所以「收得到通知、按得下去、但卡住」）。申請鏈那邊本來就有正確傳 3 個參數。
--
-- 修法：把申請人 id（v_req.employee_id）補進去，與申請鏈一致。
-- 本檔以 db:drift 的 live 定義為基準，只改該行，其餘邏輯原樣保留（避免整支重寫漏 case）。
-- ════════════════════════════════════════════════════════════════════════════

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

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps
   WHERE chain_id = v_req.settle_chain_id;

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
END $function$;

NOTIFY pgrst, 'reload schema';
