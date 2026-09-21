-- ════════════════════════════════════════════════════════════════════════════
-- 任務/流程歸「工作項目」類別：只有參與者 + admin 看得到（主管不自動看下屬的）
-- 2026-06-18
--
-- 框架修正:存取分類別,任務/流程屬「② 工作項目」= 只有參與者(指派/建立/擁有/成員/發起/
--   目標)+ admin。原本誤用 can_see_request(那是「① 個人/HR」類別,含主管鏈+課督導+HR)
--   → 害主管/HR 看到全部任務/流程。本支改成嚴格參與者。
--   (專案 projects 本來就是參與者制,正確,不動。個人/HR 申請表續用 can_see_request。)
--
-- 詳見 docs/rls-access-framework.md。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- tasks：指派人 / 建立者 / 同專案成員 / admin（移除 can_see_request → 不再含主管鏈/HR）
DROP POLICY IF EXISTS tasks_sel ON public.tasks;
CREATE POLICY tasks_sel ON public.tasks FOR SELECT USING (
  is_admin() OR auth.role()='service_role'
  OR assignee_id = current_employee_id()
  OR created_by_emp_id = current_employee_id()
  OR (project_id IS NOT NULL AND is_project_member(project_id))
);

-- workflow_instances：發起人 / 目標員工 / 申請人 / admin（移除 can_see_request 的主管鏈分支）
DROP POLICY IF EXISTS workflow_instances_sel ON public.workflow_instances;
CREATE POLICY workflow_instances_sel ON public.workflow_instances FOR SELECT USING (
  is_admin() OR auth.role()='service_role'
  OR started_by_id = current_employee_id()
  OR target_employee_id = current_employee_id()
  OR applicant_emp_id = current_employee_id()
);

COMMIT;

NOTIFY pgrst, 'reload schema';
