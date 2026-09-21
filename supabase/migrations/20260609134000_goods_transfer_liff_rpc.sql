-- ════════════════════════════════════════════════════════════════════════════
-- 商品調撥 — LIFF SECURITY DEFINER RPCs（給 anon 用）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. 列出我的調撥申請（含明細）
CREATE OR REPLACE FUNCTION public.liff_list_my_transfer_requests(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(row_to_json(r) ORDER BY r.id DESC)
    FROM (
      SELECT
        r.*,
        (SELECT json_agg(it ORDER BY it.line_no) FROM goods_transfer_items it WHERE it.transfer_request_id = r.id) AS items
      FROM goods_transfer_requests r
      WHERE r.applicant_id = emp.id
        AND r.deleted_at IS NULL
    ) r
  ), '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_transfer_requests(text) TO anon, authenticated;


-- 2. 列出待我簽核的調撥申請（含明細）
CREATE OR REPLACE FUNCTION public.liff_list_transfer_approvals(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  v_result JSON;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.id DESC), '[]'::json)
    INTO v_result
    FROM (
      SELECT
        r.*,
        (SELECT json_agg(it ORDER BY it.line_no) FROM goods_transfer_items it WHERE it.transfer_request_id = r.id) AS items
      FROM goods_transfer_requests r
      WHERE r.status IN ('申請審核中', '驗收審核中')
        AND r.current_chain_id IS NOT NULL
        AND r.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM resolve_snapshot_step_approvers(
            CASE r.current_stage WHEN 'apply' THEN 'goods_transfer_apply' ELSE 'goods_transfer_receipt' END,
            r.id, r.current_step, r.applicant_id
          ) a WHERE a.emp_id = emp.id
        )
    ) r;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_transfer_approvals(text) TO anon, authenticated;


-- 3. 新增調撥申請（含明細）
CREATE OR REPLACE FUNCTION public.liff_insert_transfer_request(
  p_line_user_id text,
  p_payload json
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'reasons')), '{}'),
    p_payload->>'reason_other',
    COALESCE(p_payload->'attachments', '[]'::jsonb)
  RETURNING id, document_no INTO v_new_id, v_doc_no;

  -- 寫明細
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
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
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_transfer_request(text, json) TO anon, authenticated;


-- 4. 員工送驗收
CREATE OR REPLACE FUNCTION public.liff_submit_transfer_receipt(
  p_line_user_id text,
  p_id INT,
  p_items JSONB,
  p_attachments JSONB DEFAULT '[]'::jsonb
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  v_rec goods_transfer_requests;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  SELECT * INTO v_rec FROM goods_transfer_requests WHERE id = p_id;
  IF v_rec.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_rec.applicant_id <> emp.id THEN RETURN json_build_object('ok', false, 'error', 'NOT_APPLICANT'); END IF;
  RETURN public.goods_transfer_submit_receipt(p_id, p_items, p_attachments);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_submit_transfer_receipt(text, INT, JSONB, JSONB) TO anon, authenticated;


-- 5. 簽核
CREATE OR REPLACE FUNCTION public.liff_approve_transfer(
  p_line_user_id text,
  p_id INT,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMP'); END IF;
  RETURN public.goods_transfer_approve(p_id, emp.id, p_action, p_reason);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_approve_transfer(text, INT, TEXT, TEXT) TO anon, authenticated;


-- 6. 列出 stores（給 LIFF 表單下拉用，限同 org）
CREATE OR REPLACE FUNCTION public.liff_list_stores_for_transfer(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;
  RETURN COALESCE((
    SELECT json_agg(json_build_object('id', id, 'name', name, 'manager_id', manager_id) ORDER BY name)
    FROM stores
    WHERE organization_id = emp.organization_id
  ), '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_stores_for_transfer(text) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
