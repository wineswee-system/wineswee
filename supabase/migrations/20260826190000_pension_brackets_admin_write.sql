-- 勞退級距表補 admin 寫入政策(對齊勞保/健保),讓「級距表管理」UI 可由 admin 維護
DROP POLICY IF EXISTS labor_pension_brackets_admin_write ON public.labor_pension_brackets;
CREATE POLICY labor_pension_brackets_admin_write ON public.labor_pension_brackets
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
