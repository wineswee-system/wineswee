-- 維修廠商本身也歸「類別」(用同一套 repair_categories,取代原本自由字串 specialty)。
-- repair_vendors 目前 0 筆 → 直接換欄乾淨。

ALTER TABLE public.repair_vendors ADD COLUMN IF NOT EXISTS category_id int REFERENCES public.repair_categories(id) ON DELETE SET NULL;
ALTER TABLE public.repair_vendors DROP COLUMN IF EXISTS specialty;

-- liff_list_repair_orders 的 vendors 改回傳 category_id(給 LIFF 用類別清單顯示)
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
    'vendors', COALESCE((SELECT json_agg(json_build_object('id', rv.id, 'name', rv.name, 'category_id', rv.category_id, 'phone', rv.phone) ORDER BY rv.name)
                          FROM public.repair_vendors rv WHERE rv.organization_id = emp.organization_id AND rv.status = '啟用'), '[]'::json),
    'categories', COALESCE((SELECT json_agg(json_build_object('id', rc.id, 'name', rc.name) ORDER BY rc.sort_order, rc.id)
                          FROM public.repair_categories rc WHERE rc.organization_id = emp.organization_id), '[]'::json)
  );
END $function$;
