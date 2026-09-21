-- ════════════════════════════════════════════════════════════════════════════
-- 裝潢報價紀錄（業務申請中心新入口）— 2026-08-11
--   純記錄、不走簽核。一筆報價 = 基本資料 + 金額 + 付款分期(可自訂期數/%/日期/金額)。
--   RLS：讀 org_visible;寫 organization_id = current_employee_org()(對齊 collection_forms)。
--   idempotent。
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- 報價主檔
CREATE TABLE IF NOT EXISTS renovation_quotes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  BIGINT      NOT NULL REFERENCES organizations(id),
  store_name       TEXT        NOT NULL,                 -- 門市(可填新店名)
  address          TEXT,                                 -- 地址
  vendor           TEXT,                                 -- 廠商
  contact_name     TEXT,                                 -- 負責人
  contact_phone    TEXT,                                 -- 電話
  construction_fee NUMERIC     NOT NULL DEFAULT 0,       -- 工程費小計
  mgmt_fee_pct     NUMERIC     NOT NULL DEFAULT 8,       -- 監工管理費 %
  mgmt_fee         NUMERIC     NOT NULL DEFAULT 0,       -- 監工管理費
  tax_pct          NUMERIC     NOT NULL DEFAULT 5,       -- 稅金 %
  tax              NUMERIC     NOT NULL DEFAULT 0,       -- 稅金
  total_amount     NUMERIC     NOT NULL DEFAULT 0,       -- 總價
  quote_date       DATE,                                 -- 報價日期
  note             TEXT,
  status           TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_renovation_quotes_org ON renovation_quotes (organization_id, created_at DESC);
COMMENT ON TABLE renovation_quotes IS '裝潢報價紀錄主檔(純記帳):門市/廠商/金額(工程費+監工%+稅金%=總價)';

-- 付款分期(可自訂期數)
CREATE TABLE IF NOT EXISTS renovation_quote_payments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  BIGINT      NOT NULL REFERENCES organizations(id),
  quote_id         UUID        NOT NULL REFERENCES renovation_quotes(id) ON DELETE CASCADE,
  phase_no         INT         NOT NULL DEFAULT 1,       -- 第幾期
  label            TEXT,                                 -- 名目(簽約金/完工…)
  pct              NUMERIC,                              -- 佔比 %
  due_date         DATE,                                 -- 記錄日期
  amount           NUMERIC,                              -- 金額
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_renovation_quote_payments_q ON renovation_quote_payments (quote_id, phase_no);
COMMENT ON TABLE renovation_quote_payments IS '裝潢報價—付款分期(名目/%/日期/金額,可自訂期數)';

-- RLS
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['renovation_quotes','renovation_quote_payments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (org_visible(organization_id))', t||'_sel', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (organization_id = current_employee_org())', t||'_ins', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (organization_id = current_employee_org()) WITH CHECK (organization_id = current_employee_org())', t||'_upd', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_del', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (organization_id = current_employee_org())', t||'_del', t);
  END LOOP;
END $$;

COMMIT;
