-- 修正 liff_get_store_audit_detail 的分類排序
-- 中文數字 Unicode 順序 一<二<五<六<四，導致 五 跑到 四 前面
-- 改用 CASE 映射正確順序

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
    'responsible_employee_name', responsible_employee_name
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

NOTIFY pgrst, 'reload schema';
