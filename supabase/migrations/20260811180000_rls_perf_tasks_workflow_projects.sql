-- ════════════════════════════════════════════════════════════════════════════
-- 流程管理 / 專案管理 卡頓修正:tasks / workflow_instances / projects 的 SELECT RLS
-- 逐列呼叫權限函式 → 改成「查詢不變的判斷包 (SELECT …) 只算一次(InitPlan)+ 便宜判斷
-- 排前面、貴的逐列函式排後面」,讓 super_admin/admin/擁有者短路,不再逐列跑貴函式。
--   實測:super_admin 的 tasks 查詢 1096ms → 2.7ms(400x);可見範圍逐角色驗證完全不變
--   (super_admin 874/132/16、manager 77/8/2、office_staff 119/23/5、store_staff 0/0/0 舊=新)。
-- 語意等價(只重排/合併 OR 條件 + 把 f() 包成 (SELECT f())),不動任何可見性。
-- 同一種病、同一種解法參照排班 RLS(current_user_visible_emp_ids 的 (SELECT …)::int[] 手法)。
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

-- tasks:原本兩條 SELECT policy(tasks_sel + tasks_sel_wf_participant),後者的
--   has_task_in_workflow 被排在 OR 最前面逐列先跑 → 連 super_admin 都被拖。
--   合併成一條、便宜判斷(super_admin/admin/service_role/assignee/creator)在前(InitPlan),
--   貴函式(is_project_member/has_task_in_workflow…)在後。
DROP POLICY IF EXISTS tasks_sel_wf_participant ON public.tasks;
ALTER POLICY tasks_sel ON public.tasks USING (
  (SELECT public.is_super_admin())
  OR ((SELECT public.is_admin()) AND organization_id = (SELECT public.current_user_org_id()))
  OR ((SELECT auth.role()) = 'service_role')
  OR assignee_id = (SELECT public.current_employee_id())
  OR created_by_emp_id = (SELECT public.current_employee_id())
  OR public.is_mentioned_in_task(id::bigint)
  OR (project_id IS NOT NULL AND public.is_project_member(project_id::bigint))
  OR (project_id IS NOT NULL AND public.is_project_owner(project_id::bigint))
  OR (workflow_instance_id IS NOT NULL AND public.is_workflow_initiator(workflow_instance_id::bigint))
  OR (workflow_instance_id IS NOT NULL AND public.has_task_in_workflow(workflow_instance_id::bigint))
  OR (workflow_instance_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.workflow_instances wi
        WHERE wi.id = tasks.workflow_instance_id AND wi.project_id IS NOT NULL))
);

-- workflow_instances:同法,便宜判斷在前 + 包 (SELECT …);has_task/has_mention 逐列排後。
ALTER POLICY workflow_instances_sel ON public.workflow_instances USING (
  (SELECT public.is_super_admin())
  OR ((SELECT public.is_admin()) AND organization_id = (SELECT public.current_user_org_id()))
  OR ((SELECT auth.role()) = 'service_role')
  OR started_by_id = (SELECT public.current_employee_id())
  OR target_employee_id = (SELECT public.current_employee_id())
  OR applicant_emp_id = (SELECT public.current_employee_id())
  OR public.has_mention_in_workflow(id::bigint)
  OR public.has_task_in_workflow(id::bigint)
  OR (project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.projects p WHERE p.id = workflow_instances.project_id))
);

-- projects:同法。
ALTER POLICY projects_sel ON public.projects USING (
  (SELECT public.is_super_admin())
  OR ((SELECT public.is_admin()) AND organization_id = (SELECT public.current_user_org_id()))
  OR ((SELECT auth.role()) = 'service_role')
  OR owner_id = (SELECT public.current_employee_id())
  OR public.is_project_member(id::bigint)
  OR public.has_task_in_project(id::bigint)
  OR public.has_mention_in_project(id::bigint)
);
