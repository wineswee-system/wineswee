-- 維修單建單 RPC 支援 category_id / repair_vendor_id;LIFF 清單 RPC 回傳可選的 vendors + categories。
-- _ro_create 是共用實作(create_repair_order 與 liff_create_repair_order 都走它);新參數帶 DEFAULT NULL 向後相容。

-- ── _ro_create:加 p_category_id / p_repair_vendor_id ──
DROP FUNCTION IF EXISTS public._ro_create(integer,text,timestamptz,text,integer,text,text,boolean,text,numeric,integer);
CREATE FUNCTION public._ro_create(
  p_actor integer, p_handler_type text, p_occur_time timestamptz, p_location text, p_store_id integer,
  p_title text, p_description text, p_need_purchase boolean, p_supplier text, p_quote_amount numeric,
  p_linked_work_order_id integer, p_category_id integer DEFAULT NULL, p_repair_vendor_id integer DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_emp public.employees; v_dept text; v_row public.repair_orders; v_supplier text;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF NOT public.liff_employee_has_permission(p_actor, 'repair_order.manage') THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF COALESCE(btrim(p_description),'') = '' THEN RETURN json_build_object('ok', false, 'error', 'MISSING_DESCRIPTION'); END IF;
  IF COALESCE(p_handler_type,'') NOT IN ('self','vendor') THEN RETURN json_build_object('ok', false, 'error', 'BAD_HANDLER_TYPE'); END IF;
  SELECT * INTO v_emp FROM public.employees WHERE id = p_actor;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  SELECT name INTO v_dept FROM public.departments WHERE id = v_emp.department_id;
  -- 選了廠商庫的廠商 → supplier 文字自動帶廠商名(相容舊顯示);否則用傳入的自由字串
  v_supplier := NULLIF(btrim(p_supplier),'');
  IF p_repair_vendor_id IS NOT NULL THEN
    SELECT name INTO v_supplier FROM public.repair_vendors WHERE id = p_repair_vendor_id;
  END IF;
  INSERT INTO public.repair_orders (
    organization_id, requester_id, requester_name, requester_department_id, requester_department_name,
    handler_type, occur_time, location, store_id, title, description,
    need_purchase, supplier, quote_amount, linked_work_order_id, status, category_id, repair_vendor_id
  ) VALUES (
    v_emp.organization_id, p_actor, v_emp.name, v_emp.department_id, v_dept,
    p_handler_type, p_occur_time, NULLIF(btrim(p_location),''), p_store_id, NULLIF(btrim(p_title),''), btrim(p_description),
    COALESCE(p_need_purchase,false), v_supplier, p_quote_amount, p_linked_work_order_id, '進行中', p_category_id, p_repair_vendor_id
  ) RETURNING * INTO v_row;
  RETURN json_build_object('ok', true, 'id', v_row.id);
END $function$;

-- ── create_repair_order(web):加 2 參數傳下去 ──
DROP FUNCTION IF EXISTS public.create_repair_order(text,timestamptz,text,integer,text,text,boolean,text,numeric,integer);
CREATE FUNCTION public.create_repair_order(
  p_handler_type text, p_occur_time timestamptz, p_location text, p_store_id integer, p_title text,
  p_description text, p_need_purchase boolean, p_supplier text, p_quote_amount numeric, p_linked_work_order_id integer,
  p_category_id integer DEFAULT NULL, p_repair_vendor_id integer DEFAULT NULL)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public._ro_create(public.current_employee_id(), p_handler_type, p_occur_time, p_location,
    p_store_id, p_title, p_description, p_need_purchase, p_supplier, p_quote_amount, p_linked_work_order_id,
    p_category_id, p_repair_vendor_id);
$function$;

-- ── liff_create_repair_order(LIFF):加 2 參數傳下去 ──
DROP FUNCTION IF EXISTS public.liff_create_repair_order(text,text,timestamptz,text,integer,text,text,boolean,text,numeric,integer);
CREATE FUNCTION public.liff_create_repair_order(
  p_line_user_id text, p_handler_type text, p_occur_time timestamptz, p_location text, p_store_id integer,
  p_title text, p_description text, p_need_purchase boolean, p_supplier text, p_quote_amount numeric,
  p_linked_work_order_id integer, p_category_id integer DEFAULT NULL, p_repair_vendor_id integer DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  RETURN public._ro_create(emp.id, p_handler_type, p_occur_time, p_location, p_store_id,
    p_title, p_description, p_need_purchase, p_supplier, p_quote_amount, p_linked_work_order_id,
    p_category_id, p_repair_vendor_id);
END $function$;

-- ── liff_list_repair_orders:回傳 vendors + categories(給 LIFF 表單挑) ──
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
    'vendors', COALESCE((SELECT json_agg(json_build_object('id', rv.id, 'name', rv.name, 'specialty', rv.specialty, 'phone', rv.phone) ORDER BY rv.name)
                          FROM public.repair_vendors rv WHERE rv.organization_id = emp.organization_id AND rv.status = '啟用'), '[]'::json),
    'categories', COALESCE((SELECT json_agg(json_build_object('id', rc.id, 'name', rc.name) ORDER BY rc.sort_order, rc.id)
                          FROM public.repair_categories rc WHERE rc.organization_id = emp.organization_id), '[]'::json)
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.create_repair_order(text,timestamptz,text,integer,text,text,boolean,text,numeric,integer,integer,integer) TO authenticated;
