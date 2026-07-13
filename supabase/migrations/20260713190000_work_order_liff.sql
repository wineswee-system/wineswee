-- 跨部門工單 — LIFF RPC + 核心抽共用 — 2026-07-13
-- Web 用 current_employee_id() 認人、LIFF 用 line_user_id 認人 → 把 guard+更新邏輯抽成
-- 以 actor_id 為參數的核心 _wo_*，Web 與 LIFF 都當薄殼呼叫(避免兩邊邏輯漂移)。
-- 純加/取代自家函式,idempotent。

-- ── actor 小工具 ──
CREATE OR REPLACE FUNCTION public._wo_actor_is_admin(p_actor int)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employees e JOIN public.roles r ON r.id = e.role_id
                  WHERE e.id = p_actor AND r.name IN ('admin','super_admin'));
$$;
CREATE OR REPLACE FUNCTION public._wo_actor_dept(p_actor int)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department_id FROM public.employees WHERE id = p_actor;
$$;

-- ══ 核心（actor_id 版）══
CREATE OR REPLACE FUNCTION public._wo_create(
  p_actor int, p_target_department_id int, p_title text, p_description text,
  p_priority text, p_expected_due_date date, p_store_id int, p_assignee_id int, p_attachments jsonb
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp public.employees; v_row public.work_orders; v_dept text; v_tdept text; v_aname text;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF p_target_department_id IS NULL OR COALESCE(btrim(p_title),'') = '' THEN
    RETURN json_build_object('ok', false, 'error', 'MISSING_FIELDS'); END IF;
  SELECT * INTO v_emp FROM public.employees WHERE id = p_actor;
  SELECT name INTO v_dept  FROM public.departments WHERE id = v_emp.department_id;
  SELECT name INTO v_tdept FROM public.departments WHERE id = p_target_department_id;
  IF p_assignee_id IS NOT NULL THEN SELECT name INTO v_aname FROM public.employees WHERE id = p_assignee_id; END IF;
  INSERT INTO public.work_orders (
    organization_id, requester_id, requester_name, requester_department_id, requester_department_name,
    target_department_id, target_department_name, assignee_id, assignee_name,
    title, description, store_id, priority, expected_due_date, status, attachments
  ) VALUES (
    v_emp.organization_id, p_actor, v_emp.name, v_emp.department_id, v_dept,
    p_target_department_id, v_tdept, p_assignee_id, v_aname,
    btrim(p_title), COALESCE(p_description,''), p_store_id,
    COALESCE(NULLIF(p_priority,''),'medium'), p_expected_due_date, '待受理', COALESCE(p_attachments,'[]'::jsonb)
  ) RETURNING * INTO v_row;
  RETURN json_build_object('ok', true, 'id', v_row.id);
END $$;

CREATE OR REPLACE FUNCTION public._wo_accept(p_id int, p_actor int, p_assignee_id int, p_scheduled_due_date date)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders; v_assignee int; v_aname text;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (_wo_actor_is_admin(p_actor) OR _wo_actor_dept(p_actor) = v_wo.target_department_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_wo.status <> '待受理' THEN RETURN json_build_object('ok', false, 'error', 'NOT_PENDING'); END IF;
  v_assignee := COALESCE(p_assignee_id, v_wo.assignee_id, p_actor);
  SELECT name INTO v_aname FROM public.employees WHERE id = v_assignee;
  UPDATE public.work_orders
     SET assignee_id = v_assignee, assignee_name = v_aname,
         scheduled_due_date = COALESCE(p_scheduled_due_date, scheduled_due_date, expected_due_date),
         status = '處理中', accepted_at = now(), updated_at = now()
   WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '處理中');
END $$;

CREATE OR REPLACE FUNCTION public._wo_complete(p_id int, p_actor int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (_wo_actor_is_admin(p_actor) OR v_wo.assignee_id = p_actor OR _wo_actor_dept(p_actor) = v_wo.target_department_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_wo.status <> '處理中' THEN RETURN json_build_object('ok', false, 'error', 'NOT_IN_PROGRESS'); END IF;
  UPDATE public.work_orders SET status = '已完成', completed_at = now(), updated_at = now() WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '已完成');
END $$;

CREATE OR REPLACE FUNCTION public._wo_confirm(p_id int, p_actor int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (_wo_actor_is_admin(p_actor) OR v_wo.requester_id = p_actor) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_wo.status <> '已完成' THEN RETURN json_build_object('ok', false, 'error', 'NOT_COMPLETED'); END IF;
  UPDATE public.work_orders SET status = '已結案', confirmed_at = now(), updated_at = now() WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '已結案');
END $$;

CREATE OR REPLACE FUNCTION public._wo_reject(p_id int, p_actor int, p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (_wo_actor_is_admin(p_actor) OR _wo_actor_dept(p_actor) = v_wo.target_department_id OR v_wo.assignee_id = p_actor) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_wo.status NOT IN ('待受理','處理中') THEN RETURN json_build_object('ok', false, 'error', 'BAD_STATUS'); END IF;
  UPDATE public.work_orders
     SET status = '已退回', reject_reason = COALESCE(NULLIF(btrim(p_reason),''), '(未填原因)'), updated_at = now()
   WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '已退回');
END $$;

CREATE OR REPLACE FUNCTION public._wo_delete(p_id int, p_actor int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (_wo_actor_is_admin(p_actor) OR v_wo.requester_id = p_actor) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_wo.status NOT IN ('待受理','已退回') THEN RETURN json_build_object('ok', false, 'error', 'BAD_STATUS'); END IF;
  UPDATE public.work_orders SET deleted_at = now(), updated_at = now() WHERE id = p_id;
  RETURN json_build_object('ok', true);
END $$;

-- ══ Web 薄殼(取代原版,改為 delegate 核心)══
CREATE OR REPLACE FUNCTION public.create_work_order(
  p_target_department_id int, p_title text, p_description text,
  p_priority text DEFAULT 'medium', p_expected_due_date date DEFAULT NULL,
  p_store_id int DEFAULT NULL, p_assignee_id int DEFAULT NULL, p_attachments jsonb DEFAULT '[]'::jsonb
) RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._wo_create(public.current_employee_id(), p_target_department_id, p_title, p_description,
                           p_priority, p_expected_due_date, p_store_id, p_assignee_id, p_attachments);
$$;
CREATE OR REPLACE FUNCTION public.accept_work_order(p_id int, p_assignee_id int DEFAULT NULL, p_scheduled_due_date date DEFAULT NULL)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._wo_accept(p_id, public.current_employee_id(), p_assignee_id, p_scheduled_due_date);
$$;
CREATE OR REPLACE FUNCTION public.complete_work_order(p_id int)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._wo_complete(p_id, public.current_employee_id());
$$;
CREATE OR REPLACE FUNCTION public.confirm_work_order(p_id int)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._wo_confirm(p_id, public.current_employee_id());
$$;
CREATE OR REPLACE FUNCTION public.reject_work_order(p_id int, p_reason text)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._wo_reject(p_id, public.current_employee_id(), p_reason);
$$;
CREATE OR REPLACE FUNCTION public.delete_work_order(p_id int)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._wo_delete(p_id, public.current_employee_id());
$$;

-- ══ LIFF 薄殼(line_user_id 認人)══
CREATE OR REPLACE FUNCTION public.liff_list_work_orders(p_line_user_id text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE emp public.employees; v_dept int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  v_dept := emp.department_id;
  RETURN json_build_object('ok', true, 'me',
    json_build_object('id', emp.id, 'department_id', emp.department_id, 'name', emp.name),
    'orders', (
      SELECT COALESCE(json_agg(row_to_json(w.*) ORDER BY w.id DESC), '[]'::json)
      FROM public.work_orders w
      WHERE w.deleted_at IS NULL
        AND (w.requester_id = emp.id OR w.assignee_id = emp.id
             OR (v_dept IS NOT NULL AND w.target_department_id = v_dept)
             OR (v_dept IS NOT NULL AND w.requester_department_id = v_dept))
    ));
END $$;

CREATE OR REPLACE FUNCTION public.liff_get_work_order(p_line_user_id text, p_id int)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE emp public.employees; v_dept int; v_wo public.work_orders;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  v_dept := emp.department_id;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id AND deleted_at IS NULL;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (_wo_actor_is_admin(emp.id) OR v_wo.requester_id = emp.id OR v_wo.assignee_id = emp.id
          OR v_dept = v_wo.target_department_id OR v_dept = v_wo.requester_department_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  RETURN json_build_object('ok', true,
    'me', json_build_object('id', emp.id, 'department_id', emp.department_id),
    'order', row_to_json(v_wo.*));
END $$;

CREATE OR REPLACE FUNCTION public.liff_create_work_order(
  p_line_user_id text, p_target_department_id int, p_title text, p_description text,
  p_priority text DEFAULT 'medium', p_expected_due_date date DEFAULT NULL,
  p_store_id int DEFAULT NULL, p_assignee_id int DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  RETURN public._wo_create(emp.id, p_target_department_id, p_title, p_description,
                           p_priority, p_expected_due_date, p_store_id, p_assignee_id, '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.liff_accept_work_order(p_line_user_id text, p_id int, p_assignee_id int DEFAULT NULL, p_scheduled_due_date date DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  RETURN public._wo_accept(p_id, emp.id, p_assignee_id, p_scheduled_due_date);
END $$;

CREATE OR REPLACE FUNCTION public.liff_complete_work_order(p_line_user_id text, p_id int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  RETURN public._wo_complete(p_id, emp.id);
END $$;

CREATE OR REPLACE FUNCTION public.liff_confirm_work_order(p_line_user_id text, p_id int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  RETURN public._wo_confirm(p_id, emp.id);
END $$;

CREATE OR REPLACE FUNCTION public.liff_reject_work_order(p_line_user_id text, p_id int, p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  RETURN public._wo_reject(p_id, emp.id, p_reason);
END $$;

-- grants
GRANT EXECUTE ON FUNCTION public.liff_list_work_orders(text)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_get_work_order(text, int)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_create_work_order(text, int, text, text, text, date, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_accept_work_order(text, int, int, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_complete_work_order(text, int)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_confirm_work_order(text, int)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_reject_work_order(text, int, text)     TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
