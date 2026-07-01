-- ── 電子發票配號基礎 ─────────────────────────────────────────────────────────
-- 1. invoice_number_sequences：字軌配號表（每組織 × 期別 × 字軌一列）
-- 2. pos_invoices 補欄位：payment_id / provider / provider_response
-- 3. allocate_invoice_number()：原子性配號（僅 service role 可執行）

-- 1. 字軌配號表
CREATE TABLE IF NOT EXISTS invoice_number_sequences (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT      NOT NULL REFERENCES organizations(id),
  period          TEXT        NOT NULL,  -- 期別 YYYYMM，雙月一期取奇數月（例 2026/07-08 → '202607'）
  track           TEXT        NOT NULL DEFAULT 'AB' CHECK (track ~ '^[A-Z]{2}$'),
  next_number     BIGINT      NOT NULL DEFAULT 10000000,  -- 最後配出的流水號（配號時 +1 後回傳）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, period, track)
);

-- 2. pos_invoices 補供應商欄位（原表見 20260629060000_pos_invoice.sql）
ALTER TABLE pos_invoices
  ADD COLUMN IF NOT EXISTS payment_id        UUID REFERENCES pos_payments(id),
  ADD COLUMN IF NOT EXISTS provider          TEXT NOT NULL DEFAULT 'mock',
  ADD COLUMN IF NOT EXISTS provider_response JSONB;

-- 每筆付款至多一張發票（拆帳時每筆 pos_payments 各開一張）— 併發開立時第二筆 insert 會撞唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS pos_invoices_payment_id_uniq
  ON pos_invoices (payment_id) WHERE payment_id IS NOT NULL;

-- 3. 原子性配號：UPDATE ... RETURNING（row lock 保證同號不重複）
CREATE OR REPLACE FUNCTION allocate_invoice_number(
  p_org_id BIGINT,
  p_period TEXT,
  p_track  TEXT DEFAULT 'AB'
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  IF p_track !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION '字軌必須為 2 碼大寫英文字母';
  END IF;
  IF p_period !~ '^\d{6}$' THEN
    RAISE EXCEPTION '期別格式錯誤（應為 YYYYMM）';
  END IF;

  -- 首次使用該期別/字軌時建立配號列
  INSERT INTO invoice_number_sequences (organization_id, period, track)
  VALUES (p_org_id, p_period, p_track)
  ON CONFLICT (organization_id, period, track) DO NOTHING;

  UPDATE invoice_number_sequences
     SET next_number = next_number + 1,
         updated_at  = NOW()
   WHERE organization_id = p_org_id
     AND period = p_period
     AND track  = p_track
  RETURNING next_number INTO v_seq;

  IF v_seq > 99999999 THEN
    RAISE EXCEPTION '期別 % 字軌 % 號碼已用罄', p_period, p_track;
  END IF;

  RETURN v_seq;
END;
$$;

-- 配號僅允許 service role（edge function issue-invoice）；金流/狀態轉移一律 server-side
REVOKE ALL ON FUNCTION allocate_invoice_number(BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION allocate_invoice_number(BIGINT, TEXT, TEXT) FROM anon, authenticated;

-- 4. RLS：組織內僅可讀，寫入一律經由 service role（同 pos_invoices 的 auth_org_id() 模式）
ALTER TABLE invoice_number_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_number_sequences_read" ON invoice_number_sequences;
CREATE POLICY "invoice_number_sequences_read" ON invoice_number_sequences
  FOR SELECT USING (organization_id = auth_org_id());
