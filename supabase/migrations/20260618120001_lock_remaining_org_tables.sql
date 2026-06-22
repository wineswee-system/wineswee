-- ════════════════════════════════════════════════════════════════════════════
-- RLS 收斂收尾：剩餘可鎖的營運/財務表（只有 created_by/姓名欄的）補 org + 上 RLS
-- 2026-06-18
--
-- 承 20260618110000。剩下全開的 26 張中，這批是「有業務資料但只有 created_by 或
-- 姓名欄」的：journal_entries/lines(財務分錄)、sales_orders、quotations、
-- project_templates/comments/custom_field_*、on/offboarding_plans、tax_filings、schedule_data。
-- 一律加 organization_id + 回填 + set_org_default trigger + org RLS(讀限同 org、寫寬鬆)。
-- event_outbox / triggers(系統事件表)→ 讀寫限 admin/service。
--
-- 刻意維持原狀(不在本支)：
--   參考表 holidays/health_ins_brackets/labor_ins_brackets/shift_code_times/module_access/
--     role_permissions/organizations/members(本就該全讀，國定/級距等全國一致)
--   物化檢視 mv_customer_revenue/mv_daily_sales(MV 的 RLS 方式不同，另案)
--   採購 purchase_requests/purchase_orders(採購部需看全部，另案)
--   財務分錄目前用 org-read(同公司可看)；若要收到財務角色才看，日後再加 role 條件。
--
-- idempotent。依賴 20260618100000/110000 的 helper(org_visible/current_user_org/
--   set_org_default/_drop_all_policies)。BEGIN/COMMIT。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  tbls text[] := ARRAY[
    'journal_entries','journal_lines','sales_orders','quotations','project_templates',
    'project_comments','project_custom_field_defs','project_custom_field_values',
    'offboarding_plans','onboarding_plans','tax_filings','schedule_data'
  ];
  i int; t text; dtype text;
BEGIN
  FOR i IN 1..array_length(tbls,1) LOOP
    t := tbls[i];
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN CONTINUE; END IF;

    SELECT data_type INTO dtype FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t AND column_name='organization_id';
    IF dtype IS NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN organization_id bigint', t);
      dtype := 'bigint';
    END IF;
    IF dtype NOT IN ('integer','bigint','smallint') THEN CONTINUE; END IF;

    EXECUTE format('UPDATE public.%I SET organization_id = (SELECT MIN(id) FROM organizations) WHERE organization_id IS NULL', t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_org_default ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_set_org_default BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_org_default()', t);

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    PERFORM public._drop_all_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (org_visible(organization_id))', t||'_org_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (true)', t||'_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (true) WITH CHECK (true)', t||'_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (true)', t||'_del', t);
  END LOOP;
END $$;

-- 系統事件表 → 只有 admin / service
DO $$
DECLARE tbls text[] := ARRAY['event_outbox','triggers']; i int; t text;
BEGIN
  FOR i IN 1..array_length(tbls,1) LOOP
    t := tbls[i];
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    PERFORM public._drop_all_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (is_admin() OR auth.role()=''service_role'') WITH CHECK (is_admin() OR auth.role()=''service_role'')', t||'_admin_only', t);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
