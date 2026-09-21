-- organizations 仍外洩:admin_write_organizations 是 FOR ALL,其 USING(role IN(admin,super_admin))
-- 同時授予 SELECT,使任一 org 的 admin(含 demo)看得到其他 org 的名稱。
-- 收斂:super_admin 全域;一般 admin 僅本 org(id = current_user_org_id())。

BEGIN;

DROP POLICY IF EXISTS admin_write_organizations ON public.organizations;
CREATE POLICY admin_write_organizations ON public.organizations FOR ALL
  USING (is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND id = current_user_org_id()))
  WITH CHECK (is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND id = current_user_org_id()));

COMMIT;

NOTIFY pgrst, 'reload schema';
