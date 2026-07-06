-- ════════════════════════════════════════════════════════════════════════════
-- 收緊 leave_balances 讀取：manager 不再看全部，改成只看自己
-- 2026-07-02
--
-- 背景：
--   leave_balances 有兩條 SELECT policy（OR 關係）：
--     - leave_bal_select              : is_admin() OR employee_id = self
--     - leave_balances_self_or_admin  : employee_id = self OR role IN (admin/super_admin/**manager**)
--   第二條把 manager 也放行看全部 → manager 繞過前端 UI 仍可讀全公司假別餘額。
--   前端已把 manager filter 成只看自己（20260702 假別餘額收緊），DB 讀取層對齊。
--
-- 改法：重建 leave_balances_self_or_admin，把 manager 從放行清單拿掉。
--   改完 SELECT 實際權限 = 兩條 OR = employee_id = self OR admin/super_admin。
--   寫入 policy（leave_balances_admin_write = admin/super_admin only）不動。
--
-- 冪等：DROP IF EXISTS + CREATE。current_employee_id/role 為既有 SECURITY DEFINER
--   helper（非 self-query 本表，無遞迴風險）。
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS leave_balances_self_or_admin ON public.leave_balances;

CREATE POLICY leave_balances_self_or_admin ON public.leave_balances
  FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT public.current_employee_id())
    OR (SELECT public.current_employee_role()) IN ('admin', 'super_admin')
  );

NOTIFY pgrst, 'reload schema';
