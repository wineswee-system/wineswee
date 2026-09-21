-- ============================================================
-- Phase 1: 高風險操作 Postgres Function（SECURITY DEFINER）
-- 前端改用 supabase.rpc() 呼叫，商業邏輯跑在 DB 端
-- ============================================================

-- ─── 1. 薪資建立/更新 ───
CREATE OR REPLACE FUNCTION secure_upsert_salary(
  p_employee TEXT,
  p_month TEXT,
  p_base_salary INT,
  p_allowance INT DEFAULT 0,
  p_overtime INT DEFAULT 0,
  p_deductions INT DEFAULT 0,
  p_insurance INT DEFAULT 0,
  p_net_salary INT DEFAULT NULL
) RETURNS salary_records
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
  v_net INT;
  v_result salary_records;
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  -- 計算淨額（若未提供）
  v_net := COALESCE(p_net_salary, p_base_salary + p_allowance + p_overtime - p_deductions - p_insurance);

  -- 驗證
  IF p_base_salary < 0 THEN RAISE EXCEPTION '底薪不可為負'; END IF;
  IF v_net < 0 THEN RAISE EXCEPTION '淨額不可為負：%', v_net; END IF;
  IF p_employee IS NULL OR p_employee = '' THEN RAISE EXCEPTION '員工欄位不可為空'; END IF;
  IF p_month IS NULL OR p_month = '' THEN RAISE EXCEPTION '月份欄位不可為空'; END IF;

  -- 員工必須屬於此租戶
  IF NOT EXISTS (SELECT 1 FROM employees WHERE name = p_employee AND tenant_id = v_tid) THEN
    RAISE EXCEPTION '員工不存在或不屬於此租戶：%', p_employee;
  END IF;

  INSERT INTO salary_records (tenant_id, employee, month, base_salary, allowance, overtime, deductions, insurance, net_salary)
  VALUES (v_tid, p_employee, p_month, p_base_salary, p_allowance, p_overtime, p_deductions, p_insurance, v_net)
  ON CONFLICT (id) DO UPDATE SET
    base_salary = EXCLUDED.base_salary,
    allowance = EXCLUDED.allowance,
    overtime = EXCLUDED.overtime,
    deductions = EXCLUDED.deductions,
    insurance = EXCLUDED.insurance,
    net_salary = EXCLUDED.net_salary
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 2. 會計分錄（含明細，原子操作） ───
CREATE OR REPLACE FUNCTION secure_create_journal_entry(
  p_entry_date DATE,
  p_description TEXT,
  p_lines JSONB,
  p_source TEXT DEFAULT NULL,
  p_source_id INT DEFAULT NULL,
  p_created_by TEXT DEFAULT NULL
) RETURNS journal_entries
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
  v_entry journal_entries;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line JSONB;
  v_idx INT := 0;
  v_entry_number TEXT;
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  -- 驗證明細
  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION '分錄至少需要兩筆明細（一借一貸）';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_idx := v_idx + 1;
    IF v_line->>'account_code' IS NULL OR v_line->>'account_code' = '' THEN
      RAISE EXCEPTION '第 % 筆缺少科目代碼', v_idx;
    END IF;
    IF COALESCE((v_line->>'debit')::NUMERIC, 0) < 0 THEN
      RAISE EXCEPTION '第 % 筆借方不可為負', v_idx;
    END IF;
    IF COALESCE((v_line->>'credit')::NUMERIC, 0) < 0 THEN
      RAISE EXCEPTION '第 % 筆貸方不可為負', v_idx;
    END IF;
    IF COALESCE((v_line->>'debit')::NUMERIC, 0) > 0 AND COALESCE((v_line->>'credit')::NUMERIC, 0) > 0 THEN
      RAISE EXCEPTION '第 % 筆不可同時有借貸金額', v_idx;
    END IF;

    v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);
  END LOOP;

  -- 借貸必須平衡
  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION '借貸不平衡：借方 %, 貸方 %, 差額 %',
      v_total_debit, v_total_credit, ABS(v_total_debit - v_total_credit);
  END IF;

  -- 產生流水號
  v_entry_number := 'JE-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('journal_entries_id_seq')::TEXT, 6, '0');

  -- 寫入分錄主檔
  INSERT INTO journal_entries (tenant_id, entry_number, entry_date, description, source, source_id, created_by, status)
  VALUES (v_tid, v_entry_number, p_entry_date, p_description, p_source, p_source_id, p_created_by, '草稿')
  RETURNING * INTO v_entry;

  -- 寫入明細
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, memo, cost_center)
  SELECT
    v_tid,
    v_entry.id,
    elem->>'account_code',
    elem->>'account_name',
    COALESCE((elem->>'debit')::NUMERIC, 0),
    COALESCE((elem->>'credit')::NUMERIC, 0),
    elem->>'memo',
    elem->>'cost_center'
  FROM jsonb_array_elements(p_lines) AS elem;

  RETURN v_entry;
END;
$$;

-- ─── 3. 庫存調整 ───
CREATE OR REPLACE FUNCTION secure_create_inventory_adjustment(
  p_sku_code TEXT,
  p_sku_name TEXT,
  p_bin_code TEXT,
  p_quantity NUMERIC,
  p_reason TEXT,
  p_operator TEXT,
  p_unit_cost NUMERIC DEFAULT 0
) RETURNS inventory_adjustments
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result inventory_adjustments;
  v_valid_reasons TEXT[] := ARRAY[
    'cycle_count', 'damage', 'return', 'correction',
    'write_off', 'found', 'production', 'sample'
  ];
BEGIN
  -- 驗證
  IF p_sku_code IS NULL OR p_sku_code = '' THEN
    RAISE EXCEPTION 'SKU 代碼不可為空';
  END IF;
  IF p_operator IS NULL OR p_operator = '' THEN
    RAISE EXCEPTION '操作人員不可為空';
  END IF;
  IF p_reason IS NULL OR NOT (p_reason = ANY(v_valid_reasons)) THEN
    RAISE EXCEPTION '無效的調整原因：%。有效值：%', p_reason, array_to_string(v_valid_reasons, ', ');
  END IF;

  INSERT INTO inventory_adjustments (sku_code, sku_name, bin_code, quantity, reason, operator, unit_cost)
  VALUES (p_sku_code, p_sku_name, p_bin_code, ROUND(p_quantity::NUMERIC, 2), p_reason, p_operator, p_unit_cost)
  RETURNING * INTO v_result;

  -- 同步更新 stock_levels（若存在）
  UPDATE stock_levels
  SET quantity = quantity + ROUND(p_quantity::NUMERIC, 2),
      created_at = now()
  WHERE sku_code = p_sku_code AND warehouse = COALESCE(p_bin_code, 'default');

  RETURN v_result;
END;
$$;

-- ─── 4. 審批狀態更新 ───
CREATE OR REPLACE FUNCTION secure_update_approval(
  p_id INT,
  p_status TEXT,
  p_approver TEXT,
  p_comments TEXT DEFAULT NULL,
  p_reject_reason TEXT DEFAULT NULL
) RETURNS approval_requests
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
  v_current approval_requests;
  v_result approval_requests;
  v_valid_statuses TEXT[] := ARRAY['待審核', '已核准', '已駁回', '已取消'];
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  -- 取得現有紀錄
  SELECT * INTO v_current FROM approval_requests WHERE id = p_id AND tenant_id = v_tid;
  IF NOT FOUND THEN RAISE EXCEPTION '審批單不存在或無權限：%', p_id; END IF;

  -- 狀態驗證
  IF NOT (p_status = ANY(v_valid_statuses)) THEN
    RAISE EXCEPTION '無效狀態：%', p_status;
  END IF;
  IF v_current.status <> '待審核' THEN
    RAISE EXCEPTION '此審批單已為「%」狀態，不可再變更', v_current.status;
  END IF;
  IF p_status = '已駁回' AND (p_reject_reason IS NULL OR p_reject_reason = '') THEN
    RAISE EXCEPTION '駁回時必須填寫原因';
  END IF;
  IF p_approver IS NULL OR p_approver = '' THEN
    RAISE EXCEPTION '審批人不可為空';
  END IF;

  UPDATE approval_requests
  SET status = p_status,
      approver = p_approver,
      comments = p_comments,
      decided_at = now()
  WHERE id = p_id AND tenant_id = v_tid
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 5. POS 交易建立 ───
CREATE OR REPLACE FUNCTION secure_create_pos_transaction(
  p_store TEXT,
  p_cashier TEXT,
  p_items JSONB,
  p_subtotal NUMERIC,
  p_discount NUMERIC DEFAULT 0,
  p_tax NUMERIC DEFAULT 0,
  p_total NUMERIC DEFAULT NULL,
  p_payment_method TEXT DEFAULT '現金',
  p_payment_ref TEXT DEFAULT NULL,
  p_member_id TEXT DEFAULT NULL,
  p_points_earned INT DEFAULT 0,
  p_points_used INT DEFAULT 0,
  p_invoice_number TEXT DEFAULT NULL,
  p_invoice_carrier TEXT DEFAULT NULL
) RETURNS pos_transactions
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
  v_total NUMERIC;
  v_txn_number TEXT;
  v_result pos_transactions;
  v_valid_payments TEXT[] := ARRAY['現金', '信用卡', 'LINE Pay', '悠遊卡', '街口支付', '轉帳', '其他'];
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  -- 金額驗證
  v_total := COALESCE(p_total, p_subtotal - p_discount + p_tax);
  IF p_subtotal < 0 THEN RAISE EXCEPTION '小計不可為負'; END IF;
  IF v_total < 0 THEN RAISE EXCEPTION '總額不可為負'; END IF;
  IF p_discount < 0 THEN RAISE EXCEPTION '折扣不可為負'; END IF;
  IF p_tax < 0 THEN RAISE EXCEPTION '稅額不可為負'; END IF;

  -- 付款方式驗證
  IF NOT (p_payment_method = ANY(v_valid_payments)) THEN
    RAISE EXCEPTION '無效的付款方式：%', p_payment_method;
  END IF;

  -- 商品驗證
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '交易必須包含至少一項商品';
  END IF;

  -- 產生交易編號
  v_txn_number := 'POS-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || lpad((random() * 9999)::INT::TEXT, 4, '0');

  INSERT INTO pos_transactions (
    tenant_id, transaction_number, store, cashier, items,
    subtotal, discount, tax, total,
    payment_method, payment_ref, member_id,
    points_earned, points_used,
    invoice_number, invoice_carrier, status
  ) VALUES (
    v_tid, v_txn_number, p_store, p_cashier, p_items,
    p_subtotal, p_discount, p_tax, v_total,
    p_payment_method, p_payment_ref, p_member_id,
    p_points_earned, p_points_used,
    p_invoice_number, p_invoice_carrier, '完成'
  ) RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 6. 假單審核 ───
CREATE OR REPLACE FUNCTION secure_update_leave_status(
  p_id INT,
  p_status TEXT,
  p_approver TEXT,
  p_reject_reason TEXT DEFAULT NULL
) RETURNS leave_requests
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
  v_current leave_requests;
  v_result leave_requests;
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  SELECT * INTO v_current FROM leave_requests WHERE id = p_id AND tenant_id = v_tid;
  IF NOT FOUND THEN RAISE EXCEPTION '假單不存在或無權限：%', p_id; END IF;

  IF v_current.status <> '待審核' THEN
    RAISE EXCEPTION '此假單已為「%」狀態，不可再變更', v_current.status;
  END IF;
  IF p_status NOT IN ('已核准', '已駁回') THEN
    RAISE EXCEPTION '狀態只可為「已核准」或「已駁回」';
  END IF;
  IF p_status = '已駁回' AND (p_reject_reason IS NULL OR p_reject_reason = '') THEN
    RAISE EXCEPTION '駁回時必須填寫原因';
  END IF;
  IF p_approver IS NULL OR p_approver = '' THEN
    RAISE EXCEPTION '審核人不可為空';
  END IF;

  UPDATE leave_requests
  SET status = p_status, approver = p_approver, reject_reason = p_reject_reason
  WHERE id = p_id AND tenant_id = v_tid
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 7. 加班單審核 ───
CREATE OR REPLACE FUNCTION secure_update_overtime_status(
  p_id INT,
  p_status TEXT,
  p_reject_reason TEXT DEFAULT NULL
) RETURNS overtime_requests
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
  v_current overtime_requests;
  v_result overtime_requests;
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  SELECT * INTO v_current FROM overtime_requests WHERE id = p_id AND tenant_id = v_tid;
  IF NOT FOUND THEN RAISE EXCEPTION '加班單不存在或無權限：%', p_id; END IF;

  IF v_current.status <> '待審核' THEN
    RAISE EXCEPTION '此加班單已為「%」狀態，不可再變更', v_current.status;
  END IF;
  IF p_status NOT IN ('已核准', '已駁回') THEN
    RAISE EXCEPTION '狀態只可為「已核准」或「已駁回」';
  END IF;
  IF p_status = '已駁回' AND (p_reject_reason IS NULL OR p_reject_reason = '') THEN
    RAISE EXCEPTION '駁回時必須填寫原因';
  END IF;

  UPDATE overtime_requests
  SET status = p_status, reject_reason = p_reject_reason
  WHERE id = p_id AND tenant_id = v_tid
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 8. 採購單建立 ───
CREATE OR REPLACE FUNCTION secure_create_purchase_order(
  p_po_number TEXT,
  p_supplier TEXT,
  p_items JSONB,
  p_total_amount NUMERIC,
  p_tax NUMERIC DEFAULT 0,
  p_shipping NUMERIC DEFAULT 0,
  p_payment_terms TEXT DEFAULT NULL,
  p_expected_date DATE DEFAULT NULL,
  p_pr_id INT DEFAULT NULL
) RETURNS purchase_orders
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
  v_result purchase_orders;
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  -- 驗證
  IF p_supplier IS NULL OR p_supplier = '' THEN
    RAISE EXCEPTION '供應商不可為空';
  END IF;
  IF p_total_amount < 0 THEN RAISE EXCEPTION '採購金額不可為負'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '採購單必須包含至少一項品項';
  END IF;

  -- 供應商必須存在於此租戶
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE name = p_supplier AND tenant_id = v_tid) THEN
    RAISE EXCEPTION '供應商不存在或不屬於此租戶：%', p_supplier;
  END IF;

  INSERT INTO purchase_orders (
    tenant_id, po_number, supplier, pr_id, items,
    total_amount, tax, shipping, payment_terms, expected_date, status
  ) VALUES (
    v_tid, p_po_number, p_supplier, p_pr_id, p_items,
    p_total_amount, p_tax, p_shipping, p_payment_terms, p_expected_date, '待確認'
  ) RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 9. 銷售單建立 ───
CREATE OR REPLACE FUNCTION secure_create_sales_order(
  p_order_number TEXT,
  p_customer TEXT,
  p_items JSONB,
  p_subtotal NUMERIC,
  p_discount NUMERIC DEFAULT 0,
  p_tax NUMERIC DEFAULT 0,
  p_total NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT NULL,
  p_quote_id INT DEFAULT NULL
) RETURNS sales_orders
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
  v_total NUMERIC;
  v_result sales_orders;
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  v_total := COALESCE(p_total, p_subtotal - p_discount + p_tax);

  -- 驗證
  IF p_customer IS NULL OR p_customer = '' THEN
    RAISE EXCEPTION '客戶不可為空';
  END IF;
  IF v_total < 0 THEN RAISE EXCEPTION '銷售總額不可為負'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '銷售單必須包含至少一項品項';
  END IF;

  INSERT INTO sales_orders (
    tenant_id, order_number, quote_id, customer, items,
    subtotal, discount, tax, total,
    notes, created_by, payment_status, shipping_status, credit_check
  ) VALUES (
    v_tid, p_order_number, p_quote_id, p_customer, p_items,
    p_subtotal, p_discount, p_tax, v_total,
    p_notes, p_created_by, '未付款', '未出貨', '通過'
  ) RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 10. 權限更新（防止權限提升攻擊） ───
CREATE OR REPLACE FUNCTION secure_update_role_permissions(
  p_role_id INT,
  p_permission_ids INT[]
) RETURNS SETOF role_permissions
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role_name TEXT;
  v_invalid_count INT;
BEGIN
  -- 角色必須存在
  SELECT name INTO v_role_name FROM roles WHERE id = p_role_id;
  IF NOT FOUND THEN RAISE EXCEPTION '角色不存在：%', p_role_id; END IF;

  -- 禁止修改 super_admin
  IF v_role_name = 'super_admin' THEN
    RAISE EXCEPTION '不可修改超級管理員權限';
  END IF;

  -- 所有 permission_id 必須存在
  SELECT COUNT(*) INTO v_invalid_count
  FROM unnest(p_permission_ids) AS pid
  WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE id = pid);

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION '包含 % 個無效的權限 ID', v_invalid_count;
  END IF;

  -- 原子操作：刪除舊的 + 新增新的
  DELETE FROM role_permissions WHERE role_id = p_role_id;

  IF array_length(p_permission_ids, 1) IS NOT NULL AND array_length(p_permission_ids, 1) > 0 THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT p_role_id, pid FROM unnest(p_permission_ids) AS pid;
  END IF;

  RETURN QUERY SELECT * FROM role_permissions WHERE role_id = p_role_id;
END;
$$;

-- ─── 11. 批量更新庫存水位 ───
CREATE OR REPLACE FUNCTION secure_bulk_upsert_stock_levels(
  p_rows JSONB
) RETURNS SETOF stock_levels
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row JSONB;
  v_idx INT := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION '庫存資料不可為空';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_idx := v_idx + 1;
    IF v_row->>'sku_code' IS NULL OR v_row->>'sku_code' = '' THEN
      RAISE EXCEPTION '第 % 筆缺少 sku_code', v_idx;
    END IF;
    IF v_row->>'warehouse' IS NULL OR v_row->>'warehouse' = '' THEN
      RAISE EXCEPTION '第 % 筆缺少 warehouse', v_idx;
    END IF;
    IF COALESCE((v_row->>'quantity')::NUMERIC, 0) < 0 THEN
      RAISE EXCEPTION '第 % 筆庫存數量不可為負', v_idx;
    END IF;
  END LOOP;

  RETURN QUERY
  INSERT INTO stock_levels (sku_code, warehouse, quantity, min_qty)
  SELECT
    elem->>'sku_code',
    elem->>'warehouse',
    COALESCE((elem->>'quantity')::NUMERIC, 0),
    COALESCE((elem->>'min_qty')::NUMERIC, 0)
  FROM jsonb_array_elements(p_rows) AS elem
  ON CONFLICT (sku_code, warehouse)
  DO UPDATE SET
    quantity = EXCLUDED.quantity,
    min_qty = EXCLUDED.min_qty,
    created_at = now()
  RETURNING *;
END;
$$;

-- ─── 收緊高風險表的 anon 直接寫入權限 ───
-- 這些表現在只能透過上面的 SECURITY DEFINER 函數寫入
REVOKE INSERT, UPDATE, DELETE ON salary_records FROM anon;
REVOKE INSERT, UPDATE, DELETE ON journal_entries FROM anon;
REVOKE INSERT, UPDATE, DELETE ON journal_lines FROM anon;
REVOKE INSERT, UPDATE, DELETE ON approval_requests FROM anon;
REVOKE INSERT, UPDATE, DELETE ON role_permissions FROM anon;
