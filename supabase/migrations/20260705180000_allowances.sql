-- ════════════════════════════════════════════════════════════════════════════
-- F-C3.2 銷貨折讓單 / 進貨折讓單（獨立單據，非退貨）— 三個 Track 的交會點
-- 2026-07-05
--
-- 1. sales_allowances / purchase_allowances：獨立折讓單主檔
--    （AL-02：折讓「不動庫存」— 與退貨的本質差異，本檔全程無任何 stock 寫入）
-- 2. posting_rules 種子：doc_type 'sales_allowance' / 'purchase_allowance'
--    （20260705100000 只種了 sales_return / purchase_return，折讓獨立 doc_type 補種）
--    銷貨折讓：借 4200 銷貨退回及折讓 + 借 2170 銷項稅額 ／ 貸 1130 應收帳款
--    進貨折讓：借 2100 應付帳款 ／ 貸 1150 存貨 + 貸 1170 進項稅額
--    （科目皆已由 20260705142000_account_seeds.sql 種入）
-- 3. RPC secure_confirm_sales_allowance / secure_confirm_purchase_allowance：
--    draft→confirmed 單向狀態機（confirmed 冪等回傳、cancelled 拒絕）
--    → AL-03 折讓上限：累計已確認折讓 ≤ 原單總額（連動 sales_orders / purchase_orders）
--    → F-A2 傳票：secure_auto_post_voucher（source_type = 'sales_allowance'|'purchase_allowance'）
--    → F-B3 憑證檔：secure_ingest_vat_document（銷項格式 33 / 進項格式 25，負額表意）
--    整支 RPC 同一交易 — 任一步失敗全部回滾，單據停在 draft。
--
-- 銷項憑證與 D0401 去重設計（重要）：
--    「全額折讓且連動 pos_invoice（有 payment_id）」時，SQL 端刻意【不】自行入銷項
--    憑證 — 由 client 端 confirmSalesAllowance() 呼叫 voidInvoice(paymentId) 走
--    void-invoice edge function 開 D0401，事件 finance.invoice.allowance →
--    vatHandlers 以 (source_type='pos_invoice_allowance', source_id=發票id) 入檔；
--    backfill_vat_output_from_pos_invoices 亦用同一鍵。若 SQL 端也入一筆
--    (sales_allowance, 折讓單id) 會雙計銷項折讓。
--    其餘情況（部分折讓 / 無發票連動 / 發票無 payment_id）由 SQL 端以
--    (sales_allowance, 折讓單id) 入檔 — 該情境不會觸發 pos_invoices.status='allowance'，
--    backfill 也不會另立列，故不雙計。
--
-- 寫入規範：草稿建立/取消走 RLS（僅限 draft），確認一律 SECURITY DEFINER RPC。
-- idempotent。依賴：current_employee_org() / org_visible()（20260618100000 起）、
-- secure_auto_post_voucher（20260705100000）、secure_ingest_vat_document（20260705161000）、
-- allocate_document_number 的 'sales_allowance'/'purchase_allowance' 規則（20260705120000）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. sales_allowances ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_allowances (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   BIGINT      NOT NULL REFERENCES organizations(id),
  allowance_number  TEXT        NOT NULL,
  original_doc_type TEXT        NOT NULL DEFAULT 'manual'
                                CHECK (original_doc_type IN ('sales_order', 'pos_invoice', 'manual')),
  original_doc_id   TEXT,                    -- sales_orders.id / order_number / pos_invoices.id
  customer_name     TEXT,
  invoice_number    TEXT,                    -- 連動 pos_invoices.invoice_number（可空）
  -- [{description, quantity, unit_price, amount, tax}]
  lines             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  amount            NUMERIC     NOT NULL DEFAULT 0 CHECK (amount >= 0),      -- 未稅折讓額
  tax_amount        NUMERIC     NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),  -- 折讓稅額
  reason            TEXT,
  status            TEXT        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'confirmed', 'cancelled')),
  journal_entry_id  INT         REFERENCES journal_entries(id),  -- 確認時拋轉的折讓傳票
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at      TIMESTAMPTZ,
  UNIQUE (organization_id, allowance_number)
);

CREATE INDEX IF NOT EXISTS idx_sales_allowances_org_status
  ON sales_allowances (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_allowances_org_original
  ON sales_allowances (organization_id, original_doc_type, original_doc_id);

COMMENT ON TABLE sales_allowances IS
  '銷貨折讓單（F-C3.2）：獨立單據、不動庫存；確認時拋傳票（4200/2170/1130）+ 銷項折讓憑證（格式 33）+ 連動發票時開 D0401';

-- ─── 2. purchase_allowances（鏡像：供應商端）──────────────────────────────────

CREATE TABLE IF NOT EXISTS purchase_allowances (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   BIGINT      NOT NULL REFERENCES organizations(id),
  allowance_number  TEXT        NOT NULL,
  original_doc_type TEXT        NOT NULL DEFAULT 'manual'
                                CHECK (original_doc_type IN ('purchase_order', 'goods_receipt', 'manual')),
  original_doc_id   TEXT,                    -- purchase_orders.id / po_number / goods_receipts.id
  supplier_name     TEXT,
  supplier_ubn      TEXT,                    -- 賣方統編（進項憑證 counterparty_ubn）
  invoice_number    TEXT,                    -- 供應商折讓證明單/原發票號碼（可空）
  lines             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  amount            NUMERIC     NOT NULL DEFAULT 0 CHECK (amount >= 0),
  tax_amount        NUMERIC     NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  deduction_code    TEXT        NOT NULL DEFAULT '可扣抵'
                                CHECK (deduction_code IN ('可扣抵', '不可扣抵')),
  reason            TEXT,
  status            TEXT        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'confirmed', 'cancelled')),
  journal_entry_id  INT         REFERENCES journal_entries(id),
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at      TIMESTAMPTZ,
  UNIQUE (organization_id, allowance_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_allowances_org_status
  ON purchase_allowances (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_allowances_org_original
  ON purchase_allowances (organization_id, original_doc_type, original_doc_id);

COMMENT ON TABLE purchase_allowances IS
  '進貨折讓單（F-C3.2）：獨立單據、不動庫存；確認時拋傳票（2100/1150/1170）+ 進項折讓憑證（格式 25、負額）';

-- ─── 3. RLS：讀本組織；草稿可建/可取消；確認一律走 RPC ─────────────────────────

ALTER TABLE sales_allowances    ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_allowances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_allowances_sel ON sales_allowances;
CREATE POLICY sales_allowances_sel ON sales_allowances
  FOR SELECT USING (org_visible(organization_id));

-- 只能建自己組織的「草稿」（金額/狀態流轉由 RPC 把關）
DROP POLICY IF EXISTS sales_allowances_ins ON sales_allowances;
CREATE POLICY sales_allowances_ins ON sales_allowances
  FOR INSERT WITH CHECK (organization_id = current_employee_org() AND status = 'draft');

-- 只能改自己組織的「草稿」，且只能停留在 draft 或取消（confirmed 由 RPC 專屬）
DROP POLICY IF EXISTS sales_allowances_upd ON sales_allowances;
CREATE POLICY sales_allowances_upd ON sales_allowances
  FOR UPDATE USING (organization_id = current_employee_org() AND status = 'draft')
  WITH CHECK (organization_id = current_employee_org() AND status IN ('draft', 'cancelled'));

DROP POLICY IF EXISTS purchase_allowances_sel ON purchase_allowances;
CREATE POLICY purchase_allowances_sel ON purchase_allowances
  FOR SELECT USING (org_visible(organization_id));

DROP POLICY IF EXISTS purchase_allowances_ins ON purchase_allowances;
CREATE POLICY purchase_allowances_ins ON purchase_allowances
  FOR INSERT WITH CHECK (organization_id = current_employee_org() AND status = 'draft');

DROP POLICY IF EXISTS purchase_allowances_upd ON purchase_allowances;
CREATE POLICY purchase_allowances_upd ON purchase_allowances
  FOR UPDATE USING (organization_id = current_employee_org() AND status = 'draft')
  WITH CHECK (organization_id = current_employee_org() AND status IN ('draft', 'cancelled'));

-- ─── 4. posting_rules 種子（全域預設；org 可 copy-on-write 覆寫）────────────────
-- payload 鍵：amount = 未稅折讓額、tax = 折讓稅額（與 lib/allowances.js 對齊）

INSERT INTO posting_rules (organization_id, doc_type, template_name, lines) VALUES
(NULL, 'sales_allowance', 'default', '[
  {"account_code":"4200","account_name":"銷貨退回及折讓","side":"debit","amount_expr":"amount","cost_center_from":"store_id"},
  {"account_code":"2170","account_name":"銷項稅額","side":"debit","amount_expr":"tax","cost_center_from":"store_id"},
  {"account_code":"1130","account_name":"應收帳款","side":"credit","amount_expr":"amount+tax","cost_center_from":"store_id"}
]'::jsonb),
(NULL, 'purchase_allowance', 'default', '[
  {"account_code":"2100","account_name":"應付帳款","side":"debit","amount_expr":"amount+tax","cost_center_from":"warehouse_id"},
  {"account_code":"1150","account_name":"存貨","side":"credit","amount_expr":"amount","cost_center_from":"warehouse_id"},
  {"account_code":"1170","account_name":"進項稅額","side":"credit","amount_expr":"tax","cost_center_from":"warehouse_id"}
]'::jsonb)
ON CONFLICT (doc_type, template_name) WHERE organization_id IS NULL DO NOTHING;

-- ─── 5. RPC：secure_confirm_sales_allowance ──────────────────────────────────
-- draft→confirmed；AL-03 折讓上限；F-A2 傳票；F-B3 銷項憑證（去重設計見檔頭）。
-- 回傳更新後折讓單列。confirmed 重複呼叫冪等回傳既有列；cancelled 拒絕。

CREATE OR REPLACE FUNCTION public.secure_confirm_sales_allowance(p_id UUID)
RETURNS sales_allowances
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid         INT;
  v_row         sales_allowances;
  v_entry       journal_entries;
  v_inv         pos_invoices;
  v_total       NUMERIC;
  v_order_total NUMERIC;
  v_confirmed   NUMERIC;
  v_full_linked BOOLEAN := false;
  v_actor       TEXT;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  SELECT * INTO v_row FROM sales_allowances
   WHERE id = p_id AND organization_id = v_tid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '找不到銷貨折讓單：%', p_id; END IF;

  IF v_row.status = 'confirmed' THEN RETURN v_row; END IF;  -- 冪等：已確認回傳既有列
  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION '折讓單狀態為 %，僅草稿可確認', v_row.status;
  END IF;

  v_total := COALESCE(v_row.amount, 0) + COALESCE(v_row.tax_amount, 0);
  IF v_total <= 0 THEN
    RAISE EXCEPTION '折讓金額 + 稅額必須大於 0（amount=%, tax=%）', v_row.amount, v_row.tax_amount;
  END IF;

  -- AL-03 折讓上限：連動 sales_order 時，累計已確認折讓 ≤ 原訂單總額
  IF v_row.original_doc_type = 'sales_order' AND COALESCE(v_row.original_doc_id, '') <> '' THEN
    IF v_row.original_doc_id ~ '^[0-9]+$' THEN
      SELECT total INTO v_order_total FROM sales_orders
       WHERE id = v_row.original_doc_id::INT AND organization_id = v_tid;
    ELSE
      SELECT total INTO v_order_total FROM sales_orders
       WHERE order_number = v_row.original_doc_id AND organization_id = v_tid;
    END IF;

    IF v_order_total IS NOT NULL THEN
      SELECT COALESCE(SUM(amount + tax_amount), 0) INTO v_confirmed
        FROM sales_allowances
       WHERE organization_id = v_tid
         AND original_doc_type = 'sales_order'
         AND original_doc_id = v_row.original_doc_id
         AND status = 'confirmed'
         AND id <> v_row.id;
      IF v_confirmed + v_total > v_order_total THEN
        RAISE EXCEPTION '折讓超過上限：累計已確認折讓 % + 本單 % 超過原訂單總額 %（訂單 %）',
          v_confirmed, v_total, v_order_total, v_row.original_doc_id;
      END IF;
    END IF;
  END IF;

  v_actor := COALESCE(
    NULLIF(v_row.created_by, ''),
    (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()),
    '系統'
  );

  -- F-A2 折讓傳票（借 4200 + 2170 ／ 貸 1130；規則停用 → NULL，折讓仍成立不掛傳票）
  v_entry := secure_auto_post_voucher(
    'sales_allowance',
    'sales_allowance',
    v_row.id::TEXT,
    jsonb_build_object(
      'amount',      v_row.amount,
      'tax',         v_row.tax_amount,
      'description', '銷貨折讓 ' || v_row.allowance_number ||
                     COALESCE('（' || NULLIF(v_row.customer_name, '') || '）', ''),
      'created_by',  v_actor
    )
  );

  -- 連動發票解析（去重判斷：全額折讓 + 有 payment_id → 交由 client 端 D0401 路徑入憑證檔）
  IF COALESCE(v_row.invoice_number, '') <> '' THEN
    SELECT * INTO v_inv FROM pos_invoices
     WHERE organization_id = v_tid AND invoice_number = v_row.invoice_number
     LIMIT 1;
    v_full_linked := FOUND
      AND v_inv.payment_id IS NOT NULL
      AND round(v_total, 2) = round(COALESCE(v_inv.sales_amount, 0) + COALESCE(v_inv.tax_amount, 0), 2);
  END IF;

  -- F-B3 銷項折讓憑證（格式 33、負額）— 全額連動情境刻意跳過（見檔頭去重設計）
  IF NOT v_full_linked THEN
    PERFORM secure_ingest_vat_document('output', jsonb_build_object(
      'source_type',      'sales_allowance',
      'source_id',        v_row.id::TEXT,
      'format_code',      '33',
      'doc_number',       COALESCE(NULLIF(v_row.invoice_number, ''), v_row.allowance_number),
      'doc_date',         to_char(CURRENT_DATE, 'YYYY-MM-DD'),
      'counterparty_ubn', v_inv.buyer_tax_id,
      'amount',           -v_row.amount,
      'tax_amount',       -v_row.tax_amount,
      'tax_type',         '應稅'
    ));
  END IF;

  UPDATE sales_allowances
     SET status = 'confirmed',
         confirmed_at = now(),
         journal_entry_id = v_entry.id
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  RETURN v_row;
END $$;

-- ─── 6. RPC：secure_confirm_purchase_allowance ───────────────────────────────
-- 鏡像：進項方向。傳票 借 2100 ／ 貸 1150 + 1170；憑證檔進項折讓（格式 25、負額、
-- deduction_code 依單據欄位 — 不可扣抵折讓不入 401 扣抵稅額）。
-- 註：purchase_orders 尚無 organization_id 欄（20260618120001 刻意另案），
--     上限查核以單號/ID 直查 — 該表本就全組織共用採購視角。

CREATE OR REPLACE FUNCTION public.secure_confirm_purchase_allowance(p_id UUID)
RETURNS purchase_allowances
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid         INT;
  v_row         purchase_allowances;
  v_entry       journal_entries;
  v_total       NUMERIC;
  v_order_total NUMERIC;
  v_confirmed   NUMERIC;
  v_actor       TEXT;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  SELECT * INTO v_row FROM purchase_allowances
   WHERE id = p_id AND organization_id = v_tid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '找不到進貨折讓單：%', p_id; END IF;

  IF v_row.status = 'confirmed' THEN RETURN v_row; END IF;
  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION '折讓單狀態為 %，僅草稿可確認', v_row.status;
  END IF;

  v_total := COALESCE(v_row.amount, 0) + COALESCE(v_row.tax_amount, 0);
  IF v_total <= 0 THEN
    RAISE EXCEPTION '折讓金額 + 稅額必須大於 0（amount=%, tax=%）', v_row.amount, v_row.tax_amount;
  END IF;

  -- AL-03 鏡像：連動 purchase_order 時，累計已確認折讓 ≤ 原採購單總額（含稅含運）
  IF v_row.original_doc_type = 'purchase_order' AND COALESCE(v_row.original_doc_id, '') <> '' THEN
    IF v_row.original_doc_id ~ '^[0-9]+$' THEN
      SELECT COALESCE(total_amount, 0) + COALESCE(tax, 0) + COALESCE(shipping, 0)
        INTO v_order_total FROM purchase_orders WHERE id = v_row.original_doc_id::INT;
    ELSE
      SELECT COALESCE(total_amount, 0) + COALESCE(tax, 0) + COALESCE(shipping, 0)
        INTO v_order_total FROM purchase_orders WHERE po_number = v_row.original_doc_id;
    END IF;

    IF v_order_total IS NOT NULL THEN
      SELECT COALESCE(SUM(amount + tax_amount), 0) INTO v_confirmed
        FROM purchase_allowances
       WHERE organization_id = v_tid
         AND original_doc_type = 'purchase_order'
         AND original_doc_id = v_row.original_doc_id
         AND status = 'confirmed'
         AND id <> v_row.id;
      IF v_confirmed + v_total > v_order_total THEN
        RAISE EXCEPTION '折讓超過上限：累計已確認折讓 % + 本單 % 超過原採購單總額 %（採購單 %）',
          v_confirmed, v_total, v_order_total, v_row.original_doc_id;
      END IF;
    END IF;
  END IF;

  v_actor := COALESCE(
    NULLIF(v_row.created_by, ''),
    (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()),
    '系統'
  );

  -- F-A2 折讓傳票（借 2100 ／ 貸 1150 + 1170）
  v_entry := secure_auto_post_voucher(
    'purchase_allowance',
    'purchase_allowance',
    v_row.id::TEXT,
    jsonb_build_object(
      'amount',      v_row.amount,
      'tax',         v_row.tax_amount,
      'description', '進貨折讓 ' || v_row.allowance_number ||
                     COALESCE('（' || NULLIF(v_row.supplier_name, '') || '）', ''),
      'created_by',  v_actor
    )
  );

  -- F-B3 進項折讓憑證（格式 25、負額；deduction_code 透傳 — 不可扣抵不入扣抵稅額）
  PERFORM secure_ingest_vat_document('input', jsonb_build_object(
    'source_type',      'purchase_allowance',
    'source_id',        v_row.id::TEXT,
    'format_code',      '25',
    'doc_number',       COALESCE(NULLIF(v_row.invoice_number, ''), v_row.allowance_number),
    'doc_date',         to_char(CURRENT_DATE, 'YYYY-MM-DD'),
    'counterparty_ubn', NULLIF(v_row.supplier_ubn, ''),
    'amount',           -v_row.amount,
    'tax_amount',       -v_row.tax_amount,
    'tax_type',         '應稅',
    'deduction_code',   v_row.deduction_code
  ));

  UPDATE purchase_allowances
     SET status = 'confirmed',
         confirmed_at = now(),
         journal_entry_id = v_entry.id
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.secure_confirm_sales_allowance(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_confirm_sales_allowance(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.secure_confirm_purchase_allowance(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_confirm_purchase_allowance(UUID) FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
