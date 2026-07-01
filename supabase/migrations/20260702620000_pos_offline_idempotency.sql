-- ─────────────────────────────────────────────────────────────────────────────
-- POS 離線交易冪等性 (offline transaction idempotency)
--
-- 離線 POS 交易在重新連線後自動補送。為避免重送造成重複入帳：
--   1. pos_transactions 增加 client_tx_id（前端在排入離線佇列時以
--      crypto.randomUUID() 產生，重試時帶同一個值）
--   2. (organization_id, client_tx_id) 部分唯一索引（僅 client_tx_id 非 NULL 時）
--   3. secure_create_pos_transaction 增加「選填」末位參數 p_client_tx_id：
--        a. 若同租戶已存在該 client_tx_id 的交易 → 直接回傳既有紀錄（冪等重放）
--        b. 新增時將 client_tx_id 寫入
--      既有呼叫端不帶此參數時行為完全不變。
--
-- 冪等：可重複執行。
-- 函式本體複製自最新定義 20260424100200_fix_secure_functions_tenant_isolation.sql
-- （其後無其他 migration 重新定義此函式），僅加入 client_tx_id 相關邏輯。
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. 欄位
ALTER TABLE public.pos_transactions
  ADD COLUMN IF NOT EXISTS client_tx_id UUID;

-- 2. 租戶內唯一（部分索引：僅離線補送的交易帶 client_tx_id）
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_txn_org_client_tx
  ON public.pos_transactions (organization_id, client_tx_id)
  WHERE client_tx_id IS NOT NULL;

-- 3. 擴充 secure_create_pos_transaction
-- 先移除舊的 14 參數簽名，避免與新簽名形成多載造成 PostgREST 解析歧義。
DROP FUNCTION IF EXISTS public.secure_create_pos_transaction(
  TEXT, TEXT, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.secure_create_pos_transaction(
  p_store           TEXT,
  p_cashier         TEXT,
  p_items           JSONB,
  p_subtotal        NUMERIC,
  p_discount        NUMERIC DEFAULT 0,
  p_tax             NUMERIC DEFAULT 0,
  p_total           NUMERIC DEFAULT NULL,
  p_payment_method  TEXT DEFAULT '現金',
  p_payment_ref     TEXT DEFAULT NULL,
  p_member_id       TEXT DEFAULT NULL,
  p_points_earned   INT  DEFAULT 0,
  p_points_used     INT  DEFAULT 0,
  p_invoice_number  TEXT DEFAULT NULL,
  p_invoice_carrier TEXT DEFAULT NULL,
  p_client_tx_id    UUID DEFAULT NULL
) RETURNS pos_transactions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid        INT;
  v_total      NUMERIC;
  v_txn_number TEXT;
  v_result     pos_transactions;
  v_valid_payments TEXT[] := ARRAY['現金', '信用卡', 'LINE Pay', '悠遊卡', '街口支付', '轉帳', '其他'];
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  -- 冪等重放：同租戶同 client_tx_id 已存在 → 回傳既有交易，不重複入帳
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

  IF NOT (p_payment_method = ANY(v_valid_payments)) THEN
    RAISE EXCEPTION '無效的付款方式：%', p_payment_method;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '交易必須包含至少一項商品';
  END IF;

  v_txn_number := 'POS-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || lpad((random() * 9999)::INT::TEXT, 4, '0');

  BEGIN
    INSERT INTO pos_transactions (
      organization_id, transaction_number, store, cashier, items,
      subtotal, discount, tax, total,
      payment_method, payment_ref, member_id,
      points_earned, points_used,
      invoice_number, invoice_carrier, status, client_tx_id
    ) VALUES (
      v_tid, v_txn_number, p_store, p_cashier, p_items,
      p_subtotal, p_discount, p_tax, v_total,
      p_payment_method, p_payment_ref, p_member_id,
      p_points_earned, p_points_used,
      p_invoice_number, p_invoice_carrier, '完成', p_client_tx_id
    ) RETURNING * INTO v_result;
  EXCEPTION WHEN unique_violation THEN
    -- 併發重放競態：另一請求剛好先插入同 client_tx_id → 回傳既有紀錄
    IF p_client_tx_id IS NOT NULL THEN
      SELECT * INTO v_result FROM pos_transactions
      WHERE organization_id = v_tid AND client_tx_id = p_client_tx_id;
      IF FOUND THEN RETURN v_result; END IF;
    END IF;
    RAISE; -- 非 client_tx_id 造成的唯一衝突（如 transaction_number）照常拋出
  END;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.secure_create_pos_transaction(
  TEXT, TEXT, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, UUID
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.secure_create_pos_transaction(
  TEXT, TEXT, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT, UUID
) FROM anon;
