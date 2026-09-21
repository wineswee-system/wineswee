-- ════════════════════════════════════════════════════════════════════════════
-- 裝潢報價權限:renovation.manage(預設只 admin/super_admin;權限頁可逐人開)
-- 2026-08-11
--   對齊收款 collection.manage 的做法:單一權限碼 = 一個開關 = 全功能(看+記+刪)。
--   兩張裝潢表 RLS 改成需 renovation.manage;不只藏 UI,DB 層也真的鎖。idempotent。
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

INSERT INTO public.permissions (code, name, module, is_active) VALUES
  ('renovation.manage', '裝潢報價', '裝潢工程', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, module = EXCLUDED.module, is_active = EXCLUDED.is_active;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.name IN ('super_admin', 'admin')
  AND p.code = 'renovation.manage'
ON CONFLICT DO NOTHING;

-- RLS:2 張裝潢表改成需 renovation.manage(讀/寫皆要)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['renovation_quotes','renovation_quote_payments']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.current_employee_has_permission(''renovation.manage'') AND org_visible(organization_id))', t || '_sel', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.current_employee_has_permission(''renovation.manage'') AND organization_id = current_employee_org())', t || '_ins', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (public.current_employee_has_permission(''renovation.manage'') AND organization_id = current_employee_org()) WITH CHECK (organization_id = current_employee_org())', t || '_upd', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_del', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (public.current_employee_has_permission(''renovation.manage'') AND organization_id = current_employee_org())', t || '_del', t);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
