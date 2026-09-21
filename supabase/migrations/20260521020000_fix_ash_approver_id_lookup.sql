-- ════════════════════════════════════════════════════════════════════════════
-- 修 ash approver_id 兩個根因
-- ────────────────────────────────────────────────────────────────────────────
-- 問題 1：expense_request_step_advance 中間關只 SET current_step+1，
--   不更新 approved_by → trigger v_approver=NULL → ash 中間關 approver 全空
--
-- 問題 2：_trg_ash_record_chain_step 用 name + org_id 反查 employees.id，
--   若 org_id 不符則查不到 → approver_id 留 NULL（name 有值但 id 無）
--
-- 修法：
--   1. expense_request_step_advance 中間關 UPDATE 加 approved_by = v_emp.name
--   2. ash trigger 加 fallback：第一次查失敗時，去掉 org_id 再查一次
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 修 expense_request_step_advance 中間關 ────────────────────────────
-- 完整版（對齊 20260517140000_extra_signer_p2_expense_request.sql，只改第 506 行）
CREATE OR REPLACE FUNCTION public.expense_request_step_advance(
  p_id     INT,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_emp          employees;
  v_req          expense_requests;
  v_total_steps  INT;
  v_step         approval_chain_steps;
  v_matches      boolean;
  v_extra        approval_extra_steps;
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
  IF v_req.status NOT IN ('申請中', '待審') THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING', 'current_status', v_req.status);
  END IF;

  -- 加簽 guard：當前 step 若有 pending 加簽，禁止推進
  v_extra := public.get_pending_extra_step('expense_requests', p_id, COALESCE(v_req.current_step, 0));
  IF v_extra.id IS NOT NULL THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'PENDING_EXTRA_SIGNER',
      'extra_step_id', v_extra.id,
      'extra_assignee_id', v_extra.assignee_id,
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
    );
  END IF;

  -- 沒綁 chain → 舊行為
  IF v_req.approval_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      UPDATE expense_requests SET
        status = '已核准', approved_by = v_emp.name, approved_at = NOW()
      WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'fully_approved', true);
    ELSE
      UPDATE expense_requests SET
        status = '已駁回', reject_reason = p_reason,
        approved_by = v_emp.name, approved_at = NOW()
      WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回');
    END IF;
  END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_req.approval_chain_id AND step_order = v_req.current_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND', 'current_step', v_req.current_step);
  END IF;

  SELECT _employee_matches_chain_step(v_emp.id, v_step.id, v_req.employee_id) INTO v_matches;
  IF NOT v_matches THEN
    RETURN json_build_object(
      'ok', false, 'error', 'NOT_AUTHORIZED_FOR_STEP',
      'current_step', v_req.current_step, 'expected_role', v_step.role_name
    );
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps
   WHERE chain_id = v_req.approval_chain_id;

  IF p_action = 'reject' THEN
    UPDATE expense_requests SET
      status = '已駁回', reject_reason = p_reason,
      approved_by = v_emp.name, approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'rejected_at_step', v_req.current_step);
  END IF;

  IF v_req.current_step + 1 >= v_total_steps THEN
    UPDATE expense_requests SET
      status = '已核准', current_step = v_total_steps,
      approved_by = v_emp.name, approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'fully_approved', true,
                             'advanced_to_step', v_total_steps);
  ELSE
    -- ★ 中間關也記 approved_by，讓 ash trigger 能抓到簽核人 ID
    UPDATE expense_requests SET
      current_step = current_step + 1,
      approved_by = v_emp.name
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '簽核中', 'fully_approved', false,
                             'advanced_to_step', v_req.current_step + 1);
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION public.expense_request_step_advance(INT, TEXT, TEXT) TO authenticated;


-- ─── 2. 修 ash trigger：name 查不到時去掉 org_id 再查一次 ─────────────────
-- 完整版（對齊 20260519220001_phase2_ash_trigger.sql，只在 name lookup 後加 fallback）
CREATE OR REPLACE FUNCTION public._trg_ash_record_chain_step()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rt          text;
  v_new_json    jsonb;
  v_old_json    jsonb;
  v_step_label  text;
  v_target_type text;
  v_approver    text;
  v_approver_id int;
  v_action      text;
  v_chain_id    int;
BEGIN
  v_rt := CASE TG_TABLE_NAME
    WHEN 'leave_requests'                  THEN 'leave'
    WHEN 'overtime_requests'               THEN 'overtime'
    WHEN 'business_trips'                  THEN 'trip'
    WHEN 'clock_corrections'               THEN 'correction'
    WHEN 'expenses'                        THEN 'expense'
    WHEN 'expense_requests'                THEN 'expense_request'
    WHEN 'resignation_requests'            THEN 'resignation'
    WHEN 'leave_of_absence_requests'       THEN 'loa'
    WHEN 'personnel_transfer_requests'     THEN 'transfer'
    WHEN 'headcount_requests'              THEN 'headcount'
    WHEN 'form_submissions'                THEN 'form_submission'
    ELSE NULL
  END;
  IF v_rt IS NULL THEN RETURN NEW; END IF;

  v_new_json := to_jsonb(NEW);

  IF v_rt = 'form_submission' THEN
    SELECT approval_chain_id INTO v_chain_id
      FROM form_templates WHERE id = (v_new_json->>'template_id')::int;
  ELSE
    v_chain_id := NULLIF(v_new_json->>'approval_chain_id', '')::int;
  END IF;

  -- INSERT：起手寫第一筆 entered
  IF TG_OP = 'INSERT' AND v_chain_id IS NOT NULL THEN
    SELECT label, target_type INTO v_step_label, v_target_type
      FROM approval_chain_steps
     WHERE chain_id = v_chain_id
       AND step_order = COALESCE((v_new_json->>'current_step')::int, 0)
     LIMIT 1;

    INSERT INTO approval_step_history (
      request_type, request_id, organization_id, chain_id,
      step_order, step_label, target_type, entered_at, action
    ) VALUES (
      v_rt,
      (v_new_json->>'id')::int,
      NULLIF(v_new_json->>'organization_id','')::int,
      v_chain_id,
      COALESCE((v_new_json->>'current_step')::int, 0),
      v_step_label, v_target_type,
      now(), 'submitted'
    );
    RETURN NEW;
  END IF;

  v_approver := COALESCE(v_new_json->>'approver', v_new_json->>'approved_by');

  -- 用 name + org_id 反查 emp_id
  IF v_approver IS NOT NULL AND v_approver NOT LIKE '%系統%' AND v_approver NOT LIKE '%自動%' THEN
    SELECT id INTO v_approver_id FROM employees
     WHERE name = v_approver
       AND (NULLIF(v_new_json->>'organization_id','')::int IS NULL
            OR organization_id = (v_new_json->>'organization_id')::int)
     LIMIT 1;

    -- ★ fallback：org_id 不符時去掉篩選再查一次
    IF v_approver_id IS NULL THEN
      SELECT id INTO v_approver_id FROM employees
       WHERE name = v_approver
       LIMIT 1;
    END IF;
  END IF;

  -- form_submissions 沒「approver」字串只有 approver_id；直接用整數欄
  IF v_rt = 'form_submission' AND v_approver_id IS NULL THEN
    v_approver_id := NULLIF(v_new_json->>'approver_id', '')::int;
    IF v_approver_id IS NOT NULL THEN
      SELECT name INTO v_approver FROM employees WHERE id = v_approver_id;
    END IF;
  END IF;

  v_old_json := to_jsonb(OLD);

  -- UPDATE OF current_step：上一關 exit + 新關 entered
  IF TG_OP = 'UPDATE'
     AND (v_new_json->>'current_step') IS DISTINCT FROM (v_old_json->>'current_step')
     AND v_chain_id IS NOT NULL THEN
    UPDATE approval_step_history
       SET exited_at = now(),
           action = CASE
             WHEN (v_new_json->>'status') IN ('已退回','已駁回') THEN 'rejected'
             ELSE 'approved'
           END,
           approver_name = COALESCE(v_approver, approver_name),
           approver_id   = COALESCE(v_approver_id, approver_id)
     WHERE request_type = v_rt
       AND request_id = (v_new_json->>'id')::int
       AND step_order = COALESCE((v_old_json->>'current_step')::int, 0)
       AND exited_at IS NULL;

    SELECT label, target_type INTO v_step_label, v_target_type
      FROM approval_chain_steps
     WHERE chain_id = v_chain_id
       AND step_order = (v_new_json->>'current_step')::int
     LIMIT 1;

    IF v_step_label IS NOT NULL THEN
      INSERT INTO approval_step_history (
        request_type, request_id, organization_id, chain_id,
        step_order, step_label, target_type, entered_at, action
      ) VALUES (
        v_rt,
        (v_new_json->>'id')::int,
        NULLIF(v_new_json->>'organization_id','')::int,
        v_chain_id,
        (v_new_json->>'current_step')::int,
        v_step_label, v_target_type,
        now(), 'pending'
      );
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE OF status：終態關 exit
  IF TG_OP = 'UPDATE'
     AND (v_new_json->>'status') IS DISTINCT FROM (v_old_json->>'status')
     AND (v_new_json->>'status') IN ('已核准','已核銷','已退回','已駁回','已拒絕') THEN
    v_action := CASE (v_new_json->>'status')
      WHEN '已核准' THEN 'approved'
      WHEN '已核銷' THEN 'approved'
      WHEN '已退回' THEN 'rejected'
      WHEN '已駁回' THEN 'rejected'
      WHEN '已拒絕' THEN 'rejected'
    END;
    UPDATE approval_step_history
       SET exited_at = now(),
           action = v_action,
           approver_name = COALESCE(v_approver, approver_name),
           approver_id   = COALESCE(v_approver_id, approver_id)
     WHERE request_type = v_rt
       AND request_id = (v_new_json->>'id')::int
       AND exited_at IS NULL;
  END IF;

  RETURN NEW;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
