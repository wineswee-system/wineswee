-- 修:workflow_instances SELECT policy 加回「本人(發起/申請/目標)直接可見」
-- 原因:08-11 RLS 重寫後 SELECT 只靠 _my_visible_workflow_ids()(STABLE,看不到剛 insert 的新列)
--   → 前端 .insert().select()(INSERT...RETURNING) 讀不回新列 → 非 admin 一律「建立失敗 RLS」。
DROP POLICY IF EXISTS workflow_instances_sel ON public.workflow_instances;
CREATE POLICY workflow_instances_sel ON public.workflow_instances FOR SELECT USING (
   (SELECT public.is_super_admin())
   OR ((SELECT public.is_admin()) AND organization_id = (SELECT public.current_user_org_id()))
   OR (SELECT auth.role()) = 'service_role'
   OR started_by_id      = (SELECT public.current_employee_id())
   OR applicant_emp_id   = (SELECT public.current_employee_id())
   OR target_employee_id = (SELECT public.current_employee_id())
   OR id = ANY ((SELECT public._my_visible_workflow_ids())::bigint[])
);
