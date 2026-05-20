-- ════════════════════════════════════════════════════════════════════════════
-- expense_requests 加幣別欄位
-- 2026-05-20
--
-- 新增 currency TEXT DEFAULT 'TWD'
-- 支援：TWD / USD / JPY / CNY / EUR
-- 更新 liff_insert_expense_request 讀取 payload.currency 並 INSERT
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.expense_requests
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'TWD';

ALTER TABLE public.expense_requests
  DROP CONSTRAINT IF EXISTS chk_expense_request_currency;

ALTER TABLE public.expense_requests
  ADD CONSTRAINT chk_expense_request_currency
    CHECK (currency IN ('TWD', 'USD', 'JPY', 'CNY', 'EUR'));


-- ─── 更新 liff_insert_expense_request（保留所有既有邏輯，加 currency）────────
CREATE OR REPLACE FUNCTION public.liff_insert_expense_request(p_line_user_id text, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp                 employees;
  v_is_expense        boolean;
  v_amount            numeric;
  v_currency          text;
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

  v_is_expense := COALESCE((p_payload->>'is_expense')::boolean, true);

  -- 幣別：只在費用申請時有意義；預設 TWD；限定合法值
  v_currency := COALESCE(NULLIF(p_payload->>'currency', ''), 'TWD');
  IF v_currency NOT IN ('TWD', 'USD', 'JPY', 'CNY', 'EUR') THEN
    v_currency := 'TWD';
  END IF;

  IF v_is_expense THEN
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
    v_amount := NULL;
    v_currency := 'TWD';  -- 非費用不需幣別，強制 TWD

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
    currency,
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
    v_amount,
    v_currency,
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
    'is_expense', v_is_expense,
    'currency', v_currency
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_expense_request(text, json) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
