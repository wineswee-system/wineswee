-- ════════════════════════════════════════════════════════════════════════════
-- 收款（表單設定新分類）— 訂金 + 加盟金 + 投資人名冊
-- 2026-08-05
--
-- 需求：
--   1) 訂金：每案一筆、固定目標 30 萬。可分多筆（日期+金額）記錄，
--      加總滿 30 萬 → status='completed'（收款完成）。
--   2) 加盟金：只能掛在「已收款完成」的訂金底下，綁「一位」投資人，
--      填總額 → 自動拆三期 45% / 45% / 10%（第三期用 總額−前兩期，免進位差）。
--      每期可分多筆收款，三期全滿 → status='completed'（收款成功）。
--   3) 投資人名冊：公司(選填)/名字(必填)/電話(必填)，可重複選。
--
-- 純記帳、不走簽核。權限先全開（任何本組織登入員工可記；細項權限之後再接）。
--
-- RLS：讀 org_visible(organization_id)；寫 organization_id = current_employee_org()
--   （對齊 20260705180000_allowances.sql 的既有 pattern；anon → current_employee_org()=NULL → 擋）。
-- 加總 / 狀態自動完成 / 訂金完成守門：一律 SECURITY DEFINER trigger（繞 RLS 更新母單）。
-- idempotent：IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE。BEGIN/COMMIT。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 投資人名冊 ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collection_investors (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT      NOT NULL REFERENCES organizations(id),
  company         TEXT,                          -- 選填
  name            TEXT        NOT NULL,          -- 必填
  phone           TEXT        NOT NULL,          -- 必填
  note            TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_collection_investors_org ON collection_investors (organization_id);
COMMENT ON TABLE collection_investors IS '收款—投資人名冊（可重複選）：公司選填、名字/電話必填';

-- ─── 2. 訂金主檔（固定 30 萬）─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deposit_records (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT      NOT NULL REFERENCES organizations(id),
  title           TEXT        NOT NULL,                       -- 標的/案子名稱
  target_amount   NUMERIC     NOT NULL DEFAULT 300000,        -- 固定 30 萬
  paid_total      NUMERIC     NOT NULL DEFAULT 0,             -- 由 trigger 維護
  status          TEXT        NOT NULL DEFAULT 'collecting'
                              CHECK (status IN ('collecting','completed')),
  note            TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_deposit_records_org_status ON deposit_records (organization_id, status);
COMMENT ON TABLE deposit_records IS '收款—訂金主檔：固定目標 30 萬，多筆收款加總滿額 → completed';

-- ─── 3. 訂金收款明細 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deposit_payments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT      NOT NULL REFERENCES organizations(id),
  deposit_id      UUID        NOT NULL REFERENCES deposit_records(id) ON DELETE CASCADE,
  paid_date       DATE        NOT NULL,
  amount          NUMERIC     NOT NULL CHECK (amount > 0),
  note            TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deposit_payments_dep ON deposit_payments (deposit_id, paid_date);
COMMENT ON TABLE deposit_payments IS '收款—訂金收款明細（多筆日期+金額）';

-- ─── 4. 加盟金主檔（綁已完成訂金 + 一位投資人）────────────────────────────────
CREATE TABLE IF NOT EXISTS franchise_fees (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT      NOT NULL REFERENCES organizations(id),
  deposit_id      UUID        NOT NULL REFERENCES deposit_records(id),          -- 限已 completed
  investor_id     UUID        NOT NULL REFERENCES collection_investors(id),     -- 一位投資人
  total_amount    NUMERIC     NOT NULL CHECK (total_amount > 0),
  -- 三期目標由 total 拆：t1=round(total*.45), t2=round(total*.45), t3=total-t1-t2（免進位差）
  paid_stage1     NUMERIC     NOT NULL DEFAULT 0,   -- 由 trigger 維護
  paid_stage2     NUMERIC     NOT NULL DEFAULT 0,
  paid_stage3     NUMERIC     NOT NULL DEFAULT 0,
  paid_total      NUMERIC     NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'collecting'
                              CHECK (status IN ('collecting','completed')),
  note            TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_franchise_fees_org_status ON franchise_fees (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_franchise_fees_deposit ON franchise_fees (deposit_id);
COMMENT ON TABLE franchise_fees IS '收款—加盟金主檔：綁已完成訂金 + 一位投資人；總額自動拆 45/45/10 三期，全滿 → completed';

-- ─── 5. 加盟金收款明細（分期）─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS franchise_fee_payments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   BIGINT      NOT NULL REFERENCES organizations(id),
  franchise_fee_id  UUID        NOT NULL REFERENCES franchise_fees(id) ON DELETE CASCADE,
  stage             SMALLINT    NOT NULL CHECK (stage IN (1,2,3)),
  paid_date         DATE        NOT NULL,
  amount            NUMERIC     NOT NULL CHECK (amount > 0),
  note              TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ff_payments_ff ON franchise_fee_payments (franchise_fee_id, stage, paid_date);
COMMENT ON TABLE franchise_fee_payments IS '收款—加盟金收款明細（stage 1/2/3、日期、金額）';

-- ═══ 加總 + 狀態自動完成 triggers（SECURITY DEFINER 繞 RLS 更新母單）═══════════

-- 訂金：明細變動 → 重算 paid_total + 滿 30 萬自動 completed
CREATE OR REPLACE FUNCTION public.tg_deposit_recalc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dep UUID; v_sum NUMERIC; v_target NUMERIC;
BEGIN
  v_dep := COALESCE(NEW.deposit_id, OLD.deposit_id);
  SELECT COALESCE(SUM(amount), 0) INTO v_sum FROM deposit_payments WHERE deposit_id = v_dep;
  SELECT target_amount INTO v_target FROM deposit_records WHERE id = v_dep;
  UPDATE deposit_records
     SET paid_total   = v_sum,
         status       = CASE WHEN v_sum >= v_target THEN 'completed' ELSE 'collecting' END,
         completed_at = CASE WHEN v_sum >= v_target THEN COALESCE(completed_at, now()) ELSE NULL END
   WHERE id = v_dep;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_deposit_recalc ON deposit_payments;
CREATE TRIGGER trg_deposit_recalc AFTER INSERT OR UPDATE OR DELETE ON deposit_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_deposit_recalc();

-- 加盟金：明細變動 → 重算三期 + 全滿自動 completed
CREATE OR REPLACE FUNCTION public.tg_franchise_recalc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ff UUID; v_total NUMERIC;
  v_s1 NUMERIC; v_s2 NUMERIC; v_s3 NUMERIC;
  v_t1 NUMERIC; v_t2 NUMERIC; v_t3 NUMERIC;
  v_done BOOLEAN;
BEGIN
  v_ff := COALESCE(NEW.franchise_fee_id, OLD.franchise_fee_id);
  SELECT total_amount INTO v_total FROM franchise_fees WHERE id = v_ff;
  SELECT COALESCE(SUM(amount) FILTER (WHERE stage = 1), 0),
         COALESCE(SUM(amount) FILTER (WHERE stage = 2), 0),
         COALESCE(SUM(amount) FILTER (WHERE stage = 3), 0)
    INTO v_s1, v_s2, v_s3
    FROM franchise_fee_payments WHERE franchise_fee_id = v_ff;
  v_t1 := round(v_total * 0.45);
  v_t2 := round(v_total * 0.45);
  v_t3 := v_total - v_t1 - v_t2;
  v_done := (v_s1 >= v_t1 AND v_s2 >= v_t2 AND v_s3 >= v_t3);
  UPDATE franchise_fees
     SET paid_stage1  = v_s1,
         paid_stage2  = v_s2,
         paid_stage3  = v_s3,
         paid_total   = v_s1 + v_s2 + v_s3,
         status       = CASE WHEN v_done THEN 'completed' ELSE 'collecting' END,
         completed_at = CASE WHEN v_done THEN COALESCE(completed_at, now()) ELSE NULL END
   WHERE id = v_ff;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_franchise_recalc ON franchise_fee_payments;
CREATE TRIGGER trg_franchise_recalc AFTER INSERT OR UPDATE OR DELETE ON franchise_fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_franchise_recalc();

-- 守門：加盟金只能掛在「已收款完成」的訂金底下
CREATE OR REPLACE FUNCTION public.tg_franchise_guard_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_st TEXT;
BEGIN
  SELECT status INTO v_st FROM deposit_records WHERE id = NEW.deposit_id;
  IF v_st IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION '訂金尚未收款完成，無法建立加盟金收款';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_franchise_guard_deposit ON franchise_fees;
CREATE TRIGGER trg_franchise_guard_deposit BEFORE INSERT ON franchise_fees
  FOR EACH ROW EXECUTE FUNCTION public.tg_franchise_guard_deposit();

-- ═══ RLS ═════════════════════════════════════════════════════════════════════
ALTER TABLE collection_investors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE franchise_fees          ENABLE ROW LEVEL SECURITY;
ALTER TABLE franchise_fee_payments  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['collection_investors','deposit_records','deposit_payments','franchise_fees','franchise_fee_payments']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (org_visible(organization_id))', t || '_sel', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (organization_id = current_employee_org())', t || '_ins', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (organization_id = current_employee_org()) WITH CHECK (organization_id = current_employee_org())', t || '_upd', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_del', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (organization_id = current_employee_org())', t || '_del', t);

    -- PostgREST 需要 table-level grant（RLS 仍為閘門）；anon 不給（登入=authenticated）
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
