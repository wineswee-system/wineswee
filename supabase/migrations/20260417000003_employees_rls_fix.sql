-- ============================================================
-- 確保所有核心表對 authenticated 用戶開放存取
-- 修復：Google 登入後 authenticated 角色無法查詢的問題
-- ============================================================

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'employees', 'departments', 'stores', 'companies',
    'attendance_records', 'salary_records', 'schedules',
    'leave_requests', 'overtime_requests', 'expenses',
    'shift_definitions', 'holidays', 'punch_corrections',
    'workflow_instances', 'workflow_steps',
    'approval_chains', 'approval_forms', 'approval_form_steps',
    'tasks', 'task_comments', 'task_attachments',
    'accounts', 'journal_entries', 'journal_lines',
    'expense_requests', 'expense_request_attachments',
    'notifications', 'message_logs', 'audit_logs',
    'organizations', 'tenants',
    'line_users', 'line_channels', 'line_user_channels',
    'pos_transactions', 'members', 'quotations',
    'purchase_requests', 'purchase_orders',
    'sop_templates', 'checklists', 'checklist_items',
    'user_stores', 'department_manager_history',
    'benefit_policies', 'bonus_records', 'bonus_settings',
    'documents', 'business_trips', 'clock_corrections'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip if table doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      CONTINUE;
    END IF;

    -- Enable RLS if not already
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    -- Add anon policy if missing
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'anon_' || t) THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO anon USING (true) WITH CHECK (true)', 'anon_' || t, t);
    END IF;

    -- Add authenticated policy if missing
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'auth_' || t) THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', 'auth_' || t, t);
    END IF;
  END LOOP;
END $$;
