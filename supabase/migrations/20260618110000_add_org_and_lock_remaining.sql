-- ════════════════════════════════════════════════════════════════════════════
-- 補 organization_id 欄並上 RLS：收斂「沒有 org 欄位而無法鎖」的營運表
-- 2026-06-18
--
-- 背景：20260618100000 收斂後仍有 ~68 張表全開，其中一批是「根本沒有 organization_id
--   欄位」的營運表（WMS/CRM/財務：warehouses/stock_levels/suppliers/invoices/
--   accounts_*/journal_*/inbound_*/outbound_*…）。本支幫它們加欄位 + 回填 + 上 org RLS。
--
-- 做法：
--   1) ADD COLUMN organization_id bigint（IF NOT EXISTS；已有非整數型 org 欄的表跳過 RLS）
--   2) 回填現有 row → 目前唯一 org（MIN(organizations.id)）
--   3) 共用 BEFORE INSERT trigger set_org_default：新 row 沒帶 org → 用 current_user_org()，
--      再 fallback 到唯一 org（單一租戶；日後多租戶會用 inserter 的 org，已支援）
--   4) RLS：SELECT 限同 org（org_visible，service/admin 放行）；寫保持寬鬆（不擋建立流程）
--      例外 line_channels（含 access token）→ 讀寫限 admin
--
-- 不處理：參考/系統表(organizations/members/holidays/勞健保級距/role_permissions/
--   module_access/shift_code_times)、採購(purchase_*)、物化檢視(mv_*)、純 created_by/姓名
--   的表(sales_orders/quotations/journal_entries 用 created_by；schedule_data/tax_filings/
--   on/offboarding 用姓名)→ 這些另案(需正規化欄位或本就該全讀)。
--
-- idempotent：ADD COLUMN IF NOT EXISTS、DROP TRIGGER/POLICY IF EXISTS。BEGIN/COMMIT。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 共用 trigger：新 row 自動補 organization_id
CREATE OR REPLACE FUNCTION public.set_org_default()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := COALESCE(current_user_org(), (SELECT MIN(id) FROM organizations));
  END IF;
  RETURN NEW;
END $$;

-- 主迴圈：加欄位 + 回填 + trigger + org RLS
DO $$
DECLARE
  tbls text[] := ARRAY[
    -- 有資料
    'accounts_payable','accounts_receivable','checklist_items','documents','goods_receipts',
    'kpi_data','locations','stock_levels','store_audit_items','suppliers','task_form_bindings',
    'warehouses',
    -- 空表
    'bins','bom','customer_contacts','department_line_groups','ecommerce_connections',
    'ecommerce_sync_logs','inbound_items','inbound_orders','inquiries','invoices',
    'line_daily_summaries','line_monthly_summaries','line_weekly_summaries','marketing_campaigns',
    'mrp_results','opportunities','outbound_items','point_transactions','promotions',
    'quality_inspections','referral_codes','referral_redemptions','returns','sales_returns',
    'service_tickets','shipments','sop_template_versions','workflow_instance_line_group_assignments',
    'workflows'
  ];
  i int; t text; dtype text;
BEGIN
  FOR i IN 1..array_length(tbls,1) LOOP
    t := tbls[i];
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN CONTINUE; END IF;

    -- 加欄位（若無）
    SELECT data_type INTO dtype FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t AND column_name='organization_id';
    IF dtype IS NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN organization_id bigint', t);
      dtype := 'bigint';
    END IF;
    -- 非整數型 org 欄（uuid 等）→ 跳過（不硬轉，避免炸）
    IF dtype NOT IN ('integer','bigint','smallint') THEN CONTINUE; END IF;

    -- 回填現有 null
    EXECUTE format('UPDATE public.%I SET organization_id = (SELECT MIN(id) FROM organizations) WHERE organization_id IS NULL', t);

    -- 新 row 自動補 org
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_org_default ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_set_org_default BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_org_default()', t);

    -- RLS：讀限同 org、寫寬鬆
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    PERFORM public._drop_all_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (org_visible(organization_id))', t||'_org_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (true)', t||'_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (true) WITH CHECK (true)', t||'_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (true)', t||'_del', t);
  END LOOP;
END $$;

-- line_channels（含 LINE access token）→ 讀寫限 admin / service
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='line_channels') THEN
    ALTER TABLE public.line_channels ENABLE ROW LEVEL SECURITY;
    PERFORM public._drop_all_policies('line_channels');
    CREATE POLICY line_channels_admin ON public.line_channels FOR ALL
      USING (is_admin() OR auth.role()='service_role') WITH CHECK (is_admin() OR auth.role()='service_role');
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
