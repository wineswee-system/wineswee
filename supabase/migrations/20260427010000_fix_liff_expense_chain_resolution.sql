-- ════════════════════════════════════════════════════════════
-- Fix: LIFF 提交「申請（事項/採購/預算）」時沒有解析 approval_chain
-- ────────────────────────────────────────────────────────────
-- 症狀：
--   1. liff_insert_expense_request 只 insert 不設 approval_chain_id
--   2. liff_resolve_chain_first_approvers 看到 chain_id IS NULL 直接回 []
--   3. notifyNewSubmission 拿到空 approver list → LINE 不會推播
--   4. liff_list_pending_approvals 也篩掉 chain_id IS NULL 的單 → 主管收件匣永遠看不到
--
-- 修法：
--   - liff_insert_expense_request 加入 chain 解析（依 category='費用申請' + amount + org）
--   - 申請人是組織頂端（無人可簽）→ 自動核准
--   - 找不到 chain → RAISE 提示要先設定 chain（避免單據沉默被卡住）
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_insert_expense_request(p_line_user_id text, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp                 employees;
  v_amount            numeric;
  v_chain_id          int;
  v_chain_step_count  int := 0;
  v_supervisor_id     int;
  v_is_owner          boolean := false;
  v_status            text := '申請中';
  new_id              int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RAISE EXCEPTION 'employee not found' USING ERRCODE = 'P0002';
  END IF;

  v_amount := COALESCE((p_payload->>'estimated_amount')::numeric, 0);

  -- 1. 找符合金額的 approval_chain（組織內、有效、金額落在區間）
  --    多個符合時取 min_amount 最大的（最精確的區間）
  SELECT id INTO v_chain_id
    FROM public.approval_chains
   WHERE category = '費用申請'
     AND organization_id = emp.organization_id
     AND COALESCE(is_active, true) = true
     AND v_amount >= COALESCE(min_amount, 0)
     AND (max_amount IS NULL OR v_amount <= max_amount)
   ORDER BY COALESCE(min_amount, 0) DESC
   LIMIT 1;

  -- chain 存在但沒有步驟 → 視同沒鏈
  IF v_chain_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_chain_step_count
      FROM public.approval_chain_steps
     WHERE chain_id = v_chain_id;
    IF v_chain_step_count = 0 THEN
      v_chain_id := NULL;
    END IF;
  END IF;

  -- 2. 申請人是組織頂端（無人可簽）→ 自動核准
  v_supervisor_id := public._resolve_single_approver(emp.id);
  v_is_owner := (v_supervisor_id IS NULL AND NOT public._is_store_manager(emp.id));

  IF v_is_owner THEN
    v_status := '已核准';
  END IF;

  -- 3. 不是 owner、又找不到 chain → 沉默卡單比直接擋更糟，回明確錯誤
  IF NOT v_is_owner AND v_chain_id IS NULL THEN
    RAISE EXCEPTION '尚未設定符合金額 NT$% 的「費用申請」簽核鏈，請聯絡管理員', v_amount
      USING ERRCODE = 'P0001', HINT = '請到「組織 > 簽核設定」新增 category=費用申請 的 approval_chain';
  END IF;

  -- 4. 寫入（current_step 從 0 開始，對齊 approval_chain_steps.step_order）
  INSERT INTO public.expense_requests (
    employee, employee_id, department,
    account_code, account_name,
    title, description, estimated_amount,
    store, status, organization_id,
    approval_chain_id, current_step
  )
  VALUES (
    emp.name, emp.id, emp.dept,
    p_payload->>'account_code',
    p_payload->>'account_name',
    p_payload->>'title',
    p_payload->>'description',
    v_amount,
    COALESCE(p_payload->>'store', emp.store),
    v_status,
    emp.organization_id,
    v_chain_id,
    0
  )
  RETURNING id INTO new_id;

  RETURN json_build_object(
    'id', new_id,
    'status', v_status,
    'approval_chain_id', v_chain_id,
    'auto_approved', v_is_owner
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_expense_request(text, json) TO anon, authenticated;

COMMENT ON FUNCTION public.liff_insert_expense_request(text, json) IS
  'LIFF 申請（事項/採購/預算）建立 RPC。會自動依 category=費用申請 + 金額 + organization_id 解析 approval_chain，並設定 current_step=0。申請人是組織頂端時自動核准；找不到符合金額的鏈會 RAISE EXCEPTION 提示管理員去設定鏈。';

COMMIT;
