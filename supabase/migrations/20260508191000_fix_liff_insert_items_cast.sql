-- ════════════════════════════════════════════════════════════
-- 修 20260508190000 的 type cast bug：
--   COALESCE((p_payload->'items'), '[]'::jsonb)
--   p_payload 是 json，p_payload->'items' 也是 json；'[]'::jsonb 是 jsonb
--   → COALESCE 兩邊型別不同 → throw「COALESCE could not convert type jsonb to json」
--
-- 修法：把 p_payload->'items' cast 成 jsonb 再 COALESCE
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

  SELECT id INTO v_chain_id
    FROM public.approval_chains
   WHERE category = '費用申請'
     AND organization_id = emp.organization_id
     AND COALESCE(is_active, true) = true
     AND v_amount >= COALESCE(min_amount, 0)
     AND (max_amount IS NULL OR v_amount <= max_amount)
   ORDER BY COALESCE(min_amount, 0) DESC
   LIMIT 1;

  IF v_chain_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_chain_step_count
      FROM public.approval_chain_steps WHERE chain_id = v_chain_id;
    IF v_chain_step_count = 0 THEN v_chain_id := NULL; END IF;
  END IF;

  v_supervisor_id := public._resolve_single_approver(emp.id);
  v_is_owner := (v_supervisor_id IS NULL AND NOT public._is_store_manager(emp.id));

  IF v_is_owner THEN v_status := '已核准'; END IF;

  IF NOT v_is_owner AND v_chain_id IS NULL THEN
    RAISE EXCEPTION '尚未設定符合金額 NT$% 的「費用申請」簽核鏈，請聯絡管理員', v_amount
      USING ERRCODE = 'P0001', HINT = '請到「組織 > 簽核設定」新增 category=費用申請 的 approval_chain';
  END IF;

  INSERT INTO public.expense_requests (
    employee, employee_id, department,
    account_code, account_name,
    title, description, estimated_amount,
    supplier,
    items,
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
    p_payload->>'supplier',
    -- ★ 修 cast：p_payload->'items' 是 json，cast 成 jsonb 才能 COALESCE jsonb default
    COALESCE((p_payload->'items')::jsonb, '[]'::jsonb),
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

COMMIT;

NOTIFY pgrst, 'reload schema';
