-- liff_get_store_audit_detail：items JSON 加 remark 欄
CREATE OR REPLACE FUNCTION public.liff_get_store_audit_detail(
  p_line_user_id text,
  p_audit_id     int
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_audit    store_audits;
  v_items    json;
  v_on_duty  json;
  v_step     approval_chain_steps;
  v_can_confirm boolean := false;
  v_can_approve boolean := false;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
  END IF;

  SELECT json_agg(json_build_object(
    'id', id, 'category_code', category_code, 'category_name', category_name,
    'item_no', item_no, 'item_text', item_text, 'deduct_score', deduct_score,
    'passed', passed,
    'responsible_employee_id', responsible_employee_id,
    'responsible_employee_name', responsible_employee_name,
    'remark', remark
  ) ORDER BY
    CASE category_code
      WHEN '一' THEN 1 WHEN '二' THEN 2 WHEN '三' THEN 3
      WHEN '四' THEN 4 WHEN '五' THEN 5 WHEN '六' THEN 6
      ELSE 99
    END,
    item_no
  ) INTO v_items
  FROM store_audit_items WHERE audit_id = p_audit_id;

  SELECT json_agg(json_build_object(
    'employee_id', employee_id, 'employee_name', employee_name,
    'confirmed', confirmed, 'confirmed_at', confirmed_at,
    'signature_data_url', signature_data_url
  ) ORDER BY sort_order) INTO v_on_duty
  FROM store_audit_on_duty WHERE audit_id = p_audit_id;

  IF v_audit.status = '申請中' AND v_audit.approval_chain_id IS NOT NULL THEN
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_audit.approval_chain_id AND step_order = v_audit.current_step;
    IF v_step.id IS NOT NULL THEN
      v_can_approve := public._employee_matches_chain_step(emp.id, v_step.id, v_audit.auditor_id);
    END IF;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'audit', row_to_json(v_audit),
    'items', COALESCE(v_items, '[]'::json),
    'on_duty', COALESCE(v_on_duty, '[]'::json),
    'can_confirm', v_can_confirm,
    'can_approve', v_can_approve
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_store_audit_detail(text, int) TO authenticated, anon;

-- liff_update_store_audit_item：加 p_remark 參數
CREATE OR REPLACE FUNCTION public.liff_update_store_audit_item(
  p_line_user_id text,
  p_item_id      int,
  p_passed       boolean DEFAULT NULL,
  p_responsible_employee_id int DEFAULT NULL,
  p_remark       text    DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_item     store_audit_items;
  v_audit    store_audits;
  v_resp_name text;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_item FROM store_audit_items WHERE id = p_item_id;
  IF v_item.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'ITEM_NOT_FOUND');
  END IF;

  SELECT * INTO v_audit FROM store_audits WHERE id = v_item.audit_id;
  IF v_audit.status <> '草稿' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_DRAFT', 'status', v_audit.status);
  END IF;
  IF v_audit.auditor_id IS DISTINCT FROM emp.id THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUDITOR');
  END IF;

  IF p_responsible_employee_id IS NOT NULL THEN
    SELECT name INTO v_resp_name FROM employees WHERE id = p_responsible_employee_id;
  END IF;

  UPDATE store_audit_items SET
    passed = COALESCE(p_passed, passed),
    responsible_employee_id   = CASE WHEN p_responsible_employee_id IS NOT NULL THEN p_responsible_employee_id ELSE responsible_employee_id END,
    responsible_employee_name = CASE WHEN p_responsible_employee_id IS NOT NULL THEN v_resp_name ELSE responsible_employee_name END,
    remark = CASE WHEN p_remark IS NOT NULL THEN p_remark ELSE remark END
  WHERE id = p_item_id;

  -- 若改成合格 → 清掉責任人
  IF p_passed = TRUE THEN
    UPDATE store_audit_items SET
      responsible_employee_id = NULL,
      responsible_employee_name = NULL
    WHERE id = p_item_id;
  END IF;

  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_store_audit_item(text, int, boolean, int, text) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
