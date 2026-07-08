-- 修：projects / workflow_instances 的 SELECT 被 20260702610001 catch-all 改成 org 全可見
-- 2026-07-08
-- 根因：20260702610001_org_scope_catchall_tables（commit 2167a791, 2026-07-06）
--   迴圈對一票表 DROP 所有 policy + 建 org 全可見 <t>_org_sel_v2，
--   把 20260630150000 精心做的「參與者 scope」洗掉 → office_staff 看到全 org 專案/流程。
-- 修：撤 org 全可見的 _org_sel_v2，改回「只看自己參與的」（對齊 20260630150000）。
--   （寫入 _org_ins/upd/del_v2 與其他受災表另案處理）idempotent。

BEGIN;

-- ── projects：只看自己擁有/參與/有任務的 ──
DROP POLICY IF EXISTS projects_org_sel_v2 ON public.projects;
DROP POLICY IF EXISTS projects_sel         ON public.projects;
CREATE POLICY projects_sel ON public.projects FOR SELECT USING (
  is_admin() OR auth.role() = 'service_role'
  OR owner_id = current_employee_id()
  OR is_project_member(id)
  OR has_task_in_project(id)
);

-- ── workflow_instances：只看自己發起/被指派/申請/有任務的 ──
DROP POLICY IF EXISTS workflow_instances_org_sel_v2 ON public.workflow_instances;
DROP POLICY IF EXISTS workflow_instances_sel         ON public.workflow_instances;
CREATE POLICY workflow_instances_sel ON public.workflow_instances FOR SELECT USING (
  is_admin() OR auth.role() = 'service_role'
  OR started_by_id      = current_employee_id()
  OR target_employee_id = current_employee_id()
  OR applicant_emp_id   = current_employee_id()
  OR has_task_in_workflow(id)
);

COMMIT;
NOTIFY pgrst, 'reload schema';
