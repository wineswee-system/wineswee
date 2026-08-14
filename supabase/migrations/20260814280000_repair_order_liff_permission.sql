-- 2026-08-14 維修單 LIFF 清單/詳情改吃 repair_order.manage(對齊 web RLS + 寫入 RPC)

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
                           AND wo.status IN ('待受理','處理中')), '[]'::json)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.liff_get_repair_order(p_line_user_id text, p_id int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees; v_ro public.repair_orders;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'repair_order.manage') THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  SELECT * INTO v_ro FROM public.repair_orders WHERE id = p_id AND deleted_at IS NULL;
  IF v_ro.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  RETURN json_build_object('ok', true,
    'order', row_to_json(v_ro),
    'expenses', COALESCE((SELECT json_agg(json_build_object('id', er.id, 'status', er.status,
                            'estimated_amount', er.estimated_amount, 'title', er.title, 'doc_type', er.doc_type))
             FROM public.expense_requests er WHERE er.repair_order_id = p_id AND er.deleted_at IS NULL), '[]'::json),
    'attachments', COALESCE((SELECT json_agg(json_build_object('id', fa.id, 'file_name', fa.file_name,
                            'storage_bucket', fa.storage_bucket, 'storage_path', fa.storage_path, 'mime_type', fa.mime_type))
             FROM public.form_attachments fa WHERE fa.form_type = 'repair_order' AND fa.form_id = p_id), '[]'::json)
  );
END $function$;
