  -- ════════════════════════════════════════════════════════════════════════════
  -- 權限：費用申請-檢視全部人 (expense.view_all)
  -- 2026-06-24
  --
  -- 現況：expense_requests SELECT RLS = can_see_request(本人/主管鏈/店長/admin)。
  -- 需求：給特定人(非 admin)開「看得到全公司費用申請」的權限,在權限頁逐個授予。
  -- 做法：① current-user 權限檢查 helper(含角色+個人override,沿用 liff_employee_has_permission)
  --       ② expense_requests 多加一條 permissive SELECT policy「有此權限就放行」
  --          (RLS 多條 FOR SELECT 是 OR;不動既有 can_see_request policy)
  -- 純加法、idempotent。
  -- ════════════════════════════════════════════════════════════════════════════

  BEGIN;

  -- ── 1. 權限定義(權限頁/override 需此列才能 toggle) ──
  INSERT INTO public.permissions (code, name, module, is_active) VALUES
    ('expense.view_all', '費用申請-檢視全部人', '行政庶務', true)
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, module = EXCLUDED.module, is_active = EXCLUDED.is_active;

  -- admin / super_admin 預設開(他們本來就靠 is_admin 看得到全部;授予只為權限頁顯示一致)
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM public.roles r, public.permissions p
  WHERE r.name IN ('super_admin', 'admin')
    AND p.code = 'expense.view_all'
  ON CONFLICT DO NOTHING;

  -- ── 2. current-user 權限檢查(RLS 用) ──
  CREATE OR REPLACE FUNCTION public.current_employee_has_permission(p_code text)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT CASE
      WHEN auth.role() = 'service_role' THEN true
      ELSE COALESCE(public.liff_employee_has_permission(public.current_employee_id(), p_code), false)
    END;
  $$;
  GRANT EXECUTE ON FUNCTION public.current_employee_has_permission(text) TO authenticated, anon;

  -- ── 3. expense_requests 多一條 SELECT policy:有 expense.view_all 就看得到全部 ──
  DROP POLICY IF EXISTS expense_requests_viewall_sel ON public.expense_requests;
  CREATE POLICY expense_requests_viewall_sel ON public.expense_requests
    FOR SELECT USING (public.current_employee_has_permission('expense.view_all'));

  COMMIT;

  NOTIFY pgrst, 'reload schema';
