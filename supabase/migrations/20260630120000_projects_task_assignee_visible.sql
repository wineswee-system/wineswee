-- projects 可見性補：任務被指派人也能看到所屬的專案
-- 原 policy 只有 owner_id / is_project_member / admin，
-- 但專案任務的 assignee 不在名單 → 從儀表板點任務跳專案頁看不到內容。
-- 修法：加一條 OR：只要該員工有任何任務屬於這個 project，就能看到它。

DROP POLICY IF EXISTS projects_sel ON public.projects;
CREATE POLICY projects_sel ON public.projects FOR SELECT USING (
  is_admin() OR auth.role() = 'service_role'
  OR owner_id = current_employee_id()
  OR is_project_member(id)
  OR EXISTS (
    SELECT 1 FROM public.tasks
     WHERE tasks.project_id = projects.id
       AND tasks.assignee_id = current_employee_id()
  )
);

NOTIFY pgrst, 'reload schema';
