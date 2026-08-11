-- ════════════════════════════════════════════════════════════════════════════
-- 裝潢報價—工程項目明細 + 「發票另開」處理 — 2026-08-11
--   逐項填(拆除/水電/…);沒勾發票另開 → 算進工程費小計(吃監工%+稅金%);
--   勾發票另開 → 含稅、不吃監工/稅金,單獨加到總價。
--   總價 = (工程費小計 + 監工 + 稅金) + 發票另開合計。
--   RLS 需 renovation.manage(對齊主檔)。idempotent。
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- 主檔加「發票另開合計」欄(工程費小計仍存既有 construction_fee = 非發票另開項合計)
ALTER TABLE public.renovation_quotes
  ADD COLUMN IF NOT EXISTS invoice_separate_total NUMERIC NOT NULL DEFAULT 0;

-- 工程項目明細
CREATE TABLE IF NOT EXISTS renovation_quote_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   BIGINT      NOT NULL REFERENCES organizations(id),
  quote_id          UUID        NOT NULL REFERENCES renovation_quotes(id) ON DELETE CASCADE,
  seq               INT         NOT NULL DEFAULT 1,       -- 項次
  name              TEXT,                                 -- 施工項目
  amount            NUMERIC     NOT NULL DEFAULT 0,       -- 報價
  invoice_separate  BOOLEAN     NOT NULL DEFAULT false,   -- 發票另開(含稅、不吃監工/稅金、單獨加)
  note              TEXT,                                 -- 備註
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_renovation_quote_items_q ON renovation_quote_items (quote_id, seq);
COMMENT ON TABLE renovation_quote_items IS '裝潢報價—工程項目明細(逐項報價;invoice_separate=發票另開,不吃監工/稅金)';

-- RLS 需 renovation.manage(對齊主檔)
DO $$
DECLARE t text := 'renovation_quote_items';
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_sel', t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.current_employee_has_permission(''renovation.manage'') AND org_visible(organization_id))', t||'_sel', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_ins', t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.current_employee_has_permission(''renovation.manage'') AND organization_id = current_employee_org())', t||'_ins', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_upd', t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (public.current_employee_has_permission(''renovation.manage'') AND organization_id = current_employee_org()) WITH CHECK (organization_id = current_employee_org())', t||'_upd', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_del', t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (public.current_employee_has_permission(''renovation.manage'') AND organization_id = current_employee_org())', t||'_del', t);
END $$;

COMMIT;
NOTIFY pgrst, 'reload schema';
