-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 端「核銷(驗收)單位」支援
-- 2026-06-24
--
-- ① liff_insert_expense_request(payload):申請時把 settle_department_id/settle_store_id 一起入庫
-- ② liff_list_expense_requests:核銷人(settle_assignee_id)也能看到待他核銷的單(已核准/核銷已退回)
-- ③ liff_settle_expense_request:放寬 WHERE → 申請人 OR 核銷人 都能送核銷
-- ④ liff_list_departments / liff_list_stores:給 LIFF 申請表單的「核銷單位」下拉用
--
-- 全程只改撈單條件 / WHERE / INSERT 欄位，不動其他邏輯。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

-- ── ① 申請入庫帶核銷單位（payload 是 JSON，不改簽名）──
CREATE OR REPLACE FUNCTION public.liff_insert_expense_request(p_line_user_id text, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_currency := 'TWD';

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
    approval_chain_id, current_step,
    settle_department_id, settle_store_id   -- ★ 新增：核銷(驗收)單位
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
    0,
    CASE WHEN v_is_expense THEN NULLIF(p_payload->>'settle_department_id', '')::int ELSE NULL END,
    CASE WHEN v_is_expense THEN NULLIF(p_payload->>'settle_store_id', '')::int ELSE NULL END
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
END $function$;

-- ── ①' 同上但帶 binding_id 的 overload（LIFF 申請表單實際走這支）──
CREATE OR REPLACE FUNCTION public.liff_insert_expense_request(p_line_user_id text, p_payload json, p_binding_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp        employees;
  new_id     INT;
  v_items    JSONB;
  v_is_exp   BOOLEAN;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  v_is_exp := COALESCE((p_payload->>'is_expense')::boolean, TRUE);

  BEGIN
    v_items := (p_payload->'items');
  EXCEPTION WHEN OTHERS THEN
    v_items := NULL;
  END;

  INSERT INTO public.expense_requests (
    employee, employee_id, department,
    is_expense, account_code, account_name,
    title, description, estimated_amount,
    currency, store, supplier, items,
    linked_binding_id,
    status, organization_id,
    settle_department_id, settle_store_id   -- ★ 新增：核銷(驗收)單位
  )
  VALUES (
    emp.name, emp.id, emp.dept,
    v_is_exp,
    p_payload->>'account_code',
    p_payload->>'account_name',
    p_payload->>'title',
    p_payload->>'description',
    NULLIF(p_payload->>'estimated_amount', '')::numeric,
    COALESCE(p_payload->>'currency', 'TWD'),
    COALESCE(p_payload->>'store', emp.store),
    p_payload->>'supplier',
    v_items,
    p_binding_id,
    '申請中',
    emp.organization_id,
    CASE WHEN v_is_exp THEN NULLIF(p_payload->>'settle_department_id', '')::int ELSE NULL END,
    CASE WHEN v_is_exp THEN NULLIF(p_payload->>'settle_store_id', '')::int ELSE NULL END
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id, 'binding_id', p_binding_id);
END $function$;

-- ── ② 撈單:核銷人也看得到待他核銷的單 ──
CREATE OR REPLACE FUNCTION public.liff_list_expense_requests(p_line_user_id text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(row_to_json(er.*) ORDER BY er.created_at DESC), '[]'::json)
  FROM public.expense_requests er
  WHERE er.deleted_at IS NULL
    AND (
      er.employee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
      OR (
        er.settle_assignee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
        AND er.status IN ('已核准', '核銷已退回')
      )
    )
$function$;

-- ── ③ 送核銷:申請人 OR 核銷人 都可送 ──
CREATE OR REPLACE FUNCTION public.liff_settle_expense_request(p_line_user_id text, p_id integer, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE emp employees; n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  UPDATE public.expense_requests SET
    actual_amount = (p_payload->>'actual_amount')::numeric,
    notes = p_payload->>'notes',
    status = '待核銷'
  WHERE id = p_id
    AND (employee_id = emp.id OR settle_assignee_id = emp.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN json_build_object('updated', n);
END $function$;

-- ── ④ LIFF 申請表單「核銷單位」下拉用:部門 / 門市清單 ──
CREATE OR REPLACE FUNCTION public.liff_list_departments(p_line_user_id text)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(json_build_object('id', d.id, 'name', d.name) ORDER BY d.name), '[]'::json)
  FROM public.departments d
  WHERE d.organization_id = (SELECT organization_id FROM public._liff_resolve_employee(p_line_user_id))
$function$;

CREATE OR REPLACE FUNCTION public.liff_list_stores(p_line_user_id text)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name), '[]'::json)
  FROM public.stores s
  WHERE s.organization_id = (SELECT organization_id FROM public._liff_resolve_employee(p_line_user_id))
$function$;

GRANT EXECUTE ON FUNCTION public.liff_list_departments(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.liff_list_stores(text) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
