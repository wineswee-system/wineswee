-- 門市權責開關升級:加人時可選「給排班編輯權」(schedule.edit)。沒這權限的人(office/store staff)
-- 只加 user_stores 只能看;勾編輯 → 同時發個人 schedule.edit(employee_permissions grant)→ 可排該店(+本店)。
-- 換 4 參數版,先 DROP 3 參數版避免 overload 衝突(42725)。
DROP FUNCTION IF EXISTS public.set_store_extra_access(integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.set_store_extra_access(p_employee_id integer, p_store_id integer, p_grant boolean, p_can_edit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller employees; v_org int; v_emp_org int; v_store_org int; v_pid int;
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

    -- 勾「可編輯」且目前沒有 schedule.edit → 發個人 grant(若原本被 revoke 也翻成 grant)
    IF p_can_edit AND NOT public.liff_employee_has_permission(p_employee_id, 'schedule.edit') THEN
      SELECT id INTO v_pid FROM public.permissions WHERE code = 'schedule.edit';
      INSERT INTO public.employee_permissions (employee_id, permission_id, mode, granted_by)
      VALUES (p_employee_id, v_pid, 'grant', v_caller.id)
      ON CONFLICT (employee_id, permission_id) DO UPDATE SET mode = 'grant', granted_by = v_caller.id, updated_at = now();
    END IF;

    RETURN jsonb_build_object('ok', true, 'action', 'granted', 'edit', COALESCE(p_can_edit, false));
  ELSE
    DELETE FROM public.user_stores WHERE employee_id = p_employee_id AND store_id = p_store_id;
    RETURN jsonb_build_object('ok', true, 'action', 'revoked');
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.set_store_extra_access(integer, integer, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_store_extra_access(integer, integer, boolean, boolean) TO authenticated;
