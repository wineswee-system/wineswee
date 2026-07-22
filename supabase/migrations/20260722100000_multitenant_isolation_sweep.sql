-- 多租戶隔離總整:讓「每個帳號只能存取自己的 organization」。
--
-- 根因:admin / staff 是「全域」概念,內建於多個共用 SECURITY DEFINER 函式與 ~40 條 policy,
-- 造成任一 org 的 admin(含 demo)可讀取其他 org 的資料。
--
-- 原則:super_admin(平台擁有者)保留跨 org;一般 admin / staff 一律限縮在自己的 organization。
-- 每條 policy 皆保留原本的「本 org / 本人 / 主管鏈」分支,real org-1 使用者存取不受影響。
--
-- 前置:is_super_admin() 已於 20260722093000 建立。

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- PART 1 — 共用 helper 函式:把「全域 admin bypass」改為「super_admin 全域 + admin 限本 org」
-- ════════════════════════════════════════════════════════════════════

-- is_hr_staff:admin 不再自動視為 HR(改 super_admin);HR 部門判斷本身已是本 org
CREATE OR REPLACE FUNCTION public.is_hr_staff()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_super_admin() THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM employees me
      JOIN departments d ON d.id = me.department_id
     WHERE me.id = current_employee_id() AND d.name = '人力資源部'
  );
END $$;

-- can_see_store:super_admin 全域;admin 僅本 org 門市;其餘店長/門市/督導邏輯不變
CREATE OR REPLACE FUNCTION public.can_see_store(p_store_id bigint)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me int := current_employee_id();
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_super_admin() THEN RETURN true; END IF;
  IF v_me IS NULL OR p_store_id IS NULL THEN RETURN false; END IF;
  IF is_admin() AND EXISTS (SELECT 1 FROM stores s WHERE s.id = p_store_id AND s.organization_id = current_user_org_id()) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM employees e WHERE e.id = v_me AND e.store_id = p_store_id) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM stores s WHERE s.id = p_store_id AND s.manager_id = v_me) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM user_stores us WHERE us.employee_id = v_me AND us.store_id = p_store_id) THEN RETURN true; END IF;
  IF EXISTS (
    SELECT 1 FROM stores st
      JOIN department_sections ds ON ds.id = st.section_id
     WHERE st.id = p_store_id AND ds.supervisor_id = v_me
  ) THEN RETURN true; END IF;
  RETURN false;
END $$;

-- can_see_own:super_admin 全域;admin / HR 僅本 org 員工;其餘本人
CREATE OR REPLACE FUNCTION public.can_see_own(p_emp_id bigint)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_super_admin() THEN RETURN true; END IF;
  IF (is_admin() OR is_hr_staff())
     AND EXISTS (SELECT 1 FROM employees e WHERE e.id = p_emp_id AND e.organization_id = current_user_org_id())
  THEN RETURN true; END IF;
  RETURN p_emp_id IS NOT NULL AND p_emp_id = current_employee_id();
END $$;

-- can_manage_emp_store:super_admin 全域;admin 僅本 org 門市;其餘 can_manage_store
CREATE OR REPLACE FUNCTION public.can_manage_emp_store(p_emp_id integer, p_emp_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_store int; v_store_org int;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_super_admin() THEN RETURN true; END IF;
  SELECT COALESCE(
    (SELECT store_id FROM employees WHERE id = p_emp_id),
    (SELECT store_id FROM employees WHERE name = p_emp_name AND status = '在職' ORDER BY id LIMIT 1)
  ) INTO v_store;
  IF is_admin() THEN
    SELECT organization_id INTO v_store_org FROM stores WHERE id = v_store;
    IF v_store_org IS NOT NULL AND v_store_org = current_user_org_id() THEN RETURN true; END IF;
  END IF;
  RETURN can_manage_store(v_store);
END $$;

-- _*_visible:先載入該筆資料 → super_admin 全域;admin 僅當該筆屬本 org 才放行
CREATE OR REPLACE FUNCTION public._business_trip_visible(p_request_id integer)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_emp_id INT; v_role_name TEXT; v_req business_trips;
BEGIN
  SELECT e.id, r.name INTO v_emp_id, v_role_name
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_req FROM business_trips WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RETURN false; END IF;
  IF v_role_name = 'super_admin' THEN RETURN true; END IF;
  IF v_role_name = 'admin' AND v_req.organization_id = current_user_org_id() THEN RETURN true; END IF;
  IF public.can_see_request(v_req.employee_id) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM request_chain_snapshots rcs
    WHERE rcs.request_type = 'trip' AND rcs.request_id = p_request_id
      AND public._employee_matches_snapshot_step(v_emp_id, 'trip', p_request_id, rcs.step_order, v_req.employee_id)) THEN RETURN true; END IF;
  IF v_req.approval_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs WHERE acs.chain_id = v_req.approval_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_req.employee_id)) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM approval_extra_steps
    WHERE source_table = 'business_trips' AND source_id = p_request_id AND assignee_id = v_emp_id) THEN RETURN true; END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public._expense_request_visible(p_request_id integer)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_emp_id INT; v_role_name TEXT; v_req expense_requests;
BEGIN
  SELECT e.id, r.name INTO v_emp_id, v_role_name
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_req FROM expense_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RETURN false; END IF;
  IF v_role_name = 'super_admin' THEN RETURN true; END IF;
  IF v_role_name = 'admin' AND v_req.organization_id = current_user_org_id() THEN RETURN true; END IF;
  IF public.can_see_request(v_req.employee_id) THEN RETURN true; END IF;
  IF v_req.approval_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs WHERE acs.chain_id = v_req.approval_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_req.employee_id)) THEN RETURN true; END IF;
  IF v_req.settle_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs WHERE acs.chain_id = v_req.settle_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_req.employee_id)) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM approval_extra_steps
    WHERE source_table = 'expense_requests' AND source_id = p_request_id AND assignee_id = v_emp_id) THEN RETURN true; END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public._expense_visible(p_id integer)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_emp_id INT; v_role_name TEXT; v_exp expenses;
BEGIN
  SELECT e.id, r.name INTO v_emp_id, v_role_name
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_exp FROM expenses WHERE id = p_id;
  IF v_exp.id IS NULL THEN RETURN false; END IF;
  IF v_role_name = 'super_admin' THEN RETURN true; END IF;
  IF v_role_name = 'admin' AND v_exp.organization_id = current_user_org_id() THEN RETURN true; END IF;
  IF public.can_see_request(v_exp.employee_id) THEN RETURN true; END IF;
  IF v_exp.approval_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs WHERE acs.chain_id = v_exp.approval_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_exp.employee_id)) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM approval_extra_steps
    WHERE source_table = 'expenses' AND source_id = p_id AND assignee_id = v_emp_id) THEN RETURN true; END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public._work_order_visible(p_id integer)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me int; v_role text; v_dept int; v_wo public.work_orders;
BEGIN
  SELECT e.id, r.name, e.department_id INTO v_me, v_role, v_dept
    FROM public.employees e LEFT JOIN public.roles r ON r.id = e.role_id WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_me IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN false; END IF;
  IF v_role = 'super_admin' THEN RETURN true; END IF;
  IF v_role = 'admin' AND v_wo.organization_id = current_user_org_id() THEN RETURN true; END IF;
  RETURN v_wo.requester_id = v_me
      OR v_wo.assignee_id  = v_me
      OR (v_dept IS NOT NULL AND v_wo.target_department_id    = v_dept)
      OR (v_dept IS NOT NULL AND v_wo.requester_department_id = v_dept);
END $$;

-- ════════════════════════════════════════════════════════════════════
-- PART 2 — Policy 改寫
-- ════════════════════════════════════════════════════════════════════

-- ── 2A. idiom「org OR is_admin()」→「org OR is_super_admin()」(_org_sel_v2) ──
DROP POLICY IF EXISTS approval_chains_org_sel_v2 ON public.approval_chains;
CREATE POLICY approval_chains_org_sel_v2 ON public.approval_chains FOR SELECT
  USING (organization_id = current_user_org_id() OR is_super_admin());
DROP POLICY IF EXISTS approval_form_steps_org_sel_v2 ON public.approval_form_steps;
CREATE POLICY approval_form_steps_org_sel_v2 ON public.approval_form_steps FOR SELECT
  USING (organization_id = current_user_org_id() OR is_super_admin());
DROP POLICY IF EXISTS approval_forms_org_sel_v2 ON public.approval_forms;
CREATE POLICY approval_forms_org_sel_v2 ON public.approval_forms FOR SELECT
  USING (organization_id = current_user_org_id() OR is_super_admin());
DROP POLICY IF EXISTS department_manager_history_org_sel_v2 ON public.department_manager_history;
CREATE POLICY department_manager_history_org_sel_v2 ON public.department_manager_history FOR SELECT
  USING (organization_id = current_user_org_id() OR is_super_admin());
DROP POLICY IF EXISTS employee_dependents_org_sel_v2 ON public.employee_dependents;
CREATE POLICY employee_dependents_org_sel_v2 ON public.employee_dependents FOR SELECT
  USING (organization_id = current_user_org_id() OR is_super_admin());
DROP POLICY IF EXISTS project_templates_org_sel_v2 ON public.project_templates;
CREATE POLICY project_templates_org_sel_v2 ON public.project_templates FOR SELECT
  USING (organization_id = current_user_org_id() OR is_super_admin());
DROP POLICY IF EXISTS task_attachments_org_sel_v2 ON public.task_attachments;
CREATE POLICY task_attachments_org_sel_v2 ON public.task_attachments FOR SELECT
  USING (organization_id = current_user_org_id() OR is_super_admin());
DROP POLICY IF EXISTS task_comments_org_sel_v2 ON public.task_comments;
CREATE POLICY task_comments_org_sel_v2 ON public.task_comments FOR SELECT
  USING (organization_id = current_user_org_id() OR is_super_admin());
DROP POLICY IF EXISTS task_mentions_org_sel_v2 ON public.task_mentions;
CREATE POLICY task_mentions_org_sel_v2 ON public.task_mentions FOR SELECT
  USING (organization_id = current_user_org_id() OR is_super_admin());
DROP POLICY IF EXISTS user_stores_org_sel_v2 ON public.user_stores;
CREATE POLICY user_stores_org_sel_v2 ON public.user_stores FOR SELECT
  USING (organization_id = current_user_org_id() OR is_super_admin());

-- ── 2B. idiom「org OR role IN(admin,super_admin)」→「org OR is_super_admin()」(org_scope_select_*) ──
DROP POLICY IF EXISTS org_scope_select_checklists ON public.checklists;
CREATE POLICY org_scope_select_checklists ON public.checklists FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_companies ON public.companies;
CREATE POLICY org_scope_select_companies ON public.companies FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_employee_shift_preferences ON public.employee_shift_preferences;
CREATE POLICY org_scope_select_employee_shift_preferences ON public.employee_shift_preferences FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_performance_reviews ON public.performance_reviews;
CREATE POLICY org_scope_select_performance_reviews ON public.performance_reviews FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_salary_structures ON public.salary_structures;
CREATE POLICY org_scope_select_salary_structures ON public.salary_structures FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_schedule_publish_status ON public.schedule_publish_status;
CREATE POLICY org_scope_select_schedule_publish_status ON public.schedule_publish_status FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_shift_definitions ON public.shift_definitions;
CREATE POLICY org_scope_select_shift_definitions ON public.shift_definitions FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_sop_templates ON public.sop_templates;
CREATE POLICY org_scope_select_sop_templates ON public.sop_templates FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_store_settings ON public.store_settings;
CREATE POLICY org_scope_select_store_settings ON public.store_settings FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_store_time_slots ON public.store_time_slots;
CREATE POLICY org_scope_select_store_time_slots ON public.store_time_slots FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_task_activity ON public.task_activity;
CREATE POLICY org_scope_select_task_activity ON public.task_activity FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_task_confirmations ON public.task_confirmations;
CREATE POLICY org_scope_select_task_confirmations ON public.task_confirmations FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_task_dependencies ON public.task_dependencies;
CREATE POLICY org_scope_select_task_dependencies ON public.task_dependencies FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_expense_request_attachments ON public.expense_request_attachments;
CREATE POLICY org_scope_select_expense_request_attachments ON public.expense_request_attachments FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_departments ON public.departments;
CREATE POLICY org_scope_select_departments ON public.departments FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS org_scope_select_stores ON public.stores;
CREATE POLICY org_scope_select_stores ON public.stores FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());
DROP POLICY IF EXISTS disaster_days_read ON public.disaster_days;
CREATE POLICY disaster_days_read ON public.disaster_days FOR SELECT
  USING (organization_id = current_employee_org() OR is_super_admin());

-- ── 2C. ALL write policies with「role IN(admin,super_admin)」→ super_admin 全域 OR (admin 本 org) ──
DROP POLICY IF EXISTS disaster_days_write ON public.disaster_days;
CREATE POLICY disaster_days_write ON public.disaster_days FOR ALL
  USING (is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org()))
  WITH CHECK (is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org()));
DROP POLICY IF EXISTS salary_structures_admin_write ON public.salary_structures;
CREATE POLICY salary_structures_admin_write ON public.salary_structures FOR ALL
  USING (is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org()))
  WITH CHECK (is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org()));
DROP POLICY IF EXISTS form_templates_org_access ON public.form_templates;
CREATE POLICY form_templates_org_access ON public.form_templates FOR ALL
  USING (organization_id = (current_employee_org())::bigint OR is_super_admin())
  WITH CHECK (organization_id = (current_employee_org())::bigint OR is_super_admin());
DROP POLICY IF EXISTS draft_sessions_write ON public.schedule_draft_sessions;
CREATE POLICY draft_sessions_write ON public.schedule_draft_sessions FOR ALL
  USING (created_by = current_employee_id() OR is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org()))
  WITH CHECK (created_by = current_employee_id() OR is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org()));
DROP POLICY IF EXISTS draft_sessions_select ON public.schedule_draft_sessions;
CREATE POLICY draft_sessions_select ON public.schedule_draft_sessions FOR SELECT
  USING (created_by = current_employee_id() OR is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org()));

-- ── 2D. self OR role → self OR super_admin OR (role 本 org) ──
DROP POLICY IF EXISTS salary_structures_self_or_admin ON public.salary_structures;
CREATE POLICY salary_structures_self_or_admin ON public.salary_structures FOR SELECT
  USING (employee_id = current_employee_id() OR is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin']) AND organization_id = current_employee_org()));
DROP POLICY IF EXISTS comp_time_ledger_read ON public.comp_time_ledger;
CREATE POLICY comp_time_ledger_read ON public.comp_time_ledger FOR SELECT
  USING (employee_id = current_employee_id() OR is_super_admin() OR (current_employee_role() = ANY (ARRAY['admin','super_admin','manager']) AND organization_id = current_employee_org()));

-- ── 2E. ALL USING(is_admin()) 類 → super_admin 全域 OR (admin 本 org) ──
DROP POLICY IF EXISTS approval_extra_steps_adminwrite ON public.approval_extra_steps;
CREATE POLICY approval_extra_steps_adminwrite ON public.approval_extra_steps FOR ALL
  USING (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()))
  WITH CHECK (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()));
DROP POLICY IF EXISTS audit_logs_admin_only ON public.audit_logs;
CREATE POLICY audit_logs_admin_only ON public.audit_logs FOR ALL
  USING (auth.role() = 'service_role' OR is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()))
  WITH CHECK (auth.role() = 'service_role' OR is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()));
DROP POLICY IF EXISTS deletion_drain_admin_only ON public.deletion_drain;
CREATE POLICY deletion_drain_admin_only ON public.deletion_drain FOR ALL
  USING (auth.role() = 'service_role' OR is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()))
  WITH CHECK (auth.role() = 'service_role' OR is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()));
DROP POLICY IF EXISTS departments_modify ON public.departments;
CREATE POLICY departments_modify ON public.departments FOR ALL
  USING (is_super_admin() OR (is_admin() AND organization_id = current_employee_org()))
  WITH CHECK (is_super_admin() OR (is_admin() AND organization_id = current_employee_org()));
DROP POLICY IF EXISTS stores_modify ON public.stores;
CREATE POLICY stores_modify ON public.stores FOR ALL
  USING (is_super_admin() OR (is_admin() AND organization_id = current_employee_org()))
  WITH CHECK (is_super_admin() OR (is_admin() AND organization_id = current_employee_org()));
DROP POLICY IF EXISTS comms_email_categories_org ON public.email_categories;
CREATE POLICY comms_email_categories_org ON public.email_categories FOR ALL
  USING (organization_id = current_user_org_id() OR is_super_admin())
  WITH CHECK (organization_id = current_user_org_id() OR is_super_admin());
DROP POLICY IF EXISTS comms_email_labels_org ON public.email_labels;
CREATE POLICY comms_email_labels_org ON public.email_labels FOR ALL
  USING (organization_id = current_user_org_id() OR is_super_admin())
  WITH CHECK (organization_id = current_user_org_id() OR is_super_admin());

-- ── 2F. 多來源 SELECT with is_admin() → super_admin OR (admin 本 org) OR <原有本人/成員分支> ──
DROP POLICY IF EXISTS tasks_sel ON public.tasks;
CREATE POLICY tasks_sel ON public.tasks FOR SELECT USING (
  is_super_admin() OR (is_admin() AND organization_id = current_user_org_id())
  OR (auth.role() = 'service_role')
  OR (assignee_id = current_employee_id())
  OR (created_by_emp_id = current_employee_id())
  OR ((project_id IS NOT NULL) AND is_project_member((project_id)::bigint))
  OR ((workflow_instance_id IS NOT NULL) AND is_workflow_initiator((workflow_instance_id)::bigint))
  OR ((project_id IS NOT NULL) AND is_project_owner((project_id)::bigint))
  OR is_mentioned_in_task((id)::bigint)
  OR ((workflow_instance_id IS NOT NULL) AND (EXISTS (SELECT 1 FROM workflow_instances wi WHERE ((wi.id = tasks.workflow_instance_id) AND (wi.project_id IS NOT NULL)))))
);
DROP POLICY IF EXISTS projects_sel ON public.projects;
CREATE POLICY projects_sel ON public.projects FOR SELECT USING (
  is_super_admin() OR (is_admin() AND organization_id = current_user_org_id())
  OR (auth.role() = 'service_role')
  OR (owner_id = current_employee_id())
  OR is_project_member((id)::bigint)
  OR has_task_in_project((id)::bigint)
  OR has_mention_in_project((id)::bigint)
);
DROP POLICY IF EXISTS workflow_instances_sel ON public.workflow_instances;
CREATE POLICY workflow_instances_sel ON public.workflow_instances FOR SELECT USING (
  is_super_admin() OR (is_admin() AND organization_id = current_user_org_id())
  OR (auth.role() = 'service_role')
  OR (started_by_id = current_employee_id())
  OR (target_employee_id = current_employee_id())
  OR (applicant_emp_id = current_employee_id())
  OR has_task_in_workflow((id)::bigint)
  OR has_mention_in_workflow((id)::bigint)
  OR ((project_id IS NOT NULL) AND (EXISTS (SELECT 1 FROM projects p WHERE (p.id = workflow_instances.project_id))))
);
DROP POLICY IF EXISTS project_members_sel ON public.project_members;
CREATE POLICY project_members_sel ON public.project_members FOR SELECT USING (
  is_super_admin() OR (is_admin() AND organization_id = current_user_org_id())
  OR (auth.role() = 'service_role')
  OR (employee_id = current_employee_id())
  OR is_project_member((project_id)::bigint)
);
DROP POLICY IF EXISTS leave_bal_select ON public.leave_balances;
CREATE POLICY leave_bal_select ON public.leave_balances FOR SELECT USING (
  is_super_admin() OR (is_admin() AND organization_id = current_user_org_id())
  OR (employee_id = current_employee_id())
);

-- ── 2G. 權限判斷未加 org 過濾 → 加上本 org(super_admin 全域) ──
DROP POLICY IF EXISTS expense_requests_viewall_sel ON public.expense_requests;
CREATE POLICY expense_requests_viewall_sel ON public.expense_requests FOR SELECT USING (
  is_super_admin() OR (current_employee_has_permission('expense.view_all') AND organization_id = current_employee_org())
);
DROP POLICY IF EXISTS store_audits_view_all_sel ON public.store_audits;
CREATE POLICY store_audits_view_all_sel ON public.store_audits FOR SELECT USING (
  is_super_admin() OR (liff_employee_has_permission(current_employee_id(), 'liff.store_audit.view_all') AND organization_id = current_employee_org())
);

-- ── 2H. is_staff()(= 任何登入者)→ super_admin OR 本 org ──
DROP POLICY IF EXISTS positions_select ON public.positions;
CREATE POLICY positions_select ON public.positions FOR SELECT
  USING (is_super_admin() OR organization_id = current_employee_org());
DROP POLICY IF EXISTS ins_events_sel ON public.employee_insurance_events;
CREATE POLICY ins_events_sel ON public.employee_insurance_events FOR SELECT
  USING (auth.role() = 'service_role' OR is_super_admin() OR organization_id = current_employee_org() OR employee_id = current_employee_id());
DROP POLICY IF EXISTS ins_events_write ON public.employee_insurance_events;
CREATE POLICY ins_events_write ON public.employee_insurance_events FOR ALL
  USING (auth.role() = 'service_role' OR is_super_admin() OR organization_id = current_employee_org())
  WITH CHECK (auth.role() = 'service_role' OR is_super_admin() OR organization_id = current_employee_org());
DROP POLICY IF EXISTS "org staff can view clock edits" ON public.attendance_clock_edits;
CREATE POLICY "org staff can view clock edits" ON public.attendance_clock_edits FOR SELECT
  USING (is_super_admin() OR organization_id = current_employee_org());
DROP POLICY IF EXISTS offer_approval_steps_staff ON public.offer_approval_steps;
CREATE POLICY offer_approval_steps_staff ON public.offer_approval_steps FOR ALL
  USING (auth.role() = 'service_role' OR is_super_admin() OR organization_id = current_employee_org())
  WITH CHECK (auth.role() = 'service_role' OR is_super_admin() OR organization_id = current_employee_org());

-- ── 2I. 純寬鬆 permissive → 收斂本 org ──
DROP POLICY IF EXISTS business_events_read_auth ON public.business_events;
CREATE POLICY business_events_read_auth ON public.business_events FOR SELECT
  USING (auth.role() = 'service_role' OR is_super_admin() OR organization_id = current_employee_org());
DROP POLICY IF EXISTS auth_read_purchase_orders ON public.purchase_orders;
CREATE POLICY auth_read_purchase_orders ON public.purchase_orders FOR SELECT
  USING (is_super_admin() OR organization_id = current_user_org_id());
DROP POLICY IF EXISTS departments_read ON public.departments;   -- 冗餘的 authenticated 全開,移除(org_scope_select_departments 已涵蓋)
DROP POLICY IF EXISTS stores_read ON public.stores;             -- 同上(stores_org_sel / org_scope_select_stores 已涵蓋)

-- ── 2J. approval_chain_steps:current_employee_role 全域 admin → super_admin;保留 chain 本 org 判斷 ──
DROP POLICY IF EXISTS acs_org_isolation ON public.approval_chain_steps;
CREATE POLICY acs_org_isolation ON public.approval_chain_steps FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (SELECT 1 FROM approval_chains ac WHERE ac.id = approval_chain_steps.chain_id AND ac.organization_id = current_employee_org())
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (SELECT 1 FROM approval_chains ac WHERE ac.id = approval_chain_steps.chain_id AND ac.organization_id = current_employee_org())
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
