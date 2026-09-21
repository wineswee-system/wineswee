-- 門市權責「開關」:admin 直接指派/移除某人對某店的額外存取(寫 user_stores)。
-- 授予對象若本身有 schedule.edit → 立即可看+可排該店(current_user_visible_emp_ids 經 _can_see_store_for_emp
-- 已含 user_stores);稽核已核准單也可見(can_see_store 含 user_stores)。純看(無 schedule.edit)= 只稽核可見。
CREATE OR REPLACE FUNCTION public.set_store_extra_access(p_employee_id integer, p_store_id integer, p_grant boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller employees; v_org int; v_emp_org int; v_store_org int;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CALLER_NOT_FOUND'); END IF;
  IF v_caller.role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ALLOWED');
  END IF;
  v_org := v_caller.organization_id;

  SELECT organization_id INTO v_emp_org FROM employees WHERE id = p_employee_id;
  SELECT organization_id INTO v_store_org FROM stores WHERE id = p_store_id;
  IF v_emp_org IS NULL OR v_store_org IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_emp_org <> v_org OR v_store_org <> v_org THEN RETURN jsonb_build_object('ok', false, 'error', 'CROSS_ORG'); END IF;

  IF p_grant THEN
    INSERT INTO public.user_stores (employee_id, store_id, is_primary, organization_id)
    VALUES (p_employee_id, p_store_id, false, v_org)
    ON CONFLICT (employee_id, store_id) DO NOTHING;
    RETURN jsonb_build_object('ok', true, 'action', 'granted');
  ELSE
    DELETE FROM public.user_stores WHERE employee_id = p_employee_id AND store_id = p_store_id;
    RETURN jsonb_build_object('ok', true, 'action', 'revoked');
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.set_store_extra_access(integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_store_extra_access(integer, integer, boolean) TO authenticated;
