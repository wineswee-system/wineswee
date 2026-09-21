
CREATE OR REPLACE FUNCTION public.liff_reopen_store_audit(p_line_user_id text, p_id integer)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees; v_audit public.store_audits;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok',false,'error','EMPLOYEE_NOT_FOUND'); END IF;
  SELECT * INTO v_audit FROM public.store_audits WHERE id=p_id;
  IF v_audit.id IS NULL THEN RETURN json_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF v_audit.organization_id IS DISTINCT FROM emp.organization_id THEN RETURN json_build_object('ok',false,'error','FORBIDDEN'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'store_audit.manage') THEN RETURN json_build_object('ok',false,'error','NO_PERMISSION'); END IF;
  IF v_audit.status='草稿' THEN RETURN json_build_object('ok',true,'status','草稿'); END IF;
  UPDATE public.store_audits SET status='草稿', submitted_at=NULL, approved_at=NULL, approver=NULL, reject_reason=NULL, current_step=0 WHERE id=p_id;
  RETURN json_build_object('ok',true,'status','草稿');
END $fn$;

CREATE OR REPLACE FUNCTION public.liff_delete_store_audit(p_line_user_id text, p_id integer)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees; v_audit public.store_audits;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok',false,'error','EMPLOYEE_NOT_FOUND'); END IF;
  SELECT * INTO v_audit FROM public.store_audits WHERE id=p_id;
  IF v_audit.id IS NULL THEN RETURN json_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF v_audit.organization_id IS DISTINCT FROM emp.organization_id THEN RETURN json_build_object('ok',false,'error','FORBIDDEN'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'store_audit.manage') THEN RETURN json_build_object('ok',false,'error','NO_PERMISSION'); END IF;
  DELETE FROM public.store_audit_items WHERE audit_id=p_id;
  DELETE FROM public.store_audit_on_duty WHERE audit_id=p_id;
  DELETE FROM public.store_audits WHERE id=p_id;
  RETURN json_build_object('ok',true,'id',p_id);
END $fn$;

GRANT EXECUTE ON FUNCTION public.liff_reopen_store_audit(text,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_delete_store_audit(text,integer) TO anon, authenticated;
