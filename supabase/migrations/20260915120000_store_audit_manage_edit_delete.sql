
-- ① 權限碼 + 授權 admin
INSERT INTO public.permissions (code, name, module, is_system, is_active)
SELECT 'store_audit.manage', '門市稽核：管理(編輯/退回/刪除)', '門市稽核', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.permissions WHERE code='store_audit.manage');

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 2, p.id FROM public.permissions p
WHERE p.code='store_audit.manage'
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id=2 AND rp.permission_id=p.id);

-- ② 退回草稿(可處理已核准);權限:manage 或 admin/super
CREATE OR REPLACE FUNCTION public.reopen_store_audit(p_audit_id integer)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_audit public.store_audits;
BEGIN
  SELECT * INTO v_audit FROM public.store_audits WHERE id=p_audit_id;
  IF v_audit.id IS NULL THEN RETURN json_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF NOT public.is_super_admin() AND v_audit.organization_id IS DISTINCT FROM public.current_employee_org() THEN
    RETURN json_build_object('ok',false,'error','FORBIDDEN'); END IF;
  IF NOT (public.is_super_admin() OR public.is_admin() OR public.current_employee_has_permission('store_audit.manage')) THEN
    RETURN json_build_object('ok',false,'error','NO_PERMISSION'); END IF;
  IF v_audit.status='草稿' THEN RETURN json_build_object('ok',true,'status','草稿'); END IF;
  UPDATE public.store_audits SET status='草稿', submitted_at=NULL, approved_at=NULL, approver=NULL,
    reject_reason=NULL, current_step=0 WHERE id=p_audit_id;
  RETURN json_build_object('ok',true,'status','草稿');
END $fn$;

-- ③ 刪除(任何狀態);權限:manage 或 admin/super。獎金sync已停用不需反向。
CREATE OR REPLACE FUNCTION public.admin_delete_store_audit(p_audit_id integer)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_audit public.store_audits;
BEGIN
  SELECT * INTO v_audit FROM public.store_audits WHERE id=p_audit_id;
  IF v_audit.id IS NULL THEN RETURN json_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF NOT public.is_super_admin() AND v_audit.organization_id IS DISTINCT FROM public.current_employee_org() THEN
    RETURN json_build_object('ok',false,'error','FORBIDDEN'); END IF;
  IF NOT (public.is_super_admin() OR public.is_admin() OR public.current_employee_has_permission('store_audit.manage')) THEN
    RETURN json_build_object('ok',false,'error','NO_PERMISSION'); END IF;
  DELETE FROM public.store_audit_items WHERE audit_id=p_audit_id;
  DELETE FROM public.store_audit_on_duty WHERE audit_id=p_audit_id;
  DELETE FROM public.store_audits WHERE id=p_audit_id;
  RETURN json_build_object('ok',true,'id',p_audit_id);
END $fn$;

REVOKE ALL ON FUNCTION public.reopen_store_audit(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_store_audit(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_store_audit(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_store_audit(integer) TO authenticated;
