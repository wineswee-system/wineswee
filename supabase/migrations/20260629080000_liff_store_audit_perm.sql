-- ── LIFF 門市稽核獨立權限 liff.store_audit ──────────────────────────────────
-- 預設 admin/super_admin 可見；權限頁可個別開關給任何人

-- 1. 新增 liff.store_audit 權限碼（idempotent）
INSERT INTO public.permissions (code, name, module, is_active)
VALUES ('liff.store_audit', 'LIFF：門市稽核', 'LIFF', true)
ON CONFLICT (code) DO NOTHING;

-- 2. 預設授予 super_admin（1）+ admin（2）
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM (VALUES (1), (2)) AS rp(role_id)
CROSS JOIN public.permissions p
WHERE p.code = 'liff.store_audit'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions x
     WHERE x.role_id = rp.role_id AND x.permission_id = p.id
  );

-- 3. 更新 liff_get_employee_by_line_user：回傳 JSON 補上 can_store_audit
CREATE OR REPLACE FUNCTION public.liff_get_employee_by_line_user(p_line_user_id text)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    row_to_json(e.*)::jsonb
    || jsonb_build_object(
         'can_store_audit',
         public.liff_employee_has_permission(e.id, 'liff.store_audit')
       )
  )::json
  FROM employees e
  JOIN employee_line_accounts ela ON ela.employee_id = e.id
  WHERE ela.line_user_id = p_line_user_id
    AND e.status = '在職'
  ORDER BY ela.is_primary DESC, ela.id ASC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.liff_get_employee_by_line_user(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
