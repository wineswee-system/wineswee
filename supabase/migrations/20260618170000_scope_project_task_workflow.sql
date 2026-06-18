-- ════════════════════════════════════════════════════════════════════════════
-- 流程/專案/任務 可見性：只看「自己參與的」(非 admin 不再看到全部人的)
-- 2026-06-18
--
-- 背景：測試發現非 admin 看得到別人的 流程/專案/任務。原因:projects 被 20260618100000
--   設成 org_visible(全 org 看光);tasks/workflow_instances 沒鎖(RLS 未開或無 policy)。
--   這三類應該「自己參與的才看得到」。
--
-- READ scope（SELECT）：
--   projects            : admin / 本人是 owner / 本人是 project_members
--   tasks               : admin / 指派人鏈(can_see_request(assignee)) / 建立者 / 同專案成員
--   workflow_instances  : admin / 發起人 / 目標員工 / 申請人 / 目標員工的主管鏈
--   project_members     : admin / 本人 / 同專案成員
--   （admin/super_admin 與 service_role 一律放行）
--
-- WRITE：維持 org_visible(同 org)+ set_org_default trigger。任務引擎走 SECURITY DEFINER
--   RPC(liff_complete_task_v2 等)繞 RLS，不受影響。
--
-- idempotent：DROP 每表所有 policy 再重建；CREATE OR REPLACE helper；BEGIN/COMMIT。
-- 依賴 20260618100000/110000 的 helper(org_visible/can_see_request/set_org_default)。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 本人是否為某專案成員（SECURITY DEFINER 避免 policy 跨表撞 RLS）
CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members pm
     WHERE pm.project_id = p_project_id AND pm.employee_id = current_employee_id()
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_project_member(bigint) TO authenticated, anon;

-- 共用：確保有 org 的表 INSERT 自動補 org + 寫 = org_visible
-- (這裡逐表手寫 SELECT scope，故不用通用迴圈)

-- ── projects ──────────────────────────────────────────────────────────────
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
SELECT public._drop_all_policies('projects');
DROP TRIGGER IF EXISTS trg_set_org_default ON public.projects;
CREATE TRIGGER trg_set_org_default BEFORE INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_org_default();
CREATE POLICY projects_sel ON public.projects FOR SELECT USING (
  is_admin() OR auth.role()='service_role'
  OR owner_id = current_employee_id()
  OR is_project_member(id)
);
CREATE POLICY projects_ins ON public.projects FOR INSERT WITH CHECK (org_visible(organization_id));
CREATE POLICY projects_upd ON public.projects FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (org_visible(organization_id));
CREATE POLICY projects_del ON public.projects FOR DELETE USING (org_visible(organization_id));

-- ── project_members ───────────────────────────────────────────────────────
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
SELECT public._drop_all_policies('project_members');
DROP TRIGGER IF EXISTS trg_set_org_default ON public.project_members;
CREATE TRIGGER trg_set_org_default BEFORE INSERT ON public.project_members FOR EACH ROW EXECUTE FUNCTION public.set_org_default();
CREATE POLICY project_members_sel ON public.project_members FOR SELECT USING (
  is_admin() OR auth.role()='service_role'
  OR employee_id = current_employee_id()
  OR is_project_member(project_id)
);
CREATE POLICY project_members_ins ON public.project_members FOR INSERT WITH CHECK (org_visible(organization_id));
CREATE POLICY project_members_upd ON public.project_members FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (org_visible(organization_id));
CREATE POLICY project_members_del ON public.project_members FOR DELETE USING (org_visible(organization_id));

-- ── tasks ─────────────────────────────────────────────────────────────────
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
SELECT public._drop_all_policies('tasks');
DROP TRIGGER IF EXISTS trg_set_org_default ON public.tasks;
CREATE TRIGGER trg_set_org_default BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_org_default();
CREATE POLICY tasks_sel ON public.tasks FOR SELECT USING (
  is_admin() OR auth.role()='service_role'
  OR can_see_request(assignee_id)              -- 指派人本人 + 其主管鏈 + 店長
  OR created_by_emp_id = current_employee_id() -- 建立者
  OR (project_id IS NOT NULL AND is_project_member(project_id))  -- 同專案成員
);
CREATE POLICY tasks_ins ON public.tasks FOR INSERT WITH CHECK (org_visible(organization_id));
CREATE POLICY tasks_upd ON public.tasks FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (org_visible(organization_id));
CREATE POLICY tasks_del ON public.tasks FOR DELETE USING (org_visible(organization_id));

-- ── workflow_instances ────────────────────────────────────────────────────
ALTER TABLE public.workflow_instances ENABLE ROW LEVEL SECURITY;
SELECT public._drop_all_policies('workflow_instances');
DROP TRIGGER IF EXISTS trg_set_org_default ON public.workflow_instances;
CREATE TRIGGER trg_set_org_default BEFORE INSERT ON public.workflow_instances FOR EACH ROW EXECUTE FUNCTION public.set_org_default();
CREATE POLICY workflow_instances_sel ON public.workflow_instances FOR SELECT USING (
  is_admin() OR auth.role()='service_role'
  OR started_by_id = current_employee_id()
  OR target_employee_id = current_employee_id()
  OR applicant_emp_id = current_employee_id()
  OR can_see_request(target_employee_id)   -- 目標員工的主管鏈
  OR can_see_request(applicant_emp_id)     -- 申請人的主管鏈
);
CREATE POLICY workflow_instances_ins ON public.workflow_instances FOR INSERT WITH CHECK (org_visible(organization_id));
CREATE POLICY workflow_instances_upd ON public.workflow_instances FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (org_visible(organization_id));
CREATE POLICY workflow_instances_del ON public.workflow_instances FOR DELETE USING (org_visible(organization_id));

COMMIT;

NOTIFY pgrst, 'reload schema';
