-- Fix Supabase security linter errors:
--   lint 0010: 15 views defined with SECURITY DEFINER → switch to security_invoker = on
--   lint 0013: 10 tables in public schema with RLS disabled → enable RLS + add policies

-- ============================================================
-- PART 1: Recreate views WITH (security_invoker = on)
-- ============================================================

-- v_project_members_full
CREATE OR REPLACE VIEW public.v_project_members_full
WITH (security_invoker = on) AS
SELECT
  pm.id, pm.project_id, pm.employee_id, pm.employee_name, pm.role,
  pm.added_by, pm.added_at,
  e.name  AS employee_full_name,
  e.email AS employee_email,
  d.name  AS employee_dept
FROM public.project_members pm
LEFT JOIN public.employees   e ON pm.employee_id = e.id
LEFT JOIN public.departments d ON d.id = e.department_id;

-- v_workflow_instance_progress
CREATE OR REPLACE VIEW public.v_workflow_instance_progress
WITH (security_invoker = on) AS
SELECT
  wi.id            AS instance_id,
  wi.template_name AS instance_name,
  wi.status        AS instance_status,
  wi.store         AS instance_store,
  wi.assignee      AS instance_assignee,
  wi.started_at,
  COUNT(t.id)                                                                 AS total_tasks,
  COUNT(t.id) FILTER (WHERE t.status = '已完成')                              AS completed_tasks,
  COUNT(t.id) FILTER (WHERE t.status = '進行中')                              AS active_tasks,
  COUNT(t.id) FILTER (WHERE t.status IN ('未開始', '待處理'))                  AS pending_tasks,
  COUNT(t.id) FILTER (WHERE t.due_date < CURRENT_DATE
                        AND t.status NOT IN ('已完成', '已取消'))               AS overdue_tasks,
  CASE
    WHEN COUNT(t.id) = 0 THEN 0
    ELSE ROUND(100.0 * COUNT(t.id) FILTER (WHERE t.status = '已完成') / COUNT(t.id))
  END                                                                         AS completion_pct
FROM public.workflow_instances wi
LEFT JOIN public.tasks t ON t.workflow_instance_id = wi.id
GROUP BY wi.id, wi.template_name, wi.status, wi.store, wi.assignee, wi.started_at;

-- v_employees_current
-- DROP required because employees.* column list expanded since view was created;
-- CREATE OR REPLACE is positionally strict and rejects the shifted column order.
DROP VIEW IF EXISTS public.v_employees_current CASCADE;
CREATE VIEW public.v_employees_current
WITH (security_invoker = on) AS
SELECT
  e.*,
  ea.id               AS assignment_id,
  ea.department_type  AS current_department_type,
  ea.is_part_time     AS current_is_part_time,
  ea.avg_weekly_hours AS current_avg_weekly_hours,
  ea.start_date       AS current_start_date,
  ea.end_date         AS current_end_date,
  ea.job_grade        AS current_job_grade,
  d.name              AS current_department_name,
  s.name              AS current_store_name
FROM public.employees e
LEFT JOIN public.employee_assignments ea
       ON ea.employee_id = e.id
      AND ea.department_type = '主要'
      AND ea.is_active = true
LEFT JOIN public.departments d ON d.id = ea.department_id
LEFT JOIN public.stores      s ON s.id = ea.store_id;

-- v_nhi_supplementary_filing
CREATE OR REPLACE VIEW public.v_nhi_supplementary_filing
WITH (security_invoker = on) AS
SELECT
  ns.pay_period,
  e.id             AS employee_id,
  e.name           AS employee_name,
  e.id_number,
  e.organization_id,
  ns.income_category AS category,
  ns.income_amount   AS gross_income,
  ns.exempt_amount,
  ns.taxable_amount,
  ns.rate            AS premium_rate,
  ns.premium_amount  AS premium,
  ns.filed,
  ns.filed_at,
  ns.notes,
  ns.id              AS record_id,
  ns.created_at
FROM public.nhi_supplementary_records ns
JOIN public.employees e ON e.id = ns.employee_id
ORDER BY ns.pay_period DESC, ns.income_category, e.name;

-- v_expiry_alerts
CREATE OR REPLACE VIEW public.v_expiry_alerts
WITH (security_invoker = on) AS
  SELECT
    'contract'                            AS alert_type,
    ec.id                                 AS ref_id,
    e.id                                  AS employee_id,
    e.name                                AS employee_name,
    e.employment_type,
    ec.contract_type                      AS label,
    ec.end_date                           AS expiry_date,
    (ec.end_date - CURRENT_DATE)::INT     AS days_remaining,
    ec.organization_id
  FROM  public.employee_contracts ec
  JOIN  public.employees e ON e.id = ec.employee_id
  WHERE ec.status NOT IN ('terminated', 'renewed')
    AND ec.end_date >= CURRENT_DATE - INTERVAL '7 days'
UNION ALL
  SELECT
    'doc'                                 AS alert_type,
    fd.id                                 AS ref_id,
    e.id                                  AS employee_id,
    e.name                                AS employee_name,
    e.employment_type,
    fd.doc_type                           AS label,
    fd.expiry_date,
    (fd.expiry_date - CURRENT_DATE)::INT  AS days_remaining,
    fd.organization_id
  FROM  public.foreign_worker_docs fd
  JOIN  public.employees e ON e.id = fd.employee_id
  WHERE fd.expiry_date >= CURRENT_DATE - INTERVAL '7 days';

-- v_employee_termination
CREATE OR REPLACE VIEW public.v_employee_termination
WITH (security_invoker = on) AS
SELECT
  e.id   AS employee_id,
  e.name,
  e.dept,
  e.organization_id,
  COALESCE(sr.termination_date, e.created_at::DATE) AS termination_date
FROM public.employees e
LEFT JOIN LATERAL (
  SELECT termination_date FROM public.severance_records
   WHERE employee_id = e.id
   ORDER BY termination_date DESC LIMIT 1
) sr ON true
WHERE e.status = '離職';

-- v_tasks_full
CREATE OR REPLACE VIEW public.v_tasks_full
WITH (security_invoker = on) AS
SELECT
  t.id, t.title, t.status, t.due_date, t.priority, t.created_at,
  t.workflow_instance_id, t.workflow_step_id, t.description,
  t.store_id, t.planned_start, t.due_time,
  t.completed_at, t.updated_at, t.notes, t.sort_order, t.step_order,
  t.step_type, t.role, t.category, t.bucket, t.metadata,
  t.reminder_at, t.confirmation_required, t.confirmation_status,
  t.confirmation_requested_at, t.confirmation_responded_at, t.confirmation_notes,
  t.approval_chain_id, t.trigger_actions, t.start_conditions,
  t.assignee_id,
  s.name   AS store_name,
  ae.name  AS assignee_name,
  wi.template_name AS workflow_instance_name,
  wi.status        AS workflow_instance_status,
  wi.store         AS workflow_instance_store
FROM public.tasks t
LEFT JOIN public.workflow_instances wi ON t.workflow_instance_id = wi.id
LEFT JOIN public.stores    s  ON s.id  = t.store_id
LEFT JOIN public.employees ae ON ae.id = t.assignee_id;

-- v_tasks_expanded
CREATE OR REPLACE VIEW public.v_tasks_expanded
WITH (security_invoker = on) AS
SELECT
  t.id, t.title, t.status, t.due_date, t.priority, t.created_at,
  t.workflow_instance_id, t.workflow_step_id, t.description,
  t.store_id, t.planned_start, t.due_time,
  t.completed_at, t.updated_at, t.notes, t.sort_order, t.step_order,
  t.step_type, t.role, t.category, t.bucket, t.metadata,
  t.reminder_at, t.confirmation_required, t.confirmation_status,
  t.confirmation_requested_at, t.confirmation_responded_at, t.confirmation_notes,
  t.approval_chain_id, t.trigger_actions, t.start_conditions,
  t.assignee_id, t.project_id, t.section_id, t.parent_task_id,
  t.recurrence_rule, t.recurrence_parent_id, t.recurrence_until,
  t.last_materialized_at,
  s.name   AS store_name,
  ae.name  AS assignee_name,
  p.name   AS project_name,
  ps.name  AS section_name,
  ps.color AS section_color,
  (SELECT count(*) FROM public.task_watchers         tw WHERE tw.task_id = t.id) AS watcher_count,
  (SELECT count(*) FROM public.task_comments         tc WHERE tc.task_id = t.id) AS comment_count,
  (SELECT count(*) FROM public.task_attachments      ta WHERE ta.task_id = t.id) AS attachment_count,
  (SELECT count(*) FROM public.task_custom_field_values v WHERE v.task_id = t.id) AS custom_field_count
FROM public.tasks t
LEFT JOIN public.projects         p  ON t.project_id  = p.id
LEFT JOIN public.project_sections ps ON t.section_id  = ps.id
LEFT JOIN public.stores           s  ON s.id          = t.store_id
LEFT JOIN public.employees        ae ON ae.id         = t.assignee_id;

-- v_employee_line_resolved
CREATE OR REPLACE VIEW public.v_employee_line_resolved
WITH (security_invoker = on) AS
SELECT
  e.id          AS employee_id,
  e.name        AS employee_name,
  ela.line_user_id,
  ela.display_name AS line_display_name,
  ela.is_primary,
  ela.channel_id,
  lc.code       AS channel_code,
  lc.name       AS channel_name,
  lc.liff_id
FROM public.employees e
JOIN public.employee_line_accounts ela ON ela.employee_id = e.id
JOIN public.line_channels          lc  ON lc.id = ela.channel_id
WHERE lc.status = 'active';

-- v_employee_org_role
CREATE OR REPLACE VIEW public.v_employee_org_role
WITH (security_invoker = on) AS
SELECT
  e.id             AS employee_id,
  e.name           AS employee_name,
  e.email,
  e.organization_id,
  o.name           AS organization_name,
  o.slug           AS organization_slug,
  r.id             AS role_id,
  r.name           AS role_name,
  r.level          AS role_level,
  r.is_system,
  e.is_manager,
  e.is_line_manager,
  e.store_id,
  e.department_id
FROM public.employees    e
LEFT JOIN public.organizations o ON o.id = e.organization_id
LEFT JOIN public.roles         r ON r.id = e.role_id;

-- v_labor_pension_filing_monthly
CREATE OR REPLACE VIEW public.v_labor_pension_filing_monthly
WITH (security_invoker = on) AS
SELECT
  pr.pay_period,
  e.id             AS employee_id,
  e.name           AS employee_name,
  e.id_number,
  e.organization_id,
  pr.base_salary                                        AS pension_base,
  LEAST(pr.base_salary, 150000)                         AS capped_pension_base,
  pr.labor_pension_employer                             AS employer_contribution,
  pr.labor_pension_employee                             AS employee_contribution,
  COALESCE(e.labor_pension_self_rate, 0)                AS employee_rate_pct,
  pr.labor_pension_employer + pr.labor_pension_employee AS total_contribution,
  pr.payroll_run_id,
  pr.created_at
FROM public.payroll_records pr
JOIN public.employees e ON e.id = pr.employee_id
WHERE pr.labor_pension_employer > 0
   OR pr.labor_pension_employee > 0
ORDER BY pr.pay_period DESC, e.name;

-- v_payroll_summary_monthly
CREATE OR REPLACE VIEW public.v_payroll_summary_monthly
WITH (security_invoker = on) AS
SELECT
  pr.pay_period,
  pr.payroll_run_id,
  e.id              AS employee_id,
  e.name            AS employee_name,
  e.organization_id,
  e.dept,
  e.position,
  e.status          AS employee_status,
  pr.base_salary, pr.role_allowance, pr.meal_allowance, pr.transport_allowance,
  pr.attendance_bonus_earned, pr.overtime_pay,
  pr.ot_hours_weekday, pr.ot_hours_holiday,
  pr.custom_allowances_total, pr.year_end_bonus,
  pr.unused_leave_payout, pr.unused_leave_days,
  pr.gross_salary,
  pr.leave_deduction, pr.leave_days_deducted,
  pr.late_deduction, pr.late_minutes,
  pr.labor_ins_employee, pr.health_ins_employee, pr.labor_pension_employee,
  pr.income_tax_withheld, pr.nhi_supplementary,
  pr.legal_deduction_total, pr.total_deductions,
  pr.labor_ins_employer, pr.health_ins_employer, pr.labor_pension_employer,
  pr.net_salary,
  pr.is_final_settlement, pr.payslip_sent_at, pr.created_at
FROM public.payroll_records pr
JOIN public.employees e ON e.id = pr.employee_id
ORDER BY pr.pay_period DESC, e.name;

-- v_recently_deleted
CREATE OR REPLACE VIEW public.v_recently_deleted
WITH (security_invoker = on) AS
  SELECT 'leave_requests' AS source_table, lr.id AS record_id, lr.employee_id,
         e.name AS employee_name, NULL::INT AS organization_id,
         COALESCE(lr.type, '請假') AS label, lr.deleted_at, lr.deleted_by,
         ((lr.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE) AS days_remaining
  FROM public.leave_requests lr
  LEFT JOIN public.employees e ON e.id = lr.employee_id
  WHERE lr.deleted_at IS NOT NULL AND lr.deleted_at > NOW() - INTERVAL '60 days'
UNION ALL
  SELECT 'overtime_requests', or2.id, or2.employee_id,
         e.name, NULL::INT, '加班申請', or2.deleted_at, or2.deleted_by,
         ((or2.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.overtime_requests or2
  LEFT JOIN public.employees e ON e.id = or2.employee_id
  WHERE or2.deleted_at IS NOT NULL AND or2.deleted_at > NOW() - INTERVAL '60 days'
UNION ALL
  SELECT 'clock_corrections', pc.id, pc.employee_id,
         e.name, NULL::INT, '打卡校正', pc.deleted_at, pc.deleted_by,
         ((pc.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.clock_corrections pc
  LEFT JOIN public.employees e ON e.id = pc.employee_id
  WHERE pc.deleted_at IS NOT NULL AND pc.deleted_at > NOW() - INTERVAL '60 days'
UNION ALL
  SELECT 'business_trips', bt.id, bt.employee_id,
         e.name, bt.organization_id, COALESCE(bt.destination, '出差申請'),
         bt.deleted_at, bt.deleted_by,
         ((bt.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.business_trips bt
  LEFT JOIN public.employees e ON e.id = bt.employee_id
  WHERE bt.deleted_at IS NOT NULL AND bt.deleted_at > NOW() - INTERVAL '60 days'
UNION ALL
  SELECT 'headcount_requests', hr2.id, hr2.employee_id,
         e.name, hr2.organization_id, COALESCE(hr2.job_title, '人力需求'),
         hr2.deleted_at, hr2.deleted_by,
         ((hr2.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.headcount_requests hr2
  LEFT JOIN public.employees e ON e.id = hr2.employee_id
  WHERE hr2.deleted_at IS NOT NULL AND hr2.deleted_at > NOW() - INTERVAL '60 days'
UNION ALL
  SELECT 'expense_requests', er.id, er.employee_id,
         e.name, er.organization_id, COALESCE(er.title, '費用申請'),
         er.deleted_at, er.deleted_by,
         ((er.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.expense_requests er
  LEFT JOIN public.employees e ON e.id = er.employee_id
  WHERE er.deleted_at IS NOT NULL AND er.deleted_at > NOW() - INTERVAL '60 days'
UNION ALL
  SELECT 'form_submissions', fs.id, fs.applicant_id,
         e.name, fs.organization_id, COALESCE(ft.name, '表單申請'),
         fs.deleted_at, fs.deleted_by,
         ((fs.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.form_submissions fs
  LEFT JOIN public.employees    e  ON e.id  = fs.applicant_id
  LEFT JOIN public.form_templates ft ON ft.id = fs.template_id
  WHERE fs.deleted_at IS NOT NULL AND fs.deleted_at > NOW() - INTERVAL '60 days'
UNION ALL
  SELECT 'shift_swaps', ss.id, ss.requester_id,
         e.name, ss.organization_id, '換班申請',
         ss.deleted_at, ss.deleted_by,
         ((ss.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.shift_swaps ss
  LEFT JOIN public.employees e ON e.id = ss.requester_id
  WHERE ss.deleted_at IS NOT NULL AND ss.deleted_at > NOW() - INTERVAL '60 days'
UNION ALL
  SELECT 'off_requests', ofr.id, ofr.employee_id,
         e.name, ofr.organization_id, '休假申請',
         ofr.deleted_at, ofr.deleted_by,
         ((ofr.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.off_requests ofr
  LEFT JOIN public.employees e ON e.id = ofr.employee_id
  WHERE ofr.deleted_at IS NOT NULL AND ofr.deleted_at > NOW() - INTERVAL '60 days';

-- sop_template_analytics
CREATE OR REPLACE VIEW public.sop_template_analytics
WITH (security_invoker = on) AS
SELECT
  t.id                                                          AS template_id,
  t.name                                                        AS template_name,
  COUNT(wi.id)                                                  AS deploy_count,
  COUNT(wi.id) FILTER (WHERE wi.status = 'completed')           AS completed_count,
  CASE
    WHEN COUNT(wi.id) = 0 THEN 0
    ELSE ROUND(
      COUNT(wi.id) FILTER (WHERE wi.status = 'completed')::numeric
      / COUNT(wi.id)::numeric * 100, 2
    )
  END                                                           AS completion_rate
FROM public.sop_templates t
LEFT JOIN public.workflow_instances wi ON wi.template_name = t.name
GROUP BY t.id, t.name;

-- org_positions
CREATE OR REPLACE VIEW public.org_positions
WITH (security_invoker = on) AS
SELECT organization_id, position, COUNT(*) AS headcount
FROM public.employees
WHERE position IS NOT NULL AND position <> ''
GROUP BY organization_id, position
ORDER BY organization_id, position;


-- ============================================================
-- PART 2: Enable RLS on tables that are missing it
-- ============================================================

DO $$ BEGIN

  -- ── attendance_diff_notifications ──────────────────────────
  -- Internal dedup queue written by cron triggers (SECURITY DEFINER).
  -- Authenticated users see only their org's notifications.
  ALTER TABLE public.attendance_diff_notifications ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'attendance_diff_notifications'
      AND policyname = 'attendance_diff_notifications_org_select'
  ) THEN
    CREATE POLICY "attendance_diff_notifications_org_select"
      ON public.attendance_diff_notifications FOR SELECT TO authenticated
      USING (
        employee_id IN (
          SELECT id FROM public.employees
          WHERE organization_id = (
            SELECT organization_id FROM public.employees
            WHERE auth_user_id = auth.uid() LIMIT 1
          )
        )
      );
  END IF;

  -- ── workflow_categories ────────────────────────────────────
  -- Shared taxonomy (no org_id). All authenticated users can manage categories.
  ALTER TABLE public.workflow_categories ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workflow_categories' AND policyname = 'workflow_categories_authenticated_all'
  ) THEN
    CREATE POLICY "workflow_categories_authenticated_all"
      ON public.workflow_categories FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;

  -- ── tags ──────────────────────────────────────────────────
  -- Shared global tag system (no org_id). All authenticated users can manage tags.
  ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tags' AND policyname = 'tags_authenticated_all'
  ) THEN
    CREATE POLICY "tags_authenticated_all"
      ON public.tags FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;

  -- ── task_checklist_item_state ──────────────────────────────
  -- Per-task checklist state. Access allowed when the task belongs to the
  -- user's org (via store, assignee, or project).
  ALTER TABLE public.task_checklist_item_state ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'task_checklist_item_state'
      AND policyname = 'task_checklist_item_state_org_all'
  ) THEN
    CREATE POLICY "task_checklist_item_state_org_all"
      ON public.task_checklist_item_state FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.tasks t
          WHERE t.id = task_id
            AND (
              t.store_id IN (
                SELECT id FROM public.stores
                WHERE organization_id = (
                  SELECT organization_id FROM public.employees
                  WHERE auth_user_id = auth.uid() LIMIT 1
                )
              )
              OR t.assignee_id IN (
                SELECT id FROM public.employees
                WHERE organization_id = (
                  SELECT organization_id FROM public.employees
                  WHERE auth_user_id = auth.uid() LIMIT 1
                )
              )
              OR t.project_id IN (
                SELECT id FROM public.projects
                WHERE organization_id = (
                  SELECT organization_id FROM public.employees
                  WHERE auth_user_id = auth.uid() LIMIT 1
                )
              )
            )
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.tasks t
          WHERE t.id = task_id
            AND (
              t.store_id IN (
                SELECT id FROM public.stores
                WHERE organization_id = (
                  SELECT organization_id FROM public.employees
                  WHERE auth_user_id = auth.uid() LIMIT 1
                )
              )
              OR t.assignee_id IN (
                SELECT id FROM public.employees
                WHERE organization_id = (
                  SELECT organization_id FROM public.employees
                  WHERE auth_user_id = auth.uid() LIMIT 1
                )
              )
              OR t.project_id IN (
                SELECT id FROM public.projects
                WHERE organization_id = (
                  SELECT organization_id FROM public.employees
                  WHERE auth_user_id = auth.uid() LIMIT 1
                )
              )
            )
        )
      );
  END IF;

  -- ── leave_step_settings ────────────────────────────────────
  -- Per-store leave minimum-unit config. Scoped to stores in my org.
  ALTER TABLE public.leave_step_settings ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'leave_step_settings'
      AND policyname = 'leave_step_settings_org_all'
  ) THEN
    CREATE POLICY "leave_step_settings_org_all"
      ON public.leave_step_settings FOR ALL TO authenticated
      USING (
        store_id IS NULL
        OR store_id IN (
          SELECT id FROM public.stores
          WHERE organization_id = (
            SELECT organization_id FROM public.employees
            WHERE auth_user_id = auth.uid() LIMIT 1
          )
        )
      )
      WITH CHECK (
        store_id IS NULL
        OR store_id IN (
          SELECT id FROM public.stores
          WHERE organization_id = (
            SELECT organization_id FROM public.employees
            WHERE auth_user_id = auth.uid() LIMIT 1
          )
        )
      );
  END IF;

  -- ── task_pending_notifications ─────────────────────────────
  -- Drain queue written by DB triggers (SECURITY DEFINER) and drained by
  -- Edge Functions via service_role. No direct authenticated access needed.
  ALTER TABLE public.task_pending_notifications ENABLE ROW LEVEL SECURITY;

  -- ── notification_quiet_queue ───────────────────────────────
  -- Quiet-hours LINE notification buffer. Written and drained by service_role only.
  ALTER TABLE public.notification_quiet_queue ENABLE ROW LEVEL SECURITY;

  -- ── permission_nav_cascade ─────────────────────────────────
  -- Read-only config: maps feature permission codes to nav codes for sidebar cascade.
  ALTER TABLE public.permission_nav_cascade ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'permission_nav_cascade'
      AND policyname = 'permission_nav_cascade_authenticated_select'
  ) THEN
    CREATE POLICY "permission_nav_cascade_authenticated_select"
      ON public.permission_nav_cascade FOR SELECT TO authenticated
      USING (true);
  END IF;

  -- ── inventory_cost_layers ──────────────────────────────────
  -- FEFO cost layer records for WMS. Org-scoped.
  ALTER TABLE public.inventory_cost_layers ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'inventory_cost_layers'
      AND policyname = 'inventory_cost_layers_org_all'
  ) THEN
    CREATE POLICY "inventory_cost_layers_org_all"
      ON public.inventory_cost_layers FOR ALL TO authenticated
      USING (
        organization_id = (
          SELECT organization_id FROM public.employees
          WHERE auth_user_id = auth.uid() LIMIT 1
        )
      )
      WITH CHECK (
        organization_id = (
          SELECT organization_id FROM public.employees
          WHERE auth_user_id = auth.uid() LIMIT 1
        )
      );
  END IF;

  -- ── landed_costs ───────────────────────────────────────────
  -- Inbound order landed cost records (freight, duty, insurance). Org-scoped.
  ALTER TABLE public.landed_costs ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'landed_costs'
      AND policyname = 'landed_costs_org_all'
  ) THEN
    CREATE POLICY "landed_costs_org_all"
      ON public.landed_costs FOR ALL TO authenticated
      USING (
        organization_id = (
          SELECT organization_id FROM public.employees
          WHERE auth_user_id = auth.uid() LIMIT 1
        )
      )
      WITH CHECK (
        organization_id = (
          SELECT organization_id FROM public.employees
          WHERE auth_user_id = auth.uid() LIMIT 1
        )
      );
  END IF;

END $$;
