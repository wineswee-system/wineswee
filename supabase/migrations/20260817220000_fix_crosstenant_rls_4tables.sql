-- Phase 0 修:4 表 RLS 只檢查角色/門市、沒檢查 org → 跨租戶洩漏(讀+寫)。
-- 統一:限縮成「同 org 才給」+ is_super_admin() 才跨 org(support 用);常數函式包 (SELECT ) 保 InitPlan。

-- ── schedules(SELECT/INSERT/UPDATE/DELETE) ──
ALTER POLICY schedules_v_sel ON public.schedules
  USING (
    (organization_id = (SELECT current_employee_org())
     AND ((SELECT _emp_sees_all_stores(current_employee_id()))
          OR employee_id = ANY((SELECT current_user_visible_emp_ids())::integer[])))
    OR (SELECT is_super_admin())
  );
ALTER POLICY schedules_v_write_ins ON public.schedules
  WITH CHECK (
    (organization_id = (SELECT current_employee_org())
     AND (can_manage_emp_store(employee_id, employee) OR supervisor_can_schedule_emp(employee_id, employee)
          OR (SELECT _emp_sees_all_stores(current_employee_id())) OR perm_edit_can_schedule_emp(employee_id, employee)))
    OR (SELECT is_super_admin())
  );
ALTER POLICY schedules_v_write_upd ON public.schedules
  USING (
    (organization_id = (SELECT current_employee_org())
     AND (can_manage_emp_store(employee_id, employee) OR supervisor_can_schedule_emp(employee_id, employee)
          OR (SELECT _emp_sees_all_stores(current_employee_id())) OR perm_edit_can_schedule_emp(employee_id, employee)))
    OR (SELECT is_super_admin())
  )
  WITH CHECK (
    (organization_id = (SELECT current_employee_org())
     AND (can_manage_emp_store(employee_id, employee) OR supervisor_can_schedule_emp(employee_id, employee)
          OR (SELECT _emp_sees_all_stores(current_employee_id())) OR perm_edit_can_schedule_emp(employee_id, employee)))
    OR (SELECT is_super_admin())
  );
ALTER POLICY schedules_v_write_del ON public.schedules
  USING (
    (organization_id = (SELECT current_employee_org())
     AND (can_manage_emp_store(employee_id, employee) OR supervisor_can_schedule_emp(employee_id, employee)
          OR (SELECT _emp_sees_all_stores(current_employee_id())) OR perm_edit_can_schedule_emp(employee_id, employee)))
    OR (SELECT is_super_admin())
  );

-- ── employee_insurance_events ──
ALTER POLICY ins_events_sel ON public.employee_insurance_events
  USING (
    (organization_id = (SELECT current_employee_org()) AND ((SELECT is_staff()) OR employee_id = (SELECT current_employee_id())))
    OR (SELECT is_super_admin()) OR (SELECT auth.role()) = 'service_role'
  );
ALTER POLICY ins_events_write ON public.employee_insurance_events
  USING (
    (organization_id = (SELECT current_employee_org()) AND (SELECT is_staff()))
    OR (SELECT is_super_admin()) OR (SELECT auth.role()) = 'service_role'
  )
  WITH CHECK (
    (organization_id = (SELECT current_employee_org()) AND (SELECT is_staff()))
    OR (SELECT is_super_admin()) OR (SELECT auth.role()) = 'service_role'
  );

-- ── disaster_days(拿掉「任何 admin」blanket bypass,收成同 org) ──
ALTER POLICY disaster_days_read ON public.disaster_days
  USING (organization_id = (SELECT current_employee_org()) OR (SELECT is_super_admin()));
ALTER POLICY disaster_days_write ON public.disaster_days
  USING (
    (organization_id = (SELECT current_employee_org()) AND (SELECT current_employee_role()) = ANY (ARRAY['admin','super_admin']))
    OR (SELECT is_super_admin())
  )
  WITH CHECK (
    (organization_id = (SELECT current_employee_org()) AND (SELECT current_employee_role()) = ANY (ARRAY['admin','super_admin']))
    OR (SELECT is_super_admin())
  );

-- ── line_channels ──
ALTER POLICY line_channels_admin ON public.line_channels
  USING (
    (organization_id = (SELECT current_employee_org()) AND (SELECT is_admin()))
    OR (SELECT is_super_admin()) OR (SELECT auth.role()) = 'service_role'
  )
  WITH CHECK (
    (organization_id = (SELECT current_employee_org()) AND (SELECT is_admin()))
    OR (SELECT is_super_admin()) OR (SELECT auth.role()) = 'service_role'
  );
