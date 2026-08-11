-- ════════════════════════════════════════════════════════════════════════════
-- 驗收單位改為「直接選人」(settle_assignee_id) — 2026-08-11
--   往後即生效:表單改選一位驗收人(可含自己),直接寫 settle_assignee_id。
--   舊制「選部門→部門主管 / 營運部→門市店長」保留為 fallback:
--     trigger 只在 settle_assignee_id IS NULL 時才從 dept/store 推算 → 既有單不受影響。
--   異動:
--     1) trigger _resolve_expense_settle_assignee:加 NEW.settle_assignee_id IS NULL 守門
--     2) liff_insert_expense_request:payload 接 settle_assignee_id
--     3) liff_update_expense_request:payload 接 settle_assignee_id
--   idempotent(全 CREATE OR REPLACE)。
-- ════════════════════════════════════════════════════════════════════════════

-- ① 核准當下解析驗收人:已指定人(settle_assignee_id)就不覆蓋;否則沿用舊 dept/store fallback
CREATE OR REPLACE FUNCTION public._resolve_expense_settle_assignee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准'
     AND NEW.settle_assignee_id IS NULL THEN   -- ★ 已直接選人則保留,不再從部門/門市推算
    IF NEW.settle_store_id IS NOT NULL THEN
      SELECT manager_id INTO NEW.settle_assignee_id FROM stores WHERE id = NEW.settle_store_id;
    ELSIF NEW.settle_department_id IS NOT NULL THEN
      SELECT manager_id INTO NEW.settle_assignee_id FROM departments WHERE id = NEW.settle_department_id;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- ② LIFF 建立費用單:接受 settle_assignee_id(選人);dept/store 仍相容
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
    settle_assignee_id,                       -- ★ 新增：直接指定驗收人
    settle_department_id, settle_store_id     -- 舊制相容(改選人後前端傳 null)
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
    CASE WHEN v_is_expense THEN NULLIF(p_payload->>'settle_assignee_id', '')::int ELSE NULL END,
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

-- ③ LIFF 編輯費用單:接受 settle_assignee_id('__CLEAR__' 可清空)
CREATE OR REPLACE FUNCTION public.liff_update_expense_request(p_line_user_id text, p_id integer, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  UPDATE public.expense_requests SET
    title                = COALESCE(NULLIF(p_payload->>'title', ''),              title),
    description          = COALESCE(NULLIF(p_payload->>'description', ''),        description),
    estimated_amount     = COALESCE(NULLIF(p_payload->>'estimated_amount', '')::numeric, estimated_amount),
    account_code         = COALESCE(NULLIF(p_payload->>'account_code', ''),       account_code),
    notes                = COALESCE(NULLIF(p_payload->>'notes', ''),              notes),
    store                = COALESCE(NULLIF(p_payload->>'store', ''),              store),
    supplier             = COALESCE(NULLIF(p_payload->>'supplier', ''),           supplier),
    settle_assignee_id   = CASE
                             WHEN p_payload->>'settle_assignee_id' = '__CLEAR__' THEN NULL
                             WHEN p_payload->>'settle_assignee_id' IS NOT NULL
                             THEN NULLIF(p_payload->>'settle_assignee_id', '')::int
                             ELSE settle_assignee_id
                           END,
    settle_department_id = CASE
                             WHEN p_payload->>'settle_department_id' = '__CLEAR__' THEN NULL
                             WHEN p_payload->>'settle_department_id' IS NOT NULL
                             THEN NULLIF(p_payload->>'settle_department_id', '')::int
                             ELSE settle_department_id
                           END,
    settle_store_id      = CASE
                             WHEN p_payload->>'settle_store_id' = '__CLEAR__' THEN NULL
                             WHEN p_payload->>'settle_store_id' IS NOT NULL
                             THEN NULLIF(p_payload->>'settle_store_id', '')::int
                             ELSE settle_store_id
                           END,
    updated_at           = now()
  WHERE id = p_id
    AND employee_id = emp.id
    AND status = '申請中'
    AND COALESCE(current_step, 0) = 0;

  IF NOT FOUND THEN RAISE EXCEPTION '此申請已進入審核流程，無法編輯'; END IF;
  RETURN json_build_object('id', p_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_update_expense_request] %', SQLERRM; RAISE;
END $function$;
