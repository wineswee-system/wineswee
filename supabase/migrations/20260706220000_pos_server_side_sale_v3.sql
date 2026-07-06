-- ═════════════════════════════════════════════════════════════════════════════
-- POS 交易副作用全面後端化（v3）＋ 現金控管 ＋ 主管授權
--
-- 背景（2026-07-06 POS 檢視發現的結構性風險）：
--   R1  扣庫存/會員點數/消費紀錄/傳票 全在瀏覽器 EventBus 執行 —
--       關頁面、離線補送、當機 ⇒ 副作用永久遺失（離線交易從未扣過庫存/給過點數）
--   R3  點數雙重邏輯：前端 floor(total/10) vs crmHandlers member_levels 倍率
--   R4  無庫存異動稽核（inventory_transactions 未寫入）、無負庫存防呆
--   #1  作廢/退款/手動折扣無主管授權、無稽核軌跡
--   #2  無現金收支（領錢/存錢）紀錄；開班備用金存 localStorage
--   #3  優惠券未鎖單次使用（used_at 標記 fire-and-forget 且 FK 型別錯誤）
--   #4  分帳付款寫 pos_payments 的 order_id UUID FK 型別不符 → 靜默失敗
--
-- 本 migration：
--   1. pos_transactions 補欄位：store_id / note / manual_discount / payment_splits
--   2. pos_returns 支援零售交易模型（transaction_id / transaction_number；store_id 放寬）
--   3. inventory_transactions 補 organization_id（若表存在）
--   4. pos_manager_pins（主管授權 PIN，bcrypt 雜湊）＋ pos_set_manager_pin RPC
--   5. pos_audit_log（折扣/退款稽核軌跡）
--   6. pos_cash_movements（開班備用金/領錢/存錢）＋ pos_record_cash_movement RPC
--   7. secure_create_pos_transaction v3：單一原子交易內完成
--        驗證 → 優惠券鎖定核銷 → 入帳 → 扣庫存＋庫存異動稽核 →
--        會員點數（member_levels 單一事實來源）→ 消費紀錄 → 傳票 → 稽核
--   8. secure_refund_pos_transaction：退款後端化（退貨紀錄/還庫存/扣回點數/迴轉傳票）
--
-- 冪等：可重複執行。
-- 前端事件（pos.transaction.completed 等）仍發布，僅剩通知/問卷等非關鍵訂閱者。
-- ═════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. pos_transactions 欄位
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pos_transactions
  ADD COLUMN IF NOT EXISTS store_id        INT,
  ADD COLUMN IF NOT EXISTS note            TEXT,
  ADD COLUMN IF NOT EXISTS manual_discount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_splits  JSONB;

CREATE INDEX IF NOT EXISTS idx_pos_txn_org_store_created
  ON public.pos_transactions (organization_id, store_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. pos_returns 支援零售（pos_transactions）退款
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pos_returns
  ALTER COLUMN store_id DROP NOT NULL;
ALTER TABLE public.pos_returns
  ADD COLUMN IF NOT EXISTS transaction_id     INT REFERENCES public.pos_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transaction_number TEXT;

CREATE INDEX IF NOT EXISTS idx_pos_returns_txn ON public.pos_returns (transaction_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. inventory_transactions 補租戶欄位（表建立於初始 schema，migrations 未管理）
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.inventory_transactions') IS NOT NULL THEN
    ALTER TABLE public.inventory_transactions
      ADD COLUMN IF NOT EXISTS organization_id INT;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 主管授權 PIN
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_manager_pins (
  id              BIGSERIAL PRIMARY KEY,
  organization_id INT  NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,              -- 例：店長-小陳
  pin_hash        TEXT NOT NULL,              -- bcrypt (pgcrypto crypt)
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, label)
);

ALTER TABLE public.pos_manager_pins ENABLE ROW LEVEL SECURITY;

-- 查詢僅供管理畫面列出 label／狀態；寫入一律走 RPC
-- （無 INSERT/UPDATE policy → 直寫被 RLS 擋下）
DROP POLICY IF EXISTS pos_manager_pins_sel ON public.pos_manager_pins;
CREATE POLICY pos_manager_pins_sel ON public.pos_manager_pins
  FOR SELECT TO authenticated
  USING (organization_id = auth_org_id());

-- 內部驗證（不 GRANT 給前端）：回傳符合的 PIN label，不符回 NULL
CREATE OR REPLACE FUNCTION public.pos__verify_manager_pin(p_org INT, p_pin TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_label TEXT;
BEGIN
  IF p_pin IS NULL OR p_pin = '' THEN RETURN NULL; END IF;
  SELECT label INTO v_label
    FROM pos_manager_pins
   WHERE organization_id = p_org
     AND is_active
     AND pin_hash = crypt(p_pin, pin_hash)
   LIMIT 1;
  RETURN v_label;
END;
$$;
REVOKE ALL ON FUNCTION public.pos__verify_manager_pin(INT, TEXT) FROM PUBLIC, anon, authenticated;

-- 設定/停用主管 PIN。
-- 自我保護（不依賴角色表）：組織已有有效 PIN 時，必須提供任一現有有效 PIN 才能變更。
CREATE OR REPLACE FUNCTION public.pos_set_manager_pin(
  p_label       TEXT,
  p_pin         TEXT DEFAULT NULL,   -- NULL = 停用該 label
  p_current_pin TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid INT;
  v_has_pins BOOLEAN;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;
  IF p_label IS NULL OR btrim(p_label) = '' THEN RAISE EXCEPTION 'PIN 標籤不可為空'; END IF;

  SELECT EXISTS (SELECT 1 FROM pos_manager_pins WHERE organization_id = v_tid AND is_active)
    INTO v_has_pins;

  IF v_has_pins AND pos__verify_manager_pin(v_tid, p_current_pin) IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: 變更主管 PIN 需輸入現有有效 PIN';
  END IF;

  IF p_pin IS NULL OR p_pin = '' THEN
    UPDATE pos_manager_pins SET is_active = FALSE
     WHERE organization_id = v_tid AND label = btrim(p_label);
    RETURN jsonb_build_object('ok', true, 'label', btrim(p_label), 'deactivated', true);
  END IF;

  IF length(p_pin) < 4 THEN RAISE EXCEPTION 'PIN 至少 4 碼'; END IF;

  INSERT INTO pos_manager_pins (organization_id, label, pin_hash, is_active)
  VALUES (v_tid, btrim(p_label), crypt(p_pin, gen_salt('bf')), TRUE)
  ON CONFLICT (organization_id, label)
  DO UPDATE SET pin_hash = EXCLUDED.pin_hash, is_active = TRUE;

  RETURN jsonb_build_object('ok', true, 'label', btrim(p_label));
END;
$$;
GRANT EXECUTE ON FUNCTION public.pos_set_manager_pin(TEXT, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_set_manager_pin(TEXT, TEXT, TEXT) FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. POS 稽核軌跡（折扣/退款/現金收支）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  organization_id INT NOT NULL,
  store_id        INT,
  action          TEXT NOT NULL,       -- manual_discount | refund | void | cash_in | cash_out
  amount          NUMERIC(12,2),
  reason          TEXT,
  cashier         TEXT,
  approved_by     TEXT,                -- 主管 PIN label（未設 PIN 制度時為 NULL）
  transaction_ref TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_audit_org_created
  ON public.pos_audit_log (organization_id, created_at DESC);

ALTER TABLE public.pos_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_audit_sel ON public.pos_audit_log;
CREATE POLICY pos_audit_sel ON public.pos_audit_log
  FOR SELECT TO authenticated
  USING (organization_id = auth_org_id());
-- 寫入僅由 SECURITY DEFINER RPC 進行（無 INSERT policy）

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. 現金收支（開班備用金 / 領錢 / 存錢）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_cash_movements (
  id              BIGSERIAL PRIMARY KEY,
  organization_id INT  NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id        INT,
  business_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  shift_id        UUID,
  movement_type   TEXT NOT NULL CHECK (movement_type IN ('opening_float','cash_in','cash_out')),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  reason          TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 開班備用金：每店每日一筆（可覆寫）
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_cash_opening_float
  ON public.pos_cash_movements (organization_id, COALESCE(store_id, 0), business_date)
  WHERE movement_type = 'opening_float';

CREATE INDEX IF NOT EXISTS idx_pos_cash_org_date
  ON public.pos_cash_movements (organization_id, business_date);

ALTER TABLE public.pos_cash_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_cash_sel ON public.pos_cash_movements;
CREATE POLICY pos_cash_sel ON public.pos_cash_movements
  FOR SELECT TO authenticated
  USING (organization_id = auth_org_id());
-- 寫入僅由 RPC 進行

CREATE OR REPLACE FUNCTION public.pos_record_cash_movement(
  p_movement_type TEXT,
  p_amount        NUMERIC,
  p_reason        TEXT DEFAULT NULL,
  p_store_id      INT  DEFAULT NULL,
  p_business_date DATE DEFAULT CURRENT_DATE,
  p_created_by    TEXT DEFAULT NULL
) RETURNS pos_cash_movements
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid    INT;
  v_result pos_cash_movements;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;
  IF p_movement_type NOT IN ('opening_float','cash_in','cash_out') THEN
    RAISE EXCEPTION '無效的現金異動類型：%', p_movement_type;
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION '金額不可為負'; END IF;

  IF p_movement_type = 'opening_float' THEN
    -- 每店每日一筆，重複設定 = 覆寫
    UPDATE pos_cash_movements
       SET amount = p_amount, created_by = p_created_by, created_at = now()
     WHERE organization_id = v_tid
       AND COALESCE(store_id, 0) = COALESCE(p_store_id, 0)
       AND business_date = COALESCE(p_business_date, CURRENT_DATE)
       AND movement_type = 'opening_float'
    RETURNING * INTO v_result;
    IF NOT FOUND THEN
      INSERT INTO pos_cash_movements (organization_id, store_id, business_date, movement_type, amount, reason, created_by)
      VALUES (v_tid, p_store_id, COALESCE(p_business_date, CURRENT_DATE), 'opening_float', p_amount, p_reason, p_created_by)
      RETURNING * INTO v_result;
    END IF;
  ELSE
    IF COALESCE(btrim(p_reason), '') = '' THEN
      RAISE EXCEPTION '領錢/存錢必須填寫原因';
    END IF;
    INSERT INTO pos_cash_movements (organization_id, store_id, business_date, movement_type, amount, reason, created_by)
    VALUES (v_tid, p_store_id, COALESCE(p_business_date, CURRENT_DATE), p_movement_type, p_amount, p_reason, p_created_by)
    RETURNING * INTO v_result;

    INSERT INTO pos_audit_log (organization_id, store_id, action, amount, reason, cashier)
    VALUES (v_tid, p_store_id, p_movement_type, p_amount, p_reason, p_created_by);
  END IF;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.pos_record_cash_movement(TEXT, NUMERIC, TEXT, INT, DATE, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_record_cash_movement(TEXT, NUMERIC, TEXT, INT, DATE, TEXT) FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7a. 點數計算（單一事實來源）：member_levels.point_multiplier；
--     無 DB 等級設定時 fallback 舊制（與 src/lib/crm/loyalty.js TIER_RULES 一致）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pos__points_earned(
  p_org        BIGINT,
  p_level_id   BIGINT,
  p_level_name TEXT,
  p_amount     NUMERIC
) RETURNS INT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mult NUMERIC := NULL;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN 0; END IF;

  IF p_level_id IS NOT NULL THEN
    SELECT point_multiplier INTO v_mult FROM member_levels
     WHERE id = p_level_id AND organization_id = p_org;
  END IF;
  IF v_mult IS NULL AND EXISTS (SELECT 1 FROM member_levels WHERE organization_id = p_org) THEN
    -- 有 DB 等級制但會員未掛 level_id → 用最低階（rank 最小）
    SELECT point_multiplier INTO v_mult FROM member_levels
     WHERE organization_id = p_org ORDER BY rank ASC LIMIT 1;
  END IF;
  IF v_mult IS NULL THEN
    -- 舊制 fallback（TIER_RULES）
    v_mult := CASE COALESCE(p_level_name, '一般')
      WHEN '銀卡' THEN 1.2 WHEN '金卡' THEN 1.5 WHEN '白金' THEN 2 WHEN '鑽石' THEN 3
      ELSE 1 END;
  END IF;

  RETURN floor(floor(p_amount / 10) * v_mult)::INT;
END;
$$;
REVOKE ALL ON FUNCTION public.pos__points_earned(BIGINT, BIGINT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7b. 庫存扣減/回補 ＋ inventory_transactions 稽核（items: [{name, qty}]）
--     p_direction: -1 = 銷售扣減, +1 = 退款還庫
--     不阻擋銷售：庫存不足時 clamp 至 0（餐飲現做品常無庫存檔），稽核紀錄保留實際量。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pos__adjust_stock(
  p_org       INT,
  p_items     JSONB,
  p_direction INT,
  p_reference TEXT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item      JSONB;
  v_name      TEXT;
  v_qty       NUMERIC;
  v_sku_code  TEXT;
  v_stock     RECORD;
  v_new_qty   NUMERIC;
  v_has_it    BOOLEAN := to_regclass('public.inventory_transactions') IS NOT NULL;
BEGIN
  IF p_items IS NULL THEN RETURN; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_name := v_item->>'name';
    v_qty  := COALESCE((v_item->>'qty')::NUMERIC, 0);
    IF v_name IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    -- 品名 → SKU（優先本租戶）
    SELECT s.code INTO v_sku_code FROM skus s
     WHERE s.name = v_name AND (s.organization_id = p_org OR s.organization_id IS NULL)
     ORDER BY (s.organization_id = p_org) DESC NULLS LAST
     LIMIT 1;
    IF v_sku_code IS NULL THEN CONTINUE; END IF;  -- 非庫存品（現做餐飲）→ 略過

    SELECT * INTO v_stock FROM stock_levels
     WHERE sku_code = v_sku_code
       AND (organization_id = p_org OR organization_id IS NULL)
     ORDER BY (organization_id = p_org) DESC NULLS LAST, quantity DESC
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_new_qty := GREATEST(0, COALESCE(v_stock.quantity, 0) + (p_direction * v_qty));
    UPDATE stock_levels SET quantity = v_new_qty WHERE id = v_stock.id;

    IF v_has_it THEN
      INSERT INTO inventory_transactions (sku, date, type, qty, warehouse, reference, organization_id)
      VALUES (
        v_sku_code, CURRENT_DATE,
        CASE WHEN p_direction < 0 THEN 'OUT' ELSE 'IN' END,
        v_qty, v_stock.warehouse, p_reference, p_org
      );
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.pos__adjust_stock(INT, JSONB, INT, TEXT) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. secure_create_pos_transaction v3
--    先移除 v2（15 參數）簽名，避免 PostgREST 多載歧義。
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.secure_create_pos_transaction(
  TEXT, TEXT, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, UUID
);

CREATE OR REPLACE FUNCTION public.secure_create_pos_transaction(
  p_store            TEXT,
  p_cashier          TEXT,
  p_items            JSONB,
  p_subtotal         NUMERIC,
  p_discount         NUMERIC DEFAULT 0,
  p_tax              NUMERIC DEFAULT 0,
  p_total            NUMERIC DEFAULT NULL,
  p_payment_method   TEXT DEFAULT '現金',
  p_payment_ref      TEXT DEFAULT NULL,
  p_member_id        TEXT DEFAULT NULL,
  p_points_earned    INT  DEFAULT 0,   -- 保留參數相容；實際點數一律由後端計算
  p_points_used      INT  DEFAULT 0,
  p_invoice_number   TEXT DEFAULT NULL,
  p_invoice_carrier  TEXT DEFAULT NULL,
  p_client_tx_id     UUID DEFAULT NULL,
  p_store_id         INT  DEFAULT NULL,
  p_note             TEXT DEFAULT NULL,
  p_manual_discount  NUMERIC DEFAULT 0,
  p_coupon_assignment_id BIGINT DEFAULT NULL,
  p_payment_splits   JSONB DEFAULT NULL,
  p_manager_pin      TEXT DEFAULT NULL
) RETURNS pos_transactions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid        INT;
  v_total      NUMERIC;
  v_txn_number TEXT;
  v_result     pos_transactions;
  v_valid_payments TEXT[] := ARRAY['現金', '信用卡', 'LINE Pay', '悠遊卡', '街口支付', '轉帳', '掛帳', '其他'];

  v_member     members%ROWTYPE;
  v_member_id  INT := NULL;

  v_coupon_ca  coupon_assignments%ROWTYPE;
  v_coupon     coupons%ROWTYPE;

  v_approver   TEXT := NULL;
  v_org_has_pins BOOLEAN;

  -- 點數
  v_points_earned      INT := 0;
  v_points_used        INT := COALESCE(p_points_used, 0);
  v_new_lifetime_spend NUMERIC;
  v_new_lifetime_pts   NUMERIC;
  v_new_available      NUMERIC;
  v_new_level          member_levels%ROWTYPE;
  v_new_level_name     TEXT;
  v_tier_changed       BOOLEAN := FALSE;

  -- 消費紀錄
  v_purchase_id BIGINT;
  v_pm_norm     TEXT;
  v_split       JSONB;
  v_split_sum   NUMERIC := 0;
  v_item        JSONB;

  -- 傳票
  v_je_lines    JSONB;
  v_cash_amt    NUMERIC := 0;
  v_bank_amt    NUMERIC := 0;
  v_ar_amt      NUMERIC := 0;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  -- 冪等重放：同租戶同 client_tx_id 已存在 → 回傳既有交易（副作用已於原次執行）
  IF p_client_tx_id IS NOT NULL THEN
    SELECT * INTO v_result FROM pos_transactions
    WHERE organization_id = v_tid AND client_tx_id = p_client_tx_id;
    IF FOUND THEN RETURN v_result; END IF;
  END IF;

  v_total := COALESCE(p_total, p_subtotal - p_discount + p_tax);
  IF p_subtotal  < 0 THEN RAISE EXCEPTION '小計不可為負'; END IF;
  IF v_total     < 0 THEN RAISE EXCEPTION '總額不可為負'; END IF;
  IF p_discount  < 0 THEN RAISE EXCEPTION '折扣不可為負'; END IF;
  IF p_tax       < 0 THEN RAISE EXCEPTION '稅額不可為負'; END IF;
  IF COALESCE(p_manual_discount, 0) < 0 OR COALESCE(p_manual_discount, 0) > p_discount THEN
    RAISE EXCEPTION '手動折扣金額不合法';
  END IF;

  IF NOT (p_payment_method = ANY(v_valid_payments)) THEN
    RAISE EXCEPTION '無效的付款方式：%', p_payment_method;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '交易必須包含至少一項商品';
  END IF;

  -- 分帳驗證：各分帳方式合法、金額加總 = 總額（修 #4：舊前端直寫 pos_payments 靜默失敗）
  IF p_payment_splits IS NOT NULL AND jsonb_array_length(p_payment_splits) > 0 THEN
    FOR v_split IN SELECT * FROM jsonb_array_elements(p_payment_splits) LOOP
      IF NOT ((v_split->>'method') = ANY(v_valid_payments)) THEN
        RAISE EXCEPTION '無效的分帳付款方式：%', v_split->>'method';
      END IF;
      IF COALESCE((v_split->>'amount')::NUMERIC, 0) <= 0 THEN
        RAISE EXCEPTION '分帳金額必須大於 0';
      END IF;
      v_split_sum := v_split_sum + (v_split->>'amount')::NUMERIC;
    END LOOP;
    IF abs(v_split_sum - v_total) > 0.01 THEN
      RAISE EXCEPTION '分帳金額加總 (%) 與總額 (%) 不符', v_split_sum, v_total;
    END IF;
  END IF;

  -- 會員
  IF p_member_id IS NOT NULL AND p_member_id ~ '^\d+$' THEN
    v_member_id := p_member_id::INT;
    SELECT * INTO v_member FROM members
     WHERE id = v_member_id AND organization_id = v_tid
     FOR UPDATE;
    IF NOT FOUND THEN
      v_member_id := NULL;  -- 查無會員 → 視為散客（與舊行為一致，不擋結帳）
    END IF;
  END IF;

  -- 點數折抵防呆（後端強制）
  IF v_points_used > 0 THEN
    IF v_member_id IS NULL THEN
      RAISE EXCEPTION '點數折抵需要會員身分';
    END IF;
    IF v_points_used > COALESCE(v_member.available_points, 0) THEN
      RAISE EXCEPTION '會員點數不足（可用 % 點，欲折抵 % 點）',
        COALESCE(v_member.available_points, 0), v_points_used;
    END IF;
  END IF;

  -- 優惠券：鎖定 → 驗證 → （入帳後）核銷。單次使用由此原子保證（修 #3）。
  IF p_coupon_assignment_id IS NOT NULL THEN
    SELECT * INTO v_coupon_ca FROM coupon_assignments
     WHERE id = p_coupon_assignment_id AND organization_id = v_tid
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_INVALID: 查無此優惠券'; END IF;
    IF v_coupon_ca.used_at IS NOT NULL THEN RAISE EXCEPTION 'COUPON_USED: 優惠券已使用'; END IF;
    IF v_member_id IS NULL OR v_coupon_ca.member_id <> v_member_id THEN
      RAISE EXCEPTION 'COUPON_INVALID: 優惠券不屬於此會員';
    END IF;

    SELECT * INTO v_coupon FROM coupons WHERE id = v_coupon_ca.coupon_id;
    IF COALESCE(v_coupon_ca.expires_at, v_coupon.valid_until, now() + interval '1 day') < now() THEN
      RAISE EXCEPTION 'COUPON_EXPIRED: 優惠券已過期';
    END IF;
    IF p_subtotal < COALESCE(v_coupon.min_purchase, 0) THEN
      RAISE EXCEPTION 'COUPON_MIN_PURCHASE: 未達優惠券最低消費 %', v_coupon.min_purchase;
    END IF;
  END IF;

  -- 手動折扣主管授權：組織已建立 PIN 制度時強制（修 #1）
  SELECT EXISTS (SELECT 1 FROM pos_manager_pins WHERE organization_id = v_tid AND is_active)
    INTO v_org_has_pins;
  IF COALESCE(p_manual_discount, 0) > 0 AND v_org_has_pins THEN
    v_approver := pos__verify_manager_pin(v_tid, p_manager_pin);
    IF v_approver IS NULL THEN
      RAISE EXCEPTION 'APPROVAL_REQUIRED: 手動折扣需主管 PIN 授權';
    END IF;
  END IF;

  v_txn_number := 'POS-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || lpad((random() * 9999)::INT::TEXT, 4, '0');

  -- ── 入帳（原子核心） ──
  BEGIN
    INSERT INTO pos_transactions (
      organization_id, transaction_number, store, cashier, items,
      subtotal, discount, tax, total,
      payment_method, payment_ref, member_id,
      points_earned, points_used,
      invoice_number, invoice_carrier, status, client_tx_id,
      store_id, note, manual_discount, payment_splits
    ) VALUES (
      v_tid, v_txn_number, p_store, p_cashier, p_items,
      p_subtotal, p_discount, p_tax, v_total,
      p_payment_method, p_payment_ref, p_member_id,
      0, v_points_used,
      p_invoice_number, p_invoice_carrier, '完成', p_client_tx_id,
      p_store_id, NULLIF(btrim(COALESCE(p_note, '')), ''), COALESCE(p_manual_discount, 0), p_payment_splits
    ) RETURNING * INTO v_result;
  EXCEPTION WHEN unique_violation THEN
    -- 併發重放競態：另一請求剛好先插入同 client_tx_id → 回傳既有紀錄
    IF p_client_tx_id IS NOT NULL THEN
      SELECT * INTO v_result FROM pos_transactions
      WHERE organization_id = v_tid AND client_tx_id = p_client_tx_id;
      IF FOUND THEN RETURN v_result; END IF;
    END IF;
    RAISE;
  END;

  -- ── 庫存扣減 ＋ 異動稽核（修 R1/R4） ──
  PERFORM pos__adjust_stock(v_tid, p_items, -1, v_txn_number);

  -- ── 會員：點數/等級/消費紀錄（修 R1/R3） ──
  IF v_member_id IS NOT NULL THEN
    v_points_earned      := pos__points_earned(v_tid::BIGINT, v_member.level_id::BIGINT, v_member.level, v_total);
    v_new_lifetime_spend := COALESCE(v_member.lifetime_spend, v_member.total_spent, 0) + v_total;
    v_new_lifetime_pts   := COALESCE(v_member.lifetime_points, v_member.total_points, 0) + v_points_earned;
    v_new_available      := COALESCE(v_member.available_points, 0) + v_points_earned - v_points_used;

    -- 等級：DB 等級制取最高符合者；無等級制 fallback 舊制門檻
    SELECT * INTO v_new_level FROM member_levels
     WHERE organization_id = v_tid
       AND (
         (criteria_type = 'lifetime_spend'  AND v_new_lifetime_spend >= COALESCE(criteria_value, 0)) OR
         (criteria_type = 'lifetime_points' AND v_new_lifetime_pts   >= COALESCE(criteria_value, 0))
       )
     ORDER BY rank DESC
     LIMIT 1;
    IF v_new_level.id IS NULL THEN
      SELECT * INTO v_new_level FROM member_levels
       WHERE organization_id = v_tid ORDER BY rank ASC LIMIT 1;
    END IF;

    IF v_new_level.id IS NOT NULL THEN
      v_new_level_name := v_new_level.name;
      v_tier_changed   := v_new_level.id IS DISTINCT FROM v_member.level_id;
    ELSE
      v_new_level_name := CASE
        WHEN v_new_lifetime_spend >= 200000 AND v_new_lifetime_pts >= 20000 THEN '鑽石'
        WHEN v_new_lifetime_spend >= 80000  AND v_new_lifetime_pts >= 8000  THEN '白金'
        WHEN v_new_lifetime_spend >= 30000  AND v_new_lifetime_pts >= 3000  THEN '金卡'
        WHEN v_new_lifetime_spend >= 10000  AND v_new_lifetime_pts >= 1000  THEN '銀卡'
        ELSE '一般' END;
      v_tier_changed := v_new_level_name IS DISTINCT FROM v_member.level;
    END IF;

    UPDATE members SET
      total_points     = v_new_lifetime_pts,
      available_points = v_new_available,
      total_spent      = v_new_lifetime_spend,
      lifetime_spend   = v_new_lifetime_spend,
      lifetime_points  = v_new_lifetime_pts,
      level            = v_new_level_name,
      level_id         = COALESCE(v_new_level.id, level_id),
      visit_count      = COALESCE(visit_count, 0) + 1,
      last_visit       = CURRENT_DATE
    WHERE id = v_member_id;

    INSERT INTO point_transactions (member_id, organization_id, type, points, balance, reference, description)
    VALUES (v_member_id, v_tid, 'earn', v_points_earned,
            COALESCE(v_member.available_points, 0) + v_points_earned,
            v_txn_number, 'POS消費累點 ($' || v_total || ')');

    IF v_points_used > 0 THEN
      INSERT INTO point_transactions (member_id, organization_id, type, points, balance, reference, description)
      VALUES (v_member_id, v_tid, 'redeem', -v_points_used, v_new_available,
              v_txn_number || '-REDEEM',
              'POS點數折抵（' || v_points_used || '點，折抵NT$' || floor(v_points_used * 0.5) || '）');
    END IF;

    IF v_tier_changed AND v_new_level.id IS NOT NULL THEN
      INSERT INTO member_level_history (member_id, organization_id, from_level_id, to_level_id, from_level_name, to_level_name, reason)
      VALUES (v_member_id, v_tid, v_member.level_id, v_new_level.id, v_member.level, v_new_level_name, 'upgrade');
    END IF;

    -- 消費紀錄 + 明細（會員 App 讀同一組表）
    v_pm_norm := CASE
      WHEN p_payment_splits IS NOT NULL AND jsonb_array_length(p_payment_splits) > 1 THEN 'mixed'
      WHEN p_payment_method = '現金' THEN 'cash'
      WHEN p_payment_method = '信用卡' THEN 'card'
      WHEN p_payment_method = 'LINE Pay' THEN 'line_pay'
      WHEN p_payment_method = '轉帳' THEN 'transfer'
      ELSE NULL END;

    INSERT INTO member_purchases (member_id, organization_id, store_id, transaction_id, total_amount, payment_method, points_earned, coupon_id)
    VALUES (v_member_id, v_tid, p_store_id, v_result.id, v_total, v_pm_norm, v_points_earned, p_coupon_assignment_id)
    RETURNING id INTO v_purchase_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      INSERT INTO member_purchase_lines (purchase_id, product_name, qty, unit_price, subtotal)
      VALUES (
        v_purchase_id,
        COALESCE(v_item->>'name', ''),
        COALESCE((v_item->>'qty')::NUMERIC, 1),
        COALESCE((v_item->>'price')::NUMERIC, 0),
        COALESCE((v_item->>'qty')::NUMERIC, 1) * COALESCE((v_item->>'price')::NUMERIC, 0)
      );
    END LOOP;

    -- 點數欄位回寫交易（後端計算值 = 單一事實來源）
    UPDATE pos_transactions SET points_earned = v_points_earned WHERE id = v_result.id;
    v_result.points_earned := v_points_earned;
  END IF;

  -- ── 優惠券核銷（單次使用，原子） ──
  IF p_coupon_assignment_id IS NOT NULL THEN
    UPDATE coupon_assignments
       SET used_at = now(), used_at_purchase_id = v_purchase_id
     WHERE id = p_coupon_assignment_id;
    UPDATE coupons SET used_count = COALESCE(used_count, 0) + 1
     WHERE id = v_coupon_ca.coupon_id;
  END IF;

  -- ── 傳票（借：現金/銀行/應收 貸：營業收入）（修 R1/#4） ──
  IF p_payment_splits IS NOT NULL AND jsonb_array_length(p_payment_splits) > 0 THEN
    FOR v_split IN SELECT * FROM jsonb_array_elements(p_payment_splits) LOOP
      CASE v_split->>'method'
        WHEN '現金' THEN v_cash_amt := v_cash_amt + (v_split->>'amount')::NUMERIC;
        WHEN '掛帳' THEN v_ar_amt   := v_ar_amt   + (v_split->>'amount')::NUMERIC;
        ELSE            v_bank_amt := v_bank_amt + (v_split->>'amount')::NUMERIC;
      END CASE;
    END LOOP;
  ELSE
    CASE p_payment_method
      WHEN '現金' THEN v_cash_amt := v_total;
      WHEN '掛帳' THEN v_ar_amt   := v_total;
      ELSE            v_bank_amt := v_total;
    END CASE;
  END IF;

  IF v_total > 0 THEN
    v_je_lines := '[]'::JSONB;
    IF v_cash_amt > 0 THEN
      v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
        'account_code','1100','account_name','現金','debit',v_cash_amt,'credit',0,'memo',v_txn_number));
    END IF;
    IF v_bank_amt > 0 THEN
      v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
        'account_code','1200','account_name','銀行存款','debit',v_bank_amt,'credit',0,'memo',v_txn_number));
    END IF;
    IF v_ar_amt > 0 THEN
      v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
        'account_code','1300','account_name','應收帳款','debit',v_ar_amt,'credit',0,'memo',v_txn_number));
    END IF;
    v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
      'account_code','4100','account_name','營業收入','debit',0,'credit',v_total,'memo',v_txn_number));

    PERFORM secure_create_journal_entry(
      CURRENT_DATE,
      'POS 銷售 ' || v_txn_number || '（' || p_payment_method || '）',
      v_je_lines,
      'POS',
      v_result.id,
      COALESCE(p_cashier, '系統')
    );
  END IF;

  -- ── 稽核：手動折扣 ──
  IF COALESCE(p_manual_discount, 0) > 0 THEN
    INSERT INTO pos_audit_log (organization_id, store_id, action, amount, reason, cashier, approved_by, transaction_ref)
    VALUES (v_tid, p_store_id, 'manual_discount', p_manual_discount, p_note, p_cashier, v_approver, v_txn_number);
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.secure_create_pos_transaction(
  TEXT, TEXT, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, UUID,
  INT, TEXT, NUMERIC, BIGINT, JSONB, TEXT
) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_create_pos_transaction(
  TEXT, TEXT, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, UUID,
  INT, TEXT, NUMERIC, BIGINT, JSONB, TEXT
) FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. secure_refund_pos_transaction — 零售交易退款後端化
--    退貨紀錄（pos_returns）＋ 還庫存 ＋ 扣回點數 ＋ 迴轉傳票 ＋ 稽核，單一原子交易。
--    （原前端 processRefund 為純模擬，從未落庫）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_refund_pos_transaction(
  p_transaction_number TEXT,
  p_items              JSONB DEFAULT NULL,  -- [{name, qty, price}]；NULL = 整筆退
  p_reason             TEXT DEFAULT NULL,
  p_refund_method      TEXT DEFAULT 'cash', -- cash | card | store_credit
  p_manager_pin        TEXT DEFAULT NULL,
  p_cashier            TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid           INT;
  v_txn           pos_transactions%ROWTYPE;
  v_items         JSONB;
  v_item          JSONB;
  v_refund_amount NUMERIC := 0;
  v_prior_refunds NUMERIC;
  v_approver      TEXT := NULL;
  v_org_has_pins  BOOLEAN;
  v_return_id     UUID;
  v_member        members%ROWTYPE;
  v_member_id     INT;
  v_pts_reverse   INT := 0;
  v_new_status    TEXT;
  v_credit_acct   TEXT;
  v_credit_name   TEXT;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;
  IF p_refund_method NOT IN ('cash','card','store_credit') THEN
    RAISE EXCEPTION '無效的退款方式：%', p_refund_method;
  END IF;

  SELECT * INTO v_txn FROM pos_transactions
   WHERE organization_id = v_tid AND transaction_number = btrim(p_transaction_number)
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TXN_NOT_FOUND: 查無交易 %', p_transaction_number; END IF;
  IF v_txn.status = '已退款' THEN RAISE EXCEPTION 'ALREADY_REFUNDED: 此交易已全額退款'; END IF;

  v_items := COALESCE(p_items, v_txn.items);
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION '退款必須包含至少一項商品';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    v_refund_amount := v_refund_amount +
      COALESCE((v_item->>'price')::NUMERIC, 0) * COALESCE((v_item->>'qty')::NUMERIC, 1);
  END LOOP;
  IF v_refund_amount <= 0 THEN RAISE EXCEPTION '退款金額必須大於 0'; END IF;

  -- 累計退款不可超過原交易總額
  SELECT COALESCE(SUM(refund_amount), 0) INTO v_prior_refunds
    FROM pos_returns WHERE transaction_id = v_txn.id;
  IF v_prior_refunds + v_refund_amount > v_txn.total + 0.01 THEN
    RAISE EXCEPTION 'REFUND_EXCEEDS_TOTAL: 累計退款 (%) 超過交易總額 (%)',
      v_prior_refunds + v_refund_amount, v_txn.total;
  END IF;

  -- 主管授權：組織已建立 PIN 制度時，所有退款皆須授權
  SELECT EXISTS (SELECT 1 FROM pos_manager_pins WHERE organization_id = v_tid AND is_active)
    INTO v_org_has_pins;
  IF v_org_has_pins THEN
    v_approver := pos__verify_manager_pin(v_tid, p_manager_pin);
    IF v_approver IS NULL THEN
      RAISE EXCEPTION 'APPROVAL_REQUIRED: 退款需主管 PIN 授權';
    END IF;
  END IF;

  -- 退貨紀錄
  INSERT INTO pos_returns (organization_id, store_id, transaction_id, transaction_number,
                           return_items, refund_amount, refund_method, note)
  VALUES (v_tid, v_txn.store_id, v_txn.id, v_txn.transaction_number,
          v_items, v_refund_amount, p_refund_method, p_reason)
  RETURNING id INTO v_return_id;

  -- 還庫存 ＋ 異動稽核
  PERFORM pos__adjust_stock(v_tid, v_items, +1, v_txn.transaction_number || '-REFUND');

  -- 會員點數扣回（與原 refundPoints 邏輯一致：以退款金額回推應得點數，下限 0）
  IF v_txn.member_id IS NOT NULL AND v_txn.member_id ~ '^\d+$' THEN
    v_member_id := v_txn.member_id::INT;
    SELECT * INTO v_member FROM members
     WHERE id = v_member_id AND organization_id = v_tid FOR UPDATE;
    IF FOUND THEN
      v_pts_reverse := pos__points_earned(v_tid::BIGINT, v_member.level_id::BIGINT, v_member.level, v_refund_amount);
      UPDATE members SET
        total_points     = GREATEST(0, COALESCE(total_points, 0)     - v_pts_reverse),
        available_points = GREATEST(0, COALESCE(available_points, 0) - v_pts_reverse),
        total_spent      = GREATEST(0, COALESCE(total_spent, 0)      - v_refund_amount),
        lifetime_spend   = GREATEST(0, COALESCE(lifetime_spend, 0)   - v_refund_amount),
        lifetime_points  = GREATEST(0, COALESCE(lifetime_points, 0)  - v_pts_reverse)
      WHERE id = v_member_id;

      INSERT INTO point_transactions (member_id, organization_id, type, points, balance, reference, description)
      VALUES (v_member_id, v_tid, 'refund', -v_pts_reverse,
              GREATEST(0, COALESCE(v_member.available_points, 0) - v_pts_reverse),
              v_txn.transaction_number || '-REFUND',
              COALESCE(p_reason, '退款扣回') || '（退款 $' || v_refund_amount || '，扣回 ' || v_pts_reverse || ' 點）');
    END IF;
  END IF;

  -- 迴轉傳票（借：營業收入 貸：現金/銀行/應付）
  v_credit_acct := CASE p_refund_method WHEN 'cash' THEN '1100' WHEN 'card' THEN '1200' ELSE '2100' END;
  v_credit_name := CASE p_refund_method WHEN 'cash' THEN '現金' WHEN 'card' THEN '銀行存款' ELSE '應付帳款' END;
  PERFORM secure_create_journal_entry(
    CURRENT_DATE,
    'POS 退款 ' || v_txn.transaction_number || COALESCE('（' || p_reason || '）', ''),
    jsonb_build_array(
      jsonb_build_object('account_code','4100','account_name','營業收入','debit',v_refund_amount,'credit',0,'memo',v_txn.transaction_number),
      jsonb_build_object('account_code',v_credit_acct,'account_name',v_credit_name,'debit',0,'credit',v_refund_amount,'memo',v_txn.transaction_number)
    ),
    'POS退款',
    v_txn.id,
    COALESCE(p_cashier, '系統')
  );

  -- 交易狀態
  v_new_status := CASE WHEN v_prior_refunds + v_refund_amount >= v_txn.total - 0.01
                       THEN '已退款' ELSE '部分退款' END;
  UPDATE pos_transactions SET status = v_new_status WHERE id = v_txn.id;

  -- 稽核
  INSERT INTO pos_audit_log (organization_id, store_id, action, amount, reason, cashier, approved_by, transaction_ref)
  VALUES (v_tid, v_txn.store_id, 'refund', v_refund_amount, p_reason, p_cashier, v_approver, v_txn.transaction_number);

  RETURN jsonb_build_object(
    'ok', true,
    'refund_id', v_return_id,
    'refund_amount', v_refund_amount,
    'points_reversed', v_pts_reverse,
    'status', v_new_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.secure_refund_pos_transaction(TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_refund_pos_transaction(TEXT, JSONB, TEXT, TEXT, TEXT, TEXT) FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. pos_payments 支援零售交易模型
--     修 F-D1 EDC 卡收落庫失敗：recordEdcPayment 以 pos_transactions 的 INT id
--     塞進 order_id（UUID FK → pos_orders）→ insert 必失敗且被前端吞掉，
--     導致零售刷卡從未寫入 pos_payments（發票補開與中信請款批次都抓不到）。
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pos_payments
  ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.pos_payments
  ADD COLUMN IF NOT EXISTS transaction_id INT REFERENCES public.pos_transactions(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pos_payments_source') THEN
    ALTER TABLE public.pos_payments
      ADD CONSTRAINT chk_pos_payments_source
      CHECK (order_id IS NOT NULL OR transaction_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_payments_transaction
  ON public.pos_payments(transaction_id) WHERE transaction_id IS NOT NULL;
