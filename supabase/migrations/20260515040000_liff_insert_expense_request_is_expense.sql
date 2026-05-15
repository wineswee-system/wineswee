-- ════════════════════════════════════════════════════════════
-- liff_insert_expense_request 加 is_expense 支援
-- 2026-05-15
--
-- 問題：主系統 ExpenseRequests 已支援 is_expense（20260514170000）
--       LIFF UI 已有費用/非費用 toggle，但 RPC 不認 is_expense
--       → 非費用單仍走「費用申請」chain 用 estimated_amount=0 找鏈失敗
--
-- 修法（OR REPLACE 整個 function，保留原有所有邏輯，只加 is_expense 分支）：
--   - payload 多讀 is_expense（預設 true 保持向下相容）
--   - is_expense=false → 找 category='非費用申請' chain（不看金額）
--   - is_expense=true  → 原邏輯（依金額找 category='費用申請' chain）
--   - INSERT 多塞 is_expense 欄位；金額/科目/品項/門市/供應商 非費用 → null
--
-- 不動：_liff_resolve_employee / _resolve_single_approver / _is_store_manager
--       這些 helper 維持不變
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_insert_expense_request(p_line_user_id text, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp                 employees;
  v_is_expense        boolean;
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

  -- 預設 true（向下相容，沒傳 is_expense 的舊版 LIFF 還是走費用申請）
  v_is_expense := COALESCE((p_payload->>'is_expense')::boolean, true);

  IF v_is_expense THEN
    -- ── 費用申請：依金額找 category='費用申請' chain（原邏輯）──
    v_amount := COALESCE((p_payload->>'estimated_amount')::numeric, 0);

    SELECT id INTO v_chain_id
      FROM public.approval_chains
     WHERE category = '費用申請'
       AND organization_id = emp.organization_id
       AND COALESCE(is_active, true) = true
       AND v_amount >= COALESCE(min_amount, 0)
       AND (max_amount IS NULL OR v_amount <= max_amount)
     ORDER BY COALESCE(min_amount, 0) DESC
     LIMIT 1;
  ELSE
    -- ── 非費用：找 category='非費用申請' active chain（不看金額）──
    v_amount := NULL;

    SELECT id INTO v_chain_id
      FROM public.approval_chains
     WHERE category = '非費用申請'
       AND organization_id = emp.organization_id
       AND COALESCE(is_active, true) = true
     ORDER BY id DESC
     LIMIT 1;
  END IF;

  IF v_chain_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_chain_step_count
      FROM public.approval_chain_steps WHERE chain_id = v_chain_id;
    IF v_chain_step_count = 0 THEN v_chain_id := NULL; END IF;
  END IF;

  v_supervisor_id := public._resolve_single_approver(emp.id);
  v_is_owner := (v_supervisor_id IS NULL AND NOT public._is_store_manager(emp.id));

  IF v_is_owner THEN v_status := '已核准'; END IF;

  IF NOT v_is_owner AND v_chain_id IS NULL THEN
    IF v_is_expense THEN
      RAISE EXCEPTION '尚未設定符合金額 NT$% 的「費用申請」簽核鏈，請聯絡管理員', v_amount
        USING ERRCODE = 'P0001',
              HINT = '請到「組織 > 簽核設定」新增 category=費用申請 的 approval_chain';
    ELSE
      RAISE EXCEPTION '尚未設定「非費用申請」簽核鏈，請聯絡管理員'
        USING ERRCODE = 'P0001',
              HINT = '請到「組織 > 簽核設定」新增 category=非費用申請 的 approval_chain';
    END IF;
  END IF;

  INSERT INTO public.expense_requests (
    employee, employee_id, department,
    is_expense,
    account_code, account_name,
    title, description, estimated_amount,
    supplier,
    items,
    store, status, organization_id,
    approval_chain_id, current_step
  )
  VALUES (
    emp.name, emp.id, emp.dept,
    v_is_expense,
    CASE WHEN v_is_expense THEN p_payload->>'account_code' ELSE NULL END,
    CASE WHEN v_is_expense THEN p_payload->>'account_name' ELSE NULL END,
    p_payload->>'title',
    p_payload->>'description',
    v_amount,                                            -- 非費用為 NULL
    CASE WHEN v_is_expense THEN p_payload->>'supplier' ELSE NULL END,
    CASE WHEN v_is_expense
         THEN COALESCE((p_payload->'items')::jsonb, '[]'::jsonb)
         ELSE '[]'::jsonb
    END,
    CASE WHEN v_is_expense THEN COALESCE(p_payload->>'store', emp.store) ELSE NULL END,
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
    'auto_approved', v_is_owner,
    'is_expense', v_is_expense
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_expense_request(text, json) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════
-- 緊急 rollback（如需回到上一版）：
--   參考 20260508191000_fix_liff_insert_items_cast.sql 的 RPC 簽名
-- ════════════════════════════════════════════════════════════
