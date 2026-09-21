-- LIFF 維修「管理廠商/類別」用的 RPC(anon→DEFINER+repair_order.manage),跟後台 web 功能對齊。

-- liff_add_repair_vendor 補 p_note(重建為 6 參數)
DROP FUNCTION IF EXISTS public.liff_add_repair_vendor(text,text,integer,text,text);
CREATE FUNCTION public.liff_add_repair_vendor(
  p_line_user_id text, p_name text, p_category_id integer DEFAULT NULL,
  p_phone text DEFAULT NULL, p_contact_person text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees; v_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'repair_order.manage') THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF COALESCE(btrim(p_name),'') = '' THEN RETURN json_build_object('ok', false, 'error', 'MISSING_NAME'); END IF;
  INSERT INTO public.repair_vendors (organization_id, name, category_id, phone, contact_person, note, status)
  VALUES (emp.organization_id, btrim(p_name), p_category_id, NULLIF(btrim(p_phone),''), NULLIF(btrim(p_contact_person),''), NULLIF(btrim(p_note),''), '啟用')
  RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id);
END $function$;

-- 停用/啟用廠商
CREATE OR REPLACE FUNCTION public.liff_set_repair_vendor_status(p_line_user_id text, p_id integer, p_status text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'repair_order.manage') THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF p_status NOT IN ('啟用','停用') THEN RETURN json_build_object('ok', false, 'error', 'BAD_STATUS'); END IF;
  UPDATE public.repair_vendors SET status = p_status
   WHERE id = p_id AND organization_id = emp.organization_id;
  RETURN json_build_object('ok', true);
END $function$;

-- 新增類別
CREATE OR REPLACE FUNCTION public.liff_add_repair_category(p_line_user_id text, p_name text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees; v_id int; v_sort int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'repair_order.manage') THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF COALESCE(btrim(p_name),'') = '' THEN RETURN json_build_object('ok', false, 'error', 'MISSING_NAME'); END IF;
  SELECT COALESCE(MAX(sort_order),0)+1 INTO v_sort FROM public.repair_categories WHERE organization_id = emp.organization_id;
  INSERT INTO public.repair_categories (organization_id, name, sort_order)
  VALUES (emp.organization_id, btrim(p_name), v_sort) RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id);
END $function$;

-- 刪類別
CREATE OR REPLACE FUNCTION public.liff_delete_repair_category(p_line_user_id text, p_id integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'repair_order.manage') THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  DELETE FROM public.repair_categories WHERE id = p_id AND organization_id = emp.organization_id;
  RETURN json_build_object('ok', true);
END $function$;

-- liff_list_repair_orders 的 vendors 改回傳全部(含停用)+ status/contact_person(管理用)
CREATE OR REPLACE FUNCTION public.liff_list_repair_orders(p_line_user_id text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees; v_perm boolean;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  v_perm := public.liff_employee_has_permission(emp.id, 'repair_order.manage');
  RETURN json_build_object(
    'ok', true,
    'me', json_build_object('id', emp.id, 'name', emp.name, 'department_id', emp.department_id, 'is_admin', public._wo_actor_is_admin(emp.id), 'can_manage', v_perm),
    'orders', CASE WHEN NOT v_perm THEN '[]'::json ELSE COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.created_at DESC) FROM (
        SELECT ro.*,
          (SELECT json_agg(json_build_object('id', er.id, 'status', er.status,
                            'estimated_amount', er.estimated_amount, 'title', er.title))
             FROM public.expense_requests er WHERE er.repair_order_id = ro.id AND er.deleted_at IS NULL) AS expenses
        FROM public.repair_orders ro
        WHERE ro.deleted_at IS NULL AND ro.organization_id = emp.organization_id
      ) t
    ), '[]'::json) END,
    'stores', COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                          FROM public.stores s WHERE s.organization_id = emp.organization_id), '[]'::json),
    'work_orders', COALESCE((SELECT json_agg(json_build_object('id', wo.id, 'title', wo.title, 'status', wo.status) ORDER BY wo.created_at DESC)
                          FROM public.work_orders wo
                         WHERE wo.deleted_at IS NULL AND wo.organization_id = emp.organization_id
                           AND (public._wo_actor_is_admin(emp.id) OR wo.target_department_id = emp.department_id)
                           AND wo.status IN ('待受理','處理中')), '[]'::json),
    'vendors', COALESCE((SELECT json_agg(json_build_object('id', rv.id, 'name', rv.name, 'category_id', rv.category_id, 'contact_person', rv.contact_person, 'phone', rv.phone, 'note', rv.note, 'status', rv.status) ORDER BY rv.name)
                          FROM public.repair_vendors rv WHERE rv.organization_id = emp.organization_id), '[]'::json),
    'categories', COALESCE((SELECT json_agg(json_build_object('id', rc.id, 'name', rc.name) ORDER BY rc.sort_order, rc.id)
                          FROM public.repair_categories rc WHERE rc.organization_id = emp.organization_id), '[]'::json)
  );
END $function$;

REVOKE ALL ON FUNCTION public.liff_add_repair_vendor(text,text,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.liff_add_repair_vendor(text,text,integer,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_set_repair_vendor_status(text,integer,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_add_repair_category(text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_delete_repair_category(text,integer) TO anon, authenticated;
