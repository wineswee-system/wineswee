-- ============================================================
-- expense_requests 真實多關簽核：加 current_step + RPC step-by-step 推進
--
-- 之前 MVP：finance 點核准 → 直接 status='已核准'，不走 chain
-- 現在：每個 chain step 對應的 approver 簽完才推進，最後一關通過才標 '已核准'
-- ============================================================

BEGIN;

-- 1. 加 current_step 欄位（0-indexed，代表「目前停在第幾關等簽」）
ALTER TABLE public.expense_requests
  ADD COLUMN IF NOT EXISTS current_step INT NOT NULL DEFAULT 0;

-- 2. 既有資料 backfill：已核准/待核銷/已核銷 → current_step = chain 長度（全部完成）
UPDATE public.expense_requests er
   SET current_step = COALESCE((
     SELECT COUNT(*) FROM approval_chain_steps WHERE chain_id = er.approval_chain_id
   ), 0)
 WHERE er.status IN ('已核准','待核銷','已核銷')
   AND er.current_step = 0
   AND er.approval_chain_id IS NOT NULL;

-- 3. RPC：走 chain 一步
-- 由 web (auth.uid) 或 LIFF (auth.uid via session) 呼叫
-- 驗證 caller 對應目前這一關的 chain step (target_emp_id / role / dept)
-- 通過 → current_step++；最後一關 → status='已核准'
-- 退回 → status='已駁回'，current_step 保持原值（讓 timeline 畫出在哪關被退）
CREATE OR REPLACE FUNCTION public.expense_request_step_advance(
  p_id     INT,
  p_action TEXT,         -- 'approve' | 'reject'
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
  v_new_status   text;
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

  -- 沒綁 chain → 退回到舊行為（直接 approve / reject）
  IF v_req.approval_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      UPDATE expense_requests SET
        status = '已核准',
        approved_by = v_emp.name,
        approved_at = NOW()
      WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'fully_approved', true);
    ELSE
      UPDATE expense_requests SET
        status = '已駁回',
        reject_reason = p_reason,
        approved_by = v_emp.name,
        approved_at = NOW()
      WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回');
    END IF;
  END IF;

  -- 抓目前這一關
  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_req.approval_chain_id AND step_order = v_req.current_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND', 'current_step', v_req.current_step);
  END IF;

  -- 驗證 caller 是否對應這一關
  SELECT _employee_matches_chain_step(v_emp.id, v_step.id) INTO v_matches;
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
      status = '已駁回',
      reject_reason = p_reason,
      approved_by = v_emp.name,
      approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'rejected_at_step', v_req.current_step);
  END IF;

  -- approve
  IF v_req.current_step + 1 >= v_total_steps THEN
    -- 最後一關 → 全鏈通過
    UPDATE expense_requests SET
      status = '已核准',
      current_step = v_total_steps,
      approved_by = v_emp.name,
      approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'fully_approved', true,
                             'advanced_to_step', v_total_steps);
  ELSE
    -- 推進到下一關
    UPDATE expense_requests SET
      current_step = current_step + 1
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '簽核中', 'fully_approved', false,
                             'advanced_to_step', v_req.current_step + 1);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.expense_request_step_advance(INT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
