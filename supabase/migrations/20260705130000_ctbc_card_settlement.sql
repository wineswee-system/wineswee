-- ─────────────────────────────────────────────────────────────────────────────
-- F-D1 信用卡收單 = 中國信託（與 ECPay 脫鉤）
--
-- 1. pos_payments 加卡收欄位：card_brand / card_last4 / auth_code / acquirer /
--    settlement_batch_id（+ gateway / merchant_trade_no / gateway_transaction_id：
--    ecpay-callback 既已引用但先前未入 migration，此處一併補齊）
-- 2. settlement_batches：中信每日請款批次（批次號、總額、手續費、入帳日）
--    acquirer 欄留通用，未來可多收單行
-- 3. secure_close_settlement_batch RPC：結算批次（金額/狀態轉換一律走 RPC）
--
-- 冪等：可重複執行。不修改任何既有 migration。
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. pos_payments 卡收欄位
ALTER TABLE public.pos_payments ADD COLUMN IF NOT EXISTS card_brand TEXT;
ALTER TABLE public.pos_payments ADD COLUMN IF NOT EXISTS card_last4 TEXT;
ALTER TABLE public.pos_payments ADD COLUMN IF NOT EXISTS auth_code  TEXT;
ALTER TABLE public.pos_payments ADD COLUMN IF NOT EXISTS acquirer   TEXT;
ALTER TABLE public.pos_payments ADD COLUMN IF NOT EXISTS settlement_batch_id UUID;
-- 金流通道欄位（ecpay-callback / ctbc-card-callback 依 merchant_trade_no 回寫）
ALTER TABLE public.pos_payments ADD COLUMN IF NOT EXISTS gateway TEXT;
ALTER TABLE public.pos_payments ADD COLUMN IF NOT EXISTS merchant_trade_no TEXT;
ALTER TABLE public.pos_payments ADD COLUMN IF NOT EXISTS gateway_transaction_id TEXT;
ALTER TABLE public.pos_payments ADD COLUMN IF NOT EXISTS status TEXT;

-- 2. 請款批次
CREATE TABLE IF NOT EXISTS public.settlement_batches (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INT     NOT NULL REFERENCES organizations(id),
  store_id        INT     REFERENCES stores(id),
  acquirer        TEXT    NOT NULL DEFAULT 'CTBC',
  batch_number    TEXT    NOT NULL,
  batch_date      DATE    NOT NULL DEFAULT CURRENT_DATE,
  gross_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  fee_amount      NUMERIC(12,2),
  net_amount      NUMERIC(12,2),
  deposit_date    DATE,
  status          TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','settled')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, acquirer, batch_number)
);

-- pos_payments.settlement_batch_id → settlement_batches FK（冪等加約束）
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_pos_payments_settlement_batch'
  ) THEN
    ALTER TABLE public.pos_payments
      ADD CONSTRAINT fk_pos_payments_settlement_batch
      FOREIGN KEY (settlement_batch_id) REFERENCES public.settlement_batches(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_payments_settlement_batch
  ON public.pos_payments(settlement_batch_id) WHERE settlement_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_payments_merchant_trade_no
  ON public.pos_payments(merchant_trade_no) WHERE merchant_trade_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_settlement_batches_org_date
  ON public.settlement_batches(organization_id, batch_date DESC);

-- RLS（沿用 pos 表 org-scoped "staff" 模式）
ALTER TABLE public.settlement_batches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'settlement_batches' AND policyname = 'staff') THEN
    CREATE POLICY "staff" ON public.settlement_batches
      FOR ALL TO authenticated USING (organization_id = auth_org_id());
  END IF;
END $$;

-- 3. 結算批次 RPC（金額計算 + 狀態轉換 → SECURITY DEFINER）
--    驗證 gross_amount = 已掛入本批次的 pos_payments 金額合計，
--    寫入手續費、net = gross - fee、入帳日，狀態 → 'settled'。
CREATE OR REPLACE FUNCTION public.secure_close_settlement_batch(
  p_batch_id     UUID,
  p_fee_amount   NUMERIC,
  p_deposit_date DATE DEFAULT NULL
) RETURNS settlement_batches
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org    INT;
  v_batch  settlement_batches;
  v_sum    NUMERIC;
BEGIN
  v_org := auth_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  SELECT * INTO v_batch FROM settlement_batches
  WHERE id = p_batch_id AND organization_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '找不到請款批次'; END IF;

  IF v_batch.status = 'settled' THEN RAISE EXCEPTION '批次已結算，不可重複結算'; END IF;

  IF p_fee_amount IS NULL OR p_fee_amount < 0 THEN RAISE EXCEPTION '手續費不可為負'; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_sum
  FROM pos_payments
  WHERE settlement_batch_id = p_batch_id AND organization_id = v_org;

  IF v_batch.gross_amount IS DISTINCT FROM v_sum THEN
    RAISE EXCEPTION '批次總額 % 與卡收明細合計 % 不符，請先重新歸批', v_batch.gross_amount, v_sum;
  END IF;

  IF p_fee_amount > v_sum THEN RAISE EXCEPTION '手續費 % 不可大於批次總額 %', p_fee_amount, v_sum; END IF;

  UPDATE settlement_batches SET
    fee_amount   = p_fee_amount,
    net_amount   = v_sum - p_fee_amount,
    deposit_date = COALESCE(p_deposit_date, deposit_date),
    status       = 'settled'
  WHERE id = p_batch_id
  RETURNING * INTO v_batch;

  RETURN v_batch;
END;
$$;

GRANT EXECUTE ON FUNCTION public.secure_close_settlement_batch(UUID, NUMERIC, DATE) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_close_settlement_batch(UUID, NUMERIC, DATE) FROM anon;
