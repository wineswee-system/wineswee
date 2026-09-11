-- 隱藏 is_archived=true 員工(測試管理員204)於員工下拉 RPC — 2026-09-11
-- web + LIFF 三支 active-employee picker RPC 加 is_archived 過濾(status 不能用,會擋登入)。


CREATE OR REPLACE FUNCTION public.list_org_active_employees()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(json_build_object(
    'id',            e.id,
    'name',          e.name,
    'name_en',       e.name_en,
    'position',      e.position,
    -- 對齊系統慣例：dept/store 優先用 denormalized text,fallback join name
    'dept',          COALESCE(e.dept, d.name),
    'store',         COALESCE(e.store, s.name),
    'department_id', e.department_id,
    'store_id',      e.store_id
  ) ORDER BY e.name), '[]'::json)
  FROM public.employees e
  LEFT JOIN public.departments d ON d.id = e.department_id
  LEFT JOIN public.stores      s ON s.id = e.store_id
  WHERE e.status = '在職' AND COALESCE(e.is_archived, false) = false
    AND e.organization_id = public.current_user_org_id()
$function$
;

CREATE OR REPLACE FUNCTION public.liff_list_employees(p_line_user_id text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp    employees;
  v_list json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 對齊系統慣例：dept/store 優先用 denormalized text，fallback join name
  SELECT json_agg(json_build_object(
    'id', e.id,
    'name', e.name,
    'name_en', e.name_en,
    'position', e.position,
    'dept', COALESCE(e.dept, d.name),
    'store', COALESCE(e.store, s.name),
    'department_id', e.department_id,
    'store_id', e.store_id
  ) ORDER BY e.name) INTO v_list
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN stores s ON s.id = e.store_id
  WHERE e.status = '在職' AND COALESCE(e.is_archived, false) = false
    AND e.organization_id = emp.organization_id;

  RETURN json_build_object('ok', true, 'list', COALESCE(v_list, '[]'::json));
END $function$
;

CREATE OR REPLACE FUNCTION public.liff_list_employees_in_org(p_line_user_id text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(json_build_object(
    'id',    e.id,
    'name',  e.name,
    'dept',  e.dept,
    'store', e.store
  ) ORDER BY e.name), '[]'::json)
  FROM public.employees e
  WHERE e.status = '在職' AND COALESCE(e.is_archived, false) = false
    AND e.organization_id = (
      SELECT organization_id FROM public._liff_resolve_employee(p_line_user_id)
    )
$function$
;

NOTIFY pgrst, 'reload schema';
