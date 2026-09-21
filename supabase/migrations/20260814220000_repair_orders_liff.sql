-- 2026-08-14 維修單 LIFF 薄殼(auth 走 _liff_resolve_employee)+ 詳情帶連結費用單狀態

-- 建立
CREATE OR REPLACE FUNCTION public.liff_create_repair_order(
  p_line_user_id text, p_handler_type text, p_occur_time timestamptz, p_location text,
  p_store_id int, p_title text, p_description text, p_need_purchase boolean,
  p_supplier text, p_quote_amount numeric, p_linked_work_order_id int
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  RETURN public._ro_create(emp.id, p_handler_type, p_occur_time, p_location, p_store_id,
    p_title, p_description, p_need_purchase, p_supplier, p_quote_amount, p_linked_work_order_id);
END $function$;

-- 完工
CREATE OR REPLACE FUNCTION public.liff_complete_repair_order(
  p_line_user_id text, p_id int, p_completed_at timestamptz, p_completion_note text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  RETURN public._ro_complete(p_id, emp.id, p_completed_at, p_completion_note);
END $function$;

-- 作廢
CREATE OR REPLACE FUNCTION public.liff_cancel_repair_order(p_line_user_id text, p_id int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  RETURN public._ro_cancel(p_id, emp.id);
END $function$;

-- 清單(me + 我開的/同部門的維修單 + 各張連結費用單摘要 + 下拉:門市/我部門待處理工單)
CREATE OR REPLACE FUNCTION public.liff_list_repair_orders(p_line_user_id text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees; v_is_admin boolean;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  v_is_admin := public._wo_actor_is_admin(emp.id);
  RETURN json_build_object(
    'ok', true,
    'me', json_build_object('id', emp.id, 'name', emp.name, 'department_id', emp.department_id, 'is_admin', v_is_admin),
    'orders', COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.created_at DESC) FROM (
        SELECT ro.*,
          (SELECT json_agg(json_build_object('id', er.id, 'status', er.status,
                            'estimated_amount', er.estimated_amount, 'title', er.title))
             FROM public.expense_requests er
            WHERE er.repair_order_id = ro.id AND er.deleted_at IS NULL) AS expenses
        FROM public.repair_orders ro
        WHERE ro.deleted_at IS NULL
          AND ro.organization_id = emp.organization_id
          AND (v_is_admin OR ro.requester_id = emp.id OR ro.requester_department_id = emp.department_id)
      ) t
    ), '[]'::json),
    'stores', COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                          FROM public.stores s WHERE s.organization_id = emp.organization_id), '[]'::json),
    'work_orders', COALESCE((SELECT json_agg(json_build_object('id', wo.id, 'title', wo.title, 'status', wo.status) ORDER BY wo.created_at DESC)
                          FROM public.work_orders wo
                         WHERE wo.deleted_at IS NULL AND wo.organization_id = emp.organization_id
                           AND (v_is_admin OR wo.target_department_id = emp.department_id)
                           AND wo.status IN ('待受理','處理中')), '[]'::json)
  );
END $function$;

-- 詳情(單張 + 連結費用單)
CREATE OR REPLACE FUNCTION public.liff_get_repair_order(p_line_user_id text, p_id int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees; v_ro public.repair_orders; v_is_admin boolean;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  SELECT * INTO v_ro FROM public.repair_orders WHERE id = p_id AND deleted_at IS NULL;
  IF v_ro.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  v_is_admin := public._wo_actor_is_admin(emp.id);
  IF NOT (v_is_admin OR v_ro.requester_id = emp.id OR v_ro.requester_department_id = emp.department_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  RETURN json_build_object('ok', true,
    'order', row_to_json(v_ro),
    'expenses', COALESCE((SELECT json_agg(json_build_object('id', er.id, 'status', er.status,
                            'estimated_amount', er.estimated_amount, 'title', er.title, 'doc_type', er.doc_type))
             FROM public.expense_requests er WHERE er.repair_order_id = p_id AND er.deleted_at IS NULL), '[]'::json)
  );
END $function$;

DO $grant$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.liff_create_repair_order(text,text,timestamptz,text,int,text,text,boolean,text,numeric,int) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.liff_create_repair_order(text,text,timestamptz,text,int,text,text,boolean,text,numeric,int) TO anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.liff_complete_repair_order(text,int,timestamptz,text) TO anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.liff_cancel_repair_order(text,int) TO anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.liff_list_repair_orders(text) TO anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.liff_get_repair_order(text,int) TO anon, authenticated';
END $grant$;
