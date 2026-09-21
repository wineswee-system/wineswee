-- 2026-08-19 維修單「存草稿」支援(web + LIFF)
--   status 加「草稿」;建單可存草稿;新增「更新草稿/送出」函式;草稿只有申請人看得到。
--   草稿=純暫存,不觸發任何通知/費用串接;送出後才變「進行中」進正常流程。

-- 1) status 白名單加「草稿」
ALTER TABLE public.repair_orders DROP CONSTRAINT IF EXISTS repair_orders_status_check;
ALTER TABLE public.repair_orders ADD CONSTRAINT repair_orders_status_check
  CHECK (status = ANY (ARRAY['草稿','進行中','待費用核准','已完工','已取消']::text[]));

-- 2) 先 DROP 舊版(加參數=新 overload,避免 42725 ambiguous)
DROP FUNCTION IF EXISTS public.create_repair_order(text,timestamptz,text,integer,text,text,boolean,text,numeric,integer,integer,integer);
DROP FUNCTION IF EXISTS public.liff_create_repair_order(text,text,timestamptz,text,integer,text,text,boolean,text,numeric,integer,integer,integer);
DROP FUNCTION IF EXISTS public._ro_create(integer,text,timestamptz,text,integer,text,text,boolean,text,numeric,integer,integer,integer);

-- 3) _ro_create 加 p_is_draft(草稿→狀態「草稿」,否則「進行中」)
CREATE OR REPLACE FUNCTION public._ro_create(
  p_actor integer, p_handler_type text, p_occur_time timestamptz, p_location text, p_store_id integer,
  p_title text, p_description text, p_need_purchase boolean, p_supplier text, p_quote_amount numeric,
  p_linked_work_order_id integer, p_category_id integer DEFAULT NULL, p_repair_vendor_id integer DEFAULT NULL,
  p_is_draft boolean DEFAULT false)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_emp public.employees; v_dept text; v_row public.repair_orders; v_supplier text;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF NOT public.liff_employee_has_permission(p_actor, 'repair_order.manage') THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  -- 草稿允許先不填描述;正式送出才必填
  IF NOT COALESCE(p_is_draft,false) AND COALESCE(btrim(p_description),'') = '' THEN RETURN json_build_object('ok', false, 'error', 'MISSING_DESCRIPTION'); END IF;
  IF COALESCE(p_handler_type,'') NOT IN ('self','vendor') THEN RETURN json_build_object('ok', false, 'error', 'BAD_HANDLER_TYPE'); END IF;
  SELECT * INTO v_emp FROM public.employees WHERE id = p_actor;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  SELECT name INTO v_dept FROM public.departments WHERE id = v_emp.department_id;
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
    COALESCE(p_need_purchase,false), v_supplier, p_quote_amount, p_linked_work_order_id,
    CASE WHEN COALESCE(p_is_draft,false) THEN '草稿' ELSE '進行中' END, p_category_id, p_repair_vendor_id
  ) RETURNING * INTO v_row;
  RETURN json_build_object('ok', true, 'id', v_row.id, 'status', v_row.status);
END $function$;

-- 4) web / LIFF 外殼加 p_is_draft
CREATE OR REPLACE FUNCTION public.create_repair_order(
  p_handler_type text, p_occur_time timestamptz, p_location text, p_store_id integer, p_title text,
  p_description text, p_need_purchase boolean, p_supplier text, p_quote_amount numeric,
  p_linked_work_order_id integer, p_category_id integer DEFAULT NULL, p_repair_vendor_id integer DEFAULT NULL,
  p_is_draft boolean DEFAULT false)
 RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public._ro_create(public.current_employee_id(), p_handler_type, p_occur_time, p_location,
    p_store_id, p_title, p_description, p_need_purchase, p_supplier, p_quote_amount, p_linked_work_order_id,
    p_category_id, p_repair_vendor_id, p_is_draft);
$function$;

CREATE OR REPLACE FUNCTION public.liff_create_repair_order(
  p_line_user_id text, p_handler_type text, p_occur_time timestamptz, p_location text, p_store_id integer,
  p_title text, p_description text, p_need_purchase boolean, p_supplier text, p_quote_amount numeric,
  p_linked_work_order_id integer, p_category_id integer DEFAULT NULL, p_repair_vendor_id integer DEFAULT NULL,
  p_is_draft boolean DEFAULT false)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  RETURN public._ro_create(emp.id, p_handler_type, p_occur_time, p_location, p_store_id,
    p_title, p_description, p_need_purchase, p_supplier, p_quote_amount, p_linked_work_order_id,
    p_category_id, p_repair_vendor_id, p_is_draft);
END $function$;

-- 5) 更新草稿 / 送出草稿(只有申請人本人、且該單還是草稿才可)
CREATE OR REPLACE FUNCTION public._ro_update_draft(
  p_actor integer, p_id integer, p_handler_type text, p_occur_time timestamptz, p_location text, p_store_id integer,
  p_title text, p_description text, p_need_purchase boolean, p_supplier text, p_quote_amount numeric,
  p_linked_work_order_id integer, p_category_id integer, p_repair_vendor_id integer, p_submit boolean DEFAULT false)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_row public.repair_orders; v_supplier text;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_row FROM public.repair_orders WHERE id = p_id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_row.status <> '草稿' THEN RETURN json_build_object('ok', false, 'error', 'NOT_DRAFT'); END IF;
  IF v_row.requester_id <> p_actor THEN RETURN json_build_object('ok', false, 'error', 'NOT_OWNER'); END IF;
  IF COALESCE(p_handler_type,'') NOT IN ('self','vendor') THEN RETURN json_build_object('ok', false, 'error', 'BAD_HANDLER_TYPE'); END IF;
  IF COALESCE(p_submit,false) AND COALESCE(btrim(p_description),'') = '' THEN RETURN json_build_object('ok', false, 'error', 'MISSING_DESCRIPTION'); END IF;
  v_supplier := NULLIF(btrim(p_supplier),'');
  IF p_repair_vendor_id IS NOT NULL THEN SELECT name INTO v_supplier FROM public.repair_vendors WHERE id = p_repair_vendor_id; END IF;
  UPDATE public.repair_orders SET
    handler_type = p_handler_type, occur_time = p_occur_time, location = NULLIF(btrim(p_location),''),
    store_id = p_store_id, title = NULLIF(btrim(p_title),''), description = btrim(p_description),
    need_purchase = COALESCE(p_need_purchase,false), supplier = v_supplier, quote_amount = p_quote_amount,
    linked_work_order_id = p_linked_work_order_id, category_id = p_category_id, repair_vendor_id = p_repair_vendor_id,
    status = CASE WHEN COALESCE(p_submit,false) THEN '進行中' ELSE '草稿' END
  WHERE id = p_id RETURNING * INTO v_row;
  RETURN json_build_object('ok', true, 'id', v_row.id, 'status', v_row.status);
END $function$;

CREATE OR REPLACE FUNCTION public.update_repair_order_draft(
  p_id integer, p_handler_type text, p_occur_time timestamptz, p_location text, p_store_id integer, p_title text,
  p_description text, p_need_purchase boolean, p_supplier text, p_quote_amount numeric, p_linked_work_order_id integer,
  p_category_id integer DEFAULT NULL, p_repair_vendor_id integer DEFAULT NULL, p_submit boolean DEFAULT false)
 RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public._ro_update_draft(public.current_employee_id(), p_id, p_handler_type, p_occur_time, p_location,
    p_store_id, p_title, p_description, p_need_purchase, p_supplier, p_quote_amount, p_linked_work_order_id,
    p_category_id, p_repair_vendor_id, p_submit);
$function$;

CREATE OR REPLACE FUNCTION public.liff_update_repair_order_draft(
  p_line_user_id text, p_id integer, p_handler_type text, p_occur_time timestamptz, p_location text, p_store_id integer,
  p_title text, p_description text, p_need_purchase boolean, p_supplier text, p_quote_amount numeric,
  p_linked_work_order_id integer, p_category_id integer DEFAULT NULL, p_repair_vendor_id integer DEFAULT NULL,
  p_submit boolean DEFAULT false)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  RETURN public._ro_update_draft(emp.id, p_id, p_handler_type, p_occur_time, p_location, p_store_id,
    p_title, p_description, p_need_purchase, p_supplier, p_quote_amount, p_linked_work_order_id,
    p_category_id, p_repair_vendor_id, p_submit);
END $function$;

-- 6) liff_list_repair_orders:草稿只回給申請人本人
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
          AND (ro.status <> '草稿' OR ro.requester_id = emp.id)   -- ★草稿只給申請人
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
