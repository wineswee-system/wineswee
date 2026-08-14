-- 2026-08-14 維修單 LIFF 附件:anon 不能直插 form_attachments(RLS 要 auth.uid)→ DEFINER RPC 寫 metadata。
--   前端先 supabase.storage.from('attachments').upload(path) 再呼叫此 RPC(比照 liff_insert_expense_request_attachment)。

CREATE OR REPLACE FUNCTION public.liff_add_repair_order_attachment(
  p_line_user_id text, p_id int, p_storage_path text, p_file_name text, p_file_size bigint, p_mime_type text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp public.employees; v_ro public.repair_orders;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  SELECT * INTO v_ro FROM public.repair_orders WHERE id = p_id AND deleted_at IS NULL;
  IF v_ro.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (public._wo_actor_is_admin(emp.id) OR v_ro.requester_id = emp.id OR v_ro.requester_department_id = emp.department_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  INSERT INTO public.form_attachments (
    form_type, form_id, organization_id, storage_bucket, storage_path,
    file_name, file_size, mime_type, uploaded_by_id, uploaded_by
  ) VALUES (
    'repair_order', p_id, v_ro.organization_id, 'attachments', p_storage_path,
    p_file_name, p_file_size, p_mime_type, emp.id, emp.name
  );
  RETURN json_build_object('ok', true);
END $function$;

-- liff_get_repair_order 加回傳附件
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
             FROM public.expense_requests er WHERE er.repair_order_id = p_id AND er.deleted_at IS NULL), '[]'::json),
    'attachments', COALESCE((SELECT json_agg(json_build_object('id', fa.id, 'file_name', fa.file_name,
                            'storage_bucket', fa.storage_bucket, 'storage_path', fa.storage_path, 'mime_type', fa.mime_type))
             FROM public.form_attachments fa WHERE fa.form_type = 'repair_order' AND fa.form_id = p_id), '[]'::json)
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.liff_add_repair_order_attachment(text,int,text,text,bigint,text) TO anon, authenticated;
