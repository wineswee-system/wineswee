-- 2026-08-14 維修單權限 repair_order.manage(比照 collection.manage:鎖 admin 以上,權限頁逐人開,開了完整能用)。
--   SELECT RLS + 全部 RPC(建立/完工/作廢/刪除/LIFF清單/詳情)改吃 repair_order.manage。
--   actor 路徑用 liff_employee_has_permission(p_actor, code)(web 傳 current_employee_id、LIFF 傳 resolve 的 emp.id 都通)。idempotent。

BEGIN;

INSERT INTO public.permissions (code, name, module, is_active) VALUES
  ('repair_order.manage', '維修單（工務）', '專案流程', true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, module = EXCLUDED.module, is_active = EXCLUDED.is_active;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.name IN ('super_admin', 'admin') AND p.code = 'repair_order.manage'
ON CONFLICT DO NOTHING;

-- SELECT RLS:改吃權限(取代原本開單人/同部門/admin)
DROP POLICY IF EXISTS repair_orders_select ON public.repair_orders;
CREATE POLICY repair_orders_select ON public.repair_orders FOR SELECT
  USING (deleted_at IS NULL AND public.current_employee_has_permission('repair_order.manage') AND org_visible(organization_id));

-- 建立:要有權限
CREATE OR REPLACE FUNCTION public._ro_create(
  p_actor int, p_handler_type text, p_occur_time timestamptz, p_location text,
  p_store_id int, p_title text, p_description text, p_need_purchase boolean,
  p_supplier text, p_quote_amount numeric, p_linked_work_order_id int
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_emp public.employees; v_dept text; v_row public.repair_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF NOT public.liff_employee_has_permission(p_actor, 'repair_order.manage') THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF COALESCE(btrim(p_description),'') = '' THEN RETURN json_build_object('ok', false, 'error', 'MISSING_DESCRIPTION'); END IF;
  IF COALESCE(p_handler_type,'') NOT IN ('self','vendor') THEN RETURN json_build_object('ok', false, 'error', 'BAD_HANDLER_TYPE'); END IF;
  SELECT * INTO v_emp FROM public.employees WHERE id = p_actor;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  SELECT name INTO v_dept FROM public.departments WHERE id = v_emp.department_id;
  INSERT INTO public.repair_orders (
    organization_id, requester_id, requester_name, requester_department_id, requester_department_name,
    handler_type, occur_time, location, store_id, title, description,
    need_purchase, supplier, quote_amount, linked_work_order_id, status
  ) VALUES (
    v_emp.organization_id, p_actor, v_emp.name, v_emp.department_id, v_dept,
    p_handler_type, p_occur_time, NULLIF(btrim(p_location),''), p_store_id, NULLIF(btrim(p_title),''), btrim(p_description),
    COALESCE(p_need_purchase,false), NULLIF(btrim(p_supplier),''), p_quote_amount, p_linked_work_order_id, '進行中'
  ) RETURNING * INTO v_row;
  RETURN json_build_object('ok', true, 'id', v_row.id);
END $function$;

-- 完工
CREATE OR REPLACE FUNCTION public._ro_complete(
  p_id int, p_actor int, p_completed_at timestamptz, p_completion_note text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ro public.repair_orders; v_pending int;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_ro FROM public.repair_orders WHERE id = p_id;
  IF v_ro.id IS NULL OR v_ro.deleted_at IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(p_actor, 'repair_order.manage') THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_ro.status = '已完工' THEN RETURN json_build_object('ok', false, 'error', 'ALREADY_DONE'); END IF;
  IF v_ro.status = '已取消' THEN RETURN json_build_object('ok', false, 'error', 'CANCELLED'); END IF;
  SELECT count(*) INTO v_pending FROM public.expense_requests WHERE repair_order_id = p_id AND deleted_at IS NULL AND status = '申請中';
  IF v_pending > 0 THEN RETURN json_build_object('ok', false, 'error', 'EXPENSE_PENDING'); END IF;
  UPDATE public.repair_orders SET status = '已完工', completed_at = COALESCE(p_completed_at, now()),
         completion_note = NULLIF(btrim(p_completion_note),''), updated_at = now() WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '已完工');
END $function$;

-- 作廢
CREATE OR REPLACE FUNCTION public._ro_cancel(p_id int, p_actor int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ro public.repair_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_ro FROM public.repair_orders WHERE id = p_id;
  IF v_ro.id IS NULL OR v_ro.deleted_at IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(p_actor, 'repair_order.manage') THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_ro.status = '已完工' THEN RETURN json_build_object('ok', false, 'error', 'ALREADY_DONE'); END IF;
  UPDATE public.repair_orders SET status = '已取消', updated_at = now() WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '已取消');
END $function$;

-- 刪除
CREATE OR REPLACE FUNCTION public._ro_delete(p_id int, p_actor int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ro public.repair_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_ro FROM public.repair_orders WHERE id = p_id;
  IF v_ro.id IS NULL OR v_ro.deleted_at IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(p_actor, 'repair_order.manage') THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  UPDATE public.repair_orders SET deleted_at = now(), updated_at = now() WHERE id = p_id;
  RETURN json_build_object('ok', true);
END $function$;

COMMIT;
