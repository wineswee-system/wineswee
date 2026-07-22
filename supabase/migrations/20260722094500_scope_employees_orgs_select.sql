-- 續前一支(org_visible)修正:employees 與 organizations 有各自的 SELECT policy,
-- 直接用 is_admin() / qual=true,未被 org_visible 涵蓋,導致 demo(org 2 admin)
-- 仍可讀取 org 1(威耀時代/Wineswee)的員工與組織名稱。
--
-- 修正原則一致:super_admin 保留跨 org;一般 admin 限縮在自己的 organization。

BEGIN;

-- 1) employees:重寫 SELECT policy,admin 改為「限本 org」,super_admin 保留跨 org
DROP POLICY IF EXISTS employees_select_v4 ON public.employees;
CREATE POLICY employees_select_v4 ON public.employees
FOR SELECT USING (
  (auth.role() = 'service_role')
  OR is_super_admin()
  OR (auth_user_id = auth.uid())
  OR (current_employee_role() IN ('admin','office_staff')
      AND organization_id = current_user_org_id())
  OR (current_employee_role() = 'manager'
      AND store_id = current_user_store_id())
  OR (current_employee_role() = 'store_staff'
      AND store_id = current_user_store_id())
);

-- 2) organizations:原本兩條 SELECT policy 皆 USING(true)(所有登入者看得到全部 org)。
--    收斂為:super_admin 全部;其他人只看自己的 org。保留 guest_qr_read(公開點餐)。
DROP POLICY IF EXISTS auth_organizations_select ON public.organizations;
DROP POLICY IF EXISTS auth_read_organizations ON public.organizations;
CREATE POLICY organizations_select_scoped ON public.organizations
FOR SELECT USING (
  (auth.role() = 'service_role')
  OR is_super_admin()
  OR id = current_user_org_id()
);

COMMIT;

NOTIFY pgrst, 'reload schema';
