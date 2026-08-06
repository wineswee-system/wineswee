-- ════════════════════════════════════════════════════════════════════════════
-- 收款權限：collection.manage（鎖 admin 以上；權限頁可逐人開，開了完整能用）
-- 2026-08-06
--
-- 需求：收款(訂金/加盟金)預設只有 admin/super_admin 看得到；權限頁做一個開關，
--   對個別員工開啟後就完整能用(看+記+刪)。單一權限碼 = 一個開關 = 全功能。
--
-- 作法：
--   1) 新增權限碼 collection.manage，預設 grant 給 super_admin/admin
--      → 前端 hasPermission('collection.manage') + 權限頁 FEATURES 一列開關。
--   2) 把 6 張收款表的 RLS 全部改成「要有 collection.manage 才能讀/寫」
--      → 不只藏 UI，DB 層也真的鎖(沒權限直接 0 列 / 寫入被擋)。
--      內部 recalc trigger 是 SECURITY DEFINER 繞 RLS，不受影響。
-- 依賴 current_employee_has_permission()（既有，見 20260709180000 等）。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.permissions (code, name, module, is_active) VALUES
  ('collection.manage', '收款（訂金 / 加盟金）', '收款', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, module = EXCLUDED.module, is_active = EXCLUDED.is_active;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.name IN ('super_admin', 'admin')
  AND p.code = 'collection.manage'
ON CONFLICT DO NOTHING;

-- RLS：6 張收款表全部改成需 collection.manage（讀/寫皆要）
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['collection_investors','deposit_records','deposit_payments','franchise_fees','franchise_fee_investors','franchise_fee_payments']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.current_employee_has_permission(''collection.manage'') AND org_visible(organization_id))', t || '_sel', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.current_employee_has_permission(''collection.manage'') AND organization_id = current_employee_org())', t || '_ins', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (public.current_employee_has_permission(''collection.manage'') AND organization_id = current_employee_org()) WITH CHECK (organization_id = current_employee_org())', t || '_upd', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_del', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (public.current_employee_has_permission(''collection.manage'') AND organization_id = current_employee_org())', t || '_del', t);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
