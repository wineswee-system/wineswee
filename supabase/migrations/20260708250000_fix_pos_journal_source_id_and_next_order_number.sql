-- Tier3 財務:POS 傳票 source_id 型別 + next_order_number 簽章 — 2026-07-08
-- secure_create/refund_pos_transaction:pos_transactions.id 是 bigint,但 secure_create_journal_entry
--   的 p_source_id 是 integer → 解析不到函式。呼叫端 ::int(不動共用 journal 函式避免 overload 衝突)。
-- idempotent。

CREATE OR REPLACE FUNCTION public.secure_create_pos_transaction(p_store text, p_cashier text, p_items jsonb, p_subtotal numeric, p_discount numeric DEFAULT 0, p_tax numeric DEFAULT 0, p_total numeric DEFAULT NULL::numeric, p_payment_method text DEFAULT '現金'::text, p_payment_ref text DEFAULT NULL::text, p_member_id text DEFAULT NULL::text, p_points_earned integer DEFAULT 0, p_points_used integer DEFAULT 0, p_invoice_number text DEFAULT NULL::text, p_invoice_carrier text DEFAULT NULL::text, p_client_tx_id uuid DEFAULT NULL::uuid, p_store_id integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text, p_manual_discount numeric DEFAULT 0, p_coupon_assignment_id bigint DEFAULT NULL::bigint, p_payment_splits jsonb DEFAULT NULL::jsonb, p_manager_pin text DEFAULT NULL::text)
 RETURNS pos_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      v_result.id::int,
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
$function$;

CREATE OR REPLACE FUNCTION public.secure_refund_pos_transaction(p_transaction_number text, p_items jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text, p_refund_method text DEFAULT 'cash'::text, p_manager_pin text DEFAULT NULL::text, p_cashier text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    v_txn.id::int,
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
$function$;

-- next_order_number:pos_shifts.id 是 integer,原參數 uuid → integer=uuid 比較失敗。
-- 全系統無呼叫者(死碼),順修簽章。改參數型別需先 DROP 舊 uuid 版。
DROP FUNCTION IF EXISTS public.next_order_number(uuid);
CREATE OR REPLACE FUNCTION public.next_order_number(p_shift_id integer)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_counter INT;
BEGIN
  UPDATE pos_shifts
     SET order_counter = order_counter + 1
   WHERE id = p_shift_id
  RETURNING order_counter INTO v_counter;
  RETURN LPAD(v_counter::TEXT, 3, '0');
END;
$function$;

NOTIFY pgrst, 'reload schema';
