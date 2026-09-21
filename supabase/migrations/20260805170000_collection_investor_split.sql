-- ════════════════════════════════════════════════════════════════════════════
-- 收款 v2：訂金綁一位投資人 + 加盟金多位投資人分攤（各自 45/45/10）
-- 2026-08-05（改 20260805160000 的加盟金結構）
--
-- 需求修正：
--   - 訂金：新增時綁「一位」投資人（deposit_records.investor_id）。
--   - 加盟金：一筆總額，從名冊拉「多位」投資人各設分攤額（Σ=總額）；
--     每位分攤額各自拆三期 45/45/10；每筆收款記「哪位+哪期」；
--     每位三期全滿→該位完成，全部投資人完成→加盟金 completed。
--
-- 加盟金三表（franchise_fees / franchise_fee_payments）尚無資料 → 直接 DROP 重建，
-- 並新增分攤表 franchise_fee_investors。訂金/明細/投資人名冊沿用 20260805160000。
-- RLS 同前（org_visible 讀 / current_employee_org() 寫）。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 訂金綁一位投資人 ──────────────────────────────────────────────────────
ALTER TABLE public.deposit_records
  ADD COLUMN IF NOT EXISTS investor_id UUID REFERENCES collection_investors(id);

-- ─── 2. 重建加盟金三表（舊結構 investor_id/paid_stage 在母單上 → 改分攤表）──────
DROP TABLE IF EXISTS public.franchise_fee_payments CASCADE;
DROP TABLE IF EXISTS public.franchise_fees CASCADE;
DROP FUNCTION IF EXISTS public.tg_franchise_recalc() CASCADE;   -- 舊母單層三期 recalc 不再用

CREATE TABLE public.franchise_fees (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT      NOT NULL REFERENCES organizations(id),
  deposit_id      UUID        NOT NULL REFERENCES deposit_records(id),   -- 限已 completed（guard）
  total_amount    NUMERIC     NOT NULL CHECK (total_amount > 0),
  paid_total      NUMERIC     NOT NULL DEFAULT 0,                        -- trigger 維護
  status          TEXT        NOT NULL DEFAULT 'collecting'
                              CHECK (status IN ('collecting','completed')),
  note            TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX idx_franchise_fees_org_status ON public.franchise_fees (organization_id, status);
CREATE INDEX idx_franchise_fees_deposit ON public.franchise_fees (deposit_id);
COMMENT ON TABLE public.franchise_fees IS '收款—加盟金主檔：綁已完成訂金；總額由多位投資人分攤，每位各自 45/45/10';

-- 分攤表：一筆加盟金 → 多位投資人各自分攤額 + 各自三期已收（trigger 維護）
CREATE TABLE public.franchise_fee_investors (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   BIGINT      NOT NULL REFERENCES organizations(id),
  franchise_fee_id  UUID        NOT NULL REFERENCES franchise_fees(id) ON DELETE CASCADE,
  investor_id       UUID        NOT NULL REFERENCES collection_investors(id),
  amount            NUMERIC     NOT NULL CHECK (amount > 0),   -- 該投資人分攤額（A=3,500,000）
  paid_stage1       NUMERIC     NOT NULL DEFAULT 0,
  paid_stage2       NUMERIC     NOT NULL DEFAULT 0,
  paid_stage3       NUMERIC     NOT NULL DEFAULT 0,
  UNIQUE (franchise_fee_id, investor_id)
);
CREATE INDEX idx_ffi_ff ON public.franchise_fee_investors (franchise_fee_id);
COMMENT ON TABLE public.franchise_fee_investors IS '收款—加盟金分攤：每位投資人分攤額，三期目標 = amount × 45/45/10';

-- 收款明細：記「哪位投資人 + 哪期」
CREATE TABLE public.franchise_fee_payments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   BIGINT      NOT NULL REFERENCES organizations(id),
  franchise_fee_id  UUID        NOT NULL REFERENCES franchise_fees(id) ON DELETE CASCADE,
  investor_id       UUID        NOT NULL REFERENCES collection_investors(id),
  stage             SMALLINT    NOT NULL CHECK (stage IN (1,2,3)),
  paid_date         DATE        NOT NULL,
  amount            NUMERIC     NOT NULL CHECK (amount > 0),
  note              TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ff_payments_ff ON public.franchise_fee_payments (franchise_fee_id, investor_id, stage, paid_date);
COMMENT ON TABLE public.franchise_fee_payments IS '收款—加盟金收款明細（投資人 + stage 1/2/3 + 日期 + 金額）';

-- ─── 3. 重算：母單 paid_total + 完成判定（每位投資人三期全滿）──────────────────
CREATE OR REPLACE FUNCTION public._recompute_franchise(p_ff UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total_paid NUMERIC; v_all_done BOOLEAN; v_has BOOLEAN;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM franchise_fee_payments WHERE franchise_fee_id = p_ff;
  SELECT EXISTS (SELECT 1 FROM franchise_fee_investors WHERE franchise_fee_id = p_ff) INTO v_has;
  -- 每位：三期各滿（t1=round(amt*.45), t2=round(amt*.45), t3=amt-t1-t2）
  SELECT bool_and(
           paid_stage1 >= round(amount * 0.45)
       AND paid_stage2 >= round(amount * 0.45)
       AND paid_stage3 >= amount - round(amount * 0.45) - round(amount * 0.45)
         )
    INTO v_all_done
    FROM franchise_fee_investors WHERE franchise_fee_id = p_ff;
  UPDATE franchise_fees
     SET paid_total   = v_total_paid,
         status       = CASE WHEN v_has AND COALESCE(v_all_done, false) THEN 'completed' ELSE 'collecting' END,
         completed_at = CASE WHEN v_has AND COALESCE(v_all_done, false) THEN COALESCE(completed_at, now()) ELSE NULL END
   WHERE id = p_ff;
END $$;

-- 明細變動 → 重算「該投資人三期」+ 母單完成判定
CREATE OR REPLACE FUNCTION public.tg_ff_payment_recalc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ff UUID; v_inv UUID; v_s1 NUMERIC; v_s2 NUMERIC; v_s3 NUMERIC;
BEGIN
  v_ff  := COALESCE(NEW.franchise_fee_id, OLD.franchise_fee_id);
  v_inv := COALESCE(NEW.investor_id, OLD.investor_id);
  SELECT COALESCE(SUM(amount) FILTER (WHERE stage = 1), 0),
         COALESCE(SUM(amount) FILTER (WHERE stage = 2), 0),
         COALESCE(SUM(amount) FILTER (WHERE stage = 3), 0)
    INTO v_s1, v_s2, v_s3
    FROM franchise_fee_payments WHERE franchise_fee_id = v_ff AND investor_id = v_inv;
  UPDATE franchise_fee_investors
     SET paid_stage1 = v_s1, paid_stage2 = v_s2, paid_stage3 = v_s3
   WHERE franchise_fee_id = v_ff AND investor_id = v_inv;
  PERFORM public._recompute_franchise(v_ff);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_ff_payment_recalc ON public.franchise_fee_payments;
CREATE TRIGGER trg_ff_payment_recalc AFTER INSERT OR UPDATE OR DELETE ON public.franchise_fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_ff_payment_recalc();

-- 分攤（投資人/金額）變動 → 重算母單完成判定
CREATE OR REPLACE FUNCTION public.tg_ffi_recalc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._recompute_franchise(COALESCE(NEW.franchise_fee_id, OLD.franchise_fee_id));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_ffi_recalc ON public.franchise_fee_investors;
CREATE TRIGGER trg_ffi_recalc AFTER INSERT OR UPDATE OR DELETE ON public.franchise_fee_investors
  FOR EACH ROW EXECUTE FUNCTION public.tg_ffi_recalc();

-- 守門：加盟金只能掛「已收款完成」的訂金
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
DROP TRIGGER IF EXISTS trg_franchise_guard_deposit ON public.franchise_fees;
CREATE TRIGGER trg_franchise_guard_deposit BEFORE INSERT ON public.franchise_fees
  FOR EACH ROW EXECUTE FUNCTION public.tg_franchise_guard_deposit();

-- ─── 4. RLS + grant（重建的三表）─────────────────────────────────────────────
ALTER TABLE public.franchise_fees          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.franchise_fee_investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.franchise_fee_payments  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['franchise_fees','franchise_fee_investors','franchise_fee_payments']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (org_visible(organization_id))', t || '_sel', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (organization_id = current_employee_org())', t || '_ins', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (organization_id = current_employee_org()) WITH CHECK (organization_id = current_employee_org())', t || '_upd', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_del', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (organization_id = current_employee_org())', t || '_del', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
