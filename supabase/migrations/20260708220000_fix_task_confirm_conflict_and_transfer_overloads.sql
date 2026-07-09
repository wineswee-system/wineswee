-- Tier2 修:task_confirmations 缺 ON CONFLICT 唯一鍵 / 調撥兩 overload 型別 — 2026-07-08
-- 已對 live 驗證(0 重複、reasons=text[]、LIFF 直送走 2 參 overload)。idempotent。

-- 1) task_confirmations(task_id, approver) 唯一鍵:liff_create_task + _create_task_confirmations_for_step
--    都用 ON CONFLICT (task_id, approver) 但無此約束 → 建任務/推簽核關會炸。
--    live 現有 9 筆 0 重複 → 安全。加此鍵同時修好兩支。
CREATE UNIQUE INDEX IF NOT EXISTS task_confirmations_task_approver_uniq
  ON public.task_confirmations (task_id, approver);

-- 2) liff_insert_transfer_request(2 參,LIFF 直送調撥用):
--    p_payload 是 json → jsonb_array_elements(json) 不存在。cast ::jsonb。reasons=text[] 用 ARRAY(...)。
CREATE OR REPLACE FUNCTION public.liff_insert_transfer_request(p_line_user_id text, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
  v_app_id INT;
  v_app    employees;
  v_to_store INT;
  v_from_store INT;
  v_type TEXT;
  v_store_manager_id INT;
  v_new_id INT;
  v_doc_no TEXT;
  v_item JSONB;
  v_line INT := 1;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  v_type := p_payload->>'transfer_type';
  v_from_store := NULLIF(p_payload->>'from_store_id', '')::INT;
  v_to_store   := NULLIF(p_payload->>'to_store_id', '')::INT;

  -- 門市↔門市：申請人必須是調入店店長
  IF v_type = 'store_to_store' THEN
    IF v_to_store IS NULL THEN RAISE EXCEPTION '門市↔門市調撥必須指定調入門市'; END IF;
    SELECT manager_id INTO v_store_manager_id FROM stores WHERE id = v_to_store;
    IF v_store_manager_id IS NULL THEN RAISE EXCEPTION '調入門市未設店長'; END IF;
    IF v_store_manager_id <> emp.id THEN RAISE EXCEPTION '門市↔門市調撥必須由調入門市店長發起'; END IF;
    v_app_id := v_store_manager_id;
  ELSE
    v_app_id := emp.id;
  END IF;

  SELECT * INTO v_app FROM employees WHERE id = v_app_id;

  INSERT INTO goods_transfer_requests (
    organization_id, applicant_id, applicant_name, applicant_dept, applicant_store,
    request_date, needed_date,
    transfer_type, from_store_id, to_store_id, from_label, to_label,
    reasons, reason_other,
    attachments
  )
  SELECT
    v_app.organization_id, v_app.id, v_app.name, v_app.dept,
    (SELECT name FROM stores WHERE id = v_app.store_id),
    COALESCE((p_payload->>'request_date')::date, CURRENT_DATE),
    NULLIF(p_payload->>'needed_date', '')::date,
    v_type,
    CASE WHEN v_type = 'warehouse_to_store' THEN NULL ELSE v_from_store END,
    CASE WHEN v_type = 'store_to_warehouse' THEN NULL ELSE v_to_store END,
    CASE WHEN v_type = 'warehouse_to_store' THEN '總倉' ELSE (SELECT name FROM stores WHERE id = v_from_store) END,
    CASE WHEN v_type = 'store_to_warehouse' THEN '總倉' ELSE (SELECT name FROM stores WHERE id = v_to_store) END,
    COALESCE(ARRAY(SELECT jsonb_array_elements_text((p_payload->'reasons')::jsonb)), '{}'),
    p_payload->>'reason_other',
    COALESCE((p_payload->'attachments')::jsonb, '[]'::jsonb)
  RETURNING id, document_no INTO v_new_id, v_doc_no;

  -- 寫明細
  FOR v_item IN SELECT * FROM jsonb_array_elements((p_payload->'items')::jsonb)
  LOOP
    INSERT INTO goods_transfer_items (
      transfer_request_id, line_no, product_code, product_name, spec, unit, requested_qty, notes
    ) VALUES (
      v_new_id, v_line,
      v_item->>'product_code', v_item->>'product_name',
      v_item->>'spec', v_item->>'unit',
      (v_item->>'requested_qty')::NUMERIC,
      v_item->>'notes'
    );
    v_line := v_line + 1;
  END LOOP;

  RETURN json_build_object('id', v_new_id, 'document_no', v_doc_no);
END $function$;

-- 3) liff_insert_transfer_request(3 參,任務綁定路徑用):reasons 欄是 text[],原塞 jsonb → 型別錯。轉 text[]。
CREATE OR REPLACE FUNCTION public.liff_insert_transfer_request(p_line_user_id text, p_payload json, p_binding_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
  v_app_id INT;
  v_app    employees;
  v_to_store INT;
  v_from_store INT;
  v_type TEXT;
  v_store_manager_id INT;
  v_new_id INT;
  v_doc_no TEXT;
  v_item JSONB;
  v_line INT := 1;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  v_type := p_payload->>'transfer_type';
  v_from_store := NULLIF(p_payload->>'from_store_id', '')::INT;
  v_to_store   := NULLIF(p_payload->>'to_store_id', '')::INT;

  IF v_type = 'store_to_store' THEN
    IF v_to_store IS NULL THEN RAISE EXCEPTION '門市↔門市調撥必須指定調入門市'; END IF;
    SELECT manager_id INTO v_store_manager_id FROM stores WHERE id = v_to_store;
    IF v_store_manager_id IS NULL THEN RAISE EXCEPTION '調入門市未設店長'; END IF;
    IF v_store_manager_id <> emp.id THEN RAISE EXCEPTION '門市↔門市調撥必須由調入門市店長發起'; END IF;
    v_app_id := v_store_manager_id;
  ELSE
    v_app_id := emp.id;
  END IF;

  SELECT * INTO v_app FROM employees WHERE id = v_app_id;

  INSERT INTO goods_transfer_requests (
    organization_id, applicant_id, applicant_name,
    transfer_type, from_store_id, to_store_id,
    from_label, to_label,
    request_date, needed_date,
    reasons, reason_other,
    status, linked_binding_id
  ) VALUES (
    v_app.organization_id, v_app.id, v_app.name,
    v_type, v_from_store, v_to_store,
    CASE WHEN v_type = 'warehouse_to_store' THEN '總倉' ELSE (SELECT name FROM stores WHERE id = v_from_store) END,
    CASE WHEN v_type = 'store_to_warehouse' THEN '總倉' ELSE (SELECT name FROM stores WHERE id = v_to_store)   END,
    COALESCE((p_payload->>'request_date')::date, CURRENT_DATE),
    NULLIF(p_payload->>'needed_date', '')::date,
    COALESCE(ARRAY(SELECT jsonb_array_elements_text((p_payload->'reasons')::jsonb)), '{}'),
    p_payload->>'reason_other',
    '申請審核中', p_binding_id
  ) RETURNING id, document_no INTO v_new_id, v_doc_no;

  -- 明細
  FOR v_item IN SELECT * FROM jsonb_array_elements((p_payload->'items')::jsonb) LOOP
    INSERT INTO goods_transfer_items (
      transfer_request_id, line_no, product_code, product_name, spec, unit, requested_qty, notes
    ) VALUES (
      v_new_id, v_line,
      v_item->>'product_code', v_item->>'product_name',
      v_item->>'spec', v_item->>'unit',
      NULLIF(v_item->>'requested_qty', '')::NUMERIC, v_item->>'notes'
    );
    v_line := v_line + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'id', v_new_id, 'document_no', v_doc_no);
END $function$;

NOTIFY pgrst, 'reload schema';
