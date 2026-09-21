-- 2026-08-14 跨部門工單附件(Q5):走 form_attachments(form_type='work_order'),放寬檔型(前端 accept)。
--   Web 直插(authenticated);LIFF anon 走此 DEFINER RPC。liff_get_work_order 回傳附件供詳情顯示。

CREATE OR REPLACE FUNCTION public.liff_add_work_order_attachment(
  p_line_user_id text, p_id int, p_storage_path text, p_file_name text, p_file_size bigint, p_mime_type text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees; v_wo public.work_orders; v_dept int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  v_dept := emp.department_id;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id AND deleted_at IS NULL;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (public._wo_actor_is_admin(emp.id) OR v_wo.requester_id = emp.id OR v_wo.assignee_id = emp.id
          OR v_dept = v_wo.target_department_id OR v_dept = v_wo.requester_department_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  INSERT INTO public.form_attachments (
    form_type, form_id, organization_id, storage_bucket, storage_path,
    file_name, file_size, mime_type, uploaded_by_id, uploaded_by
  ) VALUES (
    'work_order', p_id, v_wo.organization_id, 'attachments', p_storage_path,
    p_file_name, p_file_size, p_mime_type, emp.id, emp.name
  );
  RETURN json_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.liff_get_work_order(p_line_user_id text, p_id integer)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
    'order', row_to_json(v_wo.*),
    'attachments', COALESCE((SELECT json_agg(json_build_object('id', fa.id, 'file_name', fa.file_name,
                            'storage_bucket', fa.storage_bucket, 'storage_path', fa.storage_path, 'mime_type', fa.mime_type))
             FROM public.form_attachments fa WHERE fa.form_type = 'work_order' AND fa.form_id = p_id), '[]'::json));
END $function$;

GRANT EXECUTE ON FUNCTION public.liff_add_work_order_attachment(text,int,text,text,bigint,text) TO anon, authenticated;
