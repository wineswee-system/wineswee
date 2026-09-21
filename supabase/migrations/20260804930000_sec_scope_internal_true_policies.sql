-- 資安:收斂內部模組(有 org 欄)的 true 寫入 policy → org_visible — 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 稽核發現:會計(journal/tax/sales/quotations/inventory)、HR(on/offboarding)、
--   專案(custom_field/task_time_logs)、排班(schedule_data)、範本(message_templates)
--   的寫入 policy 用 USING/CHECK=true 無 org 判斷 → 任何已登入員工可跨租戶讀寫別家資料。
-- 修法:比照主系統,收斂成 org_visible(organization_id)(未登入 anon 本就被 grant 擋;
--   org_visible 對未登入者回 false)。已驗證有資料的 journal(4/8)、schedule_data(8)、
--   message_templates(22)每列 org_id 皆非 null,收斂後不會鎖到既有資料。
-- 未處理(另案):會員/問卷消費者端(members/surveys…等,待會員App認證)、無 org 欄者
--   (pos_house_account_txns/tags/workflow_categories…,需 parent/store scope)。
-- ════════════════════════════════════════════════════════════════════════════

-- ── inventory_valuations ──
DROP POLICY IF EXISTS "inventory_valuations_upd" ON public.inventory_valuations;
CREATE POLICY "inventory_valuations_upd" ON public.inventory_valuations FOR UPDATE TO public USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "inventory_valuations_del" ON public.inventory_valuations;
CREATE POLICY "inventory_valuations_del" ON public.inventory_valuations FOR DELETE TO public USING (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "inventory_valuations_ins" ON public.inventory_valuations;
CREATE POLICY "inventory_valuations_ins" ON public.inventory_valuations FOR INSERT TO public WITH CHECK (org_visible(organization_id::bigint));

-- ── journal_entries ──
DROP POLICY IF EXISTS "journal_entries_ins" ON public.journal_entries;
CREATE POLICY "journal_entries_ins" ON public.journal_entries FOR INSERT TO public WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "journal_entries_upd" ON public.journal_entries;
CREATE POLICY "journal_entries_upd" ON public.journal_entries FOR UPDATE TO public USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "journal_entries_del" ON public.journal_entries;
CREATE POLICY "journal_entries_del" ON public.journal_entries FOR DELETE TO public USING (org_visible(organization_id::bigint));

-- ── journal_lines ──
DROP POLICY IF EXISTS "journal_lines_ins" ON public.journal_lines;
CREATE POLICY "journal_lines_ins" ON public.journal_lines FOR INSERT TO public WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "journal_lines_upd" ON public.journal_lines;
CREATE POLICY "journal_lines_upd" ON public.journal_lines FOR UPDATE TO public USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "journal_lines_del" ON public.journal_lines;
CREATE POLICY "journal_lines_del" ON public.journal_lines FOR DELETE TO public USING (org_visible(organization_id::bigint));

-- ── message_templates ──
DROP POLICY IF EXISTS "auth_message_templates" ON public.message_templates;
CREATE POLICY "auth_message_templates" ON public.message_templates FOR ALL TO authenticated USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "anon_message_templates" ON public.message_templates;
CREATE POLICY "anon_message_templates" ON public.message_templates FOR ALL TO anon USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));

-- ── offboarding_plans ──
DROP POLICY IF EXISTS "offboarding_plans_del" ON public.offboarding_plans;
CREATE POLICY "offboarding_plans_del" ON public.offboarding_plans FOR DELETE TO public USING (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "offboarding_plans_upd" ON public.offboarding_plans;
CREATE POLICY "offboarding_plans_upd" ON public.offboarding_plans FOR UPDATE TO public USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "offboarding_plans_ins" ON public.offboarding_plans;
CREATE POLICY "offboarding_plans_ins" ON public.offboarding_plans FOR INSERT TO public WITH CHECK (org_visible(organization_id::bigint));

-- ── onboarding_plans ──
DROP POLICY IF EXISTS "onboarding_plans_upd" ON public.onboarding_plans;
CREATE POLICY "onboarding_plans_upd" ON public.onboarding_plans FOR UPDATE TO public USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "onboarding_plans_del" ON public.onboarding_plans;
CREATE POLICY "onboarding_plans_del" ON public.onboarding_plans FOR DELETE TO public USING (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "onboarding_plans_ins" ON public.onboarding_plans;
CREATE POLICY "onboarding_plans_ins" ON public.onboarding_plans FOR INSERT TO public WITH CHECK (org_visible(organization_id::bigint));

-- ── project_custom_field_defs ──
DROP POLICY IF EXISTS "project_custom_field_defs_upd" ON public.project_custom_field_defs;
CREATE POLICY "project_custom_field_defs_upd" ON public.project_custom_field_defs FOR UPDATE TO public USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "project_custom_field_defs_ins" ON public.project_custom_field_defs;
CREATE POLICY "project_custom_field_defs_ins" ON public.project_custom_field_defs FOR INSERT TO public WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "project_custom_field_defs_del" ON public.project_custom_field_defs;
CREATE POLICY "project_custom_field_defs_del" ON public.project_custom_field_defs FOR DELETE TO public USING (org_visible(organization_id::bigint));

-- ── project_custom_field_values ──
DROP POLICY IF EXISTS "project_custom_field_values_upd" ON public.project_custom_field_values;
CREATE POLICY "project_custom_field_values_upd" ON public.project_custom_field_values FOR UPDATE TO public USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "project_custom_field_values_ins" ON public.project_custom_field_values;
CREATE POLICY "project_custom_field_values_ins" ON public.project_custom_field_values FOR INSERT TO public WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "project_custom_field_values_del" ON public.project_custom_field_values;
CREATE POLICY "project_custom_field_values_del" ON public.project_custom_field_values FOR DELETE TO public USING (org_visible(organization_id::bigint));

-- ── quotations ──
DROP POLICY IF EXISTS "quotations_del" ON public.quotations;
CREATE POLICY "quotations_del" ON public.quotations FOR DELETE TO public USING (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "quotations_ins" ON public.quotations;
CREATE POLICY "quotations_ins" ON public.quotations FOR INSERT TO public WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "quotations_upd" ON public.quotations;
CREATE POLICY "quotations_upd" ON public.quotations FOR UPDATE TO public USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));

-- ── sales_orders ──
DROP POLICY IF EXISTS "sales_orders_ins" ON public.sales_orders;
CREATE POLICY "sales_orders_ins" ON public.sales_orders FOR INSERT TO public WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "sales_orders_del" ON public.sales_orders;
CREATE POLICY "sales_orders_del" ON public.sales_orders FOR DELETE TO public USING (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "sales_orders_upd" ON public.sales_orders;
CREATE POLICY "sales_orders_upd" ON public.sales_orders FOR UPDATE TO public USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));

-- ── schedule_data ──
DROP POLICY IF EXISTS "schedule_data_ins" ON public.schedule_data;
CREATE POLICY "schedule_data_ins" ON public.schedule_data FOR INSERT TO public WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "schedule_data_del" ON public.schedule_data;
CREATE POLICY "schedule_data_del" ON public.schedule_data FOR DELETE TO public USING (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "schedule_data_upd" ON public.schedule_data;
CREATE POLICY "schedule_data_upd" ON public.schedule_data FOR UPDATE TO public USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));

-- ── task_time_logs ──
DROP POLICY IF EXISTS "time_logs_ins" ON public.task_time_logs;
CREATE POLICY "time_logs_ins" ON public.task_time_logs FOR INSERT TO public WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "time_logs_upd" ON public.task_time_logs;
CREATE POLICY "time_logs_upd" ON public.task_time_logs FOR UPDATE TO public USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "time_logs_del" ON public.task_time_logs;
CREATE POLICY "time_logs_del" ON public.task_time_logs FOR DELETE TO public USING (org_visible(organization_id::bigint));

-- ── tax_filings ──
DROP POLICY IF EXISTS "tax_filings_ins" ON public.tax_filings;
CREATE POLICY "tax_filings_ins" ON public.tax_filings FOR INSERT TO public WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "tax_filings_upd" ON public.tax_filings;
CREATE POLICY "tax_filings_upd" ON public.tax_filings FOR UPDATE TO public USING (org_visible(organization_id::bigint)) WITH CHECK (org_visible(organization_id::bigint));
DROP POLICY IF EXISTS "tax_filings_del" ON public.tax_filings;
CREATE POLICY "tax_filings_del" ON public.tax_filings FOR DELETE TO public USING (org_visible(organization_id::bigint));

NOTIFY pgrst, 'reload schema';
