-- 隔離總整收尾:前一支後仍殘留 3 個洩漏來源(leave_balances / purchase_orders / schedules)。
-- 原因:(a) leave_balances、purchase_orders 尚有其他 ALL/SELECT policy 用全域 admin;
--       (b) can_manage_store() 內建全域 IF is_admin() THEN true,schedules 經 can_manage_emp_store 落到它。

BEGIN;

-- 1) can_manage_store:super_admin 全域;admin 僅本 org 門市;店長/督導不變
CREATE OR REPLACE FUNCTION public.can_manage_store(p_store_id bigint)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me int := current_employee_id();
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_super_admin() THEN RETURN true; END IF;
  IF v_me IS NULL OR p_store_id IS NULL THEN RETURN false; END IF;
  IF is_admin() AND EXISTS (SELECT 1 FROM stores s WHERE s.id = p_store_id AND s.organization_id = current_user_org_id()) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM stores s WHERE s.id = p_store_id AND s.manager_id = v_me) THEN RETURN true; END IF;
  IF EXISTS (
    SELECT 1 FROM stores st JOIN department_sections ds ON ds.id = st.section_id
     WHERE st.id = p_store_id AND ds.supervisor_id = v_me
  ) THEN RETURN true; END IF;
  RETURN false;
END $$;

-- 2) leave_balances:剩餘 policy 一併收斂
DROP POLICY IF EXISTS leave_balances_self_or_admin ON public.leave_balances;
CREATE POLICY leave_balances_self_or_admin ON public.leave_balances FOR SELECT
  USING (employee_id = current_employee_id() OR is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org()));
DROP POLICY IF EXISTS leave_balances_admin_write ON public.leave_balances;
CREATE POLICY leave_balances_admin_write ON public.leave_balances FOR ALL
  USING (is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org()))
  WITH CHECK (is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org()));
DROP POLICY IF EXISTS leave_bal_update ON public.leave_balances;
CREATE POLICY leave_bal_update ON public.leave_balances FOR UPDATE
  USING (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()))
  WITH CHECK (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()));
DROP POLICY IF EXISTS leave_bal_delete ON public.leave_balances;
CREATE POLICY leave_bal_delete ON public.leave_balances FOR DELETE
  USING (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()));
DROP POLICY IF EXISTS org_scope_modify_leave_balances ON public.leave_balances;
CREATE POLICY org_scope_modify_leave_balances ON public.leave_balances FOR UPDATE
  USING (organization_id = current_employee_org() OR is_super_admin())
  WITH CHECK (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_delete_leave_balances ON public.leave_balances;
CREATE POLICY org_scope_delete_leave_balances ON public.leave_balances FOR DELETE
  USING (organization_id = current_employee_org() OR is_super_admin());

-- 3) purchase_orders:ALL 寫入 policy 的 USING 會外洩 SELECT → 收斂
DROP POLICY IF EXISTS admin_write_purchase_orders ON public.purchase_orders;
CREATE POLICY admin_write_purchase_orders ON public.purchase_orders FOR ALL
  USING (is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_user_org_id()))
  WITH CHECK (is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_user_org_id()));

COMMIT;

NOTIFY pgrst, 'reload schema';
