-- ════════════════════════════════════════════════════════════════════════════
-- 修:liff_insert_expense_request 有兩個 overload,前端呼叫的是「三參數版」
-- (帶 p_binding_id)。20260811150000 只補到兩參數版 → 三參數版仍未接 settle_assignee_id。
-- 這裡補三參數版(前端實際走的)。2026-08-11
-- ════════════════════════════════════════════════════════════════════════════

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
    settle_assignee_id,                       -- ★ 新增：直接指定驗收人
    settle_department_id, settle_store_id     -- 舊制相容(改選人後前端傳 null)
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
    CASE WHEN v_is_exp THEN NULLIF(p_payload->>'settle_assignee_id', '')::int ELSE NULL END,
    CASE WHEN v_is_exp THEN NULLIF(p_payload->>'settle_department_id', '')::int ELSE NULL END,
    CASE WHEN v_is_exp THEN NULLIF(p_payload->>'settle_store_id', '')::int ELSE NULL END
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id, 'binding_id', p_binding_id);
END $function$;
