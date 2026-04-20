-- ============================================================
-- Phase 3.2 — Add ON DELETE rules + indexes on FK columns lacking them
--
-- Live state: ~60 FK columns identified without indexes; multiple FKs lack
-- explicit ON DELETE behavior (default RESTRICT, throws on parent delete).
--
-- Strategy:
--   - Indexes: idempotent CREATE INDEX IF NOT EXISTS
--   - ON DELETE: drop-and-recreate the constraint with the new rule
--   - For parent→child relationships where child should follow parent: CASCADE
--   - For audit/log relationships where child should survive: SET NULL
--
-- Risk: LOW (additive). Constraint replacement runs in a single transaction.
-- ============================================================

BEGIN;

-- ----- Indexes on FK columns -----
CREATE INDEX IF NOT EXISTS idx_attendance_store ON public.attendance_records(store_id);
CREATE INDEX IF NOT EXISTS idx_attendance_employee ON public.attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_employee ON public.leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_approved_by ON public.leave_requests(approved_by);
CREATE INDEX IF NOT EXISTS idx_overtime_employee ON public.overtime_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_overtime_approved_by ON public.overtime_requests(approved_by);
CREATE INDEX IF NOT EXISTS idx_salary_employee ON public.salary_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_punch_corrections_employee ON public.punch_corrections(employee_id);
CREATE INDEX IF NOT EXISTS idx_off_requests_employee ON public.off_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_schedules_employee ON public.schedules(employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_reporting_to ON public.employees(reporting_to);

CREATE INDEX IF NOT EXISTS idx_companies_org ON public.companies(organization_id);
CREATE INDEX IF NOT EXISTS idx_departments_company ON public.departments(company_id);
CREATE INDEX IF NOT EXISTS idx_stores_department ON public.stores(department_id);
CREATE INDEX IF NOT EXISTS idx_dmh_org ON public.department_manager_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_dmh_store ON public.department_manager_history(store_id);
CREATE INDEX IF NOT EXISTS idx_permissions_org ON public.permissions(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_org ON public.projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_expense_org ON public.expense_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_expense_chain ON public.expense_requests(approval_chain_id);

CREATE INDEX IF NOT EXISTS idx_emp_dependents ON public.employee_dependents(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_reviews ON public.employee_reviews(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_skills ON public.employee_skills(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_transfers ON public.employee_transfers(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_sched_prefs ON public.employee_schedule_prefs(employee_id);

CREATE INDEX IF NOT EXISTS idx_tasks_chain ON public.tasks(approval_chain_id);
CREATE INDEX IF NOT EXISTS idx_approval_forms_step ON public.approval_forms(ref_step_id);
CREATE INDEX IF NOT EXISTS idx_approval_forms_task ON public.approval_forms(ref_task_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_rule ON public.approval_requests(rule_id);

CREATE INDEX IF NOT EXISTS idx_bins_warehouse ON public.bins(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_bonus_employee ON public.bonus_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_bonus_policy ON public.bonus_records(policy_id);
CREATE INDEX IF NOT EXISTS idx_bonus_store ON public.bonus_records(store_id);
CREATE INDEX IF NOT EXISTS idx_bonus_settings_store ON public.bonus_settings(store_id);

CREATE INDEX IF NOT EXISTS idx_checklist_items_chk ON public.checklist_items(checklist_id);
CREATE INDEX IF NOT EXISTS idx_checklists_store ON public.checklists(store_id);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_cust ON public.customer_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_po ON public.goods_receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_inbound_items_ord ON public.inbound_items(inbound_order_id);
CREATE INDEX IF NOT EXISTS idx_inbound_items_sku ON public.inbound_items(sku_id);
CREATE INDEX IF NOT EXISTS idx_outbound_items_ord ON public.outbound_items(outbound_order_id);

CREATE INDEX IF NOT EXISTS idx_jl_entry ON public.journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_je_creator ON public.journal_entries(created_by_id);
CREATE INDEX IF NOT EXISTS idx_mrp_bom ON public.mrp_results(bom_id);
CREATE INDEX IF NOT EXISTS idx_org_payments_sub ON public.org_payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_creator ON public.payroll_runs(created_by);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_cashier ON public.pos_shifts(cashier_id);
CREATE INDEX IF NOT EXISTS idx_pos_member ON public.pos_transactions(member_id_fk);
CREATE INDEX IF NOT EXISTS idx_po_pr ON public.purchase_orders(pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_dept ON public.purchase_requests(department_id);
CREATE INDEX IF NOT EXISTS idx_pr_approver ON public.purchase_requests(approved_by_id);
CREATE INDEX IF NOT EXISTS idx_quotations_creator ON public.quotations(created_by_id);
CREATE INDEX IF NOT EXISTS idx_referral_red_referee ON public.referral_redemptions(referee_id);
CREATE INDEX IF NOT EXISTS idx_referral_red_referrer ON public.referral_redemptions(referrer_id);
CREATE INDEX IF NOT EXISTS idx_returns_processor ON public.returns(processed_by_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_creator ON public.sales_orders(created_by_id);
CREATE INDEX IF NOT EXISTS idx_shift_def_store ON public.shift_definitions(store_id);
CREATE INDEX IF NOT EXISTS idx_stock_levels_bin ON public.stock_levels(bin_id);
CREATE INDEX IF NOT EXISTS idx_stock_levels_sku ON public.stock_levels(sku_id);
CREATE INDEX IF NOT EXISTS idx_stock_levels_wh ON public.stock_levels(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_instance ON public.workflow_steps(instance_id);

-- ----- ON DELETE rules: rebuild constraints with explicit behavior -----
-- Helper: drop-and-recreate FK with new ON DELETE clause.
-- Pattern: parent-owns-child → CASCADE; reference-only → SET NULL.

DO $$
DECLARE
  r RECORD;
BEGIN
  -- attendance_records.employee_id → employees: CASCADE (employee gone, attendance gone)
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='public.attendance_records'::regclass AND contype='f'
      AND conname LIKE '%employee_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.attendance_records DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE public.attendance_records
    ADD CONSTRAINT attendance_records_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

  -- leave_requests.employee_id → CASCADE
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='public.leave_requests'::regclass AND contype='f'
      AND conname LIKE '%employee_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.leave_requests DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE public.leave_requests
    ADD CONSTRAINT leave_requests_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

  -- overtime_requests.employee_id → CASCADE
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='public.overtime_requests'::regclass AND contype='f'
      AND conname LIKE '%employee_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.overtime_requests DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE public.overtime_requests
    ADD CONSTRAINT overtime_requests_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

  -- salary_records.employee_id → CASCADE
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='public.salary_records'::regclass AND contype='f'
      AND conname LIKE '%employee_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.salary_records DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE public.salary_records
    ADD CONSTRAINT salary_records_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

  -- punch_corrections.employee_id → CASCADE
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='public.punch_corrections'::regclass AND contype='f'
      AND conname LIKE '%employee_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.punch_corrections DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE public.punch_corrections
    ADD CONSTRAINT punch_corrections_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

  -- schedules.employee_id → CASCADE
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='public.schedules'::regclass AND contype='f'
      AND conname LIKE '%employee_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.schedules DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE public.schedules
    ADD CONSTRAINT schedules_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;
END $$;

COMMIT;
