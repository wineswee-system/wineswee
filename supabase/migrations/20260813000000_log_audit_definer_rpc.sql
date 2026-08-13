-- 2026-08-13 前端稽核(auditLogger.js)直接 insert audit_logs 走 authenticated 角色 → 吃 audit_logs 的
--   INSERT RLS(只放行 admin/super_admin/service_role)→ 非 admin 使用者編輯時自訂稽核被擋(42501),
--   欄位級變更稽核對非admin漏記。改走 SECURITY DEFINER RPC 繞過 RLS(對齊「敏感寫入走DEFINER RPC」慣例)。
-- 安全:限已登入(auth.uid());org 未帶則補 caller 的 current_employee_org();收 anon(REVOKE PUBLIC)。
CREATE OR REPLACE FUNCTION public.log_audit(p_entries jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN RETURN; END IF;

  INSERT INTO public.audit_logs
    ("user", action, target, target_table, target_id, field_name, old_value, new_value, ip, organization_id)
  SELECT
    COALESCE(NULLIF(e->>'user',''), '(unknown)'),
    e->>'action',
    e->>'target',
    e->>'target_table',
    NULLIF(e->>'target_id','')::int,
    e->>'field_name',
    e->>'old_value',
    e->>'new_value',
    e->>'ip',
    COALESCE(NULLIF(e->>'organization_id','')::int, public.current_employee_org())
  FROM jsonb_array_elements(p_entries) AS e;
END $function$;

REVOKE ALL ON FUNCTION public.log_audit(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_audit(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_audit(jsonb) TO authenticated;
