-- ── POS 發票欄位 + 發票記錄表 ─────────────────────────────────────────────────

-- 1. pos_orders 加發票相關欄位
ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS carrier_type   TEXT
    CHECK (carrier_type IN ('mobile','citizen_cert','company','none')),
  ADD COLUMN IF NOT EXISTS carrier_id     TEXT,        -- 手機條碼 /ABC-1234
  ADD COLUMN IF NOT EXISTS buyer_tax_id   TEXT,        -- 統一編號 8碼
  ADD COLUMN IF NOT EXISTS buyer_company  TEXT,        -- 公司抬頭
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,        -- 待 ECPay 串接後回填
  ADD COLUMN IF NOT EXISTS tax_amount     NUMERIC(10,2);  -- 含稅 5%

-- 2. 發票記錄主表（ECPay 串接後正式使用）
CREATE TABLE IF NOT EXISTS pos_invoices (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT        NOT NULL REFERENCES organizations(id),
  store_id        BIGINT        NOT NULL REFERENCES stores(id),
  order_id        UUID          NOT NULL REFERENCES pos_orders(id),
  invoice_number  TEXT          NOT NULL,
  invoice_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
  sales_amount    NUMERIC(10,2) NOT NULL,
  tax_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  carrier_type    TEXT,
  carrier_id      TEXT,
  buyer_tax_id    TEXT,
  buyer_company   TEXT,
  status          TEXT          NOT NULL DEFAULT 'issued'
                  CHECK (status IN ('issued','voided','allowance')),
  ecpay_response  JSONB,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 3. RLS
ALTER TABLE pos_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_invoices_staff" ON pos_invoices;
CREATE POLICY "pos_invoices_staff" ON pos_invoices
  FOR ALL USING (organization_id = auth_org_id());
