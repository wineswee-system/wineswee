-- 多租戶強化:8 張 tenant 表的 is_admin() policy 綁 org(super_admin仍全部)— 2026-08-10
-- 起因:TeamDashboard 進行中專案顯示跨 org(6=org1三+org2三)。根因 is_admin() 未綁 org。
-- 已套用 live;此檔為記錄。★待辦:employee_line_accounts/event_outbox/line_users/salary_adjustments 無 org 欄需 JOIN 推 org。

-- 多租戶強化:admin 綁 org(super_admin 仍看全部) — 2026-08-10
ALTER POLICY projects_sel ON public.projects USING (
  (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id())) OR (auth.role() = 'service_role') OR (owner_id = current_employee_id()) OR is_project_member((id)::bigint) OR has_task_in_project((id)::bigint) OR has_mention_in_project((id)::bigint));

ALTER POLICY tasks_sel ON public.tasks USING (
  (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id())) OR (auth.role() = 'service_role') OR (assignee_id = current_employee_id()) OR (created_by_emp_id = current_employee_id()) OR ((project_id IS NOT NULL) AND is_project_member((project_id)::bigint)) OR ((workflow_instance_id IS NOT NULL) AND is_workflow_initiator((workflow_instance_id)::bigint)) OR ((project_id IS NOT NULL) AND is_project_owner((project_id)::bigint)) OR is_mentioned_in_task((id)::bigint) OR ((workflow_instance_id IS NOT NULL) AND (EXISTS (SELECT 1 FROM workflow_instances wi WHERE ((wi.id = tasks.workflow_instance_id) AND (wi.project_id IS NOT NULL))))));

ALTER POLICY workflow_instances_sel ON public.workflow_instances USING (
  (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id())) OR (auth.role() = 'service_role') OR (started_by_id = current_employee_id()) OR (target_employee_id = current_employee_id()) OR (applicant_emp_id = current_employee_id()) OR has_task_in_workflow((id)::bigint) OR has_mention_in_workflow((id)::bigint) OR ((project_id IS NOT NULL) AND (EXISTS (SELECT 1 FROM projects p WHERE (p.id = workflow_instances.project_id)))));

ALTER POLICY store_audits_draft_sel ON public.store_audits USING (
  is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()) OR (auditor_id = current_employee_id()) OR current_employee_has_permission('store_audit.view_draft'));

ALTER POLICY approval_rules_adminwrite ON public.approval_rules
  USING (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()))
  WITH CHECK (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()));

ALTER POLICY attrition_risk_snapshots_admin_only ON public.attrition_risk_snapshots
  USING (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()) OR (auth.role() = 'service_role'))
  WITH CHECK (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()) OR (auth.role() = 'service_role'));

ALTER POLICY message_logs_admin_only ON public.message_logs
  USING (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()) OR (auth.role() = 'service_role'))
  WITH CHECK (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()) OR (auth.role() = 'service_role'));

ALTER POLICY severance_records_self_w ON public.severance_records
  USING (is_super_admin() OR (auth.role() = 'service_role') OR ((is_admin() OR is_hr_staff()) AND organization_id = current_user_org_id()))
  WITH CHECK (is_super_admin() OR (auth.role() = 'service_role') OR ((is_admin() OR is_hr_staff()) AND organization_id = current_user_org_id()));
